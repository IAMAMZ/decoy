"""One headless Chrome, streamed to Decoy's screen, and the primitives the tools use.

No HTTP here: routes/ exposes this over WebSocket and HTTP, tools/ builds checks on top of it.

Everything shown on the screen carries a run id. The frontend bridge (src/events/browserBridge.ts)
groups messages by id, so a tool run shows up as one session: {"id", "type": frame|address|view|
loading|caption|cursor|card|result|error, ...}.
"""

import asyncio
import contextlib
import time
from contextlib import asynccontextmanager

from fastapi import WebSocket
from playwright.async_api import async_playwright

# 16:9, so the frame fills the wide screen panel on the stage. Keep in sync with PAGE_W/PAGE_H in
# src/components/LiveScreen.tsx and the .as-shot aspect-ratio in src/styles.css.
VIEWPORT = {"width": 1280, "height": 720}
START_URL = "https://www.rbcroyalbank.com/"
SEND_TIMEOUT_S = 5  # a client that can't take a message this long is dropped
MAX_QUEUED_FRAMES = 2  # a slow client skips frames instead of falling behind
CURSOR_MOVE_S = 0.75  # matches the frontend cursor transition

# Cookie banners cover the bottom of the screen (RBC's covers about a third). Hide them instead of
# clicking: RBC's only buttons are "Accept All", "Manage Settings" and an X whose label says closing
# accepts all cookies. Hiding makes no consent choice either way. Containers of common consent tools:
COOKIE_BANNERS = [
    "#onetrust-consent-sdk",  # OneTrust (RBC)
    "#CybotCookiebotDialog",  # Cookiebot
    "#truste-consent-track",  # TrustArc
    ".qc-cmp2-container",  # Quantcast
    "#didomi-host",  # Didomi
]
HIDE_COOKIE_BANNERS = """(() => {
  const add = () => {
    const style = document.createElement('style');
    style.textContent = `%s { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };
  // Init scripts can run before the page has an <html> element; wait for it then.
  if (document.documentElement) add();
  else document.addEventListener('DOMContentLoaded', add, {once: true});
})();""" % ", ".join(COOKIE_BANNERS)

clients: dict[WebSocket, asyncio.Queue] = {}  # each client has its own outbox, so none can stall the rest
page = None
lock: asyncio.Lock | None = None  # one run drives the page at a time
inputs: asyncio.Queue | None = None  # a person's clicks and keys, applied strictly in order
run_id = "live"  # frames follow the latest run
last = {"address": "", "frame": None}
_pw = _chrome = _ctx = _worker = None
_opens = 0


# ---------- streaming to the screen ----------


def broadcast(msg: dict, rid: str | None = None) -> None:
    """Queue a message for every client. Never waits, so the browser can't be blocked by a client."""
    for ws, outbox in list(clients.items()):
        if msg["type"] == "frame" and outbox.qsize() > MAX_QUEUED_FRAMES:
            continue
        try:
            outbox.put_nowait({"id": rid or run_id, **msg})
        except asyncio.QueueFull:
            clients.pop(ws, None)


async def _sender(ws: WebSocket, outbox: asyncio.Queue) -> None:
    try:
        while True:
            await asyncio.wait_for(ws.send_json(await outbox.get()), SEND_TIMEOUT_S)
    except Exception:  # closed or stuck: stop sending to it
        clients.pop(ws, None)


def add_client(ws: WebSocket) -> asyncio.Task:
    outbox: asyncio.Queue = asyncio.Queue(maxsize=200)
    # A late joiner sees the current page right away instead of a blank screen.
    outbox.put_nowait({"id": run_id, "type": "view", "mode": "screen"})
    if last["address"]:
        outbox.put_nowait({"id": run_id, "type": "address", "text": last["address"], "typing": False})
    if last["frame"]:
        outbox.put_nowait({"id": run_id, "type": "frame", "data": last["frame"]})
    clients[ws] = outbox
    return asyncio.create_task(_sender(ws, outbox))


def remove_client(ws: WebSocket, task: asyncio.Task) -> None:
    clients.pop(ws, None)
    task.cancel()


def send_to(ws: WebSocket, msg: dict) -> None:
    with contextlib.suppress(KeyError, asyncio.QueueFull):
        clients[ws].put_nowait(msg)


def say(text: str) -> None:
    """Caption under Decoy's screen: what the browser is doing right now."""
    broadcast({"type": "caption", "text": text})


def finish(rid: str, result: dict) -> None:
    """End a run on the screen: its summary becomes the caption."""
    if result.get("ok", True):
        broadcast({"type": "result", "result": result}, rid)
    else:
        broadcast({"type": "error", "message": result.get("summary", "Failed")}, rid)


# ---------- driving the page ----------


def next_id() -> str:
    """A fresh run id, so each run's caption starts clean on the screen."""
    global _opens
    _opens += 1
    return f"open_{_opens}"


def full_url(url: str) -> str:
    url = url.strip()
    return url if url.startswith(("http://", "https://")) else f"https://{url}"


@asynccontextmanager
async def session(rid: str):
    """Hold the browser for one run; everything shown meanwhile belongs to `rid`."""
    global run_id
    async with lock:
        run_id = rid
        yield


async def navigate(url: str) -> bool:
    """Load a page while holding a session. Returns False if it didn't load (e.g. the domain doesn't exist)."""
    url = full_url(url)
    broadcast({"type": "view", "mode": "screen"})
    broadcast({"type": "address", "text": url, "typing": False})
    broadcast({"type": "loading", "on": True})
    try:
        # Two tries: a page's own late redirect (RBC's homepage does one) can interrupt the first.
        for attempt in range(2):
            try:
                await page.goto(url, timeout=15000, wait_until="domcontentloaded")
                await page.wait_for_timeout(1000)
                return True
            except Exception as e:
                print(f"navigate {url} failed (try {attempt + 1}): {e}")
        return False
    finally:
        broadcast({"type": "loading", "on": False})


async def open_page(url: str, rid: str = "live") -> dict:
    """Open a page as one run: a person's address bar, the manual /browser/open, or a client's open_page."""
    async with session(rid):
        say(f"Opening {full_url(url)}")
        if not await navigate(url):
            result = {"ok": False, "summary": f"Couldn't load {full_url(url)}", "url": full_url(url)}
        else:
            result = {"ok": True, "summary": f"Opened {await page.title() or page.url}", "url": page.url}
    finish(rid, result)
    return result


async def find(pattern: str) -> dict | None:
    """Highlight the first match of a regex (case-insensitive) that a person could actually see,
    scroll to it and point at it.

    Returns {"text", "context", "box"}, with box None if every match was hidden, or None if nothing
    matched. Call while holding a session.
    """
    hit = await page.evaluate(
        """(pattern) => {
          const re = new RegExp(pattern, 'i');
          const context = (el, text) => {
            let block = el;  // the nearest ancestor with enough text to quote around the match
            while (block.parentElement && block.innerText.trim().length < 40) block = block.parentElement;
            const ctx = block.innerText.replace(/\\s+/g, ' ').trim();
            const at = Math.max(0, ctx.indexOf(text));
            return ctx.slice(Math.max(0, at - 120), at + text.length + 120);
          };
          // Really on screen: not hidden, has a size, and nothing else (a closed menu, a cookie banner) covers it.
          const seen = (el, range) => {
            if (el.checkVisibility && !el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
            el.scrollIntoView({block: 'center', behavior: 'instant'});  // pages with smooth scrolling would still be moving
            const r = range.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) return false;
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!top && (el === top || el.contains(top) || top.contains(el));
          };
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node, fallback = null;
          while ((node = walk.nextNode())) {
            const el = node.parentElement;
            if (!el || !el.getClientRects().length) continue;
            const m = node.textContent.match(re);
            if (!m) continue;
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            if (!seen(el, range)) {
              fallback = fallback || {text: m[0], context: context(el, m[0]), box: null};
              continue;
            }
            const mark = document.createElement('mark');
            mark.style.cssText = 'background:rgba(255,91,55,.22);outline:3px solid #ff5b37;border-radius:3px;color:inherit;padding:0 2px';
            range.surroundContents(mark);
            mark.scrollIntoView({block: 'center', behavior: 'instant'});
            const r = mark.getBoundingClientRect();
            return {text: m[0], context: context(el, m[0]), box: {x: r.x, y: r.y, width: r.width, height: r.height}};
          }
          return fallback;  // only hidden matches: still report the text, without a highlight
        }""",
        pattern,
    )
    if hit and hit["box"]:
        box = hit["box"]
        x, y = box["x"] + min(box["width"] * 0.3, 60), box["y"] + box["height"] / 2
        broadcast({"type": "cursor", "x": x, "y": y, "click": True})
        await page.mouse.move(x, y, steps=12)
        await asyncio.sleep(CURSOR_MOVE_S)
    return hit


# ---------- a person driving it from the screen ----------


async def handle_input(req: dict) -> None:
    action = req.get("action")
    x, y = float(req.get("x", 0)), float(req.get("y", 0))
    try:
        if action == "click":
            await page.mouse.click(x, y, click_count=int(req.get("count", 1)))
        elif action == "move":
            await page.mouse.move(x, y)
        elif action == "wheel":
            await page.mouse.move(x, y)
            await page.mouse.wheel(float(req.get("dx", 0)), float(req.get("dy", 0)))
        elif action == "type":
            await page.keyboard.type(str(req.get("text", "")))
        elif action == "key":
            await page.keyboard.press(str(req.get("key", "")))
        elif action == "navigate":
            await open_page(str(req.get("url", "")), next_id())
        elif action == "back":
            await page.go_back(timeout=15000)
        elif action == "forward":
            await page.go_forward(timeout=15000)
        elif action == "reload":
            await page.reload(timeout=15000)
    except Exception as e:  # a bad key name or a slow page shouldn't drop the socket
        print(f"input {action} failed: {e}")


async def _input_worker() -> None:
    # One at a time: typed letters must land before the Enter that follows them.
    while True:
        await handle_input(await inputs.get())


# ---------- lifecycle ----------


async def warm(urls: list[str]) -> None:
    """Load pages once in a hidden tab, so a check opening them later hits a warm cache and connection.

    The hidden tab shares the streamed page's cache but isn't streamed, so nothing shows on the screen.
    """
    hidden = await _ctx.new_page()
    try:
        for url in urls:
            t0 = time.perf_counter()
            try:
                await hidden.goto(url, timeout=20000, wait_until="load")
                print(f"warmed {url} in {time.perf_counter() - t0:.1f}s")
            except Exception as e:  # a slow page only means its check starts cold
                print(f"warm {url} failed: {e}")
    finally:
        await hidden.close()


async def start() -> None:
    global page, lock, inputs, _pw, _chrome, _ctx, _worker
    lock = asyncio.Lock()
    inputs = asyncio.Queue()
    _pw = await async_playwright().start()
    # The installed Google Chrome, so no separate browser download is needed. English UI, so Chrome's
    # own pages ("This site can't be reached") don't follow the laptop's system language.
    _chrome = await _pw.chromium.launch(channel="chrome", headless=True, args=["--lang=en-CA"])
    ctx = _ctx = await _chrome.new_context(viewport=VIEWPORT, locale="en-CA")
    await ctx.add_init_script(HIDE_COOKIE_BANNERS)  # every page and frame, before its own scripts
    page = await ctx.new_page()

    def on_nav(frame) -> None:
        if frame == page.main_frame:
            last["address"] = frame.url
            broadcast({"type": "address", "text": frame.url, "typing": False})

    page.on("framenavigated", on_nav)

    async def on_popup(popup) -> None:
        # Links that open a new tab would vanish from the stream: follow them in the one page instead.
        await popup.wait_for_load_state("domcontentloaded")
        url = popup.url
        await popup.close()
        await page.goto(url)

    # Only tabs the streamed page opens; the hidden warm-up tab must not be treated as one.
    page.on("popup", lambda p: asyncio.create_task(on_popup(p)))

    cdp = await ctx.new_cdp_session(page)

    def on_frame(params: dict) -> None:
        asyncio.create_task(cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]}))
        last["frame"] = params["data"]
        broadcast({"type": "frame", "data": params["data"]})

    cdp.on("Page.screencastFrame", on_frame)
    await cdp.send(
        "Page.startScreencast",
        {"format": "jpeg", "quality": 60, "maxWidth": VIEWPORT["width"], "maxHeight": VIEWPORT["height"]},
    )
    asyncio.create_task(open_page(START_URL))
    _worker = asyncio.create_task(_input_worker())


async def stop() -> None:
    if _worker:
        _worker.cancel()
    if _chrome:
        await _chrome.close()
    if _pw:
        await _pw.stop()

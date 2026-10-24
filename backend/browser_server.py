"""Minimal real browser for Decoy's screen: one headless Chrome, streamed to the frontend.

No LLM yet: this opens pages, streams what Chrome shows, and lets a person drive it from the
screen (click, scroll, type, address bar, back/forward/reload).

Run from the repo root:   python backend/browser_server.py          (port 8001)
See it in the app:        http://localhost:5173/?mic&browser   (the ?browser flag connects)
Open a page:              curl -X POST "http://127.0.0.1:8001/browser/open?url=rbcroyalbank.com"

Speaks the protocol the frontend bridge already understands (src/events/browserBridge.ts):
every client on /browser/ws receives {"id", "type": frame|address|view|loading|caption|result|error, ...}.
Clients may also send {"id", "tool": "open_page", "args": {"url"}}, or a person's input:
{"type": "input", "action": click|move|wheel|type|key|navigate|back|forward|reload, ...}
with x/y in page pixels (1280x800).
"""

import asyncio
import contextlib
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from playwright.async_api import async_playwright

VIEWPORT = {"width": 1280, "height": 800}  # LiveScreen draws frames at this size
START_URL = "https://www.rbcroyalbank.com/"
SEND_TIMEOUT_S = 5  # a client that can't take a message this long is dropped
MAX_QUEUED_FRAMES = 2  # a slow client skips frames instead of falling behind

clients: dict[WebSocket, asyncio.Queue] = {}  # each client has its own outbox, so none can stall the rest
page = None
lock: asyncio.Lock | None = None
inputs: asyncio.Queue | None = None  # a person's clicks and keys, applied strictly in order
run_id = "live"  # the bridge shows one session per id; frames follow the latest run
last = {"address": "", "frame": None}


def broadcast(msg: dict) -> None:
    """Queue a message for every client. Never waits, so the browser can't be blocked by a client."""
    for ws, outbox in list(clients.items()):
        if msg["type"] == "frame" and outbox.qsize() > MAX_QUEUED_FRAMES:
            continue
        try:
            outbox.put_nowait({"id": run_id, **msg})
        except asyncio.QueueFull:
            clients.pop(ws, None)


async def sender(ws: WebSocket, outbox: asyncio.Queue) -> None:
    try:
        while True:
            await asyncio.wait_for(ws.send_json(await outbox.get()), SEND_TIMEOUT_S)
    except Exception:  # closed or stuck: stop sending to it
        clients.pop(ws, None)


async def open_page(url: str, rid: str = "live") -> dict:
    global run_id
    full = url if url.startswith(("http://", "https://")) else f"https://{url}"
    async with lock:
        run_id = rid
        broadcast({"type": "view", "mode": "screen"})
        broadcast({"type": "address", "text": full, "typing": False})
        broadcast({"type": "caption", "text": f"Opening {full}"})
        broadcast({"type": "loading", "on": True})
        try:
            await page.goto(full, timeout=15000, wait_until="domcontentloaded")
            await page.wait_for_timeout(800)
        except Exception as e:
            broadcast({"type": "error", "message": f"Couldn't load {full}: {e}"})
            return {"summary": f"Couldn't load {full}", "url": full, "error": True}
        finally:
            broadcast({"type": "loading", "on": False})
        result = {"summary": f"Opened {await page.title() or full}", "url": page.url}
        broadcast({"type": "result", "result": result})
        return result


opens = 0


def next_id() -> str:
    """A fresh id per run, so the screen's caption starts clean."""
    global opens
    opens += 1
    return f"open_{opens}"


async def handle_input(req: dict) -> None:
    """A person driving the browser from Decoy's screen."""
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


async def input_worker() -> None:
    # One at a time: typed letters must land before the Enter that follows them.
    while True:
        await handle_input(await inputs.get())


@asynccontextmanager
async def lifespan(_: FastAPI):
    global page, lock, inputs
    lock = asyncio.Lock()
    inputs = asyncio.Queue()
    pw = await async_playwright().start()
    # The installed Google Chrome, so no separate browser download is needed.
    browser = await pw.chromium.launch(channel="chrome", headless=True)
    ctx = await browser.new_context(viewport=VIEWPORT, locale="en-CA")
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

    ctx.on("page", lambda p: asyncio.create_task(on_popup(p)))

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
    worker = asyncio.create_task(input_worker())
    yield
    worker.cancel()
    await browser.close()
    await pw.stop()


app = FastAPI(lifespan=lifespan)


@app.websocket("/browser/ws")
async def browser_ws(ws: WebSocket) -> None:
    await ws.accept()
    outbox: asyncio.Queue = asyncio.Queue(maxsize=200)
    # A late joiner sees the current page right away instead of a blank screen.
    outbox.put_nowait({"id": run_id, "type": "view", "mode": "screen"})
    if last["address"]:
        outbox.put_nowait({"id": run_id, "type": "address", "text": last["address"], "typing": False})
    if last["frame"]:
        outbox.put_nowait({"id": run_id, "type": "frame", "data": last["frame"]})
    clients[ws] = outbox
    send_task = asyncio.create_task(sender(ws, outbox))
    try:
        while True:
            req = await ws.receive_json()
            if req.get("type") == "input":
                inputs.put_nowait(req)
            elif req.get("tool") == "open_page":
                asyncio.create_task(open_page(str(req.get("args", {}).get("url", "")), req.get("id", "live")))
            else:  # other tools come with the LLM later
                with contextlib.suppress(asyncio.QueueFull):
                    outbox.put_nowait({"id": req.get("id"), "type": "error", "message": f"Tool not supported yet: {req.get('tool')}"})
    except WebSocketDisconnect:
        pass
    finally:
        clients.pop(ws, None)
        send_task.cancel()


@app.post("/browser/open")
async def open_endpoint(url: str) -> dict:
    """Manual trigger for testing, until the LLM drives the browser."""
    return await open_page(url, next_id())


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)

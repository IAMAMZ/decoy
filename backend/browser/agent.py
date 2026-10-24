"""Real web browsing for Decoy's agent tools.

A single headless Chrome (via Playwright) does the work and streams its screen as JPEG
frames, plus cursor/caption events, through an `emit` callback. Search goes through the
Tavily API (an API built for agents); pages and domains are fetched for real.

Tools (same names/args as the dashboard events):
  web_search(query)            -> Tavily results, then opens the top result in Chrome
  open_page(url, find=None)    -> loads the page, finds + highlights `find` or the first 1-8xx number
  check_domain(domain)         -> RDAP registry lookup, then tries to open the site
"""

import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import Browser, Page, async_playwright

Emit = Callable[[dict], Awaitable[None]]

VIEWPORT = {"width": 1280, "height": 800}
PHONE_RE = r"1[-\s.]?8[0-9]{2}[-\s.]?[0-9]{3}[-\s.]?[0-9]{4}"
CURSOR_MOVE_S = 0.75  # matches the frontend cursor transition


class BrowserAgent:
    def __init__(self) -> None:
        self._pw = None
        self._browser: Browser | None = None
        self._page: Page | None = None
        self._emit: Emit | None = None
        self._lock = asyncio.Lock()  # one page, one task at a time

    async def start(self) -> None:
        self._pw = await async_playwright().start()
        # Uses the installed Google Chrome, so no separate browser download is needed.
        self._browser = await self._pw.chromium.launch(channel="chrome", headless=True)
        ctx = await self._browser.new_context(viewport=VIEWPORT, locale="en-CA")
        self._page = await ctx.new_page()
        cdp = await ctx.new_cdp_session(self._page)

        def on_frame(params: dict) -> None:
            asyncio.create_task(cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]}))
            if self._emit:
                asyncio.create_task(self._emit({"type": "frame", "data": params["data"]}))

        cdp.on("Page.screencastFrame", on_frame)
        await cdp.send(
            "Page.startScreencast",
            {"format": "jpeg", "quality": 60, "maxWidth": VIEWPORT["width"], "maxHeight": VIEWPORT["height"]},
        )

    async def stop(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def run(self, tool: str, args: dict, emit: Emit) -> dict:
        async with self._lock:
            self._emit = emit
            try:
                if tool == "web_search":
                    return await self._web_search(str(args["query"]))
                if tool == "open_page":
                    return await self._open_page(str(args["url"]), args.get("find"))
                if tool == "check_domain":
                    return await self._check_domain(str(args["domain"]))
                raise ValueError(f"unknown tool {tool}")
            finally:
                self._emit = None

    # ---------- helpers ----------

    async def _say(self, msg: dict) -> None:
        if self._emit:
            await self._emit(msg)

    async def _type_address(self, url: str) -> None:
        await self._say({"type": "cursor", "target": "address", "click": True})
        await asyncio.sleep(CURSOR_MOVE_S)
        for i in range(1, len(url) + 1, 2):
            await self._say({"type": "address", "text": url[:i], "typing": True})
            await asyncio.sleep(0.05)
        await self._say({"type": "address", "text": url, "typing": False})

    async def _goto(self, url: str) -> bool:
        await self._say({"type": "view", "mode": "screen"})
        await self._say({"type": "loading", "on": True})
        try:
            await self._page.goto(url, timeout=15000, wait_until="domcontentloaded")
            await self._page.wait_for_timeout(1200)
            return True
        except Exception:
            return False
        finally:
            await self._say({"type": "loading", "on": False})

    async def _point_at(self, box: dict | None, click: bool = False) -> None:
        if not box:
            return
        x = box["x"] + min(box["width"] * 0.3, 60)
        y = box["y"] + box["height"] / 2
        await self._say({"type": "cursor", "x": x, "y": y, "click": click})
        await self._page.mouse.move(x, y, steps=12)
        await asyncio.sleep(CURSOR_MOVE_S)

    async def _highlight(self, pattern: str) -> dict | None:
        """Wrap the first match of `pattern` in a highlight, scroll to it, return text + box."""
        return await self._page.evaluate(
            """(pattern) => {
              const re = new RegExp(pattern);
              const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walk.nextNode())) {
                const el = node.parentElement;
                if (!el || !el.getClientRects().length) continue;
                const m = node.textContent.match(re);
                if (!m) continue;
                const range = document.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                const mark = document.createElement('mark');
                mark.style.cssText = 'background:rgba(255,91,55,.22);outline:3px solid #ff5b37;border-radius:3px;color:inherit;padding:0 2px';
                range.surroundContents(mark);
                mark.scrollIntoView({block: 'center'});
                const r = mark.getBoundingClientRect();
                const ctx = (el.closest('p,li,div,section') || el).innerText.replace(/\\s+/g, ' ').trim();
                return {text: m[0], context: ctx.slice(0, 280), box: {x: r.x, y: r.y, width: r.width, height: r.height}};
              }
              return null;
            }""",
            pattern,
        )

    # ---------- tools ----------

    async def _web_search(self, query: str) -> dict:
        key = os.environ.get("TAVILY_API_KEY")
        if not key:
            raise RuntimeError("Search needs TAVILY_API_KEY in .env (free key at tavily.com)")

        await self._say({"type": "address", "text": "search", "typing": False})
        await self._say({"type": "view", "mode": "search", "query": query, "typed": "", "results": None})
        await self._say({"type": "caption", "text": f"Searching the web for {query}"})
        await self._say({"type": "cursor", "target": "search-box", "click": True})
        await asyncio.sleep(CURSOR_MOVE_S)
        for i in range(1, len(query) + 1, 2):
            await self._say({"type": "view", "mode": "search", "query": query, "typed": query[:i], "results": None})
            await asyncio.sleep(0.05)
        await self._say({"type": "view", "mode": "search", "query": query, "typed": query, "results": None})
        await self._say({"type": "loading", "on": True})

        body = json.dumps({"query": query, "max_results": 4}).encode()
        req = urllib.request.Request(
            "https://api.tavily.com/search",
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        )
        data = await asyncio.to_thread(lambda: json.load(urllib.request.urlopen(req, timeout=20)))
        results = [
            {"title": r["title"], "url": r["url"], "snippet": (r.get("content") or "")[:220]}
            for r in data.get("results", [])
        ]
        await self._say({"type": "loading", "on": False})
        await self._say({"type": "address", "text": f"search?q={query}", "typing": False})
        await self._say({"type": "view", "mode": "search", "query": query, "typed": query, "results": results})
        if not results:
            return {"summary": "No results found", "results": []}

        top = results[0]
        await asyncio.sleep(0.8)
        await self._say({"type": "cursor", "target": "result-0", "click": True})
        await asyncio.sleep(CURSOR_MOVE_S + 0.3)
        await self._say({"type": "caption", "text": f"Reading {urlparse(top['url']).netloc}"})
        await self._type_address(top["url"])
        if await self._goto(top["url"]):
            await self._page.mouse.wheel(0, 500)
            await asyncio.sleep(1.5)
        return {"summary": f"{len(results)} results · top: {top['title']}", "results": results}

    async def _open_page(self, url: str, find: str | None) -> dict:
        full = url if url.startswith("http") else f"https://{url}"
        await self._say({"type": "caption", "text": f"Opening {urlparse(full).netloc}"})
        await self._type_address(full)
        if not await self._goto(full):
            return {"summary": f"Couldn't load {full}", "url": full}
        title = await self._page.title()
        await self._say({"type": "caption", "text": "Looking for the official phone number"})
        pattern = re.escape(find) if find else PHONE_RE
        hit = await self._highlight(pattern)
        # Sites often tuck phone numbers behind a "Call us" or "Contact" control: open it like a person would.
        for label in ("call us", "contact"):
            if hit:
                break
            for role in ("button", "link"):
                el = self._page.get_by_role(role, name=re.compile(label, re.I)).filter(visible=True)
                if not await el.count():
                    continue
                el = el.first
                if role == "link" and (await el.get_attribute("href") or "").rstrip("/") == self._page.url.rstrip("/"):
                    continue  # links back to this same page
                await self._say({"type": "caption", "text": f"Clicking “{label.title()}”"})
                await el.scroll_into_view_if_needed()
                await asyncio.sleep(0.4)
                await self._point_at(await el.bounding_box(), click=True)
                await el.click()
                await self._page.wait_for_timeout(1500)
                hit = await self._highlight(pattern)
                break
        await asyncio.sleep(0.6)
        if not hit:
            return {"summary": f"No phone number found on {urlparse(full).netloc}", "title": title, "url": full}
        await self._point_at(hit["box"], click=True)
        await asyncio.sleep(1.2)
        return {
            "summary": f"Official number on {urlparse(full).netloc}: {hit['text']}",
            "title": title,
            "url": full,
            "excerpt": hit["context"],
            "highlight": hit["text"],
        }

    async def _check_domain(self, domain: str) -> dict:
        await self._say({"type": "caption", "text": f"Checking who registered {domain}"})
        rdap = await asyncio.to_thread(_rdap, domain)
        await self._say({"type": "card", "kind": "whois", "data": rdap})
        await asyncio.sleep(1.5)

        await self._say({"type": "caption", "text": f"Trying to open {domain}"})
        await self._type_address(f"http://{domain}")
        reachable = await self._goto(f"http://{domain}")
        await asyncio.sleep(1.5)

        if not rdap["registered"]:
            summary = f"{domain} isn't registered: the link the caller gave doesn't exist"
        elif rdap.get("age_days") is not None and rdap["age_days"] < 90:
            summary = f"{domain} was registered {rdap['age_days']} days ago"
        else:
            summary = f"{domain} registered {rdap.get('registered_on', 'unknown date')}"
        return {**rdap, "reachable": reachable, "summary": summary}


def _rdap(domain: str) -> dict:
    """Registry lookup over RDAP (the official successor to WHOIS)."""
    try:
        with urllib.request.urlopen(f"https://rdap.org/domain/{domain}", timeout=15) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"domain": domain, "registered": False}
        raise
    events = {e["eventAction"]: e["eventDate"] for e in d.get("events", [])}
    reg = events.get("registration")
    out: dict[str, Any] = {"domain": domain, "registered": True}
    if reg:
        when = datetime.fromisoformat(reg.replace("Z", "+00:00"))
        out["registered_on"] = when.date().isoformat()
        out["age_days"] = (datetime.now(UTC) - when).days
    for ent in d.get("entities", []):
        if "registrar" in ent.get("roles", []):
            for field in ent.get("vcardArray", [None, []])[1]:
                if field[0] == "fn":
                    out["registrar"] = field[3]
    return out

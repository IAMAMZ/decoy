"""Generic browser tools: no knowledge of any bank or company. An agent decides what to open and look for.

Every tool takes (args, rid) and returns {"ok", "summary", ...}; `rid` ties its run on Decoy's screen
to the dashboard's tool_call id. Pages are read as text so a model can reason over them; nothing is
ever typed into a form or submitted.
"""

import asyncio
import json
import os
import re
import urllib.request

import browser

from . import rdap

TEXT_LIMIT = 3000  # characters of page text handed back to the model
LINK_LIMIT = 40
NEW_DOMAIN_DAYS = 90

READ_JS = """(limit) => {
  const text = (document.body?.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const seen = new Set();
  const links = [...document.querySelectorAll('a[href]')]
    .filter(a => a.getClientRects().length && a.innerText.trim())
    .map(a => ({text: a.innerText.trim().replace(/\\s+/g, ' ').slice(0, 80), href: a.href}))
    .filter(l => l.href.startsWith('http') && !seen.has(l.href) && seen.add(l.href))
    .slice(0, limit);
  return {text, links};
}"""


def _literal(text: str) -> str:
    """A JS-safe regex that matches `text` literally."""
    return re.sub(r"([.*+?^${}()|\[\]\\/])", r"\\\1", text)


def _domain(url: str) -> str:
    host = re.sub(r"^[a-z]+://", "", url.strip().lower()).split("/")[0].split(":")[0]
    return host.removeprefix("www.")


async def _page_info() -> dict:
    info = await browser.page.evaluate(READ_JS, LINK_LIMIT)
    return {"title": await browser.page.title(), "url": browser.page.url, **info}


async def open_page(args: dict, rid: str) -> dict:
    url = browser.full_url(str(args["url"]))
    async with browser.session(rid):
        browser.say(f"Opening {_domain(url)}")
        if not await browser.navigate(url):
            result = {"ok": False, "summary": f"Couldn't load {url}", "url": url}
        else:
            info = await _page_info()
            result = {
                "ok": True,
                "summary": f"Opened {info['title'] or info['url']}",
                "title": info["title"],
                "url": info["url"],
                "text": info["text"][:TEXT_LIMIT],
            }
    browser.finish(rid, result)
    return result


async def read_page(args: dict, rid: str) -> dict:
    async with browser.session(rid):
        browser.say("Reading the page")
        info = await _page_info()
    start = int(args.get("offset") or 0)
    result = {
        "ok": True,
        "summary": f"Read {info['title'] or info['url']}",
        "title": info["title"],
        "url": info["url"],
        "text": info["text"][start : start + TEXT_LIMIT],
        "more_text": len(info["text"]) > start + TEXT_LIMIT,
        "links": info["links"],
    }
    browser.finish(rid, result)
    return result


async def find_on_page(args: dict, rid: str) -> dict:
    text, pattern = args.get("text"), args.get("pattern")
    if not text and not pattern:
        result = {"ok": False, "summary": "Give text or a pattern to look for"}
        browser.finish(rid, result)
        return result
    async with browser.session(rid):
        browser.say(f"Looking for “{text or pattern}”")
        hit = await browser.find(_literal(str(text)) if text else str(pattern))
    if not hit:
        result = {"ok": True, "found": False, "summary": f"“{text or pattern}” isn't on {_domain(browser.page.url)}"}
    else:
        result = {
            "ok": True,
            "found": True,
            "match": hit["text"],
            "context": hit["context"],
            "url": browser.page.url,
            "summary": f"Found “{hit['text']}” on {_domain(browser.page.url)}",
        }
    browser.finish(rid, result)
    return result


async def click(args: dict, rid: str) -> dict:
    label = str(args["text"])
    name = re.compile(re.escape(label), re.I)
    async with browser.session(rid):
        browser.say(f"Clicking “{label}”")
        target = None
        for role in ("link", "button", "tab", "menuitem"):
            loc = browser.page.get_by_role(role, name=name).filter(visible=True)
            if await loc.count():
                target = loc.first
                break
        if not target:
            result = {"ok": True, "clicked": False, "summary": f"No “{label}” link or button on this page"}
        else:
            await target.scroll_into_view_if_needed()
            box = await target.bounding_box()
            if box:
                browser.broadcast({"type": "cursor", "x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2, "click": True})
                await asyncio.sleep(browser.CURSOR_MOVE_S)
            await target.click()
            await browser.page.wait_for_timeout(1500)
            info = await _page_info()
            result = {
                "ok": True,
                "clicked": True,
                "summary": f"Clicked “{label}” → {info['title'] or info['url']}",
                "title": info["title"],
                "url": info["url"],
                "text": info["text"][:TEXT_LIMIT],
            }
    browser.finish(rid, result)
    return result


async def check_domain(args: dict, rid: str) -> dict:
    domain = _domain(str(args["domain"]))
    if not domain:
        result = {"ok": False, "summary": "No domain given"}
        browser.finish(rid, result)
        return result
    async with browser.session(rid):
        browser.say(f"Checking who registered {domain}")
        try:
            info = await asyncio.to_thread(rdap.lookup, domain)
            browser.broadcast({"type": "card", "kind": "whois", "data": info})
        except Exception:
            info = {"domain": domain, "registered": None}  # registry unreachable
        await asyncio.sleep(1.5)
        browser.say(f"Trying to open {domain}")
        reachable = await browser.navigate(f"https://{domain}")
        title = await browser.page.title() if reachable else ""
    if info["registered"] is False:
        summary = f"{domain} isn't registered: the site doesn't exist"
    elif info.get("age_days") is not None and info["age_days"] < NEW_DOMAIN_DAYS:
        summary = f"{domain} was registered only {info['age_days']} days ago"
    elif info.get("registered_on"):
        summary = f"{domain} registered {info['registered_on']}" + (f" to {info['registrar']}" if info.get("registrar") else "")
    else:
        summary = f"{domain}: registration unknown"
    result = {"ok": True, "summary": summary, "reachable": reachable, "title": title, **info}
    browser.finish(rid, result)
    return result


async def web_search(args: dict, rid: str) -> dict:
    """Search through Tavily (search engines block automated browsers). Needs TAVILY_API_KEY in backend/.env."""
    query = str(args["query"])
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        result = {"ok": False, "summary": "Web search isn't set up (no TAVILY_API_KEY); open a site you know instead"}
        browser.finish(rid, result)
        return result
    async with browser.session(rid):
        browser.say(f"Searching the web for {query}")
        browser.broadcast({"type": "address", "text": "search", "typing": False})
        browser.broadcast({"type": "view", "mode": "search", "query": query, "typed": query, "results": None})
        browser.broadcast({"type": "loading", "on": True})
        req = urllib.request.Request(
            "https://api.tavily.com/search",
            data=json.dumps({"query": query, "max_results": 5}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        )
        try:
            data = await asyncio.to_thread(lambda: json.load(urllib.request.urlopen(req, timeout=20)))
        finally:
            browser.broadcast({"type": "loading", "on": False})
        results = [
            {"title": r["title"], "url": r["url"], "snippet": (r.get("content") or "")[:220]} for r in data.get("results", [])
        ]
        browser.broadcast({"type": "view", "mode": "search", "query": query, "typed": query, "results": results})
    result = {"ok": True, "summary": f"{len(results)} results for {query}", "results": results}
    browser.finish(rid, result)
    return result

"""Decoy's screen: the live stream, a person's input, and a manual way to open a page."""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import browser

router = APIRouter(prefix="/browser")


@router.websocket("/ws")
async def browser_ws(ws: WebSocket) -> None:
    """Streams the screen to every client. Clients may send a person's input
    {"type": "input", "action": click|move|wheel|type|key|navigate|back|forward|reload, ...}
    (x/y in page pixels, 1280x720) or {"id", "tool": "open_page", "args": {"url"}}."""
    await ws.accept()
    task = browser.add_client(ws)
    try:
        while True:
            req = await ws.receive_json()
            if req.get("type") == "input":
                browser.inputs.put_nowait(req)
            elif req.get("tool") == "open_page":
                asyncio.create_task(browser.open_page(str(req.get("args", {}).get("url", "")), req.get("id", "live")))
            else:  # checks go through /browser/tools
                browser.send_to(ws, {"id": req.get("id"), "type": "error", "message": f"Unknown tool: {req.get('tool')}"})
    except WebSocketDisconnect:
        pass
    finally:
        browser.remove_client(ws, task)


@router.post("/open")
async def open_endpoint(url: str) -> dict:
    """Manual trigger for testing: curl -X POST "http://127.0.0.1:8001/browser/open?url=example.com"."""
    return await browser.open_page(url, browser.next_id())

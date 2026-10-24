"""Call the browser service from the agent backend.

    from backend.browser.client import browse
    result = await browse("t7", "open_page", {"url": "www.rbcroyalbank.com/customer-service/index.html"})
    result["summary"]  # -> "Official number on www.rbcroyalbank.com: 1-800-769-2511"

Use the same id as the tool_call event you emit, so the dashboard shows this run on
Decoy's screen. Raises RuntimeError if the tool failed (e.g. no TAVILY_API_KEY).
"""
import asyncio
import json

import websockets

URL = "ws://127.0.0.1:8001/browser/ws"


async def browse(call_id: str, tool: str, args: dict, timeout: float = 60) -> dict:
    async with websockets.connect(URL, max_size=None, open_timeout=5) as ws:
        await ws.send(json.dumps({"id": call_id, "tool": tool, "args": args}))
        async with asyncio.timeout(timeout):
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("id") != call_id:
                    continue
                if msg["type"] == "result":
                    return msg["result"]
                if msg["type"] == "error":
                    raise RuntimeError(msg["message"])
    raise RuntimeError("browser service closed the connection")

"""WebSocket service that runs real browsing for the dashboard.

Run from the repo root:  python -m backend.browser.server   (port 8001)

Any client can send   {"id", "tool", "args"}.
Every connected client receives the stream, so the dashboard can watch a run that the
agent backend started:
  {"id", "type": frame|cursor|address|view|loading|caption|card, ...}
and finally {"id", "type": "result", "result"} or {"id", "type": "error", "message"}.
"""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .agent import BrowserAgent

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
agent = BrowserAgent()
clients: set[WebSocket] = set()


async def broadcast(msg: dict) -> None:
    for ws in list(clients):
        try:
            await ws.send_json(msg)
        except Exception:
            clients.discard(ws)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await agent.start()
    yield
    await agent.stop()


app = FastAPI(lifespan=lifespan)


async def handle(req: dict) -> None:
    rid = req["id"]

    async def emit(msg: dict) -> None:
        await broadcast({"id": rid, **msg})

    try:
        result = await agent.run(req["tool"], req.get("args", {}), emit)
        await emit({"type": "result", "result": result})
    except Exception as e:  # report to the clients instead of dropping the socket
        await emit({"type": "error", "message": str(e)})


@app.websocket("/browser/ws")
async def browser_ws(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            asyncio.create_task(handle(await ws.receive_json()))
    except WebSocketDisconnect:
        clients.discard(ws)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)

"""Decoy's backend: one real Chrome for Decoy's screen, and the checks the agent runs on it.

Run from the repo root:   python backend/server.py   (port 8001)

  browser.py   Chrome, the stream to the screen, page primitives
  routes/      HTTP and WebSocket: /browser/ws, /browser/open, /browser/tools
  tools/       the checks (RBC demo), registered in tools/__init__.py
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

import browser
from routes import browser as browser_routes
from routes import tools as tool_routes


@asynccontextmanager
async def lifespan(_: FastAPI):
    await browser.start()
    yield
    await browser.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(browser_routes.router)
app.include_router(tool_routes.router)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)

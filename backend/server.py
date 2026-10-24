"""Decoy's backend: one real Chrome for Decoy's screen, and the checks the agent runs on it.

Run from the repo root:   python backend/server.py   (port 8001)

  browser.py   Chrome, the stream to the screen, page primitives
  routes/      HTTP and WebSocket: /browser/ws, /browser/open, /browser/tools
  tools/       generic browser tools, registered in tools/__init__.py
"""

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse

import browser
from routes import boson as boson_routes
from routes import browser as browser_routes
from routes import tools as tool_routes
from tools import warm_urls


@asynccontextmanager
async def lifespan(_: FastAPI):
    await browser.start()
    asyncio.create_task(browser.warm(warm_urls()))  # in the background: the server is usable right away
    yield
    await browser.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(browser_routes.router)
app.include_router(tool_routes.router)
app.include_router(boson_routes.router)

# Deployed (Cloud Run): this server also serves the built page, so one origin has everything.
# Locally `npm run dev` serves the page and dist/ is usually absent.
DIST = (Path(__file__).parent.parent / "dist").resolve()
if DIST.is_dir():

    @app.get("/{path:path}")
    async def page(path: str) -> FileResponse:
        f = (DIST / path).resolve()
        # /dashboard, /call ... are client-side pages: anything that isn't a built file gets index.html
        return FileResponse(f if f.is_file() and f.is_relative_to(DIST) else DIST / "index.html")


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 8001)))

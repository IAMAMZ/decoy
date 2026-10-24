"""/api/boson/* -> api.boson.ai/v1/*, with the key added here so it never reaches the page."""

import os

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(prefix="/api/boson")

API = "https://api.boson.ai/v1"
# Only what the page uses: Realtime client secrets and voice clones. Not an open proxy for the key.
ALLOWED = {"realtime/client_secrets", "audio/voices"}


@router.post("/{path:path}")
async def boson(path: str, request: Request) -> Response:
    key = os.environ.get("BOSON_API_KEY")
    if not key:
        raise HTTPException(503, "Set BOSON_API_KEY on the server")
    if path not in ALLOWED:
        raise HTTPException(404, f"Not proxied: {path}")
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{API}/{path}",
            content=await request.body(),
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
    return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))

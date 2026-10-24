"""HTTP for the checks: list them, call one. Business logic lives in tools/, not here.

GET  /browser/tools          -> [{"name", "description", "parameters"}]   (function-calling schemas)
POST /browser/tools/{name}   {"id"?: "t3", "args": {...}}
  200 {"id", "ok": true, "verdict", "summary", ...}   the check ran (any verdict)
  200 {"id", "ok": false, "summary", "error"?}        the check couldn't finish (site down, timeout)
  400 missing argument · 404 unknown tool
"""

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import browser
from tools import REGISTRY

TOOL_TIMEOUT_S = 30

router = APIRouter(prefix="/browser/tools")


class ToolRequest(BaseModel):
    id: str | None = None  # use the dashboard's tool_call id so Decoy's screen shows this run
    args: dict = {}


@router.get("")
async def list_tools() -> list[dict]:
    return [t.schema() for t in REGISTRY.values()]


@router.post("/{name}")
async def call_tool(name: str, req: ToolRequest) -> dict:
    tool = REGISTRY.get(name)
    if not tool:
        raise HTTPException(404, f"Unknown tool: {name}")
    missing = [p for p in tool.required if req.args.get(p) in (None, "")]
    if missing:
        raise HTTPException(400, f"Missing argument: {', '.join(missing)}")
    rid = req.id or browser.next_id()
    try:
        result = await asyncio.wait_for(tool.fn(req.args, rid), TOOL_TIMEOUT_S)
    except asyncio.TimeoutError:
        result = {"ok": False, "summary": f"{name} took longer than {TOOL_TIMEOUT_S} s", "error": "timeout"}
        browser.finish(rid, result)
    except Exception as e:
        result = {"ok": False, "summary": f"{name} failed", "error": str(e)}
        browser.finish(rid, result)
    return {"id": rid, **result}

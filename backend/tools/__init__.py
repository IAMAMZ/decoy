"""Tool registry. Add a tool: write its function, then add one Tool(...) here; the routes pick it up.

Each tool is `async fn(args: dict, rid: str) -> dict` returning {"ok", "verdict", "summary", ...}.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from . import rbc


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    params: dict  # JSON Schema properties
    required: tuple[str, ...]
    fn: Callable[[dict, str], Awaitable[dict]]

    def schema(self) -> dict:
        """OpenAI-style function definition, usable for function calling or an MCP wrapper."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {"type": "object", "properties": self.params, "required": list(self.required)},
        }


REGISTRY = {
    t.name: t
    for t in [
        Tool(
            "verify_caller_number",
            "Check whether the caller's phone number is RBC's official number, by finding the official number on rbc.com.",
            {"number": {"type": "string", "description": "The caller's number, e.g. +1 (647) 555-0199"}},
            ("number",),
            rbc.verify_caller_number,
        ),
        Tool(
            "check_bank_policy",
            "Find RBC's own statement that it never asks for what the caller is asking (a transfer to a 'safe account', "
            "a one-time code, a PIN, remote access, account details).",
            {"claim": {"type": "string", "description": "What the caller asked for, e.g. 'move your money to a safe account'"}},
            ("claim",),
            rbc.check_bank_policy,
        ),
        Tool(
            "check_link",
            "Check a link the caller gave: is it an RBC domain, is it registered and how old, and does it open.",
            {"url": {"type": "string", "description": "The link or domain, e.g. rbc-secure-verify.com"}},
            ("url",),
            rbc.check_link,
        ),
    ]
}

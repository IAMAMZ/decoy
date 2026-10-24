"""Tool registry. Add a tool: write its function, then add one Tool(...) here; the routes pick it up.

Each tool is `async fn(args: dict, rid: str) -> dict` returning {"ok", "summary", ...}. These are
generic browser tools: the agent (an LLM) decides which pages to open and what to look for.

If a tool always opens the same fixed pages, list them in `warm=`: the backend loads them once in a
hidden tab at startup, so the first call doesn't pay for a cold load.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from . import web


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    params: dict  # JSON Schema properties
    required: tuple[str, ...]
    fn: Callable[[dict, str], Awaitable[dict]]
    warm: tuple[str, ...] = ()  # fixed pages this tool opens, loaded once at startup

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
            "open_page",
            "Open a web page in the real browser and get its title and visible text.",
            {"url": {"type": "string", "description": "Full URL or domain, e.g. example.com/contact"}},
            ("url",),
            web.open_page,
        ),
        Tool(
            "read_page",
            "Read the current page: its visible text (from an offset, for long pages) and the links on it.",
            {"offset": {"type": "integer", "description": "Character offset into the page text, 0 to start"}},
            (),
            web.read_page,
        ),
        Tool(
            "find_on_page",
            "Find and highlight text on the current page; returns the match and the sentence around it. "
            "Use this to show the evidence on screen.",
            {
                "text": {"type": "string", "description": "Exact words to find"},
                "pattern": {"type": "string", "description": "Or a regular expression, e.g. for a phone number"},
            },
            (),
            web.find_on_page,
        ),
        Tool(
            "click",
            "Click a link or button on the current page by its visible label, e.g. 'Contact us'.",
            {"text": {"type": "string", "description": "The link or button's visible label"}},
            ("text",),
            web.click,
        ),
        Tool(
            "check_domain",
            "Look up a domain's registration (registered? when? registrar?) and try to open it.",
            {"domain": {"type": "string", "description": "A domain or link, e.g. secure-verify-login.com"}},
            ("domain",),
            web.check_domain,
        ),
        Tool(
            "web_search",
            "Search the web (only if the backend has a search key). Prefer opening an official site you already know.",
            {"query": {"type": "string", "description": "Search query"}},
            ("query",),
            web.web_search,
        ),
    ]
}


def warm_urls() -> list[str]:
    """Every fixed page the tools open, each once."""
    return list(dict.fromkeys(url for t in REGISTRY.values() for url in t.warm))

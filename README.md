# Decoy

An AI fraud interceptor: a live call on one laptop (push-to-talk, Higgs Realtime), a bank fraud dashboard, and Decoy's screen, a real Chrome browser streamed into the app that a person (and later the agent) can drive.

## What runs where

| Part | Where | Port |
| --- | --- | --- |
| Frontend (React + Vite): stage, dashboard, phone screens, voice loop | `src/` | 5173 |
| Browser backend (Playwright + FastAPI): one headless Chrome streamed to Decoy's screen, and the fraud checks that run on it | `backend/` | 8001 |

The voice call talks to Boson straight from the browser, so it needs no backend. The browser backend is for Decoy's screen and its checks.

## Setup (once)

Needs Node 18+, Python 3.10+ and Google Chrome installed (Playwright drives your installed Chrome, so there is no separate browser download).

```bash
cp .env.example .env.local                 # put your Boson key in VITE_BOSON_API_KEY
npm install
pip install -r backend/requirements.txt
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`, and `npm.cmd` instead of `npm` if scripts are blocked.

## Run

Two terminals, both in the repo root:

```bash
python backend/server.py   # browser backend, ready when it prints "Uvicorn running on http://127.0.0.1:8001"
npm run dev                # frontend
```

Then open **http://localhost:5173/?mic&browser** in Chrome.

| URL flag | Does |
| --- | --- |
| `?mic` | Live call with your mic (push-to-talk). Without it, the scripted replay of `src/data/fake_events.json` plays. |
| `&browser` | Connect Decoy's screen to the browser backend. Without it, Decoy's screen plays a scripted animation. |

Check it's connected: Decoy's screen says **"live · real Chrome"** in its top-right corner. If it says "agent web tools", the backend isn't running or `&browser` is missing.

## Using it

**Call** (`?mic`): press **Enter** to start, hold **Space** to talk as the scammer, hold **Y** to talk as Margaret, **Shift+T** forces the takeover, **Esc** ends the call.

**Decoy's screen** (`&browser`): it works like a normal browser.

- Type a URL in the address bar and press Enter.
- Click, double-click, hover and scroll on the page.
- Click into a page, then type; Enter, Backspace, arrows, Tab and Ctrl shortcuts work. Typing there doesn't trigger push-to-talk.
- ← → ↻ for back, forward and reload.

Before the call starts, the "Start call" card covers the page; start the call to use the browser.

Open a page from a script or terminal (for testing, until the agent drives the browser):

```bash
curl -X POST "http://127.0.0.1:8001/browser/open?url=rbcroyalbank.com/customer-service/index.html"
```

## Fraud checks (tools)

Three checks for the RBC impersonation demo. Each runs on the real browser, so Decoy's screen shows it opening the page and highlighting the evidence.

| Tool | Args | What it does | Verdicts |
| --- | --- | --- | --- |
| `verify_caller_number` | `number` | Finds RBC's official number on rbc.com's fraud page and compares it with the caller's | `match`, `mismatch` |
| `check_bank_policy` | `claim` (what the caller asked for) | Finds RBC's own "RBC will never ask you to…" line for it: e-Transfer / safe account, one-time code, remote access, PIN, password, confirming account details | `against_rbc_policy`, `no_policy_found` |
| `check_link` | `url` | Is it an RBC domain, is it registered and how old (RDAP), does it open | `official`, `not_registered`, `new_domain`, `lookalike`, `not_rbc` |

Call them over HTTP. From the frontend use the same-origin path `/browser/tools/...` (Vite proxies it):

```bash
curl http://127.0.0.1:8001/browser/tools          # list the tools as function-calling schemas
curl -X POST http://127.0.0.1:8001/browser/tools/verify_caller_number \
  -H "Content-Type: application/json" \
  -d '{"id": "t3", "args": {"number": "+1 (647) 555-0199"}}'
```

```json
{"id": "t3", "ok": true, "verdict": "mismatch",
 "summary": "+1 (647) 555-0199 is not RBC's official number (1-800-769-2511)",
 "official": "1-800-769-2511", "excerpt": "...", "source": "https://www.rbc.com/cyber-security/how-rbc-keeps-you-safe/index.html"}
```

- `id` is optional. Pass the dashboard's `tool_call` id so Decoy's screen shows this run under the same id.
- `ok: false` means the check couldn't finish (site down, 30 s timeout); it still returns 200 with a `summary`. Bad calls get 400 (missing argument) or 404 (unknown tool).
- The caller of the tool (the agent / orchestrator) injects the `tool_call` started/done events for the dashboard.
- The RBC pages and wording were checked on Oct 24, 2026; they're constants at the top of `backend/tools/rbc.py`.

## Backend layout

```
backend/
├─ server.py        entry point: FastAPI app on port 8001
├─ browser.py       Chrome, the stream to Decoy's screen, page primitives (navigate, find + highlight), a person's input
├─ routes/
│  ├─ browser.py    /browser/ws (stream + input), /browser/open
│  └─ tools.py      GET /browser/tools, POST /browser/tools/{name}
└─ tools/
   ├─ __init__.py   REGISTRY: add a tool here and the routes pick it up
   ├─ rbc.py        the three RBC checks
   └─ rdap.py       domain registration lookup
```

## Browser stream protocol

Clients connect to `ws://127.0.0.1:8001/browser/ws` (the Vite dev server proxies `/browser` to it).

- **Server → clients:** `{"id", "type": frame|address|view|loading|caption|cursor|card|result|error, ...}`, the format `src/events/browserBridge.ts` reads. Frames are base64 JPEG at 1280×800.
- **Client → server, a person's input:** `{"type": "input", "action": click|move|wheel|type|key|navigate|back|forward|reload, ...}` with `x`/`y` in page pixels (1280×800).
- **Client → server:** `{"id", "tool": "open_page", "args": {"url"}}` opens a page. Fraud checks go through `/browser/tools`.

Not built yet: the LLM that decides when to run the checks, and the replay mode's browse steps (use `?mic&browser`, not `?browser` alone).

## More

- `HANDOFF.md`: team handoff, voice loop details, who owns what.
- `fraud-interceptor-brief.md`: the original build brief.

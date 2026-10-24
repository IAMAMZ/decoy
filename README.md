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

**Decoy's screen** (`&browser`): it starts on Decoy's own standby page (`decoy://standby`, `backend/standby.html`) and only goes to a bank's site when a check runs. Otherwise it works like a normal browser.

- Type a URL in the address bar and press Enter.
- Click, double-click, hover and scroll on the page.
- Click into a page, then type; Enter, Backspace, arrows, Tab and Ctrl shortcuts work. Typing there doesn't trigger push-to-talk.
- ← → ↻ for back, forward and reload.

Before the call starts, the "Start call" card covers the page; start the call to use the browser.

Cookie banners are hidden in Decoy's Chrome, not clicked: no consent is given or refused. Many banners have no reject option (their X means accepting all cookies), and they cover the bottom of the screen. The list of hidden banner containers is `COOKIE_BANNERS` in `backend/browser.py`.

Open a page from a script or terminal (for testing):

```bash
curl -X POST "http://127.0.0.1:8001/browser/open?url=example.com"
```

## How Decoy checks a caller's claims

Nothing in the code knows about any bank. When the caller names an organisation, asks for something, or gives a link, the agent hands a plain-language task to the **Higgs investigator** (`src/agent/investigator.ts`): a second, text-only Higgs Realtime session with the generic browser tools below. It decides what to open, reads, clicks and highlights the evidence, then calls `report` with a verdict:

| When | Task | Verdicts |
| --- | --- | --- |
| The caller first names who they claim to be | Find that organisation's official number on its official site and compare it with the caller ID | `confirmed`, `contradicted`, `inconclusive` |
| The caller asks for a safe-account transfer, payment, remote access or gift cards | Find the organisation's own guidance on whether it would ever ask that | same |
| The caller gives a link | Check the domain's registration and whether it's the organisation's official site | same |

On the dashboard each task is an `investigate` call, with every browser step it took (`web.open_page`, `web.click`, `web.find_on_page`, …) listed underneath; Decoy's screen shows each step live. Tested with a TD Bank scam call: it opened tdbank.com, clicked "Protect against fraud", highlighted TD's fraud line and reported the caller's number as contradicted, in 4 steps and about 10 s.

## Browser tools

| Tool | Args | What it does |
| --- | --- | --- |
| `open_page` | `url` | Open a page; returns its title and visible text |
| `read_page` | `offset` | The current page's text (from an offset) and its links |
| `find_on_page` | `text` or `pattern` | Highlight the first visible match on screen; returns it and the sentence around it |
| `click` | `text` | Click a link or button by its visible label |
| `check_domain` | `domain` | Registration (RDAP: registered? when? registrar?), then try to open it |
| `web_search` | `query` | Tavily search, only if `TAVILY_API_KEY` is set in `backend/.env` |

Call them over HTTP. From the frontend use the same-origin path `/browser/tools/...` (Vite proxies it):

```bash
curl http://127.0.0.1:8001/browser/tools          # list the tools as function-calling schemas
curl -X POST http://127.0.0.1:8001/browser/tools/find_on_page   -H "Content-Type: application/json"   -d '{"id": "t3", "args": {"text": "never ask"}}'
```

- `id` is optional. Pass the dashboard's `tool_call` id so Decoy's screen shows this run under the same id.
- `ok: false` means the tool couldn't finish (site down, 30 s timeout); it still returns 200 with a `summary`. Bad calls get 400 (missing argument) or 404 (unknown tool).
- The tools never log in, type into forms or submit anything.

## Backend layout

```
backend/
├─ server.py        entry point: FastAPI app on port 8001
├─ browser.py       Chrome, the stream to Decoy's screen, page primitives (navigate, find + highlight), a person's input
├─ standby.html     the start page (decoy://standby)
├─ routes/
│  ├─ browser.py    /browser/ws (stream + input), /browser/open
│  └─ tools.py      GET /browser/tools, POST /browser/tools/{name}
└─ tools/
   ├─ __init__.py   REGISTRY: add a tool here and the routes pick it up
   ├─ web.py        the generic browser tools
   └─ rdap.py       domain registration lookup
```

### Adding a browser tool

1. **Backend:** write `async def my_check(args, rid) -> dict` in `backend/tools/`, then add a `Tool(...)` to `REGISTRY` in `backend/tools/__init__.py`. It's served at `POST /browser/tools/my_check` with no route changes.
2. **Warm its pages:** if the tool opens fixed pages, list them in the Tool's `warm=(...)`. At startup the backend loads them once in a hidden tab, so the first check during a call doesn't pay for a cold page load. Pages that come from the call (a link the caller gives) can't be warmed.
3. **Frontend:** nothing to register: the investigator reads the tool list from `GET /browser/tools` when it starts. Add a label for `web.my_check` to `TOOL_LABEL` in `src/components/format.ts` so the dashboard names it nicely.

The screen's page size (1280×720) lives in three places that must match: `VIEWPORT` in `backend/browser.py`, `PAGE_W`/`PAGE_H` in `src/components/LiveScreen.tsx`, and the `.as-shot` aspect-ratio in `src/styles.css`.

## Browser stream protocol

Clients connect to `ws://127.0.0.1:8001/browser/ws` (the Vite dev server proxies `/browser` to it).

- **Server → clients:** `{"id", "type": frame|address|view|loading|caption|cursor|card|result|error, ...}`, the format `src/events/browserBridge.ts` reads. Frames are base64 JPEG at 1280×720.
- **Client → server, a person's input:** `{"type": "input", "action": click|move|wheel|type|key|navigate|back|forward|reload, ...}` with `x`/`y` in page pixels (1280×720).
- **Client → server:** `{"id", "tool": "open_page", "args": {"url"}}` opens a page. Fraud checks go through `/browser/tools`.

Not built yet: the LLM that decides when to run the checks, and the replay mode's browse steps (use `?mic&browser`, not `?browser` alone).

## More

- `HANDOFF.md`: team handoff, voice loop details, who owns what.
- `fraud-interceptor-brief.md`: the original build brief.

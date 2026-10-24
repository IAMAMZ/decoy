# Decoy

An AI fraud interceptor: a live call on one laptop (push-to-talk, Higgs Realtime), a bank fraud dashboard, and Decoy's screen, a real Chrome browser streamed into the app that a person (and later the agent) can drive.

## What runs where

| Part | Where | Port |
| --- | --- | --- |
| Frontend (React + Vite): stage, dashboard, phone screens, voice loop | `src/` | 5173 |
| Browser backend (Playwright): one headless Chrome, streamed to Decoy's screen | `backend/browser_server.py` | 8001 |

The voice call talks to Boson straight from the browser, so it needs no backend. The browser backend is only for Decoy's screen.

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
python backend/browser_server.py   # browser backend, ready when it prints "Uvicorn running on http://127.0.0.1:8001"
npm run dev                        # frontend
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

## Browser backend protocol

Clients connect to `ws://127.0.0.1:8001/browser/ws` (the Vite dev server proxies `/browser` to it).

- **Server → clients:** `{"id", "type": frame|address|view|loading|caption|result|error, ...}`, the format `src/events/browserBridge.ts` reads. Frames are base64 JPEG at 1280×800.
- **Client → server, a person's input:** `{"type": "input", "action": click|move|wheel|type|key|navigate|back|forward|reload, ...}` with `x`/`y` in page pixels (1280×800).
- **Client → server, an agent tool:** `{"id", "tool": "open_page", "args": {"url"}}`. Other tools (`web_search`, `check_domain`) aren't supported yet and return an error.

Not built yet: the LLM driving the browser, and the replay mode's browse steps (use `?mic&browser`, not `?browser` alone).

## More

- `HANDOFF.md`: team handoff, voice loop details, who owns what.
- `fraud-interceptor-brief.md`: the original build brief.

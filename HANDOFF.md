# Decoy — handoff to Yun and Young

From Miran · Oct 23, 2026. The frontend and a real browser service are in the repo and runnable. Everything else on screen is still a replay of `frontend/src/data/fake_events.json`. Below: what exists, how to run it, and what each of you plugs in.

## What's real and what's mocked

| Piece | State |
| --- | --- |
| Stage view `/` (phone + Decoy's screen + side rail), `/dashboard`, `/call`, `/caller` | Built |
| Decoy's screen (agent browser) | **Real**: Chrome browses the live web, streamed into the app |
| Call events (transcript, score, mode, tool calls, intel, summary) | Replayed from `fake_events.json` |
| `/ws/events`, detector, brain, tools, persona | **Yun**, not started |
| Mic → Higgs → Margaret's voice, `/ws/audio`, `startCall()` / `endCall()` | **Young**, not started (`frontend/src/audio/index.ts` is a stub) |

## Run it

Setup once (needs Node 18+, Python 3.14, Google Chrome installed):

```bash
cp .env.example .env                    # add BOSON_AI_API_KEY and TAVILY_API_KEY
pip install -r backend/requirements.txt
cd frontend && npm install
```

Then, from the repo root, in two terminals:

```bash
python -m backend.browser.server        # real browser, port 8001
cd frontend && npm run dev              # app, http://localhost:5173
```

Useful URLs and keys:

- `localhost:5173/?live`: read real events from `/ws/events` on port 8000 instead of the replay.
- `?at=29000`: jump the replay to 29 s (the takeover).
- **Space** pause, **R** restart, **⇧T** force takeover, **⇧S** force score 0.9, **H** hide the bar.
- The bottom bar shows `browser: real` when port 8001 is up. If it's down, a scripted animation plays instead.

Gotchas we already hit:

- **Use `127.0.0.1`, not `localhost`, for the backend.** Node resolves `localhost` to IPv6, so the Vite proxy couldn't reach a server bound to 127.0.0.1.
- **Python 3.14 needs `greenlet==3.2.4` and `playwright==1.55.0`.** Older versions fail to build.
- **`.env` and `*.wav` are gitignored.** Never commit keys or voice clips.

---

## Yun: backend, agent brain, tools

### 1. `/ws/events` on port 8000

The frontend already reads it in `?live` mode, and Vite proxies `/ws` and `/debug` to `127.0.0.1:8000`. Send the event format from the brief's Shared contract. Copy `fake_events.json` for exact shapes. Three optional fields were added; the UI works without them:

| Event | Optional field | Used for |
| --- | --- | --- |
| `call_started` | `caller_number` | Number shown on Margaret's phone |
| `transcript` | `emotion` | Shown as a stage direction, e.g. *(hesitant)* |
| `avatar` | `video_url` | Plays the Higgs Avatar clip instead of the placeholder |

Also wire the debug routes the hidden keys call: `POST /debug/takeover` and `POST /debug/score?value=0.9`.

### 2. Three new web tools

The browsing already works and is real. Call it from `tools.py`:

```python
from backend.browser.client import browse

# Use the same id as your tool_call event so Decoy's screen shows this run.
result = await browse(call_id, "open_page", {"url": "www.rbcroyalbank.com/customer-service/index.html"})
result["summary"]   # "Official number on www.rbcroyalbank.com: 1-800-769-2511"
```

| Tool | Args | What it really does | Result keys |
| --- | --- | --- | --- |
| `open_page` | `url`, optional `find` | Loads the page; if the number is hidden, clicks "Call us" / "Contact" like a person; highlights `find` or the first 1-8xx number | `summary`, `title`, `url`, `excerpt`, `highlight` |
| `check_domain` | `domain` | RDAP registry lookup, then tries to open the site | `summary`, `registered`, `registered_on`, `age_days`, `registrar`, `reachable` |
| `web_search` | `query` | Tavily search API, then opens the top result | `summary`, `results[{title,url,snippet}]` |

- **Emit events around each call:** `tool_call` with `status: started` before `browse()`, then `done` with its result. The dashboard renders `summary` in "What Decoy did".
- **Errors:** `browse()` raises `RuntimeError` on failure, e.g. no `TAVILY_API_KEY`. Catch it and emit `done` with `{"summary": "...", "error": true}`.
- **Real outcomes differ from the mock script.** For example, `rbc-secure-verify.com` comes back "isn't registered", because it really doesn't exist. Feed the real `summary` to the LLM.
- **Search engines block automated browsers.** Don't scrape Google, Bing or DuckDuckGo; search goes through Tavily (free key at tavily.com).
- **Allow time:** runs take roughly 6–15 s and execute one at a time.

### 3. Suggested order

1. A stub `main.py` that streams `fake_events.json` over `/ws/events`, so `?live` works today.
2. The text CLI brain with tools, emitting real events.
3. Detector scores, then the takeover state machine.

---

## Young: voice loop

### 1. Replace the audio stub

`frontend/src/audio/index.ts` currently exports two no-op functions. Keep the same signatures:

```ts
export async function startCall(): Promise<void>
export async function endCall(): Promise<void>
```

The `/caller` page already calls them from its Start and End buttons. Serve `/ws/audio` from the port 8000 backend; Vite's existing `/ws` proxy rule already forwards it, so no config change is needed.

### 2. Events your side emits

These go to `/ws/events` via Yun's `emit()`:

- `call_started` (with `caller_number` if you have it) and `call_ended`
- `transcript` with `speaker: "caller" | "ai"`, `text`, and `emotion` from the brain's reply
- `latency` with `ms`: shown as "Round trip" on `/dashboard`

### 3. Higgs RealTime reference

`my_voice_realtime.py` in the repo root works against Boson. It shows:

- Cloning a voice: `POST /v1/audio/voices`; the API returns the ID under either `voice` or `voice_id`.
- Opening `wss://api.boson.ai/v1/realtime` with `session.update`. The first update is acknowledged with `session.created`, not `.updated`.
- Retrying when the voice check returns 429 (rate limit or no credit).
- Streaming 24 kHz PCM16 output audio.

Run it with `python my_voice_realtime.py --style "warm, slightly confused"` to hear the persona voice.

### 4. Avatar

When the avatar clip exists, have the `avatar` event carry `video_url` and `/call` will play it. Until then a placeholder shows the text with a waveform.

---

## Where things live

```
backend/browser/      real browser service (agent.py, server.py, client.py)
frontend/src/pages/   Stage, Dashboard, Call, Caller
frontend/src/components/   LiveScreen (real browser view), AgentScreen (scripted fallback), PhoneScreen, ...
frontend/src/events/  event types, reducer, replay, browserBridge
frontend/src/data/fake_events.json   the scripted demo call
```

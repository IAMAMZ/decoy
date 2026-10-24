# Fraud Interceptor — Hackathon Build Brief

Team: Young, Yun, Miran · Oct 23, 2026

Contents:
1. Main brief (summary, business case, demo, architecture, tools, prompts, plan, risks)
2. Shared contract (everyone reads this)
3. Young — Voice loop
4. Yun — Detection and agent brain
5. Miran — Frontend, avatar and demo

---

# Part 1: Main brief

## Summary

We are building an AI fraud interceptor: a voice agent that detects a scam phone call in real time, protects the customer with tool calls, then takes over the call and wastes the scammer's time while collecting intelligence.

**Pitch line:** "Banks and telcos route suspected scam calls to our agent. Every call it takes is a call a real grandmother doesn't."

**Why it fits the Boson AI rubric:**

| Rubric item | How we hit it |
| --- | --- |
| Higgs AI usage | Higgs Audio Understanding detects scam signals from the caller's voice; Higgs TTS (or Higgs RealTime) speaks as the persona; Higgs Avatar gives the agent a face |
| UI | Two screens: the customer's call screen with avatar, and a bank fraud dashboard with live transcript, confidence meter and tool-call log |
| Innovation | Defensive (protect the customer) and offensive (bait the scammer, extract mule accounts) in one agent |
| Experience | Live, funny, unscripted AI on stage; a real SMS buzzes a phone in the room |
| Technical execution | Real-time voice loop, interruption handling, agentic tool calling |

## Business case

The customer is the bank or telco, not the consumer. A consumer "waste scammers' time" app is fun but hard to monetize; institutions lose real money and already pay for fraud prevention.

- **Telcos** route suspected scam calls to the agent instead of the customer. UK carrier O2 ran a publicity version of this with an AI "granny" called Daisy, so there is precedent to cite.
- **Banks** lose money when customers are talked into sending transfers. The agent intercepts, freezes the transfer, and collects the mule account the scammer wants money sent to.
- **Scam intelligence as a product:** every call produces data (scripts, callback numbers, mule accounts, phishing URLs) that banks and telcos can use to block future fraud.

Boson AI's stated early target markets include finance, telecom, healthcare and insurance, so this pitch speaks directly to the judges' own strategy.

## Demo script (about 3 minutes)

A teammate plays the scammer from the audience. The scammer follows a script; the AI's replies are fully live.

**On screen:** left = "Margaret's phone" call screen (avatar appears on takeover); right = bank fraud dashboard (transcript, scam confidence meter, red flags, tool-call log).

1. **Hook (20s).** One line on how much money is lost to phone fraud, then the call comes in.
2. **Detection (40s).** Scammer claims to be from the bank's fraud team, says Margaret must act fast. Confidence meter climbs; flags appear: *urgency*, *bank impersonation*, *requests secrecy*. Point out that Higgs reads pressure in the voice, not just keywords.
3. **Tool calls (30s).** Dashboard animates each call: caller number does not match the bank's official line; pending $3,000 transfer frozen; SMS sent to Margaret's daughter (real phone buzzes).
4. **Takeover (60s).** Avatar: "This looks like a scam. I'll handle it." The AI becomes slow, confused Margaret: can't find glasses, reads digits wrong, tells cat stories. Let the room laugh.
5. **Intelligence (30s).** Frustrated scammer gives a "safe account" number. Dashboard captures it: mule account flagged, callback number logged, fraud report generated.
6. **Close (20s).** Summary card: minutes wasted, dollars protected, accounts flagged, report filed. Then the pitch line.

Optional finale if latency is good: invite a judge to play the scammer.

## Architecture

The LLM agent brain is the center: Higgs listens to the caller, the brain decides and calls tools, and Higgs speaks back as Margaret.

```
 Scammer's call ──► Higgs Understanding ──► Agent brain (LLM) ──► Fraud dashboard
 (caller audio)      (scam score + flags)    (decides + calls tools)  (live events)
       ▲                                       │        │        │
       │ AI speaks                             ▼        ▼        ▼
       └──────────── Higgs TTS / RealTime   Agent tools     Higgs Avatar
                     (Margaret's voice)     (freeze, SMS,   (takeover warning)
                                             log intel)
```

- **Higgs Audio Understanding:** scores scam likelihood from tone and words every few seconds.
- **Higgs TTS (or Higgs RealTime if available):** Margaret's expressive voice, with hesitation and emotion.
- **Higgs Avatar:** talking face on the customer's screen for the takeover warning.
- **Backend:** one small server holds call state and pushes every event to the dashboard over WebSocket.

## Agent tools

The LLM brain calls these during the call. Mock almost everything; judges care that the agent acts, not that the bank is real. Every call must post an event to the dashboard so it animates.

| Tool | Input | Output | Real or mock |
| --- | --- | --- | --- |
| `lookup_caller` | phone number | known-scam flag, reputation score | Mock: hardcoded list |
| `verify_institution` | claimed org (e.g. "RBC"), caller number | official number, match yes/no | Mock: small JSON of real public numbers |
| `get_pending_transactions` | customer id | list of pending transfers | Mock: JSON account |
| `freeze_transaction` | transaction id | status frozen | Mock |
| `notify_family` | contact, message | delivery status | **Real** via Twilio SMS (about 30 min) |
| `take_over_call` | persona name | switches audio routing to AI persona | Real (our own app) |
| `log_intel` | type (mule account, callback number, URL, script tactic), value | stored record | Real (our own store) |
| `generate_report` | call id | fraud report card or PDF | Real (generated) |

Takeover rule: when scam confidence passes a threshold (start around 0.8) and the customer confirms, or a hard flag fires (asks for gift cards, remote access, or a "safe account").

## Prompt starters

**Scam detector** (sent to Higgs Audio Understanding with each audio chunk):

```
You are a fraud analyst listening to a phone call. Rate how likely the caller is a scammer from 0 to 1.
Listen to tone as well as words: urgency, pressure, impatience, scripted delivery.
Return JSON only: {"score": 0.0-1.0, "flags": ["urgency" | "bank_impersonation" | "secrecy" | "payment_request" | "remote_access" | "gift_cards" | "safe_account"], "evidence": "one short sentence"}
Scores should rise gradually as evidence builds; one mild phrase is not enough for 0.8.
```

**Margaret persona** (the takeover agent):

```
You are Margaret, 78, warm, chatty and easily distracted. You are talking to someone who says they are from your bank.
Goal: keep them on the line as long as possible and get them to reveal account numbers, callback numbers or websites. Never reveal you are an AI or that you suspect a scam.
Tactics: lose your glasses, mishear numbers and read them back wrong, ask them to repeat, tell short stories about your cat Biscuit, put the phone down to check the stove.
Never give real information. If asked for card or account numbers, give made-up ones slowly and incorrectly.
Keep each reply to 1-3 short sentences so the conversation stays fast.
When they give an account number, phone number or URL, call log_intel.
```

Render Margaret with Higgs TTS using emotion and pacing cues (hesitation, small laughs, sighs) — this is where Higgs' expressiveness shows.

## Build plan

The voice loop is the critical path: if one spoken round trip works by hour 6, the project is safe. Timeline assumes a ~24-hour hackathon.

| Person | Owns | Difficulty |
| --- | --- | --- |
| Young | Real-time voice loop: mic capture, end-of-turn detection, transcription, Higgs TTS playback, interruptions | Hard |
| Yun | Detection, agent brain with tool calling, mock bank data, event bus, persona prompts | Medium |
| Miran | Call screens, fraud dashboard, Higgs Avatar, summary card, pitch slides, backup video | Medium |

**Timeline**

1. Hours 0–6: one round trip working (speak, AI replies in voice). Dashboard skeleton. Mock data.
2. Hours 6–14: detection scoring live, tools wired, dashboard shows events.
3. Hours 14–20: avatar, Margaret persona tuning, Twilio SMS, report card.
4. Hours 20–24: feature freeze, rehearse 3+ times, record backup video.

**Fake on purpose:** the bank, the account, caller reputation, the phone network (use a browser call via WebRTC or a single laptop mic). Do real phone numbers only if everything else is done.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Voice loop latency over ~2s | Margaret's slow persona hides it; add filler sounds ("ohh, let me see...") played instantly while the reply generates |
| Higgs RealTime not in the starter kit | Chain Higgs Understanding → LLM → Higgs TTS with simple silence detection |
| Avatar API hard to stream | Use the avatar only for the short takeover warning clip |
| Detection jumps to 100% or never triggers | Smooth the score (rolling average), plus a manual "demo override" key hidden off-screen |
| Wifi dies on stage | Pre-recorded full run; switch without apologizing |

Ethics: never call real scammers in the demo. Script it with a teammate.

Open question for the organizers on day 1: which Higgs models and endpoints are in the starter kit (RealTime, Understanding, TTS, Avatar) and their rate limits.

## Instructions for a coding agent

If you are an AI coding agent reading this, build in this order and keep each step runnable:

1. Scaffold a web app (frontend + small backend server) with pages `/caller`, `/call` and `/dashboard`. Push events from backend to the pages via WebSocket.
2. Implement the voice loop: capture mic, detect end of speech, send audio to the backend, get a reply, play Higgs TTS audio. Measure and log round-trip latency.
3. Add the detection loop: every few seconds send recent caller audio to Higgs Audio Understanding with the detector prompt; parse JSON; push score and flags to the dashboard.
4. Add the agent brain with the tools in the table above as functions; mock data in a JSON file; every tool call emits a dashboard event.
5. Add takeover: switch the reply prompt to the Margaret persona when the takeover rule fires.
6. Add the avatar, Twilio SMS, and the summary report card last.

Read Boson's API docs (docs.boson.ai) for exact endpoints and auth; do not guess them. Keep API keys in a `.env` file, never in code. Follow the Shared contract in Part 2 exactly.

---

# Part 2: Shared contract (everyone reads this)

Agree on this in the first 30 minutes, then everyone codes against stubs and nobody waits on anyone. Change it only by telling the other two.

## Who owns what

| Person | Owns | Folder |
| --- | --- | --- |
| Young | Audio in and out, transcription, TTS, latency, interruptions | `backend/voice/`, `frontend/src/audio/` |
| Yun | Scam detection, agent brain, tools, mock data, event bus, persona prompts | `backend/agent/`, `backend/events.py` |
| Miran | Call screens, fraud dashboard, avatar, summary card, pitch, backup video | `frontend/src/pages/`, `frontend/src/components/` |

Roles were assigned without knowing your skills, so swap freely, but keep one owner per folder.

## Stack and layout

Python FastAPI backend on port 8000, React (Vite) frontend on port 5173. Boson's API is OpenAI-compatible, so the `openai` Python client works with Boson's base URL (check docs.boson.ai). Keys live in `backend/.env`, never committed.

```
backend/
  main.py          # FastAPI app, mounts routes (Yun sets up, everyone adds)
  events.py        # emit(event) -> pushes to all dashboard sockets (Yun)
  voice/           # Young
  agent/           # Yun: detector.py, brain.py, tools.py, prompts.py, mock_bank.json
frontend/src/
  audio/           # Young: mic capture + playback module Miran imports
  pages/           # Miran: Caller.tsx, Call.tsx, Dashboard.tsx
  components/      # Miran
```

## Pages

- `/caller` — the scammer's "phone". Mic in, speaker out. Plain UI.
- `/call` — Margaret's phone screen. Shows call status, avatar on takeover.
- `/dashboard` — the bank's fraud dashboard.

Default demo setup: the AI answers as Margaret from the first word, in naive mode, then switches to stalling mode at takeover. Stretch goal: a real teammate speaks as Margaret before takeover, with the backend relaying audio both ways.

## Python interfaces between Young and Yun

```python
# agent/brain.py (Yun implements, Young calls once per caller turn)
async def on_caller_turn(call_id: str, transcript: str) -> dict:
    # returns {"text": str, "style": "naive" | "stalling", "emotion": str}

# agent/detector.py (Yun implements, Young calls every ~3s with the last ~6s of caller audio)
async def on_audio_chunk(call_id: str, wav_bytes: bytes) -> None:
    # fire and forget; emits a "score" event itself

# events.py (Yun implements, everyone calls)
async def emit(type: str, call_id: str, data: dict) -> None
```

Until the real ones exist, `on_caller_turn` returns a canned line and `on_audio_chunk` does nothing. Yun commits these stubs in hour 1.

## Dashboard events (WebSocket `/ws/events`)

Every message is JSON: `{"type": ..., "call_id": ..., "ts": <ms>, "data": {...}}`.

| type | data | sent by |
| --- | --- | --- |
| `call_started` / `call_ended` | `{}` | Young |
| `transcript` | `{"speaker": "caller" or "ai", "text"}` | Young |
| `latency` | `{"ms"}` round trip of the last turn | Young |
| `score` | `{"score": 0-1, "flags": [...], "evidence"}` | Yun |
| `mode` | `{"mode": "monitoring" or "protecting" or "takeover"}` | Yun |
| `tool_call` | `{"id", "tool", "args", "status": "started" or "done", "result"}` | Yun |
| `intel` | `{"kind": "mule_account" or "callback_number" or "url" or "tactic", "value"}` | Yun |
| `avatar` | `{"text"}` line for the avatar to say | Yun |
| `summary` | `{"minutes_wasted", "dollars_protected", "intel_count", "report"}` | Yun |

Miran keeps a `fake_events.json` replay of a full call so the dashboard can be built before the backend works.

## Audio (WebSocket `/ws/audio`)

Owned end to end by Young. Browser sends 16 kHz mono 16-bit PCM frames; server sends back binary audio plus JSON control messages (`{"type": "stop_playback"}` when the caller interrupts). Young ships `frontend/src/audio/` as a module with `startCall()` and `endCall()` that Miran's pages call.

## Integration checkpoints

1. **Hour 1:** repo up, stubs committed, contract agreed.
2. **Hour 6:** Young's loop works with the stub brain; Yun's brain works from a text CLI; Miran's dashboard plays `fake_events.json`.
3. **Hour 8:** plug them together. First full call, ugly is fine.
4. **Hour 14:** full demo run end to end.
5. **Hour 20:** feature freeze. Rehearse and record the backup video.

---

# Part 3: Young — Voice loop

You own the critical path: the scammer speaks, the AI answers out loud. If one spoken round trip works by hour 6, the project is safe. Read the Shared contract first.

- **Your folders:** `backend/voice/`, `frontend/src/audio/`
- **You call:** `brain.on_caller_turn()`, `detector.on_audio_chunk()`, `emit()` (Yun's stubs exist from hour 1)
- **You provide:** the `/ws/audio` socket and a `startCall()` / `endCall()` module for Miran's pages

## First 30 minutes

- [ ] Get the Boson API key and base URL from the organizers; ask which models are available (TTS, Understanding/STT, RealTime) and rate limits.
- [ ] Hit the TTS endpoint once with a script and save a WAV. Time it.
- [ ] Transcribe that WAV with Higgs Understanding (or their STT). Time it.

Those two numbers tell you your latency budget before you build anything.

## Tasks in order

- [ ] **Mic capture** in `frontend/src/audio/`: AudioWorklet, downsample to 16 kHz mono PCM16, send 20 ms frames over `/ws/audio`.
- [ ] **End of turn** on the backend: voice activity detection (`webrtcvad` or Silero VAD); a turn ends after ~600 ms of silence.
- [ ] **Transcribe** the turn with Higgs. Emit `transcript` (speaker `caller`).
- [ ] **Brain:** call `on_caller_turn(call_id, transcript)`; you get back `text`, `style`, `emotion`.
- [ ] **Speak:** send `text` to Higgs TTS with Margaret's voice. Use `emotion` and `style` in the prompt (hesitant, warm, confused). Stream audio back to the browser and play it. Emit `transcript` (speaker `ai`) and `latency`.
- [ ] **Detector feed:** every ~3 s, send the last ~6 s of caller audio to `on_audio_chunk()`. Don't await it.
- [ ] **Interruptions:** if the caller starts speaking while the AI is playing, stop playback (`stop_playback` message) and drop the rest of that reply.
- [ ] **Margaret's voice:** pick a voice prompt or a short reference clip for cloning. Use a voice you have permission to use (a teammate doing an "old lady" voice works and is funny).

## Latency tricks (do these once the loop works)

- Pre-generate 6–8 filler clips ("ohh, let me see...", "hold on dear...", a sigh). Play one instantly when a turn ends, while the real reply generates.
- Split the reply into sentences and send the first sentence to TTS immediately.
- Keep Margaret's replies short (Yun's prompt asks for 1–3 sentences).
- Log per-stage timings (VAD, STT, brain, TTS first byte) so you know what to fix.

## If Higgs RealTime is available

It can replace the transcribe, brain and speak steps with one speech-to-speech call and much lower latency. Only switch if you can still inject the brain's decisions (persona switch, tool results) into it. If not, keep the chained version: it is easier to control and still demos well.

## Done when

- [ ] A person talks into `/caller` and hears Margaret answer, five turns in a row, without crashing.
- [ ] Median round trip under ~2.5 s (with filler clips, it feels faster).
- [ ] Talking over Margaret stops her within half a second.
- [ ] Transcript and latency events appear on the dashboard.

## Stretch

- Relay a human Margaret's mic (from `/call`) to the caller before takeover, then cut it off at takeover.
- Real phone call via Twilio Media Streams.

---

# Part 4: Yun — Detection and agent brain

You own the intelligence: deciding it's a scam, deciding what to do, doing it, and making Margaret convincing. Read the Shared contract first.

- **Your folders:** `backend/agent/`, `backend/events.py`, `backend/main.py` skeleton
- **You provide:** `on_caller_turn()`, `on_audio_chunk()`, `emit()`, and the `/ws/events` socket
- **You call:** Higgs Audio Understanding, an LLM with tool calling, Twilio

## Hour 1 (others are blocked on this)

- [ ] FastAPI skeleton in `main.py`, running on port 8000.
- [ ] `events.py`: `emit()` broadcasts JSON to every client on `/ws/events`.
- [ ] Stub `on_caller_turn()` returning a canned line and stub `on_audio_chunk()` doing nothing. Commit and tell Young.

## Tasks in order

- [ ] **Mock data** in `agent/`: `mock_bank.json` (Margaret's account with a pending $3,000 transfer), `scam_numbers.json`, `official_numbers.json` (a few real banks' public numbers).
- [ ] **Text CLI** (`python -m agent.cli`): you type as the scammer, the brain answers in text. Build and test everything here before audio is ready.
- [ ] **Brain:** per-call conversation history, an LLM with tool calling (use whatever LLM the starter kit hosts; Boson's API is OpenAI-compatible). Two styles: `naive` before takeover, `stalling` after. Return `{text, style, emotion}`.
- [ ] **Tools** in `tools.py` from the Agent tools table. Each one emits `tool_call` with `started`, waits ~400 ms, then emits `done` with its result, so the dashboard animation is visible.
- [ ] **Detector:** send the WAV to Higgs Audio Understanding with the detector prompt, parse the JSON, smooth the score (rolling average over the last 3), emit `score`.
- [ ] **Mode logic** (a small state machine): `monitoring` → at score 0.6 go to `protecting` and run `lookup_caller`, `verify_institution`, `get_pending_transactions`, `freeze_transaction`, `notify_family` → at 0.8 or any hard flag (gift cards, remote access, safe account) go to `takeover`, emit `avatar` with the warning line, switch the brain to `stalling`.
- [ ] **Intel capture:** in stalling mode the brain calls `log_intel` when it hears an account number, phone number or URL. Add a regex pass over each transcript as a backup in case the LLM misses one.
- [ ] **Twilio SMS** for `notify_family` to a real teammate's phone.
- [ ] **Summary:** on `call_ended`, compute minutes wasted, dollars protected (frozen amount), intel count; generate a short fraud report; emit `summary`.

## Demo safety switches

- `POST /debug/score?value=0.9` forces the score.
- `POST /debug/takeover` forces takeover.

Miran maps these to hidden keys on the dashboard in case detection misbehaves on stage.

## Persona tuning

The Margaret prompt is in Part 1. Test it in the CLI against the scammer script until she is funny, stays in character, never gives real data, and keeps replies to 1–3 sentences. Add `emotion` hints (hesitant, flustered, delighted) so Young's TTS can perform them.

## Done when

- [ ] In the CLI, a scripted scam goes monitoring → protecting → takeover at the right moments.
- [ ] All tool calls fire and appear as events; the SMS arrives.
- [ ] A mule account said by the scammer is captured as `intel` every time.
- [ ] The detector gives a low score on a normal call (test with a friendly "hi grandma" call) and a high one on the scam script.

---

# Part 5: Miran — Frontend, avatar and demo

You own everything the judges see: the screens, the avatar, the pitch and the backup video. UI and experience are two of the five rubric items, so this role carries as much weight as the backend. Read the Shared contract first.

- **Your folders:** `frontend/src/pages/`, `frontend/src/components/`
- **You use:** `/ws/events` (Yun), `startCall()` / `endCall()` from `frontend/src/audio/` (Young), Higgs Avatar API
- **You never wait on anyone:** build against `fake_events.json` from minute one.

## Hour 1

- [ ] Vite + React app on port 5173 with three routes: `/caller`, `/call`, `/dashboard`.
- [ ] Write `fake_events.json`: one full demo call as a list of events in the contract format, with timestamps. Add a replay script that plays them on a timer as if they came from the socket.

## Tasks in order

- [ ] **Dashboard** (`/dashboard`), the most important screen. Live transcript (caller vs AI, colour coded); scam confidence meter that animates as it rises; red-flag chips that pop in; tool-call log where each call shows a spinner then a check with its result; intel panel (mule accounts, numbers, URLs); a mode banner (Monitoring / Protecting / Takeover).
- [ ] **Call screen** (`/call`): Margaret's phone. Incoming call, timer, caller number, a red warning banner when mode becomes `protecting`, and the avatar on `takeover`.
- [ ] **Caller screen** (`/caller`): plain "phone" for the scammer with Start and End call buttons wired to Young's module.
- [ ] **Avatar:** when an `avatar` event arrives, send its text (or Young's TTS audio) to the Higgs Avatar API with a still image of a friendly assistant face, and play the talking video on `/call`. Fallback if streaming is hard: pre-generate the warning clip and just play it.
- [ ] **Summary card:** on `summary`, a big end-of-call card: minutes wasted, dollars protected, intel captured, "Report filed".
- [ ] **Hidden demo keys:** e.g. `Shift+T` calls Yun's `/debug/takeover`, `Shift+S` forces the score.
- [ ] **Switch from fake to live events** at the hour 8 integration.

## Design notes

- Make it look like a real bank fraud console: dark, calm, one accent colour for danger. Big numbers, readable from the back of the room.
- Every event should move something on screen. Judges can't see the backend, only the dashboard.
- Label which Higgs model did what, small and subtle ("Detected by Higgs Audio Understanding"). It helps the Higgs usage score.

## Pitch and demo (start by hour 12)

- [ ] Write the scammer script with Young and Yun (the demo script in Part 1 is the outline).
- [ ] Make 3–4 pitch slides: problem with one statistic, the live demo, business case (banks and telcos), how Higgs powers each part.
- [ ] Rehearse the full run at least three times after the hour 20 freeze.
- [ ] Record a full successful run as the backup video, ready to play with one click.

## Done when

- [ ] The dashboard plays a full demo from `fake_events.json` and looks finished.
- [ ] With the live backend, every event appears within a second.
- [ ] The avatar speaks the takeover warning on `/call`.
- [ ] Slides and backup video are on the demo laptop, offline.

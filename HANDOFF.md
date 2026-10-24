# Decoy — handoff

Updated by Miran · Oct 24, 2026. Decoy now runs **entirely in the browser on one laptop**, with no backend. The live voice call works: push-to-talk in, Higgs Realtime out. Detection and the agent brain aren't built yet, so takeover is forced with ⇧T for now.

## Run it

```bash
cp .env.example .env.local     # put your Boson key in VITE_BOSON_API_KEY
npm install
npm run dev                    # http://localhost:5173
```

| URL | What it does |
| --- | --- |
| `localhost:5173/?mic` | **Live call** with your mic. Press Enter or click Start. |
| `localhost:5173/` | Scripted replay of `src/data/fake_events.json`, for UI work and as the backup demo |
| `/dashboard?mic`, `/call?mic` | The same live call on the detail console and the phone screen |
| `localhost:5173/?mic&headset` | **Two-room demo**: Margaret is a second presenter on a Bluetooth headset paired to this Mac (see below). Picking a Margaret mic on the start card in plain `?mic` does the same. |

Keys in `?mic` mode:

| Key | Does |
| --- | --- |
| Hold **Space** | Talk as the **scammer** |
| Hold **Y** | Talk as **Margaret** (the real customer). Locked after takeover. |
| **⇧T** | Force takeover: Decoy becomes Margaret and starts answering the scammer |
| **⇧S** | Force the scam score to 0.9 |
| **Enter** / **Esc** | Start / end the call |

Use Chrome, click the page once so it has keyboard focus, and allow the mic.

## Two-room demo (`?mic&headset`, or a Margaret mic picked on the start card)

Margaret's presenter sits in another room with a Bluetooth headset paired to the demo Mac. The scammer (presenter plus audience) uses the Mac's own mic and speakers.

- Her turns are split by loudness, so nobody presses Y. Her voice plays on the scammer's speaker **only during her turns and never while Space is held** (0.2 s late, so her first word isn't clipped). Her mic is cut on takeover.
- The Mac mic reaches her headset **only while Space is held**, so she never hears her own voice echo back from the room. Pressing Space while she talks ends her turn.
- Decoy's voice plays on the MacBook speakers only.
- Pick each side's mic and speaker on the start card, for example external room speakers for the scammer side. Choices are saved in this browser. "Auto" means the MacBook's own mic and speakers for the scammer, and the first non-virtual other device for Margaret. The devices in use are logged in the console.
- Margaret's turns follow the room's noise floor. If silence still counts as talking, or her first words get cut, move "Margaret start level" on the start card (it applies at once). Her level meter is always on in the bottom bar. Run `node src/audio/vad.check.mjs` after changing `vad.ts`.
- Bluetooth reaches about 5–10 m through one wall. Test the real rooms at rehearsal.

## How the voice loop works (`src/audio/`)

| File | Job |
| --- | --- |
| `pcm-worklet.js` | AudioWorklet: mic to 24 kHz PCM16, 100 ms chunks plus loudness |
| `realtime.ts` | Higgs Realtime client: mints a client secret, connects with the `bai-client-secret.` subprotocol, manual turns, `higgs-stt-3.1` transcription |
| `player.ts` | Plays Decoy's streamed audio; stops instantly on barge-in |
| `index.ts` | Push-to-talk, turns, persona switch; emits dashboard events |

- **Before takeover:** Decoy only listens. Each turn gets a text marker (`[Next audio: the CALLER]` / `[MARGARET]`) so the model knows who spoke. Both sides are transcribed onto the dashboard.
- **On takeover:** the session instructions switch to the Margaret stalling persona from the brief. After that, each scammer turn gets a spoken reply.
- **Interrupting:** pressing Space while Decoy is talking cuts it off.
- **Speed:** measured round trip is about 0.45–0.55 s from releasing Space to Decoy's first audio. It's shown as "Round trip" on `/dashboard`.

Events the voice loop sends into the app's reducer (same format as the brief's contract):

- `call_started` (with `caller_number`), `mode`, `call_ended`
- `transcript` with `speaker`: `caller`, `customer` (new, the real Margaret) or `ai`
- `latency` with `ms`

## Yun: detection and brain, now in the browser

Everything goes through one function: `inject(event)` from `useCallEvents()` in `src/main.tsx`. Any event you inject updates the stage and dashboard immediately. Copy shapes from `fake_events.json`.

- **Detector:** on each `caller` transcript, or on the raw turn audio, call Higgs and inject `score` with `score`, `flags` and `evidence`.
- **Mode logic:** at 0.6 inject `mode: protecting` and run the protect tools. At 0.8 or a hard flag, inject `mode: takeover` plus `avatar`. The voice loop sees the takeover by itself (`setMode` in `index.ts`) and switches persona, so you don't need to touch audio.
- **Tools:** inject `tool_call` with `started`, then `done` with a `result`, for each one. Mock data can be a JSON file in `src/`.
- **Intel during takeover:** Higgs Realtime supports function tools (docs: "Tool use" guide). You could give the persona session a `log_intel` tool so Margaret's own model reports mule accounts. Add it in `realtime.ts` → `session.update` → `tools`.
- **Boson's API allows browser calls (CORS)** for chat, voices and Realtime client secrets. Tavily (search) and rdap.org (domain lookups) do too.

## Young: routing and app structure

- Pages are picked by path in `src/main.tsx` → `Page`, and `?mic` / `?live` are read in `src/events/useCallEvents.ts`. If you add a router, keep the `?mic` flag or move it, and keep the keyboard handler in `App`, because push-to-talk relies on the page owning Space and Y.
- **No Web Worker needed.** Network and UI work is light. The one place that needs its own thread, mic processing, already has the AudioWorklet.

## Gotchas

- **The Boson key is visible in the page.** Fine on the demo laptop, but never deploy or share a `npm run build` made with `.env.local`, because the key is baked into it. `.env.local` is gitignored.
- **Testing without a real mic:** Chrome's fake-mic flag played silence in headless tests, and the speech-to-text then invents text ("I'm not a good person"). If a transcript looks like nonsense, check that the mic is actually picking up sound.
- **Real Chrome browsing was removed with the backend.** The agent screen plays a scripted animation. The Playwright service that drove real Chrome (RBC's live site, RDAP) is in git history at commit `dc958d9`. Run it again and add `?browser` to the URL if we want it back.
- **Family alert = ntfy push, not SMS** (`src/tools/notifyFamily.ts`). It fires `notify_family` once per call when the mode first leaves monitoring. To see it buzz:
  1. Put a random topic in `VITE_NTFY_TOPIC` in `.env.local`.
  2. Install the free ntfy app on a phone and subscribe to that topic.
  3. The plain replay doesn't send it; add `?notify` to buzz during a replay. Anyone who knows the topic can read it, so keep the message generic.

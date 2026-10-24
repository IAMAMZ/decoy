# Merge guide: `feature/demo-agent` → `main`

For the coding agents working on Young's and Yun's branches. Read this before merging. This branch makes the live call (`?mic`) a complete demo with no manual keys: Decoy listens, detects the scam, protects Margaret, takes over and captures the scammer's details.

It already includes `feature/family-notify` and everything on `main` up to `d439c11` (Yun's real browser). Merging it brings the family alert too.

## What it adds

**A Higgs "brain"** (`src/agent/brain.ts`): a second, text-only Higgs Realtime session. After each caller line it calls one tool, `analyze_turn`, which returns `score`, `flags`, `evidence`, `claimed_org` and `intel`.
- Use `tool_choice: "auto"`. **`"required"` stalls on Higgs.**
- Answers in about 0.5–1.2 s.

**The agent loop** (`src/agent/useAgent.ts`), active only in `?mic` mode:

| Step | What happens |
| --- | --- |
| Score | The brain's score, limited to +0.25 / −0.1 per turn so the meter climbs. A keyword and pattern backup (`extract.ts`) adds flags and catches numbers, including spoken digits ("zero zero four two"). |
| ≥ 0.6 → `protecting` | Runs `lookup_caller`, `open_page` (the bank's official page), `verify_institution`, optionally `web_search`, then `get_pending_transactions` and `freeze_transaction`. The family alert fires on its own. |
| ≥ 0.8, or a hard flag at ≥ 0.6 → `takeover` | `take_over_call` and the avatar warning. The voice switches to the Margaret persona and **answers the scammer's last line immediately**. |
| During the call | Each new mule account, callback number or URL → `log_intel` + an `intel` event. URLs also get `check_domain`. |
| Call ends (Esc) | `generate_report` and a `summary` event built from the call's real data. |

**Overrides:** ⇧T and ⇧S go through the same mode changes, so they run the same steps.

**Tool data** (`src/agent/tools.ts`, `src/agent/data.ts`):

| Tool | Data |
| --- | --- |
| `check_domain` | **Real:** live RDAP registry lookup from the browser |
| `web_search` | **Real:** Tavily, only if `VITE_TAVILY_API_KEY` is set; otherwise skipped |
| `open_page` / `verify_institution` | A **saved snapshot** of RBC's real customer-service page (captured 2026-10-23); browsers can't load rbc.com directly |
| Caller reputation, pending transfer, freeze | Mock bank data, as the brief says |

**Voice changes** (`src/audio/`):
- `typeTurn(text)`: a "type as the scammer" box in the bottom bar, the noisy-room fallback.
- Margaret answers immediately on takeover, and the persona tells her she's mid-conversation (no greeting).
- `player.ts` skips empty audio chunks; Higgs sometimes sends one.

**UI:**
- Decoy's screen shows "domain doesn't exist" results.
- `verify_institution` handles an unknown bank.
- The start card no longer covers the summary after a call ends.

## ⚠️ Two decisions for the team

**1. Yun's real browser is switched off on this branch.**
`src/main.tsx` has `const REAL_BROWSER = false;`, which replaces `useBrowserBridge(...)` with a disconnected stub, so Decoy's screen plays the animated web checks.
- **To turn it back on:** set `REAL_BROWSER = true`.
- **Known clash if you do:** the bridge sends every `open_page` / `check_domain` / `web_search` tool call to `backend/browser_server.py`. That server only supports `open_page`; for the other two it returns an error, which **overwrites this branch's real RDAP result**. Fix by making the bridge only forward tools the server supports, or by teaching the server those tools.

**2. This branch has its own scam detector, and Young is building one.**
Keep one. The integration point is small:
- The detector's output reaches the app only as `score` and `mode` events. Everything downstream (protect steps, takeover, intel, summary) is driven by **mode changes**, not by `brain.ts`.
- **To use Young's detector instead:** make it inject `score` events plus `mode: protecting` / `mode: takeover`, and in `useAgent.ts` stop calling `r.brain.hear(...)` for the score (keep `findIntel` / `keywordFlags` for intel capture, or move them into his detector).
- **Don't run both:** two detectors would both inject `score` and `mode`.

## Files

| File | Change | Conflict risk |
| --- | --- | --- |
| `src/agent/*` (brain, data, extract, tools, useAgent) | New | None |
| `src/main.tsx` | `REAL_BROWSER` switch, `useAgent(state, inject)`, start card only before the first call | **Medium:** Young's routing, Yun's browser |
| `src/audio/index.ts` | `typeTurn`, `lastTurn`, answer-on-takeover, persona line | Low, unless someone else edited the voice loop |
| `src/audio/realtime.ts` | Exports `mintClientSecret()` and `REALTIME_URL` (used by the brain) | Low |
| `src/audio/player.ts` | Empty-chunk guard | Low |
| `src/components/TalkBar.tsx` | Type-as-scammer box | Low |
| `src/components/AgentScreen.tsx`, `format.ts` | Unregistered-domain page; unknown-bank text | Low |
| `src/styles.css` | Styles for the type box (appended) | Low |
| `.env.example` | `VITE_TAVILY_API_KEY` (optional) | Low |

## Verify after merging

1. `npx tsc --noEmit` passes.
2. `npm run dev`, open `localhost:5173/dashboard?mic`, press Enter, then type these lines into "Or type as the scammer…" one at a time, a few seconds apart:
   1. `Hello, is this Margaret Collins? This is David calling from the RBC fraud prevention team.` → Monitoring, about 0.25
   2. `We've detected suspicious activity on your account and we need to act right now, before you lose your savings.` → about 0.50
   3. `You must not tell anyone about this call, not even your family.` → **Protecting**, about 0.75; protect steps appear
   4. `Now I need you to move your money into a secure safe account we've set up for you.` → **Takeover**; Margaret (AI) answers within about 1 s
   5. `Go to your branch and transfer it to account zero zero four two, seven seven one nine three eight five.` → mule account `00427719385` captured
   6. `If we get cut off, call me back on 647 555 0142 or go to rbc-secure-verify.com` → callback number and URL captured; `check_domain` says it isn't registered
3. Press Esc: a summary card with minutes wasted, $3,000 protected and the intel count. Exactly one family alert arrives if `VITE_NTFY_TOPIC` is set.

These steps passed on this branch on 2026-10-24, with about 0.5 s round trip for Margaret's replies.

# Merge guide: `feature/family-notify` → `main`

For the coding agents working on Young's and Yun's branches. Read this before merging.

## What the branch does

It adds the `notify_family` agent tool as a real push notification via [ntfy](https://ntfy.sh): free, no account, no server, callable from the browser.

- It fires **once per call**, the first time `state.mode` leaves `monitoring` (so on `protecting`, or straight to `takeover`).
- It reports itself as a normal `tool_call` event: `started`, then `done` with `{delivery, via}`, or `{summary, error: true}` on failure.
- The dashboard shows "Push notification sent to Sarah (daughter)", and Margaret's phone shows "Sarah has been notified".
- **In replay mode it sends nothing**, unless the URL has `?notify`. It never double-sends in a call, including under React StrictMode.

## Files changed (81 lines added, 2 removed)

| File | Change | Conflict risk |
| --- | --- | --- |
| `src/tools/notifyFamily.ts` | **New.** `sendFamilyAlert(message)` and the `useFamilyAlert(state, inject)` hook | None |
| `src/main.tsx` | +1 import, +1 line `useFamilyAlert(state, inject);` in `App`, right after `useBrowserBridge(...)` | **Medium**, if routing has rewritten `App` |
| `src/components/format.ts` | +1 line in `describeResult` → `case 'notify_family'`: an `r.error` early return | Low |
| `src/components/PhoneScreen.tsx` | The `notified` check now skips errored results; text "texted" → "notified" | Low |
| `.env.example` | +`VITE_NTFY_TOPIC=` | Low |
| `HANDOFF.md` | "SMS is on hold" bullet replaced with the ntfy instructions | Low |

When this guide was written, the branch merged into `main` with **no conflicts**. Conflicts can only come from your own unmerged work.

## How to merge

```bash
git fetch origin
git checkout <your-branch>            # or main
git merge origin/feature/family-notify
```

### Resolving conflicts

**`src/main.tsx`, if routing moved or split `App`:**
- Keep exactly one call to `useFamilyAlert(state, inject)`, in whichever component owns `useCallEvents()`, i.e. where `state` and `inject` come from.
- It must be mounted on **every page** (stage, dashboard, call), not inside one route, or the alert won't fire when that page isn't open.
- Don't call it twice: the de-duplication is per hook instance, so two instances would send two pushes.

**Your detection or protect flow (Yun / Young):**
- If your code also emits a `notify_family` tool call when protecting starts, the family gets **two** alerts. Pick one:
  - **(a) Recommended:** emit only `mode: protecting` / `mode: takeover` and let this hook send the alert. That's all it needs.
  - **(b)** Call `sendFamilyAlert(message)` from your own protect flow, emit the `tool_call` events yourself, and **remove** the `useFamilyAlert(...)` line from `main.tsx`.
- Keep the message generic (no names, account numbers or amounts). ntfy topics can be read by anyone who knows the name.

**`format.ts` / `PhoneScreen.tsx`:** keep both sides. This branch only adds the error handling inside the `notify_family` lines.

## Setup after merging

Add to `.env.local` (git-ignored, never commit it):

```bash
VITE_NTFY_TOPIC=decoy-<random>   # e.g. decoy-7f3k2q; subscribe to it in the ntfy phone app
```

If it's empty, nothing breaks: the tool call shows "Set VITE_NTFY_TOPIC to notify family".

## Verify the merge

1. `npx tsc --noEmit` passes.
2. `npm run dev`, then check that the topic receives messages, without a phone:
   ```bash
   curl -s "https://ntfy.sh/$TOPIC/json?poll=1&since=5m"
   ```
3. **Live call:** open `localhost:5173/?mic`, start the call, press **⇧T** (or let your detector switch the mode). Expect **exactly one** message on the topic. "What Decoy did" shows "Push notification sent to Sarah (daughter)", and the phone shows "Sarah has been notified".
4. **Replay:** `localhost:5173/?at=21000` should send **zero** messages. `localhost:5173/?at=21000&notify` should send **exactly one**.

If step 3 sends two messages, see "Your detection or protect flow" above.

// notify_family: alerts the customer's family when Decoy starts protecting them.
// Sent as an ntfy push notification (free, no account, no server, works from the browser):
// install the ntfy app, subscribe to VITE_NTFY_TOPIC, and the phone buzzes.
// In a real product this would be an SMS; ntfy stands in for the demo.
import { useEffect, useRef } from 'react';
import type { CallState } from '../events/reducer';
import type { CallEvent } from '../events/types';
import { MIC } from '../events/useCallEvents';

const TOPIC = import.meta.env.VITE_NTFY_TOPIC as string | undefined;
const CONTACT = 'Sarah (daughter)';

// The replay already scripts this tool call; only buzz a real phone there when asked with ?notify.
const NOTIFY_IN_REPLAY = new URLSearchParams(window.location.search).has('notify');

export async function sendFamilyAlert(message: string): Promise<Record<string, unknown>> {
  if (!TOPIC) return { delivery: 'skipped', via: 'Push', summary: 'Set VITE_NTFY_TOPIC to notify family', error: true };
  // ntfy topics are public to anyone who knows the name: keep the message free of personal details.
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}`, {
    method: 'POST',
    body: message,
    headers: { Title: 'Decoy: scam call alert', Priority: 'high', Tags: 'rotating_light' },
  });
  if (!r.ok) throw new Error(`ntfy ${r.status}`);
  return { delivery: 'sent', via: 'Push notification' };
}

function alertText(state: CallState): string {
  const from = state.callerNumber ? ` from ${state.callerNumber}` : '';
  return `Your mum is on a likely scam call${from}. Decoy is protecting her account and keeping the caller busy. Please give her a call when you can.`;
}

/**
 * Fires notify_family once per call, the first time the call reaches protecting (or jumps
 * straight to takeover). Reports itself as a normal tool_call so the dashboard and phone show it.
 */
export function useFamilyAlert(state: CallState, inject: (ev: CallEvent) => void) {
  const sentFor = useRef<string | null>(null);

  // A replay restart clears the call: allow one more alert for the next run.
  useEffect(() => {
    if (!state.callId) sentFor.current = null;
  }, [state.callId]);

  // Mic mode: nothing else runs the protect tools yet, so trigger on the mode change.
  useEffect(() => {
    if (!MIC || !state.callId || state.mode === 'monitoring' || sentFor.current === state.callId) return;
    sentFor.current = state.callId;
    const callId = state.callId;
    const id = `notify_${Date.now().toString(36)}`;
    const args = { contact: CONTACT, message: alertText(state) };
    const event = (status: 'started' | 'done', result?: unknown) =>
      ({ type: 'tool_call', call_id: callId, ts: Date.now(), data: { id, tool: 'notify_family', args, status, result } }) as CallEvent;

    inject(event('started'));
    sendFamilyAlert(args.message)
      .then((result) => inject(event('done', result)))
      .catch((e) => inject(event('done', { delivery: 'failed', summary: `Couldn't notify family: ${e.message}`, error: true })));
  }, [state.mode, state.callId]);

  // Replay with ?notify: send a real push when the script's notify_family call starts.
  useEffect(() => {
    if (MIC || !NOTIFY_IN_REPLAY || !state.callId || sentFor.current === state.callId) return;
    const scripted = state.tools.find((t) => t.tool === 'notify_family');
    if (!scripted) return;
    sentFor.current = state.callId;
    sendFamilyAlert(alertText(state)).catch((e) => console.warn('notify_family:', e));
  }, [state.tools, state.callId]);
}

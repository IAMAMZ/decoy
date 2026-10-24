// The voice loop, entirely in the browser, on one laptop with push-to-talk:
//   hold Space -> the scammer talks      hold Y -> the real Margaret talks
// Before takeover Decoy only listens (both sides are transcribed for the dashboard).
// After takeover, Y is locked and Decoy answers the scammer out loud as Margaret.
// Pressing Space while Decoy talks interrupts it.
import { useSyncExternalStore } from 'react';
import type { CallEvent, Mode } from '../events/types';
import { Player } from './player';
import workletUrl from './pcm-worklet.js?url';
import { Realtime } from './realtime';

export type Talker = 'caller' | 'customer';

export type TalkState = {
  status: 'idle' | 'connecting' | 'live' | 'error';
  speaker: Talker | null;
  aiSpeaking: boolean;
  level: number; // mic loudness 0..1 while a key is held
  mode: Mode;
  error: string | null;
};

const DEMO_CALLER = '+1 (647) 555-0199';
const KEY_CLICK_MS = 120; // drop the first audio after a key press: it's mostly the key's click
const MIN_TURN_CHUNKS = 3; // 100 ms chunks; anything shorter is a mis-tap

const LABEL: Record<Talker, string> = {
  caller: '[Next audio: the CALLER]',
  customer: '[Next audio: MARGARET, the real customer]',
};

const LISTEN_INSTRUCTIONS =
  'You are silently monitoring a phone call between a caller and Margaret, 78. Do not speak unless asked.';

// Margaret persona from the brief, plus how to read the turn markers.
const MARGARET_PERSONA = `You are Margaret, 78, warm, chatty and easily distracted. You are talking to someone who says they are from your bank.
You have just taken over this call from the real Margaret: audio marked [MARGARET] was her, audio marked [the CALLER] is the caller. Continue as her seamlessly.
Goal: keep them on the line as long as possible and get them to reveal account numbers, callback numbers or websites. Never reveal you are an AI or that you suspect a scam.
Tactics: lose your glasses, mishear numbers and read them back wrong, ask them to repeat, tell short stories about your cat Biscuit, put the phone down to check the stove.
Never give real information. If asked for card or account numbers, give made-up ones slowly and incorrectly.
Keep each reply to 1-3 short sentences so the conversation stays fast.`;

// ---------- tiny store so React can read the talk state ----------

let state: TalkState = { status: 'idle', speaker: null, aiSpeaking: false, level: 0, mode: 'monitoring', error: null };
const listeners = new Set<() => void>();
function set(patch: Partial<TalkState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function useTalk(): TalkState {
  return useSyncExternalStore(subscribe, () => state);
}

// ---------- call ----------

let emitEvent: (ev: CallEvent) => void = () => {};
/** Where call events go (the dashboard's reducer). Set once by the app. */
export function configureCall(emit: (ev: CallEvent) => void) {
  emitEvent = emit;
}

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let rt: Realtime | null = null;
let player: Player | null = null;
let callId = '';
let turn: { speaker: Talker; pressedAt: number; chunks: number; labelId: string | null } | null = null;
const committedQueue: { speaker: Talker; ts: number }[] = [];
const itemSpeaker = new Map<string, { speaker: Talker; ts: number }>();
let responding = false;
let respondedAt = 0;
let gotFirstAudio = false;

function emit(type: CallEvent['type'], data: object, ts = Date.now()) {
  emitEvent({ type, call_id: callId, ts, data } as CallEvent);
}

export async function startCall(): Promise<void> {
  if (state.status === 'live' || state.status === 'connecting') return;
  set({ status: 'connecting', error: null, mode: 'monitoring', speaker: null, aiSpeaking: false });
  try {
    ctx = new AudioContext({ sampleRate: 24000 });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await ctx.audioWorklet.addModule(workletUrl);
    const capture = new AudioWorkletNode(ctx, 'pcm-capture');
    const silent = ctx.createGain();
    silent.gain.value = 0; // keeps the worklet running without playing the mic back
    ctx.createMediaStreamSource(stream).connect(capture).connect(silent).connect(ctx.destination);
    capture.port.onmessage = (e) => onMicChunk(e.data.pcm, e.data.level);

    player = new Player(ctx, (speaking) => set({ aiSpeaking: speaking }));
    rt = new Realtime({
      onCommitted: (itemId) => {
        const t = committedQueue.shift();
        if (t) itemSpeaker.set(itemId, t);
      },
      onInputTranscript: (itemId, text) => {
        const t = itemSpeaker.get(itemId);
        // Stamped with when the turn ended, so it sorts before Decoy's reply on the dashboard.
        if (t && text.trim()) emit('transcript', { speaker: t.speaker, text: text.trim() }, t.ts);
      },
      onAudio: (b64) => {
        if (!gotFirstAudio) {
          gotFirstAudio = true;
          emit('latency', { ms: Math.round(performance.now() - respondedAt) });
        }
        player?.play(b64);
      },
      onAiTranscript: (text) => text.trim() && emit('transcript', { speaker: 'ai', text: text.trim() }),
      onResponseDone: () => {
        responding = false;
      },
      onError: (message) => set({ error: message }),
      onClose: () => {
        if (state.status === 'live') {
          teardown();
          set({ status: 'error', error: 'Connection to Higgs Realtime closed' });
        }
      },
    });
    await rt.connect(LISTEN_INSTRUCTIONS);

    callId = `call_${Date.now().toString(36)}`;
    emit('call_started', { caller_number: DEMO_CALLER });
    emit('mode', { mode: 'monitoring' });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    set({ status: 'live' });
  } catch (e) {
    teardown();
    const msg = e instanceof Error ? e.message : String(e);
    set({ status: 'error', error: /Permission|NotAllowed/i.test(msg) ? 'Microphone permission was denied' : msg });
  }
}

export async function endCall(): Promise<void> {
  if (state.status !== 'live') return;
  emit('call_ended', {});
  teardown();
  set({ status: 'idle', speaker: null, aiSpeaking: false, level: 0 });
}

/** Follow the dashboard's mode. On takeover, Y locks and Decoy becomes Margaret. */
export function setMode(mode: Mode) {
  if (mode === state.mode) return;
  set({ mode });
  if (mode === 'takeover') {
    if (turn?.speaker === 'customer') cancelTurn();
    rt?.setInstructions(MARGARET_PERSONA);
  }
}

function teardown() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  player?.stop();
  rt?.close();
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  ctx = stream = rt = player = null;
  turn = null;
  responding = false;
  committedQueue.length = 0;
  itemSpeaker.clear();
}

// ---------- push-to-talk ----------

function keyToTalker(e: KeyboardEvent): Talker | null {
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return null;
  return e.code === 'Space' ? 'caller' : e.code === 'KeyY' ? 'customer' : null;
}

function onKeyDown(e: KeyboardEvent) {
  const who = keyToTalker(e);
  if (!who) return;
  e.preventDefault(); // Space would otherwise scroll or press buttons
  if (e.repeat || turn) return; // holding a key repeats keydown; one turn at a time
  if (who === 'customer' && state.mode === 'takeover') return; // Margaret is muted after takeover
  if (state.aiSpeaking || responding) {
    // Barge-in: the scammer talks over Decoy.
    player?.stop();
    rt?.cancel();
    responding = false;
  }
  turn = { speaker: who, pressedAt: performance.now(), chunks: 0, labelId: null };
  set({ speaker: who, level: 0 });
}

function onKeyUp(e: KeyboardEvent) {
  const who = keyToTalker(e);
  if (!who || turn?.speaker !== who) return;
  e.preventDefault();
  finishTurn();
}

function onBlur() {
  if (turn) finishTurn(); // window lost focus mid-turn: keyup will never arrive
}

function onMicChunk(pcm: ArrayBuffer, level: number) {
  if (!turn || !rt) return;
  set({ level: Math.min(1, level * 6) });
  if (performance.now() - turn.pressedAt < KEY_CLICK_MS) return;
  if (!turn.labelId) turn.labelId = rt.label(LABEL[turn.speaker]);
  rt.append(pcm);
  turn.chunks++;
}

function cancelTurn() {
  if (turn?.labelId) rt?.deleteItem(turn.labelId);
  if (turn?.chunks) rt?.clear();
  turn = null;
  set({ speaker: null, level: 0 });
}

function finishTurn() {
  const t = turn;
  if (!t || !rt) return;
  if (t.chunks < MIN_TURN_CHUNKS) return cancelTurn();
  turn = null;
  set({ speaker: null, level: 0 });

  committedQueue.push({ speaker: t.speaker, ts: Date.now() });
  rt.commit();
  if (t.speaker === 'caller' && state.mode === 'takeover') {
    responding = true;
    gotFirstAudio = false;
    respondedAt = performance.now();
    rt.respond();
  }
}

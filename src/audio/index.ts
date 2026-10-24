// The voice loop, entirely in the browser, on one laptop with push-to-talk:
//   hold Space -> the scammer talks      hold Y -> the real Margaret talks
// Before takeover Decoy only listens (both sides are transcribed for the dashboard).
// After takeover, Y is locked and Decoy answers the scammer out loud as Margaret.
// Pressing Space while Decoy talks interrupts it.
//
// Two rooms (?headset, or a Margaret mic picked on the start card): Margaret is a second presenter in another room on a Bluetooth headset paired to
// this laptop. Her turns are split by loudness (no Y), and the room hears her only during a turn,
// never while Space is held. The scammer's mic reaches her headset only while Space is held.
// After takeover her mic is cut. Each side's mic and speaker is picked on the start card (saved
// in localStorage); unset ones fall back to the MacBook's own and the first other device.
import { useSyncExternalStore } from 'react';
import type { CallEvent, Mode } from '../events/types';
import { Player } from './player';
import workletUrl from './pcm-worklet.js?url';
import { Realtime } from './realtime';
import { createVoice, pcmSeconds } from './clone';
import { Vad } from './vad';

export type Talker = 'caller' | 'customer';

export type Role = 'scammerMic' | 'scammerOut' | 'margaretMic' | 'margaretOut';
export type AudioSettings = Partial<Record<Role, string>> & { vad?: number; herTurns?: 'vad' | 'key' };

export type TalkState = {
  settings: AudioSettings; // chosen device ids, and Margaret's start level
  herLevel: number; // headset mic loudness 0..1, always on in ?headset
  status: 'idle' | 'connecting' | 'live' | 'error';
  speaker: Talker | null;
  aiSpeaking: boolean;
  level: number; // mic loudness 0..1 while a key is held
  mode: Mode;
  error: string | null;
  // How much of the real customer's speech is in the voice clone so far, and where the clone is.
  clone: { seconds: number; status: 'collecting' | 'cloning' | 'ready' | 'failed' };
};

const DEMO_CALLER = '+1 (647) 555-0199';
const KEY_CLICK_MS = 120; // drop the first audio after a key press: it's mostly the key's click
const MIN_TURN_CHUNKS = 3; // 100 ms chunks; anything shorter is a mis-tap
// Loudest 100 ms RMS below this means the mic heard nothing. Higgs STT invents sentences from silence.
const SILENT_LEVEL = 0.005;
const SILENT_ERROR = 'The mic heard nothing on that turn: check the input device in system settings';
// Boson recommends 5-30 s of clean speech to clone a voice; it accepts 3 s minimum.
const CLONE_SECONDS = 8;
const CLONE_MIN_SECONDS = 3;

const params = new URLSearchParams(window.location.search);
const HEADSET = params.has('headset');
export const VAD_DEFAULT = 0.04; // headset mic RMS that starts Margaret's turn
const SAVED = 'decoy.audio';
const PREROLL = 2; // chunks kept from before her turn starts, so its first word isn't clipped
const MIC_OPTS = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

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
You are mid-conversation: never greet or introduce yourself. Respond to the caller's last request as if you're trying to go along with it but getting muddled.
Keep each reply to 1-3 short sentences so the conversation stays fast.`;

export const CLONE_TARGET_SECONDS = CLONE_SECONDS;
const NO_CLONE: TalkState['clone'] = { seconds: 0, status: 'collecting' };

// ---------- tiny store so React can read the talk state ----------

let state: TalkState = {
  settings: JSON.parse(localStorage.getItem(SAVED) ?? '{}'),
  herLevel: 0,
  status: 'idle', speaker: null, aiSpeaking: false, level: 0, mode: 'monitoring', error: null, clone: NO_CLONE };
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
let turn: { speaker: Talker; pressedAt: number; chunks: number; labelId: string | null; pcm: ArrayBuffer[]; peak: number } | null = null;
type Committed = { speaker: Talker; ts: number; pcm: ArrayBuffer[] };
const committedQueue: Committed[] = [];
const itemSpeaker = new Map<string, Committed>();
// The real customer's transcribed turns, collected to clone their voice for the takeover.
let sample: { pcm: ArrayBuffer[]; text: string[] } = { pcm: [], text: [] };
let clonedVoice: string | null = null;
let cloning = false;
let responding = false;
let respondedAt = 0;
let lastTurn: Talker | null = null; // who spoke last, so takeover knows whether to answer
let gotFirstAudio = false;
// ?headset only
let headCtx: AudioContext | null = null;
let headStream: MediaStream | null = null;
let toHeadset: GainNode | null = null; // scammer mic -> her ear, open while Space is held
let toSpeakers: GainNode | null = null; // her mic -> the room, open during her turns
let preroll: ArrayBuffer[] = [];
/** Margaret on her own mic and speaker: ?headset, or a Margaret mic picked on the start card. */
export function twoRooms(): boolean {
  return HEADSET || !!state.settings.margaretMic;
}

/** In two rooms, Margaret's turns come from voice detection unless Y was picked on the start card. */
export function herTurnsByVad(): boolean {
  return twoRooms() && state.settings.herTurns !== 'key';
}

const vad = new Vad(state.settings.vad ?? VAD_DEFAULT);

/** Pick a device for one side, or Margaret's start level. Applies to the next call; the level applies now. */
export function setAudio(patch: AudioSettings) {
  const settings = { ...state.settings, ...patch };
  localStorage.setItem(SAVED, JSON.stringify(settings));
  vad.on = settings.vad ?? VAD_DEFAULT;
  set({ settings });
}

/** Every real mic and speaker. Asks for mic permission first, because labels are blank without it. */
export async function listAudioDevices(): Promise<MediaDeviceInfo[]> {
  (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
  const all = await navigator.mediaDevices.enumerateDevices();
  // Chrome lists "default" and "communications" again as aliases of real devices.
  return all.filter((d) => d.kind !== 'videoinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

function emit(type: CallEvent['type'], data: object, ts = Date.now()) {
  emitEvent({ type, call_id: callId, ts, data } as CallEvent);
}

export async function startCall(): Promise<void> {
  if (state.status === 'live' || state.status === 'connecting') return;
  set({ status: 'connecting', error: null, mode: 'monitoring', speaker: null, aiSpeaking: false });
  try {
    const dev = await pickDevices();
    // AudioContext sinkId is Chrome 110+ and not in TS's DOM types yet.
    ctx = new AudioContext({ sampleRate: 24000, ...(dev.scammerOut && { sinkId: dev.scammerOut }) } as AudioContextOptions);
    stream = await navigator.mediaDevices.getUserMedia({
      // Two rooms need no echo cancelling: each side's speaker is muted while that side talks. Chrome's
      // macOS voice processing also turns the MacBook mic down and drags in the Bluetooth device.
      audio: { ...MIC_OPTS, echoCancellation: !twoRooms(), ...(dev.scammerMic && { deviceId: { exact: dev.scammerMic } }) },
    });
    await ctx.audioWorklet.addModule(workletUrl);
    if (twoRooms()) await connectHeadset(dev as Devices);
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
        if (t?.speaker === 'customer' && text.trim() && !clonedVoice && !cloning) {
          sample.pcm.push(...t.pcm);
          sample.text.push(text.trim());
          set({ clone: { seconds: pcmSeconds(sample.pcm), status: 'collecting' } });
          maybeClone(state.mode === 'takeover' ? CLONE_MIN_SECONDS : CLONE_SECONDS);
        }
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

/** Noisy-room fallback: a typed scammer line, handled exactly like a spoken one. */
export function typeTurn(text: string) {
  const line = text.trim();
  if (state.status !== 'live' || !rt || !line) return;
  if (state.aiSpeaking || responding) {
    player?.stop();
    rt.cancel();
  }
  rt.label(`${LABEL.caller} (typed): ${line}`);
  emit('transcript', { speaker: 'caller', text: line });
  lastTurn = 'caller';
  if (state.mode === 'takeover') {
    responding = true;
    gotFirstAudio = false;
    respondedAt = performance.now();
    rt.respond();
  }
}

/** Follow the dashboard's mode. On takeover, Y locks and Decoy becomes Margaret. */
export function setMode(mode: Mode) {
  if (mode === state.mode) return;
  set({ mode });
  if (mode === 'takeover') {
    if (turn?.speaker === 'customer') cancelTurn();
    // The real Margaret is off the call: release her mic, which also lets a Bluetooth headset leave call mode.
    headStream?.getTracks().forEach((t) => t.stop());
    set({ herLevel: 0 });
    rt?.setInstructions(MARGARET_PERSONA);
    if (clonedVoice) rt?.setVoice(clonedVoice);
    else maybeClone(CLONE_MIN_SECONDS); // not enough yet for a good clone: use what there is
    // The scammer's line that triggered the takeover deserves an answer: Decoy speaks right away.
    if (rt && lastTurn === 'caller' && !responding && !turn) {
      responding = true;
      gotFirstAudio = false;
      respondedAt = performance.now();
      rt.respond();
    }
  }
}

function teardown() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  player?.stop();
  rt?.close();
  stream?.getTracks().forEach((t) => t.stop());
  headStream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  headCtx?.close();
  ctx = stream = rt = player = null;
  headCtx = headStream = toHeadset = toSpeakers = null;
  preroll = [];
  vad.reset();
  turn = null;
  lastTurn = null;
  responding = false;
  committedQueue.length = 0;
  itemSpeaker.clear();
  sample = { pcm: [], text: [] };
  clonedVoice = null;
  cloning = false;
  set({ clone: NO_CLONE });
}

/** Clone the customer's voice once enough of their speech is in; at takeover Decoy switches to it. */
async function maybeClone(minSeconds: number) {
  const seconds = pcmSeconds(sample.pcm);
  if (cloning || clonedVoice || seconds < minSeconds) return;
  cloning = true;
  const call = callId;
  const id = `clone_${Date.now().toString(36)}`;
  // The transcript sent as ref_text: click the call on the dashboard to check it is really the customer.
  const args = { seconds: Math.round(seconds * 10) / 10, text: sample.text.join(' ') };
  const report = (status: 'started' | 'done', result?: unknown) =>
    emitEvent({ type: 'tool_call', call_id: call, ts: Date.now(), data: { id, tool: 'clone_voice', args, status, result } });
  report('started');
  set({ clone: { seconds, status: 'cloning' } });
  try {
    const voice = await createVoice(sample.pcm, args.text);
    if (call !== callId || !rt) return; // the call ended while cloning
    clonedVoice = voice;
    set({ clone: { seconds, status: 'ready' } });
    report('done', { voice });
    if (state.mode === 'takeover') rt.setVoice(voice);
  } catch (e) {
    if (call === callId) set({ clone: { seconds, status: 'failed' } });
    if (call === callId) report('done', { error: true, summary: e instanceof Error ? e.message : String(e) });
  } finally {
    if (call === callId) cloning = false;
  }
}

// ---------- push-to-talk ----------

function keyToTalker(e: KeyboardEvent): Talker | null {
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return null;
  return e.code === 'Space' ? 'caller' : e.code === 'KeyY' && !herTurnsByVad() ? 'customer' : null;
}

function onKeyDown(e: KeyboardEvent) {
  const who = keyToTalker(e);
  if (!who) return;
  e.preventDefault(); // Space would otherwise scroll or press buttons
  if (!e.repeat && turn?.speaker === 'customer' && herTurnsByVad()) {
    finishTurn(); // the scammer talks over Margaret: close her turn so his can start
    vad.reset();
  }
  if (e.repeat || turn) return; // holding a key repeats keydown; one turn at a time
  if (who === 'customer' && state.mode === 'takeover') return; // Margaret is muted after takeover
  if (state.aiSpeaking || responding) {
    // Barge-in: the scammer talks over Decoy.
    player?.stop();
    rt?.cancel();
    responding = false;
  }
  turn = { speaker: who, pressedAt: performance.now(), chunks: 0, labelId: null, pcm: [], peak: 0 };
  set({ speaker: who, level: 0 });
  if (who === 'caller') setEar(true);
  else setRoom(true);
}

function onKeyUp(e: KeyboardEvent) {
  const who = keyToTalker(e);
  if (!who || turn?.speaker !== who) return;
  e.preventDefault();
  finishTurn();
}

function onBlur() {
  if (turn && !(turn.speaker === 'customer' && herTurnsByVad())) finishTurn(); // window lost focus mid-turn: keyup will never arrive
}

function onMicChunk(pcm: ArrayBuffer, level: number) {
  if (!turn || !rt) return;
  if (twoRooms() && turn.speaker !== 'caller') return; // her turns come from the headset mic
  set({ level: Math.min(1, level * 6) });
  if (performance.now() - turn.pressedAt < KEY_CLICK_MS) return;
  turn.peak = Math.max(turn.peak, level);
  if (!turn.labelId) turn.labelId = rt.label(LABEL[turn.speaker]);
  rt.append(pcm);
  if (turn.speaker === 'customer') turn.pcm.push(pcm);
  turn.chunks++;
}

function cancelTurn() {
  if (turn?.labelId) rt?.deleteItem(turn.labelId);
  if (turn?.chunks) rt?.clear();
  turn = null;
  set({ speaker: null, level: 0 });
  setEar(false);
  setRoom(false);
}

function finishTurn() {
  const t = turn;
  if (!t || !rt) return;
  if (t.chunks < MIN_TURN_CHUNKS) return cancelTurn();
  if (t.peak < SILENT_LEVEL) {
    cancelTurn();
    return set({ error: SILENT_ERROR });
  }
  if (state.error === SILENT_ERROR) set({ error: null });
  turn = null;
  set({ speaker: null, level: 0 });
  setEar(false);
  setRoom(false);

  committedQueue.push({ speaker: t.speaker, ts: Date.now(), pcm: t.pcm });
  rt.commit();
  lastTurn = t.speaker;
  if (t.speaker === 'caller' && state.mode === 'takeover') {
    responding = true;
    gotFirstAudio = false;
    respondedAt = performance.now();
    rt.respond();
  }
}

// ---------- ?headset ----------

type Devices = Record<Role, string>;

/** The chosen devices that are still plugged in; in ?headset, guesses the rest. Unset = system default. */
async function pickDevices(): Promise<Partial<Devices>> {
  const all = await listAudioDevices();
  const chosen = (r: Role) => all.find((d) => d.deviceId === state.settings[r]);
  const laptop = (d: MediaDeviceInfo) => /macbook|built-in/i.test(d.label);
  const headset = (d: MediaDeviceInfo) =>
    d.deviceId !== 'default' &&
    !laptop(d) &&
    !/iphone|ipad|zoom|teams|blackhole|virtual|aggregate|display|monitor/i.test(d.label);
  const find = (kind: MediaDeviceKind, ok: (d: MediaDeviceInfo) => boolean) =>
    twoRooms() ? all.find((d) => d.kind === kind && ok(d)) : undefined;
  const picked = {
    scammerMic: chosen('scammerMic') ?? find('audioinput', laptop),
    scammerOut: chosen('scammerOut') ?? find('audiooutput', laptop),
    ...(twoRooms() && {
      margaretMic: chosen('margaretMic') ?? find('audioinput', headset),
      margaretOut: chosen('margaretOut') ?? find('audiooutput', headset),
    }),
  };
  if (!twoRooms()) return { scammerMic: picked.scammerMic?.deviceId, scammerOut: picked.scammerOut?.deviceId };
  const missing = Object.entries(picked).filter(([, d]) => !d).map(([k]) => k);
  if (missing.length)
    throw new Error(`Headset mode: no ${missing.join(', ')}. Audio devices: ${all.map((d) => d.label).join(', ')}`);
  console.info('[audio] using', Object.fromEntries(Object.entries(picked).map(([k, d]) => [k, d!.label])));
  return Object.fromEntries(Object.entries(picked).map(([k, d]) => [k, d!.deviceId])) as Devices;
}

async function connectHeadset(dev: Devices) {
  if (!ctx || !stream) return;
  // No auto gain: in a quiet room it turns hiss up until it sounds like talking.
  headStream = await navigator.mediaDevices.getUserMedia({
    audio: { ...MIC_OPTS, echoCancellation: false, autoGainControl: false, deviceId: { exact: dev.margaretMic } },
  });
  const her = ctx.createMediaStreamSource(headStream);
  toSpeakers = ctx.createGain();
  toSpeakers.gain.value = 0;
  // Delayed so the room also hears the words just before the gate opened (the turn's pre-roll).
  const delay = ctx.createDelay(1);
  delay.delayTime.value = PREROLL / 10;
  her.connect(delay).connect(toSpeakers).connect(ctx.destination);
  const capture = new AudioWorkletNode(ctx, 'pcm-capture');
  const silent = ctx.createGain();
  silent.gain.value = 0;
  her.connect(capture).connect(silent).connect(ctx.destination);
  capture.port.onmessage = (e) => onHeadsetChunk(e.data.pcm, e.data.level);

  headCtx = new AudioContext({ sinkId: dev.margaretOut } as AudioContextOptions);
  toHeadset = headCtx.createGain();
  toHeadset.gain.value = 0;
  headCtx.createMediaStreamSource(stream).connect(toHeadset).connect(headCtx.destination);
}

function setEar(open: boolean) {
  if (toHeadset) toHeadset.gain.value = open ? 1 : 0;
}

function setRoom(open: boolean) {
  if (!ctx || !toSpeakers) return;
  // Close once the delayed audio has played out, so the room hears her last word; a 20 ms fade, no click.
  toSpeakers.gain.cancelScheduledValues(ctx.currentTime);
  toSpeakers.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime + (open ? 0 : PREROLL / 10), 0.02);
}

function onHeadsetChunk(pcm: ArrayBuffer, level: number) {
  if (!rt || state.mode === 'takeover') return;
  set({ herLevel: Math.min(1, level * 6) });
  if (!herTurnsByVad()) {
    // Y is held for her: her headset mic feeds the turn, like the laptop mic does for Space.
    if (turn?.speaker !== 'customer') return;
    if (!turn.labelId) turn.labelId = rt.label(LABEL.customer);
    rt.append(pcm);
    turn.pcm.push(pcm);
    turn.peak = Math.max(turn.peak, level);
    turn.chunks++;
    return set({ level: Math.min(1, level * 6) });
  }
  // shortcut: one turn at a time, so her words while the scammer holds Space are dropped; upgrade if overlapping speech matters.
  if (turn && turn.speaker !== 'customer') {
    preroll = [];
    vad.reset();
    return;
  }
  const step = vad.push(level);
  if (!step) {
    preroll = [...preroll, pcm].slice(-PREROLL);
    return;
  }
  if (step === 'start') {
    turn = { speaker: 'customer', pressedAt: performance.now(), chunks: 0, labelId: rt.label(LABEL.customer), pcm: [], peak: 0 };
    for (const p of preroll) rt.append(p);
    turn.pcm.push(...preroll); // her speech also feeds the voice clone
    turn.chunks = preroll.length;
    preroll = [];
    set({ speaker: 'customer' });
    setRoom(true);
  }
  if (!turn) return vad.reset(); // her turn was closed elsewhere (takeover)
  rt.append(pcm);
  turn.pcm.push(pcm);
  turn.peak = Math.max(turn.peak, level);
  turn.chunks++;
  if (step === 'end') {
    if (vad.voiced < MIN_TURN_CHUNKS) cancelTurn();
    else finishTurn();
  }
}

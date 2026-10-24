import { useEffect, useState } from 'react';
import {
  CLONE_TARGET_SECONDS,
  endCall,
  listAudioDevices,
  setAudio,
  startCall,
  twoRooms,
  typeTurn,
  useTalk,
  VAD_DEFAULT,
  type Role,
  type Talker,
} from '../audio';

const NAMES: Record<Talker, string> = { caller: 'Scammer', customer: 'Margaret' };

/** Bottom bar in mic mode: who holds which key, who's talking, and how loud. */
export function TalkBar() {
  const t = useTalk();
  const live = t.status === 'live';
  return (
    <div className="controls talkbar">
      <span className={`src ${live ? 'src-on' : ''}`}>{live ? 'MIC · live' : `MIC · ${t.status}`}</span>
      <Key k="Space" who="caller" t={t} />
      <Key k={twoRooms() ? 'Headset' : 'Y'} who="customer" t={t} locked={t.mode === 'takeover'} />
      {live && (
        <form
          className="type-turn"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem('line') as HTMLInputElement;
            typeTurn(input.value);
            input.value = '';
          }}
        >
          <input name="line" placeholder="Or type as the scammer…" autoComplete="off" />
        </form>
      )}
      {live && <CloneTag clone={t.clone} />}
      <span className={`decoy-talk ${t.aiSpeaking ? 'on' : ''}`}>{t.aiSpeaking ? 'Decoy speaking' : ''}</span>
      {t.error && <span className="talk-error">{t.error}</span>}
      <nav>
        <a href="/?mic">Stage</a>
        <a href="/dashboard?mic">Dashboard</a>
        <a href="/call?mic">Call</a>
      </nav>
      {live ? (
        <button className="btn btn-sm" onClick={() => endCall()}>
          End call (Esc)
        </button>
      ) : (
        <button className="btn btn-sm" onClick={() => startCall()} disabled={t.status === 'connecting'}>
          Start call (Enter)
        </button>
      )}
    </div>
  );
}

function Key({ k, who, t, locked }: { k: string; who: Talker; t: ReturnType<typeof useTalk>; locked?: boolean }) {
  const on = t.speaker === who;
  const herMic = twoRooms() && who === 'customer' && t.status === 'live' && !locked; // always on: shows the room is quiet
  return (
    <span className={`ptt ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}>
      <kbd>{k}</kbd>
      {NAMES[who]}
      {locked && <em> · muted, Decoy has the call</em>}
      {(on || herMic) && (
        <span className="level" aria-hidden>
          <span style={{ width: `${Math.round((herMic ? t.herLevel : t.level) * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

/** Shows the real customer's speech filling up the voice clone, so you can tell your voice is getting in. */
function CloneTag({ clone }: { clone: ReturnType<typeof useTalk>['clone'] }) {
  const text = {
    collecting: `Voice clone ${clone.seconds.toFixed(1)}/${CLONE_TARGET_SECONDS}s`,
    cloning: 'Cloning voice…',
    ready: `Voice cloned · ${clone.seconds.toFixed(1)}s`,
    failed: 'Voice clone failed',
  }[clone.status];
  return <span className={`clone-tag clone-${clone.status}`}>{text}</span>;
}

/** Big "who's talking" label for the stage header, so judges can follow a live call. */
export function SpeakingTag() {
  const t = useTalk();
  const text = t.speaker
    ? `${NAMES[t.speaker]} speaking`
    : t.aiSpeaking
      ? 'Decoy speaking as Margaret'
      : null;
  if (!text) return null;
  return <span className={`speaking-tag ${t.speaker ?? 'ai'}`}>{text}</span>;
}

/** Start card. Starting needs a click or key press so the browser allows the mic and audio. */
export function StartCall() {
  const t = useTalk();
  if (t.status === 'live') return null;
  return (
    <div className="overlay">
      <div className="start-card">
        <h2>Live call on this laptop</h2>
        <ul>
          <li>
            <kbd>Space</kbd> hold to talk as the <strong>scammer</strong>
          </li>
          <li>
            {twoRooms() ? (
              <>
                <strong>Margaret</strong> talks on her headset; her turns start by themselves
              </>
            ) : (
              <>
                <kbd>Y</kbd> hold to talk as <strong>Margaret</strong>, until Decoy takes over
              </>
            )}
          </li>
          <li>
            <kbd>⇧T</kbd> force the takeover &nbsp; <kbd>Esc</kbd> end the call
          </li>
        </ul>
        <DevicePicker />
        {t.error && <p className="talk-error">{t.error}</p>}
        <button className="btn btn-big" onClick={() => startCall()} disabled={t.status === 'connecting'}>
          {t.status === 'connecting' ? 'Connecting…' : 'Start call'}
        </button>
      </div>
    </div>
  );
}

const ROLES: [Role, MediaDeviceKind, string][] = [
  ['scammerMic', 'audioinput', 'Scammer mic'],
  ['scammerOut', 'audiooutput', 'Scammer speaker'],
  ['margaretMic', 'audioinput', 'Margaret mic'],
  ['margaretOut', 'audiooutput', 'Margaret speaker'],
];

function autoLabel(role: Role) {
  if (role.startsWith('scammer')) return twoRooms() ? 'Auto (MacBook)' : 'System default';
  if (role === 'margaretMic') return 'Same as scammer (hold Y)';
  return twoRooms() ? 'Auto' : 'Same as scammer';
}

/** Which mic and speaker each side uses. Re-reads the list when a device is plugged in. */
function DevicePicker() {
  const t = useTalk();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => listAudioDevices().then(setDevices, (e) => setError(e instanceof Error ? e.message : String(e)));
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  const vad = t.settings.vad ?? VAD_DEFAULT;
  return (
    <div className="devices">
      {ROLES.map(([role, kind, label]) => (
        <label key={role}>
          {label}
          <select value={t.settings[role] ?? ''} onChange={(e) => setAudio({ [role]: e.target.value || undefined })}>
            <option value="">{autoLabel(role)}</option>
            {devices
              .filter((d) => d.kind === kind)
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Unnamed device'}
                </option>
              ))}
          </select>
        </label>
      ))}
      {twoRooms() && (
        <label>
          Margaret start level {vad.toFixed(3)}
          <input
            type="range"
            min={0.01}
            max={0.15}
            step={0.005}
            value={vad}
            onChange={(e) => setAudio({ vad: Number(e.target.value) })}
          />
        </label>
      )}
      {error && <p className="talk-error">{error}</p>}
    </div>
  );
}

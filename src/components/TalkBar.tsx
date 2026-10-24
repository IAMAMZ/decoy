import { CLONE_TARGET_SECONDS, endCall, startCall, typeTurn, useTalk, type Talker } from '../audio';

const NAMES: Record<Talker, string> = { caller: 'Scammer', customer: 'Margaret' };

/** Bottom bar in mic mode: who holds which key, who's talking, and how loud. */
export function TalkBar() {
  const t = useTalk();
  const live = t.status === 'live';
  return (
    <div className="controls talkbar">
      <span className={`src ${live ? 'src-on' : ''}`}>{live ? 'MIC · live' : `MIC · ${t.status}`}</span>
      <Key k="Space" who="caller" t={t} />
      <Key k="Y" who="customer" t={t} locked={t.mode === 'takeover'} />
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
  return (
    <span className={`ptt ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}>
      <kbd>{k}</kbd>
      {NAMES[who]}
      {locked && <em> · muted, Decoy has the call</em>}
      {on && (
        <span className="level" aria-hidden>
          <span style={{ width: `${Math.round(t.level * 100)}%` }} />
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
            <kbd>Y</kbd> hold to talk as <strong>Margaret</strong>, until Decoy takes over
          </li>
          <li>
            <kbd>⇧T</kbd> force the takeover &nbsp; <kbd>Esc</kbd> end the call
          </li>
        </ul>
        {t.error && <p className="talk-error">{t.error}</p>}
        <button className="btn btn-big" onClick={() => startCall()} disabled={t.status === 'connecting'}>
          {t.status === 'connecting' ? 'Connecting…' : 'Start call'}
        </button>
      </div>
    </div>
  );
}

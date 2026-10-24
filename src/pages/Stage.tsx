import { LiveScreen } from '../components/LiveScreen';
import { Wordmark } from '../components/Brand';
import { FLAG_LABEL, fmtClock, HARD_FLAGS, INTEL_LABEL, useNow, useTween } from '../components/format';
import { PhoneScreen } from '../components/PhoneScreen';
import { SummaryCard } from '../components/SummaryCard';
import { SpeakingTag } from '../components/TalkBar';
import { ToolLog } from '../components/ToolLog';
import { Transcript } from '../components/Transcript';
import type { Bridge } from '../events/browserBridge';
import type { CallState } from '../events/reducer';
import type { CallEvent } from '../events/types';
import { MIC } from '../events/useCallEvents';

// The demo layout: the phone, the live transcript, every tool call the agent makes, and the
// facts that matter. With the real browser connected (?browser), Decoy's screen sits on top so
// the real checks are visible; without it, transcript and tool calls fill the space.
const MODE_TEXT = {
  monitoring: 'Listening',
  protecting: 'Protecting the customer',
  takeover: 'Decoy has the call',
};

export function Stage({ state, browser, inject }: { state: CallState; browser: Bridge; inject: (ev: CallEvent) => void }) {
  const now = useNow(250);
  const score = useTween(state.score);
  const elapsed = state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0;

  return (
    <div className="stage">
      <PhoneScreen state={state} inject={inject} />
      <div className="stage-main">
        <header className="stage-head">
          <Wordmark />
          <span className={`mode-tag ${state.mode}`}>{MODE_TEXT[state.mode]}</span>
          {MIC && <SpeakingTag />}
          <span className="elapsed">{fmtClock(elapsed)}</span>
        </header>
        <div className="stage-body">
          <div className={`stage-center ${browser.connected ? 'with-screen' : ''}`}>
            {browser.connected && <LiveScreen bridge={browser} />}
            <div className="live-grid">
              <Transcript state={state} />
              <ToolLog tools={state.tools} startedAt={state.startedAt} title="Tool calls" />
            </div>
          </div>
          <aside className="rail">
            <div className="rail-block">
              <h2>Scam likelihood</h2>
              <div className={`rail-score ${state.score >= 0.8 ? 'hot' : ''}`}>{Math.round(score * 100)}%</div>
              <div className="rail-bar">
                <div style={{ width: `${state.score * 100}%` }} className={state.score >= 0.8 ? 'hot' : ''} />
              </div>
              <p className="rail-evidence">{state.evidence || 'Listening to the caller.'}</p>
            </div>
            <div className="rail-block">
              <h2>Red flags</h2>
              {state.flags.length === 0 && <p className="empty">None yet.</p>}
              <ul className="rail-flags">
                {state.flags.map((f) => (
                  <li key={f} className={`enter ${HARD_FLAGS.has(f) ? 'hard' : ''}`}>
                    {FLAG_LABEL[f] ?? f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rail-block grow">
              <h2>Caught from the scammer</h2>
              {state.intel.length === 0 && <p className="empty">Nothing yet.</p>}
              <ul className="rail-intel">
                {state.intel.map((i) => (
                  <li key={i.kind + i.value} className="enter">
                    <span>{INTEL_LABEL[i.kind]}</span>
                    {i.kind === 'tactic' ? <em>{i.value}</em> : <code>{i.value}</code>}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
      {state.summary && <SummaryCard summary={state.summary} />}
    </div>
  );
}

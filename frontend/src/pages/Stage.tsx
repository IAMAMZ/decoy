import { AgentScreen } from '../components/AgentScreen';
import { Wordmark } from '../components/Brand';
import { describeResult, fmtClock, INTEL_LABEL, TOOL_LABEL, useNow, useTween } from '../components/format';
import { PhoneScreen } from '../components/PhoneScreen';
import { SummaryCard } from '../components/SummaryCard';
import type { CallState } from '../events/reducer';

// The demo layout for judges: the phone, what the agent is doing, and three plain facts.
// Everything else lives on /dashboard.
const MODE_TEXT = {
  monitoring: 'Listening',
  protecting: 'Protecting Margaret',
  takeover: 'Decoy has the call',
};

export function Stage({ state }: { state: CallState }) {
  const now = useNow(60);
  const score = useTween(state.score);
  const elapsed = state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0;
  const actions = state.tools.filter((t) => t.status === 'done' && t.tool !== 'log_intel').slice(-5).reverse();

  return (
    <div className="stage">
      <PhoneScreen state={state} />
      <div className="stage-main">
        <header className="stage-head">
          <Wordmark />
          <span className={`mode-tag ${state.mode}`}>{MODE_TEXT[state.mode]}</span>
          <span className="elapsed">{fmtClock(elapsed)}</span>
        </header>
        <div className="stage-body">
          <AgentScreen tools={state.tools} now={now} />
          <aside className="rail">
            <div className="rail-block">
              <h2>Scam likelihood</h2>
              <div className={`rail-score ${state.score >= 0.8 ? 'hot' : ''}`}>{Math.round(score * 100)}%</div>
              <div className="rail-bar">
                <div style={{ width: `${state.score * 100}%` }} className={state.score >= 0.8 ? 'hot' : ''} />
              </div>
            </div>
            <div className="rail-block grow">
              <h2>What Decoy did</h2>
              {actions.length === 0 && <p className="empty">Nothing yet.</p>}
              <ul className="rail-actions">
                {actions.map((t) => {
                  const r = describeResult(t.tool, t.args, t.result);
                  return (
                    <li key={t.id} className="enter">
                      <strong>{TOOL_LABEL[t.tool] ?? t.tool}</strong>
                      <span className={`tone-${r.tone}`}>{r.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rail-block">
              <h2>Caught from the scammer</h2>
              {state.intel.length === 0 && <p className="empty">Nothing yet.</p>}
              <ul className="rail-intel">
                {state.intel
                  .filter((i) => i.kind !== 'tactic')
                  .map((i) => (
                    <li key={i.value} className="enter">
                      <span>{INTEL_LABEL[i.kind]}</span>
                      <code>{i.value}</code>
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

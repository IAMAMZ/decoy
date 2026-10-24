import { AgentBrowser } from '../components/AgentBrowser';
import { Wordmark } from '../components/Brand';
import { ConfidenceMeter, FlagPanel } from '../components/ConfidenceMeter';
import { fmtClock, useNow } from '../components/format';
import { IntelPanel } from '../components/IntelPanel';
import { SummaryCard } from '../components/SummaryCard';
import { ToolLog } from '../components/ToolLog';
import { Transcript } from '../components/Transcript';
import type { CallState } from '../events/reducer';
import type { Mode } from '../events/types';

const STEPS: { mode: Mode; label: string }[] = [
  { mode: 'monitoring', label: 'Monitoring' },
  { mode: 'protecting', label: 'Protecting' },
  { mode: 'takeover', label: 'Takeover' },
];

export function Dashboard({ state }: { state: CallState }) {
  const now = useNow(500);
  const elapsed = state.startedAt ? (state.endedAt ?? now) - state.startedAt : 0;
  const lat = state.latencies;
  const current = STEPS.findIndex((s) => s.mode === state.mode);

  return (
    <div className="dash">
      <header className="dash-head">
        <Wordmark />
        <span className="desk">Fraud desk</span>
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s.mode} className={i < current ? 'past' : i === current ? `current ${s.mode}` : ''}>
              {s.label}
            </li>
          ))}
        </ol>
        <dl className="meta">
          <div>
            <dt>Call</dt>
            <dd>{state.callId ?? '—'}</dd>
          </div>
          <div>
            <dt>{state.status === 'ended' ? 'Ended at' : 'Elapsed'}</dt>
            <dd>{fmtClock(elapsed)}</dd>
          </div>
          <div>
            <dt>Round trip</dt>
            <dd>{lat.length ? `${(lat[lat.length - 1] / 1000).toFixed(2)}s` : '—'}</dd>
          </div>
        </dl>
      </header>

      <div className="board">
        <ConfidenceMeter score={state.score} evidence={state.evidence} />
        <FlagPanel flags={state.flags} />
        <Transcript state={state} />
        <ToolLog tools={state.tools} startedAt={state.startedAt} />
        <AgentBrowser tools={state.tools} />
        <IntelPanel intel={state.intel} />
      </div>

      {state.summary && <SummaryCard summary={state.summary} />}
    </div>
  );
}

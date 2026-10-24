import { useEffect, useRef } from 'react';
import type { CallState } from '../events/reducer';
import { fmtClock } from './format';

const WHO = { caller: 'Caller', customer: 'Customer', ai: 'Customer (AI)' } as const;

const MARKERS = [
  { mode: 'protecting', text: 'Protecting customer' },
  { mode: 'takeover', text: 'Takeover · AI persona on the line' },
] as const;

export function Transcript({ state }: { state: CallState }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [state.transcript.length, state.mode]);

  const start = state.startedAt ?? 0;
  type Item = { key: string; ts: number; node: JSX.Element };
  const items: Item[] = state.transcript.map((l) => ({
    key: `l${l.id}`,
    ts: l.ts,
    node: (
      <div className={`line line-${l.speaker}`}>
        <span className="t">{fmtClock(l.ts - start)}</span>
        <span className="who">{WHO[l.speaker]}</span>
        <p>
          {l.text}
          {l.emotion && <em> ({l.emotion})</em>}
        </p>
      </div>
    ),
  }));
  for (const m of MARKERS) {
    const ts = state.modeChangedAt[m.mode];
    if (ts) items.push({ key: m.mode, ts, node: <div className={`marker marker-${m.mode}`}>{m.text}</div> });
  }
  items.sort((a, b) => a.ts - b.ts);

  return (
    <section className="cell transcript">
      <h2>
        Transcript <span className="credit">Higgs RealTime</span>
      </h2>
      <div className="scroll" ref={box}>
        {items.length === 0 && <p className="empty">Waiting for the call to connect.</p>}
        {items.map((i) => (
          <div key={i.key} className="enter">
            {i.node}
          </div>
        ))}
      </div>
    </section>
  );
}

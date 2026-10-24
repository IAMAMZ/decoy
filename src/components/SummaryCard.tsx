import { useEffect, useState } from 'react';
import type { SummaryData } from '../events/types';
import { Logo } from './Brand';

export function SummaryCard({ summary }: { summary: SummaryData }) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(true), [summary]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <article className="summary" onClick={(e) => e.stopPropagation()}>
        <header>
          <Logo size={20} />
          <span>Call closed. Report filed.</span>
          <button className="link" onClick={() => setOpen(false)}>
            Close
          </button>
        </header>
        <dl className="stats">
          <div>
            <dd>{summary.minutes_wasted.toFixed(1)}</dd>
            <dt>scammer minutes wasted</dt>
          </div>
          <div>
            <dd>${summary.dollars_protected.toLocaleString('en-US')}</dd>
            <dt>kept in the customer's account</dt>
          </div>
          <div>
            <dd>{summary.intel_count}</dd>
            <dt>intel records for the fraud team</dt>
          </div>
        </dl>
        <p className="report">{summary.report}</p>
      </article>
    </div>
  );
}

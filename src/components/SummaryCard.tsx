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

  const idMatch = summary.report.match(/\bReport\s+(FR-[\w-]+)\s+filed\.?$/i);
  const reportId = idMatch?.[1] ?? null;
  const narrative = idMatch ? summary.report.slice(0, idMatch.index).trim() : summary.report;

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <article className="summary" onClick={(e) => e.stopPropagation()}>
        <header>
          <Logo size={22} />
          <span>Call closed · Report filed</span>
          {reportId && <code className="report-id">{reportId}</code>}
          <button className="link" onClick={() => setOpen(false)}>
            Close (Esc)
          </button>
        </header>
        <div className="report-wrap">
          <div className="report-label">Incident summary</div>
          <p className="report">{narrative || summary.report}</p>
        </div>
      </article>
    </div>
  );
}

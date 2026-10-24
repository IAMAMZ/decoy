import { FLAG_LABEL, HARD_FLAGS, useTween } from './format';

const PROTECT = 0.6;
const TAKEOVER = 0.8;
const SEGMENTS = 50;

export function ConfidenceMeter({ score, evidence }: { score: number; evidence: string }) {
  const shown = useTween(score);
  const lit = Math.round(score * SEGMENTS);
  return (
    <section className="cell meter">
      <h2>
        Scam likelihood <span className="credit">Higgs Audio Understanding</span>
      </h2>
      <div className={`meter-num ${score >= TAKEOVER ? 'hot' : ''}`}>
        {shown.toFixed(2)}
      </div>
      <div className="segments" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={score}>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const at = i / SEGMENTS;
          const cls = i < lit ? (at >= TAKEOVER ? 'on hot' : at >= PROTECT ? 'on warm' : 'on') : '';
          return <span key={i} className={cls} />;
        })}
        <i style={{ left: `${PROTECT * 100}%` }}>protect 0.6</i>
        <i style={{ left: `${TAKEOVER * 100}%` }}>take over 0.8</i>
      </div>
      <p className="evidence">{evidence || 'Listening to the caller.'}</p>
    </section>
  );
}

// Every signal the detector can return, so the panel reads as a checklist that lights up.
export function FlagPanel({ flags }: { flags: string[] }) {
  return (
    <section className="cell flags">
      <h2>
        Signals <span className="count">{flags.length}/{Object.keys(FLAG_LABEL).length}</span>
      </h2>
      <ul>
        {Object.entries(FLAG_LABEL).map(([key, label]) => (
          <li key={key} className={`${flags.includes(key) ? 'on' : ''} ${HARD_FLAGS.has(key) ? 'hard' : ''}`}>
            <span className="box" />
            {label}
            {HARD_FLAGS.has(key) && <span className="hard-tag">hard</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

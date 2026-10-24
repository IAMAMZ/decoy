import type { Intel } from '../events/reducer';
import { INTEL_LABEL } from './format';

export function IntelPanel({ intel }: { intel: Intel[] }) {
  return (
    <section className="cell intel">
      <h2>
        Intelligence <span className="count">{intel.length}</span>
      </h2>
      <div className="scroll">
        {intel.length === 0 && (
          <p className="empty">Accounts, numbers and links the scammer gives away are captured here.</p>
        )}
        {intel.map((i) => (
          <div key={i.kind + i.value} className={`intel-item enter kind-${i.kind}`}>
            <span className="intel-kind">{INTEL_LABEL[i.kind]}</span>
            <span className="intel-value">{i.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

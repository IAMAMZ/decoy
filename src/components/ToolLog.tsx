import { useEffect, useRef } from 'react';
import type { ToolCall } from '../events/reducer';
import { describeResult, fmtClock } from './format';

// Rendered as a call trace: fn(args) then the result, which is what the agent actually did.
export function ToolLog({ tools, startedAt }: { tools: ToolCall[]; startedAt: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [tools]);

  const done = tools.filter((t) => t.status === 'done').length;
  return (
    <section className="cell tools">
      <h2>
        Agent actions <span className="count">{done}/{tools.length}</span>
      </h2>
      <div className="scroll trace" ref={box}>
        {tools.length === 0 && <p className="empty">No tool calls yet.</p>}
        {tools.map((t) => {
          const r = t.status === 'done' ? describeResult(t.tool, t.args, t.result) : null;
          return (
            <div key={t.id} className={`call enter call-${t.status}`}>
              <span className="t">{fmtClock(t.startedAt - (startedAt ?? t.startedAt))}</span>
              <div className="call-body">
                <div className="sig">
                  <span className="fn">{t.tool}</span>(
                  {Object.entries(t.args).map(([k, v], i) => (
                    <span key={k} className="arg">
                      {i > 0 && ', '}
                      {k}=<span className="val">{fmtArg(v)}</span>
                    </span>
                  ))}
                  )
                </div>
                <div className={`out ${r ? `tone-${r.tone}` : 'running'}`}>
                  {r ? r.text : 'running'}
                  {t.doneAt && <span className="dur">{t.doneAt - t.startedAt}ms</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtArg(v: unknown): string {
  const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  return s.length > 34 ? s.slice(0, 32) + '…"' : s;
}

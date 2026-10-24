import { useEffect, useRef, useState } from 'react';
import type { ToolCall } from '../events/reducer';
import { describeResult, fmtClock, TOOL_LABEL } from './format';

// Rendered as a call trace: fn(args) then the result, which is what the agent actually did.
// Click a call to see its raw arguments and result.
export function ToolLog({ tools, startedAt, title = 'Agent actions' }: { tools: ToolCall[]; startedAt: number | null; title?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [tools.length]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const done = tools.filter((t) => t.status === 'done').length;
  return (
    <section className="cell tools">
      <h2>
        {title} <span className="count">{done}/{tools.length}</span>
      </h2>
      <div className="scroll trace" ref={box}>
        {tools.length === 0 && <p className="empty">No tool calls yet.</p>}
        {tools.map((t) => {
          const r = t.status === 'done' ? describeResult(t.tool, t.args, t.result) : null;
          const expanded = open.has(t.id);
          return (
            <div
              key={t.id}
              className={`call enter call-${t.status} ${t.tool === 'analyze_turn' ? 'call-brain' : ''} ${expanded ? 'open' : ''}`}
              onClick={() => toggle(t.id)}
              title="Click for the raw arguments and result"
            >
              <span className="t">{fmtClock(t.startedAt - (startedAt ?? t.startedAt))}</span>
              <div className="call-body">
                <div className="sig">
                  <span className="fn">{t.tool}</span>(
                  {Object.entries(t.args).map(([k, v], i) => (
                    <span key={k} className="arg">
                      {i > 0 && ', '}
                      {k}=<span className="val">{fmtArg(k, v)}</span>
                    </span>
                  ))}
                  )
                  {TOOL_LABEL[t.tool] && <span className="call-label">{TOOL_LABEL[t.tool]}</span>}
                </div>
                <div className={`out ${r ? `tone-${r.tone}` : 'running'}`}>
                  {r ? r.text : 'running'}
                  {t.doneAt && <span className="dur">{t.doneAt - t.startedAt}ms</span>}
                </div>
                {expanded && (
                  <pre className="raw" onClick={(e) => e.stopPropagation()}>
                    {JSON.stringify({ args: t.args, result: t.result ?? null }, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtArg(key: string, v: unknown): string {
  const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  const max = key === 'line' ? 140 : 34; // the brain's input line is the point: show it
  return s.length > max ? s.slice(0, max - 2) + '…"' : s;
}

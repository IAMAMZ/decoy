import { useLayoutEffect, useRef, useState } from 'react';
import type { ToolCall } from '../events/reducer';
import { BROWSE_TOOLS, describeResult } from './format';

// A "computer use" view: each browse tool call plays as a short scene where a cursor
// types, clicks and highlights the finding. Scripted from the tool call's args and result;
// the real browsing happens in the backend tool.

type Step = { at: number; target: string; click?: boolean };
type Scene = {
  dur: number;
  steps: Step[];
  typeInto: 'search' | 'address';
  text: string;
  typeStart: number;
  typeEnd: number;
  submitAt: number;
  highlightAt: number;
  caption: string;
};

function sceneFor(t: ToolCall): Scene {
  if (t.tool === 'web_search') {
    const q = String(t.args.query);
    return {
      dur: 6200,
      typeInto: 'search',
      text: q,
      typeStart: 1000,
      typeEnd: 2500,
      submitAt: 2700,
      highlightAt: 4300,
      caption: `Searching the web for ${q}`,
      steps: [
        { at: 0, target: 'rest' },
        { at: 150, target: 'search-box' },
        { at: 850, target: 'search-box', click: true },
        { at: 3500, target: 'result-0' },
        { at: 4300, target: 'result-0', click: true },
      ],
    };
  }
  const url = t.tool === 'check_domain' ? `whois.lookup/${t.args.domain}` : String(t.args.url);
  return {
    dur: 6200,
    typeInto: 'address',
    text: url,
    typeStart: 900,
    typeEnd: 2100,
    submitAt: 2300,
    highlightAt: 4000,
    caption: t.tool === 'check_domain' ? `Checking who registered ${t.args.domain}` : `Opening ${url}`,
    steps: [
      { at: 0, target: 'rest' },
      { at: 150, target: 'address' },
      { at: 750, target: 'address', click: true },
      { at: 3200, target: 'highlight' },
      { at: 4000, target: 'highlight', click: true },
    ],
  };
}

export function AgentScreen({ tools, now }: { tools: ToolCall[]; now: number }) {
  const visits = tools.filter((t) => BROWSE_TOOLS.has(t.tool));
  const queue = useRef<{ id: string; start: number }[]>([]);

  // Play scenes back to back: each one starts when it arrives or when the previous ends.
  for (const v of visits) {
    if (queue.current.some((q) => q.id === v.id)) continue;
    const prev = queue.current[queue.current.length - 1];
    const prevEnd = prev ? prev.start + sceneFor(visits.find((x) => x.id === prev.id)!).dur : 0;
    queue.current.push({ id: v.id, start: Math.max(now, prevEnd) });
  }
  if (visits.length === 0 && queue.current.length) queue.current = []; // replay restarted

  const playing = [...queue.current].reverse().find((q) => q.start <= now);
  const tool = playing ? visits.find((v) => v.id === playing.id) : undefined;
  const scene = tool ? sceneFor(tool) : null;
  const t = playing ? now - playing.start : 0;

  const win = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: 70, y: 75 });
  const step = scene ? [...scene.steps].reverse().find((s) => s.at <= t) : undefined;
  const target = step?.target ?? 'rest';

  const submitted = !!scene && t >= scene.submitAt;
  const loaded = submitted && tool?.status === 'done' && t >= scene!.submitAt + 500;
  const highlighted = loaded && t >= scene!.highlightAt;

  useLayoutEffect(() => {
    const box = win.current;
    if (!box) return;
    const el = box.querySelector(`[data-target="${target}"]`);
    if (!el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setCursor({
      x: ((r.left + Math.min(r.width * 0.3, 60) - b.left) / b.width) * 100,
      y: ((r.top + r.height / 2 - b.top) / b.height) * 100,
    });
  }, [target, loaded, tool?.id]);

  let typed = '';
  if (scene) {
    const k = Math.min(1, Math.max(0, (t - scene.typeStart) / (scene.typeEnd - scene.typeStart)));
    typed = scene.text.slice(0, Math.round(k * scene.text.length));
  }
  const address = !scene
    ? 'about:blank'
    : scene.typeInto === 'address'
      ? typed
      : submitted
        ? `search?q=${encodeURIComponent(scene.text)}`
        : 'search.home';
  const click = step?.click && t - step.at < 450 ? step.at : null;
  const r = tool?.status === 'done' ? describeResult(tool.tool, tool.args, tool.result) : null;

  return (
    <section className="agent-screen">
      <div className="as-head">
        <span className={`live-dot ${scene ? 'on' : ''}`} />
        Decoy's screen
        <span className="credit">agent web tools</span>
      </div>
      <div className="as-window" ref={win}>
        <div className="as-bar">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <div className={`as-address ${scene?.typeInto === 'address' && t < scene.submitAt ? 'focus' : ''}`} data-target="address">
            {address}
            {scene?.typeInto === 'address' && t >= scene.typeStart && t < scene.submitAt && <span className="caret" />}
          </div>
        </div>
        <div className={`loading ${submitted && !loaded ? 'on' : ''}`} />
        <div className="as-view">
          {!scene && <Standby />}
          {scene && !submitted && scene.typeInto === 'search' && <SearchHome typed={typed} typing={t >= scene.typeStart} />}
          {scene && !submitted && scene.typeInto === 'address' && <div className="as-blank" />}
          {scene && submitted && !loaded && <div className="as-blank" />}
          {tool && loaded && <Content tool={tool} highlighted={highlighted} />}
        </div>
        <Cursor x={cursor.x} y={cursor.y} hidden={!scene} />
        {click !== null && <span key={click} className="click-ring" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }} />}
      </div>
      <p className={`as-caption ${highlighted && r ? 'found' : ''}`}>
        {!scene ? 'Waiting for something to check.' : highlighted && r ? r.text : scene.caption}
      </p>
    </section>
  );
}

function Standby() {
  return (
    <div className="as-standby" data-target="rest">
      <span>Idle. Decoy opens the browser when it needs to check something.</span>
    </div>
  );
}

function SearchHome({ typed, typing }: { typed: string; typing: boolean }) {
  return (
    <div className="search-home" data-target="rest">
      <div className="sh-title">Search</div>
      <div className={`sh-box ${typing ? 'focus' : ''}`} data-target="search-box">
        {typed}
        {typing && <span className="caret" />}
      </div>
    </div>
  );
}

function Content({ tool, highlighted }: { tool: ToolCall; highlighted: boolean }) {
  const r = (tool.result ?? {}) as Record<string, any>;
  if (tool.tool === 'web_search') {
    return (
      <ol className="as-results enter">
        {(r.results as { title: string; url: string; snippet: string }[]).map((x, i) => (
          <li key={x.url} data-target={`result-${i}`} className={i === 0 && highlighted ? 'hl' : ''}>
            <span className="r-url">{x.url}</span>
            <span className="r-title">{x.title}</span>
            <span className="r-snippet">{x.snippet}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (tool.tool === 'check_domain') {
    return (
      <div className="as-page enter">
        <h3>WHOIS record</h3>
        <dl className="whois">
          <dt>Domain</dt>
          <dd>{r.domain}</dd>
          <dt>Registered</dt>
          <dd data-target="highlight" className={highlighted ? 'hl' : ''}>
            {r.registered} ({r.age_days} days ago)
          </dd>
          <dt>Registrar</dt>
          <dd>{r.registrar}</dd>
          <dt>Owner</dt>
          <dd>{r.owner}</dd>
        </dl>
      </div>
    );
  }
  const [before, after] = String(r.excerpt).split(r.highlight ?? '\u0000');
  return (
    <article className="as-page enter">
      <h3>{r.title}</h3>
      <p>
        {before}
        {after !== undefined && (
          <mark data-target="highlight" className={highlighted ? 'hl' : ''}>
            {r.highlight}
          </mark>
        )}
        {after}
      </p>
    </article>
  );
}

function Cursor({ x, y, hidden }: { x: number; y: number; hidden: boolean }) {
  return (
    <svg className={`as-cursor ${hidden ? 'hidden' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 2.5l15 9.2-6.6 1.6 3.9 7.2-2.6 1.4-3.9-7.3L4.9 19z" fill="#fff" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

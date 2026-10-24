import { useLayoutEffect, useRef, useState } from 'react';
import type { Bridge, Session } from '../events/browserBridge';

// Decoy's screen when the real browser service is connected: Chrome's live frames,
// with the cursor drawn where the agent is actually pointing.
const PAGE_W = 1280;
const PAGE_H = 800;

export function LiveScreen({ bridge }: { bridge: Bridge }) {
  const s = bridge.current ? bridge.sessions[bridge.current] : undefined;
  const busy = !!s && !s.result && !s.error;
  const caption = !s
    ? 'Waiting for something to check.'
    : s.result
      ? s.result.summary
      : s.error
        ? s.error
        : s.caption;

  return (
    <section className="agent-screen">
      <div className="as-head">
        <span className={`live-dot ${busy ? 'on' : ''}`} />
        Decoy's screen
        <span className="credit">live · real Chrome</span>
      </div>
      {s ? <Window s={s} /> : <IdleWindow />}
      <p className={`as-caption ${s?.result && !s.result.error ? 'found' : ''}`}>{caption}</p>
    </section>
  );
}

function IdleWindow() {
  return (
    <div className="as-window">
      <div className="as-bar">
        <Dots />
        <div className="as-address">about:blank</div>
      </div>
      <div className="as-view">
        <div className="as-standby">Idle. Decoy opens the browser when it needs to check something.</div>
      </div>
    </div>
  );
}

function Window({ s }: { s: Session }) {
  const win = useRef<HTMLDivElement>(null);
  const [targetPos, setTargetPos] = useState<{ x: number; y: number } | null>(null);
  const target = s.cursor && 'target' in s.cursor ? s.cursor.target : null;

  // Cursor aimed at our own UI (address bar, search box, a result): measure that element.
  useLayoutEffect(() => {
    const box = win.current;
    const el = target && box?.querySelector(`[data-target="${target}"]`);
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTargetPos({
      x: ((r.left + Math.min(r.width * 0.3, 60) - b.left) / b.width) * 100,
      y: ((r.top + r.height / 2 - b.top) / b.height) * 100,
    });
  }, [target, s.view, s.results]);

  const onPage = s.cursor && 'x' in s.cursor ? s.cursor : null;

  return (
    <div className="as-window" ref={win}>
      <div className="as-bar">
        <Dots />
        <div className={`as-address ${s.addressTyping ? 'focus' : ''}`} data-target="address">
          {s.address || 'about:blank'}
          {s.addressTyping && <span className="caret" />}
        </div>
      </div>
      <div className={`loading ${s.loading ? 'on' : ''}`} />
      <div className="as-view">
        {s.view === 'search' && <SearchView s={s} />}
        {s.view === 'screen' && (
          <div className="as-shot">
            {s.frame && <img src={`data:image/jpeg;base64,${s.frame}`} alt="Live view of the agent's browser" />}
            {onPage && <Pointer x={(onPage.x / PAGE_W) * 100} y={(onPage.y / PAGE_H) * 100} click={s.clickSeq} />}
          </div>
        )}
        {s.card && <WhoisCard d={s.card} />}
      </div>
      {!onPage && targetPos && <Pointer x={targetPos.x} y={targetPos.y} click={s.clickSeq} />}
    </div>
  );
}

function SearchView({ s }: { s: Session }) {
  if (!s.results) {
    return (
      <div className="search-home">
        <div className="sh-title">Search</div>
        <div className={`sh-box ${s.typed ? 'focus' : ''}`} data-target="search-box">
          {s.typed}
          <span className="caret" />
        </div>
      </div>
    );
  }
  return (
    <ol className="as-results enter">
      {s.results.map((x, i) => (
        <li key={x.url} data-target={`result-${i}`}>
          <span className="r-url">{x.url}</span>
          <span className="r-title">{x.title}</span>
          <span className="r-snippet">{x.snippet}</span>
        </li>
      ))}
    </ol>
  );
}

function WhoisCard({ d }: { d: Record<string, any> }) {
  return (
    <dl className="whois-card enter">
      <dt>Domain</dt>
      <dd>{d.domain}</dd>
      <dt>Registered</dt>
      <dd className={d.registered ? '' : 'bad'}>{d.registered ? 'yes' : 'no, it doesn’t exist'}</dd>
      {d.registered_on && (
        <>
          <dt>Since</dt>
          <dd className={d.age_days < 90 ? 'bad' : ''}>
            {d.registered_on} ({d.age_days} days)
          </dd>
        </>
      )}
      {d.registrar && (
        <>
          <dt>Registrar</dt>
          <dd>{d.registrar}</dd>
        </>
      )}
      <dt>Source</dt>
      <dd>RDAP registry lookup</dd>
    </dl>
  );
}

function Pointer({ x, y, click }: { x: number; y: number; click: number }) {
  return (
    <>
      <svg className="as-cursor" style={{ left: `${x}%`, top: `${y}%` }} width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path d="M4 2.5l15 9.2-6.6 1.6 3.9 7.2-2.6 1.4-3.9-7.3L4.9 19z" fill="#fff" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      {click > 0 && <span key={click} className="click-ring" style={{ left: `${x}%`, top: `${y}%` }} />}
    </>
  );
}

function Dots() {
  return (
    <span className="dots">
      <i />
      <i />
      <i />
    </span>
  );
}

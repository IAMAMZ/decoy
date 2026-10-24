import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Bridge, Session } from '../events/browserBridge';

// Decoy's screen when the real browser service is connected: Chrome's live frames,
// with the cursor drawn where the agent is actually pointing. A person can drive it too:
// click, scroll and type on the page, or use the address bar and back/forward/reload.
const PAGE_W = 1280;
const PAGE_H = 800;
// Keys sent as presses; everything else arrives as typed text (so IME input works too).
const SPECIAL = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const MOVE_MS = 80; // hover updates at most this often

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
      {s ? <Window s={s} send={bridge.send} /> : <IdleWindow />}
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

function Window({ s, send }: { s: Session; send: Bridge['send'] }) {
  const win = useRef<HTMLDivElement>(null);
  const shot = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastMove = useRef(0);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [targetPos, setTargetPos] = useState<{ x: number; y: number } | null>(null);
  const target = s.cursor && 'target' in s.cursor ? s.cursor.target : null;

  // Screen pixels -> Chrome's page pixels (the frame is drawn at 1280x800, scaled to fit).
  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = shot.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAGE_W, y: ((e.clientY - r.top) / r.height) * PAGE_H };
  };

  // Wheel needs a non-passive listener, or our own page scrolls along with Chrome's.
  useEffect(() => {
    const el = shot.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      send({ action: 'wheel', ...toPage(e), dx: e.deltaX, dy: e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [send, s.view]);

  const typeOut = (el: HTMLTextAreaElement) => {
    if (el.value) send({ action: 'type', text: el.value });
    el.value = '';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'v') return; // let the paste land in the textarea, then type it
    if (!mod && !SPECIAL.has(e.key)) return; // plain characters come through onInput
    e.preventDefault();
    const mods = [e.ctrlKey && 'Control', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    send({ action: 'key', key: [...mods, key].join('+') });
  };

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
        <div className="as-nav">
          <button type="button" title="Back" onClick={() => send({ action: 'back' })}>←</button>
          <button type="button" title="Forward" onClick={() => send({ action: 'forward' })}>→</button>
          <button type="button" title="Reload" onClick={() => send({ action: 'reload' })}>↻</button>
        </div>
        <form
          className={`as-address ${s.addressTyping || editing ? 'focus' : ''}`}
          data-target="address"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send({ action: 'navigate', url: draft.trim() });
            (e.currentTarget.elements[0] as HTMLInputElement).blur();
          }}
        >
          <input
            value={editing ? draft : s.address}
            placeholder="about:blank"
            spellCheck={false}
            aria-label="Address"
            onFocus={(e) => {
              const el = e.currentTarget;
              setDraft(s.address);
              setEditing(true);
              requestAnimationFrame(() => el.select());
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setDraft(e.target.value)}
          />
          {s.addressTyping && <span className="caret" />}
        </form>
      </div>
      <div className={`loading ${s.loading ? 'on' : ''}`} />
      <div className="as-view">
        {s.view === 'search' && <SearchView s={s} />}
        {s.view === 'screen' && (
          <div
            ref={shot}
            className={`as-shot interactive ${focused ? 'focused' : ''}`}
            onClick={(e) => {
              send({ action: 'click', ...toPage(e), count: e.detail || 1 });
              keys.current?.focus({ preventScroll: true });
            }}
            onMouseMove={(e) => {
              const now = performance.now();
              if (now - lastMove.current < MOVE_MS) return;
              lastMove.current = now;
              send({ action: 'move', ...toPage(e) });
            }}
          >
            {s.frame && <img src={`data:image/jpeg;base64,${s.frame}`} alt="Live view of the agent's browser" draggable={false} />}
            {onPage && <Pointer x={(onPage.x / PAGE_W) * 100} y={(onPage.y / PAGE_H) * 100} click={s.clickSeq} />}
            {/* Catches typing while the page is focused. Push-to-talk ignores keys typed into a textarea. */}
            <textarea
              ref={keys}
              className="as-keys"
              aria-label="Type into the page"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              onInput={(e) => !composing.current && typeOut(e.currentTarget)}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={(e) => {
                composing.current = false;
                typeOut(e.currentTarget);
              }}
            />
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

import type { Replay } from '../events/useCallEvents';

export function ReplayControls({
  live,
  connected,
  replay,
  realBrowser,
}: {
  live: boolean;
  connected: boolean;
  replay: Replay;
  realBrowser: boolean;
}) {
  return (
    <div className="controls">
      <span className={`src ${realBrowser ? 'src-on' : ''}`}>{realBrowser ? 'browser: real' : 'browser: scripted'}</span>
      {live ? (
        <span className={`src ${connected ? 'src-on' : ''}`}>{connected ? 'LIVE · /ws/events' : 'LIVE · connecting…'}</span>
      ) : (
        <>
          <span className="src">REPLAY · fake_events.json</span>
          <button className="btn btn-sm" onClick={replay.toggle}>
            {replay.playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn btn-sm" onClick={replay.restart}>
            Restart
          </button>
          {[1, 2, 4].map((x) => (
            <button key={x} className={`btn btn-sm ${replay.speed === x ? 'btn-on' : ''}`} onClick={() => replay.setSpeed(x)}>
              {x}×
            </button>
          ))}
          <div className="progress">
            <div style={{ width: `${replay.progress * 100}%` }} />
          </div>
        </>
      )}
      <nav>
        <a href={withBrowser()}>Browser</a>
        <a href={`/${window.location.search || '?replay'}`}>Stage</a>
        <a href={`/dashboard${window.location.search}`}>Dashboard</a>
        <a href={`/call${window.location.search}`}>Call</a>
        <a href={`/caller${window.location.search}`}>Caller</a>
      </nav>
      <span className="keys">Space play · R restart · ⇧T takeover · ⇧S score · H hide</span>
    </div>
  );
}

// The stage with the real browser (backend/server.py) on: the same query plus ?browser.
function withBrowser(): string {
  const q = new URLSearchParams(window.location.search);
  if (q.has('browser')) return `/${window.location.search}`;
  return `/${window.location.search ? `${window.location.search}&` : '?'}browser`;
}

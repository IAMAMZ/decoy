import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReplayControls } from './components/ReplayControls';
import type { CallState } from './events/reducer';
import type { CallEvent } from './events/types';
import { LIVE, useCallEvents } from './events/useCallEvents';
import { Call } from './pages/Call';
import { Caller } from './pages/Caller';
import { Dashboard } from './pages/Dashboard';
import { Stage } from './pages/Stage';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

const TAKEOVER_LINE = "This looks like a scam. Don't worry, I'll handle it from here.";

function App() {
  const { state, connected, replay, inject } = useCallEvents();
  const [showControls, setShowControls] = useState(true);
  const path = window.location.pathname;

  // Hidden demo keys (brief, Part 5). Live: hit Yun's debug routes. Replay: fake the events locally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ev = (type: CallEvent['type'], data: object) =>
        ({ type, call_id: state.callId ?? 'demo', ts: Date.now(), data }) as CallEvent;
      if (e.shiftKey && e.key === 'T') {
        if (LIVE) fetch('/debug/takeover', { method: 'POST' });
        else {
          inject(ev('mode', { mode: 'takeover' }));
          inject(ev('avatar', { text: TAKEOVER_LINE }));
        }
      } else if (e.shiftKey && e.key === 'S') {
        if (LIVE) fetch('/debug/score?value=0.9', { method: 'POST' });
        else inject(ev('score', { score: 0.9, flags: [], evidence: 'Manual override.' }));
      } else if (LIVE || e.shiftKey || e.metaKey || e.ctrlKey) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        replay.toggle();
      } else if (e.key === 'r') replay.restart();
      else if (e.key === 'h') setShowControls((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.callId, inject, replay]);

  return (
    <>
      <Page path={path} state={state} />
      {showControls && path !== '/caller' && <ReplayControls live={LIVE} connected={connected} replay={replay} />}
    </>
  );
}

function Page({ path, state }: { path: string; state: CallState }) {
  switch (path) {
    case '/dashboard':
      return <Dashboard state={state} />;
    case '/call':
      return <Call state={state} />;
    case '/caller':
      return <Caller />;
    default:
      return <Stage state={state} />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

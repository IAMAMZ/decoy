import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configureCall, endCall, setMode, startCall } from './audio';
import { ReplayControls } from './components/ReplayControls';
import { StartCall, TalkBar } from './components/TalkBar';
import { useBrowserBridge, type Bridge } from './events/browserBridge';
import type { CallState } from './events/reducer';
import type { CallEvent } from './events/types';
import { LIVE, MIC, useCallEvents } from './events/useCallEvents';
import { Call } from './pages/Call';
import { Caller } from './pages/Caller';
import { Dashboard } from './pages/Dashboard';
import { Stage } from './pages/Stage';
import { useFamilyAlert } from './tools/notifyFamily';
import { useAgent } from './agent/useAgent';
import { AVATAR_VIDEO, TAKEOVER_LINE } from './agent/avatar';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

const REAL_BROWSER = true;
const BROWSER_OFF: Bridge = { connected: false, sessions: {}, current: null, send: () => {} };

function App() {
  const { state, connected, replay, inject } = useCallEvents();
  // Real Chrome (backend/server.py) connects only with ?browser. When it's up, the agent runs Yun's
  // real checks on it and Decoy's screen shows them; without it, the agent's built-in checks run.
  // Set REAL_BROWSER to false to never connect.
  const browser = REAL_BROWSER ? useBrowserBridge(state.tools, state.callId, inject) : BROWSER_OFF;
  useFamilyAlert(state, inject);
  useAgent(state, inject);
  const [showControls, setShowControls] = useState(true);
  const path = window.location.pathname;

  // Mic mode: the voice loop reports into the same reducer, and follows its mode.
  useEffect(() => configureCall(inject), [inject]);
  useEffect(() => {
    if (MIC) setMode(state.mode);
  }, [state.mode]);

  // Hidden demo keys (brief, Part 5). Live: hit Yun's debug routes. Replay/mic: fake the events locally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ev = (type: CallEvent['type'], data: object) =>
        ({ type, call_id: state.callId ?? 'demo', ts: Date.now(), data }) as CallEvent;
      if (e.shiftKey && e.key === 'T') {
        if (LIVE) fetch('/debug/takeover', { method: 'POST' });
        else {
          inject(ev('mode', { mode: 'takeover' }));
          inject(ev('avatar', { text: TAKEOVER_LINE, video_url: AVATAR_VIDEO }));
        }
      } else if (e.shiftKey && e.key === 'S') {
        if (LIVE) fetch('/debug/score?value=0.9', { method: 'POST' });
        else inject(ev('score', { score: 0.9, flags: [], evidence: 'Manual override.' }));
      } else if (MIC) {
        // Space and Y are push-to-talk (handled in src/audio); Enter starts, Escape ends.
        if (e.key === 'Enter') startCall();
        else if (e.key === 'Escape') endCall();
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
      <Page path={path} state={state} browser={browser} />
      {/* Only before the first call: afterwards the summary card stays visible, and the bar restarts. */}
      {MIC && path !== '/caller' && state.status === 'idle' && <StartCall />}
      {MIC ? (
        <TalkBar />
      ) : (
        showControls &&
        path !== '/caller' && (
          <ReplayControls live={LIVE} connected={connected} replay={replay} realBrowser={browser.connected} />
        )
      )}
    </>
  );
}

function Page({ path, state, browser }: { path: string; state: CallState; browser: Bridge }) {
  switch (path) {
    case '/dashboard':
      return <Dashboard state={state} />;
    case '/call':
      return <Call state={state} />;
    case '/caller':
      return <Caller />;
    default:
      return <Stage state={state} browser={browser} />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BROWSE_TOOLS } from '../components/format';
import script from '../data/fake_events.json';
import { bridge } from './browserBridge';
import { initialState, reduce, type Action } from './reducer';
import type { CallEvent } from './types';

// ?live → read Yun's /ws/events; otherwise replay fake_events.json (ts there is ms from the start).
export const LIVE = new URLSearchParams(window.location.search).has('live');

const SCRIPT = (script as unknown as CallEvent[]).slice().sort((a, b) => a.ts - b.ts);
const TOTAL = SCRIPT[SCRIPT.length - 1].ts;

export type Replay = {
  playing: boolean;
  speed: number;
  progress: number;
  toggle: () => void;
  restart: () => void;
  setSpeed: (x: number) => void;
};

export function useCallEvents() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);
  const replay = useReplay(dispatch, !LIVE);

  useEffect(() => {
    if (!LIVE) return;
    let ws: WebSocket;
    let retry = 0;
    let closed = false;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws/events`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        try {
          dispatch(JSON.parse(m.data) as CallEvent);
        } catch {
          console.warn('Bad event', m.data);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, []);

  // Local events for the hidden demo keys while replaying.
  const inject = useCallback((ev: CallEvent) => dispatch(ev), []);

  return { state, connected, replay, inject };
}

function useReplay(dispatch: (a: Action) => void, enabled: boolean): Replay {
  const idx = useRef(0);
  const playhead = useRef(0); // script ms at the last pause/segment start
  const segWall = useRef(0); // wall clock when the current segment started
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const timer = useRef<number>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [progress, setProgress] = useState(0);

  const ctl = useRef({
    current() {
      return playingRef.current
        ? playhead.current + (performance.now() - segWall.current) * speedRef.current
        : playhead.current;
    },
    schedule() {
      if (idx.current >= SCRIPT.length) {
        ctl.current.pause();
        playhead.current = TOTAL;
        setProgress(1);
        return;
      }
      const ev = SCRIPT[idx.current];
      const delay = Math.max(0, (ev.ts - ctl.current.current()) / speedRef.current);
      timer.current = window.setTimeout(() => {
        // With the real browser connected, its live results replace the scripted ones.
        const mockBrowseResult =
          ev.type === 'tool_call' && ev.data.status === 'done' && BROWSE_TOOLS.has(ev.data.tool);
        if (!(bridge.connected && mockBrowseResult)) dispatch({ ...ev, ts: Date.now() });
        idx.current++;
        ctl.current.schedule();
      }, delay);
    },
    play() {
      if (playingRef.current) return;
      if (idx.current >= SCRIPT.length) return ctl.current.restart();
      segWall.current = performance.now();
      playingRef.current = true;
      setPlaying(true);
      ctl.current.schedule();
    },
    pause() {
      playhead.current = ctl.current.current();
      playingRef.current = false;
      clearTimeout(timer.current);
      setPlaying(false);
    },
    restart() {
      ctl.current.pause();
      idx.current = 0;
      playhead.current = 0;
      setProgress(0);
      dispatch({ type: 'reset' });
      ctl.current.play();
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const c = ctl.current;
    // ?at=29000 jumps straight to that point of the script (handy for rehearsing one section).
    const at = Number(new URLSearchParams(window.location.search).get('at'));
    if (at > 0 && idx.current === 0) {
      const now = Date.now();
      while (idx.current < SCRIPT.length && SCRIPT[idx.current].ts <= at) {
        const ev = SCRIPT[idx.current++];
        dispatch({ ...ev, ts: now - (at - ev.ts) });
      }
      playhead.current = at;
    }
    const t = window.setTimeout(() => idx.current < SCRIPT.length && c.play(), 600);
    return () => {
      clearTimeout(t);
      c.pause();
    };
  }, [enabled]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setProgress(Math.min(1, ctl.current.current() / TOTAL)), 200);
    return () => clearInterval(t);
  }, [playing]);

  return {
    playing,
    speed,
    progress,
    toggle: () => (playingRef.current ? ctl.current.pause() : ctl.current.play()),
    restart: () => ctl.current.restart(),
    setSpeed: (x) => {
      const was = playingRef.current;
      if (was) ctl.current.pause();
      speedRef.current = x;
      setSpeedState(x);
      if (was) ctl.current.play();
    },
  };
}

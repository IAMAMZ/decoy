import { useEffect, useRef, useState } from 'react';
import { BROWSE_TOOLS } from '../components/format';
import type { ToolCall } from './reducer';
import type { CallEvent } from './types';
import { LIVE } from './useCallEvents';

// Connects to the real browser service (backend/browser, port 8001). When it's up, every
// browse tool call is run for real and its screen is streamed here; the real result then
// replaces the mock one. When it's down, the scripted animation plays instead.

export type Cursor = { x: number; y: number } | { target: string };

export type Session = {
  id: string;
  tool: string;
  address: string;
  addressTyping: boolean;
  view: 'search' | 'screen' | null;
  query: string;
  typed: string;
  results: { title: string; url: string; snippet: string }[] | null;
  frame: string | null;
  cursor: Cursor | null;
  clickSeq: number;
  caption: string;
  card: Record<string, any> | null;
  loading: boolean;
  result: Record<string, any> | null;
  error: string | null;
};

// Read by the replay so it doesn't dispatch mock results for tools the real browser runs.
export const bridge = { connected: false };

// The Python browser service was removed when we went browser-only (see git history,
// commit dc958d9, to bring it back). Only try to reach it when asked with ?browser.
const ENABLED = new URLSearchParams(window.location.search).has('browser');

export type Bridge = { connected: boolean; sessions: Record<string, Session>; current: string | null };

export function useBrowserBridge(tools: ToolCall[], callId: string | null, inject: (ev: CallEvent) => void): Bridge {
  const ws = useRef<WebSocket | null>(null);
  const sent = useRef(new Set<string>());
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const callRef = useRef(callId);
  callRef.current = callId;
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!ENABLED) return;
    let closed = false;
    let retry = 0;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${window.location.host}/browser/ws`);
      ws.current = sock;
      sock.onopen = () => {
        bridge.connected = true;
        setConnected(true);
      };
      sock.onclose = () => {
        bridge.connected = false;
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      sock.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        setCurrent(msg.id);
        setSessions((all) => ({ ...all, [msg.id]: apply(all[msg.id] ?? blank(msg.id, toolsRef.current), msg) }));
        // In live mode the agent backend started the run and emits the tool_call result itself.
        if (!LIVE && (msg.type === 'result' || msg.type === 'error')) {
          const t = toolsRef.current.find((x) => x.id === msg.id);
          if (!t) return;
          const result = msg.type === 'result' ? msg.result : { summary: msg.message, error: true };
          inject({
            type: 'tool_call',
            call_id: callRef.current ?? 'demo',
            ts: Date.now(),
            data: { id: t.id, tool: t.tool, args: t.args, status: 'done', result },
          });
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      bridge.connected = false;
      ws.current?.close();
    };
  }, [inject]);

  useEffect(() => {
    if (tools.length === 0 && sent.current.size) {
      sent.current.clear(); // replay restarted
      setSessions({});
      setCurrent(null);
    }
    if (LIVE || !connected || ws.current?.readyState !== WebSocket.OPEN) return; // live: only watch
    for (const t of tools) {
      // Only run calls still in flight; ones already finished (e.g. skipped past with ?at=) keep their result.
      if (!BROWSE_TOOLS.has(t.tool) || t.status !== 'started' || sent.current.has(t.id)) continue;
      sent.current.add(t.id);
      ws.current.send(JSON.stringify({ id: t.id, tool: t.tool, args: t.args }));
    }
  }, [tools, connected]);

  return { connected, sessions, current };
}

function blank(id: string, tools: ToolCall[]): Session {
  return {
    id,
    tool: tools.find((t) => t.id === id)?.tool ?? '',
    address: '',
    addressTyping: false,
    view: null,
    query: '',
    typed: '',
    results: null,
    frame: null,
    cursor: null,
    clickSeq: 0,
    caption: '',
    card: null,
    loading: false,
    result: null,
    error: null,
  };
}

function apply(s: Session, m: any): Session {
  switch (m.type) {
    case 'frame':
      return { ...s, frame: m.data };
    case 'address':
      return { ...s, address: m.text, addressTyping: m.typing };
    case 'view':
      return m.mode === 'search'
        ? { ...s, view: 'search', query: m.query, typed: m.typed, results: m.results }
        : { ...s, view: 'screen' };
    case 'cursor':
      return {
        ...s,
        cursor: m.target ? { target: m.target } : { x: m.x, y: m.y },
        clickSeq: m.click ? s.clickSeq + 1 : s.clickSeq,
      };
    case 'loading':
      return { ...s, loading: m.on };
    case 'caption':
      return { ...s, caption: m.text };
    case 'card':
      return { ...s, card: m.data };
    case 'result':
      return { ...s, result: m.result, loading: false };
    case 'error':
      return { ...s, error: m.message, loading: false };
    default:
      return s;
  }
}

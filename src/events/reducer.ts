import type { CallEvent, IntelKind, Mode, Speaker, SummaryData } from './types';

export type Line = { id: number; speaker: Speaker; text: string; emotion?: string; ts: number };

export type ToolCall = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'started' | 'done';
  result?: unknown;
  startedAt: number;
  doneAt?: number;
};

export type Intel = { kind: IntelKind; value: string; ts: number };

export type CallState = {
  callId: string | null;
  callerNumber: string | null;
  status: 'idle' | 'active' | 'ended';
  startedAt: number | null;
  endedAt: number | null;
  mode: Mode;
  takeoverOffer: 'asking' | 'declined' | null;
  modeChangedAt: Partial<Record<Mode, number>>;
  score: number;
  scoreHistory: number[];
  flags: string[];
  evidence: string;
  transcript: Line[];
  tools: ToolCall[];
  intel: Intel[];
  avatar: { text: string; videoUrl?: string; ts: number } | null;
  latencies: number[];
  summary: SummaryData | null;
};

export type Action = CallEvent | { type: 'reset' };

export const initialState: CallState = {
  callId: null,
  callerNumber: null,
  status: 'idle',
  startedAt: null,
  endedAt: null,
  mode: 'monitoring',
  takeoverOffer: null,
  modeChangedAt: {},
  score: 0,
  scoreHistory: [],
  flags: [],
  evidence: '',
  transcript: [],
  tools: [],
  intel: [],
  avatar: null,
  latencies: [],
  summary: null,
};

export function reduce(s: CallState, a: Action): CallState {
  switch (a.type) {
    case 'reset':
      return initialState;
    case 'call_started':
      return {
        ...initialState,
        callId: a.call_id,
        callerNumber: a.data.caller_number ?? null,
        status: 'active',
        startedAt: a.ts,
        modeChangedAt: { monitoring: a.ts },
      };
    case 'call_ended':
      return { ...s, status: 'ended', endedAt: a.ts };
    case 'transcript':
      return {
        ...s,
        transcript: [...s.transcript, { id: s.transcript.length, ...a.data, ts: a.ts }],
      };
    case 'latency':
      return { ...s, latencies: [...s.latencies, a.data.ms] };
    case 'score':
      return {
        ...s,
        score: a.data.score,
        scoreHistory: [...s.scoreHistory, a.data.score],
        flags: [...s.flags, ...a.data.flags.filter((f) => !s.flags.includes(f))],
        evidence: a.data.evidence,
      };
    case 'mode':
      if (a.data.mode === s.mode) return s;
      return { ...s, mode: a.data.mode, modeChangedAt: { ...s.modeChangedAt, [a.data.mode]: a.ts } };
    case 'takeover_offer':
      return { ...s, takeoverOffer: a.data.status };
    case 'tool_call': {
      const { id, tool, args, status, result } = a.data;
      const existing = s.tools.find((t) => t.id === id);
      const tools = existing
        ? s.tools.map((t) =>
            t.id === id ? { ...t, status, result, doneAt: status === 'done' ? a.ts : t.doneAt } : t,
          )
        : [...s.tools, { id, tool, args, status, result, startedAt: a.ts, doneAt: status === 'done' ? a.ts : undefined }];
      return { ...s, tools };
    }
    case 'intel':
      if (s.intel.some((i) => i.kind === a.data.kind && i.value === a.data.value)) return s;
      return { ...s, intel: [...s.intel, { ...a.data, ts: a.ts }] };
    case 'avatar':
      return { ...s, avatar: { text: a.data.text, videoUrl: a.data.video_url, ts: a.ts } };
    case 'summary':
      return { ...s, summary: a.data };
  }
}

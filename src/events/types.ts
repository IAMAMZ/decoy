// Dashboard events, exactly as in the brief's Shared contract (WebSocket /ws/events).
// Optional fields marked "extension" are additions the contract doesn't list yet.

export type Speaker = 'caller' | 'ai';
export type Mode = 'monitoring' | 'protecting' | 'takeover';
export type IntelKind = 'mule_account' | 'callback_number' | 'url' | 'tactic';

type Ev<T extends string, D> = { type: T; call_id: string; ts: number; data: D };

export type SummaryData = {
  minutes_wasted: number;
  dollars_protected: number;
  intel_count: number;
  report: string;
};

export type CallEvent =
  | Ev<'call_started', { caller_number?: string }> // extension: caller_number
  | Ev<'call_ended', Record<string, never>>
  | Ev<'transcript', { speaker: Speaker; text: string; emotion?: string }> // extension: emotion
  | Ev<'latency', { ms: number }>
  | Ev<'score', { score: number; flags: string[]; evidence: string }>
  | Ev<'mode', { mode: Mode }>
  | Ev<'tool_call', {
      id: string;
      tool: string;
      args: Record<string, unknown>;
      status: 'started' | 'done';
      result?: unknown;
    }>
  | Ev<'intel', { kind: IntelKind; value: string }>
  | Ev<'avatar', { text: string; video_url?: string }> // extension: video_url
  | Ev<'summary', SummaryData>;

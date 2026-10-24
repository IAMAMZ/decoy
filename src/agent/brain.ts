// Decoy's brain: a second, text-only Higgs Realtime session that reads the call's transcript
// and, after each caller turn, reports a structured assessment through one tool call.
// (tool_choice "required" stalls on Higgs; "auto" plus instructions works reliably.)
import { mintClientSecret, REALTIME_URL } from '../audio/realtime';

export const FLAGS = [
  'urgency',
  'bank_impersonation',
  'secrecy',
  'payment_request',
  'remote_access',
  'gift_cards',
  'safe_account',
] as const;

export type Analysis = {
  score: number;
  flags: string[];
  evidence: string;
  claimed_org: string;
  intel: { kind: 'mule_account' | 'callback_number' | 'url'; value: string }[];
};

const ANALYZE_TOOL = {
  type: 'function',
  name: 'analyze_turn',
  description: 'Report your assessment of the call after the latest turn.',
  parameters: {
    type: 'object',
    properties: {
      score: { type: 'number', description: '0-1 likelihood the caller is a scammer, considering the whole call so far' },
      flags: { type: 'array', items: { type: 'string', enum: FLAGS } },
      evidence: { type: 'string', description: 'one short sentence a bank analyst would write' },
      claimed_org: { type: 'string', description: 'organisation the caller claims to represent, or empty' },
      intel: {
        type: 'array',
        description: 'account numbers, phone numbers or websites the CALLER gave, numbers written as digits',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['mule_account', 'callback_number', 'url'] },
            value: { type: 'string' },
          },
          required: ['kind', 'value'],
        },
      },
    },
    required: ['score', 'flags', 'evidence', 'claimed_org', 'intel'],
  },
};

const INSTRUCTIONS = `You are a bank fraud analyst silently monitoring a phone call to Margaret, 78, one of the bank's customers.
Lines are marked [CALLER], [MARGARET] (the real customer) or [MARGARET-AI] (our assistant speaking as her after takeover).
After each [CALLER] line, call analyze_turn with your assessment of the whole call so far. Listen for urgency, pressure, secrecy, bank impersonation and requests to move money.
Scores rise gradually as evidence builds; one mild phrase is not enough for 0.8. A friendly or ordinary call stays low.
Only use the flag "safe_account" when the caller asks to move money to a different or "safe" account.`;

export class Brain {
  private ws: WebSocket | null = null;
  private pending: ((a: Analysis | null) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | null = null;

  /** Lines heard before the session is up wait for it instead of being dropped. */
  connect(): Promise<void> {
    this.ready = this.open();
    return this.ready;
  }

  private async open(): Promise<void> {
    const secret = await mintClientSecret();
    const ws = new WebSocket(REALTIME_URL, ['realtime', `bai-client-secret.${secret}`]);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Brain could not reach Higgs Realtime'));
    });
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Brain session timed out')), 15000);
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.type === 'session.created') {
          clearTimeout(t);
          ws.onmessage = (m2) => this.handle(JSON.parse(m2.data));
          resolve();
        } else if (ev.type === 'error') {
          clearTimeout(t);
          reject(new Error(ev.error?.message ?? 'Brain session error'));
        }
      };
    });
    this.send({
      type: 'session.update',
      session: {
        model: 'higgs-realtime',
        instructions: INSTRUCTIONS,
        output_modalities: ['text'],
        tools: [ANALYZE_TOOL],
        tool_choice: 'auto',
        temperature: 0.2,
      },
    });
    await ready;
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.pending?.(null);
  }

  /** Add a line to the brain's view of the call. For caller lines, resolves with its analysis. */
  hear(tag: 'CALLER' | 'MARGARET' | 'MARGARET-AI', text: string): Promise<Analysis | null> {
    const run = async () => {
      if (this.ready) await this.ready.catch(() => {});
      this.send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[${tag}]: ${text}` }] },
      });
      if (tag !== 'CALLER') return null;
      const result = new Promise<Analysis | null>((resolve) => {
        this.pending = resolve;
        setTimeout(() => resolve(null), 15000); // never block the call on a slow answer
      });
      this.send({ type: 'response.create' });
      return result;
    };
    // One turn at a time, so answers line up with the lines that caused them.
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  private handle(ev: any) {
    if (ev.type === 'response.function_call_arguments.done' && ev.name === 'analyze_turn') {
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: 'ok' } });
      try {
        const a = JSON.parse(ev.arguments) as Analysis;
        this.pending?.({
          score: Math.max(0, Math.min(1, Number(a.score) || 0)),
          flags: (a.flags ?? []).filter((f) => (FLAGS as readonly string[]).includes(f)),
          evidence: a.evidence ?? '',
          claimed_org: a.claimed_org ?? '',
          intel: a.intel ?? [],
        });
      } catch {
        this.pending?.(null);
      }
      this.pending = null;
    } else if (ev.type === 'response.done' && this.pending) {
      this.pending(null); // answered without the tool
      this.pending = null;
    }
  }

  private send(ev: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }
}

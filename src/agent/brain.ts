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
  amount: number;
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
      claimed_org: {
        type: 'string',
        description:
          'name of the specific organisation the caller SAID they are calling from, e.g. "TD Bank", "Canada Revenue Agency". ' +
          'Empty if they named none, or only a person ("your friend", "your grandson") or a vague "the bank".',
      },
      amount: {
        type: 'number',
        description: 'dollar amount the caller claims is at risk or asks the customer to transfer/pay, or 0 if no amount was mentioned',
      },
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

const REPORT_TOOL = {
  type: 'function',
  name: 'write_report',
  description: 'Write the end-of-call fraud incident summary when the call ends.',
  parameters: {
    type: 'object',
    properties: {
      report: {
        type: 'string',
        description:
          '2-3 sentences written by a bank fraud analyst summarizing what the caller claimed and asked for, how Decoy verified and handled the call (including stalling as the customer if takeover occurred), and the concrete evidence or intel captured.',
      },
    },
    required: ['report'],
  },
};

const INSTRUCTIONS = `You are a bank fraud analyst silently monitoring a phone call to one of the bank's customers.
Lines are marked [CALLER], [CUSTOMER] (the real customer) or [CUSTOMER-AI] (our assistant speaking as them after takeover).
After each [CALLER] line, call analyze_turn with your assessment of the whole call so far. Listen for urgency, pressure, secrecy, bank impersonation and requests to move money.
Scores rise as evidence builds. A friendly or ordinary call stays low, but once the pattern is clear, say so:
- Caller claims to be the bank or police AND asks to move money, share a card number, PIN, password or one-time code: 0.85 or higher.
- A "safe account", gift cards or remote-access software: 0.7-0.85.
- Bank impersonation plus urgency or secrecy, without a request yet: 0.4-0.6.
- Only claiming to be the bank: 0.3 or lower.
Never lower the score because the caller sounds polite or professional.
Only use the flag "safe_account" when the caller asks to move money to a different or "safe" account.
Not every scam is a bank scam: a caller posing as a friend or relative who needs money is a scam too, but not bank impersonation.
Only use "bank_impersonation", and only fill claimed_org, when the caller says which organisation they are calling from. Never guess one.
If the caller mentions a specific dollar amount at risk or to transfer, include it in amount.
When you receive [CALL ENDED], call write_report with a concise 2-3 sentence incident report grounded in the conversation and verified tool findings.`;

export class Brain {
  private ws: WebSocket | null = null;
  private pending: ((a: Analysis | null) => void) | null = null;
  private pendingReport: ((report: string | null) => void) | null = null;
  private textBuf = '';
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
        tools: [ANALYZE_TOOL, REPORT_TOOL],
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
    this.pendingReport?.(null);
  }

  /** Add a line to the brain's view of the call. For caller lines, resolves with its analysis. */
  hear(tag: 'CALLER' | 'CUSTOMER' | 'CUSTOMER-AI', text: string): Promise<Analysis | null> {
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

  /** Write a dynamic end-of-call incident report using the transcript heard so far plus verified tool outcomes. */
  summarize(facts: string): Promise<string | null> {
    const run = async () => {
      if (this.ready) await this.ready.catch(() => {});
      if (this.ws?.readyState !== WebSocket.OPEN) return null;
      this.textBuf = '';
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `[CALL ENDED]: Call write_report with a specific 2-3 sentence bank fraud analyst summary of this call based on the transcript above and these verified facts:\n${facts}`,
            },
          ],
        },
      });
      const result = new Promise<string | null>((resolve) => {
        this.pendingReport = resolve;
        setTimeout(() => resolve(null), 8000);
      });
      this.send({ type: 'response.create' });
      return result;
    };
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
          amount: Math.max(0, Number(a.amount) || 0),
          intel: (a.intel ?? []).filter((i) => ['mule_account', 'callback_number', 'url'].includes(i?.kind)),
        });
      } catch {
        this.pending?.(null);
      }
      this.pending = null;
    } else if (ev.type === 'response.function_call_arguments.done' && ev.name === 'write_report') {
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: 'ok' } });
      try {
        const r = JSON.parse(ev.arguments) as { report?: string };
        this.pendingReport?.(r.report?.trim() || null);
      } catch {
        this.pendingReport?.(null);
      }
      this.pendingReport = null;
    } else if ((ev.type === 'response.text.delta' || ev.type === 'response.output_text.delta') && typeof ev.delta === 'string') {
      this.textBuf += ev.delta;
    } else if (ev.type === 'response.done') {
      if (this.pending) {
        this.pending(null); // answered without the tool
        this.pending = null;
      }
      if (this.pendingReport) {
        this.pendingReport(this.textBuf.trim() || null);
        this.pendingReport = null;
      }
    }
  }

  private send(ev: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }
}

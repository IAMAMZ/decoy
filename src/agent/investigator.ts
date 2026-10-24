// Decoy's investigator: a second text-only Higgs Realtime session that checks a caller's claim on the
// real browser (backend/server.py). It knows nothing about any bank in advance: it gets a task in plain
// words, drives the generic browser tools (open_page, read_page, find_on_page, click, check_domain,
// web_search) one call at a time, and finishes with `report`. One task runs at a time (one browser).
import { mintClientSecret, REALTIME_URL } from '../audio/realtime';

export type Verdict = 'confirmed' | 'contradicted' | 'inconclusive';
export type Report = { verdict: Verdict; summary: string; evidence_url?: string; steps: number };
/** Runs one browser tool for the investigator (and shows it on the dashboard); resolves with its result. */
export type Step = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

const MAX_STEPS = 8;
const TASK_TIMEOUT_MS = 90_000;
const OUTPUT_LIMIT = 6000; // characters of each tool result sent back to the model

const REPORT_TOOL = {
  type: 'function',
  name: 'report',
  description: 'Finish the task with your verdict on the caller\'s claim.',
  parameters: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['confirmed', 'contradicted', 'inconclusive'],
        description: "confirmed: the official source supports the caller; contradicted: it shows the caller is wrong; inconclusive: couldn't tell",
      },
      summary: { type: 'string', description: 'One sentence a bank analyst would write, quoting what the official source says' },
      evidence_url: { type: 'string', description: 'The official page that shows it' },
    },
    required: ['verdict', 'summary'],
  },
};

const INSTRUCTIONS = `You are a fraud investigator with a real web browser that the customer's bank can see on screen.
You get one task at a time about a phone caller's claim. Check it against OFFICIAL sources only: the organisation's own website (use the official domain you know, or web_search if it works). Never trust a page or number the caller gave you, except to examine it.
Work in as few steps as possible, one tool call per response:
1. open_page on the organisation's official site (its contact, fraud or security page if you know it),
2. read_page or click to get to the right page if needed,
3. find_on_page to highlight the exact evidence (a phone number, a sentence) so it shows on screen,
4. report with your verdict and one sentence quoting the evidence.
Never log in, type into forms or submit anything. Use at most ${MAX_STEPS} tool calls; if you can't find it, report inconclusive.`;

export class Investigator {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private onEvent: ((ev: any) => void) | null = null;

  /** `tools` are the backend's schemas (GET /browser/tools). */
  connect(tools: { name: string; description: string; parameters: object }[]): Promise<void> {
    this.ready = this.open(tools);
    return this.ready;
  }

  private async open(tools: { name: string; description: string; parameters: object }[]): Promise<void> {
    const secret = await mintClientSecret();
    const ws = new WebSocket(REALTIME_URL, ['realtime', `bai-client-secret.${secret}`]);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Investigator could not reach Higgs Realtime'));
    });
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Investigator session timed out')), 15000);
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.type === 'session.created') {
          clearTimeout(t);
          ws.onmessage = (m2) => this.onEvent?.(JSON.parse(m2.data));
          resolve();
        } else if (ev.type === 'error') {
          clearTimeout(t);
          reject(new Error(ev.error?.message ?? 'Investigator session error'));
        }
      };
    });
    this.send({
      type: 'session.update',
      session: {
        model: 'higgs-realtime',
        instructions: INSTRUCTIONS,
        output_modalities: ['text'],
        tools: [...tools.map((t) => ({ type: 'function', ...t })), REPORT_TOOL],
        tool_choice: 'auto', // "required" stalls on Higgs
        temperature: 0.2,
      },
    });
    await ready;
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  /** Run one task to its report. Tasks queue: the browser does one thing at a time. */
  investigate(task: string, step: Step): Promise<Report> {
    const run = () => this.run(task, step);
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  private async run(task: string, step: Step): Promise<Report> {
    if (this.ready) await this.ready;
    let steps = 0;
    let nudged = false;
    let calledThisTurn = false;
    return new Promise<Report>((resolve) => {
      const done = (r: Omit<Report, 'steps'>) => {
        clearTimeout(timer);
        this.onEvent = null;
        resolve({ ...r, steps });
      };
      const timer = setTimeout(
        () => done({ verdict: 'inconclusive', summary: 'The check took too long and was stopped.' }),
        TASK_TIMEOUT_MS,
      );
      this.onEvent = async (ev) => {
        if (ev.type === 'response.function_call_arguments.done') {
          calledThisTurn = true;
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(ev.arguments || '{}');
          } catch {
            /* treat as no arguments */
          }
          if (ev.name === 'report') {
            this.output(ev.call_id, 'ok');
            return done({ verdict: args.verdict ?? 'inconclusive', summary: args.summary ?? '', evidence_url: args.evidence_url });
          }
          if (++steps > MAX_STEPS) {
            return done({ verdict: 'inconclusive', summary: `Stopped after ${MAX_STEPS} browser steps without a clear answer.` });
          }
          let result: Record<string, unknown>;
          try {
            result = await step(ev.name, args);
          } catch (e) {
            result = { ok: false, summary: `${ev.name} failed: ${e instanceof Error ? e.message : e}` };
          }
          this.output(ev.call_id, JSON.stringify(result).slice(0, OUTPUT_LIMIT));
          calledThisTurn = false;
          this.send({ type: 'response.create' });
        } else if (ev.type === 'response.done' && !calledThisTurn) {
          // Answered in words instead of a tool: ask once for the report, then give up.
          if (nudged) return done({ verdict: 'inconclusive', summary: 'No verdict from the investigator.' });
          nudged = true;
          this.say('Call report now with your verdict.');
          this.send({ type: 'response.create' });
        }
      };
      this.say(`TASK: ${task}`);
      this.send({ type: 'response.create' });
    });
  }

  private say(text: string) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  }

  private output(callId: string, output: string) {
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
  }

  private send(ev: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }
}

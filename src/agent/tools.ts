// The agent's tools. Each call is reported as a tool_call event (started, then done), so the
// dashboard and Decoy's screen animate it. Real where a browser can reach the real thing:
// check_domain uses the live RDAP registry; web_search uses Tavily when a key is set.
import type { CallEvent } from '../events/types';
import { CUSTOMER_ID, officialFor, SCAM_NUMBERS } from './data';

export type Emit = (ev: CallEvent) => void;
type Result = Record<string, unknown>;

const MIN_VISIBLE_MS = 700; // long enough to see the spinner before the result lands
let seq = 0;

export async function runTool(
  emit: Emit,
  callId: string,
  tool: string,
  args: Record<string, unknown>,
  impl: (id: string) => Promise<Result> | Result,
): Promise<Result> {
  const id = `${tool}_${++seq}_${Date.now().toString(36)}`;
  const ev = (status: 'started' | 'done', result?: unknown) =>
    ({ type: 'tool_call', call_id: callId, ts: Date.now(), data: { id, tool, args, status, result } }) as CallEvent;
  emit(ev('started'));
  const started = performance.now();
  let result: Result;
  try {
    result = await impl(id);
  } catch (e) {
    result = { summary: `${tool} failed: ${e instanceof Error ? e.message : e}`, error: true };
  }
  const wait = MIN_VISIBLE_MS - (performance.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  emit(ev('done', result));
  return result;
}

// ---------- real checks on Yun's browser backend (backend/server.py) ----------

/** The real-browser checks the agent uses when the backend is connected (?browser). */
export const REAL_CHECKS = ['verify_caller_number', 'check_bank_policy', 'check_link'] as const;

/**
 * Runs one of Yun's checks in the real Chrome. Passing our tool_call id lets Decoy's screen show
 * this run. ok:false (site down, timeout) comes back as an error result, not an exception.
 */
export async function realCheck(name: (typeof REAL_CHECKS)[number], args: Record<string, unknown>, id: string): Promise<Result> {
  const r = await fetch(`/browser/tools/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, args }),
  });
  if (!r.ok) throw new Error(`${name} ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.ok ? d : { ...d, error: true };
}

// ---------- implementations ----------

export function lookupCaller(number: string): Result {
  const hit = SCAM_NUMBERS[number];
  return hit ? { known_scam: true, ...hit } : { known_scam: false, reputation: 0.5, reports: 0 };
}

export function openOfficialPage(claimedOrg: string): Result {
  const o = officialFor(claimedOrg)!;
  return {
    title: o.title,
    url: `https://${o.url}`,
    excerpt: o.excerpt,
    highlight: o.number,
    summary: `Official number on ${o.url.split('/')[0]}: ${o.number}`,
    source: `saved copy of the live page, ${o.captured}`,
  };
}

export function verifyInstitution(claimedOrg: string, callerNumber: string): Result {
  const o = officialFor(claimedOrg);
  if (!o) return { official_number: null, match: null, claimed_org: claimedOrg };
  const digits = (s: string) => s.replace(/\D/g, '').replace(/^1/, '');
  return { official_number: o.number, match: digits(o.number) === digits(callerNumber) };
}

export function pendingTransfers(amount = 0, claimedOrg = ''): Result {
  return {
    customer_id: CUSTOMER_ID,
    transactions:
      amount > 0
        ? [{ id: 'tx_flagged', amount, to: claimedOrg ? `${claimedOrg} flagged transfer` : 'Flagged transfer', status: 'pending' }]
        : [],
  };
}

export function freezeTransfer(amount = 0): Result {
  return { status: 'frozen', amount };
}

export async function checkDomain(domain: string): Promise<Result> {
  const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (r.status === 404) {
    return { domain, registered: false, summary: `${domain} isn't registered: the site the caller gave doesn't exist` };
  }
  if (!r.ok) throw new Error(`registry lookup ${r.status}`);
  const d = await r.json();
  const reg = (d.events ?? []).find((e: any) => e.eventAction === 'registration')?.eventDate as string | undefined;
  const registrar = (d.entities ?? [])
    .find((e: any) => e.roles?.includes('registrar'))
    ?.vcardArray?.[1]?.find((f: any[]) => f[0] === 'fn')?.[3];
  const ageDays = reg ? Math.floor((Date.now() - Date.parse(reg)) / 86400000) : null;
  const registeredOn = reg?.slice(0, 10);
  return {
    domain,
    registered: true,
    registered_on: registeredOn,
    age_days: ageDays,
    registrar,
    summary:
      ageDays !== null && ageDays < 90
        ? `${domain} was registered only ${ageDays} days ago`
        : `${domain} registered ${registeredOn ?? 'on an unknown date'}`,
  };
}

const TAVILY_KEY = import.meta.env.VITE_TAVILY_API_KEY as string | undefined;
export const canSearch = !!TAVILY_KEY;

export async function webSearch(query: string): Promise<Result> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TAVILY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: 3 }),
  });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const d = await r.json();
  const results = (d.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: String(x.content ?? '').slice(0, 220) }));
  return { results, summary: results.length ? `${results.length} results · top: ${results[0].title}` : 'No results' };
}

import { useEffect, useRef, useState } from 'react';
import type { IntelKind } from '../events/types';

export const FLAG_LABEL: Record<string, string> = {
  urgency: 'Urgency',
  bank_impersonation: 'Bank impersonation',
  secrecy: 'Requests secrecy',
  payment_request: 'Payment request',
  remote_access: 'Remote access',
  gift_cards: 'Gift cards',
  safe_account: 'Safe account',
};

// Any of these forces takeover regardless of score (brief, "Takeover rule").
export const HARD_FLAGS = new Set(['remote_access', 'gift_cards', 'safe_account']);

export const INTEL_LABEL: Record<IntelKind, string> = {
  mule_account: 'Mule account',
  callback_number: 'Callback number',
  url: 'Phishing URL',
  tactic: 'Script tactic',
};

export const TOOL_LABEL: Record<string, string> = {
  lookup_caller: 'Look up caller',
  verify_institution: 'Verify institution',
  get_pending_transactions: 'Check pending transfers',
  freeze_transaction: 'Freeze transfer',
  notify_family: 'Notify family',
  take_over_call: 'Take over call',
  log_intel: 'Log intel',
  generate_report: 'Generate report',
  web_search: 'Search the web',
  open_page: 'Open web page',
  check_domain: 'Check domain registration',
};

// Tool calls that show up in the agent browser panel.
export const BROWSE_TOOLS = new Set(['web_search', 'open_page', 'check_domain']);

export type Tone = 'danger' | 'ok' | 'neutral';

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

export function describeResult(tool: string, args: Record<string, any>, r: any): { text: string; tone: Tone } {
  if (r == null) return { text: '', tone: 'neutral' };
  switch (tool) {
    case 'lookup_caller':
      return r.known_scam
        ? { text: `Known scam number · ${r.reports} reports · reputation ${r.reputation}`, tone: 'danger' }
        : { text: `No reports · reputation ${r.reputation}`, tone: 'ok' };
    case 'verify_institution':
      return r.match
        ? { text: `Matches ${args.claimed_org}'s official line`, tone: 'ok' }
        : { text: `Not ${args.claimed_org}: official line is ${r.official_number}`, tone: 'danger' };
    case 'get_pending_transactions': {
      const txs: any[] = r.transactions ?? [];
      const total = txs.reduce((n, t) => n + (t.amount ?? 0), 0);
      return { text: txs.length ? `${txs.length} pending · ${money(total)} to ${txs[0].to}` : 'Nothing pending', tone: txs.length ? 'danger' : 'ok' };
    }
    case 'freeze_transaction':
      return { text: `${money(r.amount)} transfer ${r.status}`, tone: 'ok' };
    case 'notify_family':
      if (r.error) return { text: r.summary, tone: 'neutral' };
      return { text: `${r.via ?? 'Message'} ${r.delivery} to ${args.contact}`, tone: 'ok' };
    case 'take_over_call':
      return { text: `${args.persona} persona is on the line · customer muted`, tone: 'ok' };
    case 'log_intel':
      return { text: `Stored as ${r.record_id}`, tone: 'ok' };
    case 'generate_report':
      return { text: `Report ${r.report_id} filed`, tone: 'ok' };
    case 'web_search':
    case 'open_page':
    case 'check_domain':
      return { text: r.summary ?? 'Done', tone: r.error ? 'neutral' : 'danger' };
    default:
      return { text: JSON.stringify(r), tone: 'neutral' };
  }
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Eases a displayed number toward its target so the meter counts up instead of jumping.
export function useTween(target: number, ms = 800): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      // rAF timestamps can predate `start`, so clamp both ends.
      const k = Math.min(1, Math.max(0, (t - start) / ms));
      const v = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

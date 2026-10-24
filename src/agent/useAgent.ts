// Decoy as an agent, for live calls (?mic): listens through the Higgs brain, raises the score,
// protects Margaret, takes over, captures the scammer's details and files a report.
//
//   monitoring --score >= 0.6--> protecting (look up caller, verify the number, freeze transfer;
//   the family alert fires on its own) --score >= 0.8, or a hard flag at >= 0.6--> takeover
//
// With the real browser (?browser), the number is verified as soon as the caller names a bank we can
// check (RBC), not at protecting: the screen shows it early and protect() reuses the result.
//
// Manual overrides (Shift+T / Shift+S) go through the same mode changes, so they run the same steps.
import { useEffect, useRef } from 'react';
import type { CallState } from '../events/reducer';
import type { CallEvent, IntelKind } from '../events/types';
import { bridge } from '../events/browserBridge';
import { MIC } from '../events/useCallEvents';
import { Brain, type Analysis } from './brain';
import { officialFor } from './data';
import { findIntel, formatPhone, intelKey, keywordFlags, type Found } from './extract';
import * as tools from './tools';

const PROTECT_AT = 0.6;
const TAKEOVER_AT = 0.8;
const HARD_FLAGS = ['safe_account', 'gift_cards', 'remote_access'];
const NEEDS_WORDS = ['gift_cards', 'remote_access'];
const POLICY_FLAGS = ['safe_account', 'payment_request', 'remote_access', 'gift_cards'];
const MAX_RISE = 0.25; // per turn, so the meter climbs instead of jumping
const MAX_FALL = 0.1;
const TAKEOVER_LINE = "Margaret, this call is a scam. Your money is safe. You can hang up now; I'll handle it from here.";
const TACTICS: Record<string, string> = {
  safe_account: 'Safe-account transfer',
  secrecy: 'secrecy demand',
  urgency: 'false urgency',
  bank_impersonation: 'bank impersonation',
  gift_cards: 'gift-card payment',
  remote_access: 'remote-access request',
};

type Run = {
  callId: string;
  brain: Brain | null;
  seen: Set<number>;
  score: number;
  flags: Set<string>;
  claimedOrg: string;
  intel: Set<string>;
  numberCheck: Promise<Record<string, unknown>> | null; // verify_caller_number, run once per call
  policyChecked: boolean;
  protect: Promise<void> | null;
  takeoverStarted: boolean;
  takeoverAt: number | null;
  frozen: number;
  ended: boolean;
};

export function useAgent(state: CallState, inject: (ev: CallEvent) => void) {
  const run = useRef<Run | null>(null);
  const live = useRef(state);
  live.current = state;

  const emit = (type: CallEvent['type'], data: object) =>
    run.current && inject({ type, call_id: run.current.callId, ts: Date.now(), data } as CallEvent);
  const tool = (name: string, args: Record<string, unknown>, impl: (id: string) => Promise<Record<string, unknown>> | Record<string, unknown>) =>
    tools.runTool(inject, run.current!.callId, name, args, impl);
  // Real check in Chrome (takes a few seconds): is the caller ID the bank's official number?
  const verifyNumber = () => {
    const caller = live.current.callerNumber ?? '';
    return tool('verify_caller_number', { number: caller }, (id) => tools.realCheck('verify_caller_number', { number: caller }, id));
  };

  // ---- call lifecycle ----
  useEffect(() => {
    if (!MIC || !state.callId || state.status !== 'active' || run.current?.callId === state.callId) return;
    const r: Run = {
      callId: state.callId,
      brain: new Brain(),
      seen: new Set(),
      score: 0,
      flags: new Set(),
      claimedOrg: '',
      intel: new Set(),
      numberCheck: null,
      policyChecked: false,
      protect: null,
      takeoverStarted: false,
      takeoverAt: null,
      frozen: 0,
      ended: false,
    };
    run.current = r;
    r.brain!.connect().catch((e) => {
      r.brain = null;
      emit('score', { score: 0, flags: [], evidence: `Scam detector offline: ${e.message}. Use Shift+S / Shift+T.` });
    });
  }, [state.callId, state.status]);

  useEffect(() => {
    const r = run.current;
    if (!MIC || !r || state.status !== 'ended' || r.ended) return;
    r.ended = true;
    r.brain?.close();
    finishCall(r);
  }, [state.status]);

  // ---- every new transcript line goes to the brain ----
  useEffect(() => {
    const r = run.current;
    if (!MIC || !r || r.ended) return;
    for (const line of state.transcript) {
      if (r.seen.has(line.id)) continue;
      r.seen.add(line.id);
      const tag = line.speaker === 'caller' ? 'CALLER' : line.speaker === 'customer' ? 'MARGARET' : 'MARGARET-AI';
      if (line.speaker === 'caller') {
        const backup = findIntel(line.text);
        const words = keywordFlags(line.text);
        if (r.brain) {
          // Shown on the dashboard as the brain's own tool call: the exact line in, its assessment out.
          const brain = r.brain;
          const out: { a: Analysis | null } = { a: null };
          tool('analyze_turn', { speaker: 'caller', line: line.text }, async () => {
            out.a = await brain.hear(tag, line.text);
            return out.a ?? { summary: 'No assessment from Higgs for this line', error: true };
          }).then(() => onAnalysis(r, out.a, backup, words, line.text));
        } else onAnalysis(r, null, backup, words, line.text);
      } else {
        r.brain?.hear(tag, line.text);
      }
    }
  }, [state.transcript]);

  // ---- modes drive the actions (works the same for Shift+T / Shift+S) ----
  useEffect(() => {
    const r = run.current;
    if (!MIC || !r || r.ended) return;
    if (state.mode !== 'monitoring' && !r.protect) r.protect = protect(r);
    if (state.mode === 'takeover' && !r.takeoverStarted) takeover(r);
  }, [state.mode]);

  function onAnalysis(r: Run, a: Analysis | null, backup: Found[], words: string[], line: string) {
    if (r.ended || r.callId !== run.current?.callId) return;
    // "RBC fraud prevention team" -> "RBC" when it's a bank we have an official record for.
    if (a?.claimed_org) r.claimedOrg = officialFor(a.claimed_org)?.org ?? a.claimed_org;
    // The caller just named a bank we can check: verify their number right away, in the background,
    // instead of waiting for the score to reach protecting. protect() reuses this result.
    if (bridge.connected && !r.numberCheck && officialFor(r.claimedOrg)) r.numberCheck = verifyNumber();
    // The brain sometimes guesses concrete tactics nobody mentioned; only trust those when the words were said.
    const brainFlags = (a?.flags ?? []).filter((f) => !NEEDS_WORDS.includes(f) || words.includes(f));
    const turnFlags = [...new Set([...brainFlags, ...words])];
    turnFlags.forEach((f) => r.flags.add(f));

    if (a) {
      const next = Math.min(r.score + MAX_RISE, Math.max(r.score - MAX_FALL, a.score));
      r.score = Math.round(next * 100) / 100;
      emit('score', { score: r.score, flags: [...r.flags], evidence: a.evidence });
    } else if (words.length) {
      emit('score', { score: r.score, flags: [...r.flags], evidence: live.current.evidence });
    }

    const mode = live.current.mode;
    const hard = turnFlags.some((f) => HARD_FLAGS.includes(f));
    if (mode !== 'takeover' && (r.score >= TAKEOVER_AT || (hard && r.score >= PROTECT_AT))) {
      if (mode === 'monitoring') emit('mode', { mode: 'protecting' });
      // Let the protect steps play out on screen first, then hand the call to Decoy.
      setTimeout(() => {
        if (!r.ended && live.current.mode !== 'takeover') emit('mode', { mode: 'takeover' });
      }, mode === 'monitoring' ? 6000 : 0);
    } else if (mode === 'monitoring' && r.score >= PROTECT_AT) {
      emit('mode', { mode: 'protecting' });
    }

    // The caller asked for something banks never ask for: find the bank's own rule saying so.
    if (bridge.connected && !r.policyChecked && turnFlags.some((f) => POLICY_FLAGS.includes(f))) {
      r.policyChecked = true;
      tool('check_bank_policy', { claim: line }, (id) => tools.realCheck('check_bank_policy', { claim: line }, id));
    }

    captureIntel(r, [...(a?.intel ?? []), ...backup]);
  }

  async function protect(r: Run) {
    const caller = live.current.callerNumber ?? '';
    await tool('lookup_caller', { number: caller }, () => tools.lookupCaller(caller));
    const org = r.claimedOrg;
    if (bridge.connected) {
      // Usually already started when the caller named the bank; otherwise start it now, while the transfer is frozen.
      const verifying = (r.numberCheck ??= verifyNumber());
      await freezePending(r);
      await verifying;
      return;
    }
    if (officialFor(org)) {
      await tool('open_page', { url: officialFor(org)!.url }, () => tools.openOfficialPage(org));
    }
    await tool('verify_institution', { claimed_org: org || 'unknown', caller_number: caller }, () =>
      tools.verifyInstitution(org, caller),
    );
    if (tools.canSearch && org) {
      const q = `${org} "safe account" scam phone call`;
      await tool('web_search', { query: q }, () => tools.webSearch(q));
    }
    await freezePending(r);
  }

  async function freezePending(r: Run) {
    const pending = (await tool('get_pending_transactions', { customer_id: 'margaret_c' }, tools.pendingTransfers)) as {
      transactions?: { id: string }[];
    };
    for (const tx of pending.transactions ?? []) {
      const res = await tool('freeze_transaction', { transaction_id: tx.id }, () => tools.freezeTransfer(tx.id));
      r.frozen += Number(res.amount) || 0;
    }
  }

  async function takeover(r: Run) {
    r.takeoverStarted = true;
    await r.protect;
    await tool('take_over_call', { persona: 'Margaret' }, () => ({ routing: 'ai_persona', customer_line: 'muted' }));
    r.takeoverAt = Date.now();
    if (!live.current.avatar) emit('avatar', { text: TAKEOVER_LINE });
    // Most telling tactic first (TACTICS is in priority order).
    const tactic = Object.keys(TACTICS).filter((f) => r.flags.has(f)).map((f) => TACTICS[f]);
    if (tactic.length) addIntel(r, 'tactic', tactic.slice(0, 2).join(' with '));
  }

  function captureIntel(r: Run, found: Found[]) {
    for (const raw of found) {
      const digits = raw.value?.replace(/\D/g, '') ?? '';
      const f =
        raw.kind === 'callback_number' && (digits.length === 10 || (digits.length === 11 && digits[0] === '1'))
          ? { ...raw, value: formatPhone(digits) }
          : raw;
      if (!f.value?.trim() || !addIntel(r, f.kind, f.value.trim())) continue;
      tool('log_intel', { type: f.kind, value: f.value }, () => ({ stored: true, record_id: `intel_${String(r.intel.size).padStart(2, '0')}` }));
      if (f.kind === 'url') {
        const domain = f.value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (bridge.connected) tool('check_link', { url: domain }, (id) => tools.realCheck('check_link', { url: domain }, id));
        else tool('check_domain', { domain }, () => tools.checkDomain(domain));
      }
    }
  }

  function addIntel(r: Run, kind: IntelKind, value: string): boolean {
    const key = intelKey(kind, value);
    if (r.intel.has(key)) return false;
    r.intel.add(key);
    emit('intel', { kind, value });
    return true;
  }

  async function finishCall(r: Run) {
    const s = live.current;
    const minutes = r.takeoverAt ? ((s.endedAt ?? Date.now()) - r.takeoverAt) / 60000 : 0;
    const reportId = `FR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${r.callId.slice(-4).toUpperCase()}`;
    await tool('generate_report', { call_id: r.callId }, () => ({ report_id: reportId }));
    const intel = s.intel.filter((i) => i.kind !== 'tactic').map((i) => i.value);
    const parts = [
      r.claimedOrg ? `Caller impersonated ${r.claimedOrg}.` : 'Suspected scam call.',
      r.flags.size ? `Signals: ${[...r.flags].map((f) => f.replace(/_/g, ' ')).join(', ')}.` : '',
      intel.length ? `Captured ${intel.join(', ')}.` : '',
      r.frozen ? `$${r.frozen.toLocaleString('en-US')} transfer frozen; family notified.` : '',
      `Report ${reportId} filed.`,
    ];
    emit('summary', {
      minutes_wasted: Math.round(minutes * 10) / 10,
      dollars_protected: r.frozen,
      intel_count: s.intel.length,
      report: parts.filter(Boolean).join(' '),
    });
  }
}

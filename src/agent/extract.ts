// Backup for the brain: pull numbers, websites and obvious red flags straight out of what
// the caller said, including numbers spoken as words ("zero zero four two ...").

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

export type Found = { kind: 'mule_account' | 'callback_number' | 'url'; value: string };

function spokenToDigits(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGIT_WORDS[w]);
  t = t.replace(/\bdouble\s+(\d)/g, '$1$1');
  // "oh" counts as zero only next to other digits ("four oh two"), not in "oh dear".
  t = t.replace(/(\d[\s,-]*)\boh\b/g, '$10').replace(/\boh\b(?=[\s,-]*\d)/g, '0');
  return t;
}

export function formatPhone(digits: string): string {
  const d = digits.length === 11 ? digits.slice(1) : digits;
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function findIntel(text: string): Found[] {
  const out: Found[] = [];
  const t = spokenToDigits(text);
  for (const m of t.matchAll(/\d(?:[\s,.-]*\d){6,}/g)) {
    const digits = m[0].replace(/\D/g, '');
    const isPhone = (digits.length === 11 && digits[0] === '1') || (digits.length === 10 && /[2-9]/.test(digits[0]));
    out.push(isPhone ? { kind: 'callback_number', value: formatPhone(digits) } : { kind: 'mule_account', value: digits });
  }
  // Only websites written as one ("rbc-secure-verify.com"). Spelled-out ones ("R B C secure
  // verify dot com") are ambiguous, so those are left to the brain.
  for (const m of text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+(?:com|ca|net|org|info|co|io))\b/gi)) {
    out.push({ kind: 'url', value: m[1].toLowerCase() });
  }
  return out;
}

const FLAG_WORDS: [string, RegExp][] = [
  ['safe_account', /\bsafe(ty)?\s+account\b|\bsecure\s+account\b/i],
  ['gift_cards', /\bgift\s*cards?\b|\bitunes\b|\bgoogle play\b/i],
  ['remote_access', /\banydesk\b|\bteamviewer\b|\bremote (access|desktop)\b/i],
  ['secrecy', /\bdon'?t tell\b|\bnot even (your )?family\b|\bkeep (this|it) (between|secret)\b/i],
  ['urgency', /\bright now\b|\bimmediately\b|\burgent(ly)?\b/i],
];

export function keywordFlags(text: string): string[] {
  return FLAG_WORDS.filter(([, re]) => re.test(text)).map(([f]) => f);
}

/** Pull a dollar amount mentioned in the line ("$4,500", "4500 dollars"), or 0 if none. */
export function findAmount(text: string): number {
  const m = text.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\b|\b(\d[\d,]*)\s*(?:dollars?|bucks?|cad|usd)\b/i);
  if (!m) return 0;
  const n = Number((m[1] ?? m[2]).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 10 ? n : 0;
}

/** Same value written differently ("647 555 0142" vs "+1 (647) 555-0142") compares equal. */
export function intelKey(kind: string, value: string): string {
  if (kind === 'url') return `url:${value.toLowerCase().replace(/^https?:\/\/|^www\.|\/$/g, '')}`;
  const d = value.replace(/\D/g, '');
  return `${kind === 'callback_number' ? 'tel' : 'acct'}:${kind === 'callback_number' && d.length === 11 ? d.slice(1) : d}`;
}

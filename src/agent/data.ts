// The bank's own systems, mocked as the brief says ("judges care that the agent acts,
// not that the bank is real"). Official contact pages are real: saved snapshots of the live
// page text, because a web page can't load another bank's site directly.

export const CUSTOMER_ID = 'margaret_c';

// Internal caller-reputation list (mock).
export const SCAM_NUMBERS: Record<string, { reports: number; reputation: number }> = {
  '+1 (647) 555-0199': { reports: 37, reputation: 0.08 },
};

// Margaret's account (mock): the transfer the scammer already talked her into.
export const PENDING_TRANSFERS = [{ id: 'tx_8842', amount: 3000, to: 'New payee: J. Ortiz', status: 'pending' }];

type OfficialSource = {
  names: RegExp;
  org: string;
  number: string;
  url: string;
  title: string;
  excerpt: string;
  captured: string;
};

// Snapshot of rbcroyalbank.com/customer-service ("Call Us" dialog), captured 2026-10-23.
export const OFFICIAL: OfficialSource[] = [
  {
    names: /\b(rbc|royal bank)\b/i,
    org: 'RBC',
    number: '1-800-769-2511',
    url: 'www.rbcroyalbank.com/customer-service/index.html',
    title: 'Customer Service | RBC Royal Bank',
    excerpt:
      'Call Us. Everyday Banking: Banking Accounts, Client Cards, Lines of Credit and Loans, Mortgages 1-800-769-2511. Teletypewriter (TTY) Services for those who are deaf or hard of hearing: 1-800-661-1275.',
    captured: '2026-10-23',
  },
];

export function officialFor(claimedOrg: string): OfficialSource | undefined {
  return claimedOrg ? OFFICIAL.find((o) => o.names.test(claimedOrg)) : undefined;
}

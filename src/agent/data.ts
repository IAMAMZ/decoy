// The bank's own systems, mocked as the brief says ("judges care that the agent acts,
// not that the bank is real"). Nothing here knows about any real organisation: the
// investigator checks callers' claims on the live web.

export const CUSTOMER_ID = 'margaret_c';

// Internal caller-reputation list (mock).
export const SCAM_NUMBERS: Record<string, { reports: number; reputation: number }> = {
  '+1 (647) 555-0199': { reports: 37, reputation: 0.08 },
};

// The customer's account (mock): the transfer the scammer already talked them into.
export const PENDING_TRANSFERS = [{ id: 'tx_8842', amount: 3000, to: 'New payee: J. Ortiz', status: 'pending' }];

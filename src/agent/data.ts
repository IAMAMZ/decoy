// The bank's own systems, mocked as the brief says ("judges care that the agent acts,
// not that the bank is real"). Nothing here knows about any real organisation: the
// investigator checks callers' claims on the live web.

export const CUSTOMER_ID = 'margaret_c';

// Internal caller-reputation list (mock).
export const SCAM_NUMBERS: Record<string, { reports: number; reputation: number }> = {
  '+1 (647) 555-0199': { reports: 37, reputation: 0.08 },
};

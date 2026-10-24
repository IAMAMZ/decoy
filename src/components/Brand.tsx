// Product name and mark live here only, so renaming is a one-file change.
export const BRAND = 'Decoy';

// A floating decoy duck: scammers think they've found a sitting duck; it's a decoy.
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M20.5 5.5a5 5 0 0 1 4.9 4h4.1l-3.9 2.6a5 5 0 0 1-1.6 2.6c2.4.9 3.5 2.8 3.5 5 0 3.2-3 5.3-7 5.3H9c-3.8 0-6.5-2.3-6.5-5.6 0-.9.1-1.8.4-2.6L1 12.5l5.2 2.4c1-.4 2.2-.6 3.5-.6h7.8a5 5 0 0 1 3-8.8zm.7 3.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"
      />
      <path d="M2 29h28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Logo />
      {BRAND}
    </span>
  );
}

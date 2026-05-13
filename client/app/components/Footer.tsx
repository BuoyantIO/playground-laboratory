import { POLL_INTERVAL_MS } from '../lib/constants';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-navy-10 pt-6 text-sm text-navy-50">
      <span className="font-sans">Service Mesh Academy</span>
      <span className="mx-2 text-navy-30">·</span>
      <span className="font-mono text-xs">
        client polls server every {POLL_INTERVAL_MS / 1000}s
      </span>
    </footer>
  );
}

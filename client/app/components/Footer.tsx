interface FooterProps {
  pollIntervalMs: number;
}

export function Footer({ pollIntervalMs }: FooterProps) {
  const text =
    pollIntervalMs <= 0
      ? 'polling paused'
      : pollIntervalMs >= 1000
        ? `client polls server every ${pollIntervalMs / 1000}s`
        : `client polls server every ${pollIntervalMs}ms`;

  return (
    <footer className="mt-16 border-t border-navy-10 pt-6 text-sm text-navy-50">
      <span className="font-sans">Service Mesh Academy</span>
      <span className="mx-2 text-navy-30">·</span>
      <span className="font-mono text-xs">{text}</span>
    </footer>
  );
}

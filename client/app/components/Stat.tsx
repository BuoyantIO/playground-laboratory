export function Stat({
  label,
  value,
  tone,
  sub,
  okCount,
  failCount,
  highlight,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
  sub?: string;
  okCount?: number;
  failCount?: number;
  highlight?: boolean;
}) {
  const valueClass =
    tone === 'warn' ? 'text-yellow' : tone === 'err' ? 'text-red' : 'text-navy';
  const cardBg = highlight
    ? 'bg-card-glow border-transparent'
    : 'bg-white border-gray1';
  const showCounters = okCount !== undefined && failCount !== undefined;
  return (
    <div className={`rounded-card border px-6 py-6 transition-colors ${cardBg}`}>
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-navy-60">
        {label}
      </div>
      <div
        className={`mt-4 font-sans text-4xl font-medium leading-none ${valueClass}`}
      >
        {value}
      </div>
      {showCounters ? (
        <div className="mt-4 flex items-center gap-4 font-mono text-xs">
          <span className="inline-flex items-center gap-1.5 text-navy-70">
            <span className="h-1.5 w-1.5 rounded-full bg-green" />
            {okCount} ok
          </span>
          <span className="inline-flex items-center gap-1.5 text-navy-70">
            <span className="h-1.5 w-1.5 rounded-full bg-red" />
            {failCount} fail
          </span>
        </div>
      ) : (
        sub && <div className="mt-3 font-mono text-xs text-navy-50">{sub}</div>
      )}
    </div>
  );
}

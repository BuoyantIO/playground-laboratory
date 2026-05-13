export function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`mb-4 font-mono text-xs uppercase tracking-[0.18em] text-navy-60 ${className}`}
    >
      {children}
    </h2>
  );
}

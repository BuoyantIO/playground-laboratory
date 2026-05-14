'use client';

import { useTranslation } from '../lib/i18n';

export function StatusPill({ ok, status }: { ok: boolean; status: number }) {
  if (status === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-button bg-red/10 px-2.5 py-0.5 text-xs font-semibold text-red">
        <span className="h-1.5 w-1.5 rounded-full bg-red" />
        ERR
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-button px-2.5 py-0.5 text-xs font-semibold ${
        ok ? 'bg-electric/40 text-navy' : 'bg-red/10 text-red'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-green' : 'bg-red'}`} />
      {status}
    </span>
  );
}

export function VersionPill({ version }: { version?: string }) {
  const v = version || '';
  const known = v === 'v1' || v === 'v2';
  const colorClass = !known
    ? 'bg-navy-5 text-navy-50'
    : v === 'v1'
      ? 'bg-electric/40 text-navy'
      : 'bg-navy text-electric';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-button px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {v || '—'}
    </span>
  );
}

export function MeshPill({ clientId }: { clientId?: string }) {
  const { t } = useTranslation();
  const meshed = !!clientId;
  return (
    <span
      title={clientId || t('pills.plain.title')}
      className={`inline-flex items-center gap-1.5 rounded-button px-2.5 py-0.5 text-xs font-semibold ${
        meshed ? 'bg-electric/40 text-navy' : 'bg-red/10 text-red'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${meshed ? 'bg-green' : 'bg-red'}`}
      />
      {meshed ? 'mTLS' : 'plain'}
    </span>
  );
}

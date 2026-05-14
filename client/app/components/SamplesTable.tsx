'use client';

import { useTranslation } from '../lib/i18n';
import type { Sample } from '../lib/types';
import { MeshPill, StatusPill, VersionPill } from './Pills';

export function SamplesTable({ samples }: { samples: Sample[] }) {
  const { t } = useTranslation();
  return (
    <div className="max-h-80 overflow-y-auto rounded-card border border-gray1 bg-white">
      <table className="w-full text-left font-mono text-sm">
        <thead className="sticky top-0 border-b border-gray1 bg-navy-3 text-navy-60">
          <tr>
            <th className="px-6 py-3.5 font-medium">{t('table.time')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.status')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.latency')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.version')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.mtls')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.servedBy')}</th>
            <th className="px-6 py-3.5 font-medium">{t('table.body')}</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => (
            <tr
              key={`${s.t}-${i}`}
              className="border-b border-navy-10 last:border-0"
            >
              <td className="px-6 py-3.5 text-navy-70">
                {new Date(s.t).toLocaleTimeString()}
              </td>
              <td className="px-6 py-3.5">
                <StatusPill ok={s.ok} status={s.status} />
              </td>
              <td className="px-6 py-3.5 text-navy">{s.latencyMs} ms</td>
              <td className="px-6 py-3.5">
                <VersionPill version={s.appVersion} />
              </td>
              <td className="px-6 py-3.5">
                <MeshPill clientId={s.meshClientId} />
              </td>
              <td className="px-6 py-3.5 text-navy-60 truncate max-w-[14rem]">
                {s.servedBy || '—'}
              </td>
              <td className="px-6 py-3.5 text-navy-70 truncate max-w-xs">
                {(s.proxyError || s.error || s.body || '').trim() || '—'}
              </td>
            </tr>
          ))}
          {samples.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-6 py-14 text-center text-navy-40"
              >
                {t('table.waiting')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import type { Sample } from '../lib/types';
import { MeshPill, StatusPill, VersionPill } from './Pills';

export function SamplesTable({ samples }: { samples: Sample[] }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-card border border-gray1 bg-white">
      <table className="w-full text-left font-mono text-sm">
        <thead className="sticky top-0 border-b border-gray1 bg-navy-3 text-navy-60">
          <tr>
            <th className="px-6 py-3 font-medium">Time</th>
            <th className="px-6 py-3 font-medium">Status</th>
            <th className="px-6 py-3 font-medium">Latency</th>
            <th className="px-6 py-3 font-medium">Version</th>
            <th className="px-6 py-3 font-medium">mTLS</th>
            <th className="px-6 py-3 font-medium">Served by</th>
            <th className="px-6 py-3 font-medium">Body</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => (
            <tr
              key={`${s.t}-${i}`}
              className="border-b border-navy-10 last:border-0"
            >
              <td className="px-6 py-2.5 text-navy-70">
                {new Date(s.t).toLocaleTimeString()}
              </td>
              <td className="px-6 py-2.5">
                <StatusPill ok={s.ok} status={s.status} />
              </td>
              <td className="px-6 py-2.5 text-navy">{s.latencyMs} ms</td>
              <td className="px-6 py-2.5">
                <VersionPill version={s.appVersion} />
              </td>
              <td className="px-6 py-2.5">
                <MeshPill clientId={s.meshClientId} />
              </td>
              <td className="px-6 py-2.5 text-navy-60 truncate max-w-[14rem]">
                {s.servedBy || '—'}
              </td>
              <td className="px-6 py-2.5 text-navy-70 truncate max-w-xs">
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
                waiting for first response…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n';
import type { Sample } from '../lib/types';
import { MeshPill, StatusPill, VersionPill } from './Pills';

// The raw HTTP request for a sample. Prefer what the generator captured; fall
// back to reconstructing it from the upstream URL.
function rawRequestOf(s: Sample): string {
  if (s.request) return s.request;
  let path = '/';
  let host = 'playground-server-http.playground.svc.cluster.local:8080';
  try {
    const u = new URL(s.upstream || `http://${host}/`);
    path = (u.pathname || '/') + (u.search || '');
    host = u.host;
  } catch {
    /* defaults */
  }
  return (
    `GET ${path} HTTP/1.1\r\nHost: ${host}\r\n` +
    `Accept: */*\r\nAccept-Encoding: gzip, deflate\r\nConnection: keep-alive\r\n\r\n`
  );
}

function toHexSpaced(hex: string): string {
  return (hex.match(/.{1,2}/g) || []).join(' ');
}

// Real AES-256-GCM ciphertext of the request, via the server (works in any
// context, unlike window.crypto.subtle which needs a secure origin).
async function encryptRequest(text: string): Promise<string> {
  const r = await fetch('/api/encrypt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error('encrypt failed');
  const { hex } = (await r.json()) as { hex: string };
  return toHexSpaced(hex);
}

function RawRequestModal({
  sample,
  onClose,
}: {
  sample: Sample;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const meshed = !!sample.meshClientId;
  const raw = rawRequestOf(sample);
  const [cipher, setCipher] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!meshed) return;
    let cancelled = false;
    setCipher(null);
    setErr(false);
    encryptRequest(raw)
      .then((hex) => !cancelled && setCipher(hex))
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
    };
  }, [meshed, raw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // a11y: label the dialog, move focus to Close on open, restore it on close.
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-2xl rounded-card border border-gray1 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-navy-10 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span id={titleId} className="font-sans text-sm font-semibold text-navy">
              {t('raw.title')}
            </span>
            <StatusPill ok={sample.ok} status={sample.status} />
            <MeshPill clientId={sample.meshClientId} />
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('raw.close')}
            title={t('raw.close')}
            className="shrink-0 rounded-md border border-navy-20 px-2 py-0.5 font-mono text-sm leading-none text-navy-60 transition hover:bg-navy-5 hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 focus-visible:ring-offset-1"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          <p
            className={`mb-2.5 font-mono text-xs ${meshed ? 'text-green' : 'text-red'}`}
          >
            {meshed ? t('raw.encrypted') : t('raw.plaintext')}
          </p>
          <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-all rounded-card border border-navy-10 bg-navy px-4 py-3.5 font-mono text-[12px] leading-relaxed text-electric">
            {meshed ? (err ? 'encryption unavailable' : (cipher ?? '…')) : raw}
          </pre>
          {sample.upstream && (
            <p className="mt-2.5 break-all font-mono text-[11px] text-navy-40">
              → {sample.upstream}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SamplesTable({ samples }: { samples: Sample[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Sample | null>(null);

  return (
    <>
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
              <th className="px-6 py-3.5 text-right font-medium">{t('table.raw')}</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s, i) => (
              <tr
                key={`${s.t}-${i}`}
                className="border-b border-navy-10 last:border-0 hover:bg-navy-3"
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
                <td className="max-w-[14rem] truncate px-6 py-3.5 text-navy-60">
                  {s.servedBy || '-'}
                </td>
                <td className="max-w-xs truncate px-6 py-3.5 text-navy-70">
                  {(s.proxyError || s.error || s.body || '').trim() || '-'}
                </td>
                <td className="px-6 py-3.5 text-right">
                  <button
                    type="button"
                    onClick={() => setOpen(s)}
                    className="rounded-md border border-navy-20 px-2.5 py-1 font-mono text-[11px] text-navy-60 transition hover:bg-navy-5 hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 focus-visible:ring-offset-1"
                  >
                    {t('table.raw')}
                  </button>
                </td>
              </tr>
            ))}
            {samples.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-navy-40">
                  {t('table.waiting')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && <RawRequestModal sample={open} onClose={() => setOpen(null)} />}
    </>
  );
}

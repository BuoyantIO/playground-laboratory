'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { tutorials } from '../lib/tutorials';
import { Markdown } from './Markdown';

interface TutorialPanelProps {
  slug: string;
  onSlugChange: (slug: string) => void;
  onClose: () => void;
}

type Content = Record<'en' | 'kr', string>;

export function TutorialPanel({ slug, onSlugChange, onClose }: TutorialPanelProps) {
  const { lang, t } = useTranslation();
  const [content, setContent] = useState<Content | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setContent(null);
    fetch(`/api/tutorials/${slug}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((c: Content) => {
        if (!cancelled) {
          setContent(c);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const body = content ? content[lang] ?? content.en : '';

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header: tutorial selector + collapse */}
      <div className="flex items-center gap-2 border-b border-navy-10 bg-navy-2 px-4 py-3">
        <span className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-navy-50 xl:inline">
          {t('panel.title')}
        </span>
        <select
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          aria-label={t('panel.select')}
          className="min-w-0 flex-1 rounded-md border border-navy-20 bg-white px-2.5 py-1.5 font-mono text-xs text-navy transition focus:border-navy focus:outline-none focus:ring-2 focus:ring-electric/40"
        >
          {tutorials.map((x) => (
            <option key={x.slug} value={x.slug}>
              {x.order} · {x.title[lang]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('panel.collapse')}
          title={t('panel.collapse')}
          className="shrink-0 rounded-md border border-navy-20 px-3 py-1.5 font-mono text-sm leading-none text-navy-60 transition hover:bg-navy-5 hover:text-navy"
        >
          ›
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {status === 'loading' && (
          <p className="font-mono text-sm text-navy-50">{t('panel.loading')}</p>
        )}
        {status === 'error' && (
          <p className="font-mono text-sm text-red">{t('panel.failed')}</p>
        )}
        {status === 'ready' && <Markdown content={body} />}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useTranslation } from '../lib/i18n';
import { SLIDES_URL, type TutorialMeta } from '../lib/tutorials';

export function TutorialList({ tutorials }: { tutorials: TutorialMeta[] }) {
  const { lang, t } = useTranslation();
  return (
    <section className="mx-auto max-w-5xl px-6 py-12 md:px-12 md:py-16">
      <header className="mb-10">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-navy-50">
          {t('tutorials.section')}
        </div>
        <h1 className="mt-3 font-sans text-4xl font-medium leading-tight tracking-tight text-navy md:text-5xl">
          {t('tutorials.listTitle')}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-navy-70 md:text-lg">
          {t('tutorials.listSubtitle')}
        </p>
        <a
          href={SLIDES_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-button border border-navy bg-navy px-4 py-2 font-sans text-sm font-semibold text-electric transition-colors hover:bg-navy-90"
        >
          {t('tutorials.slides')}
        </a>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {tutorials.map(meta => (
          <li key={meta.slug}>
            <Link
              href={`/tutorials/${meta.slug}`}
              className="group flex h-full flex-col rounded-card border border-navy-10 bg-white p-6 transition hover:border-navy-40 hover:shadow-sm"
            >
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-navy-50">
                {t('tutorials.runbook')} {meta.order}
              </span>
              <span className="mt-3 font-sans text-lg font-semibold text-navy group-hover:text-electric">
                {meta.title[lang]}
              </span>
              <span className="mt-3 text-sm leading-relaxed text-navy-70">
                {meta.blurb[lang]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useTranslation } from '../lib/i18n';
import type { TutorialMeta } from '../lib/tutorials';
import { Markdown } from './Markdown';

interface TutorialViewProps {
  meta: TutorialMeta;
  content: { en: string; kr: string };
  prev?: TutorialMeta;
  next?: TutorialMeta;
}

export function TutorialView({ meta, content, prev, next }: TutorialViewProps) {
  const { lang, t } = useTranslation();
  const body = content[lang] ?? content.en;

  return (
    <article className="mx-auto max-w-4xl px-6 py-12 md:px-12 md:py-16">
      <Link
        href="/tutorials"
        className="font-mono text-xs uppercase tracking-[0.18em] text-navy-60 hover:text-navy"
      >
        ← {t('tutorials.backToList')}
      </Link>

      <header className="mt-6 mb-10">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-navy-50">
          {t('tutorials.runbook')} {meta.order}
        </div>
        <h1 className="mt-3 font-sans text-4xl font-medium leading-tight tracking-tight text-navy md:text-5xl">
          {meta.title[lang]}
        </h1>
      </header>

      <Markdown content={body} />

      <nav className="mt-16 flex flex-col gap-4 border-t border-navy-10 pt-8 md:flex-row md:justify-between">
        {prev ? (
          <Link
            href={`/tutorials/${prev.slug}`}
            className="group flex flex-col gap-1 rounded-card border border-navy-10 bg-white px-5 py-4 transition hover:border-navy-40 md:max-w-[48%]"
          >
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-navy-50">
              ← {t('tutorials.previous')}
            </span>
            <span className="font-sans text-sm font-semibold text-navy group-hover:text-electric">
              {prev.title[lang]}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/tutorials/${next.slug}`}
            className="group flex flex-col gap-1 rounded-card border border-navy-10 bg-white px-5 py-4 text-right transition hover:border-navy-40 md:max-w-[48%]"
          >
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-navy-50">
              {t('tutorials.next')} →
            </span>
            <span className="font-sans text-sm font-semibold text-navy group-hover:text-electric">
              {next.title[lang]}
            </span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

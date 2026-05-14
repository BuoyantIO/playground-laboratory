'use client';

import { useTranslation } from '../lib/i18n';
import { AcademyHat } from './Icons';

export function Hero() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden bg-hero-glow">
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-20 md:px-12 md:pb-20 md:pt-24">
        <div className="max-w-3xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-button border border-navy-20 bg-white px-4 py-1.5">
            <AcademyHat className="h-4 w-4 text-navy" />
            <span className="font-sans text-sm font-semibold text-navy">
              {t('hero.badge')}
            </span>
            <span className="ml-1 text-navy-60">·</span>
            <span className="font-mono text-xs text-navy-60">{t('hero.demo')}</span>
          </div>

          <h1 className="font-sans text-5xl font-medium leading-[1.1] tracking-tight text-navy md:text-7xl">
            {t('hero.titleA')}<br />
            <span className="text-navy-60">{t('hero.titleB')}</span>
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-navy-70 md:text-xl">
            {t('hero.subtitle')}
          </p>
        </div>
      </div>
    </section>
  );
}

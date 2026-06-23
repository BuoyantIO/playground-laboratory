'use client';

import { useTranslation } from '../lib/i18n';
import { ArrowRight } from './Icons';

export function AnnouncementBar() {
  const { t } = useTranslation();
  return (
    <div className="sticky top-[60px] z-20 w-full bg-navy text-white">
      <div className="mx-auto flex min-h-10 max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center">
        <p className="font-sans text-sm">{t('announcement.title')}</p>
        <a
          href="https://buoyant.io/self-paced-courses"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm font-sans text-sm font-semibold text-electric transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
        >
          {t('announcement.cta')}
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

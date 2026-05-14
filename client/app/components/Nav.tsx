'use client';

import { useTranslation } from '../lib/i18n';
import { LanguageToggle } from './LanguageToggle';

export function Nav() {
  const { t } = useTranslation();
  return (
    <nav className="sticky top-0 z-30 border-b border-navy-10 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-6 md:px-12">
        <div className="flex items-center gap-3">
          <img src="/buoyant.png" alt="Buoyant" className="h-6 w-auto" />
          <span className="hidden h-5 w-px bg-navy-20 sm:block" />
          <span className="hidden font-mono text-xs uppercase tracking-[0.18em] text-navy-60 sm:inline">
            {t('nav.demo')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <a
            href="https://buoyant.io/service-mesh-academy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-button border border-navy bg-white px-4 py-1.5 font-sans text-sm font-semibold text-navy transition-colors hover:bg-navy-10"
          >
            {t('nav.academy')}
          </a>
        </div>
      </div>
    </nav>
  );
}

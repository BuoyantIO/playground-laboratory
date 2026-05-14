'use client';

import { useTranslation } from '../lib/i18n';

interface FooterProps {
  pollIntervalMs: number;
}

export function Footer({ pollIntervalMs }: FooterProps) {
  const { t } = useTranslation();
  const text =
    pollIntervalMs <= 0
      ? t('footer.paused')
      : pollIntervalMs >= 1000
        ? t('footer.intervalSec', { sec: pollIntervalMs / 1000 })
        : t('footer.intervalMs', { ms: pollIntervalMs });

  return (
    <footer className="mt-16 border-t border-navy-10 pt-6 text-sm text-navy-50">
      <span className="font-sans">{t('footer.brand')}</span>
      <span className="mx-2 text-navy-30">·</span>
      <span className="font-mono text-xs">{text}</span>
    </footer>
  );
}

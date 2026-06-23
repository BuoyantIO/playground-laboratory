'use client';

import { useTranslation } from '../lib/i18n';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="mt-16 border-t border-navy-10 pt-6 text-sm text-navy-50">
      <span className="font-sans">{t('footer.brand')}</span>
    </footer>
  );
}

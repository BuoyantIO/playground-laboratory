'use client';

import { useTranslation, type Lang } from '../lib/i18n';

const langs: Lang[] = ['en', 'kr'];

export function LanguageToggle() {
  const { lang, setLang, t } = useTranslation();
  return (
    <div className="inline-flex items-center gap-0.5 rounded-button border border-navy-20 bg-white p-0.5">
      {langs.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          aria-label={t(`lang.${l}`)}
          className={`rounded-button px-2 py-1 font-mono text-xs font-semibold uppercase transition-colors ${
            lang === l
              ? 'bg-navy text-white'
              : 'text-navy-60 hover:text-navy'
          }`}
        >
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

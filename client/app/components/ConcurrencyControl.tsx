'use client';

import { CONCURRENCY_OPTIONS } from '../lib/constants';
import { useTranslation } from '../lib/i18n';
import { ConfigField } from './ConfigField';

interface ConcurrencyControlProps {
  concurrency: number;
  onChange: (n: number) => void;
}

const SELECT_CLASS =
  'w-full rounded-md border border-navy-20 bg-white px-3 py-2 font-mono text-sm text-navy transition focus:border-navy focus:outline-none focus:ring-2 focus:ring-electric/40';

/**
 * Selects how many request lanes the generator runs in parallel. Each lane
 * pings on the polling interval, so the effective rate ≈ concurrency / interval.
 */
export function ConcurrencyControl({
  concurrency,
  onChange,
}: ConcurrencyControlProps) {
  const { t } = useTranslation();

  const options = CONCURRENCY_OPTIONS.includes(concurrency)
    ? CONCURRENCY_OPTIONS
    : [...CONCURRENCY_OPTIONS, concurrency].sort((a, b) => a - b);

  return (
    <ConfigField
      label={t('concurrency.label')}
      htmlFor="concurrency"
      hint={t('concurrency.hint', { n: concurrency })}
    >
      <select
        id="concurrency"
        value={concurrency}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={SELECT_CLASS}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </ConfigField>
  );
}

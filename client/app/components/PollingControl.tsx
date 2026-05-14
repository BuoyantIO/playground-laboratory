'use client';

import { POLL_INTERVAL_OPTIONS } from '../lib/constants';
import { useTranslation } from '../lib/i18n';
import { ConfigField } from './ConfigField';

interface PollingControlProps {
  pollIntervalMs: number;
  onChange: (ms: number) => void;
}

/**
 * Dropdown that selects how often the client polls the upstream server.
 * Value of 0 means polling is paused. Renders as a labeled field inside
 * a <ConfigPanel>.
 */
export function PollingControl({
  pollIntervalMs,
  onChange,
}: PollingControlProps) {
  const { t } = useTranslation();

  // If the active value isn't one of the predefined options (e.g. set via
  // env to a non-canonical value), append it so the dropdown still reflects
  // the truth.
  const baseOptions = POLL_INTERVAL_OPTIONS.some(o => o.value === pollIntervalMs)
    ? POLL_INTERVAL_OPTIONS
    : [
        ...POLL_INTERVAL_OPTIONS,
        { label: `${pollIntervalMs} ms`, value: pollIntervalMs },
      ];

  const options = baseOptions.map(opt =>
    opt.value === 0 ? { ...opt, label: t('polling.paused') } : opt,
  );

  const hint =
    pollIntervalMs <= 0
      ? t('polling.hintPaused')
      : t('polling.hintActive', { ms: pollIntervalMs });

  return (
    <ConfigField label={t('polling.label')} htmlFor="poll-interval" hint={hint}>
      <select
        id="poll-interval"
        value={pollIntervalMs}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full rounded-md border border-navy-20 bg-white px-3 py-2 font-mono text-sm text-navy transition focus:border-navy focus:outline-none focus:ring-2 focus:ring-electric/40"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </ConfigField>
  );
}

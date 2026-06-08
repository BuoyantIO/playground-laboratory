'use client';

import { useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { ConfigField } from './ConfigField';

interface HeadersControlProps {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

type Row = { k: string; v: string };

const INPUT_CLASS =
  'min-w-0 flex-1 rounded-md border border-navy-20 bg-white px-2.5 py-1.5 font-mono text-xs text-navy transition focus:border-navy focus:outline-none focus:ring-2 focus:ring-electric/40';

/**
 * Edits the custom request headers attached to every generated request (e.g.
 * Host, l5d-dst-override). Rows commit on blur / add / remove — not on every
 * keystroke — so we don't POST a half-typed header.
 */
export function HeadersControl({ headers, onChange }: HeadersControlProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(headers).map(([k, v]) => ({ k, v })),
  );

  const emit = (next: Row[]) => {
    const rec: Record<string, string> = {};
    for (const r of next) {
      const key = r.k.trim();
      if (key) rec[key] = r.v;
    }
    onChange(rec);
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    setRows(next);
    emit(next);
  };
  const add = () => setRows((prev) => [...prev, { k: '', v: '' }]);

  return (
    <ConfigField label={t('headers.label')} hint={t('headers.hint')}>
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <span className="font-mono text-[11px] text-navy-40">
            {t('headers.empty')}
          </span>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={t('headers.name')}
              value={r.k}
              placeholder={t('headers.name')}
              onChange={(e) => update(i, { k: e.target.value })}
              onBlur={() => emit(rows)}
              className={INPUT_CLASS}
            />
            <input
              aria-label={t('headers.value')}
              value={r.v}
              placeholder={t('headers.value')}
              onChange={(e) => update(i, { v: e.target.value })}
              onBlur={() => emit(rows)}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              aria-label={t('headers.remove')}
              onClick={() => remove(i)}
              className="shrink-0 rounded-md border border-navy-20 px-2 py-1.5 font-mono text-xs text-navy-60 transition hover:bg-navy-5"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="self-start rounded-md border border-navy-20 px-3 py-1.5 font-mono text-xs text-navy-70 transition hover:bg-navy-5"
        >
          {t('headers.add')}
        </button>
      </div>
    </ConfigField>
  );
}

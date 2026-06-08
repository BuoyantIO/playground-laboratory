'use client';

import { useEffect, useState } from 'react';
import { TARGET_AUTHORITY_OPTIONS } from '../lib/constants';
import { useTranslation } from '../lib/i18n';
import type { TargetAuthority, TargetConfig } from '../lib/types';
import { ConfigField } from './ConfigField';

interface TargetControlProps {
  target: TargetConfig;
  onChange: (patch: Partial<TargetConfig>) => void;
}

const FIELD_CLASS =
  'w-full rounded-md border border-navy-20 bg-white px-3 py-2 font-mono text-sm text-navy transition focus:border-navy focus:outline-none focus:ring-2 focus:ring-electric/40';

/**
 * Chooses which destination the generator hits: the apex Service (round-robin
 * across v1/v2), a per-role Service, or a custom URL — plus the request path.
 * Selects commit immediately; text inputs commit on blur / Enter so we don't
 * thrash the target on every keystroke.
 */
export function TargetControl({ target, onChange }: TargetControlProps) {
  const { t } = useTranslation();

  // Local buffers for the free-text fields; re-synced if the prop changes.
  const [path, setPath] = useState(target.path);
  const [url, setUrl] = useState(target.url);
  useEffect(() => setPath(target.path), [target.path]);
  useEffect(() => setUrl(target.url), [target.url]);

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <>
      <ConfigField
        label={t('target.label')}
        htmlFor="target-authority"
        hint={t('target.hint')}
      >
        <select
          id="target-authority"
          value={target.authority}
          onChange={(e) =>
            onChange({ authority: e.target.value as TargetAuthority })
          }
          className={FIELD_CLASS}
        >
          {TARGET_AUTHORITY_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`target.${a}`)}
            </option>
          ))}
        </select>
      </ConfigField>

      <ConfigField label={t('target.pathLabel')} htmlFor="target-path">
        <input
          id="target-path"
          value={path}
          placeholder="/"
          onChange={(e) => setPath(e.target.value)}
          onBlur={() => onChange({ path })}
          onKeyDown={blurOnEnter}
          className={FIELD_CLASS}
        />
      </ConfigField>

      {target.authority === 'custom' && (
        <ConfigField
          label={t('target.urlLabel')}
          htmlFor="target-url"
          hint={t('target.urlHint')}
        >
          <input
            id="target-url"
            value={url}
            placeholder="http://host:port"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => onChange({ url })}
            onKeyDown={blurOnEnter}
            className={FIELD_CLASS}
          />
        </ConfigField>
      )}
    </>
  );
}

'use client';

import type { ReactNode } from 'react';

interface ConfigFieldProps {
  /** Short, prominent label rendered above the control. */
  label: string;
  /** htmlFor target — must match the control's id. */
  htmlFor?: string;
  /** Optional helper text rendered below the control. */
  hint?: string;
  /** The actual form control (select, input, button, etc.). */
  children: ReactNode;
}

/**
 * Generic labeled wrapper for a single config control. Use inside a
 * <ConfigPanel> so layout, label typography, and help-text styling stay
 * consistent as more settings are added.
 */
export function ConfigField({
  label,
  htmlFor,
  hint,
  children,
}: ConfigFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-60"
      >
        {label}
      </label>
      {children}
      {hint && (
        <span className="font-mono text-[11px] leading-snug text-navy-50">
          {hint}
        </span>
      )}
    </div>
  );
}

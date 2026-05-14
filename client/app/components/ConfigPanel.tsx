'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from './Icons';

interface ConfigPanelProps {
  /** Section title shown at the top of the panel. */
  title?: string;
  /** Optional short description rendered below the title. */
  description?: string;
  /** Whether the panel starts expanded. Default false (collapsed). */
  defaultOpen?: boolean;
  /** One or more <ConfigField> children. */
  children: ReactNode;
}

/**
 * Collapsible container for runtime client-side configuration.
 *
 * Use one panel per logical group of controls (e.g. "Client controls",
 * "Server overrides"). Children should be <ConfigField> instances so that
 * label, control, and help-text styling stay consistent across settings.
 *
 * The header acts as a toggle: click to collapse/expand. State is local to
 * the component instance; if persistence is needed later, lift it up.
 */
export function ConfigPanel({
  title = 'Client controls',
  description,
  defaultOpen = false,
  children,
}: ConfigPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-navy-10 bg-navy-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-navy-10/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/40"
      >
        <div>
          <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-navy-60">
            {title}
          </h2>
          {description && (
            <p className="mt-1 font-mono text-xs text-navy-50">{description}</p>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-navy-60 transition-transform duration-200 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
      </button>

      {open && (
        <div
          id={contentId}
          className="border-t border-navy-10 px-6 pb-6 pt-5"
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
            {children}
          </div>
        </div>
      )}
    </section>
  );
}

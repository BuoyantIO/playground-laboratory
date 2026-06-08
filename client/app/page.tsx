'use client';

import { useEffect, useState } from 'react';
import { AnnouncementBar } from './components/AnnouncementBar';
import { ConcurrencyControl } from './components/ConcurrencyControl';
import { Counters } from './components/Counters';
import { Footer } from './components/Footer';
import { HeadersControl } from './components/HeadersControl';
import { Hero } from './components/Hero';
import { LatencyChart } from './components/LatencyChart';
import { Nav } from './components/Nav';
import { PollingControl } from './components/PollingControl';
import { SamplesTable } from './components/SamplesTable';
import { SectionLabel } from './components/SectionLabel';
import { TargetControl } from './components/TargetControl';
import { Topology } from './components/Topology';
import { TutorialPanel } from './components/TutorialPanel';
import { usePinger } from './hooks/usePinger';
import { MAX_HISTORY } from './lib/constants';
import { useTranslation } from './lib/i18n';
import { tutorials } from './lib/tutorials';

const OPEN_KEY = 'sma.tutorial.open';
const SLUG_KEY = 'sma.tutorial.slug';
const CONTROLS_KEY = 'sma.controls.open';

export default function Home() {
  const { samples, upstream, counters, config, setConfig } = usePinger();
  const { t } = useTranslation();

  const [panelOpen, setPanelOpen] = useState(false);
  const [slug, setSlug] = useState(tutorials[0].slug);
  const [controlsOpen, setControlsOpen] = useState(true);

  // Restore panel state after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === '1') setPanelOpen(true);
      if (localStorage.getItem(CONTROLS_KEY) === '0') setControlsOpen(false);
      const s = localStorage.getItem(SLUG_KEY);
      if (s && tutorials.some((x) => x.slug === s)) setSlug(s);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setOpen = (open: boolean) => {
    setPanelOpen(open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const changeSlug = (s: string) => {
    setSlug(s);
    try {
      localStorage.setItem(SLUG_KEY, s);
    } catch {
      /* ignore */
    }
  };
  const setControls = (open: boolean) => {
    setControlsOpen(open);
    try {
      localStorage.setItem(CONTROLS_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const effectiveInterval = config.pollEnabled ? config.pollIntervalMs : 0;

  return (
    <div className="min-h-screen bg-white text-navy">
      <Nav />
      <AnnouncementBar />

      <div className="flex flex-col lg:flex-row">
        {/* Center: the live visualization (DOM-first so mobile shows it first). */}
        <div className="min-w-0 flex-1 lg:order-2">
          <Hero />

          <main className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-14">
            <SectionLabel>{t('section.live')}</SectionLabel>
            <Topology samples={samples} counters={counters} upstream={upstream} />

            <SectionLabel className="mt-14">{t('section.latency')}</SectionLabel>
            <LatencyChart samples={samples} />

            <SectionLabel className="mt-14">{t('section.counters')}</SectionLabel>
            <Counters samples={samples} counters={counters} />

            <SectionLabel className="mt-14">
              {t('section.samples')}
              <span className="ml-2 font-mono text-xs font-normal normal-case tracking-normal text-navy-40">
                {samples.length} / {MAX_HISTORY}
              </span>
            </SectionLabel>
            <SamplesTable samples={samples} />

            <Footer pollIntervalMs={effectiveInterval} />
          </main>
        </div>

        {/* Left: generator controls (collapsible). */}
        {controlsOpen && (
          <aside className="shrink-0 border-t border-navy-10 bg-navy-2 lg:order-1 lg:sticky lg:top-[100px] lg:h-[calc(100vh-100px)] lg:w-80 lg:overflow-y-auto lg:border-r lg:border-t-0">
            <div className="px-5 py-6 md:px-6">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-navy-60">
                  {t('config.title')}
                </h2>
                <button
                  type="button"
                  onClick={() => setControls(false)}
                  aria-label={t('controls.collapse')}
                  title={t('controls.collapse')}
                  className="shrink-0 rounded-md border border-navy-20 px-2.5 py-1 font-mono text-sm leading-none text-navy-60 transition hover:bg-navy-5 hover:text-navy"
                >
                  ‹
                </button>
              </div>
              <p className="mt-1 font-mono text-xs leading-relaxed text-navy-50">
                {t('config.description')}
              </p>
              <div className="mt-5 flex flex-col gap-5">
                <PollingControl
                  pollIntervalMs={effectiveInterval}
                  onChange={(ms) =>
                    setConfig({ pollIntervalMs: ms, pollEnabled: ms > 0 })
                  }
                />
                <ConcurrencyControl
                  concurrency={config.concurrency}
                  onChange={(n) => setConfig({ concurrency: n })}
                />
                <TargetControl
                  target={config.target}
                  onChange={(patch) =>
                    setConfig({ target: { ...config.target, ...patch } })
                  }
                />
                <HeadersControl
                  headers={config.headers}
                  onChange={(headers) => setConfig({ headers })}
                />
              </div>
            </div>
          </aside>
        )}

        {/* Right: tutorial panel: 39% split on large screens, full-screen
            overlay on small ones, with a shadow to separate it. */}
        {panelOpen && (
          <aside className="fixed inset-0 z-50 w-full bg-white lg:static lg:z-auto lg:order-3 lg:w-[39%] lg:shrink-0 lg:border-l lg:border-navy-10 lg:shadow-[-14px_0_36px_-18px_rgba(2,12,27,0.22)]">
            <div className="h-full lg:sticky lg:top-[100px] lg:h-[calc(100vh-100px)]">
              <TutorialPanel
                slug={slug}
                onSlugChange={changeSlug}
                onClose={() => setOpen(false)}
              />
            </div>
          </aside>
        )}
      </div>

      {/* Left-edge tab to reveal the generator controls when collapsed. */}
      {!controlsOpen && (
        <button
          type="button"
          onClick={() => setControls(true)}
          className="fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-lg border border-l-0 border-navy-10 bg-white px-2 py-5 font-mono text-[11px] uppercase tracking-[0.18em] text-navy-60 shadow-md transition hover:text-navy [writing-mode:vertical-rl]"
        >
          {t('controls.open')}
        </button>
      )}

      {/* Right-edge tab to reveal the tutorial panel when collapsed. */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg border border-r-0 border-navy-10 bg-white px-2 py-5 font-mono text-[11px] uppercase tracking-[0.18em] text-navy-60 shadow-md transition hover:text-navy [writing-mode:vertical-rl]"
        >
          {t('panel.open')}
        </button>
      )}
    </div>
  );
}

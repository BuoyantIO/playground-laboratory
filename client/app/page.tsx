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

      {/* Center: the live visualization - full-width; the panels overlay it. */}
      <div className="min-w-0">
        <div>
          <Hero />

          <main className="mx-auto max-w-6xl px-6 py-12 md:px-10 md:py-14">
            <SectionLabel>{t('section.live')}</SectionLabel>
            <Topology
              samples={samples}
              counters={counters}
              upstream={upstream}
              concurrency={config.concurrency}
            />

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

            <Footer />
          </main>
        </div>

        {/* Left: generator controls - overlay drawer; slides over the body
            instead of compressing it. */}
        <aside
          className={`fixed bottom-0 left-0 top-[100px] z-40 w-80 max-w-[88vw] overflow-y-auto border-r border-navy-10 bg-navy-3 shadow-[14px_0_36px_-18px_rgba(2,12,27,0.22)] transition-transform duration-300 ease-in-out ${
            controlsOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-5 py-6 md:px-6">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-navy-60">
              {t('config.title')}
            </h2>
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

        {/* Right: tutorial panel - overlay drawer; slides over the body. */}
        <aside
          className={`fixed bottom-0 right-0 top-[100px] z-40 w-full bg-white shadow-[-14px_0_36px_-18px_rgba(2,12,27,0.22)] transition-transform duration-300 ease-in-out lg:w-[39vw] ${
            panelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <TutorialPanel slug={slug} onSlugChange={changeSlug} />
        </aside>
      </div>

      {/* Controls toggle: one vertically-centered tab that slides to the panel
          edge when open, so collapse sits exactly where expand appears. */}
      <button
        type="button"
        onClick={() => setControls(!controlsOpen)}
        aria-label={controlsOpen ? t('controls.collapse') : t('controls.open')}
        title={controlsOpen ? t('controls.collapse') : t('controls.open')}
        className={`fixed top-1/2 z-[60] -translate-y-1/2 rounded-r-lg border border-l-0 border-navy-10 bg-white px-2 py-5 font-mono text-[11px] uppercase leading-none tracking-[0.18em] text-navy-60 shadow-md transition-[left] duration-300 ease-in-out hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 ${
          controlsOpen ? 'left-80' : 'left-0'
        }`}
      >
        {controlsOpen ? (
          <span aria-hidden className="block text-base">‹</span>
        ) : (
          <span className="[writing-mode:vertical-rl]">{t('controls.open')}</span>
        )}
      </button>

      {/* Tutorial toggle: mirrors the controls toggle on the right edge. */}
      <button
        type="button"
        onClick={() => setOpen(!panelOpen)}
        aria-label={panelOpen ? t('panel.collapse') : t('panel.open')}
        title={panelOpen ? t('panel.collapse') : t('panel.open')}
        className={`fixed top-1/2 z-[60] -translate-y-1/2 rounded-l-lg border border-r-0 border-navy-10 bg-white px-2 py-5 font-mono text-[11px] uppercase leading-none tracking-[0.18em] text-navy-60 shadow-md transition-[right] duration-300 ease-in-out hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 ${
          panelOpen ? 'right-0 lg:right-[39vw]' : 'right-0'
        }`}
      >
        {panelOpen ? (
          <span aria-hidden className="block text-base">›</span>
        ) : (
          <span className="[writing-mode:vertical-rl]">{t('panel.open')}</span>
        )}
      </button>
    </div>
  );
}

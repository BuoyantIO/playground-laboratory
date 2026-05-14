'use client';

import { AnnouncementBar } from './components/AnnouncementBar';
import { ConfigPanel } from './components/ConfigPanel';
import { Counters } from './components/Counters';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { LatencyChart } from './components/LatencyChart';
import { Nav } from './components/Nav';
import { PollingControl } from './components/PollingControl';
import { SamplesTable } from './components/SamplesTable';
import { SectionLabel } from './components/SectionLabel';
import { Topology } from './components/Topology';
import { usePinger } from './hooks/usePinger';
import { MAX_HISTORY } from './lib/constants';
import { useTranslation } from './lib/i18n';

export default function Home() {
  const { samples, upstream, counters, pollIntervalMs, setPollIntervalMs } =
    usePinger();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white text-navy">
      <Nav />
      <AnnouncementBar />
      <Hero />

      <main className="mx-auto max-w-6xl px-6 py-14 md:px-12 md:py-16">
        <ConfigPanel
          title={t('config.title')}
          description={t('config.description')}
        >
          <PollingControl
            pollIntervalMs={pollIntervalMs}
            onChange={setPollIntervalMs}
          />
        </ConfigPanel>

        <SectionLabel className="mt-12">{t('section.live')}</SectionLabel>
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

        <Footer pollIntervalMs={pollIntervalMs} />
      </main>
    </div>
  );
}

'use client';

import { AnnouncementBar } from './components/AnnouncementBar';
import { Counters } from './components/Counters';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { LatencyChart } from './components/LatencyChart';
import { Nav } from './components/Nav';
import { SamplesTable } from './components/SamplesTable';
import { SectionLabel } from './components/SectionLabel';
import { Topology } from './components/Topology';
import { usePinger } from './hooks/usePinger';
import { MAX_HISTORY } from './lib/constants';

export default function Home() {
  const { samples, upstream, counters } = usePinger();

  return (
    <div className="min-h-screen bg-white text-navy">
      <Nav />
      <AnnouncementBar />
      <Hero />

      <main className="mx-auto max-w-6xl px-6 py-14 md:px-12 md:py-16">
        <SectionLabel>Live traffic</SectionLabel>
        <Topology samples={samples} counters={counters} upstream={upstream} />

        <SectionLabel className="mt-14">Latency timeline</SectionLabel>
        <LatencyChart samples={samples} />

        <SectionLabel className="mt-14">Counters</SectionLabel>
        <Counters samples={samples} counters={counters} />

        <SectionLabel className="mt-14">
          Recent samples
          <span className="ml-2 font-mono text-xs font-normal normal-case tracking-normal text-navy-40">
            {samples.length} / {MAX_HISTORY}
          </span>
        </SectionLabel>
        <SamplesTable samples={samples} />

        <Footer />
      </main>
    </div>
  );
}

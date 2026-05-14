import { MAX_HISTORY } from './constants';
import type { Counters, Sample } from './types';

type Listener = (sample: Sample, counters: Counters) => void;

class SamplesStore {
  private samples: Sample[] = [];
  private counters: Counters = { ok: 0, fail: 0, v1: 0, v2: 0, vOther: 0 };
  private listeners = new Set<Listener>();

  record(sample: Sample) {
    this.samples.unshift(sample);
    if (this.samples.length > MAX_HISTORY) this.samples.length = MAX_HISTORY;

    if (sample.ok) {
      this.counters.ok++;
      if (sample.appVersion === 'v1') this.counters.v1++;
      else if (sample.appVersion === 'v2') this.counters.v2++;
      else this.counters.vOther++;
    } else {
      this.counters.fail++;
    }

    const snapshotCounters = { ...this.counters };
    for (const l of this.listeners) {
      try {
        l(sample, snapshotCounters);
      } catch {
        // listener errors must not break recording
      }
    }
  }

  snapshot(): { samples: Sample[]; counters: Counters } {
    return {
      samples: this.samples.slice(),
      counters: { ...this.counters },
    };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

// Survive Next.js dev-mode hot reloads so we keep a single buffer + counter set.
const globalForStore = globalThis as unknown as {
  __samplesStore?: SamplesStore;
};

export const samplesStore: SamplesStore =
  globalForStore.__samplesStore ??
  (globalForStore.__samplesStore = new SamplesStore());

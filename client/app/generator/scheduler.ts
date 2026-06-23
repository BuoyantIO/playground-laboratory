import type { Sample } from '../lib/types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SchedulerConfig = {
  pollIntervalMs: number;
  pollEnabled: boolean;
  concurrency: number;
};

// Runs `concurrency` independent worker lanes. Each active lane performs a ping,
// waits `pollIntervalMs`, and repeats - so the effective rate is roughly
// concurrency / interval. Lanes idle (no pings) while paused. Config can change
// at any time; the worker count and cadence reconcile on the next loop turn.
//
// `ping` and `sink` are injected so this stays pure and unit-testable.
export class Scheduler {
  private intervalMs = 1000;
  private enabled = true;
  private desired = 1;
  private stopped = false;
  private live = new Set<number>();
  private nextId = 0;

  constructor(
    private readonly ping: () => Promise<Sample>,
    private readonly sink: (s: Sample) => void,
  ) {}

  setConfig(c: SchedulerConfig) {
    this.intervalMs = Math.max(0, c.pollIntervalMs);
    this.enabled = c.pollEnabled;
    this.desired = Math.max(1, c.concurrency);
    this.reconcile();
  }

  stop() {
    this.stopped = true;
    this.live.clear();
  }

  private active(): boolean {
    return !this.stopped && this.enabled && this.intervalMs > 0;
  }

  private reconcile() {
    if (this.stopped) return;
    // Grow: spawn lanes until we hit the desired count.
    while (this.live.size < this.desired) {
      const id = this.nextId++;
      this.live.add(id);
      void this.runWorker(id);
    }
    // Shrink: drop the highest-id lanes; they exit on their next loop turn.
    if (this.live.size > this.desired) {
      const ids = [...this.live].sort((a, b) => a - b);
      while (ids.length > this.desired) this.live.delete(ids.pop() as number);
    }
  }

  private async runWorker(id: number) {
    while (!this.stopped && this.live.has(id)) {
      if (this.active()) {
        try {
          this.sink(await this.ping());
        } catch {
          // Never let a single failure kill the lane.
        }
        await sleep(this.intervalMs);
      } else {
        // Paused or interval 0: idle and re-check shortly.
        await sleep(250);
      }
    }
  }
}

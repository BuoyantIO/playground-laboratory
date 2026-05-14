import { performPing } from './ping';
import { samplesStore } from './samplesStore';

class Ticker {
  intervalMs = 0;
  enabled = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  configure(intervalMs: number, enabled: boolean) {
    this.intervalMs = Math.max(0, intervalMs);
    this.enabled = enabled;
    this.restart();
  }

  setInterval(intervalMs: number) {
    const ms = Math.max(0, intervalMs);
    this.intervalMs = ms;
    if (ms > 0) this.enabled = true;
    this.restart();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.restart();
  }

  isActive(): boolean {
    return this.enabled && this.intervalMs > 0;
  }

  private restart() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.isActive()) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Don't keep the event loop alive during shutdown.
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
    // Fire once immediately so the buffer starts filling without waiting a tick.
    void this.tick();
  }

  private async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const sample = await performPing();
      samplesStore.record(sample);
    } finally {
      this.inFlight = false;
    }
  }
}

const globalForTicker = globalThis as unknown as { __ticker?: Ticker };

export const ticker: Ticker =
  globalForTicker.__ticker ?? (globalForTicker.__ticker = new Ticker());

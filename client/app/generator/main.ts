import http from 'node:http';
import { performPingTo } from '../lib/ping';
import { resolveTarget } from '../lib/resolveTarget';
import type { GeneratorConfig, TargetAuthority } from '../lib/types';
import { Scheduler } from './scheduler';

// ---------------------------------------------------------------------------
// playground-client traffic generator (headless).
//
// Pulls live config from the dashboard, generates traffic to the server per
// that config, and pushes each result back to the dashboard for display. Both
// the pull and the push are best-effort: if the dashboard is down the
// generator keeps hammering the server, so runbook traffic never depends on
// dashboard health.
// ---------------------------------------------------------------------------

const DASHBOARD_URL = (
  process.env.DASHBOARD_URL ||
  'http://playground-dashboard.playground.svc.cluster.local:3000'
).replace(/\/+$/, '');
const CONFIG_POLL_MS = parseInt(process.env.CONFIG_POLL_MS || '2000', 10) || 2000;
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '4000', 10) || 4000;
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '0', 10) || 0;
const AUTHORITIES: TargetAuthority[] = ['apex', 'primary', 'canary', 'custom'];

function envDefaults(): GeneratorConfig {
  const interval = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);
  const concurrency = parseInt(process.env.CONCURRENCY || '1', 10);
  const authority = (process.env.TARGET_AUTHORITY || 'apex') as TargetAuthority;
  return {
    pollIntervalMs: Number.isFinite(interval) ? interval : 1000,
    pollEnabled: (process.env.POLL_ENABLED ?? 'true').toLowerCase() !== 'false',
    concurrency: Number.isFinite(concurrency) ? concurrency : 1,
    target: {
      authority: AUTHORITIES.includes(authority) ? authority : 'apex',
      url: process.env.TARGET_URL || '',
      path: process.env.TARGET_PATH || '/',
    },
    headers: {},
  };
}

// Live config; the ping closure reads `config` by reference so target/header
// changes take effect immediately, while the scheduler is told about
// interval/concurrency/enabled changes via setConfig().
let config: GeneratorConfig = envDefaults();
let okCount = 0;
let failCount = 0;

const scheduler = new Scheduler(
  () => performPingTo(resolveTarget(config.target), config.headers, FETCH_TIMEOUT_MS),
  (sample) => {
    if (sample.ok) okCount++;
    else failCount++;
    void pushSample(sample);
  },
);

function mergeConfig(c: Partial<GeneratorConfig>): GeneratorConfig {
  return {
    pollIntervalMs:
      typeof c.pollIntervalMs === 'number' ? c.pollIntervalMs : config.pollIntervalMs,
    pollEnabled: typeof c.pollEnabled === 'boolean' ? c.pollEnabled : config.pollEnabled,
    concurrency: typeof c.concurrency === 'number' ? c.concurrency : config.concurrency,
    target:
      c.target && typeof c.target === 'object'
        ? {
            authority: AUTHORITIES.includes(c.target.authority as TargetAuthority)
              ? (c.target.authority as TargetAuthority)
              : config.target.authority,
            url: typeof c.target.url === 'string' ? c.target.url : config.target.url,
            path: typeof c.target.path === 'string' ? c.target.path : config.target.path,
          }
        : config.target,
    headers:
      c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)
        ? (c.headers as Record<string, string>)
        : config.headers,
  };
}

async function pullConfig(): Promise<void> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/config`, { cache: 'no-store' });
    if (!res.ok) return;
    const next = mergeConfig((await res.json()) as Partial<GeneratorConfig>);
    const changed = JSON.stringify(next) !== JSON.stringify(config);
    config = next;
    scheduler.setConfig(config);
    if (changed) {
      console.log(
        `[generator] config: interval=${config.pollIntervalMs}ms enabled=${config.pollEnabled} ` +
          `concurrency=${config.concurrency} target=${config.target.authority}${config.target.path} ` +
          `headers=${Object.keys(config.headers).length}`,
      );
    }
  } catch {
    // Dashboard unreachable — keep current config and keep generating.
  }
}

async function pushSample(sample: import('../lib/types').Sample): Promise<void> {
  try {
    await fetch(`${DASHBOARD_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample),
    });
  } catch {
    // Best-effort; never let a dashboard outage stop generation.
  }
}

function startHealthServer() {
  http
    .createServer((req, res) => {
      if (req.url === '/healthz' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(HEALTH_PORT, () => console.log(`[generator] health server on :${HEALTH_PORT}`));
}

function main() {
  console.log(
    `[generator] starting; dashboard=${DASHBOARD_URL} server=${process.env.SERVER_URL || '(default apex)'}`,
  );
  startHealthServer();
  scheduler.setConfig(config); // start immediately with env defaults
  void pullConfig(); // then adopt dashboard config if reachable
  setInterval(() => void pullConfig(), CONFIG_POLL_MS);
  // Periodic heartbeat so `kubectl logs` shows the generator is alive.
  setInterval(
    () => console.log(`[generator] ok=${okCount} fail=${failCount}`),
    10000,
  ).unref?.();
}

main();

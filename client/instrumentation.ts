export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { ticker } = await import('./app/lib/ticker');

  const initialMs = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10) || 1000;
  const initialEnabled =
    (process.env.POLL_ENABLED ?? 'true').toLowerCase() !== 'false';

  ticker.configure(initialMs, initialEnabled);
}

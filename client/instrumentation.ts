export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // The dashboard no longer generates traffic itself — the standalone
  // playground-client generator does. We only initialise the config store
  // (seeded from env) so GET /api/config serves correct defaults at boot,
  // even before the generator first polls it.
  await import('./app/lib/configStore');
}

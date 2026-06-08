/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    // Ship the tutorial markdown in the standalone image so the runtime
    // /api/tutorials/[slug] route (used by the dashboard panel) can read it.
    outputFileTracingIncludes: {
      '/api/tutorials/[slug]': ['./app/tutorials/content/**/*.md'],
    },
  },
};

export default nextConfig;

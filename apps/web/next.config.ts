import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import pkg from './package.json' with { type: 'json' };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// One .env at the monorepo root serves the app, the db scripts and docker compose.
// forceReload: Next has already loaded (and cached) env from apps/web by this point.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for the production Docker image
  // (`node .next/standalone/apps/web/server.js`); dev is unaffected.
  output: 'standalone',
  // Lets a production build run alongside `next dev` without clobbering its .next folder.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@jobbank/db', '@jobbank/shared'],
  outputFileTracingRoot: repoRoot,
  env: { APP_VERSION: pkg.version },
  // Linting runs as its own turbo task (pnpm lint) and in CI; don't repeat it in builds.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

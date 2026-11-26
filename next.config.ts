import path from 'path';
import { fileURLToPath } from 'url';
import type { NextConfig } from 'next';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Phase 0: additive Next.js alongside Vite + Express.
 * Do not delete or rewrite the Vite app until an explicit cutover.
 */
const nextConfig: NextConfig = {
  // Keep Next typechecking isolated from Vite's tsconfig.json
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
  // Parent folder may have another lockfile; pin tracing to this repo.
  outputFileTracingRoot: repoRoot,
  // Existing Vite SPA + Capacitor assets live under public/; Next also serves public/
  // Avoid conflicting with Express-only paths during dual-run local testing.
};

export default nextConfig;

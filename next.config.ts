import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json') as { version?: string };
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function envStr(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

/**
 * Phase 0–7: Next hosts App Router APIs + Vite SPA UI (catch-all).
 * Vite `npm run build` remains for Capacitor until explicitly retired.
 */
const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['ai-token-monitor'],
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(envStr('VITE_GEMINI_API_KEY')),
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(envStr('VITE_API_BASE_URL')),
        'import.meta.env.VITE_MAX_FILE_SIZE_MB': JSON.stringify(envStr('VITE_MAX_FILE_SIZE_MB', '10')),
        'import.meta.env.NEXT_PUBLIC_UPLOADS_BASE_URL': JSON.stringify(
          envStr('NEXT_PUBLIC_UPLOADS_BASE_URL'),
        ),
        'import.meta.env.VITE_UPLOADS_BASE_URL': JSON.stringify(envStr('VITE_UPLOADS_BASE_URL')),
        'import.meta.env.VITE_USE_NEW_CHAT_ENGINE': JSON.stringify(envStr('VITE_USE_NEW_CHAT_ENGINE')),
        'import.meta.env.VITE_AI_TOKEN_MONITOR_SDK_KEY': JSON.stringify(
          envStr('VITE_AI_TOKEN_MONITOR_SDK_KEY'),
        ),
        'import.meta.env.VITE_AI_TOKEN_MONITOR_APP_NAME': JSON.stringify(
          envStr('VITE_AI_TOKEN_MONITOR_APP_NAME'),
        ),
        'import.meta.env.VITE_AI_TOKEN_MONITOR_BASE_URL': JSON.stringify(
          envStr('VITE_AI_TOKEN_MONITOR_BASE_URL'),
        ),
        'import.meta.env.VITE_AI_TOKEN_MONITOR_DEBUG': JSON.stringify(
          envStr('VITE_AI_TOKEN_MONITOR_DEBUG'),
        ),
        'import.meta.env.VITE_AI_MONITOR_BASE_URL': JSON.stringify(envStr('VITE_AI_MONITOR_BASE_URL')),
        'import.meta.env.VITE_AI_MONITOR_SDK_KEY': JSON.stringify(envStr('VITE_AI_MONITOR_SDK_KEY')),
        'import.meta.env.VITE_AI_MONITOR_TOKEN': JSON.stringify(envStr('VITE_AI_MONITOR_TOKEN')),
        'import.meta.env.DEV': process.env.NODE_ENV !== 'production',
        'import.meta.env.PROD': process.env.NODE_ENV === 'production',
        'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV || 'development'),
        __APP_VERSION__: JSON.stringify(packageJson.version || '1.0.3'),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        __BUILD_TIMESTAMP__: Date.now(),
      }),
    );

    // Support Vite-style `import x from 'file?url'` (pdf.js worker)
    config.module.rules.push({
      resourceQuery: /url/,
      type: 'asset/resource',
    });

    return config;
  },
};

export default nextConfig;

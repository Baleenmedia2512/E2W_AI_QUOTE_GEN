import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Node.js 25 ships a built-in WebStorage (localStorage/sessionStorage) that
    // emits a warning and returns a non-functional object when --localstorage-file
    // is not provided. This causes localStorage.clear to be undefined in tests.
    // Fix: tell Node.js 25 to use a temp file so its native WebStorage is
    // initialised properly, after which jsdom's implementation takes over cleanly.
    pool: 'vmThreads',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.{ts,js,cjs}',
        '**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'dist/',
        'android/',
        'public/',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});

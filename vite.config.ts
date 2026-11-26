import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Phase 5 cutover: Vite SPA → Next API by default.
 * Rollback: VITE_DEV_API_PROXY=http://localhost:8787 (or change default below).
 * Local disk /uploads stays on Express until MilesWeb-only; see Phase 4/5 docs.
 */
const API_PROXY_TARGET = process.env.VITE_DEV_API_PROXY || 'http://localhost:3000';
const UPLOADS_PROXY_TARGET = process.env.VITE_DEV_UPLOADS_PROXY || 'http://localhost:8787';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Share Cost Manager NEXT_PUBLIC_* upload base with the Vite client
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
      '/uploads': {
        target: UPLOADS_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    commonjsOptions: {
      include: [/pdfjs-dist/, /node_modules/],
    },
    // Enable cache busting with content hashing
    rollupOptions: {
      output: {
        // Hash filenames based on content for cache busting
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
    // Generate source maps for production debugging
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
  },
  // Define global constants (available in app)
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_TIMESTAMP__: Date.now(),
  },
});

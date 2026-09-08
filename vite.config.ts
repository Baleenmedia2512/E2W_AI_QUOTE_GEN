import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      // Dev-only: same-origin proxy so AI Token Monitor POSTs are not blocked by CORS.
      '/api/token-monitor': {
        target: 'https://e2-w-ai-token-monitor.vercel.app/api',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/token-monitor/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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

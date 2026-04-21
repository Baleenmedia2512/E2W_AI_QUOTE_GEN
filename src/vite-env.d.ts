/// <reference types="vite/client" />

// Global build constants defined in vite.config.ts
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_TIMESTAMP__: number;

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  // Add more env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

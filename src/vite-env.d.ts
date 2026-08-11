/// <reference types="vite/client" />

// Global build constants defined in vite.config.ts
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_TIMESTAMP__: number;

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_AI_TOKEN_MONITOR_SDK_KEY?: string;
  readonly VITE_AI_TOKEN_MONITOR_APP_NAME?: string;
  readonly VITE_AI_TOKEN_MONITOR_BASE_URL?: string;
  // Add more env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

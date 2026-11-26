'use client';

/**
 * Next.js host entry for the existing Vite SPA (Phase 7).
 * Mounts App + Chakra bootstrap side-effects without changing routes/funnel logic.
 */
import React, { useEffect, useRef } from 'react';
import App from './App';
import { initAiTokenMonitor } from './services/aiTokenMonitor';
import AIClient from 'ai-token-monitor';
import './styles/global.css';
import './styles/mobileChat.css';

function readPublicEnv(key: string, fallback = ''): string {
  try {
    // Populated via next.config webpack DefinePlugin (import.meta.env.*)
    const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    const v = env?.[key];
    return typeof v === 'string' && v ? v : fallback;
  } catch {
    return fallback;
  }
}

export default function QuoteBuddyApp() {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    try {
      AIClient.initialize({
        baseURL: readPublicEnv('VITE_AI_MONITOR_BASE_URL', 'http://localhost:5000/api'),
        sdkKey: readPublicEnv(
          'VITE_AI_MONITOR_SDK_KEY',
          'sdk_b41a73d8e9c402a5f17d23a10e7b998f48c32d1e0a96f3b2',
        ),
        token: readPublicEnv('VITE_AI_MONITOR_TOKEN', ''),
        appName: 'QuoteBuddy',
        appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.3',
        environment: isLocalhost ? 'localhost' : 'production',
      });
    } catch (err) {
      console.warn('AIClient.initialize skipped:', err);
    }

    try {
      initAiTokenMonitor();
    } catch (err) {
      console.warn('initAiTokenMonitor skipped:', err);
    }
  }, []);

  return <App />;
}

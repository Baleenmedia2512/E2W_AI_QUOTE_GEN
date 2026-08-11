/**
 * Cloud AI Token Monitor (ai-token-monitor SDK).
 * Call reportAiTelemetry immediately after each Gemini/OpenAI response.
 */

import AIClient from 'ai-token-monitor';
import { useAuthStore } from '../store/authStore';

export type AiTelemetryStatus = 'SUCCESS' | 'FAILED';

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

let initialized = false;

function getSdkKey(): string {
  return String(import.meta.env.VITE_AI_TOKEN_MONITOR_SDK_KEY || '').trim();
}

/**
 * Initialize once at app startup. No-ops when SDK key is missing.
 */
export function initAiTokenMonitor(): void {
  if (initialized) return;

  const sdkKey = getSdkKey();
  if (!sdkKey) {
    console.warn(
      'AI Token Monitor: VITE_AI_TOKEN_MONITOR_SDK_KEY not set — telemetry disabled',
    );
    return;
  }

  const appName =
    String(import.meta.env.VITE_AI_TOKEN_MONITOR_APP_NAME || '').trim() ||
    'QuoteBuddy';
  const baseURL = String(
    import.meta.env.VITE_AI_TOKEN_MONITOR_BASE_URL || '',
  ).trim();

  try {
    AIClient.initialize({
      sdkKey,
      appName,
      ...(baseURL ? { baseURL } : {}),
      environment: import.meta.env.PROD ? 'production' : 'localhost',
      appVersion:
        typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
    });
    initialized = true;
  } catch (error) {
    console.error('AI Token Monitor: initialize failed', error);
  }
}

/**
 * Fire-and-forget telemetry. Never throws into the AI call path.
 */
export function reportAiTelemetry(params: {
  provider?: string;
  model: string;
  module: string;
  latency: number;
  status: AiTelemetryStatus;
  usage?: GeminiUsageMetadata | null;
  errorMessage?: string;
}): void {
  if (!getSdkKey()) return;

  const user = useAuthStore.getState().user;
  const usage = params.usage || {};

  void AIClient.sendTelemetry({
    provider: params.provider || 'Gemini',
    model: params.model,
    usage: {
      promptTokenCount: Number(usage.promptTokenCount ?? 0),
      candidatesTokenCount: Number(usage.candidatesTokenCount ?? 0),
      totalTokenCount: Number(usage.totalTokenCount ?? 0),
    },
    latency: Math.max(0, Math.round(params.latency)),
    status: params.status,
    errorMessage: params.errorMessage ?? null,
    module: params.module,
    endUserId: user?.id ?? null,
    endUserName: user?.full_name ?? null,
    endUserEmail: user?.email ?? null,
  });
}

export function usageFromGeminiResponse(
  data: unknown,
): GeminiUsageMetadata | null {
  if (!data || typeof data !== 'object') return null;
  const meta = (data as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
  if (!meta || typeof meta !== 'object') return null;
  return {
    promptTokenCount: Number(meta.promptTokenCount ?? 0),
    candidatesTokenCount: Number(meta.candidatesTokenCount ?? 0),
    totalTokenCount: Number(meta.totalTokenCount ?? 0),
  };
}

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
const DEBUG_PREFIX = '[AI Token Monitor]';

function isDebugEnabled(): boolean {
  return String(import.meta.env.VITE_AI_TOKEN_MONITOR_DEBUG || '')
    .trim()
    .toLowerCase() === 'true';
}

function debugLog(message: string, details?: unknown): void {
  if (!isDebugEnabled()) return;
  // Use console.log (not debug) so Chrome shows it without Verbose enabled
  if (details === undefined) {
    console.log(`${DEBUG_PREFIX} ${message}`);
  } else {
    console.log(`${DEBUG_PREFIX} ${message}`, details);
  }
}

function debugError(message: string, details?: unknown): void {
  if (!isDebugEnabled()) return;
  console.error(`${DEBUG_PREFIX} ${message}`, details);
}

function getSdkKey(): string {
  return String(import.meta.env.VITE_AI_TOKEN_MONITOR_SDK_KEY || '').trim();
}

function getConfiguredBaseUrl(): string {
  return String(import.meta.env.VITE_AI_TOKEN_MONITOR_BASE_URL || '').trim();
}

function getTelemetryEndpoint(): string {
  const base = getConfiguredBaseUrl().replace(/\/$/, '');
  return base ? `${base}/sdk/log` : '(base URL not set)/sdk/log';
}

function getPageOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : '(unknown)';
}

/**
 * Classify SDK / network failures into a clear reason for console debugging.
 */
function classifyTelemetryFailure(error: unknown): {
  exactReason: string;
  message: string;
  httpStatus: number | null;
  pageOrigin: string;
  endpoint: string;
  fixHint: string;
} {
  const pageOrigin = getPageOrigin();
  const endpoint = getTelemetryEndpoint();
  const fixHint =
    `Backend must return Access-Control-Allow-Origin for "${pageOrigin}" on POST ${endpoint}`;

  if (error == null) {
    return {
      exactReason: 'SDK_RETURNED_NULL',
      message:
        'SDK caught the error internally and returned null. Check the "Telemetry Failed" line above, or Network → sdk/log.',
      httpStatus: null,
      pageOrigin,
      endpoint,
      fixHint,
    };
  }

  const err = error as {
    message?: string;
    code?: string;
    name?: string;
    response?: { status?: number; data?: unknown };
  };
  const message = String(err.message || error);
  const httpStatus = err.response?.status ?? null;
  const lower = message.toLowerCase();

  if (
    lower.includes('cors') ||
    lower.includes('access-control') ||
    lower.includes('blocked by cors') ||
    (err.code === 'ERR_NETWORK' && !httpStatus)
  ) {
    return {
      exactReason: 'CORS_BLOCKED',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint,
    };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      exactReason: 'UNAUTHORIZED_SDK_KEY',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint: 'Check VITE_AI_TOKEN_MONITOR_SDK_KEY is valid for this app',
    };
  }

  if (httpStatus === 404) {
    return {
      exactReason: 'ENDPOINT_NOT_FOUND',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint: 'Confirm Token Monitor exposes POST /api/sdk/log',
    };
  }

  if (httpStatus != null && httpStatus >= 500) {
    return {
      exactReason: 'SERVER_ERROR',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint: 'Check Token Monitor server logs / Vercel function errors',
    };
  }

  if (err.code === 'ECONNABORTED' || lower.includes('timeout')) {
    return {
      exactReason: 'TIMEOUT',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint: 'Token Monitor API did not respond in time',
    };
  }

  if (err.code === 'ERR_NETWORK' || lower.includes('network error')) {
    return {
      exactReason: 'NETWORK_OR_CORS',
      message,
      httpStatus,
      pageOrigin,
      endpoint,
      fixHint:
        `${fixHint}. Network tab Status "CORS error" confirms this.`,
    };
  }

  return {
    exactReason: 'UNKNOWN_TELEMETRY_FAILURE',
    message,
    httpStatus,
    pageOrigin,
    endpoint,
    fixHint,
  };
}

/**
 * Initialize once at app startup. No-ops when SDK key is missing.
 */
export function initAiTokenMonitor(): void {
  if (initialized) {
    debugLog('Already initialized');
    return;
  }

  const sdkKey = getSdkKey();
  debugLog('Initialization started', {
    sdkKeyConfigured: Boolean(sdkKey),
    sdkKeyLength: sdkKey.length,
    appName:
      String(import.meta.env.VITE_AI_TOKEN_MONITOR_APP_NAME || '').trim() ||
      'QuoteBuddy',
    baseURL: getConfiguredBaseUrl() || '(SDK default)',
    endpoint: getTelemetryEndpoint(),
    pageOrigin: getPageOrigin(),
    environment: import.meta.env.PROD ? 'production' : 'localhost',
  });

  if (!sdkKey) {
    console.warn(
      'AI Token Monitor: VITE_AI_TOKEN_MONITOR_SDK_KEY not set — telemetry disabled',
    );
    return;
  }

  const appName =
    String(import.meta.env.VITE_AI_TOKEN_MONITOR_APP_NAME || '').trim() ||
    'QuoteBuddy';
  const baseURL = getConfiguredBaseUrl();

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
    debugLog('Initialization succeeded');
  } catch (error) {
    debugError('Initialization failed', classifyTelemetryFailure(error));
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
  const sdkKey = getSdkKey();
  if (!sdkKey) {
    debugLog('Telemetry skipped: SDK key is not configured', {
      exactReason: 'MISSING_SDK_KEY',
      model: params.model,
      module: params.module,
      status: params.status,
      pageOrigin: getPageOrigin(),
    });
    return;
  }

  const user = useAuthStore.getState().user;
  const usage = params.usage || {};
  const payload = {
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
  };

  debugLog('Sending telemetry', {
    initialized,
    pageOrigin: getPageOrigin(),
    endpoint: getTelemetryEndpoint(),
    payload,
  });

  void AIClient.sendTelemetry(payload)
    .then((response) => {
      if (response === null) {
        // SDK swallows Axios/CORS errors and returns null — surface exact reason
        const reason = classifyTelemetryFailure(null);
        debugError('Telemetry failed — exact reason', {
          ...reason,
          note:
            'Look one line above for SDK "Telemetry Failed" / "Network Error". If Network tab shows CORS error on sdk/log, exactReason is CORS_BLOCKED on the backend.',
          networkTabHint:
            'Open Network → sdk/log → Status. "CORS error" = backend must allow this pageOrigin on POST.',
        });
        return;
      }
      debugLog('Telemetry sent successfully', response);
    })
    .catch((error: unknown) => {
      debugError('Telemetry rejected — exact reason', classifyTelemetryFailure(error));
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

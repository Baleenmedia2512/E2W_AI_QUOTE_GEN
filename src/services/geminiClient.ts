import { GoogleGenerativeAI } from '@google/generative-ai';
import AIClient from 'ai-token-monitor';

// Internal fallback only — used to MAKE the API call.
// The model name reported in telemetry/dashboard always comes from the live API response.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

let _genAI: GoogleGenerativeAI | null = null;

export function getApiKey(): string {
  return localStorage.getItem('GEMINI_API_KEY') || import.meta.env.VITE_GEMINI_API_KEY || '';
}

function getGenAI() {
  if (!_genAI) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable or local storage is not set');
    }
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

export function getModel(modelOverride?: string, generationConfig?: any) {
  const genAI = getGenAI();
  return genAI.getGenerativeModel({ model: modelOverride || DEFAULT_MODEL, generationConfig });
}

export interface TraceContext {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  traceId?: string | null;
  module?: string;
}

export async function generateContent(
  parts: any,
  trace?: TraceContext,
  modelOverride?: string,
  generationConfig?: any
) {
  const model = getModel(modelOverride, generationConfig);
  const start = Date.now();
  const moduleName = trace?.module || 'GENERAL';

  try {
    const result = await model.generateContent(parts);
    const latency = Date.now() - start;

    if (result.response.usageMetadata) {
      // Background async telemetry to prevent blocking the UI
      AIClient.sendTelemetry({
        provider: 'Gemini',
        model: (result.response as any).modelVersion || (result.response as any).model || modelOverride || DEFAULT_MODEL,
        usage: {
          promptTokenCount: result.response.usageMetadata.promptTokenCount,
          candidatesTokenCount: result.response.usageMetadata.candidatesTokenCount,
          totalTokenCount: result.response.usageMetadata.totalTokenCount
        },
        latency,
        status: 'SUCCESS',
        module: moduleName,
        endUserId: trace?.userId || null,
        endUserEmail: trace?.userEmail || null,
        endUserName: trace?.userName || null,
        traceId: trace?.traceId || null
      }).catch(err => console.error("Telemetry failed:", err));
    }

    return result;
  } catch (err: any) {
    const latency = Date.now() - start;

    AIClient.sendTelemetry({
      provider: 'Gemini',
      model: modelOverride || DEFAULT_MODEL,
      usage: {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      },
      latency,
      status: 'FAILED',
      errorMessage: err.message,
      module: moduleName,
      endUserId: trace?.userId || null,
      endUserEmail: trace?.userEmail || null,
      endUserName: trace?.userName || null,
      traceId: trace?.traceId || null
    }).catch(e => console.error("Telemetry failed:", e));

    throw err;
  }
}

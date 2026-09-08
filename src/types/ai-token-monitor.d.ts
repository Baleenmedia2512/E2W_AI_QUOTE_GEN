declare module 'ai-token-monitor' {
  export interface AiTokenMonitorInitOptions {
    sdkKey: string;
    appName: string;
    appVersion?: string;
    environment?: string;
    baseURL?: string;
    token?: string;
  }

  export interface AiTokenUsage {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }

  export interface AiTelemetryPayload {
    provider: string;
    model: string;
    usage?: AiTokenUsage;
    latency?: number;
    status?: 'SUCCESS' | 'FAILED' | string;
    prompt?: string | null;
    imageName?: string | null;
    errorMessage?: string | null;
    module?: string | null;
    traceId?: string | null;
    endUserId?: string | null;
    endUserEmail?: string | null;
    endUserName?: string | null;
  }

  export const ANALYSIS_MODULES: Readonly<Record<string, string>>;

  const AIClient: {
    initialize: (options: AiTokenMonitorInitOptions) => unknown;
    sendTelemetry: (payload: AiTelemetryPayload) => Promise<unknown>;
    ANALYSIS_MODULES: Readonly<Record<string, string>>;
  };

  export default AIClient;
}

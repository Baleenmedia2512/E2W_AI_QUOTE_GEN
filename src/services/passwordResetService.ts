import { supabase } from './supabaseClient';

export interface PasswordResetRequestResult {
  success: boolean;
  message: string;
  cooldownSeconds?: number;
  verifyAttemptsRemaining?: number;
  expiresInMinutes?: number;
}

export interface PasswordResetVerifyResult {
  success: boolean;
  message: string;
  resetToken?: string;
  resetTokenExpiresInMinutes?: number;
}

export interface PasswordResetSubmitResult {
  success: boolean;
  message: string;
}

interface PasswordResetResponse {
  success?: boolean;
  message?: string;
  error?: string;
  cooldownSeconds?: number;
  verifyAttemptsRemaining?: number;
  expiresInMinutes?: number;
  resetToken?: string;
  resetTokenExpiresInMinutes?: number;
}

function readMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const message = (body as PasswordResetResponse).message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const error = (body as PasswordResetResponse).error;
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return null;
}

async function extractEdgeFunctionMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  const dataMessage = readMessageFromBody(data);
  if (dataMessage) return dataMessage;

  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : undefined;

  try {
    if (context instanceof Response) {
      const body = await context.json();
      const bodyMessage = readMessageFromBody(body);
      if (bodyMessage) return bodyMessage;
    } else {
      const contextMessage = readMessageFromBody(context);
      if (contextMessage) return contextMessage;
    }
  } catch {
    // Keep the generic fallback if the response body cannot be parsed.
  }

  return fallback;
}

class PasswordResetService {
  async requestOtp(email: string): Promise<PasswordResetRequestResult> {
    return this.invoke({
      action: 'request_otp',
      email,
    }, 'Unable to send OTP.');
  }

  async verifyOtp(email: string, otp: string): Promise<PasswordResetVerifyResult> {
    return this.invoke({
      action: 'verify_otp',
      email,
      otp,
    }, 'OTP verification failed.');
  }

  async resetPassword(
    email: string,
    resetToken: string,
    password: string,
    confirmPassword: string,
  ): Promise<PasswordResetSubmitResult> {
    return this.invoke({
      action: 'reset_password',
      email,
      resetToken,
      password,
      confirmPassword,
    }, 'Unable to reset password.');
  }

  private async invoke(body: Record<string, unknown>, fallbackMessage: string): Promise<any> {
    try {
      const { data, error } = await supabase.functions.invoke('password-reset', {
        body,
        headers: { 'Content-Type': 'application/json' },
      });

      const response = data as PasswordResetResponse | undefined;

      if (error) {
        return {
          success: false,
          message: await extractEdgeFunctionMessage(error, response, fallbackMessage),
        };
      }

      if (!response || response.success !== true) {
        return {
          success: false,
          message: readMessageFromBody(response) || fallbackMessage,
        };
      }

      return {
        success: true,
        message: response.message || 'Success',
        cooldownSeconds: response.cooldownSeconds,
        verifyAttemptsRemaining: response.verifyAttemptsRemaining,
        expiresInMinutes: response.expiresInMinutes,
        resetToken: response.resetToken,
        resetTokenExpiresInMinutes: response.resetTokenExpiresInMinutes,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: await extractEdgeFunctionMessage(error, undefined, fallbackMessage),
      };
    }
  }
}

export const passwordResetService = new PasswordResetService();

import { apiFetch } from './apiClient';

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

class PasswordResetService {
  async requestOtp(email: string): Promise<PasswordResetRequestResult> {
    return this.invoke({ action: 'request_otp', email }, 'Unable to send OTP.');
  }

  async verifyOtp(email: string, otp: string): Promise<PasswordResetVerifyResult> {
    return this.invoke({ action: 'verify_otp', email, otp }, 'OTP verification failed.');
  }

  async resetPassword(
    email: string,
    resetToken: string,
    password: string,
    confirmPassword: string,
  ): Promise<PasswordResetSubmitResult> {
    return this.invoke(
      { action: 'reset_password', email, resetToken, password, confirmPassword },
      'Unable to reset password.',
    );
  }

  private async invoke(
    body: Record<string, unknown>,
    fallbackMessage: string,
  ): Promise<PasswordResetRequestResult & PasswordResetVerifyResult> {
    const { data, error } = await apiFetch<PasswordResetRequestResult & PasswordResetVerifyResult>(
      '/api/auth/password-reset',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );

    if (error || !data) {
      return { success: false, message: error || fallbackMessage };
    }
    if (data.success !== true) {
      return { ...data, success: false, message: data.message || fallbackMessage };
    }
    return data;
  }
}

export const passwordResetService = new PasswordResetService();

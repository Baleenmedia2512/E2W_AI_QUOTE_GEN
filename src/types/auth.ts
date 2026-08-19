// Authentication types
export interface Role {
  id: string;
  role_name: string;
  permissions?: Record<string, boolean>; // e.g., { create_quotes: true, edit_quotes: true }
  created_at?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string | null;
  role_id: string;
  is_active: boolean;
  last_login?: string;
  created_at?: string;
  updated_at?: string;
  profileImage?: string | null;
  role?: Role; // Populated via JOIN
}

export interface AuthUser {
  id: string;
  email: string;
  canSendQuoteEmail?: boolean;
  full_name: string;
  phone?: string | null;
  profileImage?: string | null;
  role: {
    role_name: string;
    permissions: Record<string, boolean>;
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: AuthUser;
  token?: string;
}

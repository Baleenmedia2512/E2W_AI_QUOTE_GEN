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
  role_id: string;
  is_active: boolean;
  last_login?: string;
  created_at?: string;
  updated_at?: string;
  role?: Role; // Populated via JOIN
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
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

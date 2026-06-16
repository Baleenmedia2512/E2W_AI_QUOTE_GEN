import { vi } from 'vitest';

// Mock Supabase client for all service tests
// Usage: vi.mock('../../src/services/supabaseClient', () => supabaseMock)

const createMockQuery = (returnData: any = null, returnError: any = null) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    then: vi.fn(),
  };
  // make the final awaitable result
  Object.defineProperty(chain, 'then', {
    get: () => undefined,
  });
  return chain;
};

export const mockSupabaseFrom = vi.fn(() => createMockQuery());
export const mockSupabaseStorageFrom = vi.fn(() => ({
  upload: vi.fn().mockResolvedValue({ error: null }),
  getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/file.pdf' } }),
  remove: vi.fn().mockResolvedValue({ error: null }),
}));
export const mockSupabaseAuthGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'test-user-id', email: 'test@example.com' } },
});

export const mockSupabase = {
  from: mockSupabaseFrom,
  storage: {
    from: mockSupabaseStorageFrom,
  },
  auth: {
    getUser: mockSupabaseAuthGetUser,
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
};

export const supabaseMock = {
  supabase: mockSupabase,
};

/**
 * Helper: configure from() to return specific data for a given table
 */
export function mockTable(
  tableName: string,
  data: any,
  error: any = null
): void {
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === tableName) {
      const chain = createMockQuery(data, error);
      return chain;
    }
    return createMockQuery(null, null);
  });
}

/**
 * Reset all mocks between tests
 */
export function resetSupabaseMocks(): void {
  vi.clearAllMocks();
  mockSupabaseFrom.mockImplementation(() => createMockQuery());
}

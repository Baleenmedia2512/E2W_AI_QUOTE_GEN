import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompanySync } from '../../src/hooks/useCompanySync';
import { useAppStore } from '../../src/store';

// Mock the store
vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(),
}));

// Mock services that the store calls
vi.mock('../../src/services/companyService', () => ({
  companyService: {
    getCompanySettings: vi.fn().mockResolvedValue(null),
    saveCompanySettings: vi.fn().mockResolvedValue(true),
    subscribeToChanges: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  },
}));

const mockSyncCompanyFromDatabase = vi.fn().mockResolvedValue(undefined);
const mockEnableCompanySync = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });

describe('useCompanySync', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = {
        syncCompanyFromDatabase: mockSyncCompanyFromDatabase,
        enableCompanySync: mockEnableCompanySync,
      };
      return selector(state);
    });
  });

  it('calls syncCompanyFromDatabase on mount', () => {
    renderHook(() => useCompanySync());
    expect(mockSyncCompanyFromDatabase).toHaveBeenCalledTimes(1);
  });

  it('does NOT call enableCompanySync when enableRealtime is false (default)', () => {
    renderHook(() => useCompanySync(false));
    expect(mockEnableCompanySync).not.toHaveBeenCalled();
  });

  it('calls enableCompanySync when enableRealtime is true', () => {
    renderHook(() => useCompanySync(true));
    expect(mockEnableCompanySync).toHaveBeenCalledTimes(1);
  });

  it('calls unsubscribe on unmount when realtime was enabled', () => {
    const unsubscribeMock = vi.fn();
    mockEnableCompanySync.mockReturnValue({ unsubscribe: unsubscribeMock });

    const { unmount } = renderHook(() => useCompanySync(true));
    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call unsubscribe on unmount when realtime was NOT enabled', () => {
    const unsubscribeMock = vi.fn();
    mockEnableCompanySync.mockReturnValue({ unsubscribe: unsubscribeMock });

    const { unmount } = renderHook(() => useCompanySync(false));
    unmount();

    expect(unsubscribeMock).not.toHaveBeenCalled();
  });
});

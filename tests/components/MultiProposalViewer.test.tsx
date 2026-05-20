import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks must be declared before any component imports ───────────────────────

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <p>{children}</p>,
  IconButton: ({ 'aria-label': label, onClick, isDisabled }: any) => (
    <button aria-label={label} onClick={onClick} disabled={isDisabled}>
      {label}
    </button>
  ),
  Icon: () => <span />,
  Center: ({ children }: any) => <div>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
  useColorModeValue: (light: any) => light,
}));

vi.mock('react-icons/fi', () => ({
  FiChevronLeft: () => <span />,
  FiChevronRight: () => <span />,
  FiX: () => <span />,
  FiFileText: () => <span />,
  FiLayers: () => <span />,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── useAppStore mock ──────────────────────────────────────────────────────────
const mockRemoveActiveProposal = vi.fn();

const makeActiveProposal = (id: string, fileName: string) => ({
  id,
  fileName,
  fileType: 'application/pdf',
  pageCount: 2,
  textContent: `Content of ${fileName}`,
  pageImages: [
    { pageNumber: 1, text: 'Page 1', imageDataUrl: 'data:image/jpeg;base64,abc', croppedImages: [] },
    { pageNumber: 2, text: 'Page 2', imageDataUrl: 'data:image/jpeg;base64,def', croppedImages: [] },
  ],
  uploadedAt: new Date(),
});

vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(() => ({
    activeProposals: [],
    removeActiveProposal: mockRemoveActiveProposal,
  })),
}));

// ── Import component AFTER mocks ──────────────────────────────────────────────
import MultiProposalViewer from '../../src/components/MultiProposalViewer/MultiProposalViewer';
import { useAppStore } from '../../src/store';

// ─────────────────────────────────────────────────────────────────────────────

describe('MultiProposalViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppStore).mockReturnValue({
      activeProposals: [],
      removeActiveProposal: mockRemoveActiveProposal,
    } as any);
  });

  it('renders without crashing when no active proposals', () => {
    expect(() => render(<MultiProposalViewer />)).not.toThrow();
  });

  it('shows "No proposals loaded" message when activeProposals is empty', () => {
    render(<MultiProposalViewer />);
    expect(screen.getByText(/no proposals loaded/i)).toBeDefined();
  });

  it('renders proposal file names for each active proposal', () => {
    vi.mocked(useAppStore).mockReturnValue({
      activeProposals: [
        makeActiveProposal('p1', 'proposal-a.pdf'),
        makeActiveProposal('p2', 'proposal-b.pdf'),
      ],
      removeActiveProposal: mockRemoveActiveProposal,
    } as any);

    render(<MultiProposalViewer />);
    expect(screen.getByText('proposal-a.pdf')).toBeDefined();
    expect(screen.getByText('proposal-b.pdf')).toBeDefined();
  });

  it('shows correct active proposals count text', () => {
    vi.mocked(useAppStore).mockReturnValue({
      activeProposals: [makeActiveProposal('p1', 'test.pdf')],
      removeActiveProposal: mockRemoveActiveProposal,
    } as any);

    render(<MultiProposalViewer />);
    expect(screen.getByText(/1 proposal.*active/i)).toBeDefined();
  });

  it('calls removeActiveProposal when remove button is clicked', () => {
    vi.mocked(useAppStore).mockReturnValue({
      activeProposals: [makeActiveProposal('p-remove', 'to-remove.pdf')],
      removeActiveProposal: mockRemoveActiveProposal,
    } as any);

    render(<MultiProposalViewer />);
    const removeBtn = screen.getByRole('button', { name: /remove proposal/i });
    fireEvent.click(removeBtn);
    expect(mockRemoveActiveProposal).toHaveBeenCalledWith('p-remove');
  });
});

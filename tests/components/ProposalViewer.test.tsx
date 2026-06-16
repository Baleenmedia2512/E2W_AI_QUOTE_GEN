import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Mocks must be declared before any component imports ───────────────────────

vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }: any) => {
    // Simulate document load for tests that rely on it
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: any) => (
    <div data-testid="pdf-page" data-page={pageNumber} />
  ),
  pdfjs: {
    GlobalWorkerOptions: { workerSrc: '' },
    version: '3.11.174',
  },
}));

vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardBody: ({ children }: any) => <div>{children}</div>,
  IconButton: ({ 'aria-label': label, onClick, isDisabled }: any) => (
    <button aria-label={label} onClick={onClick} disabled={isDisabled}>
      {label}
    </button>
  ),
  HStack: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <p>{children}</p>,
  VStack: ({ children }: any) => <div>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Center: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children }: any) => <h2>{children}</h2>,
  Icon: () => <span />,
  Image: ({ src, alt }: any) => <img src={src} alt={alt} />,
  useColorModeValue: (light: any) => light,
  useBreakpointValue: (values: any) => values.base,
}));

vi.mock('react-icons/fi', () => ({
  FiChevronLeft: () => <span />,
  FiChevronRight: () => <span />,
  FiZoomIn: () => <span>ZoomIn</span>,
  FiZoomOut: () => <span>ZoomOut</span>,
  FiFile: () => <span />,
}));

vi.mock('../../src/utils/fileUtils', () => ({
  detectFileType: vi.fn().mockReturnValue('pdf'),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── useAppStore mock ──────────────────────────────────────────────────────────
const mockSetProposal = vi.fn();
const mockProposal = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 1,
  extractedImages: [],
  pageImages: [],
  uploadedAt: null,
};

vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(() => ({
    proposal: mockProposal,
    setProposal: mockSetProposal,
  })),
}));

// ── Import component AFTER mocks ──────────────────────────────────────────────
import ProposalViewer from '../../src/components/ProposalViewer/ProposalViewer';
import { useAppStore } from '../../src/store';

// ─────────────────────────────────────────────────────────────────────────────

describe('ProposalViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no file loaded
    vi.mocked(useAppStore).mockReturnValue({
      proposal: mockProposal,
      setProposal: mockSetProposal,
    } as any);
  });

  it('renders without crashing when no file is loaded', () => {
    expect(() => render(<ProposalViewer />)).not.toThrow();
  });

  it('shows "No proposal uploaded" state when no fileUrl', () => {
    render(<ProposalViewer />);
    expect(screen.getByText(/No proposal uploaded/i)).toBeDefined();
  });

  it('renders zoom in and zoom out buttons when a PDF is loaded', () => {
    const mockFile = new File(['%PDF content'], 'test.pdf', { type: 'application/pdf' });
    vi.mocked(useAppStore).mockReturnValue({
      proposal: {
        ...mockProposal,
        file: mockFile,
        fileName: 'test.pdf',
        fileUrl: 'blob:http://localhost/test',
        pageCount: 3,
        currentPage: 1,
      },
      setProposal: mockSetProposal,
    } as any);

    render(<ProposalViewer />);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeDefined();
  });

  it('renders previous and next page navigation buttons when PDF is loaded', () => {
    const mockFile = new File(['%PDF content'], 'test.pdf', { type: 'application/pdf' });
    vi.mocked(useAppStore).mockReturnValue({
      proposal: {
        ...mockProposal,
        file: mockFile,
        fileName: 'test.pdf',
        fileUrl: 'blob:http://localhost/test',
        pageCount: 3,
        currentPage: 1,
      },
      setProposal: mockSetProposal,
    } as any);

    render(<ProposalViewer />);
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDefined();
  });
});

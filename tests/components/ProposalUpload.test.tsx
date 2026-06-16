import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Mocks must be declared before any component imports ───────────────────────

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Card: ({ children }: any) => <div>{children}</div>,
  CardBody: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  Center: ({ children, onClick, onDragOver, onDragLeave, onDrop }: any) => (
    <div onClick={onClick} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {children}
    </div>
  ),
  Heading: ({ children }: any) => <h2>{children}</h2>,
  Text: ({ children }: any) => <p>{children}</p>,
  VStack: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Icon: () => <span />,
  useToast: () => vi.fn(),
  Spinner: () => <div data-testid="spinner" />,
  useColorModeValue: (light: any) => light,
  Divider: () => <hr />,
  Badge: ({ children }: any) => <span>{children}</span>,
  IconButton: ({ 'aria-label': label, onClick }: any) => (
    <button aria-label={label} onClick={onClick}>
      {label}
    </button>
  ),
  Collapse: ({ children, in: show }: any) => (show ? <div>{children}</div> : null),
  Modal: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  ModalOverlay: () => <div />,
  ModalContent: ({ children }: any) => <div>{children}</div>,
  ModalHeader: ({ children }: any) => <div>{children}</div>,
  ModalBody: ({ children }: any) => <div>{children}</div>,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
  useDisclosure: () => ({ isOpen: false, onOpen: vi.fn(), onClose: vi.fn() }),
}));

vi.mock('react-icons/fi', () => ({
  FiUploadCloud: () => <span />,
  FiFile: () => <span />,
  FiClock: () => <span />,
  FiTrash2: () => <span />,
  FiChevronDown: () => <span />,
  FiChevronUp: () => <span />,
  FiFileText: () => <span />,
  FiImage: () => <span />,
  FiAlertTriangle: () => <span />,
}));

vi.mock('../../src/store', () => {
  const mockStore = {
    proposal: {
      file: null,
      fileName: '',
      fileUrl: '',
      textContent: '',
      pageCount: 0,
      currentPage: 0,
      extractedImages: [],
      pageImages: [],
      uploadedAt: null,
    },
    setProposal: vi.fn(),
    recentProposals: [],
    loadRecentProposals: vi.fn().mockResolvedValue(undefined),
    deleteProposalFromLibrary: vi.fn(),
    activeProposals: [],
    addActiveProposal: vi.fn(),
    removeActiveProposal: vi.fn(),
  };
  const useAppStore = Object.assign(vi.fn(() => mockStore), {
    getState: vi.fn(() => ({
      checkCloudStorage: vi.fn().mockResolvedValue(undefined),
      cloudStorageEnabled: false,
    })),
  });
  return { useAppStore };
});

vi.mock('../../src/services/supabaseProposalService', () => ({
  findCloudDuplicate: vi.fn().mockResolvedValue(null),
  cloudProposalToStored: vi.fn(),
}));

vi.mock('../../src/utils/pdfUtils', () => ({
  validatePDFFile: vi.fn().mockReturnValue({ valid: true }),
  extractPDFContent: vi.fn().mockResolvedValue({
    textContent: '',
    pageCount: 1,
    images: [],
    pageImages: [],
  }),
}));

vi.mock('../../src/utils/proposalStorage', () => ({
  findDuplicateProposal: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/utils/fileUtils', () => ({
  detectFileType: vi.fn().mockReturnValue('pdf'),
  validateImageFile: vi.fn().mockReturnValue({ valid: true }),
  validateExcelFile: vi.fn().mockReturnValue({ valid: true }),
  extractImageContent: vi.fn().mockResolvedValue({
    textContent: '',
    pageCount: 1,
    images: [],
    pageImages: [],
  }),
  extractExcelContent: vi.fn().mockResolvedValue({
    textContent: '',
    pageCount: 1,
    images: [],
    pageImages: [],
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import component AFTER mocks ──────────────────────────────────────────────
import ProposalUpload from '../../src/components/ProposalUpload/ProposalUpload';

// ─────────────────────────────────────────────────────────────────────────────

describe('ProposalUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<ProposalUpload />)).not.toThrow();
  });

  it('renders the "Upload Proposal" heading', () => {
    render(<ProposalUpload />);
    expect(screen.getByText('Upload Proposal')).toBeDefined();
  });

  it('renders "Click to upload files" when no file is loaded', () => {
    render(<ProposalUpload />);
    expect(screen.getByText('Click to upload files')).toBeDefined();
  });

  it('renders file type guidance text', () => {
    render(<ProposalUpload />);
    expect(screen.getByText(/PDF, JPEG, or Excel/i)).toBeDefined();
  });

  it('renders a hidden file input element accepting PDF and image files', () => {
    render(<ProposalUpload />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.accept).toContain('.pdf');
  });
});

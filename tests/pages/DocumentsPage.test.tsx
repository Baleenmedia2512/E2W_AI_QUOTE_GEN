import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks must be declared before any component imports ───────────────────────

const mockHistoryPush = vi.fn();

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children }: any) => <h2>{children}</h2>,
  HStack: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  Text: ({ children }: any) => <p>{children}</p>,
  Icon: () => <span />,
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('react-icons/fi', () => ({
  FiFolder: () => <span />,
  FiHome: () => <span />,
  FiFileText: () => <span />,
  FiEye: () => <span />,
}));

// Mock child components to isolate DocumentsPage
vi.mock('../../src/components/ProposalUpload/ProposalUpload', () => ({
  default: () => <div data-testid="proposal-upload">ProposalUpload</div>,
}));

vi.mock('../../src/components/MultiProposalViewer/MultiProposalViewer', () => ({
  default: () => <div data-testid="multi-proposal-viewer">MultiProposalViewer</div>,
}));

vi.mock('../../src/components/UserProfile', () => ({
  UserProfile: () => <div data-testid="user-profile">UserProfile</div>,
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import DocumentsPage from '../../src/pages/DocumentsPage';

// ─────────────────────────────────────────────────────────────────────────────

describe('DocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<DocumentsPage />)).not.toThrow();
  });

  it('renders the "Documents" page heading', () => {
    render(<DocumentsPage />);
    expect(screen.getAllByText('Documents').length).toBeGreaterThan(0);
  });

  it('renders the "Upload & View Proposals" section heading', () => {
    render(<DocumentsPage />);
    expect(screen.getByText(/Upload & View Proposals/i)).toBeDefined();
  });

  it('renders the ProposalUpload component', () => {
    render(<DocumentsPage />);
    expect(screen.getByTestId('proposal-upload')).toBeDefined();
  });

  it('renders the MultiProposalViewer component', () => {
    render(<DocumentsPage />);
    expect(screen.getByTestId('multi-proposal-viewer')).toBeDefined();
  });

  it('navigates to "/" when Home nav item is clicked', () => {
    render(<DocumentsPage />);
    // Find the "Home" navigation item text
    const homeEl = screen.getByText('Home');
    fireEvent.click(homeEl);
    expect(mockHistoryPush).toHaveBeenCalledWith('/');
  });

  it('navigates to "/quote" when Quote nav item is clicked', () => {
    render(<DocumentsPage />);
    const quoteEl = screen.getByText('Quote');
    fireEvent.click(quoteEl);
    expect(mockHistoryPush).toHaveBeenCalledWith('/quote');
  });
});

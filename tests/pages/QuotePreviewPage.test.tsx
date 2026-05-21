import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── Route mock ────────────────────────────────────────────────────────────────
const mockHistoryPush = vi.fn();
vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

// ── Store mock ────────────────────────────────────────────────────────────────
import { simpleQuote } from '../fixtures/quotes';

const mockCompany = {
  name: 'Acme Advertising',
  address: '123 Main St',
  gst: '27ABCDE1234F1Z5',
  phone: '+91 98765 43210',
  email: 'hello@acme.com',
};

const mockClient = {
  name: 'Rajesh Kumar',
  company: 'BigBrand',
  address: '456 Park Ave',
  gst: '07FGHIJ5678K2L6',
  phone: '+91 99999 11111',
  email: 'rajesh@bigbrand.com',
};

const mockStoreState = {
  currentQuote: simpleQuote,
  companyInfo: mockCompany,
  clientInfo: mockClient,
  selectedTemplate: 'corporate-minimal' as const,
  setSelectedTemplate: vi.fn(),
  setCurrentQuote: vi.fn(),
  proposal: { pageImages: [] },
  activeProposals: [],
  restoreActiveProposals: vi.fn().mockResolvedValue(undefined),
  loadRecentProposals: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(() => mockStoreState),
}));

// ── Service mocks ─────────────────────────────────────────────────────────────
const mockExportToPDF = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/pdfExportService', () => ({
  exportToPDF: (...args: unknown[]) => mockExportToPDF(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Template component mocks ──────────────────────────────────────────────────
vi.mock('../../src/components/Templates/ClassicBusiness', () => ({
  ClassicBusiness: () => <div data-testid="template-classic-business">ClassicBusiness</div>,
}));
vi.mock('../../src/components/Templates/CorporateMinimal', () => ({
  CorporateMinimal: () => <div data-testid="template-corporate-minimal">CorporateMinimal</div>,
}));
vi.mock('../../src/components/Templates/ModernSales', () => ({
  ModernSales: () => <div data-testid="template-modern-sales">ModernSales</div>,
}));
vi.mock('../../src/components/Templates/PremiumAgency', () => ({
  PremiumAgency: () => <div data-testid="template-premium-agency">PremiumAgency</div>,
}));
vi.mock('../../src/components/TemplateSelector/TemplateSelector', () => ({
  TemplateSelector: ({ onSelectTemplate }: { onSelectTemplate: (t: string) => void }) => (
    <div data-testid="template-selector">
      <button onClick={() => onSelectTemplate('modern-sales')}>Select Modern Sales</button>
    </div>
  ),
}));

// ── CSS mocks ─────────────────────────────────────────────────────────────────
vi.mock('../../src/pages/QuotePreviewPage.css', () => ({}));

// ── Import the component under test (after all mocks are set up) ──────────────
import { QuotePreviewPage } from '../../src/pages/QuotePreviewPage';

describe('QuotePreviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default (has quote, company, client)
    Object.assign(mockStoreState, {
      currentQuote: simpleQuote,
      companyInfo: mockCompany,
      clientInfo: mockClient,
      selectedTemplate: 'corporate-minimal',
      activeProposals: [],
    });
  });

  it('renders without crashing when all required data is present', () => {
    expect(() => render(<QuotePreviewPage />)).not.toThrow();
  });

  it('renders the selected template component', () => {
    render(<QuotePreviewPage />);
    // selectedTemplate = 'corporate-minimal' → CorporateMinimal
    expect(screen.getByTestId('template-corporate-minimal')).toBeDefined();
  });

  it('shows error UI when required store data is missing', () => {
    mockStoreState.currentQuote = null as unknown as typeof simpleQuote;
    render(<QuotePreviewPage />);
    expect(screen.getByText(/Missing Information/i)).toBeDefined();
  });

  it('navigates back to /quote when Go Back button is clicked on error screen', () => {
    mockStoreState.currentQuote = null as unknown as typeof simpleQuote;
    render(<QuotePreviewPage />);
    const backBtn = screen.getByRole('button', { name: /go back/i });
    fireEvent.click(backBtn);
    expect(mockHistoryPush).toHaveBeenCalledWith('/quote');
  });
});

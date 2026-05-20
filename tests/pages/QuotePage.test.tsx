import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Route mock ────────────────────────────────────────────────────────────────
const mockHistoryPush = vi.fn();
vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

// ── Chakra UI mock ────────────────────────────────────────────────────────────
vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Container: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
  IconButton: ({ 'aria-label': label, onClick, isDisabled }: any) => (
    <button aria-label={label} onClick={onClick} aria-disabled={isDisabled || undefined}>
      {label}
    </button>
  ),
  Button: ({ children, onClick, isDisabled }: any) => (
    <button onClick={onClick} aria-disabled={isDisabled || undefined}>{children}</button>
  ),
  useBreakpointValue: vi.fn().mockReturnValue(false),
}));

vi.mock('react-icons/fi', () => ({
  FiArrowLeft: () => null,
  FiArrowRight: () => null,
}));

// ── Store mock ────────────────────────────────────────────────────────────────
import { simpleQuote, quoteWithGST } from '../fixtures/quotes';

const mockUpdateQuote = vi.fn();
const mockSetCurrentQuote = vi.fn();
const mockSetCompanyInfo = vi.fn();
const mockSetClientInfo = vi.fn();
const mockSetSelectedTemplate = vi.fn();

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

// Mutable state used across tests
const mockStoreState: Record<string, unknown> = {
  currentQuote: null,
  companyInfo: null,
  clientInfo: null,
  selectedTemplate: 'corporate-minimal',
  updateQuote: mockUpdateQuote,
  setCurrentQuote: mockSetCurrentQuote,
  setCompanyInfo: mockSetCompanyInfo,
  setClientInfo: mockSetClientInfo,
  setSelectedTemplate: mockSetSelectedTemplate,
};

vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(() => mockStoreState),
}));

// ── Child component mocks ─────────────────────────────────────────────────────
vi.mock('../../src/components/ClientInfoForm/ClientInfoFormWithAutocomplete', () => ({
  default: ({ onSubmit }: { onSubmit: (info: unknown) => void }) => (
    <div data-testid="client-info-form">
      <button onClick={() => onSubmit(mockClient)}>Submit Client</button>
    </div>
  ),
}));

vi.mock('../../src/components/CompanyInfoForm/CompanyInfoForm', () => ({
  default: ({ onSubmit }: { onSubmit: (info: unknown) => void }) => (
    <div data-testid="company-info-form">
      <button onClick={() => onSubmit(mockCompany)}>Submit Company</button>
    </div>
  ),
}));

vi.mock('../../src/components/QuotePreview/QuotePreview', () => ({
  default: ({ onUpdate }: { quote: unknown; onUpdate: (q: unknown) => void }) => (
    <div data-testid="quote-preview">
      <button onClick={() => onUpdate(quoteWithGST)}>Trigger Update</button>
    </div>
  ),
}));

vi.mock('../../src/components/QuoteWizard/QuoteNavBar', () => ({
  default: () => <nav data-testid="quote-nav-bar" />,
}));

vi.mock('../../src/components/QuoteWizard/QuoteStepper', () => ({
  default: ({ currentStep }: { currentStep: number }) => (
    <div data-testid="quote-stepper" data-step={currentStep} />
  ),
}));

vi.mock('../../src/components/TemplateSelector/TemplateSelector', () => ({
  TemplateSelector: ({ onSelectTemplate }: { onSelectTemplate: (t: string) => void }) => (
    <div data-testid="template-selector">
      <button onClick={() => onSelectTemplate('modern-sales')}>Pick Modern Sales</button>
    </div>
  ),
}));

vi.mock('../../src/utils/localStorage', () => ({
  saveCompanyInfo: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Component under test ──────────────────────────────────────────────────────
import QuotePage from '../../src/pages/QuotePage';

describe('QuotePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (no data) state
    mockStoreState.currentQuote = null;
    mockStoreState.companyInfo = null;
    mockStoreState.clientInfo = null;
    mockStoreState.selectedTemplate = 'corporate-minimal';
  });

  it('renders without crashing', () => {
    expect(() => render(<QuotePage />)).not.toThrow();
  });

  it('shows CompanyInfoForm on the company step (default when no companyInfo)', () => {
    mockStoreState.companyInfo = null;
    render(<QuotePage />);
    expect(screen.getByTestId('company-info-form')).toBeDefined();
  });

  it('renders QuoteNavBar', () => {
    render(<QuotePage />);
    expect(screen.getByTestId('quote-nav-bar')).toBeDefined();
  });

  it('renders QuoteStepper', () => {
    render(<QuotePage />);
    expect(screen.getByTestId('quote-stepper')).toBeDefined();
  });

  it('shows ClientInfoForm when companyInfo exists (client step)', () => {
    // Simulate useEffect having set currentStep to 'client'
    // by providing companyInfo but no clientInfo
    mockStoreState.companyInfo = mockCompany;
    mockStoreState.clientInfo = null;
    render(<QuotePage />);
    // The useEffect runs on mount setting step to 'client'
    expect(screen.getByTestId('client-info-form')).toBeDefined();
  });

  it('shows QuotePreview when companyInfo + clientInfo + currentQuote exist', () => {
    mockStoreState.companyInfo = mockCompany;
    mockStoreState.clientInfo = mockClient;
    mockStoreState.currentQuote = simpleQuote;
    render(<QuotePage />);
    expect(screen.getByTestId('quote-preview')).toBeDefined();
  });

  it('calls updateQuote when QuotePreview onUpdate fires', () => {
    mockStoreState.companyInfo = mockCompany;
    mockStoreState.clientInfo = mockClient;
    mockStoreState.currentQuote = simpleQuote;
    render(<QuotePage />);
    const triggerBtn = screen.getByRole('button', { name: /trigger update/i });
    fireEvent.click(triggerBtn);
    expect(mockUpdateQuote).toHaveBeenCalledWith(quoteWithGST);
  });

  it('Back button is disabled on the company step', () => {
    mockStoreState.companyInfo = null;
    render(<QuotePage />);
    const backBtn = screen.getByRole('button', { name: /back/i });
    expect(backBtn.getAttribute('aria-disabled')).toBe('true');
  });
});

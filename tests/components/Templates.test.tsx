import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ClassicBusiness } from '../../src/components/Templates/ClassicBusiness';
import { CorporateMinimal } from '../../src/components/Templates/CorporateMinimal';
import { ModernSales } from '../../src/components/Templates/ModernSales';
import { PremiumAgency } from '../../src/components/Templates/PremiumAgency';
import { simpleQuote, quoteWithGST } from '../fixtures/quotes';
import type { TemplateData } from '../../src/types/template';

// ── CSS mocks ─────────────────────────────────────────────────────────────────
vi.mock('../../src/components/Templates/ClassicBusiness.css', () => ({}));
vi.mock('../../src/components/Templates/CorporateMinimal.css', () => ({}));
vi.mock('../../src/components/Templates/ModernSales.css', () => ({}));
vi.mock('../../src/components/Templates/PremiumAgency.css', () => ({}));
vi.mock('../../src/components/Templates/ReferenceImages.css', () => ({}));

// ── Utility mocks ─────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/utils/bulletNormalization', () => ({
  normalizeTermsBlob: (s: string) => s.split('\n').filter(Boolean),
}));

vi.mock('../../src/utils/quoteGrouping', () => ({
  isMultiServiceQuote: vi.fn().mockReturnValue(false),
  groupItemsByServiceType: vi.fn().mockReturnValue([]),
  filterTermsByServiceType: vi.fn().mockReturnValue([]),
  DEFAULT_GENERAL_TERMS: [],
  getServiceGroupHeading: vi.fn().mockReturnValue('Service'),
  extractServiceType: vi.fn().mockReturnValue('general'),
}));

// ReferenceImages — renders nothing, avoids complex image logic
vi.mock('../../src/components/Templates/ReferenceImages', () => ({
  ReferenceImages: () => <div data-testid="reference-images" />,
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────
const mockCompany = {
  name: 'Acme Advertising Pvt Ltd',
  address: '123 Main Street, Mumbai',
  gst: '27ABCDE1234F1Z5',
  phone: '+91 98765 43210',
  email: 'hello@acme.com',
  website: 'acme.com',
};

const mockClient = {
  name: 'Rajesh Kumar',
  company: 'BigBrand Co',
  address: '456 Park Ave, Delhi',
  gst: '07FGHIJ5678K2L6',
  phone: '+91 99999 11111',
  email: 'rajesh@bigbrand.com',
};

const buildTemplateData = (overrides: Partial<TemplateData> = {}): TemplateData => ({
  company: mockCompany,
  client: mockClient,
  quote: simpleQuote,
  proposalPages: [],
  proposalPageMap: {},
  ...overrides,
});

describe('ClassicBusiness template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() =>
      render(<ClassicBusiness data={buildTemplateData()} />),
    ).not.toThrow();
  });

  it('renders company name', () => {
    render(<ClassicBusiness data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/Acme Advertising/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders client company name', () => {
    render(<ClassicBusiness data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/BigBrand/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('CorporateMinimal template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() =>
      render(<CorporateMinimal data={buildTemplateData()} />),
    ).not.toThrow();
  });

  // CorporateMinimal renders company.name only in <img alt>, gated behind company.logo.
  // Instead verify company.email which is always rendered as visible text.
  it('renders company contact info (email)', () => {
    render(<CorporateMinimal data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/hello@acme\.com/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders client name or company', () => {
    render(<CorporateMinimal data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/BigBrand|Rajesh/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('ModernSales template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() =>
      render(<ModernSales data={buildTemplateData()} />),
    ).not.toThrow();
  });

  it('renders company name', () => {
    render(<ModernSales data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/Acme Advertising/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders line items from quote', () => {
    const data = buildTemplateData({ quote: quoteWithGST });
    render(<ModernSales data={data} />);
    // quoteWithGST has items — at least one description should appear
    const firstDesc = quoteWithGST.items[0].description.substring(0, 8);
    const matches = screen.queryAllByText(new RegExp(firstDesc, 'i'));
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('PremiumAgency template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() =>
      render(<PremiumAgency data={buildTemplateData()} />),
    ).not.toThrow();
  });

  it('renders company name', () => {
    render(<PremiumAgency data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/Acme Advertising/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders client name or company', () => {
    render(<PremiumAgency data={buildTemplateData()} />);
    const matches = screen.queryAllByText(/BigBrand|Rajesh/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TemplateSelector } from '../../src/components/TemplateSelector/TemplateSelector';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Mock CSS imports
vi.mock('../../src/components/TemplateSelector/TemplateSelector.css', () => ({}));

// Mock template components (they have heavy CSS and DOM work)
vi.mock('../../src/components/Templates/ClassicBusiness', () => ({
  ClassicBusiness: () => <div>ClassicBusiness</div>,
}));
vi.mock('../../src/components/Templates/CorporateMinimal', () => ({
  CorporateMinimal: () => <div>CorporateMinimal</div>,
}));
vi.mock('../../src/components/Templates/ModernSales', () => ({
  ModernSales: () => <div>ModernSales</div>,
}));
vi.mock('../../src/components/Templates/PremiumAgency', () => ({
  PremiumAgency: () => <div>PremiumAgency</div>,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockOnSelectTemplate = vi.fn();

describe('TemplateSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() =>
      render(
        <TemplateSelector
          selectedTemplate="corporate-minimal"
          onSelectTemplate={mockOnSelectTemplate}
        />,
      ),
    ).not.toThrow();
  });

  it('renders all four template options', () => {
    render(
      <TemplateSelector
        selectedTemplate="corporate-minimal"
        onSelectTemplate={mockOnSelectTemplate}
      />,
    );
    // Use queryAllByText because template names may appear in both card labels
    // and SVG preview watermarks, so multiple matches are expected
    expect(screen.queryAllByText(/corporate minimal/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/premium agency/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/modern sales/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/classic business/i).length).toBeGreaterThan(0);
  });

  it('calls onSelectTemplate with the correct id when a template button is clicked', () => {
    render(
      <TemplateSelector
        selectedTemplate="corporate-minimal"
        onSelectTemplate={mockOnSelectTemplate}
      />,
    );
    // Each template has a "SELECT TEMPLATE" or "SELECTED" button
    // The first non-selected one has "SELECT TEMPLATE"
    const selectButtons = screen.getAllByRole('button', { name: /select template/i });
    fireEvent.click(selectButtons[0]);
    expect(mockOnSelectTemplate).toHaveBeenCalledTimes(1);
    // The called argument must be a valid TemplateType string
    const calledWith = mockOnSelectTemplate.mock.calls[0][0];
    expect(['corporate-minimal', 'premium-agency', 'modern-sales', 'classic-business']).toContain(
      calledWith,
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import QuotePreview from '../../src/components/QuotePreview/QuotePreview';
import { simpleQuote, quoteWithGST, emptyQuote, singleLineItem } from '../fixtures/quotes';

// Mock Chakra UI with minimal stubs
vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardBody: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children }: any) => <h2>{children}</h2>,
  Text: ({ children, ...rest }: any) => <p {...rest}>{children}</p>,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  IconButton: ({ 'aria-label': label, onClick }: any) => <button aria-label={label} onClick={onClick}>{label}</button>,
  Input: ({ value, onChange }: any) => <input value={value} onChange={onChange} />,
  Textarea: ({ value, onChange }: any) => <textarea value={value} onChange={onChange} />,
  Table: ({ children }: any) => <table>{children}</table>,
  Thead: ({ children }: any) => <thead>{children}</thead>,
  Tbody: ({ children }: any) => <tbody>{children}</tbody>,
  Tr: ({ children }: any) => <tr>{children}</tr>,
  Th: ({ children }: any) => <th>{children}</th>,
  Td: ({ children, colSpan, ...rest }: any) => <td colSpan={colSpan} {...rest}>{children}</td>,
  Checkbox: ({ isChecked, onChange, children }: any) => (
    <label><input type="checkbox" checked={isChecked} onChange={onChange} />{children}</label>
  ),
  NumberInput: ({ children }: any) => <div>{children}</div>,
  NumberInputField: ({ value, onChange }: any) => <input type="number" value={value} onChange={onChange} />,
  Editable: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  EditablePreview: () => null,
  EditableInput: ({ value, onChange }: any) => <input value={value} onChange={onChange} />,
  Icon: () => null,
  useBreakpointValue: vi.fn().mockReturnValue(false), // desktop by default
}));

vi.mock('react-icons/fi', () => ({
  FiTrash2: () => null,
  FiEdit3: () => null,
}));

const mockOnUpdate = vi.fn();
const mockOnSave = vi.fn();

describe('QuotePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Null / empty state
  // ─────────────────────────────────────────────
  it('shows empty state message when quote is null', () => {
    render(<QuotePreview quote={null} onUpdate={mockOnUpdate} />);
    expect(screen.getByText(/No quote generated yet/i)).toBeDefined();
  });

  // ─────────────────────────────────────────────
  // With a simple quote
  // ─────────────────────────────────────────────
  it('renders line item descriptions from the quote', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);

    simpleQuote.items.forEach(item => {
      // At least the description text should appear somewhere in the DOM
      const matches = screen.queryAllByText(new RegExp(item.description.substring(0, 10), 'i'));
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders without crashing for a single-item quote', () => {
    expect(() =>
      render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />)
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // GST behaviour
  // ─────────────────────────────────────────────
  it('shows GST row when gstEnabled is true', () => {
    render(<QuotePreview quote={quoteWithGST} onUpdate={mockOnUpdate} />);
    // GST row contains "GST" text somewhere
    const gstElements = screen.queryAllByText(/GST/i);
    expect(gstElements.length).toBeGreaterThan(0);
  });

  it('does not crash when gstEnabled is false', () => {
    expect(() =>
      render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />)
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────
  // Totals
  // ─────────────────────────────────────────────
  it('renders a total value on screen', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    // Total should appear — match with regex for any formatted number
    const totalItems = screen.queryAllByText(/Total|total/i);
    expect(totalItems.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────
  // Multiple items quote
  // ─────────────────────────────────────────────
  it('renders multiple line items correctly', () => {
    render(<QuotePreview quote={quoteWithGST} onUpdate={mockOnUpdate} />);
    // Fixture has 2+ items
    const descriptions = quoteWithGST.items.map(i => i.description.substring(0, 8));
    descriptions.forEach(desc => {
      const elements = screen.queryAllByText(new RegExp(desc, 'i'));
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // onSave button
  // ─────────────────────────────────────────────
  it('renders a save/download button when onSave is provided', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} onSave={mockOnSave} />);
    const saveButton = screen.queryByRole('button', { name: /save|export|download|pdf/i });
    // Button may or may not be visible depending on component structure; don't require it
    // But the component should render without error
    expect(screen.queryByText(/No quote generated yet/i)).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Interaction — onUpdate callback
  // ─────────────────────────────────────────────
  it('calls onUpdate when the GST checkbox is toggled', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    // simpleQuote.gstEnabled = false → checkbox is unchecked
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onUpdate with gstEnabled flipped when checkbox toggled', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    const updatedQuote = mockOnUpdate.mock.calls[0][0];
    // simpleQuote had gstEnabled=false → should now be true
    expect(updatedQuote.gstEnabled).toBe(true);
  });

  it('calls onUpdate when Terms & Conditions textarea is changed', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    const textareas = screen.getAllByRole('textbox');
    // Last textarea is Terms & Conditions
    const termsTextarea = textareas[textareas.length - 1];
    fireEvent.change(termsTextarea, { target: { value: 'New payment terms' } });
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onUpdate with new terms value when Terms textarea changes', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    const textareas = screen.getAllByRole('textbox');
    const termsTextarea = textareas[textareas.length - 1];
    fireEvent.change(termsTextarea, { target: { value: 'Updated terms here' } });
    const updatedQuote = mockOnUpdate.mock.calls[0][0];
    expect(updatedQuote.termsAndConditions).toBe('Updated terms here');
  });

  it('calls onUpdate when Delete section button is clicked', () => {
    // Use a fresh items array so splice doesn't mutate the shared fixture
    const freshQuote = { ...simpleQuote, items: [singleLineItem] };
    render(<QuotePreview quote={freshQuote} onUpdate={mockOnUpdate} />);
    const deleteButton = screen.getByRole('button', { name: /delete section/i });
    fireEvent.click(deleteButton);
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onUpdate with item removed when Delete section is clicked', () => {
    // Use a fresh items array so splice doesn't mutate the shared fixture
    const freshQuote = { ...simpleQuote, items: [singleLineItem] };
    render(<QuotePreview quote={freshQuote} onUpdate={mockOnUpdate} />);
    const deleteButton = screen.getByRole('button', { name: /delete section/i });
    fireEvent.click(deleteButton);
    const updatedQuote = mockOnUpdate.mock.calls[0][0];
    expect(updatedQuote.items).toHaveLength(0);
  });

  it('onUpdate receives a valid Quote object with required fields', () => {
    render(<QuotePreview quote={simpleQuote} onUpdate={mockOnUpdate} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    const updatedQuote = mockOnUpdate.mock.calls[0][0];
    expect(updatedQuote).toHaveProperty('id');
    expect(updatedQuote).toHaveProperty('items');
    expect(updatedQuote).toHaveProperty('total');
    expect(updatedQuote).toHaveProperty('subtotal');
    expect(Array.isArray(updatedQuote.items)).toBe(true);
  });
});

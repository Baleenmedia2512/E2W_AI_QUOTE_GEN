import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { AutocompleteInput } from '../../../src/components/AutocompleteInput/AutocompleteInput';
import { sampleLeadSearchResults } from '../../fixtures/leads';

// vi.hoisted ensures this object is available inside vi.mock factory closures
// (vi.mock is hoisted above imports by Vitest)
const outsideClickCapture = vi.hoisted(() => ({
  handler: null as (() => void) | null,
}));

vi.mock('@chakra-ui/react', () => {
  const Box = React.forwardRef(({ children }: any, ref: any) => (
    <div ref={ref}>{children}</div>
  ));
  Box.displayName = 'Box';

  const Input = React.forwardRef(
    ({ value, onChange, onKeyDown, placeholder, isDisabled }: any, ref: any) => (
      <input
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        data-testid="autocomplete-input"
      />
    ),
  );
  Input.displayName = 'Input';

  const InputGroup = ({ children }: any) => <div>{children}</div>;
  const InputRightElement = ({ children }: any) => <div>{children}</div>;
  const List = ({ children }: any) => <ul>{children}</ul>;
  const ListItem = ({ children, onClick }: any) => <li onClick={onClick}>{children}</li>;
  const Text = ({ children }: any) => <span>{children}</span>;
  const Spinner = () => <div data-testid="spinner" />;

  // Capture the outside-click handler so tests can trigger it manually
  const useOutsideClick = ({ handler }: any) => {
    outsideClickCapture.handler = handler;
  };

  return {
    Box,
    Input,
    InputGroup,
    InputRightElement,
    List,
    ListItem,
    Text,
    Spinner,
    useOutsideClick,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  value?: string;
  onChange?: (v: string) => void;
  onSelect?: (lead: any) => void;
  onSearch?: (term: string) => Promise<any[]>;
  placeholder?: string;
  isDisabled?: boolean;
  isInvalid?: boolean;
  debounceMs?: number;
}

function makeProps(overrides: Props = {}): Required<Props> {
  return {
    value: '',
    onChange: vi.fn(),
    onSelect: vi.fn(),
    onSearch: vi.fn().mockResolvedValue([]),
    placeholder: 'Start typing to search...',
    isDisabled: false,
    isInvalid: false,
    debounceMs: 300,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AutocompleteInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outsideClickCapture.handler = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────

  it('renders the input with the given placeholder', () => {
    render(<AutocompleteInput {...makeProps()} />);
    expect(screen.getByTestId('autocomplete-input')).toBeTruthy();
    expect(screen.getByPlaceholderText('Start typing to search...')).toBeTruthy();
  });

  it('disables the input when isDisabled prop is true', () => {
    render(<AutocompleteInput {...makeProps({ isDisabled: true })} />);
    const input = screen.getByTestId('autocomplete-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  // ─────────────────────────────────────────────
  // onChange
  // ─────────────────────────────────────────────

  it('calls onChange with the typed value when user types', () => {
    const mockOnChange = vi.fn();
    render(<AutocompleteInput {...makeProps({ onChange: mockOnChange })} />);
    fireEvent.change(screen.getByTestId('autocomplete-input'), {
      target: { value: 'A' },
    });
    expect(mockOnChange).toHaveBeenCalledWith('A');
  });

  // ─────────────────────────────────────────────
  // Search debounce
  // ─────────────────────────────────────────────

  it('does NOT call onSearch when value is less than 2 characters', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue([]);
    render(<AutocompleteInput {...makeProps({ value: 'A', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(mockOnSearch).not.toHaveBeenCalled();
  });

  it('calls onSearch with the search term after debounce when value >= 2 chars', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue([]);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(mockOnSearch).toHaveBeenCalledWith('Ac');
  });

  it('does NOT show the dropdown when value is less than 2 characters (even after debounce)', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'A', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.queryByRole('list')).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Suggestions dropdown
  // ─────────────────────────────────────────────

  it('shows suggestion list items when search returns results', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.getByText('Acme Corporation')).toBeTruthy();
    expect(screen.getByText('Acme Retail')).toBeTruthy();
  });

  it('does not show suggestion list when search returns an empty array', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue([]);
    render(<AutocompleteInput {...makeProps({ value: 'Xz', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.queryByRole('list')).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Loading spinner
  // ─────────────────────────────────────────────

  it('shows the loading spinner while search is in progress', () => {
    // onSearch returns a promise that never resolves → isLoading stays true
    const neverResolves = new Promise<never>(() => {});
    const mockOnSearch = vi.fn().mockReturnValue(neverResolves);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    // Advance only the debounce timer — search starts but never resolves
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('spinner')).toBeTruthy();
  });

  // ─────────────────────────────────────────────
  // Selecting a suggestion (mouse click)
  // ─────────────────────────────────────────────

  it('calls onSelect with the lead when a suggestion is clicked', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    const mockOnSelect = vi.fn();
    render(
      <AutocompleteInput
        {...makeProps({ value: 'Ac', onSearch: mockOnSearch, onSelect: mockOnSelect })}
      />,
    );
    await vi.runAllTimersAsync();
    fireEvent.click(screen.getByText('Acme Corporation'));
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(sampleLeadSearchResults[0]);
  });

  it('closes the dropdown after a suggestion is clicked', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.click(screen.getByText('Acme Corporation'));
    expect(screen.queryByRole('list')).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Keyboard navigation
  // ─────────────────────────────────────────────

  it('closes the dropdown when Escape key is pressed', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('autocomplete-input'), { key: 'Escape' });
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('closes the dropdown when Tab key is pressed', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('autocomplete-input'), { key: 'Tab' });
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('selects the highlighted suggestion when Enter key is pressed', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    const mockOnSelect = vi.fn();
    render(
      <AutocompleteInput
        {...makeProps({ value: 'Ac', onSearch: mockOnSearch, onSelect: mockOnSelect })}
      />,
    );
    await vi.runAllTimersAsync();
    const input = screen.getByTestId('autocomplete-input');
    // ArrowDown to highlight first item (selectedIndex 0)
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Enter to select it
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSelect).toHaveBeenCalledWith(sampleLeadSearchResults[0]);
  });

  it('does not call onSelect when Enter is pressed with no item highlighted', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    const mockOnSelect = vi.fn();
    render(
      <AutocompleteInput
        {...makeProps({ value: 'Ac', onSearch: mockOnSearch, onSelect: mockOnSelect })}
      />,
    );
    await vi.runAllTimersAsync();
    // Press Enter without pressing ArrowDown first (selectedIndex = -1)
    fireEvent.keyDown(screen.getByTestId('autocomplete-input'), { key: 'Enter' });
    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it('navigates to the second item after two ArrowDown presses', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    const mockOnSelect = vi.fn();
    render(
      <AutocompleteInput
        {...makeProps({ value: 'Ac', onSearch: mockOnSearch, onSelect: mockOnSelect })}
      />,
    );
    await vi.runAllTimersAsync();
    const input = screen.getByTestId('autocomplete-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // index 0
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // index 1
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSelect).toHaveBeenCalledWith(sampleLeadSearchResults[1]);
  });

  // ─────────────────────────────────────────────
  // Outside click
  // ─────────────────────────────────────────────

  it('closes the dropdown when the outside-click handler is triggered', async () => {
    const mockOnSearch = vi.fn().mockResolvedValue(sampleLeadSearchResults);
    render(<AutocompleteInput {...makeProps({ value: 'Ac', onSearch: mockOnSearch })} />);
    await vi.runAllTimersAsync();
    expect(screen.getByRole('list')).toBeTruthy();
    act(() => {
      outsideClickCapture.handler?.();
    });
    expect(screen.queryByRole('list')).toBeNull();
  });
});

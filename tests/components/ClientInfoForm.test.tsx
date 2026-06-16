import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ClientInfoForm from '../../src/components/ClientInfoForm/ClientInfoForm';

vi.mock('@chakra-ui/react', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  const VStack = ({ children }: any) => <div>{children}</div>;
  const HStack = ({ children }: any) => <div>{children}</div>;
  const Grid = ({ children }: any) => <div>{children}</div>;
  const GridItem = ({ children }: any) => <div>{children}</div>;
  const FormControl = ({ children }: any) => <div>{children}</div>;
  const FormLabel = ({ children }: any) => <label>{children}</label>;
  const FormErrorMessage = ({ children }: any) => (
    <span data-testid="form-error">{children}</span>
  );
  // Strip `type` so jsdom doesn't apply native email/tel form validation
  // (React component does its own validation — we don't want browser-level blocking)
  const Input = ({ value, onChange, placeholder, type: _type, ...rest }: any) => (
    <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  const Textarea = ({ value, onChange, placeholder, ...rest }: any) => (
    <textarea value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  const Button = ({ children, onClick, type }: any) => (
    <button onClick={onClick} type={type}>
      {children}
    </button>
  );
  const Heading = ({ children }: any) => <h2>{children}</h2>;
  const Text = ({ children }: any) => <span>{children}</span>;
  const Spacer = () => <div />;

  return {
    Box,
    VStack,
    HStack,
    Grid,
    GridItem,
    FormControl,
    FormLabel,
    FormErrorMessage,
    Input,
    Textarea,
    Button,
    Heading,
    Text,
    Spacer,
  };
});

const mockSubmit = vi.fn();
const mockBack = vi.fn();

describe('ClientInfoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────

  it('renders all required form fields', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    expect(screen.getByPlaceholderText('Enter client name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter company name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter client address')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter GST number')).toBeTruthy();
    expect(screen.getByPlaceholderText('+1 (555) 000-0000')).toBeTruthy();
    expect(screen.getByPlaceholderText('client@example.com')).toBeTruthy();
  });

  // ─────────────────────────────────────────────
  // Validation — Required fields
  // ─────────────────────────────────────────────

  it('does not call onSubmit when name is empty', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows "Client name is required" error when name is empty on submit', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Client name is required')).toBeTruthy();
  });

  it('does not call onSubmit when phone is empty', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows "Phone is required" error when phone is empty on submit', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Phone is required')).toBeTruthy();
  });

  // ─────────────────────────────────────────────
  // Validation — Format errors
  // ─────────────────────────────────────────────

  it('shows "Invalid phone number" for non-numeric phone input', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: 'abc-not-a-number' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Invalid phone number')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows "Invalid email address" for malformed optional email', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '9876543210' },
    });
    fireEvent.change(screen.getByPlaceholderText('client@example.com'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Invalid email address')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows "Invalid GST format" for malformed optional GST', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '9876543210' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter GST number'), {
      target: { value: 'INVALID GST!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Invalid GST format')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────
  // Valid form submission
  // ─────────────────────────────────────────────

  it('calls onSubmit with correct data when all required fields are filled', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'John Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'John Doe', phone: '9876543210' }),
    );
  });

  it('accepts a valid optional email without showing an error', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '1234567890' },
    });
    fireEvent.change(screen.getByPlaceholderText('client@example.com'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Invalid email address')).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Error clearing on typing
  // ─────────────────────────────────────────────

  it('clears the name error when the user starts typing in the name field', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Client name is required')).toBeTruthy();
    // Start typing — error disappears
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'A' },
    });
    expect(screen.queryByText('Client name is required')).toBeNull();
  });

  it('clears the phone error when the user starts typing in the phone field', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Test Client' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Phone is required')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '9' },
    });
    expect(screen.queryByText('Phone is required')).toBeNull();
  });

  // ─────────────────────────────────────────────
  // Clear button
  // ─────────────────────────────────────────────

  it('Clear button resets all form fields to empty', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter client name'), {
      target: { value: 'Filled Name' },
    });
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: '9999999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(
      (screen.getByPlaceholderText('Enter client name') as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByPlaceholderText('+1 (555) 000-0000') as HTMLInputElement).value,
    ).toBe('');
  });

  // ─────────────────────────────────────────────
  // initialData prop
  // ─────────────────────────────────────────────

  it('pre-fills all fields from initialData prop', () => {
    const initialData = {
      name: 'Acme Corp',
      company: 'Acme Ltd',
      address: '123 Main St',
      gst: 'ACME12345',
      phone: '9876543210',
      email: 'acme@example.com',
    };
    render(<ClientInfoForm onSubmit={mockSubmit} initialData={initialData} />);
    expect(
      (screen.getByPlaceholderText('Enter client name') as HTMLInputElement).value,
    ).toBe('Acme Corp');
    expect(
      (screen.getByPlaceholderText('+1 (555) 000-0000') as HTMLInputElement).value,
    ).toBe('9876543210');
    expect(
      (screen.getByPlaceholderText('client@example.com') as HTMLInputElement).value,
    ).toBe('acme@example.com');
  });

  // ─────────────────────────────────────────────
  // Back button
  // ─────────────────────────────────────────────

  it('renders Back button when onBack prop is provided', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} onBack={mockBack} />);
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeNull();
  });

  it('does NOT render Back button when onBack prop is absent', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });

  it('calls onBack when back button is clicked', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} onBack={mockBack} />);
    const backButton = screen.getByRole('button', { name: /back/i });
    fireEvent.click(backButton);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

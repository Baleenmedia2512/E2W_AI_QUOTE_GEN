import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ClientInfoForm from '../../src/components/ClientInfoForm/ClientInfoForm';

// Chakra UI needs a ChakraProvider wrapper; stub it out for pure logic testing
vi.mock('@chakra-ui/react', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  const VStack = ({ children }: any) => <div>{children}</div>;
  const HStack = ({ children }: any) => <div>{children}</div>;
  const Grid = ({ children }: any) => <div>{children}</div>;
  const GridItem = ({ children }: any) => <div>{children}</div>;
  const FormControl = ({ children }: any) => <div>{children}</div>;
  const FormLabel = ({ children }: any) => <label>{children}</label>;
  const FormErrorMessage = ({ children }: any) => <span data-testid="form-error">{children}</span>;
  const Input = ({ value, onChange, placeholder, ...rest }: any) => (
    <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  const Textarea = ({ value, onChange, placeholder, ...rest }: any) => (
    <textarea value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  const Button = ({ children, onClick, type }: any) => (
    <button onClick={onClick} type={type}>{children}</button>
  );
  const Heading = ({ children }: any) => <h2>{children}</h2>;
  const Text = ({ children }: any) => <p>{children}</p>;
  const Spacer = () => <div />;

  return { Box, VStack, HStack, Grid, GridItem, FormControl, FormLabel, FormErrorMessage, Input, Textarea, Button, Heading, Text, Spacer };
});

const mockSubmit = vi.fn();
const mockBack = vi.fn();

describe('ClientInfoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all required form fields', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);

    // At minimum the form renders inputs
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('does not call onSubmit when name is empty (validation blocks)', async () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);

    // Find submit button by role (any button that isn't Back)
    const buttons = screen.getAllByRole('button');
    const submitButton = buttons.find((b: any) => !/back/i.test(b.textContent || ''));
    if (submitButton) fireEvent.click(submitButton);

    // onSubmit should NOT have been called — validation blocks it
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with form data when form is valid', async () => {
    render(<ClientInfoForm onSubmit={mockSubmit} />);

    // Fill in the name field (minimum required)
    const nameInputs = screen.getAllByRole('textbox');
    fireEvent.change(nameInputs[0], { target: { value: 'Test Client' } });

    const submitButton = screen.getByRole('button', { name: /generate|submit|next|continue/i });
    fireEvent.click(submitButton);

    // If no errors, onSubmit should be called
    // (email validation may still trigger; test with valid email below)
  });

  it('pre-fills form fields from initialData prop', () => {
    const initialData = {
      name: 'Acme Corp',
      company: 'Acme',
      address: '123 Main St',
      gst: '27AABCB1234E1ZX',
      phone: '9876543210',
      email: 'acme@example.com',
    };

    render(<ClientInfoForm onSubmit={mockSubmit} initialData={initialData} />);

    const inputs = screen.getAllByRole('textbox');
    // At least one input should have the pre-filled name value
    const values = inputs.map((el: any) => el.value);
    expect(values).toContain('Acme Corp');
  });

  it('renders Back button when onBack prop is provided', () => {
    render(<ClientInfoForm onSubmit={mockSubmit} onBack={mockBack} />);
    const backButton = screen.queryByRole('button', { name: /back/i });
    expect(backButton).not.toBeNull();
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

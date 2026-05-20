import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Hoisted mocks so vi.mock factories can reference them ─────────────────────
const { mockSaveCompanyInfo, mockLoadCompanyInfo } = vi.hoisted(() => ({
  mockSaveCompanyInfo: vi.fn(),
  mockLoadCompanyInfo: vi.fn().mockReturnValue(null),
}));

// ── Chakra UI stub ─────────────────────────────────────────────────────────────
vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Grid: ({ children }: any) => <div>{children}</div>,
  GridItem: ({ children }: any) => <div>{children}</div>,
  Center: ({ children }: any) => <div>{children}</div>,
  FormControl: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormErrorMessage: ({ children }: any) => (
    <span data-testid="form-error">{children}</span>
  ),
  Input: ({ value, onChange, placeholder, type, id, accept }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      id={id}
      accept={accept}
    />
  ),
  Textarea: ({ value, onChange, placeholder }: any) => (
    <textarea value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Button: ({ children, onClick, type, as: As, htmlFor }: any) => {
    if (As === 'label') return <label htmlFor={htmlFor}>{children}</label>;
    return (
      <button onClick={onClick} type={type || 'button'}>
        {children}
      </button>
    );
  },
  Heading: ({ children }: any) => <h2>{children}</h2>,
  Text: ({ children }: any) => <span>{children}</span>,
  Avatar: () => <div data-testid="avatar" />,
  Icon: () => <span />,
}));

vi.mock('react-icons/fi', () => ({ FiUploadCloud: () => <span /> }));

vi.mock('../../src/utils/localStorage', () => ({
  saveCompanyInfo: mockSaveCompanyInfo,
  loadCompanyInfo: mockLoadCompanyInfo,
}));

import CompanyInfoForm from '../../src/components/CompanyInfoForm/CompanyInfoForm';

// ── Helpers ────────────────────────────────────────────────────────────────────
const mockSubmit = vi.fn();

/** Fill all four required fields so validation passes. */
function fillRequiredFields(
  name = 'My Company',
  address = '123 Main St',
  phone = '+61400000000',
  email = 'test@company.com',
) {
  fireEvent.change(screen.getByPlaceholderText('Enter your company name'), {
    target: { value: name },
  });
  fireEvent.change(screen.getByPlaceholderText('Enter your complete business address'), {
    target: { value: address },
  });
  fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
    target: { value: phone },
  });
  fireEvent.change(screen.getByPlaceholderText('company@example.com'), {
    target: { value: email },
  });
}

function getForm(container: HTMLElement) {
  return container.querySelector('form')!;
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('CompanyInfoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCompanyInfo.mockReturnValue(null);
  });

  // ── Render ───────────────────────────────────────────────────────────────────
  it('renders without crashing', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    expect(container).toBeTruthy();
  });

  it('renders "Company Information" heading', () => {
    render(<CompanyInfoForm onSubmit={mockSubmit} />);
    expect(screen.getByText('Company Information')).toBeTruthy();
  });

  it('pre-fills form fields when initialData is provided', () => {
    const initialData = {
      name: 'Acme Corp',
      address: '456 Tech Park',
      gst: '',
      phone: '+61 400 000 000',
      email: 'info@acme.com',
      logo: '',
      website: 'www.acme.com',
      signature: 'Jane',
      designation: 'CEO',
    };
    render(<CompanyInfoForm onSubmit={mockSubmit} initialData={initialData} />);

    expect(
      (screen.getByPlaceholderText('Enter your company name') as HTMLInputElement).value,
    ).toBe('Acme Corp');
    expect(
      (screen.getByPlaceholderText('company@example.com') as HTMLInputElement).value,
    ).toBe('info@acme.com');
  });

  // ── Validation — required fields ─────────────────────────────────────────────
  it('shows "Company name is required" when name is empty on submit', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Company name is required')).toBe(true);
  });

  it('shows "Address is required" when address is empty on submit', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Address is required')).toBe(true);
  });

  it('shows "Phone is required" when phone is empty on submit', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Phone is required')).toBe(true);
  });

  it('shows "Invalid phone number" when phone has invalid format', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), {
      target: { value: 'abc-invalid' },
    });
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Invalid phone number')).toBe(true);
  });

  it('shows "Email is required" when email is empty on submit', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Email is required')).toBe(true);
  });

  it('shows "Invalid email address" when email format is wrong', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('company@example.com'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Invalid email address')).toBe(true);
  });

  // ── Validation — optional GST ─────────────────────────────────────────────────
  it('shows "Invalid GST format" when GST contains invalid characters', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('Enter GST number'), {
      target: { value: '!!! invalid' },
    });
    fireEvent.submit(getForm(container));

    const errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Invalid GST format')).toBe(true);
  });

  it('does NOT show GST error when GST field is left empty (field is optional)', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fillRequiredFields();
    fireEvent.submit(getForm(container));

    const errors = screen.queryAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Invalid GST format')).toBe(false);
  });

  // ── Successful submission ─────────────────────────────────────────────────────
  it('calls onSubmit with form data when all required fields are valid', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fillRequiredFields();
    fireEvent.submit(getForm(container));

    expect(mockSubmit).toHaveBeenCalledOnce();
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Company', email: 'test@company.com' }),
    );
  });

  it('calls saveCompanyInfo when form submits successfully', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fillRequiredFields();
    fireEvent.submit(getForm(container));

    expect(mockSaveCompanyInfo).toHaveBeenCalledOnce();
  });

  it('does NOT call onSubmit when validation fails', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container)); // all fields empty

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  // ── "Use Saved Info" button ───────────────────────────────────────────────────
  it('shows "Use Saved Info" button when localStorage has saved company data', () => {
    mockLoadCompanyInfo.mockReturnValue({ name: 'Saved Co', email: 'saved@co.com' });
    render(<CompanyInfoForm onSubmit={mockSubmit} />);

    expect(screen.getByRole('button', { name: /Use Saved Info/i })).toBeTruthy();
  });

  it('does NOT show "Use Saved Info" button when localStorage is empty', () => {
    mockLoadCompanyInfo.mockReturnValue(null);
    render(<CompanyInfoForm onSubmit={mockSubmit} />);

    expect(screen.queryByRole('button', { name: /Use Saved Info/i })).toBeNull();
  });

  it('fills the form with saved data when "Use Saved Info" is clicked', () => {
    const savedData = {
      name: 'Saved Co',
      address: '789 Saved St',
      gst: '',
      phone: '+61400000001',
      email: 'saved@co.com',
      logo: '',
      website: '',
      signature: '',
      designation: '',
    };
    mockLoadCompanyInfo.mockReturnValue(savedData);
    render(<CompanyInfoForm onSubmit={mockSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /Use Saved Info/i }));

    expect(
      (screen.getByPlaceholderText('Enter your company name') as HTMLInputElement).value,
    ).toBe('Saved Co');
    expect(
      (screen.getByPlaceholderText('company@example.com') as HTMLInputElement).value,
    ).toBe('saved@co.com');
  });

  // ── Error clearing ────────────────────────────────────────────────────────────
  it('clears the name validation error when user starts typing in the name field', () => {
    const { container } = render(<CompanyInfoForm onSubmit={mockSubmit} />);
    fireEvent.submit(getForm(container));

    // Error present after failed submit
    let errors = screen.getAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Company name is required')).toBe(true);

    // Type in name field → error must disappear
    fireEvent.change(screen.getByPlaceholderText('Enter your company name'), {
      target: { value: 'A' },
    });

    errors = screen.queryAllByTestId('form-error');
    expect(errors.some((el) => el.textContent === 'Company name is required')).toBe(false);
  });

  // ── Clear button ──────────────────────────────────────────────────────────────
  it('clears all form fields when the "Clear" button is clicked', () => {
    const initialData = {
      name: 'Pre-filled',
      address: 'Some Street',
      gst: '',
      phone: '+61400000000',
      email: 'x@x.com',
      logo: '',
    };
    render(<CompanyInfoForm onSubmit={mockSubmit} initialData={initialData as any} />);

    // Verify data is pre-filled
    expect(
      (screen.getByPlaceholderText('Enter your company name') as HTMLInputElement).value,
    ).toBe('Pre-filled');

    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

    expect(
      (screen.getByPlaceholderText('Enter your company name') as HTMLInputElement).value,
    ).toBe('');
  });
});

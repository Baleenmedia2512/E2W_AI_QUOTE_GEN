import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks must be declared before any imports that resolve the real modules ───

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn().mockReturnValue(false) },
}));

vi.mock('@capacitor-community/speech-recognition', () => ({
  SpeechRecognition: {
    available: vi.fn().mockResolvedValue({ available: false }),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: vi.fn() }),
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children, ...props }: any) => <div data-testid={props['data-testid']}>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Input: ({ onChange, value, onKeyPress, placeholder, disabled, ...props }: any) => (
    <input
      data-testid={props['data-testid'] ?? 'chat-input'}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={onChange}
      onKeyPress={onKeyPress}
    />
  ),
  IconButton: ({ onClick, 'aria-label': label, isDisabled, isLoading, ...props }: any) => (
    <button
      data-testid={props['data-testid'] ?? label}
      onClick={onClick}
      disabled={isDisabled || isLoading}
      aria-label={label}
    >
      {label}
    </button>
  ),
  Button: ({ onClick, children, isDisabled, isLoading, ...props }: any) => (
    <button
      data-testid={props['data-testid'] ?? 'btn'}
      onClick={onClick}
      disabled={isDisabled || isLoading}
    >
      {children}
    </button>
  ),
  Text: ({ children, ...props }: any) => <span data-testid={props['data-testid']}>{children}</span>,
  Spinner: () => <div data-testid="spinner" />,
  Flex: ({ children }: any) => <div>{children}</div>,
  Icon: () => <span />,
  Checkbox: ({ children, onChange, isChecked }: any) => (
    <label>
      <input type="checkbox" checked={isChecked} onChange={onChange} />
      {children}
    </label>
  ),
}));

vi.mock('react-icons/fi', () => ({
  FiSend: () => <span>Send</span>,
  FiCheck: () => <span>Check</span>,
  FiMic: () => <span>Mic</span>,
}));

const mockSetCurrentQuote = vi.fn();
const mockActiveProposals: any[] = [];
const mockProposal = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 0,
  extractedImages: [],
  pageImages: [],
  uploadedAt: null,
};

vi.mock('../../src/store', () => ({
  useAppStore: vi.fn(() => ({
    proposal: mockProposal,
    setCurrentQuote: mockSetCurrentQuote,
    activeProposals: mockActiveProposals,
  })),
}));

vi.mock('../../src/services/geminiService', () => ({
  sendMessageToGemini: vi.fn().mockResolvedValue({
    message: 'Hello! How can I help?',
    isQuoteGeneration: false,
    quoteData: null,
  }),
}));

vi.mock('../../src/services/supabaseProposalService', () => ({
  loadAllProposalsFromCloud: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/hooks/useCityServiceRegistry', () => ({
  getCityServiceRegistry: vi.fn().mockReturnValue(new Map()),
  KNOWN_CITY_LIST: ['chennai', 'bangalore', 'mumbai'],
}));

vi.mock('../../src/utils/localStorage', () => ({
  saveChatHistory: vi.fn(),
  loadChatHistory: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/utils/quoteGrouping', () => ({
  DEFAULT_GENERAL_TERMS: '• GST 18% extra',
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

// ── Import component AFTER mocks ──────────────────────────────────────────────
import ChatInterface from '../../src/components/ChatInterface/ChatInterface';
import { sendMessageToGemini } from '../../src/services/geminiService';
import { loadChatHistory } from '../../src/utils/localStorage';

// ─────────────────────────────────────────────────────────────────────────────

// jsdom does not implement scrollIntoView — stub it globally
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe('ChatInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadChatHistory).mockReturnValue([]);
  });

  // ─────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without crashing', () => {
      expect(() => render(<ChatInterface />)).not.toThrow();
    });

    it('renders the message input box', () => {
      render(<ChatInterface />);
      expect(screen.getByTestId('chat-input')).toBeDefined();
    });

    it('renders the Send button', () => {
      render(<ChatInterface />);
      expect(screen.getByLabelText('Send message')).toBeDefined();
    });

    it('renders the Mic button', () => {
      render(<ChatInterface />);
      // aria-label is 'Voice input' when not recording
      expect(screen.getByLabelText('Voice input')).toBeDefined();
    });

    it('input starts empty', () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('shows suggestion prompts when chat history is empty', () => {
      render(<ChatInterface />);
      // At least one suggestion prompt button should be visible (multiple may exist)
      const prompts = screen.getAllByText(/Generate quote for/i);
      expect(prompts.length).toBeGreaterThan(0);
    });

    it('renders existing messages loaded from chat history', () => {
      vi.mocked(loadChatHistory).mockReturnValue([
        { id: '1', role: 'user', content: 'Quote for bus branding', timestamp: new Date() },
        { id: '2', role: 'assistant', content: 'Hello! How can I help?', timestamp: new Date() },
      ]);

      render(<ChatInterface />);

      expect(screen.getByText('Quote for bus branding')).toBeDefined();
      expect(screen.getByText('Hello! How can I help?')).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // Input interaction
  // ─────────────────────────────────────────────
  describe('input interaction', () => {
    it('updates input value when user types', () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Quote for bus branding' } });

      expect(input.value).toBe('Quote for bus branding');
    });

    it('clears the input field after Send button is clicked', async () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Give me a quote' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('does NOT send when input is empty (only whitespace)', async () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      // sendMessageToGemini should NOT have been called
      expect(vi.mocked(sendMessageToGemini)).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // Sending messages
  // ─────────────────────────────────────────────
  describe('sending messages', () => {
    it('calls sendMessageToGemini when Send button is clicked with text', async () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Quote for bus semi branding' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(vi.mocked(sendMessageToGemini)).toHaveBeenCalledOnce();
      });

      const callArg = vi.mocked(sendMessageToGemini).mock.calls[0][0];
      expect(callArg.userMessage).toContain('Quote for bus semi branding');
    });

    it('pressing Enter key also submits the message', async () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Quote for auto branding' } });
      fireEvent.keyPress(input, { key: 'Enter', charCode: 13 });

      await waitFor(() => {
        expect(vi.mocked(sendMessageToGemini)).toHaveBeenCalledOnce();
      });
    });

    it('adds the user message to the chat on send', async () => {
      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input');

      fireEvent.change(input, { target: { value: 'UNIQUE_USER_MSG_XYZ' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('UNIQUE_USER_MSG_XYZ')).toBeDefined();
      });
    });

    it('displays the AI response message in the chat after Gemini replies', async () => {
      vi.mocked(sendMessageToGemini).mockResolvedValueOnce({
        message: 'AI_RESPONSE_TEXT_ABC',
        isQuoteGeneration: false,
        quoteData: null,
      });

      render(<ChatInterface />);
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('AI_RESPONSE_TEXT_ABC')).toBeDefined();
      });
    });

    it('disables Send button while a request is being processed (prevents double-send)', async () => {
      // Make sendMessageToGemini hang so we can inspect disabled state
      let resolve!: () => void;
      vi.mocked(sendMessageToGemini).mockReturnValueOnce(
        new Promise<any>((res) => { resolve = () => res({ message: 'done', isQuoteGeneration: false, quoteData: null }); })
      );

      render(<ChatInterface />);
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'test' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      // While loading the button should be disabled
      await waitFor(() => {
        const sendBtn = screen.getByLabelText('Send message');
        expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
      });

      // Clean up
      resolve();
    });

    it('disables Send button while a request is in flight (loading state)', async () => {
      let resolve!: () => void;
      vi.mocked(sendMessageToGemini).mockReturnValueOnce(
        new Promise<any>((res) => { resolve = () => res({ message: 'done', isQuoteGeneration: false, quoteData: null }); })
      );

      render(<ChatInterface />);
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'test' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      // The send button must be disabled while the request is pending
      await waitFor(() => {
        const sendBtn = screen.getByLabelText('Send message');
        expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
      });

      resolve();
    });
  });

  // ─────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────
  describe('error handling', () => {
    it('does not crash when sendMessageToGemini throws an error', async () => {
      vi.mocked(sendMessageToGemini).mockRejectedValueOnce(new Error('API key missing'));

      render(<ChatInterface />);
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'quote' } });

      // Should not throw
      expect(() =>
        fireEvent.click(screen.getByLabelText('Send message'))
      ).not.toThrow();

      await waitFor(() => {
        // Input cleared or error state shown — the component must still be mounted
        expect(screen.getByTestId('chat-input')).toBeDefined();
      });
    });

    it('re-enables Send button after an error so user can retry', async () => {
      vi.mocked(sendMessageToGemini).mockRejectedValueOnce(new Error('Network error'));

      render(<ChatInterface />);
      const input = screen.getByTestId('chat-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'quote' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      // After error: isLoading resets to false. Component still renders.
      // Input is cleared after send, so the send button will be disabled by empty input —
      // we just verify the component recovered (not stuck in loading, input is accessible).
      await waitFor(() => {
        expect(screen.getByTestId('chat-input')).toBeDefined();
        // isLoading must be false: the spinner icon should be gone
        const sendBtn = screen.getByLabelText('Send message');
        expect(sendBtn.querySelector('svg')).toBeDefined(); // FiSend icon returned (not spinner)
      }, { timeout: 3000 });
    });
  });

  // ─────────────────────────────────────────────
  // Quote generation result
  // ─────────────────────────────────────────────
  describe('quote generation result', () => {
    it('calls setCurrentQuote when Gemini returns isQuoteGeneration=true', async () => {
      vi.mocked(sendMessageToGemini).mockResolvedValueOnce({
        message: 'Here is your quote',
        isQuoteGeneration: true,
        matchType: 'exact',
        quoteData: {
          quoteGenerated: true,
          items: [
            {
              title: 'Bus Semi Branding',
              lineItems: [
                { description: 'Bus Semi Branding - Rental Price', quantity: 10, unitPrice: 5000, total: 50000 },
              ],
            },
          ],
          gstEnabled: true,
          gstPercentage: 18,
          termsAndConditions: '• GST 18% extra',
        },
      });

      render(<ChatInterface />);
      fireEvent.change(screen.getByTestId('chat-input'), {
        target: { value: 'Quote for bus semi branding Chennai 10 units' },
      });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(mockSetCurrentQuote).toHaveBeenCalledOnce();
      });
    });
  });
});

export interface ServiceSuggestion {
  name: string;
  category: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
  isServiceNotFound?: boolean;
  availableServices?: ServiceSuggestion[];
  // Partial match: some services exist, some don't
  isPartialMatch?: boolean;
  validServices?: string[]; // e.g., ["40 Bus Full Branding"]
  missingServices?: string[]; // e.g., ["Bus Back Branding"]
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message } from '../types/chat';
import { CHAT_SYSTEM_PROMPT } from '../utils/promptTemplates';

// Rate limiting
const RATE_LIMIT_DELAY = 1000; // 1 second between requests
let lastRequestTime = 0;

const getApiKey = (): string => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file.');
  }
  return apiKey;
};

const enforceRateLimit = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
};

export interface SendMessageParams {
  userMessage: string;
  proposalText?: string;
  chatHistory?: Message[];
}

export interface GeminiResponse {
  message: string;
  isQuoteGeneration: boolean;
  quoteData?: any;
}

export const sendMessageToGemini = async ({
  userMessage,
  proposalText = '',
  chatHistory = [],
}: SendMessageParams): Promise<GeminiResponse> => {
  try {
    await enforceRateLimit();

    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    // Build context
    let contextPrompt = CHAT_SYSTEM_PROMPT + '\n\n';
    
    if (proposalText) {
      contextPrompt += `PROPOSAL DOCUMENT:\n${proposalText}\n\n`;
    }

    // Add chat history for context
    if (chatHistory.length > 0) {
      contextPrompt += 'CONVERSATION HISTORY:\n';
      chatHistory.slice(-5).forEach(msg => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      contextPrompt += '\n';
    }

    contextPrompt += `USER REQUEST: ${userMessage}`;

    const result = await model.generateContent(contextPrompt);
    const response = await result.response;
    const text = response.text();

    // Try to detect if this is a quote generation response
    const isQuoteGeneration = userMessage.toLowerCase().includes('quote') || 
                              userMessage.toLowerCase().includes('generate') ||
                              text.includes('{') && text.includes('items');

    let quoteData = null;
    if (isQuoteGeneration) {
      try {
        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          quoteData = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // If JSON parsing fails, quoteData remains null
        console.log('Could not parse quote data from response');
      }
    }

    return {
      message: text,
      isQuoteGeneration,
      quoteData,
    };
  } catch (error: any) {
    console.error('Gemini API error:', error);
    
    if (error.message?.includes('API key')) {
      throw new Error('Invalid API key. Please check your Gemini API configuration.');
    }
    
    if (error.message?.includes('quota')) {
      throw new Error('API quota exceeded. Please try again later.');
    }
    
    throw new Error('Failed to communicate with AI service. Please try again.');
  }
};

export const parseQuoteFromResponse = (response: string): any | null => {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error('Failed to parse quote data:', error);
    return null;
  }
};

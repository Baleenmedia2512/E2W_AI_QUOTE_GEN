import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message } from '../types/chat';
import { CHAT_SYSTEM_PROMPT } from '../utils/promptTemplates';

// Rate limiting
const RATE_LIMIT_DELAY = 1000; // 1 second between requests
let lastRequestTime = 0;

const getApiKey = (): string => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file. Get your key from https://aistudio.google.com/app/apikey');
  }
  return apiKey.trim();
};

const enforceRateLimit = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
};

/**
 * 🔴 POST-PROCESSING FIX: Validate and correct quote line item descriptions
 * 
 * Problem: The AI (Gemini) sometimes ignores prompt instructions and generates descriptions
 * without the service type prefix, causing incorrect reference image filtering.
 * 
 * Example of AI mistake:
 *   ❌ "Rental Price (per Bus month)"  <-- Missing "Bus Semi Branding" prefix
 * 
 * Expected correct format:
 *   ✅ "Bus Semi Branding - Rental Price (per bus month)"
 * 
 * This function ensures ALL descriptions start with the full service type name (item title)
 * by checking and prepending the title if missing.
 */
const validateAndFixQuoteDescriptions = (quoteData: any): any => {
  if (!quoteData || !quoteData.items || !Array.isArray(quoteData.items)) {
    return quoteData;
  }

  console.log('🔧 Validating and fixing quote descriptions...');
  
  const fixedItems = quoteData.items.map((item: any) => {
    if (!item.lineItems || !Array.isArray(item.lineItems)) {
      return item;
    }

    const serviceTypeName = item.title?.trim() || '';
    
    const fixedLineItems = item.lineItems.map((lineItem: any) => {
      const description = lineItem.description || '';
      
      // Check if description already starts with the service type name
      if (!description.startsWith(serviceTypeName) && serviceTypeName) {
        // Fix: Prepend the service type name
        const fixedDescription = `${serviceTypeName} - ${description}`;
        console.log(`  ✅ Fixed: "${description}" → "${fixedDescription}"`);
        
        return {
          ...lineItem,
          description: fixedDescription
        };
      }
      
      // Already correct
      return lineItem;
    });

    return {
      ...item,
      lineItems: fixedLineItems
    };
  });

  return {
    ...quoteData,
    items: fixedItems
  };
};


export interface SendMessageParams {
  userMessage: string;
  proposalText?: string; // Single document (backward compatibility)
  proposalTexts?: Array<{fileName: string, content: string}>; // Multi-document support
  chatHistory?: Message[];
}

export interface ServiceSuggestion {
  name: string;
  category: string;
  similarity?: string; // For partial matches: "high", "medium", "low"
}

export interface GroupedServices {
  vehicleType: string;
  requestedQuantity?: number;
  services: ServiceSuggestion[];
}

export interface CategoryServices {
  category: string;
  services: { name: string }[];
}

export interface GeminiResponse {
  message: string;
  isQuoteGeneration: boolean;
  quoteData?: any;
  matchType?: string; // "exact", "multiple", "partial", "none"
  
  // MULTIPLE_MATCH
  isMultipleMatch?: boolean;
  groupedServices?: GroupedServices[];
  
  // PARTIAL_MATCH
  isPartialMatch?: boolean;
  requestedService?: string;
  requestedQuantity?: number;
  closestServices?: ServiceSuggestion[];
  alternativeServices?: ServiceSuggestion[];
  
  // NO_MATCH
  isNoMatch?: boolean;
  allServicesGrouped?: CategoryServices[];
  
  // DEPRECATED (kept for backward compatibility)
  isServiceNotFound?: boolean;
  serviceNotFoundMessage?: string;
  availableServices?: ServiceSuggestion[];
  validServices?: string[];
  missingServices?: string[];
}

export const sendMessageToGemini = async ({
  userMessage,
  proposalText = '',
  proposalTexts,
  chatHistory = [],
}: SendMessageParams): Promise<GeminiResponse> => {
  try {
    await enforceRateLimit();

    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    // Using gemini-2.5-flash-lite model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // Build context
    let contextPrompt = CHAT_SYSTEM_PROMPT + '\n\n';
    
    // Multi-document support (NEW - takes priority if provided)
    if (proposalTexts && proposalTexts.length > 0) {
      contextPrompt += `AVAILABLE PROPOSAL DOCUMENTS (${proposalTexts.length} total):\n\n`;
      proposalTexts.forEach((doc, idx) => {
        // Increased limit to capture full documents including Terms & Conditions sections
        const preview = doc.content.substring(0, 50000); // Limit per document for token efficiency
        contextPrompt += `--- DOCUMENT ${idx + 1}: ${doc.fileName} ---\n${preview}\n--- END OF DOCUMENT ${idx + 1} ---\n\n`;
      });
    }
    // Single document support (backward compatibility)
    else if (proposalText) {
      // Ensure full document is sent for term extraction
      contextPrompt += `PROPOSAL DOCUMENT:\n${proposalText.substring(0, 50000)}\n\n`;
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

    // Detect if AI has generated a complete quote (must contain JSON with quoteGenerated flag)
    let quoteData = null;
    let isQuoteGeneration = false;

    try {
      // Look for JSON block in markdown code fence first (most reliable)
      let jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
      
      // If no code fence, try to extract JSON object by finding balanced braces
      if (!jsonMatch) {
        // Find the start of a JSON object containing our expected keys
        // Search for BOTH quoted and unquoted key names (AI sometimes omits quotes)
        const matchKeys = [
          '"quoteGenerated"', 'quoteGenerated:',
          '"multipleMatch"', 'multipleMatch:',
          '"partialMatch"', 'partialMatch:',
          '"noMatch"', 'noMatch:',
          '"serviceNotFound"', 'serviceNotFound:' // backward compatibility
        ];
        
        let keyIdx = -1;
        for (const key of matchKeys) {
          const idx = text.indexOf(key);
          if (idx !== -1 && (keyIdx === -1 || idx < keyIdx)) {
            keyIdx = idx;
          }
        }
        
        if (keyIdx !== -1) {
          // Search backward from the key to find the opening {
          let braceStart = -1;
          for (let i = keyIdx; i >= 0; i--) {
            if (text[i] === '{') { braceStart = i; break; }
          }
          
          if (braceStart !== -1) {
            // Count balanced braces from the opening { to find the matching }
            let depth = 0;
            let braceEnd = -1;
            for (let i = braceStart; i < text.length; i++) {
              if (text[i] === '{') depth++;
              else if (text[i] === '}') {
                depth--;
                if (depth === 0) { braceEnd = i; break; }
              }
            }
            
            if (braceEnd !== -1) {
              jsonMatch = [text.substring(braceStart, braceEnd + 1)] as any;
            }
          }
        }
      }
      
      if (jsonMatch) {
        let jsonStr = jsonMatch[1] || jsonMatch[0];
        
        // Fix: The AI often returns JSON with literal newlines in string values
        // We need to escape them properly for valid JSON parsing
        // This regex finds all string values and escapes newlines/tabs within them
        jsonStr = jsonStr.replace(/"([^"]*(?:\\.[^"]*)*)"/g, (match) => {
          // Don't modify the outer quotes, only escape newlines inside the string
          return match
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '')
            .replace(/\t/g, '\\t');
        });
        
        const parsed = JSON.parse(jsonStr);
        
        // Handle 4-TIER MATCHING SYSTEM responses
        
        // 1️⃣ EXACT_MATCH - Quote generated
        if (parsed.quoteGenerated && parsed.items && Array.isArray(parsed.items)) {
          // 🔴 POST-PROCESSING FIX: Validate and correct line item descriptions
          // The AI sometimes ignores instructions and generates descriptions without the service type prefix
          // This ensures EVERY description starts with the full service type name
          const fixedQuoteData = validateAndFixQuoteDescriptions(parsed);
          
          quoteData = fixedQuoteData;
          isQuoteGeneration = true;
          return {
            message: text,
            isQuoteGeneration: true,
            quoteData: fixedQuoteData,
            matchType: 'exact'
          };
        }
        
        // 2️⃣ MULTIPLE_MATCH - Ambiguous request, ask user to clarify
        if (parsed.multipleMatch && parsed.groupedServices) {
          return {
            message: text,
            isQuoteGeneration: false,
            isMultipleMatch: true,
            matchType: 'multiple',
            groupedServices: parsed.groupedServices
          };
        }
        
        // 3️⃣ PARTIAL_MATCH - Service not found, suggest closest alternatives
        if (parsed.partialMatch && parsed.closestServices) {
          return {
            message: text,
            isQuoteGeneration: false,
            isPartialMatch: true,
            matchType: 'partial',
            requestedService: parsed.requestedService || '',
            requestedQuantity: parsed.requestedQuantity,
            closestServices: parsed.closestServices,
            alternativeServices: parsed.alternativeServices || []
          };
        }
        
        // 4️⃣ NO_MATCH - Nothing matches, show all services
        if (parsed.noMatch && parsed.allServicesGrouped) {
          return {
            message: text,
            isQuoteGeneration: false,
            isNoMatch: true,
            matchType: 'none',
            requestedService: parsed.requestedService || '',
            allServicesGrouped: parsed.allServicesGrouped
          };
        }
        
        // DEPRECATED: Handle old serviceNotFound format for backward compatibility
        if (parsed.serviceNotFound && parsed.availableServices) {
          return {
            message: text,
            isQuoteGeneration: false,
            isServiceNotFound: true,
            requestedService: parsed.requestedService || '',
            serviceNotFoundMessage: parsed.message || 'The requested service is not available in the proposal.',
            availableServices: parsed.availableServices,
            matchType: 'partial' // Map old format to partial match
          };
        }
      }
    } catch (e) {
      // No complete quote JSON found in response (this is normal during Q&A)
      console.log('JSON parse attempt completed, treating as conversational response:', e);
    }

    // Return conversational response if no structured data was found
    return {
      message: text,
      isQuoteGeneration: false,
      quoteData: null,
    };
  } catch (error: any) {
    console.error('Gemini API error:', error);
    
    if (error.message?.includes('API key')) {
      throw new Error('Invalid API key. Please check your Gemini API configuration.');
    }
    
    if (error.message?.includes('quota')) {
      throw new Error('API quota exceeded. Please try again later.');
    }
    
    // Handle model not found errors
    if (error.message?.includes('not found') || error.message?.includes('models/gemini')) {
      throw new Error(
        'Gemini model not available. Please verify your API key has access to the gemini-2.5-flash-lite model. ' +
        'Visit https://aistudio.google.com to check your API key permissions.'
      );
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

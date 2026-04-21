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

/**
 * 🔴 POST-PROCESSING FIX: Clean up Terms & Conditions formatting
 * 
 * Problem: AI sometimes extracts terms with broken formatting where lines without
 * bullets (orphan lines) appear, causing alignment issues in preview/PDF.
 * 
 * Example of AI mistake:
 *   ❌ "• GST 18% Extra\n• Prior notice required...\nMaximum 2 visitors allowed"
 *      The "Maximum 2 visitors allowed" line has NO bullet, appears as orphan line
 * 
 * Expected correct format:
 *   ✅ "• GST 18% Extra\n• Prior notice required...Maximum 2 visitors allowed"
 *      All text merged into proper bullet points
 * 
 * This function ensures ALL terms are properly bulleted by merging orphan lines
 * with the previous bullet point.
 */
const cleanupTermsAndConditions = (terms: string): string => {
  if (!terms || typeof terms !== 'string') {
    return terms;
  }

  console.log('🔧 Cleaning up Terms & Conditions formatting...');
  
  const lines = terms.split('\n');
  const cleanedTerms: string[] = [];
  let currentTerm = '';
  
  for (let line of lines) {
    line = line.trim();
    
    // Skip empty lines
    if (line.length === 0) {
      continue;
    }
    
    // Check if line starts with a bullet point (•, -, *, or number.)
    const hasBullet = /^[•\-\*]/.test(line) || /^\d+\./.test(line);
    
    if (hasBullet) {
      // This is a new bullet point
      if (currentTerm) {
        cleanedTerms.push(currentTerm);
        console.log(`  ✅ Term: "${currentTerm.substring(0, 60)}..."`);
      }
      currentTerm = line;
    } else {
      // This is an orphan line without bullet - merge with current term
      if (currentTerm) {
        currentTerm += ' ' + line;
        console.log(`  🔀 Merged orphan line: "${line.substring(0, 40)}..."`);
      } else {
        // Edge case: orphan line at the start, treat as new term with bullet
        currentTerm = '• ' + line;
      }
    }
  }
  
  // Don't forget the last term
  if (currentTerm) {
    cleanedTerms.push(currentTerm);
    console.log(`  ✅ Term: "${currentTerm.substring(0, 60)}..."`);
  }
  
  const result = cleanedTerms.join('\n');
  console.log(`🎯 Cleaned ${cleanedTerms.length} terms total`);
  
  return result;
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
  chatHistory: _chatHistory = [], // Prefixed with _ to indicate intentionally unused (context isolation fix)
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

    // ⚠️ CONTEXT ISOLATION FIX: Chat history removed to prevent AI from using previous requests
    // to auto-generate quotes. This ensures consistent, predictable behavior where "40 auto"
    // always shows checkboxes regardless of previous conversation context.
    // Trade-off: Q&A follow-ups may be less contextual, but quote generation is now 100% reliable.
    
    contextPrompt += `USER REQUEST: ${userMessage}`;

    console.log('🔍 Sending to AI:', {
      hasExactMatchHint: userMessage.includes('[EXACT_MATCH_HINT'),
      requestLength: userMessage.length,
      documentCount: proposalTexts?.length || (proposalText ? 1 : 0)
    });
    
    // Debug: Log proposal content preview to see what AI is receiving
    if (proposalTexts && proposalTexts.length > 0) {
      console.log('📄 Proposal documents sent to AI:');
      proposalTexts.forEach((doc, idx) => {
        const preview = doc.content.substring(0, 500);
        console.log(`  Document ${idx + 1} (${doc.fileName}): ${preview.substring(0, 200)}...`);
      });
    } else if (proposalText) {
      console.log('📄 Single proposal sent to AI:', proposalText.substring(0, 300));
    }

    const result = await model.generateContent(contextPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('🤖 AI Response received:', {
      length: text.length,
      hasJSON: text.includes('{'),
      hasQuoteGenerated: text.includes('quoteGenerated'),
      hasMultipleMatch: text.includes('multipleMatch')
    });
    
    // Debug: Log AI's raw response to see what it actually found
    console.log('🤖 AI Raw Response (first 1000 chars):', text.substring(0, 1000));

    // Detect if AI has generated a complete quote (must contain JSON with quoteGenerated flag)
    // @ts-ignore: variables used for state tracking in quote detection flow
    let _quoteData = null;
    // @ts-ignore: variables used for state tracking in quote detection flow
    let _isQuoteGeneration = false;

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
        
        // Handle 4-tier matching system responses
        
        // 1️⃣ EXACT_MATCH - Quote generated
        if (parsed.quoteGenerated && parsed.items && Array.isArray(parsed.items)) {
          console.log('✅ AI detected: EXACT_MATCH - Generating quote');
          // 🔴 POST-PROCESSING FIX #1: Validate and correct line item descriptions
          // The AI sometimes ignores instructions and generates descriptions without the service type prefix
          // This ensures EVERY description starts with the full service type name
          let fixedQuoteData = validateAndFixQuoteDescriptions(parsed);
          
          // 🔴 POST-PROCESSING FIX #2: Clean up Terms & Conditions formatting
          // The AI sometimes extracts terms with orphan lines (no bullets), causing alignment issues
          // This merges orphan lines into proper bullet points for consistent display
          if (fixedQuoteData.termsAndConditions) {
            fixedQuoteData = {
              ...fixedQuoteData,
              termsAndConditions: cleanupTermsAndConditions(fixedQuoteData.termsAndConditions)
            };
          }
          
          // Also cleanup item-level terms if present
          if (fixedQuoteData.items) {
            fixedQuoteData = {
              ...fixedQuoteData,
              items: fixedQuoteData.items.map((item: any) => {
                if (item.termsAndConditions) {
                  return {
                    ...item,
                    termsAndConditions: cleanupTermsAndConditions(item.termsAndConditions)
                  };
                }
                return item;
              })
            };
          }
          
          // Debug: Log T&C extraction results
          console.log('📋 T&C Extraction Summary:');
          console.log('  - General T&C (top-level):', fixedQuoteData.termsAndConditions ? `✅ ${fixedQuoteData.termsAndConditions.split('\n').length} lines` : '❌ MISSING');
          if (fixedQuoteData.items && fixedQuoteData.items.length > 0) {
            fixedQuoteData.items.forEach((item: any, idx: number) => {
              const serviceName = item.title || `Item ${idx + 1}`;
              console.log(`  - Service-specific T&C (${serviceName}):`, item.termsAndConditions ? `✅ ${item.termsAndConditions.split('\n').length} lines` : '⚠️ Empty');
            });
          }
          
          _quoteData = fixedQuoteData;
          _isQuoteGeneration = true;
          return {
            message: text,
            isQuoteGeneration: true,
            quoteData: fixedQuoteData,
            matchType: 'exact'
          };
        }
        
        // 2️⃣ MULTIPLE_MATCH - Ambiguous request, ask user to clarify
        if (parsed.multipleMatch && parsed.groupedServices) {
          console.log('🔀 AI detected: MULTIPLE_MATCH - Showing service options');
          console.log('📋 Grouped services returned by AI:', JSON.stringify(parsed.groupedServices, null, 2));
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
          console.log('⚠️ AI detected: PARTIAL_MATCH - Suggesting alternatives');
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
          console.log('❌ AI detected: NO_MATCH - Showing all services');
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

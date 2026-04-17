import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message } from '../types/chat';
import { CHAT_SYSTEM_PROMPT } from '../utils/promptTemplates';
import { queryRAG } from './ragService';

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

export interface SendMessageParams {
  userMessage: string;
  proposalText?: string; // Single document (backward compatibility)
  proposalTexts?: Array<{fileName: string, content: string}>; // Multi-document support
  chatHistory?: Message[];
  useRAG?: boolean; // Enable RAG context retrieval (default: true)
  proposalId?: string; // Specific proposal to search (optional - searches all if not provided)
}

export interface ServiceSuggestion {
  name: string;
  category: string;
}

export interface GeminiResponse {
  message: string;
  isQuoteGeneration: boolean;
  quoteData?: any;
  isServiceNotFound?: boolean;
  requestedService?: string;
  serviceNotFoundMessage?: string;
  availableServices?: ServiceSuggestion[];
  // Partial match: some services valid, some not found
  isPartialMatch?: boolean;
  validServices?: string[]; // services that exist
  missingServices?: string[]; // services that don't exist
}

export const sendMessageToGemini = async ({
  userMessage,
  proposalText = '',
  useRAG = true,
  proposalId,
}: SendMessageParams): Promise<GeminiResponse> => {
  try {
    await enforceRateLimit();

    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    // Using gemini-2.5-flash-lite model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // Build context
    let contextPrompt = CHAT_SYSTEM_PROMPT + '\n\n';
    
    // PRIORITY 1: RAG Context (most relevant chunks from vector search)
    if (useRAG) {
      try {
        console.log('🔍 Querying RAG system...');
        const ragResult = await queryRAG(userMessage, {
          matchThreshold: 0.7,
          matchCount: 5,
          proposalId, // Search specific proposal or all
        });
        
        if (ragResult.chunks.length > 0) {
          console.log(`✅ RAG found ${ragResult.chunks.length} relevant chunks (relevance: ${(ragResult.relevanceScore * 100).toFixed(0)}%)`);
          contextPrompt += ragResult.context + '\n\n';
        } else {
          console.log('ℹ️ No RAG results, using fallback document context');
        }
      } catch (error) {
        console.warn('⚠️ RAG query failed, falling back to full documents:', error);
        // Continue with normal flow - RAG is enhancement, not requirement
      }
    }
    
    // PRIORITY 2: Multi-document support (NEW - takes priority if provided)
    if (proposalTexts && proposalTexts.length > 0) {
      contextPrompt += `AVAILABLE PROPOSAL DOCUMENTS (${proposalTexts.length} total):\n\n`;
      proposalTexts.forEach((doc, idx) => {
        // Increased limit to capture full documents including Terms & Conditions sections
        const preview = doc.content.substring(0, 50000); // Limit per document for token efficiency
        contextPrompt += `--- DOCUMENT ${idx + 1}: ${doc.fileName} ---\n${preview}\n--- END OF DOCUMENT ${idx + 1} ---\n\n`;
      });
    }
    // PRIORITY 3: Single document support (backward compatibility)
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
        const serviceNotFoundIdx = Math.max(
          text.indexOf('"serviceNotFound"'),
          text.indexOf('serviceNotFound:')
        );
        const quoteGeneratedIdx = Math.max(
          text.indexOf('"quoteGenerated"'),
          text.indexOf('quoteGenerated:')
        );
        const keyIdx = serviceNotFoundIdx !== -1 ? serviceNotFoundIdx : quoteGeneratedIdx;
        
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
        
        // Handle service not found response FIRST (takes priority over quoteGenerated)
        if (parsed.serviceNotFound && parsed.availableServices) {
          return {
            message: text,
            isQuoteGeneration: false,
            isServiceNotFound: true,
            requestedService: parsed.requestedService || '',
            serviceNotFoundMessage: parsed.message || 'The requested service is not available in the proposal.',
            availableServices: parsed.availableServices,
          };
        }
        
        // Only treat as quote generation if it has the quoteGenerated flag and proper structure
        if (parsed.quoteGenerated && parsed.items && Array.isArray(parsed.items)) {
          // CODE-BASED VALIDATION: Check if AI picked the right service
          // Extract branding-type keywords from user's request
          const brandingKeywords = ['full', 'semi', 'back', 'front', 'interior', 'underground', 'shelter', 'panel', 'stickers', 'lit', 'led', 'non led', 'lobby', 'screen', 'lift', 'insertion', 'distribution', 'poster', 'hoardings', 'direction', 'barricade', 'parking', 'lamp post', 'awareness'];
          const vehicleKeywords = ['bus', 'auto', 'metro', 'cab', 'taxi', 'tempo', 'truck', 'van', 'mobile van', 'apartment', 'newspaper', 'pamphlet', 'wall', 'flex', 'traffic'];
          
          const userMsgLower = userMessage.toLowerCase();
          const userBrandingWords = brandingKeywords.filter(kw => userMsgLower.includes(kw));
          const userVehicleWords = vehicleKeywords.filter(kw => userMsgLower.includes(kw));
          
          // Check EACH generated item individually against user keywords
          const validItems: string[] = [];   // Item titles that match user's request
          const invalidItems: string[] = []; // Item titles that AI substituted
          
          for (const item of parsed.items) {
            const itemTitle = (item.title || '').toLowerCase();
            const itemDescs = (item.lineItems || []).map((li: any) => (li.description || '').toLowerCase()).join(' ');
            const itemText = itemTitle + ' ' + itemDescs;
            
            let itemMatches = true;
            
            // Check if this item's branding type matches one the user asked for
            if (userBrandingWords.length > 0) {
              const itemBrandingWords = brandingKeywords.filter(kw => itemText.includes(kw));
              const hasUserBrandingWord = itemBrandingWords.some(kw => userBrandingWords.includes(kw));
              if (!hasUserBrandingWord) {
                // This item has a branding type the user DIDN'T ask for
                console.log(`⚠️ Item mismatch: "${item.title}" has branding [${itemBrandingWords.join(',')}] but user asked [${userBrandingWords.join(',')}]`);
                itemMatches = false;
              }
            }
            
            // Check if this item's vehicle type matches what user asked for
            if (userVehicleWords.length > 0) {
              const itemVehicleWords = vehicleKeywords.filter(kw => itemText.includes(kw));
              const hasUserVehicleWord = itemVehicleWords.some(kw => userVehicleWords.includes(kw));
              if (!hasUserVehicleWord) {
                console.log(`⚠️ Item vehicle mismatch: "${item.title}" has vehicle [${itemVehicleWords.join(',')}] but user asked [${userVehicleWords.join(',')}]`);
                itemMatches = false;
              }
            }
            
            if (itemMatches) {
              validItems.push(item.title || 'Unknown Service');
            } else {
              invalidItems.push(item.title || 'Unknown Service');
            }
          }
          
          console.log(`✅ Valid items: [${validItems.join(', ')}] | ❌ Invalid items: [${invalidItems.join(', ')}]`);
          
          // CASE 1: ALL items match → generate quote normally
          if (invalidItems.length === 0) {
            quoteData = parsed;
            isQuoteGeneration = true;
          }
          // CASE 2: ALL items are wrong → full mismatch, get suggestions (existing behavior)
          else if (validItems.length === 0) {
            console.log('🔄 Full mismatch detected, requesting serviceNotFound suggestions...');
            try {
              await enforceRateLimit();
              const vehicleFilter = userVehicleWords.length > 0 ? userVehicleWords[0] : '';
              const secondPrompt = contextPrompt.split('USER REQUEST:')[0] + 
                `USER REQUEST: The user asked for "${userMessage}". This EXACT service does NOT exist in the proposal. ` +
                `Return ONLY a serviceNotFound JSON listing available ${vehicleFilter ? vehicleFilter.toUpperCase() + '-related' : ''} services from the proposal. ` +
                `Do NOT generate a quote. Only return the serviceNotFound JSON format with availableServices array. ` +
                `Filter to only "${vehicleFilter}" services if possible.`;
              
              const secondResult = await model.generateContent(secondPrompt);
              const secondText = secondResult.response.text();
              
              // Parse the second response for serviceNotFound
              let secondJson = secondText.match(/```json\s*([\s\S]*?)```/);
              if (!secondJson) {
                const snfIdx = Math.max(secondText.indexOf('"serviceNotFound"'), secondText.indexOf('serviceNotFound:'));
                if (snfIdx !== -1) {
                  let bs = -1;
                  for (let i = snfIdx; i >= 0; i--) { if (secondText[i] === '{') { bs = i; break; } }
                  if (bs !== -1) {
                    let d = 0, be = -1;
                    for (let i = bs; i < secondText.length; i++) {
                      if (secondText[i] === '{') d++;
                      else if (secondText[i] === '}') { d--; if (d === 0) { be = i; break; } }
                    }
                    if (be !== -1) secondJson = [secondText.substring(bs, be + 1)] as any;
                  }
                }
              }
              
              if (secondJson) {
                let sJsonStr = secondJson[1] || secondJson[0];
                sJsonStr = sJsonStr.replace(/"([^"]*(?:\\.[^"]*)*)"/g, (match: string) => {
                  return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t');
                });
                const secondParsed = JSON.parse(sJsonStr);
                if (secondParsed.serviceNotFound && secondParsed.availableServices) {
                  return {
                    message: secondText,
                    isQuoteGeneration: false,
                    isServiceNotFound: true,
                    requestedService: secondParsed.requestedService || userMessage,
                    serviceNotFoundMessage: secondParsed.message || `The requested service is not available in the proposal.`,
                    availableServices: secondParsed.availableServices,
                  };
                }
              }
            } catch (secondErr) {
              console.warn('Second call for suggestions failed:', secondErr);
            }
            // If second call also fails, fall through to generate quote as-is
            quoteData = parsed;
            isQuoteGeneration = true;
          }
          // CASE 3: PARTIAL MATCH — some items valid, some substituted
          else {
            console.log('🔄 Partial match detected, requesting suggestions for missing services...');
            // Figure out which user-requested branding words are missing
            const missingBrandingWords = userBrandingWords.filter(kw => {
              // Check if any VALID item covers this keyword
              return !parsed.items.some((item: any) => {
                const itemText = ((item.title || '') + ' ' + (item.lineItems || []).map((li: any) => li.description || '').join(' ')).toLowerCase();
                const itemBrandingWords = brandingKeywords.filter(bk => itemText.includes(bk));
                return itemBrandingWords.includes(kw) && validItems.includes(item.title);
              });
            });
            
            // Build human-readable names for missing services
            const vehiclePrefix = userVehicleWords.length > 0 ? userVehicleWords[0] : '';
            const missingServiceNames = missingBrandingWords.map(kw => 
              `${vehiclePrefix ? vehiclePrefix.charAt(0).toUpperCase() + vehiclePrefix.slice(1) + ' ' : ''}${kw.charAt(0).toUpperCase() + kw.slice(1)} Branding`
            );
            
            try {
              await enforceRateLimit();
              const secondPrompt = contextPrompt.split('USER REQUEST:')[0] + 
                `USER REQUEST: The user asked for "${userMessage}". Some services exist and some do NOT. ` +
                `The following services DO NOT exist: ${missingServiceNames.join(', ')}. ` +
                `Return ONLY a serviceNotFound JSON listing available ${vehiclePrefix ? vehiclePrefix.toUpperCase() + '-related' : ''} services from the proposal. ` +
                `Do NOT generate a quote. Only return the serviceNotFound JSON format with availableServices array.`;
              
              const secondResult = await model.generateContent(secondPrompt);
              const secondText = secondResult.response.text();
              
              let secondJson = secondText.match(/```json\s*([\s\S]*?)```/);
              if (!secondJson) {
                const snfIdx = Math.max(secondText.indexOf('"serviceNotFound"'), secondText.indexOf('serviceNotFound:'));
                if (snfIdx !== -1) {
                  let bs = -1;
                  for (let i = snfIdx; i >= 0; i--) { if (secondText[i] === '{') { bs = i; break; } }
                  if (bs !== -1) {
                    let d = 0, be = -1;
                    for (let i = bs; i < secondText.length; i++) {
                      if (secondText[i] === '{') d++;
                      else if (secondText[i] === '}') { d--; if (d === 0) { be = i; break; } }
                    }
                    if (be !== -1) secondJson = [secondText.substring(bs, be + 1)] as any;
                  }
                }
              }
              
              // Also try text-based fallback
              let suggestions: ServiceSuggestion[] = [];
              if (secondJson) {
                let sJsonStr = secondJson[1] || secondJson[0];
                sJsonStr = sJsonStr.replace(/"([^"]*(?:\\.[^"]*)*)"/g, (match: string) => {
                  return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t');
                });
                const secondParsed = JSON.parse(sJsonStr);
                if (secondParsed.availableServices) {
                  suggestions = secondParsed.availableServices;
                }
              }
              
              if (suggestions.length === 0) {
                // Text-based fallback
                const nameRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"category"\s*:\s*"([^"]+)"/g;
                let regMatch;
                while ((regMatch = nameRegex.exec(secondText)) !== null) {
                  suggestions.push({ name: regMatch[1], category: regMatch[2] });
                }
              }
              
              if (suggestions.length > 0) {
                return {
                  message: text,
                  isQuoteGeneration: false,
                  isServiceNotFound: true,
                  isPartialMatch: true,
                  validServices: validItems,
                  missingServices: missingServiceNames,
                  serviceNotFoundMessage: `${validItems.join(', ')} ${validItems.length === 1 ? 'is' : 'are'} available ✅, but ${missingServiceNames.join(', ')} ${missingServiceNames.length === 1 ? 'is' : 'are'} not available in the proposal. Please select a replacement:`,
                  availableServices: suggestions,
                };
              }
            } catch (secondErr) {
              console.warn('Partial match suggestion call failed:', secondErr);
            }
            // If suggestion call fails, generate quote as-is
            quoteData = parsed;
            isQuoteGeneration = true;
          }
        }
      }
    } catch (e) {
      // No complete quote JSON found in response (this is normal during Q&A)
      console.log('JSON parse failed, checking text-based fallback...', e);
    }

    // FALLBACK: If JSON parsing completely failed but text contains serviceNotFound data,
    // extract service names using regex (handles unquoted keys, missing braces, etc.)
    if (!isQuoteGeneration) {
      const hasServiceNotFoundText = text.includes('serviceNotFound') && text.includes('availableServices');
      if (hasServiceNotFoundText) {
        console.log('📋 Text-based fallback: extracting serviceNotFound from raw text');
        const serviceNames: ServiceSuggestion[] = [];
        const nameRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"category"\s*:\s*"([^"]+)"/g;
        let regMatch;
        while ((regMatch = nameRegex.exec(text)) !== null) {
          serviceNames.push({ name: regMatch[1], category: regMatch[2] });
        }
        
        if (serviceNames.length > 0) {
          const msgMatch = text.match(/message\s*:\s*"([^"]+)"/);
          const reqMatch = text.match(/requestedService\s*:\s*"([^"]+)"/);
          return {
            message: text,
            isQuoteGeneration: false,
            isServiceNotFound: true,
            requestedService: reqMatch ? reqMatch[1] : userMessage,
            serviceNotFoundMessage: msgMatch ? msgMatch[1] : 'The requested service is not available in the proposal. Please select from the available services below:',
            availableServices: serviceNames,
          };
        }
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

import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Input,
  VStack,
  HStack,
  Text,
  IconButton,
  Button,
  Spinner,
  Flex,
  Icon,
  Checkbox,
} from '@chakra-ui/react';
import { FiSend, FiCheck, FiMic } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../../store';
import { sendMessageToGemini } from '../../services/geminiService';
import { Message } from '../../types/chat';
import { Quote, QuoteItem } from '../../types/quote';
import { saveChatHistory, loadChatHistory } from '../../utils/localStorage';
import { loadAllProposalsFromCloud } from '../../services/supabaseProposalService';
import { DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';

const SUGGESTION_PROMPTS = [
  'Generate quote for 100 auto full branding',
  'Create quote for banner printing 10x5 feet, qty 50',
  'Quote for vehicle branding – 20 tempos',
  'Generate quote for shop signage',
  'Create quote for the services in proposal',
];

const ChatInterface: React.FC = () => {
  const history = useHistory();
  const { proposal, setCurrentQuote } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  
  // Multi-select state for MULTIPLE_MATCH scenarios
  // Map: messageId -> { vehicleType -> selectedServiceName }
  const [selectedServices, setSelectedServices] = useState<Record<string, Record<string, string>>>({});

  // Load chat history on mount
  useEffect(() => {
    const history = loadChatHistory();
    if (history && history.length > 0) {
      setMessages(history.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })));
    }
  }, []);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      saveChatHistory(messages);
    }
  }, [messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // Load all proposals from cloud for multi-document search
      let allProposals: any[] = [];
      try {
        allProposals = await loadAllProposalsFromCloud(100);
      } catch (err) {
        console.warn('Could not load proposals from cloud, using current proposal only:', err);
      }

      // Prepare proposal contexts for AI
      let proposalContexts: Array<{fileName: string, content: string}> | undefined;
      
      if (allProposals && allProposals.length > 0) {
        // Multi-document mode: Send ALL uploaded proposals to AI
        proposalContexts = allProposals
          .filter(p => p.text_content && p.text_content.trim().length > 50)
          .map(p => ({
            fileName: p.file_name,
            content: p.text_content
          }));
        console.log(`📚 Multi-document search enabled: ${proposalContexts.length} documents available`);
      }

      const response = await sendMessageToGemini({
        userMessage: userMessage.content,
        proposalText: proposal.textContent, // Backward compatibility fallback
        proposalTexts: proposalContexts, // NEW: Multi-document support
        chatHistory: messages,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
        matchType: response.matchType,
        
        // MULTIPLE_MATCH
        isMultipleMatch: response.isMultipleMatch,
        groupedServices: response.groupedServices,
        
        // PARTIAL_MATCH
        isPartialMatch: response.isPartialMatch,
        requestedService: response.requestedService,
        requestedQuantity: response.requestedQuantity,
        closestServices: response.closestServices,
        alternativeServices: response.alternativeServices,
        
        // NO_MATCH
        isNoMatch: response.isNoMatch,
        allServicesGrouped: response.allServicesGrouped,
        
        // DEPRECATED (backward compatibility)
        isServiceNotFound: response.isServiceNotFound,
        availableServices: response.availableServices,
        validServices: response.validServices,
        missingServices: response.missingServices,
      };

      // Handle 4-tier matching system responses
      
      // MULTIPLE_MATCH - Ask user to clarify
      if (response.isMultipleMatch && response.groupedServices) {
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      // PARTIAL_MATCH - Suggest alternatives
      if (response.isPartialMatch && response.closestServices) {
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      // NO_MATCH - Show all services
      if (response.isNoMatch && response.allServicesGrouped) {
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      // DEPRECATED: Handle old serviceNotFound format
      if (response.isServiceNotFound && response.availableServices) {
        assistantMessage.content = response.serviceNotFoundMessage || 
          `The requested service is not available in the proposal. Please select from the available services below:`;
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      setMessages(prev => [...prev, assistantMessage]);

      // EXACT_MATCH - Quote generated, process and navigate
      if (response.isQuoteGeneration && response.quoteData) {
        // Detect if source is a JPEG/image rate card (use standard terms) vs Excel/PDF proposal (use extracted terms)
        // Check the actual documents that were sent to Gemini (multi-doc or single doc)
        let isRateCardImage = false;
        if (proposalContexts && proposalContexts.length > 0) {
          // Multi-document mode: check if ALL documents are images
          isRateCardImage = proposalContexts.every(p => {
            const ext = p.fileName.toLowerCase().split('.').pop() || '';
            return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
          });
        } else {
          // Single document mode: check current proposal
          const fileExtension = proposal.fileName.toLowerCase().split('.').pop() || '';
          isRateCardImage = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension);
        }
        
        console.log('🔍 Rate card detection:', { isRateCardImage, fileName: proposal.fileName, multiDoc: !!proposalContexts });
        
        // Flatten lineItems into individual QuoteItems
        const quoteItems: QuoteItem[] = response.quoteData.items.flatMap((section: any, sectionIndex: number) => {
          const sectionTitle = section.title || '';
          return section.lineItems.map((item: any, lineIndex: number) => {
            // Use original description from AI - don't prepend generic section title
            // The AI already provides specific service names (e.g., "BUS SEMI BRANDING - Rental Price")
            let description = item.description;
            
            // Check if description is too generic (missing specific service details)
            // Only prepend section title if description doesn't contain specific service keywords
            const hasSpecificService = /\b(BUS|AUTO|CAB|TAXI|TEMPO|TRUCK|VAN|VEHICLE|SHOP|BANNER|SIGNAGE|BOARD|HOARDING|DISPLAY|PRINTING|FIXING|RENTAL|BRANDING|FULL|SEMI|BACK|FRONT|SIDE)\b/i.test(description);
            const containsSectionTitle = description.toLowerCase().includes(sectionTitle.toLowerCase());
            
            // Only prepend if description is generic AND doesn't already have section title
            if (sectionTitle && !containsSectionTitle && !hasSpecificService) {
              description = `${sectionTitle} - ${description}`;
            }
            
            // Extract specific service title from description for display in T&C section
            // This ensures we show "Bus Full Branding" instead of generic "Vehicle Branding"
            let specificTitle = '';
            const descParts = description.split(' - ');
            if (descParts.length >= 2 && sectionTitle && 
                descParts[0].toLowerCase().trim() === sectionTitle.toLowerCase().trim()) {
              // First part is generic section title, use second part as specific title
              specificTitle = descParts[1].trim();
            } else {
              // Use first part as title
              specificTitle = descParts[0].trim();
            }
            // Clean up extra details (e.g., "(per bus month)") to get just the service name
            specificTitle = specificTitle
              .replace(/\s*\(.*?\)\s*/g, '') // Remove parenthetical notes
              .replace(/\s*-\s*(Display|Rental|Printing|Fixing|Price).*$/i, '') // Remove price type suffixes
              .trim();
            
            const duration = item.duration && item.duration > 1 ? item.duration : undefined;
            return {
              id: `${sectionIndex}-${lineIndex}`,
              title: specificTitle, // Store specific service title for T&C display
              description: description,
              quantity: item.quantity || 1,
              rate: item.unitPrice || 0,
              duration: duration,
              total: (item.quantity || 1) * (item.unitPrice || 0) * (duration || 1),
              // Only store terms on the first line item of each section to avoid duplicate textareas
              // For rate card images, clear per-item terms; for proposals, keep them
              termsAndConditions: lineIndex === 0 ? (isRateCardImage ? undefined : (section.termsAndConditions || undefined)) : undefined
            };
          });
        });

        const subtotal = quoteItems.reduce((sum, item) => sum + item.total, 0);
        const gstPercentage = 18;
        const gstAmount = subtotal * (gstPercentage / 100);
        
        // Use standard business terms for rate card images, extracted terms for Excel/PDF proposals
        let finalTermsAndConditions: string;
        
        if (isRateCardImage) {
          // Detected JPEG/image rate card - use standard terms
          finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
          console.log('✅ Using DEFAULT_GENERAL_TERMS for image rate card');
        } else {
          // For Excel/PDF proposals, use extracted terms but filter out rate card artifacts
          const geminiTerms = response.quoteData.termsAndConditions || '';
          
          // Additional safety check: detect if Gemini extracted rate card footnotes instead of real T&C
          const isRateCardFootnote = 
            geminiTerms.includes('மூக்க்கம்கககம்க்') || // Tamil text
            geminiTerms.includes('சர்வீஸ்') || // Tamil text
            geminiTerms.toLowerCase().includes('no explicit general terms') ||
            geminiTerms.toLowerCase().includes('no classified display ad') ||
            geminiTerms.toLowerCase().includes('srilanka edition') ||
            geminiTerms.toLowerCase().includes('rate card');
          
          if (isRateCardFootnote) {
            // Gemini extracted rate card notes, not real T&C - use defaults
            finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
            console.log('⚠️ Detected rate card footnotes in T&C, using DEFAULT_GENERAL_TERMS instead');
          } else {
            // Looks like legitimate T&C from a proposal
            finalTermsAndConditions = geminiTerms || 'Standard terms and conditions apply';
            console.log('✅ Using extracted T&C from proposal document');
          }
        }
        
        const quote: Quote = {
          id: Date.now().toString(),
          quoteNumber: `QT-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          items: quoteItems,
          subtotal,
          gstEnabled: true,
          gstPercentage,
          gstAmount,
          total: subtotal + gstAmount,
          deliveryTimeline: response.quoteData.deliveryTimeline || '7 working days after payment',
          termsAndConditions: finalTermsAndConditions,
          notes: response.quoteData.notes,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        setCurrentQuote(quote);
        
        // Show success message before navigating
        const quoteReadyMessage: Message = {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: '✓ Quote generated successfully! Redirecting to quote preview...',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, quoteReadyMessage]);
        
        // Auto-navigate to quote page after a brief delay
        setTimeout(() => {
          history.push('/quote');
        }, 1500);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to send message');
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  // Handle clicking a service suggestion button (auto-sends as new message)
  const handleServiceSuggestionClick = (serviceName: string, isPartialMatch?: boolean, validServices?: string[]) => {
    // Extract the original quantity from the last user message if possible
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    let quantity = '';
    if (lastUserMsg) {
      const qtyMatch = lastUserMsg.content.match(/(\d+)\s/);
      if (qtyMatch) quantity = qtyMatch[1] + ' ';
    }
    
    // For partial match: combine valid services + replacement
    if (isPartialMatch && validServices && validServices.length > 0 && lastUserMsg) {
      // Extract ALL quantities from the original user message
      const allQtys = [...lastUserMsg.content.matchAll(/(\d+)/g)].map(m => m[1]);
      // Build combined quote: valid services from original + replacement for missing
      const validParts = validServices.map((svc, idx) => {
        const qty = allQtys[idx] || allQtys[0] || '';
        return `${qty} ${svc}`.trim();
      });
      // Use second quantity for replacement if available, otherwise first
      const replacementQty = allQtys.length > 1 ? allQtys[allQtys.length - 1] : (allQtys[0] || '');
      validParts.push(`${replacementQty} ${serviceName}`.trim());
      setInputValue(`Generate quote for ${validParts.join(' and ')}`);
    } else {
      setInputValue(`Generate quote for ${quantity}${serviceName}`);
    }
    
    // Auto-send after a brief tick so the input updates
    setTimeout(() => {
      const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
      if (sendBtn) sendBtn.click();
    }, 100);
  };

  // Handle checkbox selection for MULTIPLE_MATCH multi-select
  const handleServiceCheckbox = (messageId: string, vehicleType: string, serviceName: string, isChecked: boolean) => {
    setSelectedServices(prev => {
      const newState = { ...prev };
      if (!newState[messageId]) {
        newState[messageId] = {};
      }
      
      if (isChecked) {
        newState[messageId][vehicleType] = serviceName;
      } else {
        delete newState[messageId][vehicleType];
      }
      
      // Clean up empty message entries
      if (Object.keys(newState[messageId]).length === 0) {
        delete newState[messageId];
      }
      
      return newState;
    });
  };

  // Generate quote for all selected services in MULTIPLE_MATCH
  const handleGenerateSelectedQuote = async (messageId: string, groupedServices: any[]) => {
    const selected = selectedServices[messageId];
    if (!selected || Object.keys(selected).length === 0) {
      return; // Nothing selected
    }

    // Build the combined request string
    const parts: string[] = [];
    groupedServices.forEach(group => {
      const serviceName = selected[group.vehicleType];
      if (serviceName) {
        const qty = group.requestedQuantity || '';
        parts.push(`${qty} ${serviceName}`.trim());
      }
    });

    if (parts.length === 0) return;

    const combinedRequest = `Generate quote for ${parts.join(' and ')}`;
    setInputValue(combinedRequest);
    
    // Clear selections after generating
    setSelectedServices(prev => {
      const newState = { ...prev };
      delete newState[messageId];
      return newState;
    });
    
    // Auto-send
    setTimeout(() => {
      const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
      if (sendBtn) sendBtn.click();
    }, 100);
  };

  // Initialize speech recognition for mobile using Capacitor plugin
  useEffect(() => {
    // Request permission on component mount for mobile
    if (Capacitor.isNativePlatform()) {
      SpeechRecognition.requestPermissions().catch(err => {
        console.warn('Microphone permission denied:', err);
      });
    }

    return () => {
      // Cleanup: stop any ongoing recognition
      if (Capacitor.isNativePlatform() && isRecording) {
        SpeechRecognition.stop().catch(() => {});
      }
    };
  }, []);

  // Toggle voice input - for both mobile (Capacitor) and web (fallback)
  const toggleVoiceInput = async () => {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      if (Capacitor.isNativePlatform()) {
        try {
          await SpeechRecognition.stop();
        } catch (err) {
          console.error('Error stopping voice recognition:', err);
        }
      } else if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    } else {
      // Start recording
      setIsRecording(true);
      
      if (Capacitor.isNativePlatform()) {
        // Mobile: Use Capacitor Speech Recognition plugin
        try {
          // Check if speech recognition is available
          const available = await SpeechRecognition.available();
          if (!available.available) {
            throw new Error('Speech recognition not available on this device');
          }

          // Check and request permissions
          const permStatus = await SpeechRecognition.checkPermissions();
          if (permStatus.speechRecognition !== 'granted') {
            const permResult = await SpeechRecognition.requestPermissions();
            if (permResult.speechRecognition !== 'granted') {
              throw new Error('Microphone permission denied');
            }
          }

          // Start listening - Result comes back directly from this call
          const result = await SpeechRecognition.start({
            language: 'en-US',
            maxResults: 5,
            prompt: '🎤 Speak now...',
            partialResults: true,
            popup: true,
          });

          console.log('Speech recognition result:', result);

          // Extract the recognized text from the result
          if (result && result.matches && result.matches.length > 0) {
            const transcript = result.matches[0];
            console.log('Recognized text:', transcript);
            setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
          } else {
            console.warn('No speech recognized');
          }
          
          setIsRecording(false);
        } catch (err: any) {
          console.error('Voice recognition error:', err);
          setIsRecording(false);
          
          // Only show error if it's not a user cancellation
          if (err.message && !err.message.toLowerCase().includes('cancel')) {
            const errorMessage: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: `Voice input error: ${err.message || 'Could not access microphone'}`,
              timestamp: new Date(),
              isError: true,
            };
            setMessages(prev => [...prev, errorMessage]);
          }
        }
      } else {
        // Web fallback: Use Web Speech API
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          const SpeechRecognitionAPI = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
          const recognition = new SpeechRecognitionAPI();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = 'en-US';

          recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
            setIsRecording(false);
          };

          recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsRecording(false);
          };

          recognition.onend = () => {
            setIsRecording(false);
          };

          recognitionRef.current = recognition;
          recognition.start();
        } else {
          setIsRecording(false);
          const errorMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: 'Voice input is not supported in this browser.',
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      }
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      h="100%"
      w="100%"
      borderRadius="14px"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
      bg="white"
    >
      {/* Header - AI Assistant with Online Status */}
      <HStack
        justify="space-between"
        align="center"
        px={5}
        py={4}
        bgGradient="linear(90deg, gray.900, #1A1A2E)"
      >
        <HStack spacing={2}>
          <Box
            bgGradient="linear(135deg, purple.500, red.600)"
            color="white"
            w="32px"
            h="32px"
            borderRadius="8px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="sm"
            fontWeight="700"
          >
            G
          </Box>
          <Text fontSize="md" fontWeight="600" color="white">
            Quote Assistant
          </Text>
        </HStack>
        <HStack spacing={1}>
          <Box 
            w="8px" 
            h="8px" 
            borderRadius="full" 
            bg="teal.400"
            sx={{
              animation: 'pulse 2s infinite',
              '@keyframes pulse': {
                '0%,100%': { opacity: 1 },
                '50%': { opacity: 0.4 },
              },
            }}
          />
          <Text fontSize="xs" color="teal.400" fontWeight="500">
            Online
          </Text>
        </HStack>
      </HStack>

      {/* Content Area */}
      <VStack align="stretch" spacing={4} flex={1} overflow="hidden" p={4}>
        {/* Suggestion Chips */}
        {messages.length === 0 && (
          <Box px={2}>
            <Text fontSize="xs" fontWeight="500" color="gray.500" mb={2}>
              Try asking:
            </Text>
            <VStack align="stretch" spacing={2}>
              {SUGGESTION_PROMPTS.map((prompt, index) => (
                <Button
                  key={index}
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.700"
                  size="sm"
                  justifyContent="flex-start"
                  textAlign="left"
                  whiteSpace="normal"
                  h="auto"
                  py={2}
                  px={3}
                  borderRadius="full"
                  fontWeight="400"
                  fontSize="11px"
                  onClick={() => handleSuggestionClick(prompt)}
                  _hover={{
                    bg: 'red.50',
                    borderColor: 'red.500',
                    color: 'red.600',
                  }}
                >
                  {prompt}
                </Button>
              ))}
            </VStack>
          </Box>
        )}

        {/* AI Response Output Area */}
        <Box
          flex={1}
          bg="gray.50"
          borderRadius="lg"
          p={{ base: 3, md: 3 }}
          overflowY="auto"
          minH="0"
          sx={{ 
            '::-webkit-scrollbar': { 
              width: '6px',
            },
            '::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '::-webkit-scrollbar-thumb': {
              background: 'gray.300',
              borderRadius: '3px',
            },
          }}
        >
          {messages.length === 0 ? (
            <Flex justify="center" align="center" h="full">
              <Text color="gray.400" fontSize="xs" textAlign="center" px={4}>
                {proposal.textContent
                  ? 'Ask me anything about your uploaded proposals.'
                  : 'Ask general questions or upload documents for custom quotes.'}
              </Text>
            </Flex>
          ) : (
            <VStack align="stretch" spacing={5}>
              {messages.map(message => {
                // Parse message content for special formatting
                const lines = message.content.split('\n');
                const hasQuoteHeader = lines[0]?.toLowerCase().includes('quote generated');

                // Helper: bold key summary values
                function boldSummary(line: string) {
                  // Bold numbers and key phrases (e.g., 5 Mobile LED Vans, 3 months)
                  return line.replace(/(\d+\s+Mobile LED Vans|\d+\s+months?|\d+\s+LED vans?|\d+\s+vans?)/gi, '<b>$1</b>');
                }

                return (
                  <Box
                    key={message.id}
                    alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
                    maxW={message.role === 'user' ? '80%' : '90%'}
                  >
                    {message.role === 'assistant' && hasQuoteHeader ? (
                      // Special format for quote generation messages
                      <Box>
                        {/* Quote Header Badge */}
                        <HStack 
                          spacing={2} 
                          mb={3} 
                          align="center"
                          bg="linear-gradient(135deg, #e6f7ff 0%, #e0f2fe 100%)"
                          px={4}
                          py={2.5}
                          borderRadius="12px"
                          border="1px solid"
                          borderColor="blue.200"
                          boxShadow="0 2px 6px rgba(14, 165, 233, 0.15)"
                        >
                          <Icon 
                            as={FiCheck} 
                            color="blue.600" 
                            boxSize="16px"
                            fontWeight="bold"
                          />
                          <Text
                            fontSize="13px"
                            fontWeight="700"
                            color="blue.700"
                            letterSpacing="tight"
                          >
                            {lines[0]}
                          </Text>
                        </HStack>

                        {/* Response Card */}
                        <Box
                          bg="white"
                          border="1px solid"
                          borderColor="gray.200"
                          px={{ base: 4, md: 5 }}
                          py={{ base: 4, md: 5 }}
                          borderRadius="14px"
                          boxShadow="0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)"
                        >
                          <VStack align="stretch" spacing={2.5}>
                            {(() => {
                              // Filter out all lines inside ```json ... ``` code blocks
                              let inCodeBlock = false;
                              return lines.slice(1).map((line, idx) => {
                                if (line.trim().startsWith('```json')) { inCodeBlock = true; return null; }
                                if (inCodeBlock && line.trim() === '```') { inCodeBlock = false; return null; }
                                if (inCodeBlock) return null;
                                if (!line.trim()) return null;
                                return (
                                  <Text 
                                    key={idx} 
                                    fontSize="14px" 
                                    color="gray.700" 
                                    lineHeight="1.7"
                                    fontWeight="500"
                                    dangerouslySetInnerHTML={{ __html: boldSummary(line) }} 
                                  />
                                );
                              });
                            })()}
                          </VStack>

                          {/* Code Block - if message contains JSON */}
                          {message.content.includes('```json') && (() => {
                            const raw = message.content.match(/```json\n([\s\S]*?)```/)?.[1] || '';
                            // Enhanced syntax highlighting
                            const highlighted = raw.replace(
                              /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(true|false|null)|(\d+(?:\.\d+)?)/g,
                              (match: string, key: string, colon: string, str: string, bool: string, num: string) => {
                                if (key && colon) return `<span style="color:#fbbf24; font-weight:600">${key}</span><span style="color:#9ca3af">${colon}</span>`;
                                if (str) return `<span style="color:#34d399">${str}</span>`;
                                if (bool) return `<span style="color:#60a5fa; font-weight:600">${bool}</span>`;
                                if (num) return `<span style="color:#a78bfa; font-weight:600">${num}</span>`;
                                return match;
                              }
                            );
                            return (
                              <Box
                                bg="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
                                p={4}
                                borderRadius="12px"
                                fontSize="12px"
                                fontFamily="'Consolas', 'Monaco', monospace"
                                overflowX="auto"
                                mt={4}
                                maxW={{ base: '100%', md: '380px' }}
                                border="1px solid"
                                borderColor="gray.700"
                                boxShadow="inset 0 2px 4px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15)"
                                sx={{
                                  '::-webkit-scrollbar': { height: '6px' },
                                  '::-webkit-scrollbar-track': { bg: 'whiteAlpha.100', borderRadius: '3px' },
                                  '::-webkit-scrollbar-thumb': { bg: 'whiteAlpha.300', borderRadius: '3px' },
                                }}
                              >
                                <Box
                                  as="pre"
                                  whiteSpace="pre"
                                  fontSize="12px"
                                  fontFamily="'Consolas', 'Monaco', monospace"
                                  color="#e5e7eb"
                                  lineHeight="1.6"
                                  m={0}
                                  dangerouslySetInnerHTML={{ __html: highlighted }}
                                />
                              </Box>
                            );
                          })()}
                        </Box>
                      </Box>
                    ) : (
                      // Regular message format
                      <Box>
                        <Box
                          bgGradient={message.role === 'user' 
                            ? 'linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)' 
                            : undefined
                          }
                          bg={message.role === 'user' ? undefined : 'white'}
                          border={message.role === 'user' ? 'none' : '1px solid'}
                          borderColor={message.role === 'user' ? undefined : 'gray.200'}
                          color={message.role === 'user' ? 'white' : 'gray.800'}
                          px={{ base: 4, md: 5 }}
                          py={{ base: 3.5, md: 4 }}
                          borderRadius={message.role === 'user' ? '20px 20px 4px 20px' : '4px 16px 16px 16px'}
                          boxShadow={message.role === 'user' 
                            ? '0 8px 16px rgba(220, 38, 38, 0.25), 0 2px 4px rgba(220, 38, 38, 0.1)' 
                            : '0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)'
                          }
                        >
                          <Text 
                            fontSize="14px" 
                            whiteSpace="pre-wrap"
                            lineHeight="1.6"
                            fontWeight="500"
                          >
                            {message.content}
                          </Text>
                          <Text
                            fontSize="11px"
                            mt={2}
                            opacity={message.role === 'user' ? 0.75 : 0.6}
                            fontWeight="500"
                            letterSpacing="tight"
                          >
                            {message.timestamp.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </Box>

                        {/* 2️⃣ MULTIPLE_MATCH - Show grouped services with checkboxes for multi-select */}
                        {message.isMultipleMatch && message.groupedServices && message.groupedServices.length > 0 && (
                          <Box mt={3}>
                            <Text fontSize="12px" fontWeight="600" color="orange.600" mb={3} px={1}>
                              🔀 Multiple services found. Select the ones you need:
                            </Text>
                            <VStack align="stretch" spacing={4}>
                              {message.groupedServices.map((group, gIdx) => (
                                <Box key={gIdx}>
                                  <Text fontSize="13px" fontWeight="700" color="gray.700" mb={2} px={1}>
                                    {group.vehicleType} Services {group.requestedQuantity ? `(${group.requestedQuantity} units)` : ''}
                                  </Text>
                                  <VStack align="stretch" spacing={2}>
                                    {group.services.map((svc, sIdx) => {
                                      const isChecked = selectedServices[message.id]?.[group.vehicleType] === svc.name;
                                      return (
                                        <Box
                                          key={sIdx}
                                          p={3}
                                          borderRadius="12px"
                                          border="2px solid"
                                          borderColor={isChecked ? 'blue.400' : 'gray.200'}
                                          bg={isChecked ? 'blue.50' : 'white'}
                                          _hover={{
                                            borderColor: isChecked ? 'blue.500' : 'blue.300',
                                            bg: isChecked ? 'blue.100' : 'blue.25',
                                            transform: 'translateX(2px)',
                                          }}
                                          transition="all 0.2s ease"
                                        >
                                          <Checkbox
                                            isChecked={isChecked}
                                            onChange={(e) => handleServiceCheckbox(message.id, group.vehicleType, svc.name, e.target.checked)}
                                            colorScheme="blue"
                                            size="md"
                                            fontWeight="500"
                                            fontSize="13px"
                                            spacing={3}
                                            cursor="pointer"
                                          >
                                            <Text fontSize="13px" fontWeight="500" color={isChecked ? 'blue.700' : 'gray.700'}>
                                              {svc.name}
                                            </Text>
                                          </Checkbox>
                                        </Box>
                                      );
                                    })}
                                  </VStack>
                                </Box>
                              ))}
                            </VStack>
                            
                            {/* Generate Quote Button - Only show if at least one service is selected */}
                            {selectedServices[message.id] && Object.keys(selectedServices[message.id]).length > 0 && (
                              <Button
                                mt={4}
                                w="full"
                                size="lg"
                                bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                                color="white"
                                fontWeight="700"
                                fontSize="15px"
                                py={6}
                                borderRadius="14px"
                                onClick={() => handleGenerateSelectedQuote(message.id, message.groupedServices!)}
                                isDisabled={isLoading}
                                _hover={{
                                  bgGradient: "linear(135deg, #b91c1c 0%, #9f1239 50%, #881337 100%)",
                                  transform: 'translateY(-2px)',
                                  boxShadow: '0 12px 24px rgba(220, 38, 38, 0.3)',
                                }}
                                _active={{
                                  transform: 'translateY(0)',
                                }}
                                transition="all 0.2s ease"
                                leftIcon={<Icon as={FiCheck} boxSize="18px" />}
                              >
                                Generate Quote for {Object.keys(selectedServices[message.id]).length} Selected Service{Object.keys(selectedServices[message.id]).length > 1 ? 's' : ''}
                              </Button>
                            )}
                          </Box>
                        )}

                        {/* 3️⃣ PARTIAL_MATCH - Show closest alternatives */}
                        {message.isPartialMatch && !message.isServiceNotFound && message.closestServices && message.closestServices.length > 0 && (
                          <Box mt={3}>
                            <Box mb={2} px={1}>
                              <Text fontSize="13px" fontWeight="600" color="red.500">
                                ❌ "{message.requestedService}" is not available
                              </Text>
                              <Text fontSize="12px" color="gray.600" mt={1}>
                                Did you mean one of these similar services?
                              </Text>
                            </Box>
                            <VStack align="stretch" spacing={2}>
                              <Box>
                                <Text fontSize="11px" fontWeight="700" color="green.600" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                  Closest Matches
                                </Text>
                                <VStack align="stretch" spacing={1.5}>
                                  {message.closestServices.map((svc, idx) => (
                                    <Button
                                      key={idx}
                                      variant="outline"
                                      size="sm"
                                      justifyContent="flex-start"
                                      textAlign="left"
                                      whiteSpace="normal"
                                      h="auto"
                                      py={2.5}
                                      px={4}
                                      borderRadius="12px"
                                      fontWeight="500"
                                      fontSize="13px"
                                      borderColor="green.300"
                                      color="green.700"
                                      bg="green.50"
                                      onClick={() => {
                                        const qty = message.requestedQuantity || '';
                                        const text = qty ? `${qty} ${svc.name}` : svc.name;
                                        setInputValue(text);
                                      }}
                                      isDisabled={isLoading}
                                      _hover={{
                                        bg: 'green.100',
                                        borderColor: 'green.500',
                                        transform: 'translateX(4px)',
                                        boxShadow: '0 2px 8px rgba(34, 197, 94, 0.2)',
                                      }}
                                      transition="all 0.2s ease"
                                      leftIcon={<Text fontSize="14px">✓</Text>}
                                      rightIcon={svc.similarity === 'high' ? <Text fontSize="10px" fontWeight="700" color="green.600">HIGH</Text> : undefined}
                                    >
                                      {svc.name}
                                    </Button>
                                  ))}
                                </VStack>
                              </Box>
                              {message.alternativeServices && message.alternativeServices.length > 0 && (
                                <Box>
                                  <Text fontSize="11px" fontWeight="700" color="blue.500" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                    Other Options
                                  </Text>
                                  <VStack align="stretch" spacing={1.5}>
                                    {message.alternativeServices.map((svc, idx) => (
                                      <Button
                                        key={idx}
                                        variant="outline"
                                        size="sm"
                                        justifyContent="flex-start"
                                        textAlign="left"
                                        whiteSpace="normal"
                                        h="auto"
                                        py={2.5}
                                        px={4}
                                        borderRadius="12px"
                                        fontWeight="500"
                                        fontSize="13px"
                                        borderColor="blue.200"
                                        color="blue.700"
                                        bg="blue.50"
                                        onClick={() => {
                                          const qty = message.requestedQuantity || '';
                                          const text = qty ? `${qty} ${svc.name}` : svc.name;
                                          setInputValue(text);
                                        }}
                                        isDisabled={isLoading}
                                        _hover={{
                                          bg: 'blue.100',
                                          borderColor: 'blue.400',
                                          transform: 'translateX(4px)',
                                          boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
                                        }}
                                        transition="all 0.2s ease"
                                        leftIcon={<Text fontSize="14px">→</Text>}
                                      >
                                        {svc.name}
                                      </Button>
                                    ))}
                                  </VStack>
                                </Box>
                              )}
                            </VStack>
                          </Box>
                        )}

                        {/* 4️⃣ NO_MATCH - Show all services organized by category */}
                        {message.isNoMatch && message.allServicesGrouped && message.allServicesGrouped.length > 0 && (
                          <Box mt={3}>
                            <Box mb={2} px={1}>
                              <Text fontSize="13px" fontWeight="600" color="red.500">
                                ❌ We don't offer {message.requestedService}
                              </Text>
                              <Text fontSize="12px" color="gray.600" mt={1}>
                                Browse all our available services:
                              </Text>
                            </Box>
                            <VStack align="stretch" spacing={3}>
                              {message.allServicesGrouped.map((catGroup, cIdx) => (
                                <Box key={cIdx}>
                                  <Text fontSize="11px" fontWeight="700" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1.5} px={1}>
                                    {catGroup.category}
                                  </Text>
                                  <VStack align="stretch" spacing={1.5}>
                                    {catGroup.services.map((svc, sIdx) => (
                                      <Button
                                        key={sIdx}
                                        variant="outline"
                                        size="sm"
                                        justifyContent="flex-start"
                                        textAlign="left"
                                        whiteSpace="normal"
                                        h="auto"
                                        py={2.5}
                                        px={4}
                                        borderRadius="12px"
                                        fontWeight="500"
                                        fontSize="13px"
                                        borderColor="gray.300"
                                        color="gray.700"
                                        bg="gray.50"
                                        onClick={() => setInputValue(svc.name)}
                                        isDisabled={isLoading}
                                        _hover={{
                                          bg: 'gray.100',
                                          borderColor: 'gray.400',
                                          transform: 'translateX(4px)',
                                          boxShadow: '0 2px 8px rgba(107, 114, 128, 0.2)',
                                        }}
                                        transition="all 0.2s ease"
                                        leftIcon={<Text fontSize="14px">→</Text>}
                                      >
                                        {svc.name}
                                      </Button>
                                    ))}
                                  </VStack>
                                </Box>
                              ))}
                            </VStack>
                          </Box>
                        )}

                        {/* DEPRECATED: Service suggestion buttons when service not found (backward compatibility) */}
                        {message.isServiceNotFound && message.availableServices && message.availableServices.length > 0 && (
                          <Box mt={3}>
                            {/* Show valid services info for partial matches */}
                            {message.isPartialMatch && message.validServices && message.validServices.length > 0 && (
                              <Box mb={2} px={1}>
                                <Text fontSize="12px" fontWeight="600" color="green.600">
                                  ✅ {message.validServices.join(', ')} — available
                                </Text>
                                {message.missingServices && message.missingServices.length > 0 && (
                                  <Text fontSize="12px" fontWeight="600" color="red.500" mt={0.5}>
                                    ❌ {message.missingServices.join(', ')} — not available
                                  </Text>
                                )}
                                <Text fontSize="12px" color="gray.500" mt={1}>
                                  Select a replacement below to generate a combined quote:
                                </Text>
                              </Box>
                            )}
                            {!message.isPartialMatch && (
                              <Text fontSize="12px" fontWeight="600" color="gray.500" mb={2} px={1}>
                                Available services:
                              </Text>
                            )}
                            <VStack align="stretch" spacing={2}>
                              {/* Group by category */}
                              {(() => {
                                const categories = new Map<string, typeof message.availableServices>();
                                message.availableServices!.forEach(svc => {
                                  const cat = svc.category || 'Other';
                                  if (!categories.has(cat)) categories.set(cat, []);
                                  categories.get(cat)!.push(svc);
                                });
                                return Array.from(categories.entries()).map(([category, services]) => (
                                  <Box key={category}>
                                    <Text fontSize="11px" fontWeight="700" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                      {category}
                                    </Text>
                                    <VStack align="stretch" spacing={1.5}>
                                      {services!.map((svc, idx) => (
                                        <Button
                                          key={idx}
                                          variant="outline"
                                          size="sm"
                                          justifyContent="flex-start"
                                          textAlign="left"
                                          whiteSpace="normal"
                                          h="auto"
                                          py={2.5}
                                          px={4}
                                          borderRadius="12px"
                                          fontWeight="500"
                                          fontSize="13px"
                                          borderColor="blue.200"
                                          color="blue.700"
                                          bg="blue.50"
                                          onClick={() => handleServiceSuggestionClick(svc.name, message.isPartialMatch, message.validServices)}
                                          isDisabled={isLoading}
                                          _hover={{
                                            bg: 'blue.100',
                                            borderColor: 'blue.400',
                                            transform: 'translateX(4px)',
                                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
                                          }}
                                          transition="all 0.2s ease"
                                          leftIcon={<Text fontSize="14px">→</Text>}
                                        >
                                          {svc.name}
                                        </Button>
                                      ))}
                                    </VStack>
                                  </Box>
                                ));
                              })()}
                            </VStack>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* Typing Indicator */}
              {isLoading && (
                <Box alignSelf="flex-start">
                  <HStack
                    spacing={1.5}
                    px={4}
                    py={3}
                    bg="white"
                    border="1px solid"
                    borderColor="gray.200"
                    borderRadius="4px 14px 14px 14px"
                    boxShadow="0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)"
                  >
                    {[0, 1, 2].map(i => (
                      <Box
                        key={i}
                        w="7px"
                        h="7px"
                        borderRadius="full"
                        bg="blue.500"
                        sx={{
                          animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
                          '@keyframes bounce': {
                            '0%,100%': { transform: 'translateY(0)', opacity: 0.5 },
                            '50%': { transform: 'translateY(-8px)', opacity: 1, boxShadow: '0 0 8px rgba(59, 130, 246, 0.5)' },
                          },
                        }}
                      />
                    ))}
                  </HStack>
                </Box>
              )}

              <div ref={messagesEndRef} />
            </VStack>
          )}
        </Box>

        {/* Bottom Chat Input Bar */}
        <HStack 
          spacing={3} 
          flexShrink={0} 
          px={{ base: 3, md: 4 }}
          py={{ base: 4, md: 4 }}
          borderTop="2px solid"
          borderColor="gray.300"
          bg="white"
          boxShadow="0 -4px 20px rgba(0, 0, 0, 0.08)"
        >
          <Box position="relative" flex={1}>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                proposal.textContent
                  ? '💬 Ask about this proposal...'
                  : '✨ Type your message here - ask anything about quotes...'
              }
              disabled={isLoading}
              size="lg"
              borderRadius="16px"
              bg="gray.50"
              border="2px solid"
              borderColor="gray.300"
              color="gray.900"
              fontSize={{ base: '16px', md: '16px' }}
              h={{ base: '56px', md: '60px' }}
              w="100%"
              px={{ base: 5, md: 6 }}
              fontWeight="500"
              transition="all 0.2s ease"
              _placeholder={{ 
                color: 'gray.500', 
                fontSize: { base: '15px', md: '16px' },
                fontWeight: '500',
              }}
              _hover={{ 
                borderColor: 'brand.400',
                bg: 'white',
                boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.2), 0 4px 16px rgba(0, 0, 0, 0.08)',
              }}
              _focus={{
                borderColor: 'brand.500',
                bg: 'white',
                boxShadow: '0 0 0 4px rgba(201, 31, 61, 0.15), 0 8px 24px rgba(201, 31, 61, 0.12)',
                outline: 'none',
              }}
              _disabled={{
                bg: 'gray.100',
                color: 'gray.400',
                cursor: 'not-allowed',
                opacity: 0.7,
                borderColor: 'gray.300',
              }}
              sx={{
                '&::placeholder': {
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }
              }}
            />
          </Box>
          <Box position="relative" display="inline-flex" alignItems="center" justifyContent="center">
            {/* Listening indicator text */}
            {isRecording && (
              <Text
                position="absolute"
                top="-28px"
                fontSize="xs"
                fontWeight="600"
                color="red.500"
                bg="white"
                px={3}
                py={1}
                borderRadius="full"
                boxShadow="0 2px 8px rgba(239, 68, 68, 0.2)"
                border="1px solid"
                borderColor="red.200"
                whiteSpace="nowrap"
                sx={{
                  animation: 'fadeIn 0.3s ease-in-out',
                  '@keyframes fadeIn': {
                    from: { opacity: 0, transform: 'translateY(4px)' },
                    to: { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                🎙️ Listening...
              </Text>
            )}
            
            {/* Animated rings when recording */}
            {isRecording && (
              <>
                <Box
                  position="absolute"
                  w="48px"
                  h="48px"
                  borderRadius="full"
                  border="2px solid"
                  borderColor="red.400"
                  sx={{
                    animation: 'ripple 1.5s ease-out infinite',
                    '@keyframes ripple': {
                      '0%': { 
                        transform: 'scale(1)',
                        opacity: 0.8,
                      },
                      '100%': { 
                        transform: 'scale(1.8)',
                        opacity: 0,
                      },
                    },
                  }}
                />
                <Box
                  position="absolute"
                  w="48px"
                  h="48px"
                  borderRadius="full"
                  border="2px solid"
                  borderColor="red.300"
                  sx={{
                    animation: 'ripple 1.5s ease-out infinite 0.5s',
                    '@keyframes ripple': {
                      '0%': { 
                        transform: 'scale(1)',
                        opacity: 0.8,
                      },
                      '100%': { 
                        transform: 'scale(1.8)',
                        opacity: 0,
                      },
                    },
                  }}
                />
              </>
            )}
            
            {/* Voice input button */}
            <IconButton
              aria-label={isRecording ? "Stop recording" : "Voice input"}
              icon={<FiMic />}
              onClick={toggleVoiceInput}
              isDisabled={isLoading}
              bgGradient={isRecording 
                ? "linear(to-br, red.500, red.600, pink.500)" 
                : "linear(to-br, blue.500, blue.600, cyan.500)"
              }
              color="white"
              size="md"
              h="48px"
              w="48px"
              minW="48px"
              borderRadius="full"
              flexShrink={0}
              fontSize="20px"
              position="relative"
              zIndex={1}
              border="2px solid"
              borderColor={isRecording ? "red.300" : "blue.300"}
              boxShadow={isRecording 
                ? "0 4px 20px rgba(239, 68, 68, 0.5), 0 0 30px rgba(239, 68, 68, 0.3), inset 0 1px 0 rgba(255,255,255,0.3)" 
                : "0 4px 16px rgba(59, 130, 246, 0.4), 0 0 24px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255,255,255,0.3)"
              }
              _hover={{
                bgGradient: isRecording 
                  ? "linear(to-br, red.600, red.700, pink.600)" 
                  : "linear(to-br, blue.600, blue.700, cyan.600)",
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: isRecording 
                  ? '0 8px 28px rgba(239, 68, 68, 0.6), 0 0 40px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255,255,255,0.4)' 
                  : '0 8px 24px rgba(59, 130, 246, 0.5), 0 0 32px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
                borderColor: isRecording ? "red.200" : "blue.200",
              }}
              _active={{
                transform: 'scale(0.95)',
                boxShadow: isRecording 
                  ? '0 2px 12px rgba(239, 68, 68, 0.4), inset 0 2px 4px rgba(0,0,0,0.2)' 
                  : '0 2px 12px rgba(59, 130, 246, 0.4), inset 0 2px 4px rgba(0,0,0,0.2)',
              }}
              _disabled={{
                bgGradient: 'linear(to-br, gray.300, gray.400)',
                color: 'gray.500',
                cursor: 'not-allowed',
                opacity: 0.6,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                borderColor: 'gray.300',
              }}
              sx={isRecording ? {
                animation: 'micPulse 1.2s ease-in-out infinite',
                '@keyframes micPulse': {
                  '0%, 100%': { 
                    transform: 'scale(1)',
                    filter: 'brightness(1)',
                  },
                  '50%': { 
                    transform: 'scale(1.08)',
                    filter: 'brightness(1.15)',
                  },
                },
              } : {
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </Box>
          <IconButton
            aria-label="Send message"
            data-send-btn
            icon={isLoading ? <Spinner size="sm" color="white" thickness="3px" /> : <FiSend />}
            onClick={handleSendMessage}
            isDisabled={!inputValue.trim() || isLoading}
            bgGradient="linear(to-br, brand.500, brand.600)"
            color="white"
            size="lg"
            h={{ base: '56px', md: '60px' }}
            w={{ base: '56px', md: '60px' }}
            minW={{ base: '56px', md: '60px' }}
            borderRadius="16px"
            flexShrink={0}
            fontSize="22px"
            transition="all 0.2s ease"
            boxShadow="0 4px 20px rgba(201, 31, 61, 0.4), 0 2px 8px rgba(201, 31, 61, 0.25)"
            _hover={{
              bgGradient: "linear(to-br, brand.600, brand.700)",
              transform: 'translateY(-2px) scale(1.05)',
              boxShadow: '0 8px 28px rgba(201, 31, 61, 0.5), 0 4px 12px rgba(201, 31, 61, 0.35)',
            }}
            _active={{
              transform: 'scale(0.95)',
              boxShadow: '0 2px 12px rgba(201, 31, 61, 0.35)',
            }}
            _disabled={{
              bgGradient: 'linear(to-br, gray.300, gray.400)',
              color: 'gray.500',
              cursor: 'not-allowed',
              opacity: 0.6,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              filter: 'grayscale(0.3)',
            }}
          />
        </HStack>
      </VStack>
    </Box>
  );
};

export default ChatInterface;

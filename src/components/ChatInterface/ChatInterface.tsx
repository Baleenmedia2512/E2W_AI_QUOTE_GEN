import React, { useState, useRef, useEffect } from 'react';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonButton,
  IonInput,
  IonSpinner,
  IonChip,
  IonIcon,
} from '@ionic/react';
import { sendSharp, refreshSharp, documentTextSharp } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../../store';
import { sendMessageToGemini } from '../../services/geminiService';
import { Message } from '../../types/chat';
import { Quote, QuoteItem } from '../../types/quote';
import { saveChatHistory, loadChatHistory } from '../../utils/localStorage';
import { SAMPLE_PROMPTS } from '../../utils/promptTemplates';
import './ChatInterface.css';

const ChatInterface: React.FC = () => {
  const history = useHistory();
  const { proposal, setCurrentQuote } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedQuoteData, setDetectedQuoteData] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLIonInputElement>(null);

  // Debug: Log proposal state when it changes
  useEffect(() => {
    console.log('Proposal state updated:', {
      hasFile: !!proposal?.file,
      fileName: proposal?.fileName,
      hasTextContent: !!proposal?.textContent,
      textContentLength: proposal?.textContent?.length || 0,
      pageCount: proposal?.pageCount
    });
  }, [proposal]);

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

    console.log('Sending message with proposal context:', {
      hasProposal: !!proposal,
      hasTextContent: !!proposal?.textContent,
      textContentLength: proposal?.textContent?.length || 0
    });

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
      console.log('Calling Gemini API...');
      const response = await sendMessageToGemini({
        userMessage: userMessage.content,
        proposalText: proposal.textContent,
        chatHistory: messages,
      });

      console.log('Gemini response received:', response);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      // If quote data was detected, store it
      if (response.isQuoteGeneration) {
        console.log('Quote discussion detected');
        // Extract quote information from the response
        const quoteInfo = extractQuoteInfo(response.message, userMessage.content);
        if (quoteInfo) {
          setDetectedQuoteData(quoteInfo);
        }
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

  const handleKeyPress = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSamplePrompt = (prompt: string) => {
    setInputValue(prompt);
    inputRef.current?.setFocus();
  };

  const extractQuoteInfo = (aiResponse: string, userMessage: string): any => {
    // Extract item description and quantity from user message
    const quantityMatch = userMessage.match(/(\d+)\s*(auto|banner|hoarding|flex|branding)/i);
    const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
    
    // Extract price information from AI response
    const priceMatches = aiResponse.match(/₹\s*[\d,]+/g);
    let unitPrice = 0;
    let total = 0;
    
    if (priceMatches && priceMatches.length > 0) {
      // Extract numbers from price strings
      const prices = priceMatches.map(p => parseInt(p.replace(/[₹,\s]/g, '')));
      
      // Try to identify unit price and total
      if (prices.length >= 2) {
        unitPrice = prices[0];
        total = prices[prices.length - 1];
      } else if (prices.length === 1) {
        total = prices[0];
        unitPrice = quantity > 0 ? total / quantity : total;
      }
    }
    
    // Extract item description
    let description = 'Service';
    if (userMessage.match(/auto.*branding/i)) {
      description = 'Auto Full Branding';
    } else if (userMessage.match(/banner/i)) {
      description = 'Banner Printing';
    } else if (userMessage.match(/hoarding/i)) {
      description = 'Hoarding Advertisement';
    } else if (userMessage.match(/flex/i)) {
      description = 'Flex Printing';
    }
    
    return {
      description,
      quantity,
      unitPrice,
      total,
      userMessage,
      aiResponse: aiResponse.substring(0, 500) // Store first 500 chars for reference
    };
  };

  const handleCreateQuote = () => {
    if (!detectedQuoteData) {
      alert('No quote information detected. Please discuss quote details with the AI first.');
      return;
    }
    
    // Create a Quote object from the detected data
    const quoteItem: QuoteItem = {
      id: '1',
      description: detectedQuoteData.description,
      quantity: detectedQuoteData.quantity,
      rate: detectedQuoteData.unitPrice,
      total: detectedQuoteData.total || (detectedQuoteData.quantity * detectedQuoteData.unitPrice)
    };
    
    const quote: Quote = {
      id: Date.now().toString(),
      quoteNumber: `QT-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      items: [quoteItem],
      subtotal: quoteItem.total,
      gstEnabled: true,
      gstAmount: quoteItem.total * 0.18, // 18% GST
      total: quoteItem.total * 1.18,
      deliveryTimeline: '7 working days after payment',
      termsAndConditions: 'Standard terms and conditions apply',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to store and navigate to quote page
    setCurrentQuote(quote);
    history.push('/quote');
  };

  const handleClearChat = () => {
    setMessages([]);
    setError(null);
    setDetectedQuoteData(null);
    saveChatHistory([]);
  };

  return (
    <IonCard className="chat-interface">
      <IonCardHeader>
        <div className="chat-header">
          <IonCardTitle>AI Assistant</IonCardTitle>
          {messages.length > 0 && (
            <IonButton fill="clear" size="small" onClick={handleClearChat}>
              <IonIcon icon={refreshSharp} slot="icon-only" />
            </IonButton>
          )}
        </div>
      </IonCardHeader>
      <IonCardContent className="chat-content">
        {/* Sample Prompts */}
        {messages.length === 0 && (
          <div className="sample-prompts">
            <p className="sample-prompts-title">Try asking:</p>
            <div className="sample-prompts-chips">
              {SAMPLE_PROMPTS.map((prompt, index) => (
                <IonChip
                  key={index}
                  onClick={() => handleSamplePrompt(prompt)}
                  className="sample-prompt-chip"
                >
                  {prompt}
                </IonChip>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="messages-container">
          {messages.map(message => (
            <div
              key={message.id}
              className={`message ${message.role} ${message.isError ? 'error' : ''}`}
            >
              <div className="message-bubble">
                <div className="message-content">{message.content}</div>
                <div className="message-timestamp">
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {isLoading && (
            <div className="message assistant">
              <div className="message-bubble typing-indicator">
                <IonSpinner name="dots" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Create Quote Button */}
        {detectedQuoteData && messages.length > 0 && (
          <div className="create-quote-banner">
            <div className="quote-detected-message">
              <IonIcon icon={documentTextSharp} />
              <span>Quote details detected! Ready to create a formal quote?</span>
            </div>
            <IonButton
              color="primary"
              onClick={handleCreateQuote}
              disabled={isLoading}
            >
              <IonIcon icon={documentTextSharp} slot="start" />
              Create Quote
            </IonButton>
          </div>
        )}

        {/* Error Message */}
        {error && !isLoading && (
          <div className="error-banner">
            <p>{error}</p>
          </div>
        )}

        {/* Input Area */}
        <div className="input-container">
          <IonInput
            ref={inputRef}
            value={inputValue}
            onIonInput={(e) => setInputValue(e.detail.value || '')}
            onKeyPress={handleKeyPress}
            placeholder={
              proposal.textContent
                ? 'Ask about the proposal or request a quote...'
                : 'Upload a proposal to start chatting...'
            }
            disabled={isLoading || !proposal.textContent}
            className="chat-input"
          />
          <IonButton
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading || !proposal.textContent}
            className="send-button"
          >
            <IonIcon icon={sendSharp} slot="icon-only" />
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  );
};

export default ChatInterface;

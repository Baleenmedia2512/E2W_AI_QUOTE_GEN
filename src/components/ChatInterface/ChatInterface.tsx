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
import { sendSharp, refreshSharp } from 'ionicons/icons';
import { useAppStore } from '../../store';
import { sendMessageToGemini } from '../../services/geminiService';
import { Message } from '../../types/chat';
import { saveChatHistory, loadChatHistory } from '../../utils/localStorage';
import { SAMPLE_PROMPTS } from '../../utils/promptTemplates';
import './ChatInterface.css';

const ChatInterface: React.FC = () => {
  const { proposal } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLIonInputElement>(null);

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
      const response = await sendMessageToGemini({
        userMessage: userMessage.content,
        proposalText: proposal.textContent,
        chatHistory: messages,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      // If quote data was detected, store it (will be handled in the future)
      if (response.quoteData) {
        console.log('Quote data detected:', response.quoteData);
        // TODO: Update quote state in store
      }
    } catch (err: any) {
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

  const handleClearChat = () => {
    setMessages([]);
    setError(null);
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

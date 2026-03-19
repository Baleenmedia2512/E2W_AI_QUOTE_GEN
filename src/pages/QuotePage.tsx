import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  HStack,
  VStack,
  Container,
  Icon,
  IconButton,
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import QuoteNavBar from '../components/QuoteWizard/QuoteNavBar';
import QuoteStepper from '../components/QuoteWizard/QuoteStepper';
import CompanyInfoForm from '../components/CompanyInfoForm/CompanyInfoForm';
import ClientInfoForm from '../components/ClientInfoForm/ClientInfoForm';
import QuotePreview from '../components/QuotePreview/QuotePreview';
import { TemplateSelector } from '../components/TemplateSelector/TemplateSelector';
import { useAppStore } from '../store';
import { CompanyInfo } from '../types/company';
import { ClientInfo } from '../types/client';
import { Quote } from '../types/quote';
import { saveCompanyInfo } from '../utils/localStorage';

type QuoteStep = 'company' | 'client' | 'preview' | 'template';

const QuotePage: React.FC = () => {
  const history = useHistory();
  const { currentQuote, updateQuote, setCurrentQuote, companyInfo, clientInfo, setCompanyInfo, setClientInfo, selectedTemplate, setSelectedTemplate } = useAppStore();
  const [currentStep, setCurrentStep] = useState<QuoteStep>('company');
  const [isNavigating, setIsNavigating] = useState(false);

  // Determine initial step based on available data
  useEffect(() => {
    console.log('📄 QuotePage mounted - checking data...');
    console.log('Has companyInfo:', !!companyInfo);
    console.log('Has clientInfo:', !!clientInfo);
    console.log('Has currentQuote:', !!currentQuote);
    
    if (!companyInfo) {
      console.log('→ Setting step to: company');
      setCurrentStep('company');
    } else if (!clientInfo) {
      console.log('→ Setting step to: client');
      setCurrentStep('client');
    } else if (currentQuote) {
      console.log('→ Setting step to: preview');
      setCurrentStep('preview');
    }
  }, []); // Only run on mount



  const handleCompanySubmit = (info: CompanyInfo) => {
    setCompanyInfo(info);
    saveCompanyInfo(info);
    setCurrentStep('client');
  };

  const handleClientSubmit = (info: ClientInfo) => {
    setClientInfo(info);
    
    // Create quote if it doesn't exist (for manual flow)
    if (!currentQuote) {
      const newQuote: Quote = {
        id: Date.now().toString(),
        quoteNumber: `Q-${Date.now()}`,
        date: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          {
            id: '1',
            description: 'Sample Service/Product (Edit in preview)',
            quantity: 1,
            rate: 1000,
            total: 1000
          }
        ],
        subtotal: 1000,
        gstEnabled: true,
        gstPercentage: 18,
        gstAmount: 180,
        total: 1180,
        deliveryTimeline: '2-4 weeks',
        termsAndConditions: 'Payment terms: 50% advance, 50% on completion',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setCurrentQuote(newQuote);
      console.log('✅ Created new quote with sample item:', newQuote);
    }
    
    setCurrentStep('preview');
  };

  const handleQuoteUpdate = (quote: Quote) => {
    updateQuote(quote);
  };

  const handleSaveQuote = () => {
    if (!currentQuote) {
      alert('No quote to save');
      return;
    }
    
    // Save to local storage
    const savedQuotes = JSON.parse(localStorage.getItem('savedQuotes') || '[]');
    const existingIndex = savedQuotes.findIndex((q: Quote) => q.id === currentQuote.id);
    
    if (existingIndex >= 0) {
      savedQuotes[existingIndex] = currentQuote;
      alert('Quote updated successfully!');
    } else {
      savedQuotes.push(currentQuote);
      alert('Quote saved successfully!');
    }
    
    localStorage.setItem('savedQuotes', JSON.stringify(savedQuotes));
    console.log('Saved quote:', currentQuote);
  };

  const handleGeneratePDF = () => {
    console.log('🔍 Continue to Template clicked');
    
    if (!currentQuote) {
      console.error('❌ No quote available');
      alert('Please create a quote first');
      return;
    }
    
    if (!companyInfo) {
      console.error('❌ Company info missing');
      alert('Please add company information first');
      setCurrentStep('company');
      return;
    }
    
    if (!clientInfo) {
      console.error('❌ Client info missing');
      alert('Please add client information first');
      setCurrentStep('client');
      return;
    }
    
    console.log('✅ Validation passed - moving to template selection...');
    setCurrentStep('template');
  };

  const handleTemplateSelected = () => {
    console.log('🚀 PREVIEW & EXPORT PDF BUTTON CLICKED');
    console.log('Template selected:', selectedTemplate);
    console.log('Current quote:', currentQuote);
    console.log('Company info:', companyInfo);
    console.log('Client info:', clientInfo);
    
    setIsNavigating(true);
    
    try {
      // Ensure quote has at least one item for preview
      if (currentQuote && currentQuote.items.length === 0) {
        console.log('⚠️ Quote has no items, adding sample item...');
        const updatedQuote = {
          ...currentQuote,
          items: [{
            id: '1',
            description: 'Sample Service/Product (Edit in preview)',
            quantity: 1,
            rate: 1000,
            total: 1000
          }],
          subtotal: 1000,
          gstAmount: 180,
          total: 1180
        };
        setCurrentQuote(updatedQuote);
        localStorage.setItem('currentQuote', JSON.stringify(updatedQuote));
        console.log('✅ Sample item added to quote');
      } else if (currentQuote) {
        localStorage.setItem('currentQuote', JSON.stringify(currentQuote));
        console.log('✅ Quote saved to localStorage');
      } else {
        console.error('❌ No quote to save!');
        alert('Please create a quote first');
        setIsNavigating(false);
        return;
      }
      
      if (companyInfo) {
        localStorage.setItem('companyInfo', JSON.stringify(companyInfo));
        console.log('✅ Company info saved to localStorage');
      } else {
        console.error('❌ No company info to save!');
      }
      
      if (clientInfo) {
        localStorage.setItem('clientInfo', JSON.stringify(clientInfo));
        console.log('✅ Client info saved to localStorage');
      } else {
        console.error('❌ No client info to save!');
      }
      
      localStorage.setItem('selectedTemplate', selectedTemplate);
      console.log('✅ Template saved to localStorage:', selectedTemplate);
      
      console.log('🔄 Navigating to /preview...');
      console.log('History object:', history);
      
      // Try multiple navigation methods
      try {
        history.push('/preview');
        console.log('✅ history.push executed');
      } catch (navError) {
        console.error('❌ history.push failed:', navError);
        console.log('🔄 Trying window.location fallback...');
        window.location.href = '/preview';
      }
      
    } catch (error) {
      console.error('❌ Error in handleTemplateSelected:', error);
      alert('An error occurred: ' + (error as Error).message);
      setIsNavigating(false);
    }
  };

  const handleBack = () => {
    if (currentStep === 'template') {
      setCurrentStep('preview');
    } else if (currentStep === 'preview') {
      setCurrentStep('client');
    } else if (currentStep === 'client') {
      setCurrentStep('company');
    } else {
      history.push('/');
    }
  };

  const handleNext = () => {
    if (currentStep === 'company' && companyInfo) {
      setCurrentStep('client');
    } else if (currentStep === 'client' && clientInfo) {
      setCurrentStep('preview');
    } else if (currentStep === 'preview' && currentQuote) {
      setCurrentStep('template');
    } else if (currentStep === 'template' && selectedTemplate) {
      handleTemplateSelected();
    }
  };

  const getStepNumber = (): number => {
    switch (currentStep) {
      case 'company': return 1;
      case 'client': return 2;
      case 'preview': return 3;
      case 'template': return 4;
      default: return 1;
    }
  };

  return (
    <Box minH="100vh" bg="#EDF1F7">
      {/* Top Navigation */}
      <QuoteNavBar />

      {/* Stepper */}
      <QuoteStepper currentStep={getStepNumber()} />

      {/* Back/Next Navigation Arrows */}
      <Box bg="white" borderBottom="1px solid" borderColor="gray.200" py={{ base: 2, md: 3 }}>
        <Container maxW="1280px" px={{ base: 3, md: 4 }}>
          <HStack justify="space-between">
            <IconButton
              aria-label="Back"
              icon={<Icon as={FiArrowLeft} />}
              variant="ghost"
              onClick={handleBack}
              isDisabled={currentStep === 'company'}
              colorScheme="blue"
              size="md"
            />
            <IconButton
              aria-label="Next"
              icon={<Icon as={FiArrowRight} />}
              variant="ghost"
              onClick={handleNext}
              isDisabled={
                (currentStep === 'company' && !companyInfo) ||
                (currentStep === 'client' && !clientInfo) ||
                (currentStep === 'preview' && !currentQuote) ||
                (currentStep === 'template' && !selectedTemplate)
              }
              colorScheme="blue"
              size="md"
            />
          </HStack>
        </Container>
      </Box>

      {/* Main Content - Centered Card */}
      <Container maxW="900px" py={{ base: 4, md: 8 }} px={{ base: 3, md: 4 }}>
        <Box>
          {currentStep === 'company' && (
            <CompanyInfoForm
              onSubmit={handleCompanySubmit}
              initialData={companyInfo}
            />
          )}

          {currentStep === 'client' && (
            <ClientInfoForm
              onSubmit={handleClientSubmit}
              onBack={() => setCurrentStep('company')}
              initialData={clientInfo}
            />
          )}

          {currentStep === 'preview' && currentQuote && (
            <VStack spacing={6} align="stretch">
              <QuotePreview
                quote={currentQuote}
                onUpdate={handleQuoteUpdate}
                onSave={handleSaveQuote}
              />
              <HStack spacing={3} justify="flex-end" bg="white" p={{ base: 4, md: 6 }} borderRadius="16px" boxShadow="sm" flexDir={{ base: 'column', sm: 'row' }} w="100%">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep('client')}
                  size={{ base: 'md', md: 'lg' }}
                  borderColor="gray.300"
                  _hover={{ bg: 'gray.50' }}
                  w={{ base: '100%', sm: 'auto' }}
                >
                  Back
                </Button>
                <Button
                  bg="#750926"
                  color="white"
                  onClick={handleGeneratePDF}
                  size={{ base: 'md', md: 'lg' }}
                  px={{ base: 4, md: 8 }}
                  _hover={{ bg: '#5a0619' }}
                  isDisabled={!companyInfo || !clientInfo || !currentQuote}
                  w={{ base: '100%', sm: 'auto' }}
                >
                  {!companyInfo ? 'Add Company Info' : 
                   !clientInfo ? 'Add Client Info' : 
                   'Continue to Template'}
                </Button>
              </HStack>
            </VStack>
          )}

          {currentStep === 'template' && (
            <VStack spacing={6} align="stretch">
              <Box bg="white" borderRadius={{ base: '12px', md: '16px' }} boxShadow="sm" p={{ base: 3, md: 6 }}>
                <TemplateSelector selectedTemplate={selectedTemplate} onSelectTemplate={setSelectedTemplate} />
              </Box>
              <HStack spacing={3} justify="space-between" bg="white" p={{ base: 4, md: 6 }} borderRadius="16px" boxShadow="sm" flexDir={{ base: 'column', sm: 'row' }} w="100%">
                <Button
                  onClick={() => setCurrentStep('preview')}
                  variant="outline"
                  size={{ base: 'md', md: 'lg' }}
                  borderColor="gray.300"
                  _hover={{ bg: 'gray.50' }}
                  w={{ base: '100%', sm: 'auto' }}
                >
                  Back
                </Button>
                <Button
                  bg="#750926"
                  color="white"
                  onClick={handleTemplateSelected}
                  size={{ base: 'md', md: 'lg' }}
                  px={{ base: 4, md: 8 }}
                  _hover={{ bg: '#5a0619' }}
                  isDisabled={!selectedTemplate}
                  isLoading={isNavigating}
                  loadingText="Loading..."
                  w={{ base: '100%', sm: 'auto' }}
                >
                  Preview & Export PDF
                </Button>
              </HStack>
            </VStack>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default QuotePage;

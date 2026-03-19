import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  HStack,
  VStack,
  Heading,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Flex,
  useBreakpointValue,
  Alert,
  AlertIcon
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight, FiCheck } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import Layout from '../components/Layout/Layout';
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

  const isMobile = useBreakpointValue({ base: true, md: false });

  const steps = [
    { id: 'company', label: 'Company Info', number: 1 },
    { id: 'client', label: 'Client Info', number: 2 },
    { id: 'preview', label: 'Preview & Edit', number: 3 },
    { id: 'template', label: 'Choose Template', number: 4 },
  ];

  return (
    <Layout title="Create Quote">
      <VStack spacing={6} align="stretch">
        {/* Navigation Buttons */}
        <Flex justify="space-between" align="center" w="full">
          <Button
            leftIcon={<FiArrowLeft />}
            variant="ghost"
            onClick={handleBack}
          >
            Back
          </Button>
          
          <Button
            rightIcon={<FiArrowRight />}
            variant="ghost"
            colorScheme="blue"
            onClick={handleNext}
            isDisabled={
              (currentStep === 'company' && !companyInfo) ||
              (currentStep === 'client' && !clientInfo) ||
              (currentStep === 'preview' && !currentQuote) ||
              (currentStep === 'template' && !selectedTemplate)
            }
          >
            Next
          </Button>
        </Flex>

        {/* Progress Steps */}
        <Flex
          justify="center"
          gap={{ base: 2, md: 3 }}
          wrap={isMobile ? "wrap" : "nowrap"}
        >
          {steps.map((step) => (
            <Badge
              key={step.id}
              px={{ base: 3, md: 4 }}
              py={2}
              borderRadius="full"
              fontSize={{ base: "xs", md: "sm" }}
              fontWeight="semibold"
              colorScheme={currentStep === step.id ? 'brand' : 'gray'}
              variant={currentStep === step.id ? 'solid' : 'outline'}
            >
              {step.number}. {isMobile ? step.label.split(' ')[0] : step.label}
            </Badge>
          ))}
        </Flex>

        {/* Form Steps */}
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
              <Card variant="outline">
                <CardBody>
                  <HStack spacing={3} justify="flex-end" flexWrap="wrap">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentStep('client')}
                      size="lg"
                    >
                      Back
                    </Button>
                    <Button
                      colorScheme="brand"
                      onClick={handleGeneratePDF}
                      isDisabled={!companyInfo || !clientInfo || !currentQuote}
                      size="lg"
                      flex={{ base: 1, md: 'auto' }}
                    >
                      {!companyInfo ? 'Add Company Info to Continue' : 
                       !clientInfo ? 'Add Client Info to Continue' : 
                       'Continue to Template Selection'}
                    </Button>
                  </HStack>
                </CardBody>
              </Card>
            </VStack>
          )}

          {currentStep === 'template' && (
            <Card variant="outline">
              <CardHeader textAlign="center">
                <Heading size="lg" mb={2}>Choose Your Template</Heading>
                <Box color="gray.600">
                  Select a professional template that best represents your brand
                </Box>
              </CardHeader>
              <CardBody>
                <VStack spacing={6} minH="400px">
                  <TemplateSelector
                    selectedTemplate={selectedTemplate}
                    onSelectTemplate={(template) => {
                      console.log('✅ Template selected:', template);
                      setSelectedTemplate(template);
                    }}
                  />
                  <Card variant="filled" w="full">
                    <CardBody>
                      <HStack spacing={3} justify="space-between" flexWrap="wrap">
                        <Button
                          variant="outline"
                          leftIcon={<FiArrowLeft />}
                          onClick={() => setCurrentStep('preview')}
                          flex={{ base: 1, md: 'auto' }}
                        >
                          Back to Quote
                        </Button>
                        <Button
                          colorScheme="green"
                          leftIcon={<FiCheck />}
                          onClick={handleTemplateSelected}
                          isDisabled={!selectedTemplate || isNavigating}
                          isLoading={isNavigating}
                          loadingText="Loading Preview..."
                          flex={{ base: 1, md: 'auto' }}
                          minW={{ base: 'auto', md: '200px' }}
                        >
                          Preview & Export PDF
                        </Button>
                      </HStack>
                    </CardBody>
                  </Card>
                </VStack>
              </CardBody>
            </Card>
          )}

          {/* Debug fallback */}
          {currentStep && !['company', 'client', 'preview', 'template'].includes(currentStep) && (
            <Alert status="error">
              <AlertIcon />
              Unknown step: {currentStep}
              <Button ml={4} onClick={() => setCurrentStep('company')}>
                Start Over
              </Button>
            </Alert>
          )}
        </Box>
      </VStack>
    </Layout>
  );
};

export default QuotePage;

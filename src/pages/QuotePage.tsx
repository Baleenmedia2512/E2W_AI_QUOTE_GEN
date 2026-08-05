import React from 'react';
import { Box, Container, useToast } from '@chakra-ui/react';
import { useHistory } from 'react-router-dom';
import QuoteFlowNav, { getQuoteFlowNavOffset } from '../components/QuoteWizard/QuoteFlowNav';
import ClientInfoForm from '../components/ClientInfoForm/ClientInfoFormWithAutocomplete';
import { useAppStore } from '../store';
import { ClientInfo } from '../types/client';
import { Quote } from '../types/quote';

const QuotePage: React.FC = () => {
  const history = useHistory();
  const toast = useToast();
  const {
    currentQuote,
    setCurrentQuote,
    companyInfo,
    clientInfo,
    setClientInfo,
    selectedTemplate,
  } = useAppStore();

  const navOffset = getQuoteFlowNavOffset('client');

  const navigateToPreview = (quote: Quote | null, client: ClientInfo | null) => {
    try {
      let quoteToSave = quote;

      if (quoteToSave && quoteToSave.items.length === 0) {
        quoteToSave = {
          ...quoteToSave,
          items: [
            {
              id: '1',
              description: 'Sample Service/Product',
              quantity: 1,
              rate: 1000,
              total: 1000,
            },
          ],
          subtotal: 1000,
          gstAmount: 180,
          total: 1180,
        };
        setCurrentQuote(quoteToSave);
      }

      if (!quoteToSave) {
        toast({
          title: 'No quote available',
          description: 'Generate a quote from Chat first.',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        });
        history.push('/');
        return;
      }

      if (!companyInfo) {
        toast({
          title: 'Company details required',
          description: 'Add your company info in Settings before preview.',
          status: 'warning',
          duration: 4000,
          isClosable: true,
        });
        history.push('/company-settings');
        return;
      }

      if (!client) {
        toast({
          title: 'Client details required',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      localStorage.setItem('currentQuote', JSON.stringify(quoteToSave));
      localStorage.setItem('companyInfo', JSON.stringify(companyInfo));
      localStorage.setItem('clientInfo', JSON.stringify(client));
      localStorage.setItem('selectedTemplate', selectedTemplate);

      history.push('/preview');
    } catch (error) {
      toast({
        title: 'Navigation failed',
        description: (error as Error).message,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const handleClientSubmit = (info: ClientInfo) => {
    setClientInfo(info);

    let quoteToUse = currentQuote;
    if (!quoteToUse) {
      quoteToUse = {
        id: Date.now().toString(),
        quoteNumber: `Q-${Date.now()}`,
        date: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          {
            id: '1',
            description: 'Sample Service/Product',
            quantity: 1,
            rate: 1000,
            total: 1000,
          },
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
      setCurrentQuote(quoteToUse);
    }

    navigateToPreview(quoteToUse, info);
  };

  const handleNextPreview = () => {
    if (clientInfo) {
      navigateToPreview(currentQuote, clientInfo);
    } else {
      toast({
        title: 'Fill client details',
        description: 'Complete the client form, then press Next: Preview on the form.',
        status: 'info',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Box minH="100vh" bg="#F8FAFC" pt={navOffset} pb={{ base: '80px', md: 0 }}>
      <QuoteFlowNav step="client" onNext={handleNextPreview} />

      <Container maxW="100%" py={{ base: 4, md: 6 }} px={{ base: 3, md: 6 }}>
        <ClientInfoForm
          onSubmit={handleClientSubmit}
          onBack={() => history.push('/')}
          initialData={clientInfo}
        />
      </Container>
    </Box>
  );
};

export default QuotePage;

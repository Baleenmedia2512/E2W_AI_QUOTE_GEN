import React from 'react';
import { Box } from '@chakra-ui/react';
import ChatInterface from '../components/ChatInterface/ChatInterface';
import QuoteFlowNav from '../components/QuoteWizard/QuoteFlowNav';
import QuoteStepper from '../components/QuoteWizard/QuoteStepper';
import { useAppStore } from '../store';

const HomePage: React.FC = () => {
  const { currentQuote } = useAppStore();
  const hasQuote = !!currentQuote;

  return (
    <Box minH="100vh" bg="#F8FAFC">
      <QuoteFlowNav step="chat" hasQuote={hasQuote} />

      {hasQuote && (
        <Box pt={{ base: '56px', md: '72px' }}>
          <QuoteStepper currentStep={1} />
        </Box>
      )}

      {/* Main Content */}
      <Box
        mt={hasQuote ? 0 : { base: '56px', md: '72px' }}
        minH={{
          base: hasQuote ? 'calc(100vh - 180px)' : 'calc(100vh - 129px)',
          md: hasQuote ? 'calc(100vh - 160px)' : 'calc(100vh - 105px)',
        }}
        maxH={{
          base: hasQuote ? 'calc(100vh - 180px)' : 'calc(100vh - 129px)',
          md: hasQuote ? 'calc(100vh - 160px)' : 'calc(100vh - 105px)',
        }}
        sx={{
          '@supports (height: 100dvh)': {
            minH: {
              base: hasQuote ? 'calc(100dvh - 180px)' : 'calc(100dvh - 129px)',
              md: hasQuote ? 'calc(100vh - 160px)' : 'calc(100vh - 105px)',
            },
            maxH: {
              base: hasQuote ? 'calc(100dvh - 180px)' : 'calc(100dvh - 129px)',
              md: hasQuote ? 'calc(100vh - 160px)' : 'calc(100vh - 105px)',
            },
          },
        }}
      >
        <Box
          maxW="1400px"
          mx="auto"
          h="100%"
          display="flex"
          flexDirection="column"
          px={{ base: 3, md: 6 }}
          py={{ base: 2, md: 4 }}
        >
          <Box
            flex="1"
            bg="white"
            borderRadius={{ base: '12px', md: '16px' }}
            boxShadow="0 2px 12px rgba(0, 0, 0, 0.08)"
            minH={0}
            display="flex"
            flexDirection="column"
          >
            <ChatInterface />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default HomePage;

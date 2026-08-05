import React from 'react';
import { Box } from '@chakra-ui/react';
import ChatInterface from '../components/ChatInterface/ChatInterface';
import QuoteFlowNav, { getQuoteFlowNavOffset } from '../components/QuoteWizard/QuoteFlowNav';
import { useAppStore } from '../store';

const HomePage: React.FC = () => {
  const { currentQuote } = useAppStore();
  const hasQuote = !!currentQuote;
  const navOffset = getQuoteFlowNavOffset('chat', hasQuote);

  return (
    <Box
      className="qb-home-shell"
      h="100dvh"
      maxH="100dvh"
      w="100%"
      bg="white"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      <QuoteFlowNav step="chat" hasQuote={hasQuote} />

      {/* Full-bleed chat — no side gutters / nested card layer */}
      <Box
        className="qb-home-shell__chat"
        flex="1"
        minH={0}
        w="100%"
        pt={navOffset}
        pb={{ base: 0, md: 0 }}
        display="flex"
        flexDirection="column"
        overflow="hidden"
      >
        <Box
          flex="1"
          minH={0}
          w="100%"
          display="flex"
          flexDirection="column"
          overflow="hidden"
        >
          <ChatInterface />
        </Box>
      </Box>
    </Box>
  );
};

export default HomePage;

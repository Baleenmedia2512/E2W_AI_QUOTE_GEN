import React, { useEffect } from 'react';
import { Box, Spinner, Center } from '@chakra-ui/react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';

/**
 * Legacy /quote client form route — redirects to Preview (client edit lives there now).
 */
const QuotePage: React.FC = () => {
  const history = useHistory();
  const { currentQuote } = useAppStore();

  useEffect(() => {
    if (currentQuote) {
      history.replace('/preview');
    } else {
      history.replace('/');
    }
  }, [currentQuote, history]);

  return (
    <Box minH="100vh" bg="#F8FAFC">
      <Center minH="40vh">
        <Spinner color="brand.500" size="lg" />
      </Center>
    </Box>
  );
};

export default QuotePage;

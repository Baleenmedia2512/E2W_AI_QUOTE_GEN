import React, { useEffect } from 'react';
import { Box, Spinner, Center } from '@chakra-ui/react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';

/**
 * Legacy /quote route — prefer Review when a draft exists, else Preview.
 */
const QuotePage: React.FC = () => {
  const history = useHistory();
  const { currentQuote, reviewDraft } = useAppStore();

  useEffect(() => {
    if (reviewDraft?.items?.length) {
      history.replace('/review');
    } else if (currentQuote) {
      history.replace('/preview');
    } else {
      history.replace('/');
    }
  }, [currentQuote, reviewDraft, history]);

  return (
    <Box minH="100vh" bg="#F8FAFC">
      <Center minH="40vh">
        <Spinner color="brand.500" size="lg" />
      </Center>
    </Box>
  );
};

export default QuotePage;

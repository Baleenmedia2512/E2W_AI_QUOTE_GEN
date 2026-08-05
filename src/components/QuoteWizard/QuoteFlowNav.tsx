import React from 'react';
import {
  Box,
  Container,
  Flex,
  HStack,
  Text,
  Button,
  Icon,
  Badge,
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight, FiDownload, FiFileText } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { UserProfile } from '../UserProfile';

export type QuoteFlowStep = 'chat' | 'client' | 'preview';

interface QuoteFlowNavProps {
  step: QuoteFlowStep;
  /** Show Next on chat only when a quote exists */
  hasQuote?: boolean;
  onNext?: () => void;
  onDownloadPdf?: () => void;
  isDownloading?: boolean;
  canDownload?: boolean;
  rightExtra?: React.ReactNode;
}

/**
 * Labeled Back / Next nav for Chat → Client Info → Preview flow.
 * Replaces Home / Quote / Preview tab links during the quote wizard.
 */
const QuoteFlowNav: React.FC<QuoteFlowNavProps> = ({
  step,
  hasQuote = false,
  onNext,
  onDownloadPdf,
  isDownloading = false,
  canDownload = true,
  rightExtra,
}) => {
  const history = useHistory();

  const handleBack = () => {
    if (step === 'client') {
      history.push('/');
    } else if (step === 'preview') {
      history.push('/quote');
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
      return;
    }
    if (step === 'chat') {
      history.push('/quote');
    } else if (step === 'client') {
      history.push('/preview');
    }
  };

  return (
    <Box
      bg="white"
      borderBottom="1px solid"
      borderColor="gray.100"
      py={{ base: 3, md: 4 }}
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={1001}
      boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
    >
      <Container maxW="1280px" px={{ base: 4, md: 6 }}>
        <Flex justify="space-between" align="center" gap={3} wrap="wrap">
          <HStack spacing={2} flexShrink={0}>
            <Box
              bg="brand.500"
              color="white"
              px={2}
              py={1}
              borderRadius="6px"
              fontWeight="800"
            >
              <Icon as={FiFileText} boxSize={4} />
            </Box>
            <Text
              fontSize={{ base: 'lg', md: 'xl' }}
              fontWeight="800"
              color="brand.500"
              letterSpacing="-0.02em"
            >
              Quote Buddy
            </Text>
            {typeof __APP_VERSION__ !== 'undefined' && (
              <Badge
                colorScheme="brand"
                fontSize="10px"
                fontWeight="600"
                borderRadius="4px"
                px={1.5}
                display={{ base: 'none', sm: 'inline-flex' }}
              >
                v{__APP_VERSION__}
              </Badge>
            )}
          </HStack>

          <HStack spacing={2} flexWrap="wrap" justify="flex-end">
            {step === 'chat' && hasQuote && (
              <Button
                rightIcon={<Icon as={FiArrowRight} />}
                bg="brand.500"
                color="white"
                size="sm"
                borderRadius="12px"
                onClick={handleNext}
                _hover={{ bg: 'brand.600' }}
              >
                Next: Client Info
              </Button>
            )}

            {step === 'client' && (
              <>
                <Button
                  leftIcon={<Icon as={FiArrowLeft} />}
                  variant="outline"
                  size="sm"
                  borderRadius="12px"
                  onClick={handleBack}
                >
                  Back: Chat
                </Button>
                <Button
                  rightIcon={<Icon as={FiArrowRight} />}
                  bg="brand.500"
                  color="white"
                  size="sm"
                  borderRadius="12px"
                  onClick={handleNext}
                  _hover={{ bg: 'brand.600' }}
                >
                  Next: Preview
                </Button>
              </>
            )}

            {step === 'preview' && (
              <>
                <Button
                  leftIcon={<Icon as={FiArrowLeft} />}
                  variant="outline"
                  size="sm"
                  borderRadius="12px"
                  onClick={handleBack}
                >
                  Back: Client Info
                </Button>
                <Button
                  leftIcon={<Icon as={FiDownload} />}
                  bg="brand.500"
                  color="white"
                  size="sm"
                  borderRadius="12px"
                  onClick={onDownloadPdf}
                  isLoading={isDownloading}
                  isDisabled={!canDownload || isDownloading}
                  _hover={{ bg: 'brand.600' }}
                >
                  Download PDF
                </Button>
              </>
            )}

            {rightExtra}
            <UserProfile />
          </HStack>
        </Flex>
      </Container>
    </Box>
  );
};

export default QuoteFlowNav;

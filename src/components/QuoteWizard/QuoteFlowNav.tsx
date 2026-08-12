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
  Image,
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight, FiDownload } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { UserProfile } from '../UserProfile';

export type QuoteFlowStep = 'chat' | 'client' | 'preview';

interface QuoteFlowNavProps {
  step: QuoteFlowStep;
  /** Show Next on chat only when a quote exists */
  hasQuote?: boolean;
  onNext?: () => void;
  /** Single-service: one-click download (full PDF) */
  onDownloadPdf?: () => void;
  /**
   * Multi-service: Summary Only / Detailed Summary.
   * When set with `multiDownloadOptions`, the header shows a dropdown.
   */
  isDownloading?: boolean;
  canDownload?: boolean;
  rightExtra?: React.ReactNode;
}

/** Shared pill size — matches the chat “Preview” header button */
const navPillProps = {
  size: 'sm' as const,
  borderRadius: '10px',
  fontWeight: '600' as const,
  fontSize: { base: 'xs', md: 'sm' } as const,
  px: { base: 2.5, md: 3 } as const,
  h: { base: '32px', md: '34px' } as const,
  minW: 'auto' as const,
  flexShrink: 0,
};

/**
 * Single top header: Logo left | flow actions + profile right (like Preview)
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

  const goHome = () => {
    history.push('/');
  };

  const handleBack = () => {
    if (step === 'client') {
      history.push('/');
    } else if (step === 'preview') {
      history.push('/');
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
      return;
    }
    if (step === 'chat') {
      history.push('/preview');
    } else if (step === 'client') {
      history.push('/preview');
    }
  };

  const showBack = step === 'client' || step === 'preview';
  const showNextClient = step === 'client';
  const showDownload = step === 'preview';

  return (
    <Box
      className="qb-flow-nav"
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={1001}
      bg="white"
      borderBottom="1px solid"
      borderColor="gray.100"
      boxShadow="0 1px 3px rgba(0, 0, 0, 0.06)"
    >
      <Container
        className="qb-flow-nav__inner"
        maxW="100%"
        px={{ base: 3, md: 5 }}
        py={{ base: 2.5, md: 3 }}
      >
        <Flex align="center" gap={{ base: 2, md: 3 }} minH={{ base: '44px', md: '48px' }}>
          {/* Left — brand → Home */}
          <HStack
            as="button"
            type="button"
            spacing={2}
            flex="1"
            minW={0}
            justify="flex-start"
            onClick={goHome}
            cursor="pointer"
            aria-label="Go to Home"
            _hover={{ opacity: 0.85 }}
            bg="transparent"
            border="none"
            p={0}
          >
            <Image
              src="/icons/icon-192x192.png"
              alt="Quote Buddy"
              boxSize={{ base: '28px', md: '34px' }}
              borderRadius="8px"
              objectFit="cover"
              flexShrink={0}
            />
            <Text
              className="qb-flow-nav__brand-text"
              fontSize={{ base: 'sm', md: 'lg' }}
              fontWeight="800"
              color="brand.500"
              letterSpacing="-0.02em"
              noOfLines={1}
            >
              Quote Buddy
            </Text>
            {typeof __APP_VERSION__ !== 'undefined' && (
              <Badge
                colorScheme="brand"
                fontSize="9px"
                fontWeight="600"
                borderRadius="4px"
                px={1.5}
                display={{ base: 'none', md: 'inline-flex' }}
              >
                v{__APP_VERSION__}
              </Badge>
            )}
          </HStack>

          {/* Right — Download (left) / Back Chat (right of download) / Preview + profile */}
          <HStack flexShrink={0} justify="flex-end" spacing={{ base: 1.5, md: 2 }}>
            {rightExtra}

            {showNextClient && (
              <Button
                rightIcon={<Icon as={FiArrowRight} boxSize={3.5} />}
                bg="brand.500"
                color="white"
                onClick={handleNext}
                {...navPillProps}
                _hover={{ bg: 'brand.600' }}
              >
                <Text as="span" display={{ base: 'none', sm: 'inline' }}>
                  Next: Preview
                </Text>
                <Text as="span" display={{ base: 'inline', sm: 'none' }}>
                  Next
                </Text>
              </Button>
            )}

            {showDownload && (
              <Button
                leftIcon={<Icon as={FiDownload} boxSize={3.5} />}
                bg="brand.500"
                color="white"
                onClick={onDownloadPdf}
                isLoading={isDownloading}
                isDisabled={!canDownload || isDownloading}
                aria-label="Download PDF"
                {...navPillProps}
                _hover={{ bg: 'brand.600' }}
              >
                <Text as="span" display={{ base: 'none', sm: 'inline' }}>
                  Download PDF
                </Text>
                <Text as="span" display={{ base: 'inline', sm: 'none' }}>
                  PDF
                </Text>
              </Button>
            )}

            {showBack && (
              <Button
                leftIcon={<Icon as={FiArrowLeft} boxSize={3.5} />}
                variant="outline"
                borderColor="brand.200"
                color="brand.600"
                bg="white"
                onClick={handleBack}
                aria-label="Back to Chat"
                {...navPillProps}
                _hover={{ bg: 'brand.50', borderColor: 'brand.400', color: 'brand.700' }}
                _active={{ bg: 'brand.100' }}
              >
                <Text as="span" display={{ base: 'none', sm: 'inline' }}>
                  Back: Chat
                </Text>
                <Text as="span" display={{ base: 'inline', sm: 'none' }}>
                  Back
                </Text>
              </Button>
            )}

            {step !== 'preview' && (
              <Button
                variant="outline"
                borderColor="brand.200"
                color="brand.600"
                bg="white"
                aria-label="Go to Quote Preview"
                onClick={() => history.push('/preview')}
                {...navPillProps}
                _hover={{ bg: 'brand.50', borderColor: 'brand.400', color: 'brand.700' }}
                _active={{ bg: 'brand.100' }}
              >
                Preview
              </Button>
            )}
            <UserProfile />
          </HStack>
        </Flex>
      </Container>
    </Box>
  );
};

/** Fixed header height for page padding (single row). */
export function getQuoteFlowNavOffset(
  _step?: QuoteFlowStep,
  _hasQuote = false
): { base: string; md: string } {
  return {
    base: 'calc(60px + env(safe-area-inset-top, 0px))',
    md: '64px',
  };
}

export default QuoteFlowNav;

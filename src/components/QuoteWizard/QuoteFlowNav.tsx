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
  VStack,
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight, FiDownload } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { UserProfile } from '../UserProfile';
import { useAppStore } from '../../store';
import './QuoteFlowNav.css';

export type QuoteFlowStep = 'chat' | 'review' | 'client' | 'preview';

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
  isSendingMail?: boolean;
  canDownload?: boolean;
  rightExtra?: React.ReactNode;
}

/** Shared pill size — matches the chat “Preview” header button */
const navPillProps = {
  size: 'sm' as const,
  borderRadius: '10px',
  fontWeight: '600' as const,
  fontSize: { base: 'xs', md: 'sm' } as const,
  px: { base: 2, md: 3 } as const,
  h: { base: '40px', md: '34px' } as const,
  minH: { base: '40px', md: '34px' } as const,
  minW: { base: '40px', md: 'auto' } as const,
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
  isSendingMail = false,
  canDownload = true,
  rightExtra,
}) => {
  const history = useHistory();
  const closeChatProfile = useAppStore((state) => state.closeChatProfile);
  const chatProfileOpen = useAppStore((state) => state.chatProfileOpen);
  const companyInfo = useAppStore((state) => state.companyInfo);
  const reviewDraft = useAppStore((state) => state.reviewDraft);
  const setReviewDraft = useAppStore((state) => state.setReviewDraft);
  const currentQuote = useAppStore((state) => state.currentQuote);

  /** Preview → Review when draft or quote exists (rebuild draft after refresh). */
  const canBackToReview =
    Boolean(reviewDraft?.items?.length) || Boolean(currentQuote?.items?.length);

  const goHome = () => {
    closeChatProfile();
    history.push('/');
  };

  const ensureReviewDraftThenGo = () => {
    if (reviewDraft?.items?.length) {
      history.push('/review');
      return;
    }
    if (currentQuote?.items?.length) {
      // Session draft is not persisted — rebuild from quote so Back stays on Review.
      void import('../../utils/quoteReviewDraft').then(({ quoteToReviewDraft }) => {
        setReviewDraft(quoteToReviewDraft(currentQuote, 'ai'));
        history.push('/review');
      });
      return;
    }
    history.push('/');
  };

  const handleBack = () => {
    if (step === 'review') {
      history.push('/');
    } else if (step === 'client') {
      history.push('/');
    } else if (step === 'preview') {
      ensureReviewDraftThenGo();
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
      return;
    }
    if (step === 'chat') {
      if (reviewDraft?.items?.length) {
        history.push('/review');
      } else {
        history.push('/preview');
      }
    } else if (step === 'review') {
      history.push('/preview');
    } else if (step === 'client') {
      history.push('/preview');
    }
  };

  const showBack = step === 'review' || step === 'client' || step === 'preview';
  const showNextClient = step === 'client';
  const showDownload = step === 'preview';
  const previewDisabled = step === 'review' && !currentQuote;

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
        py={{ base: 1.5, md: 2 }}
      >
        <Flex
          className="qb-flow-nav__row"
          align="center"
          justify="space-between"
          gap={{ base: 2, md: 3 }}
          minH={{ base: '48px', md: '44px' }}
          w="100%"
          minW={0}
        >
          {/* Left — brand → Home */}
          <HStack
            as="button"
            type="button"
            spacing={{ base: 1.5, md: 2 }}
            flexShrink={0}
            minW={0}
            maxW={{ base: '42%', sm: '48%', md: 'none' }}
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
              boxSize={{ base: '32px', md: '34px' }}
              borderRadius="8px"
              objectFit="cover"
              flexShrink={0}
            />
            <VStack spacing={0} align="flex-start" justify="center" maxW={{ base: '100%', md: '230px' }} minW={0}>
              <HStack spacing={1.5} w="100%" align="center" minW={0}>
                <Text
                  className="qb-flow-nav__brand-text"
                  fontSize={{ base: 'sm', md: 'lg' }}
                  fontWeight="800"
                  color="brand.500"
                  letterSpacing="-0.02em"
                  noOfLines={1}
                  display={{ base: 'none', sm: 'block' }}
                >
                  Quote Buddy
                </Text>
                {step === 'preview' && currentQuote?.quoteNumber ? (
                  <Badge
                    className="qb-flow-nav__quote-badge"
                    colorScheme="gray"
                    fontSize="10px"
                    fontWeight="700"
                    borderRadius="6px"
                    px={1.5}
                    title="Quote number"
                    flexShrink={1}
                    minW={0}
                  >
                    {currentQuote.quoteNumber}
                  </Badge>
                ) : null}
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
              {companyInfo?.name && (
                <Text
                  className="qb-flow-nav__company"
                  fontSize={{ base: 'xs', md: 'sm' }}
                  lineHeight="12px"
                  fontWeight="600"
                  color="gray.600"
                  textAlign="left"
                  noOfLines={1}
                  maxW={{ base: '100%', md: '230px' }}
                  title={companyInfo.name}
                  display={{ base: 'none', md: 'block' }}
                >
                  {companyInfo.name}
                </Text>
              )}
            </VStack>
          </HStack>

          {/* Right — Download / Back / Preview + profile (pinned to trailing edge) */}
          <HStack
            className="qb-flow-nav__actions"
            flex="1"
            flexShrink={0}
            justify="flex-end"
            spacing={{ base: 1.5, md: 2 }}
            minW={0}
            ml="auto"
          >
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
                leftIcon={<Icon as={FiDownload} boxSize={4} />}
                bg="brand.500"
                color="white"
                onClick={onDownloadPdf}
                isLoading={isDownloading}
                isDisabled={!canDownload || isDownloading || isSendingMail}
                aria-label="Download PDF"
                {...navPillProps}
                px={{ base: 2.5, md: 3 }}
                minW={{ base: 'auto', md: 'auto' }}
                _hover={{ bg: 'brand.600' }}
              >
                <Text as="span" display={{ base: 'inline', md: 'none' }}>
                  PDF
                </Text>
                <Text as="span" display={{ base: 'none', md: 'inline' }}>
                  Download PDF
                </Text>
              </Button>
            )}

            {showBack && (
              <Button
                leftIcon={<Icon as={FiArrowLeft} boxSize={4} />}
                variant="outline"
                borderColor="brand.200"
                color="brand.600"
                bg="white"
                onClick={handleBack}
                aria-label={
                  step === 'preview' && canBackToReview ? 'Back to Review' : 'Back to Chat'
                }
                {...navPillProps}
                px={{ base: 2.5, md: 3 }}
                minW={{ base: 'auto', md: 'auto' }}
                _hover={{ bg: 'brand.50', borderColor: 'brand.400', color: 'brand.700' }}
                _active={{ bg: 'brand.100' }}
              >
                <Text as="span" display={{ base: 'inline', md: 'none' }}>
                  Back
                </Text>
                <Text as="span" display={{ base: 'none', md: 'inline' }}>
                  {step === 'preview' && canBackToReview ? 'Back: Review' : 'Back: Chat'}
                </Text>
              </Button>
            )}

            {step !== 'preview' && !chatProfileOpen && (
              <Button
                variant="outline"
                borderColor="brand.200"
                color="brand.600"
                bg="white"
                aria-label="Go to Quote Preview"
                isDisabled={previewDisabled}
                onClick={() => history.push('/preview')}
                {...navPillProps}
                _hover={{ bg: 'brand.50', borderColor: 'brand.400', color: 'brand.700' }}
                _active={{ bg: 'brand.100' }}
                display={{ base: 'none', sm: 'inline-flex' }}
              >
                Preview
              </Button>
            )}
            <UserProfile compact />
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

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
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react';
import { FiArrowLeft, FiArrowRight, FiChevronDown, FiDownload, FiFileText, FiLayers } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { UserProfile } from '../UserProfile';
import type { PdfExportMode } from '../Templates/CorporateMinimalPDF';

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
  onDownloadPdfMode?: (mode: PdfExportMode) => void;
  /** Show Summary Only + Detailed Summary instead of a single Download button */
  multiDownloadOptions?: boolean;
  isDownloading?: boolean;
  canDownload?: boolean;
  rightExtra?: React.ReactNode;
}

/**
 * Single top header: Logo left | Back/Next/Download centered | Profile right
 */
const QuoteFlowNav: React.FC<QuoteFlowNavProps> = ({
  step,
  hasQuote = false,
  onNext,
  onDownloadPdf,
  onDownloadPdfMode,
  multiDownloadOptions = false,
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

  const showBack = step === 'client' || step === 'preview';
  const showNextClient = step === 'client';
  const showDownload = step === 'preview';
  const showCenterActions = showBack || showNextClient || showDownload;

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

          {/* Center — flow actions */}
          <HStack
            spacing={2}
            flexShrink={0}
            justify="center"
            display={showCenterActions ? 'flex' : 'none'}
            maxW={{ base: '52%', sm: 'none' }}
            flexWrap="wrap"
          >
            {showBack && (
              <Button
                leftIcon={<Icon as={FiArrowLeft} />}
                variant="outline"
                size="sm"
                borderRadius="10px"
                borderColor="brand.200"
                color="brand.600"
                bg="white"
                onClick={handleBack}
                px={{ base: 2, md: 3 }}
                fontSize={{ base: 'xs', md: 'sm' }}
                _hover={{ bg: 'brand.50', borderColor: 'brand.400' }}
              >
                <Text as="span" display={{ base: 'none', sm: 'inline' }}>
                  {step === 'client' ? 'Back: Chat' : 'Back: Client Info'}
                </Text>
                <Text as="span" display={{ base: 'inline', sm: 'none' }}>
                  Back
                </Text>
              </Button>
            )}

            {showNextClient && (
              <Button
                rightIcon={<Icon as={FiArrowRight} />}
                bg="brand.500"
                color="white"
                size="sm"
                borderRadius="10px"
                onClick={handleNext}
                px={{ base: 3, md: 4 }}
                fontSize={{ base: 'xs', md: 'sm' }}
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

            {showDownload && multiDownloadOptions && onDownloadPdfMode && (
              <Menu placement="bottom-end" isLazy>
                <MenuButton
                  as={Button}
                  leftIcon={<Icon as={FiDownload} />}
                  rightIcon={<Icon as={FiChevronDown} boxSize={3.5} />}
                  bg="brand.500"
                  color="white"
                  size="sm"
                  borderRadius="10px"
                  isLoading={isDownloading}
                  isDisabled={!canDownload || isDownloading}
                  px={{ base: 2, md: 4 }}
                  fontSize={{ base: 'xs', md: 'sm' }}
                  _hover={{ bg: 'brand.600' }}
                  _active={{ bg: 'brand.600' }}
                >
                  <Text as="span" display={{ base: 'none', sm: 'inline' }}>
                    Download PDF
                  </Text>
                  <Text as="span" display={{ base: 'inline', sm: 'none' }}>
                    PDF
                  </Text>
                </MenuButton>
                <MenuList
                  minW="220px"
                  py={1}
                  borderRadius="10px"
                  boxShadow="0 8px 24px rgba(0,0,0,0.12)"
                  zIndex={1100}
                >
                  <MenuItem
                    icon={<Icon as={FiFileText} boxSize={4} color="brand.500" />}
                    fontSize="sm"
                    fontWeight="500"
                    py={2.5}
                    onClick={() => onDownloadPdfMode('summary')}
                    isDisabled={!canDownload || isDownloading}
                  >
                    Summary Only
                  </MenuItem>
                  <MenuItem
                    icon={<Icon as={FiLayers} boxSize={4} color="brand.500" />}
                    fontSize="sm"
                    fontWeight="500"
                    py={2.5}
                    onClick={() => onDownloadPdfMode('detailed')}
                    isDisabled={!canDownload || isDownloading}
                  >
                    Detailed Summary
                  </MenuItem>
                </MenuList>
              </Menu>
            )}

            {showDownload && !(multiDownloadOptions && onDownloadPdfMode) && (
              <Button
                leftIcon={<Icon as={FiDownload} />}
                bg="brand.500"
                color="white"
                size="sm"
                borderRadius="10px"
                onClick={onDownloadPdf}
                isLoading={isDownloading}
                isDisabled={!canDownload || isDownloading}
                px={{ base: 2, md: 4 }}
                fontSize={{ base: 'xs', md: 'sm' }}
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
          </HStack>

          {/* Right — profile */}
          <HStack flex="1" minW={0} justify="flex-end" spacing={2}>
            {rightExtra}
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

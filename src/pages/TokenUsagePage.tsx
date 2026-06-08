import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Card,
  CardHeader,
  CardBody,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatGroup,
  Badge,
  Divider,
  Button,
  useColorModeValue,
  Flex,
  Tooltip,
} from '@chakra-ui/react';
import { 
  ArrowBackIcon, 
  InfoIcon
} from '@chakra-ui/icons';
import { useHistory } from 'react-router-dom';
import {
  getSessionSummary,
  resetSession
} from '../services/tokenMonitorService';
import { SessionSummary } from '../types/token';

export const TokenUsagePage: React.FC = () => {
  const history = useHistory();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  
  const bgCard = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  // Load initial data
  useEffect(() => {
    refreshData();
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refreshData();
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const refreshData = () => {
    const data = getSessionSummary();
    setSummary(data);
  };

  const handleClearSession = () => {
    if (window.confirm('Are you sure you want to clear all token usage data? This cannot be undone.')) {
      resetSession();
      refreshData();
    }
  };

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(4)}`;
  };

  const formatCurrencyINR = (amount: number): string => {
    const inr = amount * 83.5; // 1 USD = ₹83.5 (approximate)
    return `₹${inr.toFixed(2)}`;
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (!summary) {
    return (
      <Container maxW="container.xl" py={8}>
        <Text>Loading token usage data...</Text>
      </Container>
    );
  }

  const hasData = summary.records.length > 0;
  const totalOperations = summary.operations.totalOperations;
  const totalCost = summary.cost.total;
  const totalTokens = summary.tokens.grandTotal;

  return (
    <Box minH="calc(100vh - 120px)" bg={useColorModeValue('gray.50', 'gray.900')} py={{ base: 4, md: 8 }} pb={{ base: 24, md: 8 }}>
      <Container maxW="container.xl" px={{ base: 3, md: 4 }}>
        <VStack spacing={{ base: 4, md: 6 }} align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="center">
            <Button
              leftIcon={<ArrowBackIcon />}
              variant="ghost"
              size={{ base: 'sm', md: 'md' }}
              onClick={() => history.goBack()}
            >
              Back
            </Button>
            <Heading size={{ base: 'md', md: 'lg' }} flex="1" textAlign="center" isTruncated>
              AI Token Usage
            </Heading>
            <Button
              colorScheme="red"
              variant="outline"
              size={{ base: 'sm', md: 'md' }}
              onClick={handleClearSession}
              isDisabled={!hasData}
            >
              Clear
            </Button>
          </HStack>

          {!hasData && (
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack py={8} spacing={4}>
                  <Text fontSize="3xl">📊</Text>
                  <Text fontSize="lg" color="gray.600">
                    No token usage data yet
                  </Text>
                  <Text fontSize="sm" color="gray.500">
                    Start using the app to see token consumption metrics
                  </Text>
                </VStack>
              </CardBody>
            </Card>
          )}

          {hasData && (
            <>
              {/* Session Overview */}
              <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
                <CardHeader pb={{ base: 2, md: 4 }}>
                  <Heading size={{ base: 'sm', md: 'md' }}>Session Overview</Heading>
                </CardHeader>
                <CardBody pt={{ base: 2, md: 4 }}>
                  <Flex direction={{ base: 'column', md: 'row' }} gap={{ base: 4, md: 4 }} flexWrap="wrap">
                    {/* Total Operations Card */}
                    {/* <Box
                      flex="1"
                      minW={{ base: 'full', md: '200px' }}
                      p={4}
                      borderWidth="1px"
                      borderColor={borderColor}
                      borderRadius="md"
                      bg={useColorModeValue('blue.50', 'blue.900')}
                    >
                      <VStack align="start" spacing={1}>
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600" fontWeight="medium">
                          Total Operations
                        </Text>
                        <Text fontSize={{ base: '2xl', md: '3xl' }} fontWeight="bold" color="blue.600">
                          {totalOperations}
                        </Text>
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600">
                          Duration: {formatDuration(summary.durationMinutes)}
                        </Text>
                      </VStack>
                    </Box> */}

                    {/* Input Tokens Card */}
                    <Box
                      flex="1"
                      minW={{ base: 'full', md: '200px' }}
                      p={4}
                      borderWidth="1px"
                      borderColor={borderColor}
                      borderRadius="md"
                      bg={useColorModeValue('purple.50', 'purple.900')}
                    >
                      <VStack align="start" spacing={1}>
                        <HStack>
                          <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600" fontWeight="medium">
                            Input Tokens
                          </Text>
                          <Tooltip label="Tokens sent to AI (context + prompts)">
                            <InfoIcon boxSize={3} color="gray.500" />
                          </Tooltip>
                        </HStack>
                        <Text fontSize={{ base: '2xl', md: '3xl' }} fontWeight="bold" color="purple.600">
                          {formatNumber(summary.tokens.totalInput)}
                        </Text>
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600">
                          $0.075 per 1M tokens
                        </Text>
                      </VStack>
                    </Box>

                    {/* Output Tokens Card */}
                    <Box
                      flex="1"
                      minW={{ base: 'full', md: '200px' }}
                      p={4}
                      borderWidth="1px"
                      borderColor={borderColor}
                      borderRadius="md"
                      bg={useColorModeValue('orange.50', 'orange.900')}
                    >
                      <VStack align="start" spacing={1}>
                        <HStack>
                          <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600" fontWeight="medium">
                            Output Tokens
                          </Text>
                          <Tooltip label="Tokens generated by AI (responses)">
                            <InfoIcon boxSize={3} color="gray.500" />
                          </Tooltip>
                        </HStack>
                        <Text fontSize={{ base: '2xl', md: '3xl' }} fontWeight="bold" color="orange.600">
                          {formatNumber(summary.tokens.totalOutput)}
                        </Text>
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600">
                          $0.30 per 1M tokens
                        </Text>
                      </VStack>
                    </Box>

                    {/* Total Cost Card */}
                    <Box
                      flex="1"
                      minW={{ base: 'full', md: '200px' }}
                      p={4}
                      borderWidth="1px"
                      borderColor={borderColor}
                      borderRadius="md"
                      bg={useColorModeValue('green.50', 'green.900')}
                    >
                      <VStack align="start" spacing={1}>
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600" fontWeight="medium">
                          Total Cost
                        </Text>
                        <Text fontSize={{ base: '2xl', md: '3xl' }} fontWeight="bold" color="green.600">
                          {formatCurrency(totalCost)}
                        </Text>
                        <HStack spacing={1}>
                          <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600">
                            {formatCurrencyINR(totalCost)}
                          </Text>
                          <Badge colorScheme="green" fontSize="xs">INR</Badge>
                        </HStack>
                        <Text fontSize={{ base: '2xs', md: 'xs' }} color="gray.500">
                          Gemini 2.5 Flash
                        </Text>
                      </VStack>
                    </Box>
                  </Flex>

                  {/* Total Tokens Summary */}
                  <Box mt={4} pt={4} borderTopWidth="1px" borderColor={borderColor}>
                    <HStack justify="space-between">
                      <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="medium">
                        Grand Total Tokens
                      </Text>
                      <Text fontSize={{ base: 'lg', md: 'xl' }} fontWeight="bold" color="blue.600">
                        {formatNumber(totalTokens)}
                      </Text>
                    </HStack>
                  </Box>
                </CardBody>
              </Card>

              {/* PDF Upload Cards - One card per PDF */}
              {summary.cards?.pdfUpload?.uploads.map((upload, index) => (
                <Card key={index} bg={bgCard} borderColor={borderColor} borderWidth="1px">
                  <CardHeader pb={{ base: 2, md: 4 }}>
                    <VStack align="stretch" spacing={1}>
                      <HStack>
                        <Text fontSize={{ base: 'xl', md: '2xl' }}>📄</Text>
                        <Heading size={{ base: 'sm', md: 'md' }}>PDF Upload #{upload.uploadNumber}</Heading>
                      </HStack>
                      <Text fontSize="xs" color="gray.600" fontWeight="medium" isTruncated>
                        {upload.fileName}
                      </Text>
                    </VStack>
                  </CardHeader>
                  <CardBody pt={{ base: 2, md: 4 }}>
                    <VStack spacing={4} align="stretch">
                      {/* Service Extraction */}
                      <Box>
                        <Text fontSize="xs" fontWeight="medium" mb={1}>Service Extraction:</Text>
                        <StatGroup>
                          <Stat>
                            <StatLabel fontSize="xs">Input</StatLabel>
                            <StatNumber fontSize="sm">{formatNumber(upload.initialUpload.inputTokens)}</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Output</StatLabel>
                            <StatNumber fontSize="sm">{formatNumber(upload.initialUpload.outputTokens)}</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Time</StatLabel>
                            <StatNumber fontSize="sm">{upload.initialUpload.timeSeconds.toFixed(1)}s</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Cost</StatLabel>
                            <StatNumber fontSize="sm">{formatCurrency(upload.initialUpload.cost)}</StatNumber>
                            <StatHelpText fontSize="2xs">{formatCurrencyINR(upload.initialUpload.cost)}</StatHelpText>
                          </Stat>
                        </StatGroup>
                      </Box>

                      {/* Image Detection */}
                      <Box>
                        <HStack mb={1}>
                          <Text fontSize="xs" fontWeight="medium">
                            Image Detection:
                          </Text>
                          {upload.imageDetection.pagesProcessed === 0 ? (
                            <Badge colorScheme="green" fontSize="2xs">Native (FREE)</Badge>
                          ) : (
                            <Badge colorScheme="orange" fontSize="2xs">Gemini Vision ({upload.imageDetection.pagesProcessed} pages)</Badge>
                          )}
                        </HStack>
                        <StatGroup>
                          <Stat>
                            <StatLabel fontSize="xs">Input</StatLabel>
                            <StatNumber fontSize="sm">{formatNumber(upload.imageDetection.inputTokens)}</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Output</StatLabel>
                            <StatNumber fontSize="sm">{formatNumber(upload.imageDetection.outputTokens)}</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Time</StatLabel>
                            <StatNumber fontSize="sm">{upload.imageDetection.timeSeconds.toFixed(1)}s</StatNumber>
                          </Stat>
                          <Stat>
                            <StatLabel fontSize="xs">Cost</StatLabel>
                            <StatNumber fontSize="sm">{formatCurrency(upload.imageDetection.cost)}</StatNumber>
                            <StatHelpText fontSize="2xs">{formatCurrencyINR(upload.imageDetection.cost)}</StatHelpText>
                          </Stat>
                        </StatGroup>
                      </Box>

                      {/* Registry Build (Auto-Load) */}
                      {upload.registryBuild.operationsCount > 0 && (
                        <Box>
                          <HStack mb={1}>
                            <Text fontSize="xs" fontWeight="medium">
                              Registry Build (Auto-Load):
                            </Text>
                            <Badge colorScheme="purple" fontSize="2xs">
                              {upload.registryBuild.operationsCount} operations
                            </Badge>
                          </HStack>
                          <StatGroup>
                            <Stat>
                              <StatLabel fontSize="xs">Input</StatLabel>
                              <StatNumber fontSize="sm">{formatNumber(upload.registryBuild.inputTokens)}</StatNumber>
                            </Stat>
                            <Stat>
                              <StatLabel fontSize="xs">Output</StatLabel>
                              <StatNumber fontSize="sm">{formatNumber(upload.registryBuild.outputTokens)}</StatNumber>
                            </Stat>
                            <Stat>
                              <StatLabel fontSize="xs">Time</StatLabel>
                              <StatNumber fontSize="sm">{upload.registryBuild.timeSeconds.toFixed(1)}s</StatNumber>
                            </Stat>
                            <Stat>
                              <StatLabel fontSize="xs">Cost</StatLabel>
                              <StatNumber fontSize="sm">{formatCurrency(upload.registryBuild.cost)}</StatNumber>
                              <StatHelpText fontSize="2xs">{formatCurrencyINR(upload.registryBuild.cost)}</StatHelpText>
                            </Stat>
                          </StatGroup>
                        </Box>
                      )}

                      <Divider />

                      {/* PDF Total */}
                      <Box bg={useColorModeValue('green.50', 'green.900')} p={3} borderRadius="md">
                        <HStack justify="space-between">
                          <Text fontSize="sm" fontWeight="bold">📊 PDF Total:</Text>
                          <VStack align="end" spacing={0}>
                            <Text fontSize="md" fontWeight="bold">{formatNumber(upload.uploadTotal)} tokens</Text>
                            <Text fontSize="sm" fontWeight="bold" color="green.600">{formatCurrency(upload.uploadCost)}</Text>
                            <Text fontSize="xs" color="gray.600">{formatCurrencyINR(upload.uploadCost)}</Text>
                          </VStack>
                        </HStack>
                      </Box>
                    </VStack>
                  </CardBody>
                </Card>
              ))}

              {/* Card 2: Chat Operations */}
              {summary.cards?.chatOperations && (
                <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
                  <CardHeader pb={{ base: 2, md: 3 }}>
                    <HStack spacing={2}>
                      <Text fontSize={{ base: 'xl', md: '2xl' }}>💬</Text>
                      <Heading size={{ base: 'sm', md: 'md' }}>All Chat Operations</Heading>
                    </HStack>
                  </CardHeader>
                  <CardBody pt={{ base: 2, md: 3 }}>
                    <VStack spacing={{ base: 2, md: 3 }} align="stretch">
                      <Text fontSize={{ base: 'sm', md: 'md' }} color="gray.600" fontWeight="medium">
                        Total: <Text as="span" fontWeight="bold">{summary.cards.chatOperations.totalOperations}</Text> messages
                      </Text>

                      {/* Total Summary */}
                      <Box bg={useColorModeValue('purple.50', 'purple.900')} p={{ base: 2, md: 3 }} borderRadius="md">
                        <VStack spacing={{ base: 1, md: 2 }} align="stretch">
                          <HStack justify="space-between">
                            <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="bold">📊 Total Tokens:</Text>
                            <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="bold">
                              {formatNumber(summary.cards.chatOperations.totalInput + summary.cards.chatOperations.totalOutput)}
                            </Text>
                          </HStack>
                          <HStack justify="space-between">
                            <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="bold">Total Cost:</Text>
                            <VStack align="end" spacing={0}>
                              <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="bold" color="purple.600">
                                {formatCurrency(summary.cards.chatOperations.totalCost)}
                              </Text>
                              <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600">{formatCurrencyINR(summary.cards.chatOperations.totalCost)}</Text>
                            </VStack>
                          </HStack>
                        </VStack>
                      </Box>

                      <Divider />

                      {summary.cards.chatOperations.operations.slice().reverse().map((operation, index, arr) => (
                        <Box key={index} p={{ base: 2, md: 3 }} bg={useColorModeValue('gray.50', 'gray.700')} borderRadius="md">
                          <VStack align="stretch" spacing={{ base: 1, md: 2 }}>
                            {/* Header */}
                            <HStack justify="space-between" flexWrap="wrap">
                              <HStack spacing={1}>
                                <Text fontSize={{ base: 'sm', md: 'md' }}>
                                  {operation.type === 'quote_generation' ? '⚡' : '💬'}
                                </Text>
                                <Text fontSize={{ base: 'xs', md: 'sm' }} fontWeight="bold">
                                  Operation {operation.operationNumber}
                                </Text>
                              </HStack>
                              <Badge colorScheme={operation.type === 'quote_generation' ? 'orange' : 'blue'} fontSize="xs">
                                {operation.type === 'quote_generation' ? 'Quote Gen' : 'Chat'}
                              </Badge>
                            </HStack>

                            {/* Message */}
                            <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.700" noOfLines={2} fontWeight="medium">
                              {operation.userMessage}
                            </Text>

                            {/* Timestamp */}
                            <Text fontSize="2xs" color="gray.500">
                              {new Date(operation.timestamp).toLocaleTimeString()}
                            </Text>

                            {/* Stats */}
                            <StatGroup flexWrap="wrap" gap={{ base: 1, md: 0 }}>
                              <Stat minW={{ base: '45%', md: 'auto' }}>
                                <StatLabel fontSize="2xs">Input</StatLabel>
                                <StatNumber fontSize={{ base: 'sm', md: 'md' }}>{formatNumber(operation.inputTokens)}</StatNumber>
                              </Stat>
                              <Stat minW={{ base: '45%', md: 'auto' }}>
                                <StatLabel fontSize="2xs">Output</StatLabel>
                                <StatNumber fontSize={{ base: 'sm', md: 'md' }}>{formatNumber(operation.outputTokens)}</StatNumber>
                              </Stat>
                              <Stat minW={{ base: '45%', md: 'auto' }}>
                                <StatLabel fontSize="2xs">Time</StatLabel>
                                <StatNumber fontSize={{ base: 'sm', md: 'md' }}>{operation.timeSeconds.toFixed(1)}s</StatNumber>
                              </Stat>
                              <Stat minW={{ base: '45%', md: 'auto' }}>
                                <StatLabel fontSize="2xs">Cost</StatLabel>
                                <StatNumber fontSize={{ base: 'sm', md: 'md' }}>{formatCurrency(operation.cost)}</StatNumber>
                                <StatHelpText fontSize="2xs">{formatCurrencyINR(operation.cost)}</StatHelpText>
                              </Stat>
                            </StatGroup>
                          </VStack>
                        </Box>
                      ))}
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </VStack>
      </Container>
    </Box>
  );
};

export default TokenUsagePage;

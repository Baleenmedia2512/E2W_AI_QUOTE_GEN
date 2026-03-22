import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  HStack,
  VStack,
  Heading,
  Input,
  Textarea,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
  Text,
  Checkbox,
  Flex,
  NumberInput,
  NumberInputField,
  Editable,
  EditableInput,
  EditablePreview,
  Icon,
  Card,
  CardBody,
  useBreakpointValue,
} from '@chakra-ui/react';
import { FiSave, FiPlus, FiTrash2, FiEdit3 } from 'react-icons/fi';
import { Quote, QuoteItem, LineItem } from '../../types/quote';
import './QuotePreview.css';

interface QuotePreviewProps {
  quote: Quote | null;
  onUpdate: (quote: Quote) => void;
  onSave?: () => void;
}

const QuotePreview: React.FC<QuotePreviewProps> = ({ quote, onUpdate, onSave }) => {
  const [localQuote, setLocalQuote] = useState<Quote | null>(quote);
  const isMobile = useBreakpointValue({ base: true, md: false });

  useEffect(() => {
    setLocalQuote(quote);
  }, [quote]);

  if (!localQuote) {
    return (
      <Card className="quote-preview-empty">
        <CardBody>
          <p className="empty-message">No quote generated yet. Start a chat to create one.</p>
        </CardBody>
      </Card>
    );
  }

  const calculateLineItemTotal = (item: LineItem): number => {
    return item.quantity * item.unitPrice;
  };

  const calculateItemSubtotal = (item: QuoteItem): number => {
    // Handle new structure (direct properties)
    if (item.total !== undefined) {
      return item.total;
    }
    // Handle old structure (with lineItems)
    return item.lineItems?.reduce((sum, lineItem) => sum + calculateLineItemTotal(lineItem), 0) || 0;
  };

  // Helper to get line items for rendering - handles both old and new structure
  const getLineItemsForDisplay = (item: QuoteItem): LineItem[] => {
    // If item has lineItems array (old structure), use it
    if (item.lineItems && item.lineItems.length > 0) {
      return item.lineItems;
    }
    // Otherwise, treat the item itself as a single line item (new structure)
    return [{
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.rate,
      total: item.total
    }];
  };

  const calculateQuoteSubtotal = (): number => {
    return localQuote.items.reduce((sum, item) => sum + calculateItemSubtotal(item), 0);
  };

  const calculateGST = (subtotal: number): number => {
    return localQuote.gstEnabled ? subtotal * (localQuote.gstPercentage / 100) : 0;
  };

  const calculateTotal = (subtotal: number, gst: number): number => {
    return subtotal + gst;
  };

  const updateLineItem = (itemIndex: number, lineItemIndex: number, field: keyof LineItem, value: any) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    
    // Handle old structure with lineItems array
    if (item.lineItems && item.lineItems.length > 0) {
      const lineItem = item.lineItems[lineItemIndex];
      (lineItem as any)[field] = value;
      lineItem.total = calculateLineItemTotal(lineItem);
      
      if (item.subtotal !== undefined) {
        item.subtotal = calculateItemSubtotal(item);
      }
    } else {
      // Handle new structure - update item directly
      if (field === 'description') {
        item.description = value;
      } else if (field === 'quantity') {
        item.quantity = value;
        item.total = value * item.rate;
      } else if (field === 'unitPrice') {
        item.rate = value;
        item.total = item.quantity * value;
      }
    }
    
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateItem = (itemIndex: number, field: keyof QuoteItem, value: any) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    (updatedQuote.items[itemIndex] as any)[field] = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const addLineItem = (itemIndex: number) => {
    if (!localQuote) return;

    const newLineItem: LineItem = {
      id: Date.now().toString(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      total: 0,
    };

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    if (!item.lineItems) {
      item.lineItems = [];
    }
    item.lineItems.push(newLineItem);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const removeLineItem = (itemIndex: number, lineItemIndex: number) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    if (!item.lineItems) return;
    
    item.lineItems.splice(lineItemIndex, 1);
    if (item.subtotal !== undefined) {
      item.subtotal = calculateItemSubtotal(item);
    }
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const addQuoteItem = () => {
    if (!localQuote) return;

    const newItem: QuoteItem = {
      id: Date.now().toString(),
      description: 'New Item',
      quantity: 1,
      rate: 0,
      total: 0,
      // Legacy fields for backward compatibility
      title: 'New Section',
      lineItems: [],
      subtotal: 0,
    };

    const updatedQuote = { ...localQuote };
    updatedQuote.items.push(newItem);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const removeQuoteItem = (itemIndex: number) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.items.splice(itemIndex, 1);
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const toggleGST = () => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.gstEnabled = !updatedQuote.gstEnabled;
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateDeliveryTimeline = (value: string) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.deliveryTimeline = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateTermsAndConditions = (value: string) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.termsAndConditions = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const subtotal = calculateQuoteSubtotal();
  const gst = calculateGST(subtotal);
  const total = calculateTotal(subtotal, gst);

  const formatCurrency = (amount: number) => amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Box className="quote-preview" py={{ base: 4, md: 8 }}>
      {/* Header with Title and Save Button */}
      <Flex justify="space-between" align="center" mb={{ base: 4, md: 8 }} flexWrap="wrap" gap={3}>
        <Heading 
          size={{ base: 'md', md: 'lg' }}
          fontWeight="500" 
          color="gray.900" 
          fontFamily="'DM Sans', sans-serif"
        >
          Quote Preview
        </Heading>
        {onSave && (
          <Button
            leftIcon={<Icon as={FiSave} />}
            variant="outline"
            borderColor="gray.300"
            color="gray.700"
            fontWeight="500"
            onClick={onSave}
            size={{ base: 'sm', md: 'md' }}
            _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
          >
            Save Quote
          </Button>
        )}
      </Flex>

      {/* Quote Items - Each Section in a Card */}
      <VStack spacing={6} align="stretch">
        {localQuote.items.map((item, itemIndex) => (
          <Card 
            key={item.id}
            bg="white"
            borderRadius="12px"
            border="1px solid"
            borderColor="gray.200"
            boxShadow="sm"
          >
            <CardBody p={{ base: 3, md: 6 }}>
              {/* Section Header with Editable Title and Delete Button */}
              <Flex justify="space-between" align="center" mb={4}>
                <Editable
                  defaultValue={item.title || item.description || 'Auto Full Branding'}
                  fontSize="lg"
                  fontWeight="600"
                  color="gray.900"
                  width="full"
                  onChange={(value) => updateItem(itemIndex, 'title', value)}
                >
                  <EditablePreview
                    px={2}
                    py={1}
                    _hover={{ bg: 'gray.50' }}
                    cursor="text"
                  />
                  <EditableInput px={2} py={1} />
                </Editable>
                <IconButton
                  aria-label="Delete section"
                  icon={<Icon as={FiTrash2} />}
                  variant="ghost"
                  colorScheme="red"
                  size="sm"
                  onClick={() => removeQuoteItem(itemIndex)}
                />
              </Flex>

              {/* Line Items */}
              <Box mb={4}>
                {isMobile ? (
                  /* Mobile: Card-based layout */
                  <VStack spacing={3} align="stretch">
                    {getLineItemsForDisplay(item).map((lineItem, lineItemIndex) => (
                      <Box
                        key={lineItem.id}
                        bg="gray.50"
                        border="1px solid"
                        borderColor="gray.200"
                        borderRadius="10px"
                        p={3}
                      >
                        {/* Description label + Delete button in one row */}
                        <Flex justify="space-between" align="center" mb={1}>
                          <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px">
                            Description
                          </Text>
                          {item.lineItems && item.lineItems.length > 0 && (
                            <IconButton
                              aria-label="Delete line item"
                              icon={<Icon as={FiTrash2} />}
                              variant="ghost"
                              colorScheme="red"
                              size="xs"
                              onClick={() => removeLineItem(itemIndex, lineItemIndex)}
                            />
                          )}
                        </Flex>
                        {/* Description input full width - Textarea so long text is visible */}
                        <Box mb={3}>
                          <Textarea
                            value={lineItem.description || ''}
                            onChange={(e) =>
                              updateLineItem(itemIndex, lineItemIndex, 'description', e.target.value)
                            }
                            placeholder="Enter description"
                            size="sm"
                            bg="white"
                            borderColor="gray.200"
                            borderRadius="6px"
                            rows={2}
                            resize="none"
                            _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                          />
                        </Box>

                        {/* Quantity & Rate side by side */}
                        <Flex gap={3} mb={3}>
                          <Box flex={1}>
                            <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1}>
                              Quantity
                            </Text>
                            <NumberInput
                              value={lineItem.quantity}
                              onChange={(_, value) =>
                                updateLineItem(itemIndex, lineItemIndex, 'quantity', value)
                              }
                              min={0}
                              size="sm"
                            >
                              <NumberInputField
                                textAlign="right"
                                bg="white"
                                borderColor="gray.200"
                                borderRadius="6px"
                                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                              />
                            </NumberInput>
                          </Box>
                          <Box flex={1}>
                            <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1}>
                              Rate
                            </Text>
                            <NumberInput
                              value={lineItem.unitPrice}
                              onChange={(_, value) =>
                                updateLineItem(itemIndex, lineItemIndex, 'unitPrice', value)
                              }
                              min={0}
                              precision={2}
                              size="sm"
                            >
                              <NumberInputField
                                textAlign="right"
                                bg="white"
                                borderColor="gray.200"
                                borderRadius="6px"
                                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                              />
                            </NumberInput>
                          </Box>
                        </Flex>

                        {/* Amount */}
                        <Flex
                          justify="flex-end"
                          align="center"
                          pt={2}
                          borderTop="1px dashed"
                          borderColor="gray.200"
                        >
                          <Text fontSize="12px" fontWeight="600" color="gray.500" mr={2}>Amount:</Text>
                          <Text fontSize="15px" fontWeight="700" color="gray.800">
                            {formatCurrency(calculateLineItemTotal(lineItem))}
                          </Text>
                        </Flex>
                      </Box>
                    ))}
                  </VStack>
                ) : (
                  /* Desktop: Table layout */
                  <Box overflowX="auto">
                    <Table variant="simple" size="sm">
                      <Thead>
                        <Tr bg="gray.50">
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" width="40%">
                            Item Description
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="15%">
                            Quantity
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="20%">
                            Rate
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="20%">
                            Amount
                          </Th>
                          <Th width="5%"></Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {getLineItemsForDisplay(item).map((lineItem, lineItemIndex) => (
                          <Tr key={lineItem.id} _hover={{ bg: 'gray.50' }}>
                            <Td verticalAlign="top">
                              <Textarea
                                value={lineItem.description || ''}
                                onChange={(e) =>
                                  updateLineItem(itemIndex, lineItemIndex, 'description', e.target.value)
                                }
                                placeholder="Enter description"
                                size="sm"
                                minH="40px"
                                rows={2}
                                resize="vertical"
                                bg="transparent"
                                border="1px solid transparent"
                                borderRadius="6px"
                                _hover={{ bg: 'gray.50', borderColor: 'gray.200' }}
                                _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                                px={2}
                                py={2}
                              />
                            </Td>
                            <Td isNumeric>
                              <NumberInput
                                value={lineItem.quantity}
                                onChange={(_, value) =>
                                  updateLineItem(itemIndex, lineItemIndex, 'quantity', value)
                                }
                                min={0}
                                size="sm"
                              >
                                <NumberInputField
                                  textAlign="right"
                                  _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926' }}
                                  px={2}
                                />
                              </NumberInput>
                            </Td>
                            <Td isNumeric>
                              <NumberInput
                                value={lineItem.unitPrice}
                                onChange={(_, value) =>
                                  updateLineItem(itemIndex, lineItemIndex, 'unitPrice', value)
                                }
                                min={0}
                                precision={2}
                                size="sm"
                              >
                                <NumberInputField
                                  textAlign="right"
                                  _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926' }}
                                  px={2}
                                />
                              </NumberInput>
                            </Td>
                            <Td isNumeric fontWeight="500">
                              {formatCurrency(calculateLineItemTotal(lineItem))}
                            </Td>
                            <Td>
                              {item.lineItems && item.lineItems.length > 0 && (
                                <IconButton
                                  aria-label="Delete line item"
                                  icon={<Icon as={FiTrash2} />}
                                  variant="ghost"
                                  colorScheme="red"
                                  size="xs"
                                  onClick={() => removeLineItem(itemIndex, lineItemIndex)}
                                />
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </Box>

              {/* Add Line Item Button */}
              <Button
                leftIcon={<Icon as={FiPlus} />}
                variant="outline"
                size="sm"
                borderColor="gray.300"
                color="gray.700"
                onClick={() => addLineItem(itemIndex)}
                _hover={{ bg: 'gray.50' }}
                mb={4}
              >
                Add Line Item
              </Button>

              {/* Section Subtotal */}
              <Flex justify="flex-end" pt={2} borderTop="1px solid" borderColor="gray.200">
                <Text fontSize="sm" fontWeight="600" color="gray.700">
                  Section Subtotal: <Text as="span" ml={4}>{formatCurrency(calculateItemSubtotal(item))}</Text>
                </Text>
              </Flex>
            </CardBody>
          </Card>
        ))}

        {/* Add Section Button */}
        <Button
          leftIcon={<Icon as={FiPlus} />}
          variant="outline"
          borderColor="gray.300"
          color="gray.700"
          onClick={addQuoteItem}
          _hover={{ bg: 'gray.50' }}
        >
          Add Section
        </Button>
      </VStack>

      {/* Totals Summary Block */}
      <Box mt={{ base: 4, md: 8 }} p={{ base: 4, md: 6 }} bg="gray.100" borderRadius="12px">
        <VStack spacing={4} align="stretch">
          {/* Subtotal */}
          <Flex justify="space-between" fontSize="md">
            <Text fontWeight="500" color="gray.700">Subtotal:</Text>
            <Text fontWeight="600" color="gray.900">{formatCurrency(subtotal)}</Text>
          </Flex>

          {/* GST Section */}
          <Box bg="white" p={4} borderRadius="8px">
            <VStack spacing={3} align="stretch">
              <HStack>
                <Checkbox
                  isChecked={localQuote.gstEnabled}
                  onChange={toggleGST}
                  colorScheme="blue"
                >
                  <Text fontSize="sm" fontWeight="500">Include GST</Text>
                </Checkbox>
              </HStack>

              {localQuote.gstEnabled && (
                <HStack flexWrap="wrap" gap={2}>
                  <Text fontSize="sm" fontWeight="500">GST Percentage (%):</Text>
                  <NumberInput
                    value={localQuote.gstPercentage}
                    onChange={(_, value) => {
                      if (!localQuote) return;
                      const updatedQuote = { ...localQuote };
                      updatedQuote.gstPercentage = value;
                      updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
                      updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
                      updatedQuote.updatedAt = new Date();
                      setLocalQuote(updatedQuote);
                      onUpdate(updatedQuote);
                    }}
                    min={0}
                    max={100}
                    precision={2}
                    size="sm"
                    maxW="120px"
                    defaultValue={18}
                  >
                    <NumberInputField />
                  </NumberInput>
                </HStack>
              )}
            </VStack>
          </Box>

          {/* GST Amount */}
          {localQuote.gstEnabled && (
            <Flex justify="space-between" fontSize="md">
              <Text fontWeight="500" color="gray.700">GST ({localQuote.gstPercentage}%):</Text>
              <Text fontWeight="600" color="gray.900">{formatCurrency(gst)}</Text>
            </Flex>
          )}

          {/* Total */}
          <Flex 
            justify="space-between" 
            pt={3} 
            borderTop="2px solid" 
            borderColor="gray.300"
            fontSize="xl"
          >
            <Text fontWeight="700" color="gray.900">Total:</Text>
            <Text fontWeight="700" color="gray.900">{formatCurrency(total)}</Text>
          </Flex>
        </VStack>
      </Box>

      {/* Delivery Timeline */}
      <Box mt={{ base: 4, md: 8 }}>
        <Text fontSize="sm" fontWeight="600" color="gray.700" mb={2}>
          Delivery Timeline
        </Text>
        <Input
          value={localQuote.deliveryTimeline || ''}
          onChange={(e) => updateDeliveryTimeline(e.target.value)}
          placeholder="e.g., 7 working days from receipt"
          size="lg"
          bg="white"
          borderColor="gray.300"
          _hover={{ borderColor: 'gray.400' }}
          _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
        />
      </Box>

      {/* Terms and Conditions */}
      <Box mt={6}>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="600" color="gray.700">
            Terms and Conditions
          </Text>
          <Icon as={FiEdit3} color="gray.500" boxSize={4} />
        </HStack>
        <Textarea
          value={localQuote.termsAndConditions || ''}
          onChange={(e) => updateTermsAndConditions(e.target.value)}
          placeholder="Enter terms and conditions..."
          rows={6}
          size="lg"
          bg="white"
          borderColor="gray.300"
          _hover={{ borderColor: 'gray.400' }}
          _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
        />
      </Box>
    </Box>
  );
};

export default QuotePreview;

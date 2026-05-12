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
import { FiTrash2, FiEdit3 } from 'react-icons/fi';
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

  // Auto-resize all textareas when content changes
  useEffect(() => {
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach((textarea) => {
      if (textarea.value) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      }
    });
  }, [localQuote?.termsAndConditions, localQuote?.items]);

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
    return item.quantity * item.unitPrice * (item.duration || 1);
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
      duration: item.duration,
      total: item.total,
      remark: item.remark
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
      if (field !== 'remark') {
        lineItem.total = calculateLineItemTotal(lineItem);
      }
      // Sync remark to parent item so templates can read it
      if (field === 'remark') {
        item.remark = value;
      }
      if (item.subtotal !== undefined) {
        item.subtotal = calculateItemSubtotal(item);
      }
    } else {
      // Handle new structure - update item directly
      if (field === 'description') {
        item.description = value;
      } else if (field === 'quantity') {
        item.quantity = value;
        item.total = value * item.rate * (item.duration || 1);
      } else if (field === 'unitPrice') {
        item.rate = value;
        item.total = item.quantity * value * (item.duration || 1);
      } else if (field === 'duration') {
        item.duration = value;
        item.total = item.quantity * item.rate * (value || 1);
      } else if (field === 'remark') {
        item.remark = value;
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

  const _addLineItem = (itemIndex: number) => {
    if (!localQuote) return;

    const newLineItem: LineItem = {
      id: Date.now().toString(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      duration: undefined,
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

  const updateItemTerms = (itemIndex: number, value: string) => {
    if (!localQuote) return;
    const updatedQuote = { ...localQuote };
    updatedQuote.items = updatedQuote.items.map((item, i) =>
      i === itemIndex ? { ...item, termsAndConditions: value } : item
    );
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
      <HStack justify="space-between" flexWrap="wrap" gap={3} mb={8}>
        <Box>
          <Heading 
            size="xl"
            fontWeight="800" 
            bgGradient="linear(135deg, #C91F3D, #B31B3E, #7A1030)" 
            bgClip="text"
            letterSpacing="tight"
            mb={1}
          >
            Quote Preview
          </Heading>
          <Text fontSize="sm" color="gray.600" fontWeight="500">
            Review and customize your quote
          </Text>
        </Box>
        {false && onSave && (
          <Button
            size="md"
            variant="outline"
            borderColor="red.300"
            color="red.600"
            fontWeight="600"
            onClick={onSave}
            borderRadius="12px"
            px={6}
            _hover={{ 
              bg: 'red.50',
              borderColor: 'red.400',
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 12px rgba(201, 31, 61, 0.2)'
            }}
          >
            Save Info
          </Button>
        )}
      </HStack>

      {/* Quote Items - Each Section in a Card */}
      <VStack spacing={6} align="stretch">
        {localQuote.items.map((item, itemIndex) => (
          <Card 
            key={item.id}
            bg="white"
            borderRadius="16px"
            border="2px solid"
            borderColor="gray.200"
            boxShadow="0 4px 16px rgba(0, 0, 0, 0.06)"
            transition="all 0.3s"
            _hover={{
              boxShadow: '0 8px 24px rgba(201, 31, 61, 0.12)',
              borderColor: 'red.200'
            }}
          >
            <CardBody p={{ base: 3, md: 6 }}>
              {/* Section Header with Editable Title and Delete Button */}
              <Flex justify="space-between" align="center" mb={5}>
                <Editable
                  defaultValue={item.title || item.description || 'Auto Full Branding'}
                  fontSize="lg"
                  fontWeight="700"
                  color="gray.900"
                  width="full"
                  onChange={(value) => updateItem(itemIndex, 'title', value)}
                >
                  <EditablePreview
                    px={3}
                    py={2}
                    borderRadius="8px"
                    _hover={{ bg: 'red.50', color: 'red.600' }}
                    cursor="text"
                  />
                  <EditableInput 
                    px={3} 
                    py={2}
                    borderRadius="8px"
                    _focus={{ 
                      borderColor: 'red.500',
                      boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)'
                    }}
                  />
                </Editable>
                <IconButton
                  aria-label="Delete section"
                  icon={<Icon as={FiTrash2} />}
                  variant="ghost"
                  colorScheme="red"
                  size="sm"
                  borderRadius="8px"
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
                            onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                            placeholder="Enter description"
                            size="sm"
                            bg="white"
                            borderWidth="2px"
                            borderColor="gray.200"
                            borderRadius="8px"
                            rows={2}
                            resize="none"
                            fontWeight="500"
                            _hover={{ borderColor: 'red.300' }}
                            _focus={{ 
                              borderColor: 'red.500', 
                              boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)'
                            }}
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
                                inputMode="numeric"
                                pattern="[0-9]*"
                                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
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
                                inputMode="decimal"
                                pattern="[0-9.]*"
                                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                              />
                            </NumberInput>
                          </Box>
                          {lineItem.duration && lineItem.duration > 1 && (
                            <Box flex={1}>
                              <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1}>
                                Months
                              </Text>
                              <NumberInput
                                value={lineItem.duration}
                                onChange={(_, value) =>
                                  updateLineItem(itemIndex, lineItemIndex, 'duration' as keyof LineItem, value)
                                }
                                min={1}
                                size="sm"
                              >
                                <NumberInputField
                                  textAlign="right"
                                  bg="white"
                                  borderColor="gray.200"
                                  borderRadius="6px"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                                  _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                                />
                              </NumberInput>
                            </Box>
                          )}
                        </Flex>

                        {/* Remark */}
                        <Box mt={2}>
                          <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1}>
                            Remark (Optional)
                          </Text>
                          <Input
                            value={lineItem.remark || ''}
                            onChange={(e) =>
                              updateLineItem(itemIndex, lineItemIndex, 'remark' as keyof LineItem, e.target.value)
                            }
                            onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                            placeholder="e.g. Per cab/month, One time fee..."
                            size="sm"
                            bg="white"
                            borderColor="gray.200"
                            borderRadius="6px"
                            _hover={{ borderColor: 'red.300' }}
                            _focus={{ borderColor: 'red.500', boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)' }}
                          />
                        </Box>

                        {/* Amount */}
                        <Flex
                          justify="flex-end"
                          align="center"
                          pt={2}
                          mt={2}
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
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" width={getLineItemsForDisplay(item).some(li => li.duration && li.duration > 1) ? "35%" : "40%"}>
                            Item Description
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="12%">
                            Quantity
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="15%">
                            Rate
                          </Th>
                          {getLineItemsForDisplay(item).some(li => li.duration && li.duration > 1) && (
                            <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="12%">
                              Months
                            </Th>
                          )}
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="18%">
                            Amount
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" width="18%">
                            Remark
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
                                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
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
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
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
                                  inputMode="decimal"
                                  pattern="[0-9.]*"
                                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                                  _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926' }}
                                  px={2}
                                />
                              </NumberInput>
                            </Td>
                            {getLineItemsForDisplay(item).some(li => li.duration && li.duration > 1) && (
                              <Td isNumeric>
                                <NumberInput
                                  value={lineItem.duration || 1}
                                  onChange={(_, value) =>
                                    updateLineItem(itemIndex, lineItemIndex, 'duration' as keyof LineItem, value)
                                  }
                                  min={1}
                                  size="sm"
                                >
                                  <NumberInputField
                                    textAlign="right"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                                    _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926' }}
                                    px={2}
                                  />
                                </NumberInput>
                              </Td>
                            )}
                            <Td isNumeric fontWeight="500">
                              {formatCurrency(calculateLineItemTotal(lineItem))}
                            </Td>
                            <Td verticalAlign="top">
                              <Input
                                value={lineItem.remark || ''}
                                onChange={(e) =>
                                  updateLineItem(itemIndex, lineItemIndex, 'remark' as keyof LineItem, e.target.value)
                                }
                                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                                placeholder="Optional"
                                size="sm"
                                bg="transparent"
                                border="1px solid transparent"
                                borderRadius="6px"
                                _hover={{ bg: 'gray.50', borderColor: 'gray.200' }}
                                _focus={{ bg: 'white', border: '1px solid', borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                                px={2}
                              />
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

              {/* Add Line Item Button - hidden */}

              {/* Section Subtotal - hidden */}
            </CardBody>
          </Card>
        ))}

        {/* Add Section Button */}
        <Button
          variant="outline"
          borderWidth="2px"
          borderColor="red.300"
          color="red.600"
          fontWeight="600"
          size="md"
          px={8}
          borderRadius="12px"
          onClick={addQuoteItem}
          _hover={{ 
            bg: 'red.50',
            borderColor: 'red.400',
            transform: 'translateY(-2px)',
            boxShadow: '0 4px 12px rgba(201, 31, 61, 0.2)'
          }}
          _active={{ transform: 'scale(0.98)' }}
        >
          ➕ Add Section
        </Button>
      </VStack>

      {/* Totals Summary Block */}
      <Box 
        mt={{ base: 6, md: 8 }} 
        p={{ base: 5, md: 6 }} 
        bgGradient="linear(135deg, #FFF5F7, #FFECF0)"
        borderRadius="16px"
        border="2px solid"
        borderColor="red.200"
        boxShadow="0 4px 16px rgba(201, 31, 61, 0.1)"
      >
        <VStack spacing={4} align="stretch">
          {/* Subtotal */}
          <Flex justify="space-between" fontSize="lg">
            <Text fontWeight="600" color="gray.800">Subtotal:</Text>
            <Text fontWeight="700" color="gray.900">{formatCurrency(subtotal)}</Text>
          </Flex>

          {/* GST Section */}
          <Box bg="white" p={4} borderRadius="12px" border="2px solid" borderColor="gray.200">
            <VStack spacing={3} align="stretch">
              <HStack>
                <Checkbox
                  isChecked={localQuote.gstEnabled}
                  onChange={toggleGST}
                  colorScheme="red"
                  size="md"
                >
                  <Text fontSize="md" fontWeight="600" color="gray.800">Include GST</Text>
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
                    <NumberInputField inputMode="decimal" pattern="[0-9.]*" onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }} />
                  </NumberInput>
                </HStack>
              )}
            </VStack>
          </Box>

          {/* GST Amount */}
          {localQuote.gstEnabled && (
            <Flex justify="space-between" fontSize="lg">
              <Text fontWeight="600" color="gray.800">GST ({localQuote.gstPercentage}%):</Text>
              <Text fontWeight="700" color="gray.900">{formatCurrency(gst)}</Text>
            </Flex>
          )}

          {/* Total */}
          <Flex 
            justify="space-between" 
            pt={4} 
            borderTop="3px solid" 
            borderColor="red.400"
            fontSize="2xl"
          >
            <Text fontWeight="800" color="gray.900">Total:</Text>
            <Text fontWeight="800" color="red.600">{formatCurrency(total)}</Text>
          </Flex>
        </VStack>
      </Box>

      {/* Delivery Timeline - Only show if specified */}
      {localQuote.deliveryTimeline && 
       !localQuote.deliveryTimeline.toLowerCase().includes('not specified') && (
        <Box mt={{ base: 6, md: 8 }}>
          <Text fontSize="md" fontWeight="700" color="gray.800" mb={3}>
            📅 Delivery Timeline
          </Text>
          <Input
            value={localQuote.deliveryTimeline || ''}
            onChange={(e) => updateDeliveryTimeline(e.target.value)}
            onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
            placeholder="e.g., 7 working days from receipt"
            size="lg"
            bg="white"
            borderWidth="2px"
            borderColor="gray.300"
            borderRadius="12px"
            fontWeight="500"
            _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
            _focus={{ 
              borderColor: 'red.500', 
              boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
              bg: 'white'
            }}
          />
        </Box>
      )}

      {/* Terms and Conditions */}
      <Box mt={6}>
        <HStack justify="space-between" mb={3}>
          <Text fontSize="md" fontWeight="700" color="gray.800">
            📋 Terms and Conditions
          </Text>
          <Icon as={FiEdit3} color="red.500" boxSize={5} />
        </HStack>
        <Textarea
          value={localQuote.termsAndConditions || ''}
          onChange={(e) => {
            updateTermsAndConditions(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          placeholder="Enter terms and conditions..."
          minH="120px"
          size="lg"
          bg="white"
          borderWidth="2px"
          borderColor="gray.300"
          borderRadius="12px"
          fontWeight="500"
          resize="vertical"
          overflow="hidden"
          onFocus={(e) => {
            const t = e.target;
            setTimeout(() => t.select(), 300);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          sx={{
            field: {
              overflow: 'hidden !important',
            }
          }}
          _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
          _focus={{ 
            borderColor: 'red.500', 
            boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
            bg: 'white'
          }}
        />
      </Box>

      {/* Per-item terms — only shown for multi-service quotes */}
      {localQuote.items.map((item, idx) =>
        item.termsAndConditions ? (
          <Box mt={6} key={item.id}>
            <HStack justify="space-between" mb={3}>
              <Text fontSize="md" fontWeight="700" color="gray.800">
                📝 {item.title || item.description.split(' - ')[0]} — Terms & Conditions
              </Text>
              <Icon as={FiEdit3} color="red.500" boxSize={5} />
            </HStack>
            <Textarea
              value={item.termsAndConditions}
              onChange={(e) => {
                updateItemTerms(idx, e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              placeholder="Enter service-specific terms..."
              minH="120px"
              size="lg"
              bg="white"
              borderWidth="2px"
              borderColor="gray.300"
              borderRadius="12px"
              fontWeight="500"
              resize="vertical"
              overflow="hidden"
              onFocus={(e) => {
                const t = e.target;
                setTimeout(() => t.select(), 300);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              sx={{
                field: {
                  overflow: 'hidden !important',
                }
              }}
              _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
              _focus={{ 
                borderColor: 'red.500', 
                boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                bg: 'white'
              }}
            />
          </Box>
        ) : null
      )}
    </Box>
  );
};

export default QuotePreview;

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
  useToast,
} from '@chakra-ui/react';
import { FiTrash2, FiEdit3 } from 'react-icons/fi';
import { Quote, QuoteItem, LineItem } from '../../types/quote';
import {
  computeQuoteItemTotal,
  normalizeDurationToDays,
  quoteHasAnyDuration,
} from '../../utils/durationUtils';
import {
  getVendorEditFloors,
  rateFieldForLineDescription,
  resolveDbServiceForQuoteItem,
  validateQuoteEdit,
} from '../../utils/quoteEditValidation';
import { getVendorRatesCache, loadVendorRatesFromCloud } from '../../services/vendorRateService';
import { formatUnitRateInr, parseRateInput, roundRate2 } from '../../utils/rateDisplay';
import './QuotePreview.css';

interface QuotePreviewProps {
  quote: Quote | null;
  onUpdate: (quote: Quote) => void;
  onSave?: () => void;
}

/** Display / store rates with max 2 decimal places (e.g. 56.67 not 56.666666). */
function roundRate(n: number): number {
  return roundRate2(n);
}

function formatRateDisplay(n: number): string {
  return formatUnitRateInr(n);
}

/** Convert months → days on a quote item (mutates) so edit UI is always day-based. */
function ensureQuoteItemDays(item: QuoteItem): void {
  if (item.lineItems && item.lineItems.length > 0) {
    item.lineItems = item.lineItems.map((li) => {
      const wasMonths = li.durationUnit === 'months';
      const n = normalizeDurationToDays(li);
      if (wasMonths && n.duration) {
        n.unitPrice = roundRate(n.unitPrice);
        n.total = computeQuoteItemTotal({
          quantity: n.quantity,
          unitPrice: n.unitPrice,
          duration: n.duration,
          durationUnit: n.durationUnit,
          description: n.description,
        });
      }
      return n;
    });
    return;
  }
  const wasMonths = item.durationUnit === 'months';
  const n = normalizeDurationToDays(item);
  if (wasMonths && n.duration) {
    item.rate = roundRate(n.rate ?? item.rate);
    item.duration = n.duration;
    item.durationUnit = 'days';
    item.durationLabel = 'day';
    item.total = computeQuoteItemTotal(item);
  }
}

const QuotePreview: React.FC<QuotePreviewProps> = ({ quote, onUpdate, onSave }) => {
  const [localQuote, setLocalQuote] = useState<Quote | null>(quote);
  const [rateInputValues, setRateInputValues] = useState<Record<string, string>>({});
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const isMobile = useBreakpointValue({ base: true, md: false });
  const toast = useToast();

  useEffect(() => {
    setLocalQuote(quote);
  }, [quote]);

  const showFloorToast = (message: string) => {
    toast({
      title: message.includes('margin') ? 'Below margin' : 'Below minimum',
      description: message,
      status: 'warning',
      duration: 4000,
      isClosable: true,
      position: 'top',
    });
  };

  /** Validate qty / duration / rate against vendor floors before applying. */
  const assertVendorFloor = async (
    item: QuoteItem,
    field: 'quantity' | 'duration' | 'unitPrice',
    value: number,
    lineDescription?: string,
  ): Promise<boolean> => {
    let svc = resolveDbServiceForQuoteItem(item);
    if (!svc && getVendorRatesCache().length === 0) {
      try {
        await loadVendorRatesFromCloud();
      } catch {
        /* allow edit if catalog unavailable */
      }
      svc = resolveDbServiceForQuoteItem(item);
    }
    if (!svc) return true; // no catalog row → allow edit
    const floors = getVendorEditFloors(svc);
    const desc = lineDescription || item.description || '';

    const groupItems = localQuote?.items.filter((i) => {
      const a = (i.serviceId || i.serviceName || '').trim().toLowerCase();
      const b = (item.serviceId || item.serviceName || '').trim().toLowerCase();
      if (a && b) return a === b;
      return i.id === item.id;
    }) || [item];

    const displayItem = groupItems.find(
      (i) => rateFieldForLineDescription(i.description) === 'displayRate',
    );
    const pfItem = groupItems.find(
      (i) => rateFieldForLineDescription(i.description) === 'pfRate',
    );
    const durationDays =
      displayItem?.duration && displayItem.duration > 0
        ? displayItem.duration
        : item.duration && item.duration > 0
          ? item.duration
          : 0;
    const packageContext = {
      quantity: item.quantity,
      durationDays,
      displayDailyRate: displayItem?.rate || 0,
      pfUnitRate: pfItem?.rate || 0,
    };

    if (field === 'quantity') {
      const result = validateQuoteEdit({
        field: 'quantity',
        value,
        floors,
        packageContext: { ...packageContext, quantity: value },
      });
      if (!result.ok) {
        showFloorToast(result.message || 'Invalid quantity');
        return false;
      }
      return true;
    }

    if (field === 'duration') {
      if (rateFieldForLineDescription(desc) === 'pfRate') return true;
      const result = validateQuoteEdit({
        field: 'duration',
        value,
        floors,
        packageContext: { ...packageContext, durationDays: value },
      });
      if (!result.ok) {
        showFloorToast(result.message || 'Invalid duration');
        return false;
      }
      return true;
    }

    // unitPrice / rate
    const rateField = rateFieldForLineDescription(desc);
    const result = validateQuoteEdit({
      field: rateField,
      value,
      floors,
      rateUiMode: 'per_day',
      packageContext:
        rateField === 'displayRate'
          ? { ...packageContext, displayDailyRate: value }
          : { ...packageContext, pfUnitRate: value },
    });
    if (!result.ok) {
      showFloorToast(result.message || 'Invalid rate');
      return false;
    }
    return true;
  };

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

  const showDurationColumn = quoteHasAnyDuration(localQuote.items);

  const calculateLineItemTotal = (item: LineItem & { durationIsAuto?: boolean }): number => {
    return computeQuoteItemTotal({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      duration: item.duration,
      durationUnit: item.durationUnit,
      description: item.description,
    });
  };

  const calculateItemSubtotal = (item: QuoteItem): number => {
    // Prefer live recompute so month-display rounding matches the formula
    if (item.lineItems && item.lineItems.length > 0) {
      return item.lineItems.reduce((sum, lineItem) => sum + calculateLineItemTotal(lineItem), 0);
    }
    return computeQuoteItemTotal(item);
  };

  // Helper to get line items for rendering - handles both old and new structure
  const getLineItemsForDisplay = (item: QuoteItem): LineItem[] => {
    const cleanDesc = (d?: string) =>
      (d || '').replace(/\s*\([^)]*\)\s*$/g, '').trim();
    const cleanQtyUnit = (u?: string) =>
      u ? String(u).replace(/^per\s+/i, '').trim() : u;

    // If item has lineItems array (old structure), use it
    if (item.lineItems && item.lineItems.length > 0) {
      return item.lineItems.map((li) => {
        const n = normalizeDurationToDays({
          ...li,
          description: cleanDesc(li.description),
          quantityUnit: cleanQtyUnit(li.quantityUnit),
        });
        return {
          ...n,
          unitPrice: roundRate(n.unitPrice),
          durationLabel: n.duration ? 'day' : n.durationLabel,
        };
      });
    }
    // Otherwise, treat the item itself as a single line item (new structure)
    const n = normalizeDurationToDays({
      id: item.id,
      description: cleanDesc(item.description),
      quantity: item.quantity,
      quantityUnit: cleanQtyUnit(item.quantityUnit),
      unitPrice: item.rate,
      duration: item.duration,
      durationUnit: item.durationUnit,
      durationLabel: item.durationLabel,
      durationIsAuto: item.durationIsAuto,
      total: item.total,
      remark: item.remark,
    });
    return [{
      ...n,
      unitPrice: roundRate(n.unitPrice),
      durationLabel: n.duration ? 'day' : n.durationLabel,
    }];
  };

  const ratePeriodLabel = (lineItem: LineItem): string => {
    // Always day-based when campaign duration is present (1 month = 30 days)
    if (lineItem.duration != null && lineItem.duration > 0) return 'per day';
    // One-time lines (Printing & Fixing, etc.): "per Auto" / "per bus"
    const qty = (lineItem.quantityUnit || '').trim().replace(/^per\s+/i, '');
    return qty ? `per ${qty}` : '';
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

  const updateLineItem = async (itemIndex: number, lineItemIndex: number, field: keyof LineItem, value: any) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    ensureQuoteItemDays(item);

    // Vendor floor checks (qty / duration / rate) — no floors stored on quote
    if (field === 'quantity' || field === 'duration' || field === 'unitPrice') {
      const lineDesc =
        item.lineItems && item.lineItems[lineItemIndex]
          ? item.lineItems[lineItemIndex].description
          : item.description;
      if (!(await assertVendorFloor(item, field, Number(value), lineDesc))) {
        return;
      }
    }
    
    // Handle old structure with lineItems array
    if (item.lineItems && item.lineItems.length > 0) {
      const lineItem = item.lineItems[lineItemIndex];
      if (field === 'duration') {
        (lineItem as LineItem & { durationIsAuto?: boolean }).durationIsAuto =
          value && value > 0 ? false : undefined;
        if (value && value > 0) {
          lineItem.duration = value;
          lineItem.durationUnit = 'days';
          lineItem.durationLabel = 'day';
        } else {
          lineItem.duration = 0;
          lineItem.durationIsAuto = undefined;
        }
      } else {
        (lineItem as any)[field] = field === 'unitPrice' ? roundRate(value) : value;
        if (field === 'durationLabel' && lineItem.duration) {
          lineItem.durationLabel = 'day';
          lineItem.durationUnit = 'days';
        }
      }
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
        item.total = computeQuoteItemTotal(item);
      } else if (field === 'unitPrice') {
        item.rate = roundRate(value);
        item.total = computeQuoteItemTotal(item);
      } else if (field === 'duration') {
        if (value && value > 0) {
          item.duration = value;
          item.durationUnit = 'days';
          item.durationLabel = 'day';
          item.durationIsAuto = false;
        } else {
          // Keep duration as 0 so the input stays visible; clear unit/auto flags
          item.duration = 0;
          item.durationIsAuto = undefined;
          item.durationUnit = undefined;
          item.durationLabel = undefined;
        }
        item.total = computeQuoteItemTotal(item);
      } else if (field === 'remark') {
        item.remark = value;
      } else if (field === 'quantityUnit') {
        item.quantityUnit = value;
      } else if (field === 'durationLabel') {
        item.durationLabel = 'day';
        if (item.duration) item.durationUnit = 'days';
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
                              value={qtyDrafts[lineItem.id] ?? String(lineItem.quantity)}
                              onChange={(valueString) =>
                                setQtyDrafts((prev) => ({ ...prev, [lineItem.id]: valueString }))
                              }
                              onBlur={() => {
                                const raw = qtyDrafts[lineItem.id];
                                const n = raw != null && raw !== '' ? parseFloat(raw) : lineItem.quantity;
                                if (Number.isFinite(n)) {
                                  updateLineItem(itemIndex, lineItemIndex, 'quantity', n);
                                }
                                setQtyDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[lineItem.id];
                                  return next;
                                });
                              }}
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
                            <Input
                              value={lineItem.quantityUnit || ''}
                              onChange={(e) => updateLineItem(itemIndex, lineItemIndex, 'quantityUnit' as keyof LineItem, e.target.value)}
                              placeholder="unit label"
                              size="xs"
                              mt="5px"
                              textAlign="center"
                              bg="#f4f6f8"
                              border="1px dashed"
                              borderColor="gray.300"
                              borderRadius="4px"
                              h="22px"
                              fontSize="11px"
                              color="gray.600"
                              fontWeight="500"
                              _placeholder={{ color: 'gray.400' }}
                              _hover={{ bg: 'white', borderColor: 'red.400', borderStyle: 'solid' }}
                              _focus={{ bg: 'white', borderColor: 'red.500', borderStyle: 'solid', boxShadow: '0 0 0 3px rgba(201,31,61,0.15)' }}
                            />
                          </Box>
                          <Box flex={1}>
                            <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1}>
                              Rate
                            </Text>
                            <NumberInput
                              value={rateInputValues[lineItem.id] ?? formatRateDisplay(lineItem.unitPrice)}
                              onChange={(valueString) => {
                                setRateInputValues((prev) => ({ ...prev, [lineItem.id]: valueString }));
                              }}
                              onBlur={() => {
                                const raw = rateInputValues[lineItem.id];
                                const n =
                                  raw != null && raw !== ''
                                    ? parseRateInput(raw)
                                    : lineItem.unitPrice;
                                if (Number.isFinite(n)) {
                                  updateLineItem(itemIndex, lineItemIndex, 'unitPrice', roundRate(n));
                                }
                                setRateInputValues((prev) => {
                                  const next = { ...prev };
                                  delete next[lineItem.id];
                                  return next;
                                });
                              }}
                              min={0}
                              step={0.01}
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
                            {ratePeriodLabel(lineItem) && (
                              <Input
                                value={ratePeriodLabel(lineItem)}
                                readOnly
                                size="xs"
                                mt="5px"
                                textAlign="center"
                                bg="#f4f6f8"
                                border="1px dashed"
                                borderColor="gray.300"
                                borderRadius="4px"
                                h="22px"
                                fontSize="11px"
                                color="gray.600"
                                fontWeight="500"
                                cursor="default"
                                tabIndex={-1}
                              />
                            )}
                          </Box>
                          {showDurationColumn && (
                          <Box flex={1}>
                            <Text fontSize="11px" fontWeight="600" color="gray.500" textTransform="uppercase" letterSpacing="0.5px" mb={1} title="Campaign duration in days (1 month = 30 days)">
                              Duration
                            </Text>
                            <NumberInput
                              value={durationDrafts[lineItem.id] ?? (lineItem.duration != null ? String(lineItem.duration) : '')}
                              onChange={(valueString) =>
                                setDurationDrafts((prev) => ({ ...prev, [lineItem.id]: valueString }))
                              }
                              onBlur={() => {
                                const raw = durationDrafts[lineItem.id];
                                const n =
                                  raw != null && raw !== ''
                                    ? parseFloat(raw)
                                    : lineItem.duration ?? 0;
                                if (Number.isFinite(n)) {
                                  updateLineItem(itemIndex, lineItemIndex, 'duration' as keyof LineItem, n);
                                }
                                setDurationDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[lineItem.id];
                                  return next;
                                });
                              }}
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
                            <Input
                                value={lineItem.duration ? 'day' : (lineItem.durationLabel || '')}
                                onChange={(e) => updateLineItem(itemIndex, lineItemIndex, 'durationLabel' as keyof LineItem, e.target.value)}
                                placeholder="unit label"
                                size="xs"
                                mt="5px"
                                textAlign="center"
                                bg="#f4f6f8"
                                border="1px dashed"
                                borderColor="gray.300"
                                borderRadius="4px"
                                h="22px"
                                fontSize="11px"
                                color="gray.600"
                                fontWeight="500"
                                _placeholder={{ color: 'gray.400' }}
                                _hover={{ bg: 'white', borderColor: 'red.400', borderStyle: 'solid' }}
                                _focus={{ bg: 'white', borderColor: 'red.500', borderStyle: 'solid', boxShadow: '0 0 0 3px rgba(201,31,61,0.15)' }}
                              />
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
                            placeholder="e.g. Per cab/day, One time fee..."
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
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" width={showDurationColumn ? "35%" : "40%"}>
                            Item Description
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="12%">
                            Quantity
                          </Th>
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="15%">
                            Unit Rate
                          </Th>
                          {showDurationColumn && (
                          <Th color="gray.600" fontWeight="600" fontSize="xs" textTransform="uppercase" isNumeric width="12%" title="Campaign duration when user requested months/days">
                            Duration
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
                            <Td isNumeric verticalAlign="top">
                              <NumberInput
                                value={qtyDrafts[lineItem.id] ?? String(lineItem.quantity)}
                                onChange={(valueString) =>
                                  setQtyDrafts((prev) => ({ ...prev, [lineItem.id]: valueString }))
                                }
                                onBlur={() => {
                                  const raw = qtyDrafts[lineItem.id];
                                  const n = raw != null && raw !== '' ? parseFloat(raw) : lineItem.quantity;
                                  if (Number.isFinite(n)) {
                                    updateLineItem(itemIndex, lineItemIndex, 'quantity', n);
                                  }
                                  setQtyDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[lineItem.id];
                                    return next;
                                  });
                                }}
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
                              <Input
                                value={lineItem.quantityUnit || ''}
                                onChange={(e) => updateLineItem(itemIndex, lineItemIndex, 'quantityUnit' as keyof LineItem, e.target.value)}
                                placeholder="unit label"
                                size="xs"
                                mt="5px"
                                textAlign="center"
                                bg="#f4f6f8"
                                border="1px dashed"
                                borderColor="gray.300"
                                borderRadius="4px"
                                h="22px"
                                fontSize="11px"
                                color="gray.600"
                                fontWeight="500"
                                _placeholder={{ color: 'gray.400' }}
                                _hover={{ bg: 'white', borderColor: '#750926', borderStyle: 'solid' }}
                                _focus={{ bg: 'white', borderColor: '#750926', borderStyle: 'solid', boxShadow: '0 0 0 1px #750926' }}
                              />
                            </Td>
                            <Td isNumeric verticalAlign="top">
                              <NumberInput
                                value={rateInputValues[lineItem.id] ?? formatRateDisplay(lineItem.unitPrice)}
                                onChange={(valueString) => {
                                  setRateInputValues((prev) => ({ ...prev, [lineItem.id]: valueString }));
                                }}
                                onBlur={() => {
                                  const raw = rateInputValues[lineItem.id];
                                  const n =
                                    raw != null && raw !== ''
                                      ? parseRateInput(raw)
                                      : lineItem.unitPrice;
                                  if (Number.isFinite(n)) {
                                    updateLineItem(itemIndex, lineItemIndex, 'unitPrice', roundRate(n));
                                  }
                                  setRateInputValues((prev) => {
                                    const next = { ...prev };
                                    delete next[lineItem.id];
                                    return next;
                                  });
                                }}
                                min={0}
                                step={0.01}
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
                              {ratePeriodLabel(lineItem) && (
                                <Input
                                  value={ratePeriodLabel(lineItem)}
                                  readOnly
                                  size="xs"
                                  mt="5px"
                                  textAlign="center"
                                  bg="#f4f6f8"
                                  border="1px dashed"
                                  borderColor="gray.300"
                                  borderRadius="4px"
                                  h="22px"
                                  fontSize="11px"
                                  color="gray.600"
                                  fontWeight="500"
                                  cursor="default"
                                  tabIndex={-1}
                                />
                              )}
                            </Td>
                            {showDurationColumn && (
                            <Td isNumeric verticalAlign="top">
                              <NumberInput
                                value={durationDrafts[lineItem.id] ?? (lineItem.duration != null ? String(lineItem.duration) : '')}
                                onChange={(valueString) =>
                                  setDurationDrafts((prev) => ({ ...prev, [lineItem.id]: valueString }))
                                }
                                onBlur={() => {
                                  const raw = durationDrafts[lineItem.id];
                                  const n =
                                    raw != null && raw !== ''
                                      ? parseFloat(raw)
                                      : lineItem.duration ?? 0;
                                  if (Number.isFinite(n)) {
                                    updateLineItem(itemIndex, lineItemIndex, 'duration' as keyof LineItem, n);
                                  }
                                  setDurationDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[lineItem.id];
                                    return next;
                                  });
                                }}
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
                                  title="Campaign duration in days (1 month = 30 days)"
                                  />
                                </NumberInput>
                                <Input
                                  value={lineItem.duration ? 'day' : (lineItem.durationLabel || '')}
                                  onChange={(e) => updateLineItem(itemIndex, lineItemIndex, 'durationLabel' as keyof LineItem, e.target.value)}
                                  placeholder="unit label"
                                  size="xs"
                                  mt="5px"
                                  textAlign="center"
                                  bg="#f4f6f8"
                                  border="1px dashed"
                                  borderColor="gray.300"
                                  borderRadius="4px"
                                  h="22px"
                                  fontSize="11px"
                                  color="gray.600"
                                  fontWeight="500"
                                  _placeholder={{ color: 'gray.400' }}
                                  _hover={{ bg: 'white', borderColor: '#750926', borderStyle: 'solid' }}
                                  _focus={{ bg: 'white', borderColor: '#750926', borderStyle: 'solid', boxShadow: '0 0 0 1px #750926' }}
                                />
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
    </Box>
  );
};

export default QuotePreview;

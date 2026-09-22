import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Container,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  VStack,
  Wrap,
  WrapItem,
  useToast,
} from '@chakra-ui/react';
import {
  FiArrowDown,
  FiArrowRight,
  FiArrowUp,
  FiCheck,
  FiEdit2,
  FiMapPin,
  FiMenu,
  FiPackage,
  FiPlus,
  FiSearch,
  FiX,
} from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import QuoteFlowNav, { getQuoteFlowNavOffset } from '../components/QuoteWizard/QuoteFlowNav';
import { useAppStore } from '../store';
import type { ReviewDraftItem } from '../types/review';
import type { DbService } from '../utils/serviceResolver';
import {
  citiesForService,
  emptyReviewItem,
  enrichReviewItemFromCatalog,
  listCatalogServiceOptions,
  reviewItemsToConfirmationRows,
  sortServicesByTypedQuery,
  splitCityLabels,
  validateReviewDraft,
} from '../utils/quoteReviewDraft';
import './QuoteReviewPage.css';

type ServiceOption = { label: string; serviceId: string; serviceName: string };

const emptyComposer = (): ReviewDraftItem => emptyReviewItem({ quantity: 1, durationDays: 0, cities: [] });

function buildCartItem(composer: ReviewDraftItem): ReviewDraftItem {
  const quantity = Math.max(composer.quantity || 1, composer.minimumQuantity || 1);
  const durationDays =
    composer.durationDays > 0
      ? Math.max(composer.durationDays, composer.minimumDurationDays || 0)
      : (composer.minimumDurationDays && composer.minimumDurationDays > 0
        ? composer.minimumDurationDays
        : 0);
  return { ...composer, quantity, durationDays };
}

const QuoteReviewPage: React.FC = () => {
  const history = useHistory();
  const toast = useToast();
  const {
    reviewDraft,
    setReviewDraft,
    setCurrentQuote,
    loadCloudServices,
  } = useAppStore();

  const [cart, setCart] = useState<ReviewDraftItem[]>([]);
  const [composer, setComposer] = useState<ReviewDraftItem>(() => emptyComposer());
  const [serviceChosen, setServiceChosen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [services, setServices] = useState<DbService[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Sole-location gate: Continue adds, Quit clears the composer. */
  const [soleLocationPending, setSoleLocationPending] = useState(false);

  const suggestRef = useRef<HTMLDivElement | null>(null);
  const composerTopRef = useRef<HTMLDivElement | null>(null);
  const cartScrollRef = useRef<HTMLDivElement | null>(null);
  const lastCartRowRef = useRef<HTMLDivElement | null>(null);

  const navOffset = getQuoteFlowNavOffset('review');
  const isEditing = editingId != null;

  useEffect(() => {
    if (!reviewDraft) {
      history.replace('/');
      return;
    }
    setCart(
      (reviewDraft.items || [])
        .filter((i) => i.service.trim())
        .map((i) => ({ ...i })),
    );
    setComposer(emptyComposer());
    setServiceChosen(false);
    setEditingId(null);
    setSoleLocationPending(false);
  }, [reviewDraft, history]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      try {
        const { loadAllServicesFromCloud } = await import('../services/supabaseProposalService');
        const db = ((await loadAllServicesFromCloud()) || []) as DbService[];
        if (!cancelled) setServices(db);
      } catch (err) {
        console.warn('[QuoteReview] catalog load failed', err);
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear days badge when DB min_days is NA (or one-time printing/fixing).
  useEffect(() => {
    if (!services.length) return;
    setCart((prev) => prev.map((item) => enrichReviewItemFromCatalog(item, services)));
  }, [services, reviewDraft]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!suggestRef.current) return;
      if (!suggestRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const catalogOptions = useMemo(
    () => listCatalogServiceOptions(services),
    [services],
  );

  const suggestions = useMemo(
    () => sortServicesByTypedQuery(catalogOptions, composer.service),
    [catalogOptions, composer.service],
  );

  const cityOptions = useMemo(() => {
    if (!serviceChosen || !composer.service.trim()) return [];
    return citiesForService(services, composer.service, composer.serviceId);
  }, [serviceChosen, composer.service, composer.serviceId, services]);

  const resetComposer = () => {
    setComposer(emptyComposer());
    setServiceChosen(false);
    setShowSuggest(false);
    setEditingId(null);
    setSoleLocationPending(false);
  };

  const scrollNewItemIntoView = (itemId: string) => {
    setHighlightId(itemId);
    requestAnimationFrame(() => {
      lastCartRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      cartScrollRef.current?.scrollTo({
        top: cartScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    });
    window.setTimeout(() => setHighlightId((cur) => (cur === itemId ? null : cur)), 1800);
  };

  /** Commit composer to cart; returns the new/updated item id. */
  const commitComposerToCart = (draft: ReviewDraftItem, editId: string | null): string => {
    const nextItem = buildCartItem(draft);
    if (editId) {
      setCart((prev) => prev.map((row) => (row.id === editId ? { ...nextItem, id: editId } : row)));
      scrollNewItemIntoView(editId);
      return editId;
    }
    const id = nextItem.id;
    setCart((prev) => [...prev, nextItem]);
    scrollNewItemIntoView(id);
    return id;
  };

  const handleServiceType = (value: string) => {
    setComposer((prev) => ({
      ...prev,
      service: value,
      serviceId: undefined,
      cities: [],
      minimumQuantity: undefined,
      minimumDurationDays: undefined,
    }));
    setServiceChosen(false);
    setShowSuggest(true);
  };

  const handleServicePick = (opt: ServiceOption) => {
    const keptQty = composer.quantity;
    const enriched = enrichReviewItemFromCatalog(
      {
        ...composer,
        service: opt.label,
        serviceId: opt.serviceId,
        cities: [],
        durationDays: 0,
      },
      services,
    );
    const quantity = Math.max(keptQty || 1, enriched.minimumQuantity || 1);
    const durationDays =
      enriched.minimumDurationDays && enriched.minimumDurationDays > 0
        ? enriched.minimumDurationDays
        : 0;
    const availableCities = citiesForService(services, opt.label, opt.serviceId);

    // Exactly one location → show Continue / Quit (do not silent-add).
    if (!editingId && availableCities.length === 1) {
      setComposer({
        ...enriched,
        cities: [availableCities[0]],
        quantity,
        durationDays,
      });
      setServiceChosen(true);
      setShowSuggest(false);
      setSoleLocationPending(true);
      return;
    }

    setSoleLocationPending(false);
    setComposer({
      ...enriched,
      cities: [],
      quantity,
      durationDays,
    });
    setServiceChosen(true);
    setShowSuggest(false);
  };

  const handleSoleLocationContinue = () => {
    if (!composer.service.trim() || !composer.cities.length) return;
    commitComposerToCart(composer, editingId);
    resetComposer();
  };

  const handleSoleLocationQuit = () => {
    resetComposer();
  };

  const toggleCity = (city: string) => {
    // Sole-location gate uses Continue / Quit — city chip is display-only.
    if (soleLocationPending) return;

    const has = composer.cities.some((c) => c.toLowerCase() === city.toLowerCase());
    const nextCities = has
      ? composer.cities.filter((c) => c.toLowerCase() !== city.toLowerCase())
      : [...composer.cities, city];

    setComposer((prev) => ({ ...prev, cities: nextCities }));
  };

  /** Req 5: after cities are chosen, add immediately under the selection (scroll into view). */
  const handleConfirmCitiesAndAdd = () => {
    if (!serviceChosen || !composer.service.trim()) {
      toast({
        title: 'Choose a service from the list first.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }
    if (!composer.cities.length) {
      toast({
        title: 'Select at least one city for this service.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }
    commitComposerToCart(composer, editingId);
    resetComposer();
  };

  const handleEditCartItem = (item: ReviewDraftItem) => {
    setEditingId(item.id);
    setSoleLocationPending(false);
    setComposer({
      ...item,
      cities: item.cities.flatMap((c) => splitCityLabels(c)),
    });
    setServiceChosen(!!item.service.trim());
    setShowSuggest(true);
    requestAnimationFrame(() => {
      composerTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleAddToCart = () => {
    handleConfirmCitiesAndAdd();
  };

  const handleRemoveFromCart = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
    if (editingId === id) resetComposer();
  };

  const moveCartItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= cart.length || fromIndex === toIndex) return;
    setCart((prev) => {
      const next = [...prev];
      const [row] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, row);
      return next;
    });
  };

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    if (!sourceId || sourceId === targetId) return;
    setCart((prev) => {
      const from = prev.findIndex((i) => i.id === sourceId);
      const to = prev.findIndex((i) => i.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  };

  const handleFinish = async () => {
    let finalCart = cart;
    if (serviceChosen && composer.service.trim() && composer.cities.length) {
      const folded = buildCartItem(composer);
      const err = validateReviewDraft([folded]);
      if (err) {
        toast({ title: err, status: 'warning', duration: 4000, isClosable: true });
        return;
      }
      if (editingId) {
        finalCart = cart.map((row) => (row.id === editingId ? { ...folded, id: editingId } : row));
      } else {
        finalCart = [...cart, folded];
      }
    }

    const error = validateReviewDraft(finalCart);
    if (error) {
      toast({ title: error, status: 'warning', duration: 4000, isClosable: true });
      return;
    }

    setSubmitting(true);
    try {
      const rows = reviewItemsToConfirmationRows(finalCart);
      const { buildQuoteFromConfirmedRows } = await import('../utils/buildQuoteFromConfirmedRows');
      let dbServices = services;
      if (!dbServices.length) {
        const { loadAllServicesFromCloud } = await import('../services/supabaseProposalService');
        dbServices = ((await loadAllServicesFromCloud()) || []) as DbService[];
      }

      const original =
        reviewDraft?.originalUserText
        || finalCart.map((i) => `${i.quantity} ${i.service} ${i.cities.join(', ')}`).join(' and ');

      const result = buildQuoteFromConfirmedRows(rows, dbServices, original);
      if (!result.success) {
        toast({
          title: 'Could not build quote',
          description: result.message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      setReviewDraft({
        items: finalCart,
        source: reviewDraft?.source || 'ai',
        originalUserText: reviewDraft?.originalUserText,
      });
      setCurrentQuote(result.quote);
      loadCloudServices().catch(() => undefined);
      history.push('/preview');
    } catch (err) {
      toast({
        title: 'Quote failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!reviewDraft) {
    return (
      <Box minH="40vh" display="flex" alignItems="center" justifyContent="center">
        <Spinner color="brand.500" size="lg" />
      </Box>
    );
  }

  return (
    <Box className="quote-review-page" minH="100dvh">
      <QuoteFlowNav step="review" />

      <Container maxW="1100px" pt={navOffset} pb={{ base: 32, md: 20 }} px={{ base: 4, md: 6 }}>
        <VStack align="stretch" spacing={3} mt={2}>
          <HStack className="quote-review-steps" spacing={2} justify="center" wrap="wrap">
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot is-done">1</Text>
              <Text className="quote-review-step">Chat</Text>
            </HStack>
            <Text className="quote-review-step-sep">/</Text>
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot is-active">2</Text>
              <Text className="quote-review-step is-active">Review</Text>
            </HStack>
            <Text className="quote-review-step-sep">/</Text>
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot">3</Text>
              <Text className="quote-review-step">PDF</Text>
            </HStack>
          </HStack>

          <Box textAlign={{ base: 'left', md: 'center' }} maxW="640px" mx={{ md: 'auto' }}>
            <Text fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" color="#1A202C" letterSpacing="-0.02em">
              Preview Quote
            </Text>
            <Text mt={1} fontSize="sm" color="gray.600" lineHeight="1.45">
              Quick check before PDF — fix the service if needed, pick cities, drag to reorder, then continue.
            </Text>
          </Box>

          {loadingCatalog && (
            <HStack spacing={2} color="gray.500" fontSize="sm" justify={{ md: 'center' }}>
              <Spinner size="sm" color="brand.500" />
              <Text>Loading your catalog...</Text>
            </HStack>
          )}

          <Box
            className="quote-review-main-split"
            display={{ base: 'flex', md: 'grid' }}
            flexDirection="column"
            gridTemplateColumns={{ md: 'minmax(280px, 0.95fr) minmax(320px, 1.15fr)' }}
            gap={{ base: 3, md: 4 }}
            alignItems="stretch"
          >
            <Box className="quote-review-panel quote-review-cart" minH={{ md: '280px' }}>
              <HStack justify="space-between" align="center" mb={2}>
                <HStack spacing={2}>
                  <Box className="quote-review-panel-icon">
                    <Icon as={FiPackage} boxSize={3.5} />
                  </Box>
                  <Text fontWeight="700" fontSize="sm" color="gray.800">
                    Your quote list
                  </Text>
                </HStack>
                <Text className="quote-review-count-pill">{cart.length}</Text>
              </HStack>

              {cart.length === 0 ? (
                <Box className="quote-review-empty" flex="1">
                  <Icon as={FiPackage} boxSize={6} color="brand.300" mb={2} />
                  <Text fontSize="sm" fontWeight="600" color="gray.700" textAlign="center">
                    Nothing added yet
                  </Text>
                  <Text fontSize="xs" color="gray.500" textAlign="center" mt={1} maxW="220px">
                    Search a service on the right, choose cities — it adds to this list.
                  </Text>
                </Box>
              ) : (
                <Stack
                  ref={cartScrollRef}
                  spacing={1.5}
                  flex="1"
                  overflowY="auto"
                  maxH={{ base: '240px', md: '360px' }}
                  className="quote-review-service-scroll"
                  pr={1}
                >
                  {cart.map((item, index) => (
                    <Box
                      key={item.id}
                      ref={index === cart.length - 1 ? lastCartRowRef : undefined}
                      className={
                        `quote-review-cart-row`
                        + `${editingId === item.id ? ' is-editing' : ''}`
                        + `${highlightId === item.id ? ' is-just-added' : ''}`
                        + `${dragId === item.id ? ' is-dragging' : ''}`
                      }
                      draggable
                      onDragStart={onDragStart(item.id)}
                      onDragOver={onDragOver}
                      onDrop={onDrop(item.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <HStack align="center" spacing={1.5}>
                        <IconButton
                          aria-label="Drag to reorder"
                          title="Drag to reorder"
                          icon={<Icon as={FiMenu} />}
                          size="xs"
                          variant="ghost"
                          color="gray.400"
                          cursor="grab"
                          minW="26px"
                          h="26px"
                          _active={{ cursor: 'grabbing' }}
                        />
                        <Text className="quote-review-index">{index + 1}</Text>
                        <Box flex="1" minW={0}>
                          <Text fontSize="sm" fontWeight="700" color="gray.800" noOfLines={1} lineHeight="1.3">
                            {item.service}
                          </Text>
                          <HStack mt={0.5} spacing={1} align="center">
                            <Icon as={FiMapPin} boxSize={3} color="gray.400" flexShrink={0} />
                            <Text fontSize="xs" color="gray.600" noOfLines={1} lineHeight="1.3">
                              {item.cities.length ? item.cities.join(', ') : 'No city selected'}
                            </Text>
                          </HStack>
                          <HStack mt={1} spacing={1.5} flexWrap="wrap">
                            <Text as="span" className="quote-review-badge">
                              Qty {item.quantity}
                            </Text>
                            {/* Show days ONLY when DB min_days is a real number (not NA). */}
                            {(item.minimumDurationDays ?? 0) > 0 ? (
                              <Text as="span" className="quote-review-badge is-muted">
                                {Math.max(item.durationDays || 0, item.minimumDurationDays!)}
                                {' '}
                                days
                              </Text>
                            ) : null}
                          </HStack>
                        </Box>
                        <VStack spacing={0}>
                          <IconButton
                            aria-label="Move up"
                            title="Move up"
                            icon={<Icon as={FiArrowUp} />}
                            size="xs"
                            variant="ghost"
                            isDisabled={index === 0}
                            minW="26px"
                            h="22px"
                            onClick={() => moveCartItem(index, index - 1)}
                          />
                          <IconButton
                            aria-label="Move down"
                            title="Move down"
                            icon={<Icon as={FiArrowDown} />}
                            size="xs"
                            variant="ghost"
                            isDisabled={index === cart.length - 1}
                            minW="26px"
                            h="22px"
                            onClick={() => moveCartItem(index, index + 1)}
                          />
                        </VStack>
                        <HStack spacing={0}>
                          <IconButton
                            aria-label="Edit service"
                            title="Edit"
                            icon={<Icon as={FiEdit2} />}
                            size="xs"
                            variant="ghost"
                            color="brand.600"
                            borderRadius="full"
                            minW="26px"
                            h="26px"
                            _hover={{ bg: 'brand.50' }}
                            onClick={() => handleEditCartItem(item)}
                          />
                          <IconButton
                            aria-label="Remove service"
                            title="Remove"
                            icon={<Icon as={FiX} />}
                            size="xs"
                            variant="ghost"
                            color="red.500"
                            borderRadius="full"
                            minW="26px"
                            h="26px"
                            _hover={{ bg: 'red.50' }}
                            onClick={() => handleRemoveFromCart(item.id)}
                          />
                        </HStack>
                      </HStack>
                    </Box>
                  ))}
                </Stack>
              )}
              {cart.length > 1 && (
                <Text mt={2} fontSize="xs" color="gray.500">
                  Drag rows or use arrows to set quotation order.
                </Text>
              )}
            </Box>

            <Box
              ref={composerTopRef}
              className={`quote-review-panel${isEditing ? ' is-editing' : ''}`}
              minH={{ md: '280px' }}
            >
              <HStack spacing={2} mb={2}>
                <Box className="quote-review-panel-icon">
                  <Icon as={FiSearch} boxSize={3.5} />
                </Box>
                <Text fontWeight="700" fontSize="sm" color="gray.800">
                  {isEditing ? 'Fix this service' : 'Add a service'}
                </Text>
              </HStack>

              {isEditing && (
                <Box className="quote-review-edit-banner" mb={2}>
                  <Text fontSize="sm" fontWeight="600" color="brand.700">
                    AI may have picked the wrong name - search and choose the right one.
                  </Text>
                </Box>
              )}

              <Stack spacing={3}>
                <FormControl isRequired minW={0}>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700" mb={1}>
                    Service <Text as="span" color="red.500">*</Text>
                  </FormLabel>
                  <Box ref={suggestRef}>
                    <Input
                      value={composer.service}
                      placeholder="Start typing - Bus, Auto, Hoarding..."
                      onChange={(e) => handleServiceType(e.target.value)}
                      onFocus={() => setShowSuggest(true)}
                      bg="white"
                      h="40px"
                      borderRadius="10px"
                      borderColor="gray.200"
                      _placeholder={{ color: 'gray.400' }}
                      _focus={{
                        borderColor: 'brand.400',
                        boxShadow: '0 0 0 3px rgba(117, 9, 38, 0.12)',
                      }}
                    />

                    {showSuggest && (
                      <Box
                        className="quote-review-service-scroll quote-review-catalog"
                        mt={2}
                        maxH={{ base: '200px', md: '260px' }}
                        overflowY="auto"
                        overflowX="hidden"
                        overscrollBehavior="contain"
                      >
                        {suggestions.length === 0 ? (
                          <Text px={3} py={4} fontSize="sm" color="gray.500" textAlign="center">
                            No matches. Try a shorter name like "bus" or "hoarding".
                          </Text>
                        ) : (
                          suggestions.map((opt) => {
                            const active =
                              !!composer.serviceId
                              && composer.serviceId === opt.serviceId;
                            return (
                              <Box
                                key={opt.serviceId}
                                as="button"
                                type="button"
                                className={`quote-review-service-option${active ? ' is-active' : ''}`}
                                w="100%"
                                textAlign="left"
                                px={3}
                                py={2.5}
                                fontSize="sm"
                                fontWeight={active ? '700' : '500'}
                                color={active ? 'brand.700' : 'gray.800'}
                                onClick={() => handleServicePick(opt)}
                              >
                                <HStack justify="space-between" spacing={2}>
                                  <Text as="span" noOfLines={2}>{opt.label}</Text>
                                  {active && <Icon as={FiCheck} color="brand.500" flexShrink={0} />}
                                </HStack>
                              </Box>
                            );
                          })
                        )}
                      </Box>
                    )}
                  </Box>
                  {showSuggest && suggestions.length > 0 && (
                    <FormHelperText color="gray.500">
                      {suggestions.length} match{suggestions.length === 1 ? '' : 'es'} - scroll to browse all.
                    </FormHelperText>
                  )}
                  {!showSuggest && serviceChosen && composer.service && (
                    <FormHelperText color="gray.500">
                      Selected. Tap the field again to change the service.
                    </FormHelperText>
                  )}
                </FormControl>

                {serviceChosen && (
                  <FormControl isRequired>
                    <HStack justify="space-between" mb={1}>
                      <FormLabel fontSize="sm" fontWeight="600" color="gray.700" mb={0}>
                        Cities <Text as="span" color="red.500">*</Text>
                      </FormLabel>
                      {composer.cities.length > 0 && (
                        <Text fontSize="xs" fontWeight="600" color="brand.600">
                          {composer.cities.length} selected
                        </Text>
                      )}
                    </HStack>
                    {composer.service && (
                      <Text fontSize="xs" color="gray.500" mb={2} noOfLines={2}>
                        Showing places for {composer.service}
                      </Text>
                    )}
                    {cityOptions.length === 0 ? (
                      <Text fontSize="sm" color="gray.500">
                        No cities found for this service.
                      </Text>
                    ) : soleLocationPending && cityOptions.length === 1 ? (
                      <Box
                        className="quote-review-sole-location"
                        borderWidth="1px"
                        borderColor="brand.200"
                        bg="brand.50"
                        borderRadius="14px"
                        p={3}
                      >
                        <Text fontSize="sm" color="gray.800" lineHeight="1.5" mb={3}>
                          This service is available only at{' '}
                          <Text as="span" fontWeight="700" color="brand.700">
                            {cityOptions[0]}
                          </Text>
                          . If this location is suitable, continue; otherwise quit.
                        </Text>
                        <HStack spacing={2}>
                          <Button
                            flex="1"
                            h="42px"
                            borderRadius="12px"
                            bg="brand.500"
                            color="white"
                            fontWeight="700"
                            leftIcon={<Icon as={FiCheck} />}
                            _hover={{ bg: 'brand.600' }}
                            onClick={handleSoleLocationContinue}
                          >
                            Continue
                          </Button>
                          <Button
                            flex="1"
                            h="42px"
                            borderRadius="12px"
                            variant="outline"
                            borderColor="gray.300"
                            color="gray.700"
                            fontWeight="600"
                            leftIcon={<Icon as={FiX} />}
                            onClick={handleSoleLocationQuit}
                          >
                            Quit
                          </Button>
                        </HStack>
                      </Box>
                    ) : (
                      <Box>
                        <Box
                          className="quote-review-city-scroll"
                          maxH={{ base: '180px', md: '200px' }}
                          overflowY="auto"
                          pr={1}
                        >
                          <Wrap spacing={2}>
                            {cityOptions.map((city) => {
                              const selected = composer.cities.some(
                                (c) => c.toLowerCase() === city.toLowerCase(),
                              );
                              return (
                                <WrapItem key={city}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className={`quote-review-city-chip${selected ? ' is-selected' : ''}`}
                                    borderRadius="999px"
                                    leftIcon={selected ? <Icon as={FiCheck} /> : <Icon as={FiMapPin} />}
                                    variant={selected ? 'solid' : 'outline'}
                                    bg={selected ? 'brand.500' : 'white'}
                                    color={selected ? 'white' : 'gray.700'}
                                    borderColor={selected ? 'brand.500' : 'gray.200'}
                                    fontWeight="600"
                                    _hover={{
                                      bg: selected ? 'brand.600' : 'brand.50',
                                      borderColor: 'brand.300',
                                    }}
                                    onClick={() => toggleCity(city)}
                                  >
                                    {city}
                                  </Button>
                                </WrapItem>
                              );
                            })}
                          </Wrap>
                        </Box>
                        {composer.cities.length > 0 && !editingId && (
                          <Button
                            mt={3}
                            w="100%"
                            h="42px"
                            borderRadius="12px"
                            bg="brand.500"
                            color="white"
                            fontWeight="700"
                            leftIcon={<Icon as={FiCheck} />}
                            _hover={{ bg: 'brand.600' }}
                            onClick={handleConfirmCitiesAndAdd}
                          >
                            Confirm · add to list
                          </Button>
                        )}
                      </Box>
                    )}
                    <FormHelperText color="gray.500">
                      {soleLocationPending
                        ? 'Only one location — Continue to add, or Quit to cancel.'
                        : 'Tap cities, then Confirm to add (multi-city stays one line).'}
                    </FormHelperText>
                  </FormControl>
                )}
              </Stack>
            </Box>
          </Box>
        </VStack>
      </Container>

      <Box className="quote-review-actions">
        <Container maxW="1100px" px={{ base: 4, md: 6 }} py={3}>
          <HStack spacing={3} flexWrap="wrap" align="center">
            <Button
              leftIcon={<Icon as={isEditing ? FiEdit2 : FiPlus} />}
              variant="outline"
              borderColor="brand.200"
              color="brand.600"
              borderRadius="12px"
              h="44px"
              px={5}
              onClick={soleLocationPending ? handleSoleLocationContinue : handleAddToCart}
              flex={{ base: '1', sm: 'unset' }}
              _hover={{ bg: 'brand.50', borderColor: 'brand.400' }}
            >
              {isEditing ? 'Save changes' : soleLocationPending ? 'Continue' : 'Add service'}
            </Button>
            {(isEditing || soleLocationPending) && (
              <Button
                variant="ghost"
                color="gray.600"
                borderRadius="12px"
                h="44px"
                onClick={soleLocationPending ? handleSoleLocationQuit : resetComposer}
              >
                {soleLocationPending ? 'Quit' : 'Cancel'}
              </Button>
            )}
            <Box flex={{ base: '1 1 100%', sm: '1' }} display={{ base: 'none', sm: 'block' }} />
            <Button
              rightIcon={<Icon as={FiArrowRight} />}
              bg="brand.500"
              color="white"
              borderRadius="12px"
              h="44px"
              px={6}
              fontWeight="700"
              _hover={{ bg: 'brand.600', transform: 'translateY(-1px)' }}
              _active={{ transform: 'none' }}
              onClick={handleFinish}
              isLoading={submitting}
              flex={{ base: '1', sm: 'unset' }}
              minW={{ sm: '160px' }}
            >
              Continue to PDF
            </Button>
          </HStack>
        </Container>
      </Box>
    </Box>
  );
};

export default QuoteReviewPage;

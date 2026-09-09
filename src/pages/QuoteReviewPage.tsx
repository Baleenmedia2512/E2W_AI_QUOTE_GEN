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
import { FiArrowRight, FiCheck, FiEdit2, FiMapPin, FiPackage, FiPlus, FiSearch, FiX } from 'react-icons/fi';
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

const emptyComposer = (): ReviewDraftItem => emptyReviewItem({ quantity: 1, durationDays: 30, cities: [] });

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
  const suggestRef = useRef<HTMLDivElement | null>(null);
  const composerTopRef = useRef<HTMLDivElement | null>(null);

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
  }, [reviewDraft, history]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      try {
        const { loadAllServicesFromCloud } = await import('../services/supabaseProposalService');
        const db = ((await loadAllServicesFromCloud()) || []) as DbService[];
        if (!cancelled) {
          setServices(db);
          setCart((prev) => prev.map((item) => enrichReviewItemFromCatalog(item, db)));
        }
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
    const keptDays = composer.durationDays;
    const enriched = enrichReviewItemFromCatalog(
      {
        ...composer,
        service: opt.label,
        serviceId: opt.serviceId,
        cities: [],
      },
      services,
    );
    const quantity = Math.max(keptQty || 1, enriched.minimumQuantity || 1);
    const durationDays = Math.max(keptDays || 30, enriched.minimumDurationDays || 1);
    setComposer({
      ...enriched,
      cities: [],
      quantity,
      durationDays,
    });
    setServiceChosen(true);
    // Keep chosen name in the input; close the browse list (no duplicate highlight under it).
    setShowSuggest(false);
  };

  const toggleCity = (city: string) => {
    setComposer((prev) => {
      const has = prev.cities.some((c) => c.toLowerCase() === city.toLowerCase());
      return {
        ...prev,
        cities: has
          ? prev.cities.filter((c) => c.toLowerCase() !== city.toLowerCase())
          : [...prev.cities, city],
      };
    });
  };

  const handleEditCartItem = (item: ReviewDraftItem) => {
    setEditingId(item.id);
    setComposer({
      ...item,
      cities: item.cities.flatMap((c) => splitCityLabels(c)),
    });
    setServiceChosen(!!item.service.trim());
    // Open catalog so user can change the service; it closes again after a new pick.
    setShowSuggest(true);
    requestAnimationFrame(() => {
      composerTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleAddToCart = () => {
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

    const quantity = Math.max(composer.quantity || 1, composer.minimumQuantity || 1);
    const durationDays = Math.max(composer.durationDays || 30, composer.minimumDurationDays || 1);
    const nextItem: ReviewDraftItem = { ...composer, quantity, durationDays };

    if (editingId) {
      setCart((prev) => prev.map((row) => (row.id === editingId ? { ...nextItem, id: editingId } : row)));
    } else {
      setCart((prev) => [...prev, nextItem]);
    }
    resetComposer();
  };

  const handleRemoveFromCart = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
    if (editingId === id) resetComposer();
  };

  const handleFinish = async () => {
    let finalCart = cart;
    if (serviceChosen && composer.service.trim() && composer.cities.length) {
      const folded: ReviewDraftItem = {
        ...composer,
        quantity: Math.max(composer.quantity || 1, composer.minimumQuantity || 1),
        durationDays: Math.max(composer.durationDays || 30, composer.minimumDurationDays || 1),
      };
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
        <VStack align="stretch" spacing={5} mt={3}>
          <HStack className="quote-review-steps" spacing={2} justify="center" wrap="wrap">
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot is-done">1</Text>
              <Text className="quote-review-step">Chat</Text>
            </HStack>
            <Text className="quote-review-step-sep">›</Text>
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot is-active">2</Text>
              <Text className="quote-review-step is-active">Review</Text>
            </HStack>
            <Text className="quote-review-step-sep">›</Text>
            <HStack spacing={1.5} className="quote-review-step-item">
              <Text as="span" className="quote-review-step-dot">3</Text>
              <Text className="quote-review-step">PDF</Text>
            </HStack>
          </HStack>

          <Box textAlign={{ base: 'left', md: 'center' }} maxW="640px" mx={{ md: 'auto' }}>
            <Text fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" color="#1A202C" letterSpacing="-0.02em">
              Preview Quote
            </Text>
            <Text mt={1.5} fontSize="sm" color="gray.600" lineHeight="1.5">
              Quick check before PDF — fix the service if needed, pick cities, then continue.
            </Text>
          </Box>

          {loadingCatalog && (
            <HStack spacing={2} color="gray.500" fontSize="sm" justify={{ md: 'center' }}>
              <Spinner size="sm" color="brand.500" />
              <Text>Loading your catalog…</Text>
            </HStack>
          )}

          <Box
            className="quote-review-main-split"
            display={{ base: 'flex', md: 'grid' }}
            flexDirection="column"
            gridTemplateColumns={{ md: 'minmax(280px, 0.95fr) minmax(320px, 1.15fr)' }}
            gap={{ base: 4, md: 5 }}
            alignItems="stretch"
          >
            {/* LEFT — Added services */}
            <Box className="quote-review-panel quote-review-cart" minH={{ md: '420px' }}>
              <HStack justify="space-between" align="center" mb={3}>
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
                    Search a service on the right, choose cities, then tap Add service.
                  </Text>
                </Box>
              ) : (
                <Stack
                  spacing={2.5}
                  flex="1"
                  overflowY="auto"
                  maxH={{ base: '280px', md: '520px' }}
                  className="quote-review-service-scroll"
                  pr={1}
                >
                  {cart.map((item, index) => (
                    <Box
                      key={item.id}
                      className={`quote-review-cart-row${editingId === item.id ? ' is-editing' : ''}`}
                    >
                      <HStack align="flex-start" spacing={2.5}>
                        <Text className="quote-review-index">{index + 1}</Text>
                        <Box flex="1" minW={0}>
                          <Text fontSize="sm" fontWeight="700" color="gray.800" noOfLines={2}>
                            {item.service}
                          </Text>
                          <HStack mt={1} spacing={1} align="flex-start">
                            <Icon as={FiMapPin} boxSize={3} color="gray.400" mt="2px" flexShrink={0} />
                            <Text fontSize="xs" color="gray.600" noOfLines={2}>
                              {item.cities.length ? item.cities.join(', ') : 'No city selected'}
                            </Text>
                          </HStack>
                          <HStack mt={2} spacing={2} flexWrap="wrap">
                            <Text as="span" className="quote-review-badge">
                              Qty {item.quantity}
                            </Text>
                            <Text as="span" className="quote-review-badge is-muted">
                              {item.durationDays} days
                            </Text>
                          </HStack>
                        </Box>
                        <HStack spacing={0}>
                          <IconButton
                            aria-label="Edit service"
                            title="Edit"
                            icon={<Icon as={FiEdit2} />}
                            size="sm"
                            variant="ghost"
                            color="brand.600"
                            borderRadius="full"
                            _hover={{ bg: 'brand.50' }}
                            onClick={() => handleEditCartItem(item)}
                          />
                          <IconButton
                            aria-label="Remove service"
                            title="Remove"
                            icon={<Icon as={FiX} />}
                            size="sm"
                            variant="ghost"
                            color="red.500"
                            borderRadius="full"
                            _hover={{ bg: 'red.50' }}
                            onClick={() => handleRemoveFromCart(item.id)}
                          />
                        </HStack>
                      </HStack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>

            {/* RIGHT — Service picker + cities */}
            <Box
              ref={composerTopRef}
              className={`quote-review-panel${isEditing ? ' is-editing' : ''}`}
              minH={{ md: '420px' }}
            >
              <HStack spacing={2} mb={3}>
                <Box className="quote-review-panel-icon">
                  <Icon as={FiSearch} boxSize={3.5} />
                </Box>
                <Text fontWeight="700" fontSize="sm" color="gray.800">
                  {isEditing ? 'Fix this service' : 'Add a service'}
                </Text>
              </HStack>

              {isEditing && (
                <Box className="quote-review-edit-banner" mb={4}>
                  <Text fontSize="sm" fontWeight="600" color="brand.700">
                    AI may have picked the wrong name — search and choose the right one.
                  </Text>
                </Box>
              )}

              <Stack spacing={4}>
                <FormControl isRequired minW={0}>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                    Service <Text as="span" color="red.500">*</Text>
                  </FormLabel>
                  <Box ref={suggestRef}>
                    <Input
                      value={composer.service}
                      placeholder="Start typing — Bus, Auto, Hoarding…"
                      onChange={(e) => handleServiceType(e.target.value)}
                      onFocus={() => setShowSuggest(true)}
                      bg="white"
                      h="46px"
                      borderRadius="12px"
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
                            No matches. Try a shorter name like “bus” or “hoarding”.
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
                      {suggestions.length} match{suggestions.length === 1 ? '' : 'es'} — scroll to browse all.
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
                    ) : (
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
                    )}
                    <FormHelperText color="gray.500">
                      Tap cities to include them in this quote line.
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
              onClick={handleAddToCart}
              flex={{ base: '1', sm: 'unset' }}
              _hover={{ bg: 'brand.50', borderColor: 'brand.400' }}
            >
              {isEditing ? 'Save changes' : 'Add service'}
            </Button>
            {isEditing && (
              <Button variant="ghost" color="gray.600" borderRadius="12px" h="44px" onClick={resetComposer}>
                Cancel
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

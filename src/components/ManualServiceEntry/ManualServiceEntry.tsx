import React, { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  useDisclosure,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { FiPlus } from 'react-icons/fi';
import { useAppStore } from '../../store';
import { useAuthStore } from '../../store/authStore';
import { createManualServiceChunk } from '../../services/manualServiceEntryService';
import { detectCityFromFileName } from '../../services/pdfEmbeddingService';

interface ManualServiceFormState {
  vendorName: string;
  city: string;
  medium: string;
  minQty: string;
  qtyMeasurementUnit: string;
  totalCost: string;
  displayCost: string;
  printingCost: string;
  mountingCost: string;
  printingAndMountingCost: string;
  rtoCertificate: string;
  location: string;
  traffic: string;
  displayWidth: string;
  displayHeight: string;
  displayMeasurementUnit: string;
  minDuration: string;
  durationMeasurementUnit: string;
  durationPerSpot: string;
  audioEnabled: boolean | null;
  dayStart: string;
  dayEnd: string;
  replacement: string;
  spotsPerDay: string;
  leadTimeDays: string;
  description: string;
  terms: string;
  documentId: string;
  documentName: string;
  referenceImage: File | null;
  specificationImage: File | null;
  reviewImage: File | null;
}

const initialFormState: ManualServiceFormState = {
  vendorName: '',
  city: '',
  medium: '',
  minQty: '',
  qtyMeasurementUnit: '',
  totalCost: '',
  displayCost: '',
  printingCost: '',
  mountingCost: '',
  printingAndMountingCost: '',
  rtoCertificate: '',
  location: '',
  traffic: '',
  displayWidth: '',
  displayHeight: '',
  displayMeasurementUnit: '',
  minDuration: '',
  durationMeasurementUnit: '',
  durationPerSpot: '',
  audioEnabled: null,
  dayStart: '',
  dayEnd: '',
  replacement: '',
  spotsPerDay: '',
  leadTimeDays: '',
  description: '',
  terms: '',
  documentId: '',
  documentName: '',
  referenceImage: null,
  specificationImage: null,
  reviewImage: null,
};

const numberValue = (value: string): number | undefined => {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isImageInput = (
  image: { file: File; type: 'reference' | 'specification' | 'review' } | null,
): image is { file: File; type: 'reference' | 'specification' | 'review' } => Boolean(image);

export const ManualServiceEntry: React.FC = () => {
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const recentProposals = useAppStore((state) => state.recentProposals);
  const user = useAuthStore((state) => state.user);
  const [form, setForm] = useState<ManualServiceFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);

  const proposalOptions = useMemo(
    () => recentProposals.map((proposal) => ({ id: proposal.id, name: proposal.fileName })),
    [recentProposals],
  );

  const setField = <K extends keyof ManualServiceFormState>(key: K, value: ManualServiceFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(initialFormState);
  };

  const handleProposalChange = (proposalId: string) => {
    const selectedProposal = recentProposals.find((proposal) => proposal.id === proposalId);
    const detectedCity = selectedProposal ? detectCityFromFileName(selectedProposal.fileName) : null;

    setForm((current) => ({
      ...current,
      documentId: proposalId,
      documentName: selectedProposal?.fileName || '',
      city: current.city || (detectedCity ? detectedCity.replace(/-/g, ' ') : ''),
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    try {
      const images = [
        form.referenceImage ? { file: form.referenceImage, type: 'reference' as const } : null,
        form.specificationImage ? { file: form.specificationImage, type: 'specification' as const } : null,
        form.reviewImage ? { file: form.reviewImage, type: 'review' as const } : null,
      ].filter(isImageInput);

      await createManualServiceChunk({
        vendorName: form.vendorName || undefined,
        city: form.city,
        medium: form.medium,
        minQty: numberValue(form.minQty),
        qtyMeasurementUnit: form.qtyMeasurementUnit || undefined,
        totalCost: numberValue(form.totalCost),
        displayCost: numberValue(form.displayCost),
        printingCost: numberValue(form.printingCost),
        mountingCost: numberValue(form.mountingCost),
        printingAndMountingCost: numberValue(form.printingAndMountingCost),
        rtoCertificate: form.rtoCertificate || undefined,
        location: form.location || undefined,
        traffic: form.traffic || undefined,
        displayWidth: numberValue(form.displayWidth),
        displayHeight: numberValue(form.displayHeight),
        displayMeasurementUnit: form.displayMeasurementUnit || undefined,
        minDuration: numberValue(form.minDuration),
        durationMeasurementUnit: form.durationMeasurementUnit || undefined,
        durationPerSpot: form.durationPerSpot || undefined,
        audioEnabled: form.audioEnabled,
        dayStart: form.dayStart || undefined,
        dayEnd: form.dayEnd || undefined,
        replacement: form.replacement || undefined,
        spotsPerDay: numberValue(form.spotsPerDay),
        leadTimeDays: numberValue(form.leadTimeDays),
        description: form.description || undefined,
        terms: form.terms || undefined,
        documentId: form.documentId || undefined,
        documentName: form.documentName || undefined,
        currency: 'INR',
        userId: user?.id,
        images,
      });

      toast({
        title: 'Service added',
        description: 'All entered columns were saved into metadata as a new service row.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      resetForm();
      onClose();
    } catch (error: any) {
      toast({
        title: 'Unable to add service',
        description: error.message || 'Please review the form and try again.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card variant="outline" borderRadius="xl" boxShadow="sm">
        <CardHeader pb={2}>
          <HStack justify="space-between" align="start">
            <Box>
              <Heading size="md" fontWeight="semibold">
                Manual Service Entry
              </Heading>
              <Text mt={1} fontSize="sm" color="gray.600">
                Enter Excel-style columns. All values are stored in metadata.
              </Text>
            </Box>
            <Badge colorScheme="green" borderRadius="full" px={3} py={1}>
              Insert Only
            </Badge>
          </HStack>
        </CardHeader>
        <CardBody pt={2}>
          <VStack align="stretch" spacing={4}>
            <Text fontSize="sm" color="gray.600">
              Fill Vendor, City, Medium, costs, display specs, duration, and operational fields. Submit creates one new `proposal_chunks` row.
            </Text>
            <Button leftIcon={<FiPlus />} colorScheme="brand" onClick={onOpen}>
              Add Service
            </Button>
          </VStack>
        </CardBody>
      </Card>

      <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Add Manual Service</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={8}>
              {/* Basic */}
              <Box>
                <Heading size="sm" mb={4}>
                  Basic
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Vendor Name</FormLabel>
                    <Input
                      value={form.vendorName}
                      onChange={(e) => setField('vendorName', e.target.value)}
                      placeholder="Vendor / Agency name"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>City</FormLabel>
                    <Input
                      value={form.city}
                      onChange={(e) => setField('city', e.target.value)}
                      placeholder="Madurai"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Medium</FormLabel>
                    <Input
                      value={form.medium}
                      onChange={(e) => setField('medium', e.target.value)}
                      placeholder="Helicopter / Bus Full Branding / Auto Semi..."
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Linked Proposal</FormLabel>
                    <Select
                      placeholder="Optional"
                      value={form.documentId}
                      onChange={(e) => handleProposalChange(e.target.value)}
                    >
                      {proposalOptions.map((proposal) => (
                        <option key={proposal.id} value={proposal.id}>
                          {proposal.name}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Quantity */}
              <Box>
                <Heading size="sm" mb={4}>
                  Quantity
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Min. Qty.</FormLabel>
                    <Input
                      type="number"
                      value={form.minQty}
                      onChange={(e) => setField('minQty', e.target.value)}
                      placeholder="10"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Qty Measurement Unit</FormLabel>
                    <Input
                      value={form.qtyMeasurementUnit}
                      onChange={(e) => setField('qtyMeasurementUnit', e.target.value)}
                      placeholder="units / vehicles / spots"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Costs */}
              <Box>
                <Heading size="sm" mb={4}>
                  Costs
                </Heading>
                <Text fontSize="xs" color="gray.500" mb={3}>
                  At least one cost field is required.
                </Text>
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Total Cost</FormLabel>
                    <Input
                      type="number"
                      value={form.totalCost}
                      onChange={(e) => setField('totalCost', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Display Cost</FormLabel>
                    <Input
                      type="number"
                      value={form.displayCost}
                      onChange={(e) => setField('displayCost', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Printing Cost</FormLabel>
                    <Input
                      type="number"
                      value={form.printingCost}
                      onChange={(e) => setField('printingCost', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Mounting Cost</FormLabel>
                    <Input
                      type="number"
                      value={form.mountingCost}
                      onChange={(e) => setField('mountingCost', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Printing &amp; Mounting Cost</FormLabel>
                    <Input
                      type="number"
                      value={form.printingAndMountingCost}
                      onChange={(e) => setField('printingAndMountingCost', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>RTO Certificate</FormLabel>
                    <Input
                      value={form.rtoCertificate}
                      onChange={(e) => setField('rtoCertificate', e.target.value)}
                      placeholder="Yes / No / amount / notes"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Location / traffic */}
              <Box>
                <Heading size="sm" mb={4}>
                  Location &amp; Traffic
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Location</FormLabel>
                    <Input
                      value={form.location}
                      onChange={(e) => setField('location', e.target.value)}
                      placeholder="Area / route / landmark"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Traffic</FormLabel>
                    <Input
                      value={form.traffic}
                      onChange={(e) => setField('traffic', e.target.value)}
                      placeholder="High / Medium / footfall count"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Display dimensions */}
              <Box>
                <Heading size="sm" mb={4}>
                  Display Specs
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Display Width</FormLabel>
                    <Input
                      type="number"
                      value={form.displayWidth}
                      onChange={(e) => setField('displayWidth', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Display Height</FormLabel>
                    <Input
                      type="number"
                      value={form.displayHeight}
                      onChange={(e) => setField('displayHeight', e.target.value)}
                      placeholder="0"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Display Measurement Unit</FormLabel>
                    <Input
                      value={form.displayMeasurementUnit}
                      onChange={(e) => setField('displayMeasurementUnit', e.target.value)}
                      placeholder="ft / inch / cm"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Duration */}
              <Box>
                <Heading size="sm" mb={4}>
                  Duration
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Min Duration</FormLabel>
                    <Input
                      type="number"
                      value={form.minDuration}
                      onChange={(e) => setField('minDuration', e.target.value)}
                      placeholder="30"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Measurement Unit</FormLabel>
                    <Input
                      value={form.durationMeasurementUnit}
                      onChange={(e) => setField('durationMeasurementUnit', e.target.value)}
                      placeholder="days / months"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Duration per Spot</FormLabel>
                    <Input
                      value={form.durationPerSpot}
                      onChange={(e) => setField('durationPerSpot', e.target.value)}
                      placeholder="10 sec / 30 sec"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Operations */}
              <Box>
                <Heading size="sm" mb={4}>
                  Operations
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Audio Enabled</FormLabel>
                    <Select
                      value={form.audioEnabled === null ? '' : form.audioEnabled ? 'yes' : 'no'}
                      onChange={(e) => {
                        const v = e.target.value;
                        setField('audioEnabled', v === '' ? null : v === 'yes');
                      }}
                    >
                      <option value="">Not set</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  </FormControl>

                  <FormControl>
                    <FormLabel>Day Start</FormLabel>
                    <Input
                      value={form.dayStart}
                      onChange={(e) => setField('dayStart', e.target.value)}
                      placeholder="06:00 / morning"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Day End</FormLabel>
                    <Input
                      value={form.dayEnd}
                      onChange={(e) => setField('dayEnd', e.target.value)}
                      placeholder="22:00 / night"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Replacement</FormLabel>
                    <Input
                      value={form.replacement}
                      onChange={(e) => setField('replacement', e.target.value)}
                      placeholder="Yes / No / policy"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>No. of Spots per day</FormLabel>
                    <Input
                      type="number"
                      value={form.spotsPerDay}
                      onChange={(e) => setField('spotsPerDay', e.target.value)}
                      placeholder="10"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Lead Time (in days)</FormLabel>
                    <Input
                      type="number"
                      value={form.leadTimeDays}
                      onChange={(e) => setField('leadTimeDays', e.target.value)}
                      placeholder="7"
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>

              {/* Extra text */}
              <Box>
                <Heading size="sm" mb={4}>
                  Description &amp; Terms
                </Heading>
                <Stack spacing={4}>
                  <FormControl>
                    <FormLabel>Description (optional)</FormLabel>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="Auto-generated from Medium + City if left empty. Used for AI search embedding."
                      rows={3}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Terms &amp; Conditions</FormLabel>
                    <Textarea
                      value={form.terms}
                      onChange={(e) => setField('terms', e.target.value)}
                      placeholder="GST extra. Artwork approval required."
                      rows={3}
                    />
                  </FormControl>
                </Stack>
              </Box>

              {/* Images */}
              <Box>
                <Heading size="sm" mb={4}>
                  Optional Images
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
                  <FormControl>
                    <FormLabel>Reference Image</FormLabel>
                    <Input
                      type="file"
                      accept="image/*"
                      p={1}
                      onChange={(e) => setField('referenceImage', e.target.files?.[0] || null)}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Specification Image</FormLabel>
                    <Input
                      type="file"
                      accept="image/*"
                      p={1}
                      onChange={(e) => setField('specificationImage', e.target.files?.[0] || null)}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Review Image</FormLabel>
                    <Input
                      type="file"
                      accept="image/*"
                      p={1}
                      onChange={(e) => setField('reviewImage', e.target.files?.[0] || null)}
                    />
                  </FormControl>
                </SimpleGrid>
              </Box>
            </Stack>
          </ModalBody>

          <ModalFooter>
            <HStack spacing={3}>
              <Button variant="ghost" onClick={onClose} isDisabled={submitting}>
                Cancel
              </Button>
              <Button colorScheme="brand" onClick={handleSubmit} isLoading={submitting}>
                Add Service
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ManualServiceEntry;

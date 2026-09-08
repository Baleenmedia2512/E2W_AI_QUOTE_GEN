import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Grid,
  GridItem,
  Input,
  Text,
  Textarea,
  VStack,
} from '@chakra-ui/react';
import { ClientInfo } from '../../types/client';
import { LeadSearchResult } from '../../types/lead';
import { AutocompleteInput } from '../AutocompleteInput';
import { searchLeads } from '../../services/leadService';

export const EMPTY_CLIENT: ClientInfo = {
  name: '',
  company: '',
  address: '',
  gst: '',
  phone: '',
  email: '',
};

interface ClientEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  client: ClientInfo | null;
  onSave: (client: ClientInfo) => void;
}

export const ClientEditDrawer: React.FC<ClientEditDrawerProps> = ({
  isOpen,
  onClose,
  client,
  onSave,
}) => {
  const [form, setForm] = useState<ClientInfo>(client || EMPTY_CLIENT);
  const [searchValue, setSearchValue] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof ClientInfo, string>>>({});

  useEffect(() => {
    if (isOpen) {
      setForm(client || EMPTY_CLIENT);
      setSearchValue('');
      setErrors({});
    }
  }, [isOpen, client]);

  const setField = (field: keyof ClientInfo, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleLeadSelect = (lead: LeadSearchResult) => {
    setForm({
      name: lead.name || '',
      company: form.company || '',
      address: lead.address || '',
      gst: form.gst || '',
      phone: lead.phone || '',
      email: lead.email || '',
    });
    setSearchValue('');
    setErrors({});
  };

  const onSearch = useCallback((term: string) => searchLeads(term), []);

  const validate = (): boolean => {
    const next: Partial<Record<keyof ClientInfo, string>> = {};
    if (!form.name.trim()) next.name = 'Client name is required';
    if (!form.phone.trim()) next.phone = 'Phone is required';
    else if (!/^\d{10}$/.test(form.phone.trim())) {
      next.phone = 'Phone number must contain exactly 10 digits';
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = 'Invalid email address';
    }
    if (form.gst && !/^[A-Z0-9]{2,15}$/i.test(form.gst.trim())) {
      next.gst = 'Invalid GST format';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      ...form,
      name: form.name.trim(),
      company: form.company.trim(),
      address: form.address.trim(),
      gst: form.gst.trim().toUpperCase(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    });
    onClose();
  };

  return (
    <Drawer isOpen={isOpen} placement="right" onClose={onClose} size="md">
      <DrawerOverlay />
      <DrawerContent>
        <DrawerCloseButton />
        <DrawerHeader borderBottomWidth="1px" color="brand.600">
          Edit Client
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4} align="stretch" pt={2}>
            <Box
              p={3}
              bg="brand.50"
              borderRadius="12px"
              border="1px solid"
              borderColor="brand.100"
            >
              <Text fontSize="13px" fontWeight="600" color="brand.700" mb={2}>
                Search Existing Leads
              </Text>
              <AutocompleteInput
                value={searchValue}
                onChange={setSearchValue}
                onSelect={handleLeadSelect}
                onSearch={onSearch}
                placeholder="Search by name, phone, or email..."
                size="md"
              />
              <Text fontSize="11px" color="gray.500" mt={1.5}>
                Select a lead to auto-fill, then edit if needed.
              </Text>
            </Box>

            <Grid templateColumns={{ base: '1fr', sm: '1fr 1fr' }} gap={3}>
              <GridItem colSpan={{ base: 1, sm: 2 }}>
                <FormControl isRequired isInvalid={!!errors.name}>
                  <FormLabel fontSize="sm">Client Name</FormLabel>
                  <Input
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="Enter client name"
                  />
                  <FormErrorMessage>{errors.name}</FormErrorMessage>
                </FormControl>
              </GridItem>

              <GridItem>
                <FormControl>
                  <FormLabel fontSize="sm">Company Name</FormLabel>
                  <Input
                    value={form.company}
                    onChange={(e) => setField('company', e.target.value)}
                    placeholder="Enter company name"
                  />
                </FormControl>
              </GridItem>

              <GridItem>
                <FormControl isRequired isInvalid={!!errors.phone}>
                  <FormLabel fontSize="sm">Phone</FormLabel>
                  <Input
                    value={form.phone}
                    onChange={(e) =>
                      setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                    placeholder="Enter phone"
                  />
                  <FormErrorMessage>{errors.phone}</FormErrorMessage>
                </FormControl>
              </GridItem>

              <GridItem colSpan={{ base: 1, sm: 2 }}>
                <FormControl>
                  <FormLabel fontSize="sm">Address</FormLabel>
                  <Textarea
                    value={form.address}
                    onChange={(e) => setField('address', e.target.value)}
                    placeholder="Enter client address"
                    rows={2}
                  />
                </FormControl>
              </GridItem>

              <GridItem>
                <FormControl isInvalid={!!errors.gst}>
                  <FormLabel fontSize="sm">GST Number</FormLabel>
                  <Input
                    value={form.gst}
                    onChange={(e) => setField('gst', e.target.value)}
                    placeholder="Enter GST number"
                  />
                  <FormErrorMessage>{errors.gst}</FormErrorMessage>
                </FormControl>
              </GridItem>

              <GridItem>
                <FormControl isInvalid={!!errors.email}>
                  <FormLabel fontSize="sm">Email</FormLabel>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="Enter email"
                  />
                  <FormErrorMessage>{errors.email}</FormErrorMessage>
                </FormControl>
              </GridItem>
            </Grid>
          </VStack>
        </DrawerBody>
        <DrawerFooter borderTopWidth="1px" gap={2}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button bg="brand.500" color="white" _hover={{ bg: 'brand.600' }} onClick={handleSave}>
            Save Client
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default ClientEditDrawer;

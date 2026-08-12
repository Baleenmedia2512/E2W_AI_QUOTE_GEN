import React, { useCallback, useEffect, useState } from 'react';
import { Box, FormControl, FormLabel, Input, SimpleGrid } from '@chakra-ui/react';
import { ClientInfo } from '../../types/client';
import { LeadSearchResult } from '../../types/lead';
import { AutocompleteInput } from '../AutocompleteInput';
import { searchLeads } from '../../services/leadService';

interface PreparedForClientFieldsProps {
  client: ClientInfo;
  onChange: (client: ClientInfo) => void;
  showValidation?: boolean;
}

/**
 * Inline Quote Prepared For editor: Name (lead search), Phone, Email — no address/GST.
 */
export const PreparedForClientFields: React.FC<PreparedForClientFieldsProps> = ({
  client,
  onChange,
  showValidation = false,
}) => {
  const nameMissing = !(client.name || '').trim();
  const phoneMissing = !/^\d{10}$/.test((client.phone || '').trim());
  const [nameQuery, setNameQuery] = useState(client.name || '');

  useEffect(() => {
    setNameQuery(client.name || '');
  }, [client.name]);

  const patch = (partial: Partial<ClientInfo>) => {
    onChange({
      name: client.name || '',
      company: client.company || '',
      address: client.address || '',
      gst: client.gst || '',
      phone: client.phone || '',
      email: client.email || '',
      ...partial,
    });
  };

  const onSearch = useCallback((term: string) => searchLeads(term), []);

  const handleLeadSelect = (lead: LeadSearchResult) => {
    const name = lead.name || '';
    setNameQuery(name);
    patch({
      name,
      phone: lead.phone || '',
      email: lead.email || '',
      // Keep address/GST out of the form; still store lead address if present for later use
      address: lead.address || client.address || '',
    });
  };

  return (
    <Box
      className="client-section client-section--editable"
      data-pdf-exclude="true"
      p={3}
      bg="#f0f7fc"
      borderRadius="8px"
      borderLeft="4px solid"
      borderLeftColor="#2980b9"
      mb={3}
    >
      <FormLabel
        mb={2}
        fontSize="11px"
        fontWeight="700"
        color="#2980b9"
        textTransform="uppercase"
        letterSpacing="0.04em"
      >
        Quote Prepared For
      </FormLabel>
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
        <FormControl>
          <FormLabel fontSize="12px" mb={1} color="gray.600">
            Name <Box as="span" color="red.500">*</Box>
          </FormLabel>
          <AutocompleteInput
            value={nameQuery}
            onChange={(v) => {
              setNameQuery(v);
              patch({ name: v });
            }}
            onSelect={handleLeadSelect}
            onSearch={onSearch}
            placeholder="Search or type name..."
            size="sm"
            isInvalid={nameMissing}
          />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="12px" mb={1} color="gray.600">
            Phone <Box as="span" color="red.500">*</Box>
          </FormLabel>
          <Input
            size="sm"
            value={client.phone || ''}
            onChange={(e) => patch({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            placeholder="Phone"
            bg="white"
            borderWidth="2px"
            borderColor={phoneMissing ? 'red.300' : undefined}
            borderRadius="12px"
            _hover={{ borderColor: 'red.300' }}
            _focus={{
              borderColor: phoneMissing ? 'red.500' : 'blue.500',
              boxShadow: phoneMissing ? '0 0 0 3px rgba(201, 31, 61, 0.15)' : undefined,
            }}
          />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="12px" mb={1} color="gray.600">
            Email
          </FormLabel>
          <Input
            size="sm"
            type="email"
            value={client.email || ''}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="Email"
            bg="white"
            borderRadius="8px"
          />
        </FormControl>
      </SimpleGrid>
    </Box>
  );
};

export default PreparedForClientFields;

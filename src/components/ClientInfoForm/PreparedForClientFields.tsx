import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, FormControl, FormLabel, Input, SimpleGrid } from '@chakra-ui/react';
import { ClientInfo } from '../../types/client';
import { LeadSearchResult } from '../../types/lead';
import { AutocompleteInput } from '../AutocompleteInput';
import { savePreparedForLead, searchLeads } from '../../services/leadService';

interface PreparedForClientFieldsProps {
  client: ClientInfo;
  onChange: (client: ClientInfo) => void;
  showValidation?: boolean;
}

const LEAD_SAVE_DEBOUNCE_MS = 800;

/**
 * Inline Quote Prepared For editor: Name (lead search), Phone, Email — no address/GST.
 * When Name + valid 10-digit Phone are set, silently upserts the Lead row (status "new" on insert).
 */
export const PreparedForClientFields: React.FC<PreparedForClientFieldsProps> = ({
  client,
  onChange,
  showValidation = false,
}) => {
  const nameMissing = !(client.name || '').trim();
  const phoneMissing = !/^\d{10}$/.test((client.phone || '').trim());
  const [nameQuery, setNameQuery] = useState(client.name || '');
  const lastSavedKeyRef = useRef<string>('');
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    setNameQuery(client.name || '');
  }, [client.name]);

  /** Silent Lead upsert — never blocks or changes preview UI. */
  const persistLead = useCallback((info?: ClientInfo) => {
    const c = info || clientRef.current;
    const name = (c.name || '').trim();
    const phone = (c.phone || '').trim();
    const email = (c.email || '').trim();
    if (!name || !/^\d{10}$/.test(phone)) {
      return;
    }

    const key = `${name}|${phone}|${email}`;
    if (key === lastSavedKeyRef.current) {
      return;
    }

    void savePreparedForLead({ name, phone, email }).then((saved) => {
      if (saved) {
        lastSavedKeyRef.current = key;
      }
    });
  }, []);

  // Debounced save while typing (Name + valid Phone).
  useEffect(() => {
    const name = (client.name || '').trim();
    const phone = (client.phone || '').trim();
    if (!name || !/^\d{10}$/.test(phone)) {
      return;
    }

    const timer = window.setTimeout(() => persistLead(), LEAD_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [client.name, client.phone, client.email, persistLead]);

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
    const next: ClientInfo = {
      name,
      company: client.company || '',
      address: lead.address || client.address || '',
      gst: client.gst || '',
      phone: lead.phone || '',
      email: lead.email || '',
    };
    setNameQuery(name);
    patch({
      name: next.name,
      phone: next.phone,
      email: next.email,
      address: next.address,
    });
    persistLead(next);
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
            onBlur={() => persistLead()}
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
            onBlur={() => persistLead()}
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

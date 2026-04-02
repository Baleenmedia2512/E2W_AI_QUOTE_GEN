import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Input,
  List,
  ListItem,
  Text,
  Spinner,
  InputGroup,
  InputRightElement,
  useOutsideClick,
} from '@chakra-ui/react';
import { LeadSearchResult } from '../../types/lead';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (lead: LeadSearchResult) => void;
  onSearch: (searchTerm: string) => Promise<LeadSearchResult[]>;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  isDisabled?: boolean;
  isInvalid?: boolean;
  debounceMs?: number;
}

export const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  value,
  onChange,
  onSelect,
  onSearch,
  placeholder = 'Start typing to search...',
  size = 'lg',
  isDisabled = false,
  isInvalid = false,
  debounceMs = 300,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<LeadSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useOutsideClick({
    ref: listRef,
    handler: () => setIsOpen(false),
  });

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (value.length >= 2) {
        console.log('🔍 Autocomplete: Searching for:', value);
        setIsLoading(true);
        setHasSearched(false);
        const results = await onSearch(value);
        console.log('✅ Autocomplete: Got results:', results.length, results);
        setSuggestions(results);
        setIsOpen(true); // Always open to show results or "no results" message
        setHasSearched(true);
        setIsLoading(false);
        setSelectedIndex(-1);
      } else {
        setSuggestions([]);
        setIsOpen(false);
        setHasSearched(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, onSearch, debounceMs]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleSelect = (lead: LeadSearchResult) => {
    onSelect(lead);
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const formatDisplay = (lead: LeadSearchResult): string => {
    return lead.name;
  };

  return (
    <Box position="relative" ref={listRef}>
      <InputGroup size={size}>
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          isDisabled={isDisabled}
          isInvalid={isInvalid}
          bg="white"
          borderWidth="2px"
          borderColor={isInvalid ? 'red.500' : 'gray.300'}
          fontWeight="500"
          _hover={{ 
            borderColor: 'red.300', 
            boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' 
          }}
          _focus={{ 
            borderColor: 'red.500', 
            boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
            bg: 'white'
          }}
          borderRadius="12px"
          autoComplete="off"
        />
        {isLoading && (
          <InputRightElement>
            <Spinner size="sm" color="red.500" />
          </InputRightElement>
        )}
      </InputGroup>

      {isOpen && suggestions.length > 0 && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={2}
          bg="white"
          borderWidth="2px"
          borderColor="gray.200"
          borderRadius="12px"
          boxShadow="xl"
          zIndex={1000}
          maxH="300px"
          overflowY="auto"
        >
          <List spacing={0}>
            {suggestions.map((lead, index) => (
              <ListItem
                key={lead.id}
                px={4}
                py={3}
                cursor="pointer"
                bg={selectedIndex === index ? 'red.50' : 'white'}
                borderBottomWidth={index < suggestions.length - 1 ? '1px' : '0'}
                borderBottomColor="gray.100"
                onClick={() => handleSelect(lead)}
                _hover={{ 
                  bg: 'red.50',
                  borderLeftWidth: '3px',
                  borderLeftColor: 'red.500',
                }}
                transition="all 0.15s"
              >
                <Text 
                  fontSize="sm" 
                  fontWeight="600" 
                  color="gray.800"
                  mb={1}
                >
                  {formatDisplay(lead)}
                </Text>
                <Text fontSize="xs" color="gray.600" lineHeight="1.4">
                  {[
                    lead.phone,
                    lead.email,
                    lead.address,
                    lead.city,
                    lead.state,
                    lead.pincode,
                    lead.campaign,
                    lead.source
                  ].filter(Boolean).join(' | ')}
                </Text>
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {isOpen && suggestions.length === 0 && hasSearched && !isLoading && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={2}
          bg="white"
          borderWidth="2px"
          borderColor="gray.200"
          borderRadius="12px"
          boxShadow="lg"
          zIndex={1000}
          px={4}
          py={3}
        >
          <Text fontSize="sm" color="gray.500" textAlign="center">
            No leads found for "{value}"
          </Text>
        </Box>
      )}
    </Box>
  );
};

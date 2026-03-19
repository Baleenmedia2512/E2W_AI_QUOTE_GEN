import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  VStack,
  HStack,
  Heading,
  FormErrorMessage,
  Grid,
  GridItem,
  Text,
} from '@chakra-ui/react';
import { ClientInfo } from '../../types/client';
import './ClientInfoForm.css';

interface ClientInfoFormProps {
  onSubmit: (clientInfo: ClientInfo) => void;
  onBack?: () => void;
  initialData?: ClientInfo | null;
}

const ClientInfoForm: React.FC<ClientInfoFormProps> = ({ onSubmit, onBack, initialData }) => {
  const [formData, setFormData] = useState<ClientInfo>({
    name: '',
    company: '',
    address: '',
    gst: '',
    phone: '',
    email: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof ClientInfo, string>>>({});

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleInputChange = (field: keyof ClientInfo, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof ClientInfo, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }

    if (!formData.company.trim()) {
      newErrors.company = 'Company name is required';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else if (!/^\+?[\d\s-()]+$/.test(formData.phone)) {
      newErrors.phone = 'Invalid phone number';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }

    if (formData.gst && !/^[A-Z0-9]{2,15}$/.test(formData.gst.trim())) {
      newErrors.gst = 'Invalid GST format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const handleClearForm = () => {
    setFormData({
      name: '',
      company: '',
      address: '',
      gst: '',
      phone: '',
      email: '',
    });
    setErrors({});
  };

  return (
    <Box className="client-info-form" py={8}>
      {/* Section Title */}
      <Heading 
        size="lg" 
        fontWeight="500" 
        color="gray.900" 
        mb={8}
        fontFamily="'DM Sans', sans-serif"
      >
        Client Information
      </Heading>

      <form onSubmit={handleSubmit}>
        <VStack spacing={6} align="stretch">
          {/* Client Name and Company Name - Two Column */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={6}>
            <GridItem>
              <FormControl isRequired isInvalid={!!errors.name}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                  Client Name <Text as="span" color="red.500">*</Text>
                </FormLabel>
                <Input
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="ramesh"
                  size="lg"
                  bg="white"
                  borderColor="gray.300"
                  _hover={{ borderColor: 'gray.400' }}
                  _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                  borderRadius="8px"
                />
                <FormErrorMessage>{errors.name}</FormErrorMessage>
              </FormControl>
            </GridItem>

            <GridItem>
              <FormControl isRequired isInvalid={!!errors.company}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                  Company Name <Text as="span" color="red.500">*</Text>
                </FormLabel>
                <Input
                  value={formData.company}
                  onChange={(e) => handleInputChange('company', e.target.value)}
                  placeholder="Ram Enterprises"
                  size="lg"
                  bg="white"
                  borderColor="gray.300"
                  _hover={{ borderColor: 'gray.400' }}
                  _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                  borderRadius="8px"
                />
                <FormErrorMessage>{errors.company}</FormErrorMessage>
              </FormControl>
            </GridItem>
          </Grid>

          {/* Address - Full Width (but max 50% width) */}
          <Box maxW={{ base: '100%', md: '50%' }}>
            <FormControl isRequired isInvalid={!!errors.address}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Address <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Textarea
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Madurai"
                rows={3}
                size="lg"
                bg="white"
                borderColor="gray.300"
                _hover={{ borderColor: 'gray.400' }}
                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                borderRadius="8px"
              />
              <FormErrorMessage>{errors.address}</FormErrorMessage>
            </FormControl>
          </Box>

          {/* GST Number and Phone - Two Column */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={6}>
            <GridItem>
              <FormControl isInvalid={!!errors.gst}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                  GST Number <Text as="span" color="gray.500" fontWeight="400">(Optional)</Text>
                </FormLabel>
                <Input
                  value={formData.gst}
                  onChange={(e) => handleInputChange('gst', e.target.value)}
                  placeholder="Enter GST number"
                  size="lg"
                  bg="white"
                  borderColor="gray.300"
                  _hover={{ borderColor: 'gray.400' }}
                  _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                  borderRadius="8px"
                />
                <FormErrorMessage>{errors.gst}</FormErrorMessage>
              </FormControl>
            </GridItem>

            <GridItem>
              <FormControl isRequired isInvalid={!!errors.phone}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                  Phone <Text as="span" color="red.500">*</Text>
                </FormLabel>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  placeholder="9360381404"
                  type="tel"
                  size="lg"
                  bg="white"
                  borderColor="gray.300"
                  _hover={{ borderColor: 'gray.400' }}
                  _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                  borderRadius="8px"
                />
                <FormErrorMessage>{errors.phone}</FormErrorMessage>
              </FormControl>
            </GridItem>
          </Grid>

          {/* Email - Half Width */}
          <Box maxW={{ base: '100%', md: '50%' }}>
            <FormControl isRequired isInvalid={!!errors.email}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Email <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Input
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="rameshbalapr3@gmail.com"
                type="email"
                size="lg"
                bg="white"
                borderColor="gray.300"
                _hover={{ borderColor: 'gray.400' }}
                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                borderRadius="8px"
              />
              <FormErrorMessage>{errors.email}</FormErrorMessage>
            </FormControl>
          </Box>

          {/* Footer Buttons - All Outlined Style */}
          <HStack justify="flex-end" spacing={3} pt={6}>
            {onBack && (
              <Button
                onClick={onBack}
                variant="outline"
                size="lg"
                borderColor="gray.300"
                color="gray.700"
                fontWeight="500"
                _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleClearForm}
              variant="outline"
              size="lg"
              borderColor="gray.300"
              color="gray.700"
              fontWeight="500"
              _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
            >
              Clear
            </Button>
            <Button
              type="submit"
              variant="outline"
              size="lg"
              borderColor="gray.300"
              color="gray.700"
              fontWeight="500"
              _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
            >
              Continue
            </Button>
          </HStack>
        </VStack>
      </form>
    </Box>
  );
};

export default ClientInfoForm;

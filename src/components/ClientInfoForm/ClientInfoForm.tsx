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

    // MANDATORY: Client Name
    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }

    // MANDATORY: Phone
    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else if (!/^\+?[\d\s-()]+$/.test(formData.phone)) {
      newErrors.phone = 'Invalid phone number';
    }

    // OPTIONAL: Email (validate format only if provided)
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }

    // OPTIONAL: GST (validate format only if provided)
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
      <Box mb={8}>
        <Heading 
          size="xl" 
          fontWeight="800" 
          bgGradient="linear(135deg, #C91F3D, #B31B3E, #7A1030)" 
          bgClip="text"
          letterSpacing="tight"
          mb={1}
        >
          Client Information
        </Heading>
        <Text fontSize="sm" color="gray.600" fontWeight="500">
          Tell us about your client
        </Text>
      </Box>

      <form onSubmit={handleSubmit}>
        <VStack spacing={6} align="stretch">
          {/* Client Name and Company Name - Two Column */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={6}>
            <GridItem>
              <FormControl isRequired isInvalid={!!errors.name}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Client Name <Text as="span" color="red.500">*</Text>
                </FormLabel>
                <Input
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                  placeholder="Enter client name"
                  size="lg"
                  bg="white"
                  borderWidth="2px"
                  borderColor="gray.300"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{ 
                    borderColor: 'red.500', 
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white'
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.name}</FormErrorMessage>
              </FormControl>
            </GridItem>

            <GridItem>
              <FormControl isInvalid={!!errors.company}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Company Name <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">(Optional)</Text>
                </FormLabel>
                <Input
                  value={formData.company}
                  onChange={(e) => handleInputChange('company', e.target.value)}
                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                  placeholder="Enter company name"
                  size="lg"
                  bg="white"
                  borderWidth="2px"
                  borderColor="gray.300"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{ 
                    borderColor: 'red.500', 
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white'
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.company}</FormErrorMessage>
              </FormControl>
            </GridItem>
          </Grid>

          {/* Address - Full Width (but max 50% width) */}
          <Box maxW={{ base: '100%', md: '50%' }}>
            <FormControl isInvalid={!!errors.address}>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Address <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">(Optional)</Text>
              </FormLabel>
              <Textarea
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                placeholder="Enter client address"
                rows={3}
                size="lg"
                bg="white"
                borderWidth="2px"
                borderColor="gray.300"
                fontWeight="500"
                _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                _focus={{ 
                  borderColor: 'red.500', 
                  boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                  bg: 'white'
                }}
                borderRadius="12px"
              />
              <FormErrorMessage fontWeight="500">{errors.address}</FormErrorMessage>
            </FormControl>
          </Box>

          {/* GST Number and Phone - Two Column */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={6}>
            <GridItem>
              <FormControl isInvalid={!!errors.gst}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  GST Number <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">(Optional)</Text>
                </FormLabel>
                <Input
                  value={formData.gst}
                  onChange={(e) => handleInputChange('gst', e.target.value)}
                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                  placeholder="Enter GST number"
                  size="lg"
                  bg="white"
                  borderWidth="2px"
                  borderColor="gray.300"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{ 
                    borderColor: 'red.500', 
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white'
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.gst}</FormErrorMessage>
              </FormControl>
            </GridItem>

            <GridItem>
              <FormControl isRequired isInvalid={!!errors.phone}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Phone <Text as="span" color="red.500">*</Text>
                </FormLabel>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                  placeholder="+1 (555) 000-0000"
                  type="tel"
                  size="lg"
                  bg="white"
                  borderWidth="2px"
                  borderColor="gray.300"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{ 
                    borderColor: 'red.500', 
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white'
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.phone}</FormErrorMessage>
              </FormControl>
            </GridItem>
          </Grid>

          {/* Email - Half Width */}
          <Box maxW={{ base: '100%', md: '50%' }}>
            <FormControl isInvalid={!!errors.email}>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Email <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">(Optional)</Text>
              </FormLabel>
              <Input
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                onFocus={(e) => { const t = e.target; setTimeout(() => t.select(), 300); }}
                placeholder="client@example.com"
                type="email"
                size="lg"
                bg="white"
                borderWidth="2px"
                borderColor="gray.300"
                fontWeight="500"
                _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                _focus={{ 
                  borderColor: 'red.500', 
                  boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                  bg: 'white'
                }}
                borderRadius="12px"
              />
              <FormErrorMessage fontWeight="500">{errors.email}</FormErrorMessage>
            </FormControl>
          </Box>

          {/* Footer Buttons - Brand themed with gradient */}
          <HStack justify="flex-end" spacing={4} pt={8}>
            {onBack && (
              <Button
                onClick={onBack}
                variant="outline"
                size="lg"
                borderWidth="2px"
                borderColor="gray.300"
                color="gray.700"
                fontWeight="600"
                px={8}
                borderRadius="12px"
                _hover={{ 
                  bg: 'gray.50', 
                  borderColor: 'gray.400',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                }}
                _active={{ transform: 'scale(0.98)' }}
              >
                ← Back
              </Button>
            )}
            <Button
              onClick={handleClearForm}
              variant="outline"
              size="lg"
              borderWidth="2px"
              borderColor="gray.300"
              color="gray.700"
              fontWeight="600"
              px={8}
              borderRadius="12px"
              _hover={{ 
                bg: 'gray.50', 
                borderColor: 'gray.400',
                transform: 'translateY(-2px)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
              }}
              _active={{ transform: 'scale(0.98)' }}
            >
              🔄 Clear
            </Button>
            <Button
              type="submit"
              size="lg"
              bgGradient="linear(to-r, #C91F3D, #B31B3E)"
              color="white"
              fontWeight="600"
              px={10}
              borderRadius="12px"
              boxShadow="0 4px 16px rgba(201, 31, 61, 0.3)"
              _hover={{ 
                bgGradient: 'linear(to-r, #B31B3E, #9f1239)',
                transform: 'translateY(-2px)',
                boxShadow: '0 6px 20px rgba(201, 31, 61, 0.4)'
              }}
              _active={{ transform: 'scale(0.98)' }}
            >
              Continue →
            </Button>
          </HStack>
        </VStack>
      </form>
    </Box>
  );
};

export default ClientInfoForm;

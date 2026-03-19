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
  Avatar,
  Center,
  Text,
  Icon,
} from '@chakra-ui/react';
import { FiUploadCloud } from 'react-icons/fi';
import { CompanyInfo } from '../../types/company';
import { saveCompanyInfo, loadCompanyInfo } from '../../utils/localStorage';
import './CompanyInfoForm.css';

interface CompanyInfoFormProps {
  onSubmit: (companyInfo: CompanyInfo) => void;
  initialData?: CompanyInfo | null;
}

const CompanyInfoForm: React.FC<CompanyInfoFormProps> = ({ onSubmit, initialData }) => {
  const [formData, setFormData] = useState<CompanyInfo>({
    name: '',
    address: '',
    gst: '',
    phone: '',
    email: '',
    logo: '',
    website: '',
    signature: '',
    designation: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof CompanyInfo, string>>>({});
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [useSaved, setUseSaved] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
      if (initialData.logo) {
        setLogoPreview(initialData.logo);
      }
    }
  }, [initialData]);

  const handleInputChange = (field: keyof CompanyInfo, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setLogoPreview(base64String);
        setFormData(prev => ({ ...prev, logo: base64String }));
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof CompanyInfo, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Company name is required';
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
      saveCompanyInfo(formData);
    }
  };

  const handleUseSavedInfo = () => {
    const savedInfo = loadCompanyInfo();
    if (savedInfo) {
      setFormData(savedInfo);
      if (savedInfo.logo) {
        setLogoPreview(savedInfo.logo);
      }
      setUseSaved(true);
    }
  };

  const handleClearForm = () => {
    setFormData({
      name: '',
      address: '',
      gst: '',
      phone: '',
      email: '',
      logo: '',
      website: '',
      signature: '',
      designation: '',
    });
    setLogoPreview('');
    setErrors({});
    setUseSaved(false);
  };

  return (
    <Box className="company-form-card" py={8}>
      {/* Section Title with Use Saved Info Button */}
      <HStack justify="space-between" flexWrap="wrap" gap={2} mb={8}>
        <Heading 
          size="lg" 
          fontWeight="500" 
          color="gray.900" 
          fontFamily="'DM Sans', sans-serif"
        >
          Company Information
        </Heading>
        {loadCompanyInfo() && !useSaved && (
          <Button 
            size="md" 
            variant="outline" 
            borderColor="gray.300"
            color="gray.700"
            fontWeight="500"
            _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
            onClick={handleUseSavedInfo}
          >
            Use Saved Info
          </Button>
        )}
      </HStack>

      <form onSubmit={handleSubmit}>
        <VStack spacing={6} align="stretch">
            {/* Logo Upload - Circular Avatar Style */}
            <FormControl>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700" mb={3}>
                Company Logo <Text as="span" color="gray.500" fontWeight="400">(Optional)</Text>
              </FormLabel>
              <Center>
                <VStack spacing={3}>
                  <Box position="relative">
                    {logoPreview ? (
                      <Avatar
                        src={logoPreview}
                        size="2xl"
                        bg="gray.100"
                        border="3px solid"
                        borderColor="blue.500"
                      />
                    ) : (
                      <Avatar
                        size="2xl"
                        bg="blue.50"
                        icon={<Icon as={FiUploadCloud} boxSize={10} color="blue.500" />}
                        border="3px dashed"
                        borderColor="gray.300"
                      />
                    )}
                  </Box>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    display="none"
                    id="logo-upload"
                  />
                  <Button 
                    as="label" 
                    htmlFor="logo-upload" 
                    size="sm"
                    variant="outline"
                    borderColor="gray.300"
                    color="gray.700"
                    fontWeight="500"
                    cursor="pointer"
                    _hover={{ bg: 'gray.50', borderColor: 'gray.400' }}
                  >
                    {logoPreview ? 'Change Logo' : 'Upload Logo'}
                  </Button>
                </VStack>
              </Center>
            </FormControl>

            {/* Company Name - Full Width */}
            <FormControl isRequired isInvalid={!!errors.name}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Company Name <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Input
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Enter company name"
                size="lg"
                borderColor="gray.300"
                _hover={{ borderColor: 'gray.400' }}
                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                borderRadius="8px"
              />
              <FormErrorMessage>{errors.name}</FormErrorMessage>
            </FormControl>

            {/* Address - Full Width */}
            <FormControl isRequired isInvalid={!!errors.address}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Address <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Textarea
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Enter company address"
                rows={3}
                size="lg"
                borderColor="gray.300"
                _hover={{ borderColor: 'gray.400' }}
                _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                borderRadius="8px"
              />
              <FormErrorMessage>{errors.address}</FormErrorMessage>
            </FormControl>

            {/* GST and Phone - Two Column Grid */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
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
                    placeholder="Enter phone number"
                    type="tel"
                    size="lg"
                    borderColor="gray.300"
                    _hover={{ borderColor: 'gray.400' }}
                    _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                    borderRadius="8px"
                  />
                  <FormErrorMessage>{errors.phone}</FormErrorMessage>
                </FormControl>
              </GridItem>
            </Grid>

            {/* Email and Website - Two Column Grid */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
              <GridItem>
                <FormControl isRequired isInvalid={!!errors.email}>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                    Email <Text as="span" color="red.500">*</Text>
                  </FormLabel>
                  <Input
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="Enter email address"
                    type="email"
                    size="lg"
                    borderColor="gray.300"
                    _hover={{ borderColor: 'gray.400' }}
                    _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                    borderRadius="8px"
                  />
                  <FormErrorMessage>{errors.email}</FormErrorMessage>
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                    Website <Text as="span" color="gray.500" fontWeight="400">(Optional)</Text>
                  </FormLabel>
                  <Input
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    placeholder="Enter website URL"
                    type="url"
                    size="lg"
                    borderColor="gray.300"
                    _hover={{ borderColor: 'gray.400' }}
                    _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                    borderRadius="8px"
                  />
                </FormControl>
              </GridItem>
            </Grid>

            {/* Designation and Signature - Two Column Grid */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
              <GridItem>
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                    Designation <Text as="span" color="gray.500" fontWeight="400">(Optional)</Text>
                  </FormLabel>
                  <Input
                    value={formData.designation}
                    onChange={(e) => handleInputChange('designation', e.target.value)}
                    placeholder="e.g., Managing Director"
                    size="lg"
                    borderColor="gray.300"
                    _hover={{ borderColor: 'gray.400' }}
                    _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                    borderRadius="8px"
                  />
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                    Signature Name <Text as="span" color="gray.500" fontWeight="400">(Optional)</Text>
                  </FormLabel>
                  <Input
                    value={formData.signature}
                    onChange={(e) => handleInputChange('signature', e.target.value)}
                    placeholder="Enter signatory name"
                    size="lg"
                    borderColor="gray.300"
                    _hover={{ borderColor: 'gray.400' }}
                    _focus={{ borderColor: '#750926', boxShadow: '0 0 0 1px #750926' }}
                    borderRadius="8px"
                  />
                </FormControl>
              </GridItem>
            </Grid>

            {/* Footer Buttons - Changed to match Client form (outline buttons) */}
            <HStack justify="flex-end" spacing={3} pt={6}>
              <Button 
                variant="outline" 
                onClick={handleClearForm}
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
                size="lg"
                variant="outline"
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

export default CompanyInfoForm;

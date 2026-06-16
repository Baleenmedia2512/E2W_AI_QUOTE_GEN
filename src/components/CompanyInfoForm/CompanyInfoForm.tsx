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
import React, { useState, useEffect } from 'react';
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
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setLogoPreview(base64String);
        setFormData((prev) => ({ ...prev, logo: base64String }));
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
      <HStack justify="space-between" flexWrap="wrap" gap={3} mb={8}>
        <Box>
          <Heading
            size="xl"
            fontWeight="800"
            bgGradient="linear(135deg, #C91F3D, #B31B3E, #7A1030)"
            bgClip="text"
            letterSpacing="tight"
            mb={1}
          >
            Company Information
          </Heading>
          <Text fontSize="sm" color="gray.600" fontWeight="500">
            Tell us about your company
          </Text>
        </Box>
        {loadCompanyInfo() && !useSaved && (
          <Button
            size="md"
            variant="outline"
            borderColor="red.300"
            color="red.600"
            fontWeight="600"
            borderRadius="12px"
            px={6}
            _hover={{
              bg: 'red.50',
              borderColor: 'red.400',
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 12px rgba(201, 31, 61, 0.2)',
            }}
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
            <FormLabel fontSize="sm" fontWeight="700" color="gray.800" mb={4}>
              Company Logo{' '}
              <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">
                (Optional)
              </Text>
            </FormLabel>
            <Center>
              <VStack spacing={4}>
                <Box
                  position="relative"
                  _hover={{ transform: 'scale(1.02)' }}
                  transition="all 0.3s"
                >
                  {logoPreview ? (
                    <Avatar
                      src={logoPreview}
                      size="2xl"
                      bg="gray.100"
                      border="4px solid"
                      borderColor="red.500"
                      boxShadow="0 8px 24px rgba(201, 31, 61, 0.25)"
                    />
                  ) : (
                    <Avatar
                      size="2xl"
                      bgGradient="linear(135deg, #FFF5F7, #FFECF0)"
                      icon={<Icon as={FiUploadCloud} boxSize={12} color="red.500" />}
                      border="4px dashed"
                      borderColor="red.300"
                      boxShadow="0 4px 12px rgba(201, 31, 61, 0.1)"
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
                  size="md"
                  bgGradient="linear(to-r, #C91F3D, #B31B3E)"
                  color="white"
                  fontWeight="600"
                  cursor="pointer"
                  px={8}
                  borderRadius="12px"
                  boxShadow="0 4px 12px rgba(201, 31, 61, 0.3)"
                  _hover={{
                    bgGradient: 'linear(to-r, #B31B3E, #9f1239)',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 6px 16px rgba(201, 31, 61, 0.4)',
                  }}
                  _active={{
                    transform: 'scale(0.98)',
                  }}
                >
                  {logoPreview ? '📸 Change Logo' : '⬆️ Upload Logo'}
                </Button>
              </VStack>
            </Center>
          </FormControl>

          {/* Company Name - Full Width */}
          <FormControl isRequired isInvalid={!!errors.name}>
            <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
              Company Name{' '}
              <Text as="span" color="red.500">
                *
              </Text>
            </FormLabel>
            <Input
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              onFocus={(e) => {
                const t = e.target;
                setTimeout(() => t.select(), 300);
              }}
              placeholder="Enter your company name"
              size="lg"
              borderWidth="2px"
              borderColor="gray.300"
              bg="white"
              fontWeight="500"
              _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
              _focus={{
                borderColor: 'red.500',
                boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                bg: 'white',
              }}
              borderRadius="12px"
            />
            <FormErrorMessage fontWeight="500">{errors.name}</FormErrorMessage>
          </FormControl>

          {/* Address - Full Width */}
          <FormControl isRequired isInvalid={!!errors.address}>
            <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
              Address{' '}
              <Text as="span" color="red.500">
                *
              </Text>
            </FormLabel>
            <Textarea
              value={formData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
              onFocus={(e) => {
                const t = e.target;
                setTimeout(() => t.select(), 300);
              }}
              placeholder="Enter your complete business address"
              rows={3}
              size="lg"
              borderWidth="2px"
              borderColor="gray.300"
              bg="white"
              fontWeight="500"
              _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
              _focus={{
                borderColor: 'red.500',
                boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                bg: 'white',
              }}
              borderRadius="12px"
            />
            <FormErrorMessage fontWeight="500">{errors.address}</FormErrorMessage>
          </FormControl>

          {/* GST and Phone - Two Column Grid */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
            <GridItem>
              <FormControl isInvalid={!!errors.gst}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  GST Number{' '}
                  <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">
                    (Optional)
                  </Text>
                </FormLabel>
                <Input
                  value={formData.gst}
                  onChange={(e) => handleInputChange('gst', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="Enter GST number"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.gst}</FormErrorMessage>
              </FormControl>
            </GridItem>
            <GridItem>
              <FormControl isRequired isInvalid={!!errors.phone}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Phone{' '}
                  <Text as="span" color="red.500">
                    *
                  </Text>
                </FormLabel>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="+1 (555) 000-0000"
                  type="tel"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.phone}</FormErrorMessage>
              </FormControl>
            </GridItem>
          </Grid>

          {/* Email and Website - Two Column Grid */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
            <GridItem>
              <FormControl isRequired isInvalid={!!errors.email}>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Email{' '}
                  <Text as="span" color="red.500">
                    *
                  </Text>
                </FormLabel>
                <Input
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="company@example.com"
                  type="email"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
                <FormErrorMessage fontWeight="500">{errors.email}</FormErrorMessage>
              </FormControl>
            </GridItem>
            <GridItem>
              <FormControl>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Website{' '}
                  <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">
                    (Optional)
                  </Text>
                </FormLabel>
                <Input
                  value={formData.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="https://www.yourcompany.com"
                  type="url"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
              </FormControl>
            </GridItem>
          </Grid>

          {/* Designation and Signature - Two Column Grid */}
          <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
            <GridItem>
              <FormControl>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Designation{' '}
                  <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">
                    (Optional)
                  </Text>
                </FormLabel>
                <Input
                  value={formData.designation}
                  onChange={(e) => handleInputChange('designation', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="e.g., Managing Director"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
              </FormControl>
            </GridItem>
            <GridItem>
              <FormControl>
                <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                  Signature Name{' '}
                  <Text as="span" color="gray.500" fontWeight="400" fontSize="xs">
                    (Optional)
                  </Text>
                </FormLabel>
                <Input
                  value={formData.signature}
                  onChange={(e) => handleInputChange('signature', e.target.value)}
                  onFocus={(e) => {
                    const t = e.target;
                    setTimeout(() => t.select(), 300);
                  }}
                  placeholder="Enter signatory name"
                  size="lg"
                  borderWidth="2px"
                  borderColor="gray.300"
                  bg="white"
                  fontWeight="500"
                  _hover={{ borderColor: 'red.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                  _focus={{
                    borderColor: 'red.500',
                    boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                    bg: 'white',
                  }}
                  borderRadius="12px"
                />
              </FormControl>
            </GridItem>
          </Grid>

          {/* Footer Buttons - Brand themed with gradient */}
          <HStack justify="flex-end" spacing={4} pt={8}>
            <Button
              variant="outline"
              onClick={handleClearForm}
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
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
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
                boxShadow: '0 6px 20px rgba(201, 31, 61, 0.4)',
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

export default CompanyInfoForm;

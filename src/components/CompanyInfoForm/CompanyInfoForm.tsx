import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardHeader,
  CardBody,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  VStack,
  HStack,
  Heading,
  Image,
  FormErrorMessage,
  Grid,
  GridItem,
} from '@chakra-ui/react';
import { CompanyInfo } from '../../types/company';
import { saveCompanyInfo, loadCompanyInfo } from '../../utils/localStorage';

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
    <Card variant="outline" borderRadius="xl" boxShadow="sm">
      <CardHeader>
        <HStack justify="space-between" flexWrap="wrap" gap={2}>
          <Heading size="md">Company Information</Heading>
          {loadCompanyInfo() && !useSaved && (
            <Button size="sm" variant="outline" onClick={handleUseSavedInfo}>
              Use Saved Info
            </Button>
          )}
        </HStack>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit}>
          <VStack spacing={5} align="stretch">
            {/* Logo Upload */}
            <FormControl>
              <FormLabel>Company Logo (Optional)</FormLabel>
              {logoPreview && (
                <Box mb={3}>
                  <Image
                    src={logoPreview}
                   alt="Company Logo"
                    maxH="100px"
                    objectFit="contain"
                    borderRadius="md"
                  />
                </Box>
              )}
              <Input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                display="none"
                id="logo-upload"
              />
              <Button as="label" htmlFor="logo-upload" size="sm" cursor="pointer">
                {logoPreview ? 'Change Logo' : 'Upload Logo'}
              </Button>
            </FormControl>

            {/* Company Name */}
            <FormControl isRequired isInvalid={!!errors.name}>
              <FormLabel>Company Name</FormLabel>
              <Input
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Enter company name"
              />
              <FormErrorMessage>{errors.name}</FormErrorMessage>
            </FormControl>

            {/* Address */}
            <FormControl isRequired isInvalid={!!errors.address}>
              <FormLabel>Address</FormLabel>
              <Textarea
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Enter company address"
                rows={3}
              />
              <FormErrorMessage>{errors.address}</FormErrorMessage>
            </FormControl>

            {/* GST and Phone */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
              <GridItem>
                <FormControl isInvalid={!!errors.gst}>
                  <FormLabel>GST Number (Optional)</FormLabel>
                  <Input
                    value={formData.gst}
                    onChange={(e) => handleInputChange('gst', e.target.value)}
                    placeholder="Enter GST number"
                  />
                  <FormErrorMessage>{errors.gst}</FormErrorMessage>
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl isRequired isInvalid={!!errors.phone}>
                  <FormLabel>Phone</FormLabel>
                  <Input
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="Enter phone number"
                    type="tel"
                  />
                  <FormErrorMessage>{errors.phone}</FormErrorMessage>
                </FormControl>
              </GridItem>
            </Grid>

            {/* Email and Website */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
              <GridItem>
                <FormControl isRequired isInvalid={!!errors.email}>
                  <FormLabel>Email</FormLabel>
                  <Input
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="Enter email address"
                    type="email"
                  />
                  <FormErrorMessage>{errors.email}</FormErrorMessage>
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl>
                  <FormLabel>Website (Optional)</FormLabel>
                  <Input
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    placeholder="Enter website URL"
                    type="url"
                  />
                </FormControl>
              </GridItem>
            </Grid>

            {/* Designation and Signature */}
            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap={5}>
              <GridItem>
                <FormControl>
                  <FormLabel>Designation (Optional)</FormLabel>
                  <Input
                    value={formData.designation}
                    onChange={(e) => handleInputChange('designation', e.target.value)}
                    placeholder="e.g., Managing Director"
                  />
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl>
                  <FormLabel>Signature Name (Optional)</FormLabel>
                  <Input
                    value={formData.signature}
                    onChange={(e) => handleInputChange('signature', e.target.value)}
                    placeholder="Enter signatory name"
                  />
                </FormControl>
              </GridItem>
            </Grid>

            {/* Buttons */}
            <HStack justify="flex-end" spacing={3} pt={4}>
              <Button variant="ghost" onClick={handleClearForm}>
                Clear
              </Button>
              <Button type="submit" colorScheme="brand" size="lg">
                Continue
              </Button>
            </HStack>
          </VStack>
        </form>
      </CardBody>
    </Card>
  );
};

export default CompanyInfoForm;

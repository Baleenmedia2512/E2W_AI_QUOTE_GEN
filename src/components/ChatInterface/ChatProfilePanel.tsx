import React, { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Center,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  Radio,
  RadioGroup,
  Stack,
  Textarea,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { FiArrowLeft, FiUploadCloud } from 'react-icons/fi';
import { CompanyInfo } from '../../types/company';
import { useAppStore } from '../../store';
import { useAuthStore } from '../../store/authStore';
import {
  getSelfProfile,
  updateCompanyProfile,
  updateSelfProfile,
  uploadProfileImage,
} from '../../services/userProfileService';
import { canAccessCompanyProfile } from '../../utils/profileAccess';

type ProfileType = 'select' | 'company' | 'self';

const ChatProfilePanel: React.FC = () => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { user, setUser } = useAuthStore();
  const companyInfo = useAppStore((state) => state.companyInfo);
  const setCompanyInfo = useAppStore((state) => state.setCompanyInfo);
  const closeChatProfile = useAppStore((state) => state.closeChatProfile);
  const canEditCompanyProfile = canAccessCompanyProfile(user);

  const [profileType, setProfileType] = useState<ProfileType>('select');
  const [companySaved, setCompanySaved] = useState<CompanyInfo | null>(companyInfo);
  const [selfName, setSelfName] = useState(user?.full_name || '');
  const [selfEmail, setSelfEmail] = useState(user?.email || '');
  const [selfPhone, setSelfPhone] = useState(user?.phone || '');
  const [selfProfileImage, setSelfProfileImage] = useState(user?.profileImage || '');
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [isSelfLoading, setIsSelfLoading] = useState(false);
  const [isSelfSaving, setIsSelfSaving] = useState(false);
  const [isCompanySaving, setIsCompanySaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [companyDraft, setCompanyDraft] = useState<CompanyInfo>(
    companyInfo || {
      name: '',
      address: '',
      gst: '',
      phone: '',
      email: '',
      logo: '',
      website: '',
      signature: '',
      designation: '',
    },
  );
  const [companyErrors, setCompanyErrors] = useState<Partial<Record<keyof CompanyInfo, string>>>({});

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const loadSelfProfile = async () => {
      setIsSelfLoading(true);
      try {
        const profile = await getSelfProfile();
        if (cancelled || !profile) return;

        setSelfName(profile.name || user.full_name || '');
        setSelfEmail(profile.email || user.email || '');
        setSelfPhone(profile.phone || user.phone || '');
        setSelfProfileImage(profile.profileImage || user.profileImage || '');
        setUser({
          ...user,
          full_name: profile.name || user.full_name,
          email: profile.email || user.email,
          phone: profile.phone || user.phone,
          profileImage: profile.profileImage || user.profileImage,
        });
      } finally {
        if (!cancelled) setIsSelfLoading(false);
      }
    };

    if (profileType === 'self') {
      loadSelfProfile();
    }

    return () => {
      cancelled = true;
    };
  }, [profileType, user?.id, setUser]);

  useEffect(() => {
    setCompanySaved(companyInfo);
    if (companyInfo) setCompanyDraft(companyInfo);
  }, [companyInfo]);

  const handleClose = () => {
    setProfileType('select');
    closeChatProfile();
  };

  const handleBackToSelect = () => {
    setProfileType('select');
  };

  const updateCompanyDraft = (field: keyof CompanyInfo, value: string) => {
    setCompanyDraft((current) => ({ ...current, [field]: value }));
    if (companyErrors[field]) {
      setCompanyErrors((current) => ({ ...current, [field]: '' }));
    }
  };

  const handleCompanyLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid logo',
        description: 'Please choose an image file.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => updateCompanyDraft('logo', String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const submitCompanyDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof CompanyInfo, string>> = {};
    if (!companyDraft.name.trim()) nextErrors.name = 'Company name is required.';
    if (!companyDraft.address.trim()) nextErrors.address = 'Address is required.';
    if (!companyDraft.phone.trim()) nextErrors.phone = 'Phone is required.';
    if (!companyDraft.email.trim()) nextErrors.email = 'Email is required.';
    setCompanyErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await handleCompanySave(companyDraft);
  };

  const handleSelfImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file',
        description: 'Please choose an image file.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setPendingImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelfProfileImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCompanySave = async (nextCompany: CompanyInfo) => {
    setIsCompanySaving(true);
    try {
      const result = await updateCompanyProfile(nextCompany);

      if (!result.success) {
        toast({
          title: 'Unable to save company profile',
          description: result.message,
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
        return;
      }

      setCompanyInfo(nextCompany, false);
      setCompanySaved(nextCompany);
      toast({
        title: 'Company details saved',
        status: 'success',
        duration: 2500,
        isClosable: true,
      });
      setProfileType('company');
    } catch (error: any) {
      toast({
        title: 'Unable to save company profile',
        description: error?.message || 'Please try again.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsCompanySaving(false);
    }
  };

  const handleSelfSave = async () => {
    if (!user?.id) return;

    const trimmedName = selfName.trim();
    if (!trimmedName) {
      setNameError('Name is required.');
      return;
    }

    setIsSelfSaving(true);
    setNameError('');

    try {
      let imageUrl = selfProfileImage.startsWith('http') ? selfProfileImage : user.profileImage || null;
      if (pendingImageFile) {
        imageUrl = await uploadProfileImage(pendingImageFile);
      }

      const result = await updateSelfProfile(trimmedName, selfPhone.trim(), imageUrl);
      if (!result.success) {
        toast({
          title: 'Unable to save profile',
          description: result.message,
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
        return;
      }

      const nextImage = result.profileImage || selfProfileImage || '';
      setSelfName(result.name || trimmedName);
      setSelfEmail(result.email || user.email);
      setSelfPhone(result.phone || selfPhone.trim());
      setSelfProfileImage(nextImage);
      setPendingImageFile(null);
      setUser({
        ...user,
        full_name: result.name || trimmedName,
        email: result.email || user.email,
        phone: result.phone || selfPhone.trim(),
        profileImage: nextImage || undefined,
      });

      toast({
        title: 'Profile saved',
        status: 'success',
        duration: 2500,
        isClosable: true,
      });
      setProfileType('self');
    } catch (error: any) {
      toast({
        title: 'Unable to save profile',
        description: error?.message || 'Please try again.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsSelfSaving(false);
    }
  };

  if (profileType === 'select') {
    const selectionValue: '' | 'company' | 'self' = '';

    return (
      <Center alignItems="flex-start" minH="100%" w="100%" px={{ base: 2, md: 4 }} py={{ base: 2, md: 4 }}>
        <VStack w="100%" maxW="540px" align="stretch" spacing={3}>
        <Box
          bg="white"
          borderRadius="14px"
          border="1px solid"
          borderColor="gray.200"
          boxShadow="0 4px 16px rgba(15, 23, 42, 0.06)"
          p={{ base: 3, md: 4 }}
        >
          <HStack mb={2} spacing={3}>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Icon as={FiArrowLeft} />}
              onClick={closeChatProfile}
              px={0}
            >
              Back
            </Button>
          </HStack>
          <Text fontSize={{ base: 'lg', md: 'xl' }} fontWeight="800" color="gray.900">
            Select Profile Type
          </Text>
          <Text fontSize="sm" color="gray.600" mt={1}>
            Choose the profile you want to view or update inside Quote Buddy.
          </Text>

          <RadioGroup value={profileType === 'select' ? selectionValue : profileType} onChange={(value) => setProfileType(value as Exclude<ProfileType, 'select'>)} mt={3}>
            <Stack spacing={2}>
              {canEditCompanyProfile && (
                <Box
                  as="button"
                  type="button"
                  p={3}
                  border="1.5px solid"
                  borderColor="gray.200"
                  borderRadius="12px"
                  bg="gray.50"
                  textAlign="left"
                  w="100%"
                  onClick={() => setProfileType('company')}
                  _hover={{ borderColor: 'brand.400', bg: 'brand.50' }}
                >
                  <Radio value="company" size="lg" colorScheme="red">
                    <HStack justify="space-between" align="center" w="100%" pl={2}>
                      <Text fontWeight="700" color="gray.800">
                        Company Profile
                      </Text>
                      <Text fontSize="sm" color="gray.500">
                        Business details
                      </Text>
                    </HStack>
                  </Radio>
                </Box>
              )}

              <Box
                as="button"
                type="button"
                p={3}
                border="1.5px solid"
                borderColor="gray.200"
                borderRadius="12px"
                bg="gray.50"
                textAlign="left"
                w="100%"
                onClick={() => setProfileType('self')}
                _hover={{ borderColor: 'brand.400', bg: 'brand.50' }}
              >
                <Radio value="self" size="lg" colorScheme="red">
                  <HStack justify="space-between" align="center" w="100%" pl={2}>
                    <Text fontWeight="700" color="gray.800">
                      Self Profile
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      User details
                    </Text>
                  </HStack>
                </Radio>
              </Box>
            </Stack>
          </RadioGroup>
        </Box>
        </VStack>
      </Center>
    );
  }

  if (profileType === 'company') {
    return (
      <Center alignItems="flex-start" minH="100%" w="100%" px={{ base: 2, md: 4 }} py={{ base: 2, md: 4 }}>
        <VStack w="100%" maxW="640px" align="stretch" spacing={2}>
          <Box>
            <Button size="sm" variant="ghost" leftIcon={<Icon as={FiArrowLeft} />} onClick={handleBackToSelect} px={0}>
              Back
            </Button>
            <Text mt={1} fontSize={{ base: 'lg', md: 'xl' }} fontWeight="800" color="gray.900">
              Company Profile
            </Text>
            <Text fontSize="sm" color="gray.600" mt={1}>
              Update your business details for future quotations.
            </Text>
          </Box>

          <Box bg="white" borderRadius="14px" border="1px solid" borderColor="gray.200" boxShadow="0 4px 16px rgba(15, 23, 42, 0.06)" p={{ base: 2, md: 3 }}>
            <form onSubmit={submitCompanyDraft}>
              <VStack align="stretch" spacing={2}>
                <Center>
                  <VStack spacing={2}>
                    <Box
                      w={{ base: '130px', md: '160px' }}
                      h={{ base: '52px', md: '62px' }}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      overflow="hidden"
                      borderRadius="10px"
                      border="1px solid"
                      borderColor="gray.200"
                      bg="gray.50"
                    >
                      {companyDraft.logo ? (
                        <Box
                          as="img"
                          src={companyDraft.logo}
                          alt={`${companyDraft.name || 'Company'} logo`}
                          maxW="100%"
                          maxH="100%"
                          objectFit="contain"
                        />
                      ) : (
                        <Icon as={FiUploadCloud} boxSize={7} color="gray.400" />
                      )}
                    </Box>
                    <Input id="chat-company-logo" type="file" accept="image/*" display="none" onChange={handleCompanyLogoChange} />
                    <Button as="label" htmlFor="chat-company-logo" size="xs" variant="outline" cursor="pointer">
                      {companyDraft.logo ? 'Change Logo' : 'Upload Logo'}
                    </Button>
                  </VStack>
                </Center>

                <FormControl isRequired isInvalid={!!companyErrors.name}>
                  <FormLabel fontSize="sm" mb={1}>Company Name</FormLabel>
                  <Input size="sm" value={companyDraft.name} onChange={(event) => updateCompanyDraft('name', event.target.value)} placeholder="Enter company name" />
                  {companyErrors.name ? <Text mt={1} fontSize="sm" color="red.500">{companyErrors.name}</Text> : null}
                </FormControl>

                <FormControl isRequired isInvalid={!!companyErrors.address}>
                  <FormLabel fontSize="sm" mb={1}>Address</FormLabel>
                  <Textarea size="sm" value={companyDraft.address} onChange={(event) => updateCompanyDraft('address', event.target.value)} placeholder="Enter business address" rows={2} />
                  {companyErrors.address ? <Text mt={1} fontSize="sm" color="red.500">{companyErrors.address}</Text> : null}
                </FormControl>

                <Stack direction={{ base: 'column', md: 'row' }} spacing={2}>
                  <FormControl isRequired isInvalid={!!companyErrors.phone}>
                    <FormLabel fontSize="sm" mb={1}>Phone</FormLabel>
                    <Input size="sm" value={companyDraft.phone} onChange={(event) => updateCompanyDraft('phone', event.target.value)} placeholder="Phone number" />
                    {companyErrors.phone ? <Text mt={1} fontSize="sm" color="red.500">{companyErrors.phone}</Text> : null}
                  </FormControl>
                  <FormControl isRequired isInvalid={!!companyErrors.email}>
                    <FormLabel fontSize="sm" mb={1}>Email</FormLabel>
                    <Input size="sm" type="email" value={companyDraft.email} onChange={(event) => updateCompanyDraft('email', event.target.value)} placeholder="Email address" />
                    {companyErrors.email ? <Text mt={1} fontSize="sm" color="red.500">{companyErrors.email}</Text> : null}
                  </FormControl>
                </Stack>

                <Stack direction={{ base: 'column', md: 'row' }} spacing={2}>
                  <FormControl>
                    <FormLabel fontSize="sm" mb={1}>GST Number</FormLabel>
                    <Input size="sm" value={companyDraft.gst} onChange={(event) => updateCompanyDraft('gst', event.target.value)} placeholder="Optional" />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="sm" mb={1}>Website</FormLabel>
                    <Input size="sm" value={companyDraft.website || ''} onChange={(event) => updateCompanyDraft('website', event.target.value)} placeholder="Optional" />
                  </FormControl>
                </Stack>

                <Stack direction={{ base: 'column', md: 'row' }} spacing={2}>
                  <FormControl>
                    <FormLabel fontSize="sm" mb={1}>Designation</FormLabel>
                    <Input size="sm" value={companyDraft.designation || ''} onChange={(event) => updateCompanyDraft('designation', event.target.value)} placeholder="Optional" />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="sm" mb={1}>Signature Name</FormLabel>
                    <Input size="sm" value={companyDraft.signature || ''} onChange={(event) => updateCompanyDraft('signature', event.target.value)} placeholder="Optional" />
                  </FormControl>
                </Stack>

                <HStack justify="flex-end" spacing={3} pt={2} flexWrap="wrap">
                  <Button variant="outline" onClick={handleBackToSelect}>Back</Button>
                  <Button type="submit" colorScheme="red" isLoading={isCompanySaving}>
                    Save Company Profile
                  </Button>
                </HStack>
              </VStack>
            </form>
          </Box>
        </VStack>
      </Center>
    );
  }

  return (
    <Center alignItems="flex-start" minH="100%" w="100%" px={{ base: 2, md: 4 }} py={{ base: 2, md: 4 }}>
        <VStack w="100%" maxW="520px" align="stretch" spacing={2}>
      <Box>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Icon as={FiArrowLeft} />}
          onClick={handleBackToSelect}
          px={0}
        >
          Back
        </Button>
        <Text mt={1} fontSize={{ base: 'lg', md: 'xl' }} fontWeight="800" color="gray.900">
          Self Profile
        </Text>
        <Text fontSize="sm" color="gray.600" mt={1}>
          Keep your name and avatar up to date inside Quote Buddy.
        </Text>
      </Box>

      <Box
        bg="white"
        borderRadius="16px"
        border="1px solid"
        borderColor="gray.200"
        boxShadow="0 6px 24px rgba(15, 23, 42, 0.06)"
        p={{ base: 2, md: 3 }}
      >
        {isSelfLoading ? (
          <Center py={12}>
            <Text color="gray.500">Loading profile...</Text>
          </Center>
        ) : (
          <VStack spacing={3} align="stretch">
            <FormControl>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800" mb={2}>
                Profile Image
              </FormLabel>
              <Center>
                <VStack spacing={2}>
                  <Box position="relative">
                    {selfProfileImage ? (
                      <Avatar
                        src={selfProfileImage}
                        name={selfName || user?.full_name}
                        size="md"
                        bg="gray.100"
                        border="4px solid"
                        borderColor="brand.500"
                        boxShadow="0 8px 24px rgba(201, 31, 61, 0.18)"
                      />
                    ) : (
                      <Avatar
                        size="md"
                        name={selfName || user?.full_name}
                        bgGradient="linear(135deg, #FFF5F7, #FFECF0)"
                        icon={<Icon as={FiUploadCloud} boxSize={12} color="brand.500" />}
                        border="4px dashed"
                        borderColor="brand.300"
                        boxShadow="0 4px 12px rgba(201, 31, 61, 0.1)"
                      />
                    )}
                  </Box>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelfImageChange}
                    display="none"
                    id="chat-profile-image-upload"
                  />
                  <Button
                    as="label"
                    htmlFor="chat-profile-image-upload"
                    size="sm"
                    bgGradient="linear(to-r, #C91F3D, #B31B3E)"
                    color="white"
                    fontWeight="600"
                    cursor="pointer"
                    px={5}
                    w={{ base: '100%', sm: 'auto' }}
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(201, 31, 61, 0.3)"
                    _hover={{
                      bgGradient: 'linear(to-r, #B31B3E, #9f1239)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 6px 16px rgba(201, 31, 61, 0.4)',
                    }}
                    _active={{ transform: 'scale(0.98)' }}
                  >
                    {selfProfileImage ? 'Change Image' : 'Upload Image'}
                  </Button>
                </VStack>
              </Center>
            </FormControl>

            <FormControl isRequired isInvalid={!!nameError}>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Name <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Input
                value={selfName}
                onChange={(event) => {
                  setSelfName(event.target.value);
                  if (nameError) setNameError('');
                }}
                placeholder="Enter your name"
                size="md"
                borderWidth="2px"
                borderColor="gray.300"
                bg="white"
                fontWeight="500"
                _hover={{ borderColor: 'brand.300', boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.1)' }}
                _focus={{
                  borderColor: 'brand.500',
                  boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
                  bg: 'white',
                }}
                borderRadius="12px"
              />
              {nameError ? <Text mt={1} fontSize="sm" color="red.500">{nameError}</Text> : null}
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Phone
              </FormLabel>
              <Input
                value={selfPhone}
                onChange={(event) => setSelfPhone(event.target.value)}
                placeholder="Enter phone number"
                size="sm"
                borderRadius="10px"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Email
              </FormLabel>
              <Input
                value={selfEmail}
                type="email"
                isReadOnly
                isDisabled
                size="md"
                borderWidth="2px"
                borderColor="gray.200"
                bg="gray.50"
                color="gray.600"
                fontWeight="500"
                cursor="not-allowed"
                borderRadius="12px"
                _disabled={{
                  opacity: 1,
                  bg: 'gray.50',
                  color: 'gray.600',
                  cursor: 'not-allowed',
                }}
              />
              <Text mt={1} fontSize="xs" color="gray.500">
                Email uses your signed-in account and cannot be changed here.
              </Text>
            </FormControl>

            <HStack justify="flex-end" spacing={3} pt={2} flexWrap="wrap">
              <Button
                variant="outline"
                size="sm"
                borderWidth="2px"
                borderColor="gray.300"
                color="gray.700"
                fontWeight="600"
                px={5}
                w={{ base: '100%', sm: 'auto' }}
                borderRadius="12px"
                onClick={handleClose}
                _hover={{
                  bg: 'gray.50',
                  borderColor: 'gray.400',
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                bgGradient="linear(to-r, #C91F3D, #B31B3E)"
                color="white"
                fontWeight="600"
                px={6}
                w={{ base: '100%', sm: 'auto' }}
                borderRadius="12px"
                boxShadow="0 4px 16px rgba(201, 31, 61, 0.3)"
                isLoading={isSelfSaving}
                onClick={handleSelfSave}
                _hover={{
                  bgGradient: 'linear(to-r, #B31B3E, #9f1239)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 6px 20px rgba(201, 31, 61, 0.4)',
                }}
                _active={{ transform: 'scale(0.98)' }}
              >
                Save Profile
              </Button>
            </HStack>
          </VStack>
        )}
      </Box>
      </VStack>
    </Center>
  );
};

export default ChatProfilePanel;

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Container,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  HStack,
  Icon,
  Input,
  Text,
  Avatar,
  Center,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { FiArrowLeft, FiUploadCloud } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { Header } from '../components/Header';
import { useAuthStore } from '../store/authStore';
import {
  getSelfProfile,
  updateSelfProfile,
  uploadProfileImage,
} from '../services/userProfileService';
import '../components/CompanyInfoForm/CompanyInfoForm.css';

const ProfilePage: React.FC = () => {
  const history = useHistory();
  const toast = useToast();
  const { user, setUser } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profileImage, setProfileImage] = useState(user?.profileImage || '');
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [nameError, setNameError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const loadProfile = async () => {
      const profile = await getSelfProfile(user.id);
      if (cancelled || !profile) return;

      setName(profile.name || user.full_name || '');
      setEmail(profile.email || user.email || '');
      setProfileImage(profile.profileImage || '');
      setUser({
        ...user,
        full_name: profile.name || user.full_name,
        email: profile.email || user.email,
        profileImage: profile.profileImage || user.profileImage,
      });
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      setProfileImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!user?.id) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Name is required.');
      return;
    }

    setIsSaving(true);
    setNameError('');

    try {
      let imageUrl = profileImage.startsWith('http') ? profileImage : user.profileImage || null;

      if (pendingImageFile) {
        imageUrl = await uploadProfileImage(user.id, pendingImageFile);
      }

      const result = await updateSelfProfile(user.id, trimmedName, imageUrl);

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

      const nextImage = result.profileImage || imageUrl || '';
      setName(result.name || trimmedName);
      setEmail(result.email || email);
      setProfileImage(nextImage);
      setPendingImageFile(null);
      setUser({
        ...user,
        full_name: result.name || trimmedName,
        email: result.email || user.email,
        profileImage: nextImage || undefined,
      });

      toast({
        title: 'Profile saved',
        status: 'success',
        duration: 2500,
        isClosable: true,
      });
    } catch (error: any) {
      toast({
        title: 'Unable to save profile',
        description: error?.message || 'Please try again.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box minH="100vh" bg="#F8FAFC" pb={{ base: '80px', md: 8 }}>
      <Box display={{ base: 'none', md: 'block' }}>
        <Header />
      </Box>

      <Box
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.100"
        px={4}
        py={3}
        display={{ base: 'block', md: 'none' }}
        position="sticky"
        top={0}
        zIndex={10}
      >
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Icon as={FiArrowLeft} />}
            onClick={() => history.goBack()}
          >
            Back
          </Button>
          <Heading size="sm">Self Profile</Heading>
        </HStack>
      </Box>

      <Container maxW="900px" py={{ base: 4, md: 8 }} px={{ base: 4, md: 6 }}>
        <Box mb={6} display={{ base: 'none', md: 'block' }}>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Icon as={FiArrowLeft} />}
            onClick={() => history.goBack()}
            mb={3}
          >
            Back
          </Button>
          <Heading size="lg" color="gray.800" mb={1}>
            Self Profile
          </Heading>
          <Text color="gray.600" fontSize="sm">
            Update your profile image and name. Email cannot be changed.
          </Text>
        </Box>

        <Box className="company-form-card" py={8}>
          <Box mb={8}>
            <Heading
              size="xl"
              fontWeight="800"
              bgGradient="linear(135deg, #C91F3D, #B31B3E, #7A1030)"
              bgClip="text"
              letterSpacing="tight"
              mb={1}
            >
              Profile Information
            </Heading>
            <Text fontSize="sm" color="gray.600" fontWeight="500">
              Your name and photo are used across Quote Buddy.
            </Text>
          </Box>

          <VStack spacing={6} align="stretch">
            <FormControl>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800" mb={4}>
                Profile Image
              </FormLabel>
              <Center>
                <VStack spacing={4}>
                  <Box
                    position="relative"
                    _hover={{ transform: 'scale(1.02)' }}
                    transition="all 0.3s"
                  >
                    {profileImage ? (
                      <Avatar
                        src={profileImage}
                        name={name || user?.full_name}
                        size="2xl"
                        bg="gray.100"
                        border="4px solid"
                        borderColor="red.500"
                        boxShadow="0 8px 24px rgba(201, 31, 61, 0.25)"
                      />
                    ) : (
                      <Avatar
                        size="2xl"
                        name={name || user?.full_name}
                        bgGradient="linear(135deg, #FFF5F7, #FFECF0)"
                        icon={<Icon as={FiUploadCloud} boxSize={12} color="red.500" />}
                        border="4px dashed"
                        borderColor="red.300"
                        boxShadow="0 4px 12px rgba(201, 31, 61, 0.1)"
                      />
                    )}
                  </Box>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    display="none"
                    id="profile-image-upload"
                  />
                  <Button
                    as="label"
                    htmlFor="profile-image-upload"
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
                    {profileImage ? 'Change Image' : 'Upload Image'}
                  </Button>
                </VStack>
              </Center>
            </FormControl>

            <FormControl isRequired isInvalid={!!nameError}>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Name <Text as="span" color="red.500">*</Text>
              </FormLabel>
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError('');
                }}
                placeholder="Enter your name"
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
              {nameError ? <FormErrorMessage fontWeight="500">{nameError}</FormErrorMessage> : null}
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="700" color="gray.800">
                Email
              </FormLabel>
              <Input
                value={email}
                type="email"
                isReadOnly
                isDisabled
                size="lg"
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
              <Text mt={2} fontSize="xs" color="gray.500">
                Email cannot be changed.
              </Text>
            </FormControl>

            <HStack justify="flex-end" spacing={4} pt={4}>
              <Button
                size="lg"
                bgGradient="linear(to-r, #C91F3D, #B31B3E)"
                color="white"
                fontWeight="600"
                px={10}
                borderRadius="12px"
                boxShadow="0 4px 16px rgba(201, 31, 61, 0.3)"
                isLoading={isSaving}
                onClick={handleSave}
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
        </Box>
      </Container>
    </Box>
  );
};

export default ProfilePage;

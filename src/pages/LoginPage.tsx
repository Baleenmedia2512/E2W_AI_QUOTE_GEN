import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Center,
  Container,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  Icon,
  IconButton,
  Image,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  Text,
  useDisclosure,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { EmailIcon, LockIcon, ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
import { useHistory, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { passwordResetService } from '../services/passwordResetService';

type ForgotStep = 'email' | 'otp' | 'password' | 'success';

const PASSWORD_MIN_LENGTH = 8;

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [forgotStep, setForgotStep] = useState<ForgotStep>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [isRecoverySubmitting, setIsRecoverySubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verifyAttemptsRemaining, setVerifyAttemptsRemaining] = useState<number | null>(null);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const toast = useToast();
  const history = useHistory();
  const location = useLocation<{ from?: string }>();
  const { login, isAuthenticated, error, clearError } = useAuthStore();
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from || '/';
      history.replace(from);
    }
  }, [isAuthenticated, history, location]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;

    const interval = window.setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [resendCooldown]);

  const recoveryTitle = useMemo(() => {
    switch (forgotStep) {
      case 'otp':
        return 'Verify OTP';
      case 'password':
        return 'Create New Password';
      case 'success':
        return 'Password Reset';
      default:
        return 'Forgot Password';
    }
  }, [forgotStep]);

  const resetRecoveryState = () => {
    setForgotStep('email');
    setForgotEmail('');
    setOtpDigits(['', '', '', '']);
    setNewPassword('');
    setConfirmPassword('');
    setResetToken('');
    setRecoveryError('');
    setIsRecoverySubmitting(false);
    setResendCooldown(0);
    setVerifyAttemptsRemaining(null);
  };

  const openForgotPassword = () => {
    setForgotEmail(email.trim());
    setForgotStep('email');
    setRecoveryError('');
    onOpen();
  };

  const closeForgotPassword = () => {
    onClose();
    resetRecoveryState();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({
        title: 'Missing fields',
        description: 'Please enter both email and password',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSubmitting(true);
    clearError();

    try {
      await login({ email, password });
      const from = location.state?.from || '/';
      history.push(from);
    } catch (err: any) {
      toast({
        title: 'Login failed',
        description: err.message || 'Invalid credentials',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendOtp = async () => {
    const normalizedEmail = forgotEmail.trim();

    if (!normalizedEmail) {
      setRecoveryError('Please enter your registered email.');
      return;
    }

    setIsRecoverySubmitting(true);
    setRecoveryError('');

    try {
      const result = await passwordResetService.requestOtp(normalizedEmail);

      if (result.success !== true) {
        setRecoveryError(result.message || 'Unable to send OTP.');
        return;
      }

      setForgotEmail(normalizedEmail);
      setOtpDigits(['', '', '', '']);
      setVerifyAttemptsRemaining(result.verifyAttemptsRemaining ?? null);
      setResendCooldown(result.cooldownSeconds ?? 60);
      setForgotStep('otp');
      toast({
        title: 'OTP sent',
        description: result.message,
        status: 'success',
        duration: 2500,
        isClosable: true,
      });
    } catch (err: unknown) {
      setRecoveryError(err instanceof Error && err.message ? err.message : 'Unable to send OTP.');
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpValue = otpDigits.join('');

    if (!/^\d{4}$/.test(otpValue)) {
      setRecoveryError('Enter the 4-digit OTP.');
      return;
    }

    setIsRecoverySubmitting(true);
    setRecoveryError('');

    try {
      const result = await passwordResetService.verifyOtp(forgotEmail, otpValue);

      if (result.success !== true) {
        setRecoveryError(result.message || 'OTP verification failed.');
        return;
      }

      setResetToken(result.resetToken || '');
      setForgotStep('password');
      toast({
        title: 'OTP verified',
        description: result.message,
        status: 'success',
        duration: 2500,
        isClosable: true,
      });
    } catch (err: unknown) {
      setRecoveryError(err instanceof Error && err.message ? err.message : 'OTP verification failed.');
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const focusOtpInput = (index: number) => {
    otpInputRefs.current[index]?.focus();
  };

  const updateOtpDigit = (index: number, rawValue: string) => {
    const digitsOnly = rawValue.replace(/\D/g, '');

    if (!digitsOnly) {
      setOtpDigits((current) => {
        const next = [...current];
        next[index] = '';
        return next;
      });
      return;
    }

    if (digitsOnly.length > 1) {
      const next = ['', '', '', ''];
      digitsOnly.slice(0, 4).split('').forEach((digit, digitIndex) => {
        next[digitIndex] = digit;
      });
      setOtpDigits(next);
      window.setTimeout(() => focusOtpInput(Math.min(digitsOnly.length, 3)), 0);
      return;
    }

    setOtpDigits((current) => {
      const next = [...current];
      next[index] = digitsOnly;
      return next;
    });

    if (index < 3) {
      window.setTimeout(() => focusOtpInput(index + 1), 0);
    }
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();

      setOtpDigits((current) => {
        const next = [...current];
        if (next[index]) {
          next[index] = '';
          return next;
        }

        if (index > 0) {
          next[index - 1] = '';
          window.setTimeout(() => focusOtpInput(index - 1), 0);
        }

        return next;
      });
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusOtpInput(index - 1);
      return;
    }

    if (event.key === 'ArrowRight' && index < 3) {
      event.preventDefault();
      focusOtpInput(index + 1);
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pastedDigits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!pastedDigits) return;

    const next = ['', '', '', ''];
    pastedDigits.split('').forEach((digit, digitIndex) => {
      next[digitIndex] = digit;
    });
    setOtpDigits(next);
    window.setTimeout(() => focusOtpInput(Math.min(pastedDigits.length, 3)), 0);
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    await handleSendOtp();
  };

  const handleResetPassword = async () => {
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setRecoveryError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setRecoveryError('Passwords do not match.');
      return;
    }

    if (!resetToken) {
      setRecoveryError('The verification session has expired. Please request a new OTP.');
      setForgotStep('email');
      return;
    }

    setIsRecoverySubmitting(true);
    setRecoveryError('');

    try {
      const result = await passwordResetService.resetPassword(
        forgotEmail,
        resetToken,
        newPassword,
        confirmPassword,
      );

      if (result.success !== true) {
        setRecoveryError(result.message || 'Unable to reset password.');
        return;
      }

      setForgotStep('success');
      toast({
        title: 'Password reset successfully',
        description: result.message,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (err: unknown) {
      setRecoveryError(err instanceof Error && err.message ? err.message : 'Unable to reset password.');
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const renderRecoveryContent = () => {
    switch (forgotStep) {
      case 'otp':
        return (
          <VStack spacing={4} align="stretch">
            <Text fontSize="sm" color="gray.600">
              We sent a 4-digit OTP to {forgotEmail}. It expires after 10 minutes.
            </Text>
            <FormControl isInvalid={!!recoveryError}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Enter the 4-digit OTP
              </FormLabel>
              <Box display="flex" gap={3} justifyContent="space-between">
                {otpDigits.map((digit, index) => (
                  <Input
                    key={index}
                    ref={(el) => {
                      otpInputRefs.current[index] = el;
                    }}
                    value={digit}
                    onChange={(e) => updateOtpDigit(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={handleOtpPaste}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    aria-label={`OTP digit ${index + 1}`}
                    placeholder=""
                    h={{ base: '52px', md: '56px' }}
                    w={{ base: '52px', md: '56px' }}
                    minW={{ base: '52px', md: '56px' }}
                    textAlign="center"
                    borderRadius="12px"
                    borderColor="gray.300"
                    bg="white"
                    fontSize="xl"
                    fontWeight="700"
                    px={0}
                    _focusVisible={{
                      borderColor: 'brand.500',
                      boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.18)',
                    }}
                  />
                ))}
              </Box>
              {verifyAttemptsRemaining !== null ? (
                <Text mt={2} fontSize="xs" color="gray.500">
                  Attempts remaining: {verifyAttemptsRemaining}
                </Text>
              ) : null}
              {recoveryError ? <FormErrorMessage mt={2}>{recoveryError}</FormErrorMessage> : null}
            </FormControl>
            <Button
              w="full"
              h="50px"
              bg="brand.500"
              color="white"
              fontWeight="700"
              borderRadius="14px"
              isLoading={isRecoverySubmitting}
              onClick={handleVerifyOtp}
              _hover={{ bg: 'brand.600' }}
              _active={{ bg: 'brand.700' }}
            >
              Verify OTP
            </Button>
            <Button
              variant="ghost"
              color="brand.600"
              onClick={handleResendOtp}
              isDisabled={resendCooldown > 0 || isRecoverySubmitting}
            >
              {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
            </Button>
          </VStack>
        );
      case 'password':
        return (
          <VStack spacing={4} align="stretch">
            <Text fontSize="sm" color="gray.600">
              Create a new password for {forgotEmail}.
            </Text>
            <FormControl isInvalid={!!recoveryError}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                New Password
              </FormLabel>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New Password"
                autoComplete="new-password"
                h="50px"
                borderRadius="14px"
              />
            </FormControl>
            <FormControl isInvalid={!!recoveryError}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Confirm Password
              </FormLabel>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm Password"
                autoComplete="new-password"
                h="50px"
                borderRadius="14px"
              />
              {recoveryError ? <FormErrorMessage mt={2}>{recoveryError}</FormErrorMessage> : null}
            </FormControl>
            <Button
              w="full"
              h="50px"
              bg="brand.500"
              color="white"
              fontWeight="700"
              borderRadius="14px"
              isLoading={isRecoverySubmitting}
              onClick={handleResetPassword}
              _hover={{ bg: 'brand.600' }}
              _active={{ bg: 'brand.700' }}
            >
              Reset Password
            </Button>
          </VStack>
        );
      case 'success':
        return (
          <VStack spacing={4} align="stretch">
            <Alert status="success" borderRadius="14px">
              <AlertIcon />
              Password reset successfully
            </Alert>
            <Button
              w="full"
              h="50px"
              bg="brand.500"
              color="white"
              fontWeight="700"
              borderRadius="14px"
              onClick={closeForgotPassword}
              _hover={{ bg: 'brand.600' }}
              _active={{ bg: 'brand.700' }}
            >
              Back to Sign In
            </Button>
          </VStack>
        );
      default:
        return (
          <VStack spacing={4} align="stretch">
            <Text fontSize="sm" color="gray.600">
              Enter your registered email to receive a 4-digit OTP.
            </Text>
            <FormControl isInvalid={!!recoveryError}>
              <FormLabel fontSize="sm" fontWeight="600" color="gray.700">
                Email
              </FormLabel>
              <InputGroup>
                <InputLeftElement h="50px" pointerEvents="none" color="gray.400">
                  <Icon as={EmailIcon} boxSize={4} />
                </InputLeftElement>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Enter your registered email"
                  autoComplete="email"
                  h="50px"
                  borderRadius="14px"
                  pl={11}
                />
              </InputGroup>
              {recoveryError ? <FormErrorMessage mt={2}>{recoveryError}</FormErrorMessage> : null}
            </FormControl>
            <Button
              w="full"
              h="50px"
              bg="brand.500"
              color="white"
              fontWeight="700"
              borderRadius="14px"
              isLoading={isRecoverySubmitting}
              onClick={handleSendOtp}
              _hover={{ bg: 'brand.600' }}
              _active={{ bg: 'brand.700' }}
            >
              Send OTP
            </Button>
          </VStack>
        );
    }
  };

  return (
    <Center minH="100vh" bg="gray.50" px={4}>
      <Container maxW="md" w="full" px={0}>
        <Box
          as="form"
          onSubmit={handleSubmit}
          bg="white"
          borderWidth="1px"
          borderColor="gray.200"
          borderRadius="24px"
          boxShadow="0 18px 50px rgba(15, 23, 42, 0.08)"
          px={{ base: 6, sm: 8 }}
          py={{ base: 8, sm: 10 }}
        >
          <VStack spacing={6} align="stretch">
            <VStack spacing={3}>
              <Box
                borderRadius="20px"
                p={2.5}
                bg="gray.50"
                borderWidth="1px"
                borderColor="gray.100"
              >
                <Image
                  src="/icons/icon-192x192.png"
                  alt="Quote Buddy logo"
                  boxSize="52px"
                  objectFit="contain"
                />
              </Box>
              <Heading size="md" color="gray.900" fontWeight="700" letterSpacing="-0.02em">
                Quote Buddy
              </Heading>
            </VStack>

            <VStack spacing={4} align="stretch">
              <FormControl isRequired isInvalid={!!error}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700" mb={2}>
                  Email
                </FormLabel>
                <InputGroup>
                  <InputLeftElement h="52px" pointerEvents="none" color="gray.400">
                    <Icon as={EmailIcon} boxSize={4} />
                  </InputLeftElement>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoComplete="email"
                    autoFocus
                    h="52px"
                    borderRadius="14px"
                    pl={11}
                  />
                </InputGroup>
              </FormControl>

              <FormControl isRequired isInvalid={!!error}>
                <FormLabel fontSize="sm" fontWeight="600" color="gray.700" mb={2}>
                  Password
                </FormLabel>
                <InputGroup>
                  <InputLeftElement h="52px" pointerEvents="none" color="gray.400">
                    <Icon as={LockIcon} boxSize={4} />
                  </InputLeftElement>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    h="52px"
                    borderRadius="14px"
                    pl={11}
                    pr={12}
                  />
                  <InputRightElement h="52px" pr={2}>
                    <IconButton
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                      variant="ghost"
                      color="gray.500"
                      size="sm"
                      onClick={() => setShowPassword((current) => !current)}
                      _hover={{ bg: 'gray.100', color: 'gray.700' }}
                    />
                  </InputRightElement>
                </InputGroup>
                {error ? <FormErrorMessage mt={2}>{error}</FormErrorMessage> : null}
              </FormControl>

              <Button
                type="submit"
                w="full"
                h="52px"
                bg="brand.500"
                color="white"
                fontSize="md"
                fontWeight="700"
                borderRadius="14px"
                isLoading={isSubmitting}
                loadingText="Signing in..."
                _hover={{
                  bg: 'brand.600',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 10px 24px rgba(201, 31, 61, 0.28)',
                }}
                _active={{
                  bg: 'brand.700',
                  transform: 'scale(0.99)',
                }}
                transition="all 0.2s ease"
              >
                Sign In
              </Button>

              <Button
                type="button"
                variant="link"
                alignSelf="center"
                fontSize="sm"
                fontWeight="600"
                color="brand.600"
                onClick={openForgotPassword}
                _hover={{ color: 'brand.700', textDecoration: 'underline' }}
              >
                Forgot Password?
              </Button>
            </VStack>
          </VStack>
        </Box>
      </Container>

      <Modal isOpen={isOpen} onClose={closeForgotPassword} isCentered size="md">
        <ModalOverlay bg="blackAlpha.500" />
        <ModalContent borderRadius="24px" mx={4}>
          <ModalCloseButton />
          <ModalBody px={{ base: 5, sm: 8 }} py={{ base: 8, sm: 10 }}>
            <VStack spacing={6} align="stretch">
              <VStack spacing={3}>
                <Box
                  borderRadius="20px"
                  p={2.5}
                  bg="gray.50"
                  borderWidth="1px"
                  borderColor="gray.100"
                >
                  <Image
                    src="/icons/icon-192x192.png"
                    alt="Quote Buddy logo"
                    boxSize="48px"
                    objectFit="contain"
                  />
                </Box>
                <Heading size="md" color="gray.900" fontWeight="700" letterSpacing="-0.02em">
                  {recoveryTitle}
                </Heading>
              </VStack>

              {renderRecoveryContent()}
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Center>
  );
};

export default LoginPage;

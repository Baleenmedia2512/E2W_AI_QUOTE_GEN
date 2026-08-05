import React from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  useToast,
  Button,
  HStack,
  Icon,
} from '@chakra-ui/react';
import { FiArrowLeft } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import CompanyInfoForm from '../components/CompanyInfoForm/CompanyInfoForm';
import { useAppStore } from '../store';
import { CompanyInfo } from '../types/company';
import { saveCompanyInfo } from '../utils/localStorage';
import { Header } from '../components/Header';

const CompanySettingsPage: React.FC = () => {
  const history = useHistory();
  const toast = useToast();
  const { companyInfo, setCompanyInfo } = useAppStore();

  const handleSubmit = (info: CompanyInfo) => {
    setCompanyInfo(info);
    saveCompanyInfo(info);
    toast({
      title: 'Company details saved',
      status: 'success',
      duration: 2500,
      isClosable: true,
    });
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
          <Heading size="sm">Company Settings</Heading>
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
            Company Settings
          </Heading>
          <Text color="gray.600" fontSize="sm">
            Edit your company details once — they are reused on every quote PDF.
          </Text>
        </Box>

        <CompanyInfoForm onSubmit={handleSubmit} initialData={companyInfo} />
      </Container>
    </Box>
  );
};

export default CompanySettingsPage;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Flex,
  Heading,
  HStack,
  Icon,
  Input,
  InputGroup,
  InputLeftElement,
  SimpleGrid,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import { FiSearch, FiUsers } from 'react-icons/fi';
import VendorUpload from '../components/VendorUpload/VendorUpload';
import { UserProfile } from '../components/UserProfile';
import DesktopNavLinks from '../components/DesktopNavLinks/DesktopNavLinks';
import {
  loadVendorRateChunks,
  loadVendorSummary,
  VendorRateChunkRecord,
} from '../services/vendorRateChunkService';

const VendorManagementPage: React.FC = () => {
  const [rates, setRates] = useState<VendorRateChunkRecord[]>([]);
  const [summary, setSummary] = useState({ totalRates: 0, vendorCount: 0, documentCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rateRows, summaryData] = await Promise.all([
        loadVendorRateChunks(500),
        loadVendorSummary(),
      ]);
      setRates(rateRows);
      setSummary(summaryData);
    } catch (error) {
      console.error('Failed to load vendor rates:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rates;

    return rates.filter((rate) => {
      const metadata = rate.metadata || {};
      const haystack = [
        rate.service_name,
        String(metadata.vendor_name || ''),
        String(metadata.city || ''),
        String(metadata.medium || ''),
        String(metadata.location || ''),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [rates, search]);

  const formatCurrency = (value: unknown) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '-';
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  return (
    <Box minH="100vh" bg="#F8FAFC">
      <Box
        bg="white"
        px={4}
        py={3}
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={1001}
        display={{ base: 'flex', md: 'none' }}
        alignItems="center"
        justifyContent="space-between"
        borderBottom="1px solid"
        borderColor="gray.100"
      >
        <HStack spacing={2}>
          <Box bg="brand.500" color="white" px={2} py={1} borderRadius="6px" fontWeight="800" fontSize="sm">
            <Icon as={FiUsers} boxSize={4} />
          </Box>
          <Text fontSize="lg" fontWeight="800" color="brand.500">
            Vendors
          </Text>
        </HStack>
        <UserProfile />
      </Box>

      <Box
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.100"
        px={{ base: 4, md: 8 }}
        py={{ base: 3, md: 4 }}
        boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={1001}
        display={{ base: 'none', md: 'block' }}
      >
        <Flex justify="space-between" align="center" maxW="1920px" mx="auto">
          <HStack spacing={3}>
            <Box bg="brand.500" color="white" px={3} py={2} borderRadius="8px" fontWeight="800">
              <Icon as={FiUsers} boxSize={5} />
            </Box>
            <Heading size="lg" color="brand.500" fontWeight="800">
              Vendor Management
            </Heading>
          </HStack>

          <HStack spacing={2}>
            <DesktopNavLinks />
            <Box ml={4}>
              <UserProfile />
            </Box>
          </HStack>
        </Flex>
      </Box>

      <Flex
        maxW="1920px"
        mx="auto"
        p={{ base: 3, sm: 4, md: 6 }}
        pt={{ base: '76px', md: '96px' }}
        pb={{ base: '84px', md: 6 }}
        gap={{ base: 3, md: 6 }}
        direction={{ base: 'column', lg: 'row' }}
      >
        <Box flex={{ lg: '0 0 380px' }} w={{ base: '100%', lg: '380px' }}>
          <VStack align="stretch" spacing={3}>
            <Box
              bgGradient="linear(to-br, brand.500, brand.600)"
              borderRadius="20px"
              p={6}
              color="white"
              boxShadow="0 8px 24px rgba(201, 31, 61, 0.3)"
            >
              <Badge bg="rgba(255,255,255,0.25)" color="white" px={3} py={1} borderRadius="full" mb={4}>
                VENDOR MASTER
              </Badge>
              <Heading size="lg" mb={3} fontWeight="800">
                Vendor Rate Library
              </Heading>
              <Text fontSize="sm" opacity={0.95}>
                Upload Excel vendor sheets here. Data is stored in vendor_rate_chunks for reference only.
                Quote generation still uses proposal PDF data.
              </Text>
            </Box>

            <VendorUpload onImported={loadData} />

            <SimpleGrid columns={3} spacing={3}>
              <Box bg="white" borderRadius="14px" p={4} boxShadow="sm">
                <Text fontSize="xs" color="gray.500">Total Rates</Text>
                <Text fontSize="xl" fontWeight="800">{summary.totalRates}</Text>
              </Box>
              <Box bg="white" borderRadius="14px" p={4} boxShadow="sm">
                <Text fontSize="xs" color="gray.500">Vendors</Text>
                <Text fontSize="xl" fontWeight="800">{summary.vendorCount}</Text>
              </Box>
              <Box bg="white" borderRadius="14px" p={4} boxShadow="sm">
                <Text fontSize="xs" color="gray.500">Imports</Text>
                <Text fontSize="xl" fontWeight="800">{summary.documentCount}</Text>
              </Box>
            </SimpleGrid>
          </VStack>
        </Box>

        <Box flex="1" minW="0" bg="white" borderRadius="16px" boxShadow="sm" p={{ base: 4, md: 5 }}>
          <Flex justify="space-between" align={{ base: 'start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3} mb={4}>
            <Box>
              <Heading size="md">Imported Vendor Rates</Heading>
              <Text fontSize="sm" color="gray.600">
                Browse vendor offers imported from Excel.
              </Text>
            </Box>
            <InputGroup maxW={{ base: '100%', md: '320px' }}>
              <InputLeftElement pointerEvents="none">
                <FiSearch color="gray" />
              </InputLeftElement>
              <Input
                placeholder="Search vendor, city, medium..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
          </Flex>

          {isLoading ? (
            <Flex justify="center" align="center" minH="240px">
              <Spinner color="brand.500" />
            </Flex>
          ) : filteredRates.length === 0 ? (
            <Flex justify="center" align="center" minH="240px">
              <Text color="gray.500">No vendor rates imported yet.</Text>
            </Flex>
          ) : (
            <Box overflowX="auto">
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>Vendor</Th>
                    <Th>City</Th>
                    <Th>Medium</Th>
                    <Th isNumeric>Rate</Th>
                    <Th isNumeric>Min Qty</Th>
                    <Th>Lead Time</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredRates.map((rate) => {
                    const metadata = rate.metadata || {};
                    return (
                      <Tr key={rate.id}>
                        <Td>{String(metadata.vendor_name || '-')}</Td>
                        <Td textTransform="capitalize">{String(metadata.city || '-')}</Td>
                        <Td>{rate.service_name}</Td>
                        <Td isNumeric>{formatCurrency(metadata.unit_price)}</Td>
                        <Td isNumeric>{String(metadata.min_qty || metadata.min_quantity || '-')}</Td>
                        <Td>
                          {metadata.lead_time_days
                            ? `${metadata.lead_time_days} days`
                            : '-'}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
};

export default VendorManagementPage;

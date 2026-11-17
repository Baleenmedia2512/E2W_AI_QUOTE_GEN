/**
 * Theatre Screen Ad rate card — cinema cards (client-friendly).
 * Colors match Corporate Minimal navy/blue. Theatre-only.
 */

import React from 'react';
import { Box, Text, SimpleGrid, VStack } from '@chakra-ui/react';
import type { TheatreRateCardRow } from '../../types/quote';

const NAVY = '#1a3a5c';
const BLUE = '#2980b9';
const LIGHT_BG = '#f0f4f8';
const ALT_ROW = '#f7f9fc';
const BORDER = '#d0dce8';

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function RateCell({
  label,
  value,
  kind = 'money',
  alt,
}: {
  label: string;
  value: number | null | undefined;
  kind?: 'money' | 'count';
  alt?: boolean;
}) {
  const display =
    kind === 'count'
      ? (value != null && value > 0 ? String(value) : '—')
      : fmt(value);
  return (
    <Box
      px={{ base: 3, md: 4 }}
      py={{ base: 2.5, md: 3 }}
      borderWidth="1px"
      borderColor={BORDER}
      bg={alt ? ALT_ROW : 'white'}
      minW={0}
    >
      <Text fontSize={{ base: '11px', md: '12px' }} color="#636e72" mb={1} fontWeight="500">
        {label}
      </Text>
      <Text fontSize={{ base: '15px', md: '16px' }} fontWeight="700" color={NAVY}>
        {display}
      </Text>
    </Box>
  );
}

export const TheatreRateCard: React.FC<{ rows: TheatreRateCardRow[] }> = ({ rows }) => {
  if (!rows?.length) return null;

  return (
    <Box mt={4} mb={5}>
      <Text
        fontSize={{ base: 'md', md: 'lg' }}
        fontWeight="700"
        letterSpacing="0.06em"
        textTransform="uppercase"
        color={NAVY}
        textAlign="center"
        mb={4}
        pb={2}
        borderBottomWidth="2px"
        borderBottomColor={BLUE}
      >
        Theatre Screen Ad — Rate Card
      </Text>

      <VStack spacing={4} align="stretch">
        {rows.map((row, i) => {
          const place =
            row.state && row.state !== '—'
              ? `${row.city} · ${row.state}`
              : row.city || '—';
          return (
            <Box
              key={row.serviceId || i}
              borderWidth="1px"
              borderColor={BORDER}
              borderRadius="lg"
              overflow="hidden"
              bg="white"
              boxShadow="sm"
            >
              <Box
                bg={NAVY}
                px={{ base: 3, md: 4 }}
                py={{ base: 3, md: 3.5 }}
                display="flex"
                gap={3}
                alignItems="flex-start"
              >
                <Text
                  fontWeight="800"
                  fontSize="md"
                  color="white"
                  lineHeight="1.2"
                  flexShrink={0}
                  minW="28px"
                >
                  {i + 1}.
                </Text>
                <Box minW={0}>
                  <Text
                    fontWeight="700"
                    fontSize={{ base: 'md', md: 'lg' }}
                    color="white"
                    lineHeight="1.3"
                  >
                    {row.cinema}
                  </Text>
                  <Text fontSize="sm" color="whiteAlpha.800" mt={1}>
                    {place}
                  </Text>
                </Box>
              </Box>

              <Box bg={LIGHT_BG} px={3} py={1.5} borderBottomWidth="1px" borderColor={BORDER}>
                <Text fontSize="xs" fontWeight="600" color={BLUE} letterSpacing="0.04em">
                  RATES (INR)
                </Text>
              </Box>

              <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} spacing={0}>
                <RateCell label="10s / week" value={row.rate10sWeek} />
                <RateCell label="20s / week" value={row.rate20sWeek} />
                <RateCell label="20s / 3 weeks" value={row.rate20s3Weeks} />
                <RateCell label="Arch / month" value={row.archMonth} alt />
                <RateCell label="Kiosk / month" value={row.kioskMonth} alt />
                <RateCell label="Standee / month" value={row.standeeMonth} alt />
                <RateCell label="Plasma screens" value={row.plasmaCount} kind="count" />
                <RateCell label="Plasma 10s / week" value={row.plasma10sWeek} />
              </SimpleGrid>
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
};

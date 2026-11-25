/**
 * Theatre Screen Ad rate card — cinema cards (client-friendly).
 * Shows only selected packages + 18% GST (excl / incl).
 * Theatre-only — does not affect other quotes.
 */

import React from 'react';
import { Box, Text, SimpleGrid, VStack, HStack } from '@chakra-ui/react';
import type { TheatreRateCardRow } from '../../types/quote';
import { theatreRateFieldsForKeys } from '../../utils/slabPricingUtils';

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
  gstPct,
}: {
  label: string;
  value: number | null | undefined;
  kind?: 'money' | 'count';
  alt?: boolean;
  gstPct: number;
}) {
  const hasMoney = kind === 'money' && value != null && value > 0;
  const display =
    kind === 'count'
      ? (value != null && value > 0 ? String(value) : '—')
      : fmt(value);
  const incl = hasMoney ? value! * (1 + gstPct / 100) : null;

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
        {hasMoney ? (
          <Text as="span" fontSize="11px" fontWeight="500" color="#636e72">
            {' '}
            excl. GST
          </Text>
        ) : null}
      </Text>
      {incl != null ? (
        <Text fontSize="12px" fontWeight="600" color={BLUE} mt={0.5}>
          {fmt(incl)} incl. GST @ {gstPct}%
        </Text>
      ) : null}
    </Box>
  );
}

function cinemaMoneySubtotal(row: TheatreRateCardRow): number {
  const fields = theatreRateFieldsForKeys(row.selectedSlabKeys);
  let sum = 0;
  for (const f of fields) {
    if (f.kind !== 'money') continue;
    const v = row[f.field];
    if (typeof v === 'number' && v > 0) sum += v;
  }
  return sum;
}

export const TheatreRateCard: React.FC<{
  rows: TheatreRateCardRow[];
  gstPercentage?: number;
}> = ({ rows, gstPercentage = 18 }) => {
  if (!rows?.length) return null;
  const gstPct = gstPercentage > 0 ? gstPercentage : 18;
  const grandExcl = rows.reduce((sum, row) => sum + cinemaMoneySubtotal(row), 0);
  const grandGst = grandExcl * (gstPct / 100);
  const grandIncl = grandExcl + grandGst;

  return (
    <Box mt={4} mb={5}>
      <Text
        fontSize={{ base: 'md', md: 'lg' }}
        fontWeight="700"
        letterSpacing="0.06em"
        textTransform="uppercase"
        color={NAVY}
        textAlign="center"
        mb={2}
        pb={2}
        borderBottomWidth="2px"
        borderBottomColor={BLUE}
      >
        Theatre Screen Ad — Rate Card
      </Text>
      <Text fontSize="sm" color={BLUE} fontWeight="600" textAlign="center" mb={4}>
        All package rates exclusive of GST · GST @ {gstPct}% applicable
      </Text>

      <VStack spacing={4} align="stretch">
        {rows.map((row, i) => {
          const place =
            row.state && row.state !== '—'
              ? `${row.city} · ${row.state}`
              : row.city || '—';
          const fields = theatreRateFieldsForKeys(row.selectedSlabKeys);
          if (!fields.length) return null;
          const excl = cinemaMoneySubtotal(row);
          const gstAmt = excl * (gstPct / 100);
          const incl = excl + gstAmt;
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
                  SELECTED RATES (INR) · GST @ {gstPct}%
                </Text>
              </Box>

              <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} spacing={0}>
                {fields.map((f, fi) => (
                  <RateCell
                    key={`${f.slabKey}-${f.field}`}
                    label={f.label}
                    value={row[f.field] as number | null | undefined}
                    kind={f.kind}
                    alt={Math.floor(fi / 3) % 2 === 1}
                    gstPct={gstPct}
                  />
                ))}
              </SimpleGrid>

              {excl > 0 ? (
                <Box bg={NAVY} px={4} py={3} borderTopWidth="1px" borderColor={BORDER}>
                  <HStack justify="space-between" mb={1}>
                    <Text fontSize="sm" color="whiteAlpha.800">
                      Subtotal (excl. GST)
                    </Text>
                    <Text fontSize="sm" fontWeight="600" color="white">
                      {fmt(excl)}
                    </Text>
                  </HStack>
                  <HStack justify="space-between" mb={1}>
                    <Text fontSize="sm" color="whiteAlpha.800">
                      GST @ {gstPct}%
                    </Text>
                    <Text fontSize="sm" fontWeight="600" color="white">
                      {fmt(gstAmt)}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="md" fontWeight="700" color="white">
                      Total (incl. GST)
                    </Text>
                    <Text fontSize="md" fontWeight="800" color="white">
                      {fmt(incl)}
                    </Text>
                  </HStack>
                </Box>
              ) : null}
            </Box>
          );
        })}

        {grandExcl > 0 ? (
          <Box
            borderWidth="2px"
            borderColor={NAVY}
            borderRadius="lg"
            overflow="hidden"
            bg="white"
          >
            <Box bg={BLUE} px={4} py={2.5}>
              <Text
                fontSize="sm"
                fontWeight="700"
                color="white"
                textAlign="center"
                letterSpacing="0.04em"
                textTransform="uppercase"
              >
                Grand Total — All Cinemas · GST @ {gstPct}%
              </Text>
            </Box>
            <Box bg={LIGHT_BG} px={4} py={3}>
              <HStack justify="space-between" mb={1}>
                <Text fontSize="sm" color={NAVY}>
                  Subtotal (excl. GST)
                </Text>
                <Text fontSize="sm" fontWeight="700" color={NAVY}>
                  {fmt(grandExcl)}
                </Text>
              </HStack>
              <HStack justify="space-between" mb={2}>
                <Text fontSize="sm" color={NAVY}>
                  GST @ {gstPct}%
                </Text>
                <Text fontSize="sm" fontWeight="700" color={NAVY}>
                  {fmt(grandGst)}
                </Text>
              </HStack>
              <HStack
                justify="space-between"
                pt={2}
                borderTopWidth="1px"
                borderColor={BORDER}
              >
                <Text fontSize="md" fontWeight="800" color={NAVY}>
                  Grand Total (incl. GST)
                </Text>
                <Text fontSize="md" fontWeight="800" color={NAVY}>
                  {fmt(grandIncl)}
                </Text>
              </HStack>
            </Box>
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
};

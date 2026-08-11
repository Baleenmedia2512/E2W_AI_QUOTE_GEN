import React, { useCallback, useEffect, useState } from 'react';
import { Box, Icon, IconButton, Text } from '@chakra-ui/react';
import { FiX } from 'react-icons/fi';

type Preview = { url: string; label: string };

type Listener = (preview: Preview | null) => void;

const listeners = new Set<Listener>();

/** Open chip image preview without re-rendering ChatInterface. */
export function openChipImagePreview(url: string, label = ''): void {
  const trimmed = (url || '').trim();
  if (!trimmed) return;
  const next: Preview = { url: trimmed, label: label || '' };
  listeners.forEach((fn) => fn(next));
}

export function closeChipImagePreview(): void {
  listeners.forEach((fn) => fn(null));
}

/**
 * Mount once near ChatInterface root.
 * Keeps lightbox state local so open/close does not re-render the message list.
 * Mobile-first: safe-area padding, 44px close target, image fits narrow widths.
 */
export const ChipImageLightbox: React.FC = () => {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const onPreview: Listener = (next) => setPreview(next);
    listeners.add(onPreview);
    return () => {
      listeners.delete(onPreview);
    };
  }, []);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChipImagePreview();
    };
    // Lock background scroll while open (esp. mobile)
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [preview]);

  const close = useCallback(() => closeChipImagePreview(), []);

  if (!preview) return null;

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={10000}
      bg="rgba(0,0,0,0.82)"
      display="flex"
      flexDirection="column"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      sx={{
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingRight: 'max(12px, env(safe-area-inset-right))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(12px, env(safe-area-inset-left))',
      }}
    >
      {/* Header bar — keeps close button on-screen and tappable on 320px */}
      <Box
        flexShrink={0}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={3}
        px={{ base: 1, sm: 2 }}
        pb={2}
        onClick={(e) => e.stopPropagation()}
      >
        <Text
          color="white"
          fontSize={{ base: '13px', sm: '15px' }}
          fontWeight="600"
          noOfLines={2}
          flex="1"
          minW={0}
          pl={1}
        >
          {preview.label || 'Reference'}
        </Text>
        <IconButton
          aria-label="Close image preview"
          icon={<Icon as={FiX} boxSize={{ base: 5, sm: 5 }} />}
          borderRadius="full"
          bg="white"
          color="gray.800"
          boxShadow="0 2px 10px rgba(0,0,0,0.35)"
          flexShrink={0}
          // WCAG / mobile thumb target ≥ 44px
          w={{ base: '44px', sm: '40px' }}
          h={{ base: '44px', sm: '40px' }}
          minW={{ base: '44px', sm: '40px' }}
          _hover={{ bg: 'gray.100' }}
          _active={{ bg: 'gray.200' }}
          onClick={close}
        />
      </Box>

      {/* Image stage */}
      <Box
        flex="1"
        minH={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        px={{ base: 1, sm: 3 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Box
          maxW={{ base: '100%', sm: 'min(92vw, 720px)' }}
          maxH={{ base: '100%', sm: '80vh' }}
          w="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius={{ base: '12px', sm: '14px' }}
          overflow="hidden"
          bg="black"
          boxShadow="0 8px 32px rgba(0,0,0,0.4)"
        >
          <img
            src={preview.url}
            alt={preview.label || 'Reference'}
            decoding="async"
            style={{
              width: '100%',
              height: 'auto',
              maxHeight: 'min(78dvh, calc(100dvh - 120px))',
              objectFit: 'contain',
              display: 'block',
              background: '#000',
            }}
          />
        </Box>
      </Box>

      {/* Hint for tap-outside on mobile */}
      <Text
        flexShrink={0}
        textAlign="center"
        color="whiteAlpha.700"
        fontSize="11px"
        pt={2}
        pb={1}
        display={{ base: 'block', md: 'none' }}
        onClick={close}
      >
        Tap outside to close
      </Text>
    </Box>
  );
};

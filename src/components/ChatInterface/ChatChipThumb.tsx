import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';
import { openChipImagePreview } from './ChipImageLightbox';

interface ChatChipThumbProps {
  url: string;
  label: string;
  size?: number;
  /** full = circle chip thumb; md = rounded card for Continue preview */
  radius?: 'full' | 'md';
}

/**
 * Lazy chip thumbnail: loads only when near viewport, async decode,
 * click opens lightbox without selecting the parent chip.
 */
export const ChatChipThumb: React.FC<ChatChipThumbProps> = React.memo(
  ({ url, label, size = 32, radius = 'full' }) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [shouldLoad, setShouldLoad] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      setFailed(false);
      setShouldLoad(false);
      const el = wrapRef.current;
      if (!el || !url) return undefined;

      // Safari / older WebViews may lack IntersectionObserver — load immediately
      if (typeof IntersectionObserver === 'undefined') {
        setShouldLoad(true);
        return undefined;
      }

      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShouldLoad(true);
            io.disconnect();
          }
        },
        { root: null, rootMargin: '120px 0px', threshold: 0.01 },
      );
      io.observe(el);
      return () => io.disconnect();
    }, [url]);

    if (!url || failed) return null;

    return (
      <Box
        ref={wrapRef}
        as="span"
        display="inline-flex"
        flexShrink={0}
        w={`${size}px`}
        h={`${size}px`}
        borderRadius={radius === 'full' ? 'full' : '12px'}
        overflow="hidden"
        bg="gray.100"
        cursor="zoom-in"
        title="View image"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openChipImagePreview(url, label);
        }}
        onMouseDown={(e) => {
          // Prevent parent button/chip from treating this as a select press
          e.stopPropagation();
        }}
        style={{ contentVisibility: 'auto' }}
      >
        {shouldLoad ? (
          <img
            src={url}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            style={{
              width: size,
              height: size,
              objectFit: 'cover',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </Box>
    );
  },
);

ChatChipThumb.displayName = 'ChatChipThumb';

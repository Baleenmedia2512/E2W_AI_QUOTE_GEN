import { extendTheme, type ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

const theme = extendTheme({
  config,
  colors: {
    // Professional Burgundy/Maroon Primary
    brand: {
      50: '#FFF0F3',
      100: '#FFE1E6',
      200: '#FFC7D1',
      300: '#FF9DAF',
      400: '#FF6B8A',
      500: '#C91F3D', // Main brand color - burgundy
      600: '#A50D29', // Deeper burgundy
      700: '#85061E',
      800: '#650416',
      900: '#4A0310',
    },
    // Dark accent for emphasis cards
    dark: {
      50: '#F8F9FA',
      100: '#E9ECEF',
      200: '#DEE2E6',
      300: '#CED4DA',
      400: '#ADB5BD',
      500: '#495057',
      600: '#343A40',
      700: '#212529',
      800: '#1A1D20',
      900: '#0D0E10',
    },
    // Gold/Yellow accent for premium feel
    accent: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      200: '#FDE68A',
      300: '#FCD34D',
      400: '#FBBF24',
      500: '#F59E0B',
      600: '#D97706',
      700: '#B45309',
      800: '#92400E',
      900: '#78350F',
    },
    // Additional colors for status
    success: {
      500: '#10B981',
      600: '#059669',
    },
    warning: {
      500: '#F59E0B',
      600: '#D97706',
    },
    error: {
      500: '#EF4444',
      600: '#DC2626',
    },
  },
  fonts: {
    heading: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif`,
    body: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif`,
  },
  styles: {
    global: {
      body: {
        bg: '#FFFFFF', // Pure white for native feel
        color: '#1E293B',
      },
      '*': {
        WebkitTapHighlightColor: 'transparent', // Remove tap highlight on mobile
      },
    },
  },
  components: {
    Button: {
      defaultProps: {
        colorScheme: 'brand',
        size: 'lg',
      },
      variants: {
        solid: {
          borderRadius: '16px', // More rounded for native feel
          fontWeight: '600',
          height: { base: '52px', md: '48px' }, // Larger on mobile
          px: 6,
          bg: 'brand.500',
          color: 'white',
          boxShadow: '0 4px 12px rgba(201, 31, 61, 0.3)',
          _hover: {
            bg: 'brand.600',
            transform: 'translateY(-1px)',
            boxShadow: '0 6px 20px rgba(201, 31, 61, 0.4)',
          },
          _active: {
            transform: 'scale(0.98)',
          },
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        dark: {
          borderRadius: '16px',
          fontWeight: '600',
          height: { base: '52px', md: '48px' },
          px: 6,
          bg: 'dark.800',
          color: 'white',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          _hover: {
            bg: 'dark.700',
            transform: 'translateY(-1px)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
          },
          _active: {
            transform: 'scale(0.98)',
          },
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        outline: {
          borderRadius: '16px',
          fontWeight: '600',
          height: { base: '52px', md: '48px' },
          borderWidth: '2px',
          borderColor: 'brand.500',
          color: 'brand.500',
          _hover: {
            bg: 'brand.50',
          },
        },
        ghost: {
          borderRadius: '16px',
          fontWeight: '500',
          _hover: {
            bg: 'gray.100',
          },
        },
      },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: '20px', // More rounded for modern look
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
          bg: 'white',
          border: 'none',
          overflow: 'hidden',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          _hover: {
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            transform: 'translateY(-2px)',
          },
        },
      },
    },
    Input: {
      defaultProps: {
        focusBorderColor: 'brand.500',
        size: 'lg',
      },
      variants: {
        outline: {
          field: {
            borderRadius: '14px',
            height: { base: '52px', md: '48px' }, // Touch-friendly
            fontSize: '16px', // Prevent zoom on iOS
            bg: 'white',
            border: '2px solid',
            borderColor: 'gray.200',
            _hover: {
              borderColor: 'gray.300',
            },
            _focus: {
              borderColor: 'brand.500',
              boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.1)',
            },
          },
        },
        filled: {
          field: {
            borderRadius: '14px',
            height: { base: '52px', md: '48px' },
            fontSize: '16px',
            bg: 'gray.50',
            border: 'none',
            _hover: {
              bg: 'gray.100',
            },
            _focus: {
              bg: 'white',
              borderColor: 'brand.500',
              boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.1)',
            },
          },
        },
      },
    },
    Textarea: {
      defaultProps: {
        focusBorderColor: 'brand.500',
        size: 'lg',
      },
      variants: {
        outline: {
          borderRadius: '14px',
          fontSize: '16px',
          bg: 'white',
          border: '2px solid',
          borderColor: 'gray.200',
          _hover: {
            borderColor: 'gray.300',
          },
          _focus: {
            borderColor: 'brand.500',
            boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.1)',
          },
        },
      },
    },
    Heading: {
      baseStyle: {
        fontWeight: '700',
        letterSpacing: '-0.02em',
      },
    },
  },
  shadows: {
    // Custom shadows for depth
    card: '0 2px 8px rgba(0, 0, 0, 0.06)',
    cardHover: '0 8px 24px rgba(0, 0, 0, 0.12)',
    floating: '0 12px 32px rgba(0, 0, 0, 0.15)',
  },
  radii: {
    card: '20px',
    button: '16px',
    input: '14px',
  },
});

export default theme;

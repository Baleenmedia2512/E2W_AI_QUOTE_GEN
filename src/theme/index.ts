import { extendTheme, type ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

const theme = extendTheme({
  config,
  colors: {
    brand: {
      50: '#FFF0F3',
      100: '#FFD6DE',
      200: '#FFB0BE',
      300: '#E87E92',
      400: '#C95468',
      500: '#750926',
      600: '#5a0619',
      700: '#450513',
      800: '#33030E',
      900: '#220209',
    },
    accent: {
      50: '#F0FFF0',
      100: '#D4F7D4',
      200: '#A8EFA8',
      300: '#6DD86D',
      400: '#3FBF3F',
      500: '#216800',
      600: '#1A5500',
      700: '#144200',
      800: '#0E3000',
      900: '#081E00',
    },
  },
  fonts: {
    heading: `'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
    body: `'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  },
  styles: {
    global: {
      body: {
        bg: '#EDF1F7',
        color: 'gray.800',
      },
    },
  },
  components: {
    Button: {
      defaultProps: {
        colorScheme: 'brand',
      },
      variants: {
        solid: {
          borderRadius: 'lg',
          fontWeight: '600',
          _hover: {
            transform: 'translateY(-2px)',
            boxShadow: 'lg',
          },
          transition: 'all 0.2s',
        },
        outline: {
          borderRadius: 'lg',
          fontWeight: '600',
          borderWidth: '2px',
        },
      },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: 'xl',
          boxShadow: 'sm',
          _hover: {
            boxShadow: 'md',
          },
          transition: 'all 0.2s',
        },
      },
    },
    Input: {
      defaultProps: {
        focusBorderColor: 'brand.500',
      },
      variants: {
        outline: {
          field: {
            borderRadius: 'lg',
            borderWidth: '2px',
          },
        },
      },
    },
    Textarea: {
      defaultProps: {
        focusBorderColor: 'brand.500',
      },
      variants: {
        outline: {
          borderRadius: 'lg',
          borderWidth: '2px',
        },
      },
    },
  },
});

export default theme;

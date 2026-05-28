import React from 'react';
import {
  Box,
  Container,
  HStack,
  Text,
  Circle,
  Flex,
  Progress,
  Icon,
} from '@chakra-ui/react';
import { FiCheck } from 'react-icons/fi';

interface QuoteStepperProps {
  currentStep: number; // 1-4
}

const steps = [
  { number: 1, label: 'Company Info' },
  { number: 2, label: 'Client Info' },
  { number: 3, label: 'Preview & Edit' },
];

const QuoteStepper: React.FC<QuoteStepperProps> = ({ currentStep }) => {
  return (
    <Box bg="white" py={6} borderBottom="1px solid" borderColor="gray.200">
      <Container maxW="1280px">
        <HStack spacing={{ base: 2, md: 4 }} justify="center" wrap="wrap">
          {steps.map((step, index) => (
            <React.Fragment key={step.number}>
              {/* Step Indicator */}
              <Flex align="center" gap={2}>
                <Circle
                  size={{ base: '32px', md: '40px' }}
                  bg={
                    step.number < currentStep
                      ? '#750926'
                      : step.number === currentStep
                      ? '#750926'
                      : 'gray.200'
                  }
                  color={
                    step.number <= currentStep ? 'white' : 'gray.500'
                  }
                  fontWeight="600"
                  fontSize={{ base: 'sm', md: 'md' }}
                  border="3px solid"
                  borderColor={
                    step.number <= currentStep ? '#750926' : 'gray.300'
                  }
                  transition="all 0.3s"
                >
                  {step.number < currentStep ? (
                    <Icon as={FiCheck} boxSize={5} />
                  ) : (
                    step.number
                  )}
                </Circle>
                <Box display={{ base: 'none', sm: 'block' }}>
                  <Text
                    fontSize={{ base: 'xs', md: 'sm' }}
                    fontWeight={step.number === currentStep ? '600' : '500'}
                    color={
                      step.number === currentStep ? '#750926' : 
                      step.number < currentStep ? '#750926' :
                      'gray.600'
                    }
                  >
                    {step.label}
                  </Text>
                </Box>
              </Flex>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <Box
                  width={{ base: '20px', md: '60px' }}
                  height="3px"
                  bg={step.number < currentStep ? '#750926' : 'transparent'}
                  borderTop={step.number < currentStep ? 'none' : '3px dashed'}
                  borderColor={step.number < currentStep ? 'transparent' : 'gray.300'}
                  transition="all 0.3s"
                  display={{ base: 'none', sm: 'block' }}
                />
              )}
            </React.Fragment>
          ))}
        </HStack>

        {/* Progress Bar for Mobile */}
        <Box mt={4} display={{ base: 'block', sm: 'none' }}>
          <Progress
            value={(currentStep / steps.length) * 100}
            size="sm"
            colorScheme="brand"
            borderRadius="full"
          />
        </Box>
      </Container>
    </Box>
  );
};

export default QuoteStepper;

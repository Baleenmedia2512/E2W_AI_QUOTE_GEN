import React from 'react';
import { Grid, GridItem, Box } from '@chakra-ui/react';
import Layout from '../components/Layout/Layout';
import ProposalUpload from '../components/ProposalUpload/ProposalUpload';
import ProposalViewer from '../components/ProposalViewer/ProposalViewer';
import ChatInterface from '../components/ChatInterface/ChatInterface';

const HomePage: React.FC = () => {
  return (
    <Layout title="AI Quote Generator">
      <Grid
        templateColumns={{ base: '1fr', lg: 'repeat(12, 1fr)' }}
        gap={{ base: 4, md: 6 }}
        w="full"
      >
        {/* Left Column - Upload & Chat */}
        <GridItem colSpan={{ base: 1, lg: 4 }}>
          <Box display="flex" flexDirection="column" gap={{ base: 4, md: 6 }}>
            <ProposalUpload />
            <ChatInterface />
          </Box>
        </GridItem>

        {/* Right Column - Viewer */}
        <GridItem colSpan={{ base: 1, lg: 8 }}>
          <ProposalViewer />
        </GridItem>
      </Grid>
    </Layout>
  );
};

export default HomePage;

import React from 'react';
import { IonGrid, IonRow, IonCol } from '@ionic/react';
import Layout from '../components/Layout/Layout';
import ProposalUpload from '../components/ProposalUpload/ProposalUpload';
import ProposalViewer from '../components/ProposalViewer/ProposalViewer';

const HomePage: React.FC = () => {
  return (
    <Layout title="AI Quote Generator">
      <IonGrid>
        <IonRow>
          <IonCol size="12" sizeMd="4">
            <ProposalUpload />
          </IonCol>
          <IonCol size="12" sizeMd="8">
            <ProposalViewer />
          </IonCol>
        </IonRow>
      </IonGrid>
    </Layout>
  );
};

export default HomePage;

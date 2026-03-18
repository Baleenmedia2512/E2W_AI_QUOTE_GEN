import React, { useState } from 'react';
import { IonGrid, IonRow, IonCol, IonButton, IonIcon } from '@ionic/react';
import { arrowBackSharp } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import Layout from '../components/Layout/Layout';
import CompanyInfoForm from '../components/CompanyInfoForm/CompanyInfoForm';
import ClientInfoForm from '../components/ClientInfoForm/ClientInfoForm';
import QuotePreview from '../components/QuotePreview/QuotePreview';
import { useAppStore } from '../store';
import { CompanyInfo } from '../types/company';
import { ClientInfo } from '../types/client';
import { Quote } from '../types/quote';
import { saveCompanyInfo } from '../utils/localStorage';

type QuoteStep = 'company' | 'client' | 'preview';

const QuotePage: React.FC = () => {
  const history = useHistory();
  const { currentQuote, updateQuote, companyInfo, clientInfo, setCompanyInfo, setClientInfo } = useAppStore();
  const [currentStep, setCurrentStep] = useState<QuoteStep>('company');

  const handleCompanySubmit = (info: CompanyInfo) => {
    setCompanyInfo(info);
    saveCompanyInfo(info);
    setCurrentStep('client');
  };

  const handleClientSubmit = (info: ClientInfo) => {
    setClientInfo(info);
    setCurrentStep('preview');
  };

  const handleQuoteUpdate = (quote: Quote) => {
    updateQuote(quote);
  };

  const handleSaveQuote = () => {
    // TODO: Implement quote saving/export functionality
    console.log('Saving quote:', currentQuote);
    alert('Quote saved! (Export functionality coming soon)');
  };

  const handleGeneratePDF = () => {
    if (!currentQuote || !companyInfo || !clientInfo) {
      alert('Please complete all steps before generating PDF');
      return;
    }
    // Navigate to preview page for template selection and PDF generation
    history.push('/preview');
  };

  const handleBack = () => {
    if (currentStep === 'preview') {
      setCurrentStep('client');
    } else if (currentStep === 'client') {
      setCurrentStep('company');
    } else {
      history.push('/');
    }
  };

  return (
    <Layout title="Create Quote">
      <div style={{ padding: '16px' }}>
        <IonButton fill="clear" onClick={handleBack}>
          <IonIcon icon={arrowBackSharp} slot="start" />
          Back
        </IonButton>

        <IonGrid>
          <IonRow>
            <IonCol size="12">
              {/* Progress indicator */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                marginBottom: '24px',
                gap: '12px'
              }}>
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  background: currentStep === 'company' ? 'var(--ion-color-primary)' : 'var(--ion-color-light)',
                  color: currentStep === 'company' ? 'white' : 'var(--ion-color-dark)',
                  fontWeight: 600,
                  fontSize: '14px'
                }}>
                  1. Company Info
                </div>
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  background: currentStep === 'client' ? 'var(--ion-color-primary)' : 'var(--ion-color-light)',
                  color: currentStep === 'client' ? 'white' : 'var(--ion-color-dark)',
                  fontWeight: 600,
                  fontSize: '14px'
                }}>
                  2. Client Info
                </div>
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  background: currentStep === 'preview' ? 'var(--ion-color-primary)' : 'var(--ion-color-light)',
                  color: currentStep === 'preview' ? 'white' : 'var(--ion-color-dark)',
                  fontWeight: 600,
                  fontSize: '14px'
                }}>
                  3. Preview & Edit
                </div>
              </div>

              {/* Form Steps */}
              {currentStep === 'company' && (
                <CompanyInfoForm
                  onSubmit={handleCompanySubmit}
                  initialData={companyInfo}
                />
              )}

              {currentStep === 'client' && (
                <ClientInfoForm
                  onSubmit={handleClientSubmit}
                  onBack={() => setCurrentStep('company')}
                  initialData={clientInfo}
                />
              )}

              {currentStep === 'preview' && (
                <>
                  <QuotePreview
                    quote={currentQuote}
                    onUpdate={handleQuoteUpdate}
                    onSave={handleSaveQuote}
                  />
                  <div style={{ 
                    marginTop: '24px', 
                    display: 'flex', 
                    gap: '12px',
                    justifyContent: 'flex-end'
                  }}>
                    <IonButton
                      fill="outline"
                      onClick={() => setCurrentStep('client')}
                    >
                      Back
                    </IonButton>
                    <IonButton
                      color="primary"
                      onClick={handleGeneratePDF}
                    >
                      Continue to Template Selection
                    </IonButton>
                  </div>
                </>
              )}
            </IonCol>
          </IonRow>
        </IonGrid>
      </div>
    </Layout>
  );
};

export default QuotePage;

import React, { useState, useEffect } from 'react';
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
  const { currentQuote, updateQuote, setCurrentQuote, companyInfo, clientInfo, setCompanyInfo, setClientInfo } = useAppStore();
  const [currentStep, setCurrentStep] = useState<QuoteStep>('company');

  // Determine initial step based on available data
  useEffect(() => {
    if (!companyInfo) {
      setCurrentStep('company');
    } else if (!clientInfo) {
      setCurrentStep('client');
    } else if (currentQuote) {
      setCurrentStep('preview');
    }
  }, []); // Only run on mount

  // Initialize quote when entering preview step ONLY if coming from manual flow (not AI chat)
  // If there's already a quote (from AI), preserve it
  useEffect(() => {
    if (currentStep === 'preview' && !currentQuote) {
      // Only create blank quote for manual entry flow
      const newQuote: Quote = {
        id: Date.now().toString(),
        quoteNumber: `Q-${Date.now()}`,
        date: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: [],
        subtotal: 0,
        gstEnabled: true,
        gstPercentage: 18, // Default GST percentage
        gstAmount: 0,
        total: 0,
        deliveryTimeline: '',
        termsAndConditions: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setCurrentQuote(newQuote);
    }
  }, [currentStep, currentQuote, setCurrentQuote]);

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
    if (!currentQuote) {
      alert('No quote to save');
      return;
    }
    
    // Save to local storage
    const savedQuotes = JSON.parse(localStorage.getItem('savedQuotes') || '[]');
    const existingIndex = savedQuotes.findIndex((q: Quote) => q.id === currentQuote.id);
    
    if (existingIndex >= 0) {
      savedQuotes[existingIndex] = currentQuote;
      alert('Quote updated successfully!');
    } else {
      savedQuotes.push(currentQuote);
      alert('Quote saved successfully!');
    }
    
    localStorage.setItem('savedQuotes', JSON.stringify(savedQuotes));
    console.log('Saved quote:', currentQuote);
  };

  const handleGeneratePDF = () => {
    console.log('🔍 Generate PDF clicked');
    console.log('Current Quote:', currentQuote);
    console.log('Company Info:', companyInfo);
    console.log('Client Info:', clientInfo);
    
    if (!currentQuote) {
      alert('Please create a quote first');
      return;
    }
    
    // If company info is missing, navigate to company step
    if (!companyInfo) {
      console.log('❌ Company info missing, navigating to company step');
      setCurrentStep('company');
      return;
    }
    
    // If client info is missing, navigate to client step
    if (!clientInfo) {
      console.log('❌ Client info missing, navigating to client step');
      setCurrentStep('client');
      return;
    }
    
    // All info is complete, navigate to template selection
    console.log('✅ All info complete, navigating to /preview');
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
                    justifyContent: 'flex-end',
                    padding: '16px',
                    background: '#f8f9fa',
                    borderRadius: '8px',
                    border: '1px solid #dee2e6'
                  }}>
                    <IonButton
                      fill="outline"
                      onClick={() => setCurrentStep('client')}
                      style={{ minWidth: '120px' }}
                    >
                      Back
                    </IonButton>
                    <IonButton
                      color="primary"
                      onClick={handleGeneratePDF}
                      style={{ 
                        minWidth: '220px',
                        fontWeight: '600',
                        fontSize: '15px'
                      }}
                    >
                      {!companyInfo ? 'Add Company Info to Continue' : 
                       !clientInfo ? 'Add Client Info to Continue' : 
                       'Continue to Template Selection'}
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

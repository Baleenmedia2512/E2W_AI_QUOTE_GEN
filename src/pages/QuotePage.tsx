import React, { useState, useEffect } from 'react';
import { IonGrid, IonRow, IonCol, IonButton, IonIcon, IonCard, IonCardHeader, IonCardTitle, IonCardContent } from '@ionic/react';
import { arrowBackSharp, checkmarkCircle } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import Layout from '../components/Layout/Layout';
import CompanyInfoForm from '../components/CompanyInfoForm/CompanyInfoForm';
import ClientInfoForm from '../components/ClientInfoForm/ClientInfoForm';
import QuotePreview from '../components/QuotePreview/QuotePreview';
import { TemplateSelector } from '../components/TemplateSelector/TemplateSelector';
import { useAppStore } from '../store';
import { CompanyInfo } from '../types/company';
import { ClientInfo } from '../types/client';
import { Quote } from '../types/quote';
import { saveCompanyInfo } from '../utils/localStorage';

type QuoteStep = 'company' | 'client' | 'preview' | 'template';

const QuotePage: React.FC = () => {
  const history = useHistory();
  const { currentQuote, updateQuote, setCurrentQuote, companyInfo, clientInfo, setCompanyInfo, setClientInfo, selectedTemplate, setSelectedTemplate } = useAppStore();
  const [currentStep, setCurrentStep] = useState<QuoteStep>('company');
  const [isNavigating, setIsNavigating] = useState(false);

  // Determine initial step based on available data
  useEffect(() => {
    console.log('📄 QuotePage mounted - checking data...');
    console.log('Has companyInfo:', !!companyInfo);
    console.log('Has clientInfo:', !!clientInfo);
    console.log('Has currentQuote:', !!currentQuote);
    
    if (!companyInfo) {
      console.log('→ Setting step to: company');
      setCurrentStep('company');
    } else if (!clientInfo) {
      console.log('→ Setting step to: client');
      setCurrentStep('client');
    } else if (currentQuote) {
      console.log('→ Setting step to: preview');
      setCurrentStep('preview');
    }
  }, []); // Only run on mount



  const handleCompanySubmit = (info: CompanyInfo) => {
    setCompanyInfo(info);
    saveCompanyInfo(info);
    setCurrentStep('client');
  };

  const handleClientSubmit = (info: ClientInfo) => {
    setClientInfo(info);
    
    // Create quote if it doesn't exist (for manual flow)
    if (!currentQuote) {
      const newQuote: Quote = {
        id: Date.now().toString(),
        quoteNumber: `Q-${Date.now()}`,
        date: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          {
            id: '1',
            description: 'Sample Service/Product (Edit in preview)',
            quantity: 1,
            unitPrice: 1000,
            total: 1000
          }
        ],
        subtotal: 1000,
        gstEnabled: true,
        gstPercentage: 18,
        gstAmount: 180,
        total: 1180,
        deliveryTimeline: '2-4 weeks',
        termsAndConditions: 'Payment terms: 50% advance, 50% on completion',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setCurrentQuote(newQuote);
      console.log('✅ Created new quote with sample item:', newQuote);
    }
    
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
    console.log('🔍 Continue to Template clicked');
    
    if (!currentQuote) {
      console.error('❌ No quote available');
      alert('Please create a quote first');
      return;
    }
    
    if (!companyInfo) {
      console.error('❌ Company info missing');
      alert('Please add company information first');
      setCurrentStep('company');
      return;
    }
    
    if (!clientInfo) {
      console.error('❌ Client info missing');
      alert('Please add client information first');
      setCurrentStep('client');
      return;
    }
    
    console.log('✅ Validation passed - moving to template selection...');
    setCurrentStep('template');
  };

  const handleTemplateSelected = () => {
    console.log('🚀 PREVIEW & EXPORT PDF BUTTON CLICKED');
    console.log('Template selected:', selectedTemplate);
    console.log('Current quote:', currentQuote);
    console.log('Company info:', companyInfo);
    console.log('Client info:', clientInfo);
    
    setIsNavigating(true);
    
    try {
      // Ensure quote has at least one item for preview
      if (currentQuote && currentQuote.items.length === 0) {
        console.log('⚠️ Quote has no items, adding sample item...');
        const updatedQuote = {
          ...currentQuote,
          items: [{
            id: '1',
            description: 'Sample Service/Product (Edit in preview)',
            quantity: 1,
            unitPrice: 1000,
            total: 1000
          }],
          subtotal: 1000,
          gstAmount: 180,
          total: 1180
        };
        setCurrentQuote(updatedQuote);
        localStorage.setItem('currentQuote', JSON.stringify(updatedQuote));
        console.log('✅ Sample item added to quote');
      } else if (currentQuote) {
        localStorage.setItem('currentQuote', JSON.stringify(currentQuote));
        console.log('✅ Quote saved to localStorage');
      } else {
        console.error('❌ No quote to save!');
        alert('Please create a quote first');
        setIsNavigating(false);
        return;
      }
      
      if (companyInfo) {
        localStorage.setItem('companyInfo', JSON.stringify(companyInfo));
        console.log('✅ Company info saved to localStorage');
      } else {
        console.error('❌ No company info to save!');
      }
      
      if (clientInfo) {
        localStorage.setItem('clientInfo', JSON.stringify(clientInfo));
        console.log('✅ Client info saved to localStorage');
      } else {
        console.error('❌ No client info to save!');
      }
      
      localStorage.setItem('selectedTemplate', selectedTemplate);
      console.log('✅ Template saved to localStorage:', selectedTemplate);
      
      console.log('🔄 Navigating to /preview...');
      console.log('History object:', history);
      
      // Try multiple navigation methods
      try {
        history.push('/preview');
        console.log('✅ history.push executed');
      } catch (navError) {
        console.error('❌ history.push failed:', navError);
        console.log('🔄 Trying window.location fallback...');
        window.location.href = '/preview';
      }
      
    } catch (error) {
      console.error('❌ Error in handleTemplateSelected:', error);
      alert('An error occurred: ' + (error as Error).message);
      setIsNavigating(false);
    }
  };

  const handleBack = () => {
    if (currentStep === 'template') {
      setCurrentStep('preview');
    } else if (currentStep === 'preview') {
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
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  background: currentStep === 'template' ? 'var(--ion-color-primary)' : 'var(--ion-color-light)',
                  color: currentStep === 'template' ? 'white' : 'var(--ion-color-dark)',
                  fontWeight: 600,
                  fontSize: '14px'
                }}>
                  4. Choose Template
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

              {currentStep === 'preview' && currentQuote && (
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
                    border: '1px solid #dee2e6',
                    position: 'relative',
                    zIndex: 10
                  }}>
                    <IonButton
                      fill="outline"
                      onClick={() => {
                        console.log('🔙 Back button clicked');
                        setCurrentStep('client');
                      }}
                      style={{ minWidth: '120px' }}
                    >
                      Back
                    </IonButton>
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('🔘 Continue button CLICKED!');
                        console.log('Has companyInfo:', !!companyInfo);
                        console.log('Has clientInfo:', !!clientInfo);
                        console.log('Has currentQuote:', !!currentQuote);
                        handleGeneratePDF();
                      }}
                      disabled={!companyInfo || !clientInfo || !currentQuote}
                      style={{ 
                        minWidth: '220px',
                        fontWeight: '600',
                        fontSize: '15px',
                        cursor: 'pointer',
                        pointerEvents: 'auto'
                      }}
                    >
                      {!companyInfo ? 'Add Company Info to Continue' : 
                       !clientInfo ? 'Add Client Info to Continue' : 
                       'Continue to Template Selection'}
                    </IonButton>
                  </div>
                </>
              )}

              {currentStep === 'template' && (
                <>
                  <IonCard style={{ marginTop: '20px' }}>
                    <IonCardHeader>
                      <IonCardTitle style={{ fontSize: '24px', textAlign: 'center' }}>
                        Choose Your Template
                      </IonCardTitle>
                      <p style={{ textAlign: 'center', color: '#666', marginTop: '10px' }}>
                        Select a professional template that best represents your brand
                      </p>
                    </IonCardHeader>
                    <IonCardContent>
                      <div style={{ minHeight: '400px' }}>
                        <TemplateSelector
                          selectedTemplate={selectedTemplate}
                          onSelectTemplate={(template) => {
                            console.log('✅ Template selected:', template);
                            setSelectedTemplate(template);
                          }}
                        />
                      </div>
                      <div style={{ 
                        marginTop: '24px', 
                        display: 'flex', 
                        gap: '12px',
                        justifyContent: 'space-between',
                        padding: '20px',
                        background: '#f8f9fa',
                        borderRadius: '8px'
                      }}>
                        <IonButton
                          fill="outline"
                          onClick={() => {
                            console.log('Going back to preview');
                            setCurrentStep('preview');
                          }}
                          style={{ flex: 1 }}
                        >
                          <IonIcon icon={arrowBackSharp} slot="start" />
                          Back to Quote
                        </IonButton>
                        <IonButton
                          color="success"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('🔘 Button physically clicked!');
                            handleTemplateSelected();
                          }}
                          style={{ flex: 2, cursor: 'pointer' }}
                          disabled={!selectedTemplate || isNavigating}
                        >
                          <IonIcon icon={checkmarkCircle} slot="start" />
                          {isNavigating ? 'Loading Preview...' : 'Preview & Export PDF'}
                        </IonButton>
                      </div>
                    </IonCardContent>
                  </IonCard>
                </>
              )}

              {/* Debug fallback */}
              {currentStep && !['company', 'client', 'preview', 'template'].includes(currentStep) && (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <p>Unknown step: {currentStep}</p>
                  <IonButton onClick={() => setCurrentStep('company')}>
                    Start Over
                  </IonButton>
                </div>
              )}
            </IonCol>
          </IonRow>
        </IonGrid>
      </div>
    </Layout>
  );
};

export default QuotePage;

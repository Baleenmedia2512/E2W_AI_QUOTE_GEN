import React, { useState, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';
import { TemplateSelector } from '../components/TemplateSelector/TemplateSelector';
import { CorporateMinimal } from '../components/Templates/CorporateMinimal';
import { PremiumAgency } from '../components/Templates/PremiumAgency';
import { ModernSales } from '../components/Templates/ModernSales';
import { ClassicBusiness } from '../components/Templates/ClassicBusiness';
import { exportToPDF } from '../services/pdfExportService';
import './QuotePreviewPage.css';

export const QuotePreviewPage: React.FC = () => {
  const history = useHistory();
  const {
    currentQuote,
    companyInfo,
    clientInfo,
    selectedTemplate,
    setSelectedTemplate
  } = useAppStore();

  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [zoom, setZoom] = useState(100);
  const previewRef = useRef<HTMLDivElement>(null);

  // Debug logging
  console.log('📄 QuotePreviewPage rendered');
  console.log('Current Quote:', currentQuote);
  console.log('Company Info:', companyInfo);
  console.log('Client Info:', clientInfo);
  console.log('Selected Template:', selectedTemplate);

  // Check if all required data is available
  if (!currentQuote || !companyInfo || !clientInfo) {
    console.log('❌ Missing required data for preview');
    return (
      <div className="preview-error">
        <div className="error-content">
          <h2>Missing Information</h2>
          <p>Please complete all required steps before previewing your quote.</p>
          <p style={{ fontSize: '14px', marginTop: '16px', color: '#666' }}>
            {!currentQuote && '• Quote data is missing'}<br />
            {!companyInfo && '• Company information is missing'}<br />
            {!clientInfo && '• Client information is missing'}
          </p>
          <button onClick={() => history.push('/quote')} className="back-button">
            Go Back to Quote Page
          </button>
        </div>
      </div>
    );
  }

  const templateData = {
    company: companyInfo,
    client: clientInfo,
    quote: currentQuote
  };

  const renderTemplate = () => {
    switch (selectedTemplate) {
      case 'corporate-minimal':
        return <CorporateMinimal data={templateData} />;
      case 'premium-agency':
        return <PremiumAgency data={templateData} />;
      case 'modern-sales':
        return <ModernSales data={templateData} />;
      case 'classic-business':
        return <ClassicBusiness data={templateData} />;
      default:
        return <CorporateMinimal data={templateData} />;
    }
  };

  const handleExportPDF = async () => {
    if (!previewRef.current) return;

    setIsExporting(true);
    try {
      await exportToPDF(
        previewRef.current,
        currentQuote.quoteNumber,
        selectedTemplate
      );
      alert('PDF exported successfully!');
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 150));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const handleResetZoom = () => {
    setZoom(100);
  };

  return (
    <div className="quote-preview-page">
      {/* Toolbar */}
      <div className="preview-toolbar">
        <div className="toolbar-section">
          <button
            onClick={() => history.push('/quote')}
            className="toolbar-button back-btn"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <h1 className="toolbar-title">Quote Preview</h1>
        </div>

        <div className="toolbar-section">
          <div className="zoom-controls">
            <button onClick={handleZoomOut} className="zoom-button" disabled={zoom <= 50}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="8" strokeWidth="2"/>
                <path d="M21 21l-4.35-4.35M8 11h6" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <span className="zoom-level">{zoom}%</span>
            <button onClick={handleZoomIn} className="zoom-button" disabled={zoom >= 150}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="8" strokeWidth="2"/>
                <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={handleResetZoom} className="toolbar-button-small">
              Reset
            </button>
          </div>

          <button
            onClick={() => setShowTemplateSelector(!showTemplateSelector)}
            className="toolbar-button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="7" height="7" strokeWidth="2"/>
              <rect x="14" y="3" width="7" height="7" strokeWidth="2"/>
              <rect x="3" y="14" width="7" height="7" strokeWidth="2"/>
              <rect x="14" y="14" width="7" height="7" strokeWidth="2"/>
            </svg>
            Change Template
          </button>

          <button
            onClick={handleExportPDF}
            className="toolbar-button primary"
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="spinner"></div>
                Exporting...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Export PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Template Selector Modal */}
      {showTemplateSelector && (
        <div className="template-selector-modal">
          <div className="modal-overlay" onClick={() => setShowTemplateSelector(false)}></div>
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => setShowTemplateSelector(false)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <TemplateSelector
              selectedTemplate={selectedTemplate}
              onSelectTemplate={(template) => {
                console.log('🎨 Template selected:', template);
                setSelectedTemplate(template);
                setShowTemplateSelector(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Preview Area */}
      <div className="preview-container">
        <div className="preview-wrapper" style={{ transform: `scale(${zoom / 100})` }}>
          <div ref={previewRef} className="preview-content">
            {renderTemplate()}
          </div>
        </div>
      </div>

      {/* Mobile Actions */}
      <div className="mobile-actions">
        <button onClick={() => setShowTemplateSelector(true)} className="mobile-action-btn">
          Templates
        </button>
        <button onClick={handleExportPDF} className="mobile-action-btn primary" disabled={isExporting}>
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>
    </div>
  );
};

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';
import { TemplateSelector } from '../components/TemplateSelector/TemplateSelector';
import { CorporateMinimal } from '../components/Templates/CorporateMinimal';
import { PremiumAgency } from '../components/Templates/PremiumAgency';
import { ModernSales } from '../components/Templates/ModernSales';
import { ClassicBusiness } from '../components/Templates/ClassicBusiness';
import { exportToPDF } from '../services/pdfExportService';
import { ExtractedPage } from '../types';
import './QuotePreviewPage.css';

export const QuotePreviewPage: React.FC = () => {
  const history = useHistory();
  const {
    currentQuote,
    companyInfo,
    clientInfo,
    selectedTemplate,
    setSelectedTemplate,
    setCurrentQuote,
    proposal,
    activeProposals,
    restoreActiveProposals,
    loadRecentProposals,
  } = useAppStore();

  // Build flat merged pages — reactive to activeProposals (populated after async restore)
  const mergedActiveImages = useMemo<ExtractedPage[]>(() =>
    activeProposals.length > 0
      ? activeProposals.flatMap(p => p.pageImages || [])
      : [],
  [activeProposals]);

  // Build city→pages map for per-PDF isolation in ReferenceImages
  // Key = lowercased fileName (e.g. "coimbatore rate card.pdf") → pages from that PDF
  // useMemo ensures the map updates after restoreActiveProposals() finishes async
  const proposalPageMap = useMemo<Record<string, ExtractedPage[]>>(() => {
    const map: Record<string, ExtractedPage[]> = {};
    activeProposals.forEach(p => {
      map[p.fileName.toLowerCase()] = p.pageImages || [];
    });
    console.log(`🗺️ proposalPageMap rebuilt: ${Object.keys(map).length} PDFs`, Object.keys(map));
    return map;
  }, [activeProposals]);

  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pageImages, setPageImages] = useState<ExtractedPage[]>(
    mergedActiveImages.length > 0 ? mergedActiveImages : (proposal.pageImages || [])
  );
  const previewRef = useRef<HTMLDivElement>(null);

  // On mount: restore active proposals from IndexedDB/localStorage if memory is empty
  useEffect(() => {
    const init = async () => {
      if (activeProposals.length === 0) {
        console.log('🔄 QuotePreviewPage: restoring active proposals...');
        await loadRecentProposals(); // need metadata for restore
        await restoreActiveProposals();
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync pageImages state when activeProposals change (after restore)
  useEffect(() => {
    if (activeProposals.length > 0) {
      const merged = activeProposals.flatMap(p => p.pageImages || []);
      if (merged.length > 0) {
        setPageImages(merged);
        console.log(`✅ QuotePreviewPage: ${merged.length} pages from ${activeProposals.length} active PDFs`);
      }
    }
  }, [activeProposals]);

  // Add sample item if quote has no items
  React.useEffect(() => {
    console.log('📄 QuotePreviewPage mounted');
    console.log('Store state:', { 
      hasQuote: !!currentQuote, 
      hasCompany: !!companyInfo, 
      hasClient: !!clientInfo,
      template: selectedTemplate 
    });
    
    if (currentQuote && currentQuote.items.length === 0) {
      console.log('⚠️ Quote has no items, adding sample item');
      const sampleItem = {
        id: '1',
        description: 'Sample Service/Product',
        details: 'Add your items by going back to the quote editor',
        quantity: 1,
        rate: 1000,
        total: 1000
      };
      const updatedQuote = {
        ...currentQuote,
        items: [sampleItem],
        subtotal: 1000,
        gstAmount: currentQuote.gstEnabled ? 1000 * (currentQuote.gstPercentage / 100) : 0,
        total: 1000 + (currentQuote.gstEnabled ? 1000 * (currentQuote.gstPercentage / 100) : 0)
      };
      setCurrentQuote(updatedQuote);
    }
  }, [currentQuote?.items?.length]);

  // Debug logging
  console.log('Current Quote:', currentQuote);
  console.log('Company Info:', companyInfo);
  console.log('Client Info:', clientInfo);
  console.log('Selected Template:', selectedTemplate);
  console.log('Quote Items:', currentQuote?.items);
  console.log('Quote Items Length:', currentQuote?.items?.length);

  // Check if all required data is available
  if (!currentQuote || !companyInfo || !clientInfo) {
    console.error('❌ Missing required data for preview');
    console.error('Missing Quote:', !currentQuote);
    console.error('Missing Company:', !companyInfo);
    console.error('Missing Client:', !clientInfo);
    
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
    quote: currentQuote,
    proposalPages: pageImages,
    proposalPageMap,
  };
  
  console.log('🎨 Template Data:', {
    hasCompany: !!templateData.company,
    hasClient: !!templateData.client,
    hasQuote: !!templateData.quote,
    proposalPagesCount: templateData.proposalPages?.length || 0,
    quoteItemsCount: templateData.quote?.items?.length || 0,
  });

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
    console.log('📄 Export PDF clicked');
    console.log('Preview ref current:', previewRef.current);
    console.log('Current quote:', currentQuote);
    console.log('Selected template:', selectedTemplate);
    
    if (!previewRef.current) {
      console.error('❌ Preview ref is not available');
      alert('Preview content not loaded. Please refresh and try again.');
      return;
    }

    if (!currentQuote) {
      console.error('❌ No quote available for export');
      alert('No quote data available. Please go back and create a quote.');
      return;
    }

    setIsExporting(true);
    console.log('🔄 Starting PDF export...');
    
    try {
      await exportToPDF(
        previewRef.current,
        currentQuote.quoteNumber,
        selectedTemplate,
        clientInfo?.name
      );
      console.log('✅ PDF exported successfully');
      // Success message is shown by the service itself (different for mobile vs web)
    } catch (error) {
      console.error('❌ PDF export error:', error);
      alert(`Failed to export PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      console.log('🏁 PDF export process finished');
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
                console.log('🎨 Template selected in preview:', template);
                setSelectedTemplate(template);
                // Ensure localStorage is updated
                localStorage.setItem('selectedTemplate', template);
                console.log('✅ Template saved and modal closing');
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

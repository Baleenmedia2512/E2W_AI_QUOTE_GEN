import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';
import { CorporateMinimal } from '../components/Templates/CorporateMinimal';
import { exportToPDF } from '../services/pdfExportService';
import { ExtractedPage } from '../types';
import './QuotePreviewPage.css';

// ═══════════════════════════════════════════════════════════════════════
// 🔀 DATA SOURCE TOGGLE — matches ChatInterface.tsx
// false = OLD: IndexedDB local images only
// true  = NEW: Supabase cloud image URLs (any device)
// ═══════════════════════════════════════════════════════════════════════
const USE_CLOUD_DATA = true;

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
    cloudServicePages,      // NEW: Cloud service pages from proposal_chunks
    loadCloudServices,      // NEW: Load cloud services function
  } = useAppStore();

  // Build flat merged pages — reactive to activeProposals (populated after async restore)
  const mergedActiveImages = useMemo<ExtractedPage[]>(() => {
    console.log('🔍 DEBUG [mergedActiveImages]: Building merged images from activeProposals');
    console.log('   activeProposals count:', activeProposals.length);
    activeProposals.forEach((p, idx) => {
      console.log(`   Proposal ${idx + 1}: "${p.fileName}" - ${p.pageImages?.length || 0} pages`);
    });
    const merged = activeProposals.length > 0
      ? activeProposals.flatMap(p => p.pageImages || [])
      : [];
    console.log('   ✅ Total merged images:', merged.length);
    return merged;
  }, [activeProposals]);

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

  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false); // Set to false to avoid blocking
  const [isContentReady, setIsContentReady] = useState(true); // Set to true for immediate display
  const [zoom, setZoom] = useState(100);
  const previewRef = useRef<HTMLDivElement>(null);
  
  // Merge cloud pages and local pages
  // USE_CLOUD_DATA=true  → cloud first (Supabase URLs, any device)
  // USE_CLOUD_DATA=false → local first (IndexedDB base64, upload device only)
  const mergedAllImages = useMemo<ExtractedPage[]>(() => {
    const cloud = cloudServicePages || [];
    const local = mergedActiveImages || [];
    
    console.log('🔀 DEBUG [mergedAllImages]: USE_CLOUD_DATA =', USE_CLOUD_DATA);
    console.log('   Cloud pages:', cloud.length);
    console.log('   Local pages:', local.length);
    
    if (USE_CLOUD_DATA) {
      // Cloud first — local as fallback when cloud has no data
      const result = cloud.length > 0 ? cloud : local;
      console.log(`   ✅ Using ${USE_CLOUD_DATA ? 'CLOUD' : 'LOCAL'} → ${result.length} pages`);
      return result;
    } else {
      // Local first — cloud appended as supplement
      const result = [...local, ...cloud];
      console.log(`   ✅ Using LOCAL first → ${result.length} pages`);
      return result;
    }
  }, [cloudServicePages, mergedActiveImages]);
  
  const [pageImages, setPageImages] = useState<ExtractedPage[]>(mergedAllImages);

  // Early validation and redirect - prevent errors from missing data
  useEffect(() => {
    if (!currentQuote || !companyInfo || !clientInfo) {
      console.warn('⚠️ Missing required data for preview, redirecting to quote page...');
      console.warn('Missing Quote:', !currentQuote);
      console.warn('Missing Company:', !companyInfo);
      console.warn('Missing Client:', !clientInfo);
      
      // Redirect to quote page to complete missing steps
      history.push('/quote');
    }
  }, [currentQuote, companyInfo, clientInfo, history]);

  // On mount: Load data in background (non-blocking)
  useEffect(() => {
    const init = async () => {
      console.log('🚀 DEBUG [QuotePreviewPage MOUNT]: Loading data in background...');
      console.log('   Current cloudServicePages:', cloudServicePages?.length || 0);
      console.log('   Current activeProposals:', activeProposals.length);
      
      // Load cloud services in background (non-blocking)
      if (!cloudServicePages || cloudServicePages.length === 0) {
        console.log('   [Background] Loading cloud services...');
        loadCloudServices().catch(error => {
          console.error('   ❌ Cloud loading failed:', error);
        });
      }
      
      // Load local proposals in background (non-blocking)
      if (activeProposals.length === 0) {
        console.log('   [Background] Loading local proposals...');
        loadRecentProposals()
          .then(() => restoreActiveProposals())
          .catch(error => {
            console.error('   ❌ Local loading failed:', error);
          });
      }
      
      console.log('   ✅ Quote displayed, proposals loading in background');
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Set content ready immediately for fast initial render
  // Reference images will load progressively in background
  useEffect(() => {
    //nsole.log('   cloudServicePages:', cloudServicePages?.length || 0);
    console.log('   activeProposals:', activeProposals.length);
    
    const allImages = mergedAllImages;
    console.log('   Total merged images:', allImages.length);
    
    if (allImages.length > 0) {
      setPageImages(allImages);
      console.log(`✅ Updated pageImages: ${allImages.length} total pages`);
      
      // DEBUG: Show sample pages from both sources
      if (cloudServicePages && cloudServicePages.length > 0) {
        console.log('   📊 Cloud sample pages:');
        cloudServicePages.slice(0, 2).forEach((page, idx) => {
          console.log(`      ${idx + 1}. Page ${page.pageNumber} - ${page.imageDataUrl ? 'Has image' : 'No image'}`);
        });
      }
      if (mergedActiveImages.length > 0) {
        console.log('   📊 Local sample pages:');
        mergedActiveImages.slice(0, 2).forEach((page, idx) => {
          console.log(`      ${idx + 1}. Page ${page.pageNumber} - ${page.imageDataUrl?.substring(0, 50)}...`);
        });
      }
    } else {
      console.log('⚠️ DEBUG: No images available from either source!');
    }
  }, [cloudServicePages, activeProposals, mergedAllImages]);

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
  
  console.log('🎨 DEBUG [Template Data Assembly]: Final data passed to template');
  console.log('   hasCompany:', !!templateData.company);
  console.log('   hasClient:', !!templateData.client);
  console.log('   hasQuote:', !!templateData.quote);
  console.log('   📄 proposalPages count:', templateData.proposalPages?.length || 0);
  console.log('   🗺️ proposalPageMap keys:', Object.keys(templateData.proposalPageMap || {}));
  console.log('   📋 quote.items count:', templateData.quote?.items?.length || 0);
  
  if (templateData.proposalPages && templateData.proposalPages.length > 0) {
    console.log('   ✅ proposalPages DATA AVAILABLE:');
    templateData.proposalPages.slice(0, 3).forEach((page, idx) => {
      console.log(`      ${idx + 1}. Page Number: ${page.pageNumber}, Source: ${page.sourceName || 'Unknown'}`);
    });
  } else {
    console.log('   ❌ proposalPages is EMPTY - No images will be shown in preview!');
  }

  const renderTemplate = () => {
    return <CorporateMinimal data={templateData} />;
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
            onClick={handleExportPDF}
            className="toolbar-button primary"
            disabled={isExporting || !isContentReady}
            title={!isContentReady ? 'Loading content, please wait...' : undefined}
          >
            {!isContentReady ? (
              <>
                <div className="spinner"></div>
                Loading...
              </>
            ) : isExporting ? (
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

      {/* Preview Area */}
      <div className="preview-container">
        {(!isContentReady) && (
          <div className="preview-loading-overlay">
            <div className="hourglass-container">
              <svg className="hourglass-svg" width="72" height="72" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 2H19" stroke="#C91F3D" strokeWidth="2" strokeLinecap="round"/>
                <path d="M5 22H19" stroke="#C91F3D" strokeWidth="2" strokeLinecap="round"/>
                <path d="M7 2L17 2L12 10.5L7 2Z" fill="#C91F3D" fillOpacity="0.25"/>
                <path d="M7 22L17 22L12 13.5L7 22Z" fill="#C91F3D"/>
                <line x1="12" y1="10.5" x2="12" y2="13.5" stroke="#C91F3D" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p className="overlay-title">Loading your quote...</p>
            </div>
          </div>
        )}
        <div className="preview-wrapper" style={{ transform: `scale(${zoom / 100})` }}>
          <div ref={previewRef} className="preview-content">
            {renderTemplate()}
          </div>
        </div>
      </div>

      {/* Mobile Actions */}
      {isContentReady && (
        <div className="mobile-actions">
          <button onClick={handleExportPDF} className="mobile-action-btn primary" disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      )}
    </div>
  );
};

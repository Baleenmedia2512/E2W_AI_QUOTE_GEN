import React, { useState, useRef, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../store';
import { TemplateSelector } from '../components/TemplateSelector/TemplateSelector';
import { CorporateMinimal } from '../components/Templates/CorporateMinimal';
import { PremiumAgency } from '../components/Templates/PremiumAgency';
import { ModernSales } from '../components/Templates/ModernSales';
import { ClassicBusiness } from '../components/Templates/ClassicBusiness';
import { exportToPDF } from '../services/pdfExportService';
import { loadPageImages, savePageImages, clearPageImages } from '../utils/imageStorage';
import { ExtractedPage } from '../types';
import { loadAllProposalsFromCloud, downloadProposalFile } from '../services/supabaseProposalService';
import { extractPDFContent } from '../utils/pdfUtils';
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
    proposal
  } = useAppStore();

  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pageImages, setPageImages] = useState<ExtractedPage[]>(proposal.pageImages || []);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Load page images from IndexedDB if not already in memory
  useEffect(() => {
    const checkAndLoadImages = async () => {
      console.log('📄 QuotePreviewPage: Checking for page images...');
      console.log('📄 Current pageImages state:', pageImages.length);
      console.log('📄 Proposal pageImages from store:', proposal.pageImages?.length || 0);
      console.log('📄 Current quote available:', !!currentQuote, 'items:', currentQuote?.items?.length || 0);
      
      if (pageImages.length === 0) {
        try {
          const images = await loadPageImages();
          console.log('📄 Loaded from IndexedDB:', images.length, 'images');
          
          if (images.length > 0) {
            // Validate if cached images match current quote
            let isRelevant = false;
            if (currentQuote && currentQuote.items && currentQuote.items.length > 0 && images.length > 0) {
              const quoteKeywords = currentQuote.items
                .map(item => item.description.toLowerCase())
                .join(' ')
                .split(/[\s,\-\/&]+/)
                .filter(w => w.length >= 3 && !['the', 'and', 'per', 'rental', 'price', 'display', 'printing', 'fixing', 'month'].includes(w))
                .slice(0, 5); // Top 5 keywords
              
              console.log('🔑 Validating cache with quote keywords:', quoteKeywords);
              
              const pagesText = images.map(p => p.text.toLowerCase()).join(' ');
              const matchedKeywords = quoteKeywords.filter(kw => pagesText.includes(kw));
              const matchCount = matchedKeywords.length;
              const matchRate = matchCount / Math.max(quoteKeywords.length, 1);
              
              isRelevant = matchRate >= 0.3; // At least 30% match
              console.log(`🔍 Cache validation: ${(matchRate * 100).toFixed(0)}% relevant (${matchCount}/${quoteKeywords.length} keywords matched: ${matchedKeywords.join(', ') || 'none'})`);
              
              if (!isRelevant) {
                console.log('⚠️ Cached images NOT relevant to current quote - will trigger cloud reload');
              } else {
                console.log('✅ Cached images ARE relevant to current quote');
              }
            } else {
              isRelevant = true; // No quote to validate against, accept cache
              console.log('ℹ️ No quote items for validation, accepting cached images');
            }
            
            if (isRelevant) {
              setPageImages(images);
              console.log('✅ Page images loaded and set from cache');
            } else {
              console.log('🔄 Cache invalid - clearing and triggering cloud reload');
              // Clear invalid cache
              await clearPageImages();
              console.log('🗑️ Invalid cache cleared, auto-load will trigger fresh download');
              // Don't set images, let auto-load handle it
            }
          } else {
            console.log('⚠️ No images found in IndexedDB');
          }
        } catch (err) {
          console.error('❌ Failed to load page images:', err);
        }
      } else {
        console.log('✅ Page images already in state:', pageImages.length);
      }
    };
    
    checkAndLoadImages();
  }, []); // Only run once on mount

  // Auto-load images from cloud if not available locally (NEW FEATURE)
  useEffect(() => {
    const autoLoadImagesFromCloud = async () => {
      // Reference image auto-load disabled
      return;
      console.log('🔍 Auto-load check:', { 
        pageImagesLength: pageImages.length, 
        autoLoadAttempted, 
        isLoadingImages,
        hasQuote: !!currentQuote 
      });
      
      // Only attempt auto-load if:
      // 1. No images currently loaded
      // 2. Haven't already tried to auto-load (prevent infinite loops)
      // 3. Not currently loading
      if (pageImages.length === 0 && !autoLoadAttempted && !isLoadingImages) {
        setAutoLoadAttempted(true); // Mark as attempted
        setIsLoadingImages(true);
        console.log('🔄 Auto-loading images from cloud...');

        try {
          // SMART MATCHING: Find document that matches quote items
          let targetDoc = null;
          
          if (currentQuote && currentQuote.items && currentQuote.items.length > 0) {
            // Extract keywords from quote items
            const quoteKeywords = currentQuote.items
              .map(item => item.description.toLowerCase())
              .join(' ')
              .replace(/[()]/g, ' ')
              .split(/[\s,\-\/&]+/)
              .filter(w => 
                w.length >= 3 && 
                !['the', 'and', 'per', 'for', 'from', 'with', 'price', 'rental', 'display', 'printing', 'fixing', 'month'].includes(w)
              );
            
            console.log('🔑 Quote keywords:', quoteKeywords.slice(0, 10).join(', '));
            
            // Get ALL cloud documents (limit 50 for performance)
            const cloudDocs = await loadAllProposalsFromCloud(50);
            
            if (cloudDocs && cloudDocs.length > 0) {
              console.log('📚 Searching through', cloudDocs.length, 'cloud documents...');
              
              // Score each document based on keyword matches
              const scoredDocs = cloudDocs.map(doc => {
                const docText = doc.text_content.toLowerCase();
                const matchCount = quoteKeywords.filter(keyword => 
                  docText.includes(keyword)
                ).length;
                const score = matchCount / quoteKeywords.length; // Percentage of keywords found
                
                return { doc, score, matchCount };
              });
              
              // Sort by score (highest first)
              scoredDocs.sort((a, b) => b.score - a.score);
              
              // Log top 3 matches
              console.log('📊 Top document matches:');
              scoredDocs.slice(0, 3).forEach((item, idx) => {
                console.log(`  ${idx + 1}. ${item.doc.file_name} - Score: ${(item.score * 100).toFixed(0)}% (${item.matchCount}/${quoteKeywords.length} keywords)`);
              });
              
              // Use document with highest score if it's above threshold (20%)
              if (scoredDocs[0].score >= 0.2) {
                targetDoc = scoredDocs[0].doc;
                console.log('✅ Best match:', targetDoc.file_name, `(${(scoredDocs[0].score * 100).toFixed(0)}% match)`);
              } else {
                // Fallback to most recent if no good match
                targetDoc = cloudDocs[0];
                console.log(`⚠️ No strong match found (best: ${(scoredDocs[0].score * 100).toFixed(0)}%), using most recent:`, targetDoc.file_name);
              }
            }
          } else {
            // No quote items, just use most recent
            const cloudDocs = await loadAllProposalsFromCloud(1);
            if (cloudDocs && cloudDocs.length > 0) {
              targetDoc = cloudDocs[0];
              console.log('ℹ️ No quote items for matching, using most recent:', targetDoc.file_name);
            }
          }
          
          // Download and process the selected document
          if (targetDoc) {
            console.log('📥 Downloading:', targetDoc.file_name);
            
            // Download the PDF file from cloud storage
            const blob = await downloadProposalFile(targetDoc.storage_path);
            
            if (blob) {
              // Convert blob to File object for extraction
              const file = new File([blob], targetDoc.file_name, { 
                type: targetDoc.file_type || 'application/pdf' 
              });
              
              console.log('⚙️ Processing PDF:', targetDoc.page_count, 'pages');
              
              // Extract page images from PDF
              const extractedData = await extractPDFContent(file);
              
              if (extractedData.pageImages && extractedData.pageImages.length > 0) {
                console.log('✅ Extracted', extractedData.pageImages.length, 'page images');
                
                // Cache in IndexedDB for future use
                await savePageImages(extractedData.pageImages);
                console.log('💾 Cached in IndexedDB');
                
                // Update state to display images
                setPageImages(extractedData.pageImages);
                console.log('✅ Reference images ready from:', targetDoc.file_name);
              } else {
                console.log('⚠️ No page images extracted from PDF');
              }
            } else {
              console.log('⚠️ Failed to download PDF from cloud');
            }
          } else {
            console.log('ℹ️ No cloud documents available for auto-load');
          }
        } catch (error) {
          console.error('❌ Auto-load images failed:', error);
          // Fail silently - don't break the preview
        } finally {
          setIsLoadingImages(false);
        }
      }
    };

    // Small delay to let IndexedDB check complete first
    const timer = setTimeout(() => {
      autoLoadImagesFromCloud();
    }, 500);

    return () => clearTimeout(timer);
  }, [pageImages.length, autoLoadAttempted, isLoadingImages]);

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
        selectedTemplate
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
        {/* Reference Image Loading Overlay */}
        {isLoadingImages && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              border: '4px solid rgba(255, 255, 255, 0.2)',
              borderTop: '4px solid #fff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
            <div style={{
              color: '#fff',
              fontSize: '18px',
              fontWeight: '600',
              textAlign: 'center',
              maxWidth: '400px',
              lineHeight: '1.5'
            }}>
              <div style={{ marginBottom: '8px' }}>
                Please wait...
              </div>
              <div style={{ fontSize: '16px', fontWeight: '400', opacity: 0.9 }}>
                The reference image is processing
              </div>
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

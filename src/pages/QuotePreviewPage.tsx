import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useToast } from '@chakra-ui/react';
import { useAppStore } from '../store';
import { useAuthStore } from '../store/authStore';
import { CorporateMinimal } from '../components/Templates/CorporateMinimal';
import { exportToPDF } from '../services/pdfExportService';
import { sendQuoteEmail } from '../services/quoteEmailService';
import { ExtractedPage, ServiceReadyData } from '../types';
import {
  extractCityHint,
  extractServiceNameFromItem,
  resolveServiceIdFromCatalog,
} from '../utils/serviceResolver';
import { ServicePdfData, PdfExportMode } from '../components/Templates/CorporateMinimalPDF';
import { isMultiServiceQuote } from '../utils/quoteGrouping';
import {
  buildPreviewTocItems,
  scrollToPreviewSection,
} from '../utils/previewNavigation';
import QuoteFlowNav from '../components/QuoteWizard/QuoteFlowNav';
import { EMPTY_CLIENT } from '../components/ClientInfoForm/ClientEditDrawer';
import { ClientInfo } from '../types/client';
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
    setClientInfo,
    proposal,
    activeProposals,
    restoreActiveProposals,
    loadRecentProposals,
    cloudServicePages,      // NEW: Cloud service pages from proposal_chunks
    loadCloudServices,      // NEW: Load cloud services function
    openChatProfile,
  } = useAppStore();

  const toast = useToast();
  const { user } = useAuthStore();

  /** Allow preview without saved client — edit via inline Name / Phone / Email */
  const effectiveClient: ClientInfo = clientInfo || EMPTY_CLIENT;
  const clientReady = !!(
    effectiveClient.name.trim()
    && /^\d{10}$/.test(effectiveClient.phone.trim())
  );

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
  const [showClientValidation, setShowClientValidation] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false); // Set to false to avoid blocking
  const [isContentReady, setIsContentReady] = useState(true); // Set to true for immediate display
  const [zoom, setZoom] = useState(100);
  const [showToc, setShowToc] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth > 900 : true),
  );
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const pdfDataRef = useRef<ServicePdfData[]>([]);
  const tocClickLockRef = useRef(false);

  // Collect resolved image/spec/review data from each ReferenceImages instance
  const handleServiceDataReady = useCallback((serviceKey: string, data: ServiceReadyData) => {
    const existing = pdfDataRef.current.findIndex((d) => d.serviceKey === serviceKey);
    const entry: ServicePdfData = { serviceKey, ...data };
    if (existing >= 0) {
      pdfDataRef.current[existing] = entry;
    } else {
      pdfDataRef.current = [...pdfDataRef.current, entry];
    }
    // Write to DOM store so pdfExportService can read without React state
    const store = document.getElementById('pdf-data-store');
    if (store) {
      store.setAttribute('data-pdf-store', JSON.stringify(pdfDataRef.current));
    }

    console.groupCollapsed(`🧩 [PDF-BRIDGE] serviceKey="${serviceKey}"`);
    console.log(`refImages=${data.refImages?.length || 0}`);
    console.log(`specImages=${data.specImages?.length || 0}`);
    console.log(`specGroups=${data.specGroups?.length || 0}`);
    console.log(`specFields=${data.specFields?.length || 0}`);
    console.log(`review=${data.review ? 'yes' : 'no'}`);
    if (data.refImages?.length) {
      console.log('ref[0]=', data.refImages[0]?.startsWith('data:') ? `data-url len=${data.refImages[0].length}` : data.refImages[0]);
    }
    if (data.specImages?.length) {
      console.log('spec[0]=', data.specImages[0]?.startsWith('data:') ? `data-url len=${data.specImages[0].length}` : data.specImages[0]);
    }
    console.groupEnd();
  }, []);
  
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

  // Early validation — quote + company required; client is editable on this page
  useEffect(() => {
    if (!currentQuote || !companyInfo) {
      console.warn('⚠️ Missing required data for preview...');
      if (!companyInfo) {
        openChatProfile();
        history.push('/');
      } else if (!currentQuote) {
        history.push('/');
      }
    }
  }, [currentQuote, companyInfo, history, openChatProfile]);

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

  // Stamp serviceId from the FULL vendor catalog (includes rates with no images).
  // Never resolve against cloudServicePages alone — that pool only contains services
  // that already have image/spec pages, so Auto Semi / ROTN without images got a
  // sibling serviceId and showed unrelated photos.
  useEffect(() => {
    if (!currentQuote?.items?.length) return;
    const needsEnrich = currentQuote.items.some((i) => !i.serviceId);
    if (!needsEnrich) return;

    let cancelled = false;
    (async () => {
      const {
        getVendorRatesCache,
        loadVendorRatesFromCloud,
        vendorRatesToDbServices,
      } = await import('../services/vendorRateService');
      let rates = getVendorRatesCache();
      if (!rates.length) {
        try {
          rates = await loadVendorRatesFromCloud();
        } catch (err) {
          console.warn('🔗 [QuotePreview] Vendor catalog load failed for serviceId enrich:', err);
          return;
        }
      }
      if (cancelled) return;

      const catalog = vendorRatesToDbServices(rates);
      if (!catalog.length) return;

      const { currentQuote: latest, setCurrentQuote: setQuote } = useAppStore.getState();
      if (!latest?.items?.length) return;

      const enrichedItems = latest.items.map((item) => {
        if (item.serviceId) return item;
        const name =
          extractServiceNameFromItem(item) ||
          item.serviceName ||
          item.title ||
          item.description;
        const cityHint =
          (item.city || '').trim().toLowerCase() ||
          extractCityHint(
            [item.city, item.description, item.serviceName, item.title]
              .filter(Boolean)
              .join(' '),
          );
        const resolved = resolveServiceIdFromCatalog(name, catalog, cityHint);
        if (!resolved) return item;
        return {
          ...item,
          serviceId: resolved.serviceId,
          serviceName: resolved.serviceName || item.serviceName,
        };
      });

      if (
        enrichedItems.some(
          (item, i) => item.serviceId !== latest.items[i].serviceId,
        )
      ) {
        console.log(
          '🔗 [QuotePreview] Enriched quote items with serviceId from vendor catalog',
        );
        setQuote({ ...latest, items: enrichedItems });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentQuote, setCurrentQuote]);

  // Fill missing quantityUnit via isolated AI — preview page only (no RAG)
  const qtyUnitAiQuoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentQuote?.items?.length) return;

    const quoteId = currentQuote.id;
    const needsAi = currentQuote.items.some((i) => {
      const u = (i.quantityUnit || '').trim();
      return !u || u.toUpperCase() === 'NA';
    });

    console.warn('🏷️ [QtyUnit-AI-EXACT] preview effect', {
      quoteId,
      needsAi,
      alreadyDone: qtyUnitAiQuoteIdRef.current === quoteId,
      itemCount: currentQuote.items.length,
    });

    if (!needsAi) {
      qtyUnitAiQuoteIdRef.current = quoteId;
      return;
    }
    if (qtyUnitAiQuoteIdRef.current === quoteId) return;

    const itemsSnapshot = currentQuote.items;
    (async () => {
      try {
        const { enrichMissingQtyUnitsWithAi } = await import('../services/qtyUnitAiService');
        const enriched = await enrichMissingQtyUnitsWithAi(itemsSnapshot);
        const unitById = new Map(
          enriched
            .filter((i) => (i.quantityUnit || '').trim() && (i.quantityUnit || '').trim().toUpperCase() !== 'NA')
            .map((i) => [i.id, String(i.quantityUnit).trim()]),
        );

        // Always merge into latest store quote (do not discard on effect cleanup)
        const { currentQuote: latest, setCurrentQuote: setQuote } = useAppStore.getState();
        if (!latest || latest.id !== quoteId) {
          console.warn('🏷️ [QtyUnit-AI-EXACT] quote changed before apply', {
            expected: quoteId,
            latest: latest?.id,
          });
          return;
        }

        let filled = 0;
        const mergedItems = latest.items.map((item) => {
          const existing = (item.quantityUnit || '').trim();
          if (existing && existing.toUpperCase() !== 'NA') return item;
          const unit = unitById.get(item.id);
          if (!unit) return item;
          filled += 1;
          return { ...item, quantityUnit: unit };
        });

        console.warn('🏷️ [QtyUnit-AI-EXACT] apply merge', {
          filled,
          mapSize: unitById.size,
        });

        if (filled === 0) {
          console.warn('🏷️ [QtyUnit-AI-EXACT] filled=0 — check REST_RESPONSE / REST_TEXT');
          return;
        }

        qtyUnitAiQuoteIdRef.current = quoteId;
        setQuote({
          ...latest,
          items: mergedItems,
          updatedAt: new Date(),
        });
      } catch (err) {
        console.error('🏷️ [QtyUnit-AI-EXACT] preview apply failed:', err);
      }
    })();
  }, [currentQuote, setCurrentQuote]);

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

  const tocItems = useMemo(
    () => buildPreviewTocItems(currentQuote?.items || []),
    [currentQuote?.items],
  );

  const handleNavigateToSection = useCallback(
    (sectionId: string) => {
      tocClickLockRef.current = true;
      setActiveTocId(sectionId);
      scrollToPreviewSection(sectionId, {
        zoom,
        container: previewContainerRef.current,
      });
      if (typeof window !== 'undefined' && window.innerWidth <= 900) {
        setShowToc(false);
      }
      window.setTimeout(() => {
        tocClickLockRef.current = false;
      }, 700);
    },
    [zoom],
  );

  // Highlight TOC item based on which section is in view
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container || tocItems.length === 0) return;

    const elements = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (tocClickLockRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target as HTMLElement | undefined;
        if (top?.id) setActiveTocId(top.id);
      },
      {
        root: container,
        rootMargin: '-10% 0px -55% 0px',
        threshold: [0.05, 0.2, 0.4],
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocItems, isContentReady, zoom]);

  // Debug logging
  console.log('Current Quote:', currentQuote);
  console.log('Company Info:', companyInfo);
  console.log('Client Info:', clientInfo);
  console.log('Selected Template:', selectedTemplate);
  console.log('Quote Items:', currentQuote?.items);
  console.log('Quote Items Length:', currentQuote?.items?.length);

  // Check if quote + company are available (client edited on this page)
  if (!currentQuote || !companyInfo) {
    console.error('❌ Missing required data for preview');
    console.error('Missing Quote:', !currentQuote);
    console.error('Missing Company:', !companyInfo);
    
    return (
      <div className="preview-error">
        <div className="error-content">
          <h2>Missing Information</h2>
          <p>Please complete all required steps before previewing your quote.</p>
          <p style={{ fontSize: '14px', marginTop: '16px', color: '#666' }}>
            {!currentQuote && '• Quote data is missing'}
            <br />
            {!companyInfo && '• Company information is missing'}
          </p>
          <button
            onClick={() => {
              if (!companyInfo) {
                openChatProfile();
              }
              history.push('/');
            }}
            className="back-button"
          >
            Go to Chat
          </button>
        </div>
      </div>
    );
  }

  const templateData = {
    company: companyInfo,
    client: effectiveClient,
    quote: currentQuote,
    proposalPages: pageImages,
    proposalPageMap,
    onServiceDataReady: handleServiceDataReady,
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
    return (
      <CorporateMinimal
        data={templateData}
        editable
        showClientValidation={showClientValidation}
        onDataChange={(next) => {
          setCurrentQuote(next.quote);
        }}
        onClientChange={(info) => {
          setClientInfo(info);
          if (info.name.trim() && /^\d{10}$/.test(info.phone.trim())) {
            setShowClientValidation(false);
          }
        }}
        onNavigateToSection={handleNavigateToSection}
      />
    );
  };

  const handleExportPDF = async (
    mode: PdfExportMode = 'full',
    shouldDownload = true,
  ): Promise<{ pdfBlob: Blob; filename: string } | undefined> => {
    console.log(`📄 Export PDF clicked (mode: ${mode})`);

    if (!clientReady) {
      setShowClientValidation(true);
      if (!toast.isActive('client-details-required')) {
        toast({
          id: 'client-details-required',
          title: 'Missing details',
          description: 'Please enter the client name and 10-digit phone number.',
          status: 'warning',
          duration: 3500,
          isClosable: true,
        });
      }
      return;
    }

    if (!previewRef.current) {
      alert('Preview content not loaded. Please refresh and try again.');
      return;
    }

    if (!currentQuote) {
      alert('No quote data available. Please go back and create a quote.');
      return;
    }

    setIsExporting(true);

    try {
      const docIds = activeProposals
        .map((p) => p.id)
        .filter(Boolean) as string[];

      const { pdfBlob, filename } = await exportToPDF(
        previewRef.current,
        currentQuote.quoteNumber,
        selectedTemplate,
        effectiveClient.name,
        docIds.length > 0 ? docIds : undefined,
        mode,
        shouldDownload,
      );
      console.log('✅ PDF exported successfully');
      return { pdfBlob, filename };
    } catch (error) {
      console.error('❌ PDF export error:', error);
      alert(`Failed to export PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
    return undefined;
  };

  const handleDownloadPDF = async () => {
    if (isExporting || isSendingEmail) return;
    const hasExecutiveSummary = !!currentQuote && isMultiServiceQuote(currentQuote.items);
    const pdfAttachments: { pdfBlob: Blob; filename: string }[] = [];
    setIsSendingEmail(true);

    try {
      if (!hasExecutiveSummary) {
        const result = await handleExportPDF('full', true);
        if (result) pdfAttachments.push(result);
      } else {
        const summaryResult = await handleExportPDF('summary', true);
        const detailedResult = await handleExportPDF('detailed', true);
        if (summaryResult) pdfAttachments.push(summaryResult);
        if (detailedResult) pdfAttachments.push(detailedResult);
      }

      if (!pdfAttachments.length || !currentQuote) {
        throw new Error('Could not generate PDF. Please try again.');
      }

      if (user?.canSendQuoteEmail !== true) {
        toast({
          title: 'PDF Downloaded',
          description: 'Email sending is not enabled for this account.',
          status: 'success',
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      const emailSendResult = await sendQuoteEmail({
        pdfAttachments,
        quote: currentQuote,
        client: effectiveClient,
        company: companyInfo,
        downloadedBy: user?.full_name || 'Unknown User',
      });

      toast({
        title: emailSendResult.success ? 'PDF Downloaded & Emailed' : 'Email Not Sent',
        description: emailSendResult.success
          ? 'The PDF was downloaded and sent to your logged-in email with the configured CC.'
          : emailSendResult.message,
        status: emailSendResult.success ? 'success' : 'error',
        duration: 7000,
        isClosable: true,
      });
    } catch (error) {
      console.error('❌ PDF download or email error:', error);
      toast({
        title: 'Download or Email Failed',
        description: error instanceof Error ? error.message : 'Could not complete the operation.',
        status: 'error',
        duration: 7000,
        isClosable: true,
      });
    } finally {
      setIsSendingEmail(false);
      }
  };

  const [isSendingEmail, setIsSendingEmail] = useState(false);
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
      <QuoteFlowNav
        step="preview"
        onDownloadPdf={handleDownloadPDF}
        isDownloading={isExporting}
        isSendingMail={isSendingEmail}
        // Keep the button visible and let handleExportPDF show the validation
        // popup when required client details are missing.
        canDownload={isContentReady && !isExporting}
      />

      {/* Secondary toolbar: TOC toggle + zoom */}
      <div className="preview-toolbar">
        <div className="toolbar-section">
          <button
            type="button"
            className={`toolbar-button toc-toggle-btn${showToc ? ' is-active' : ''}`}
            onClick={() => setShowToc((v) => !v)}
            aria-pressed={showToc}
            aria-label={showToc ? 'Hide TOC' : 'Open TOC'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 6h16M4 12h10M4 18h14" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {showToc ? 'Hide TOC' : 'Open TOC'}
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
        </div>
      </div>

      {/* Preview Area */}
      <div className={`preview-body${showToc ? ' preview-body--toc-open' : ''}`}>
        {showToc && (
          <>
            <button
              type="button"
              className="preview-toc-backdrop"
              aria-label="Hide TOC"
              onClick={() => setShowToc(false)}
            />
            <aside className="preview-toc" aria-label="TOC">
              <div className="preview-toc-header">
                <h2>TOC</h2>
                <button
                  type="button"
                  className="preview-toc-close"
                  onClick={() => setShowToc(false)}
                  aria-label="Hide TOC"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <nav className="preview-toc-list">
                {tocItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`preview-toc-item${activeTocId === item.id ? ' is-active' : ''}`}
                    onClick={() => handleNavigateToSection(item.id)}
                  >
                    <span className="preview-toc-label">{item.label}</span>
                  </button>
                ))}
              </nav>
            </aside>
          </>
        )}
        <div className="preview-container" ref={previewContainerRef}>
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
            <div
              id="pdf-data-store"
              data-template-store={JSON.stringify(templateData)}
              style={{ display: 'none' }}
            />
            <div ref={previewRef} className="preview-content">
              {renderTemplate()}
            </div>
          </div>
        </div>
      </div>

      {isContentReady && (
        <div className="mobile-actions">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="mobile-action-btn primary"
            disabled={isExporting || isSendingEmail}
          >
            {isExporting ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>
      )}
    </div>
  );
};

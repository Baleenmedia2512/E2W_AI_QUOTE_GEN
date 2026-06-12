import { create } from 'zustand';
import { AppState, ProposalData, Message, Quote, CompanyInfo, ClientInfo, TemplateType, StoredProposal, ActiveProposal } from '../types';
import { loadCompanyInfo, saveCompanyInfo as saveCompanyInfoToStorage } from '../utils/localStorage';
import {
  savePageImages as savePageImagesToDB,
  clearPageImages,
  savePageImagesById,
  loadPageImagesById,
  clearPageImagesById,
  saveActiveProposalIds,
  loadActiveProposalIds,
  saveActiveProposalMeta,
  loadActiveProposalMeta,
} from '../utils/imageStorage';
import { DEFAULT_COMPANY_INFO } from '../constants/defaultCompany';
import { companyService } from '../services/companyService';
import { useAuthStore } from './authStore';
import { extractPDFContent } from '../utils/pdfUtils';
import {
  loadRecentProposals as loadProposalsFromDB,
  loadProposalById,
  deleteProposalFromLibrary as deleteProposalFromDB,
  saveProposalToLibrary,
} from '../utils/proposalStorage';
import {
  checkCloudStorageAvailability,
  loadAllProposalsFromCloud,
  uploadProposalToCloud,
  deleteProposalFromCloud,
  downloadProposalFile,
  cloudProposalToStored,
} from '../services/supabaseProposalService';

const initialProposalState: ProposalData = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 1,
  extractedImages: [],
  pageImages: [],
  uploadedAt: null,
};

// Load template from localStorage
const loadSelectedTemplate = (): TemplateType => {
  try {
    const saved = localStorage.getItem('selectedTemplate');
    if (saved && ['corporate-minimal', 'premium-agency', 'modern-sales', 'classic-business'].includes(saved)) {
      return 'corporate-minimal' as TemplateType;
    }
  } catch (error) {
    console.error('Failed to load template from localStorage:', error);
  }
  return 'corporate-minimal';
};

// Load quote from localStorage
const loadCurrentQuote = (): Quote | null => {
  try {
    const saved = localStorage.getItem('currentQuote');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to load quote from localStorage:', error);
  }
  return null;
};

// Load client info from localStorage
const loadClientInfo = (): ClientInfo | null => {
  try {
    const saved = localStorage.getItem('clientInfo');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to load client info from localStorage:', error);
  }
  return null;
};

// Load company info with fallback to defaults
const loadCompanyInfoWithDefaults = (): CompanyInfo => {
  const saved = loadCompanyInfo();
  return saved || DEFAULT_COMPANY_INFO;
};

export const useAppStore = create<AppState>((set) => ({
  // Proposal state
  proposal: initialProposalState,
  setProposal: (proposal) =>
    set((state) => {
      // NOTE: savePageImagesToDB (legacy key 'pageImages') intentionally removed.
      // Images are now saved per-proposal via savePageImagesById() below, which
      // uses key 'pageImages_<id>' — avoids the sourceless duplicate in IndexedDB.

      // CLOUD-ONLY AUTO-SAVE: Save to cloud if available, fallback to local IndexedDB
      if (proposal.file && proposal.textContent && proposal.fileName) {
        const fullProposal = { ...state.proposal, ...proposal };
        // Ensure file is not null before saving
        if (fullProposal.file) {
          // Check if cloud storage is enabled
          if (state.cloudStorageEnabled) {
            // CLOUD-ONLY: Upload to Supabase only (skip IndexedDB)
            (async () => {
              try {
                // Get current user info from auth store
                const authState = useAuthStore.getState();
                const userId = authState.user?.id;
                const userName = authState.user?.full_name;
                
                const result = await uploadProposalToCloud(
                  fullProposal.file!,
                  fullProposal.textContent,
                  fullProposal.pageCount,
                  userId,
                  userName
                );
                
                if (result.success && result.proposal) {
                  console.log('☁️ Proposal uploaded to cloud successfully:', result.proposal.id);
                } else {
                  console.warn('⚠️ Cloud upload failed:', result.error);
                }
              } catch (cloudError) {
                console.warn('⚠️ Cloud upload failed:', cloudError);
              }
              
              // Reload recent proposals from cloud
              const currentState = useAppStore.getState();
              await currentState.loadRecentProposals();
            })();
          } else {
            // FALLBACK: Save to IndexedDB (local storage) when cloud not available
            saveProposalToLibrary({
              fileName: fullProposal.fileName,
              fileType: fullProposal.file.type || 'application/pdf',
              fileSize: fullProposal.file.size,
              fileBlob: fullProposal.file,
              textContent: fullProposal.textContent,
              pageCount: fullProposal.pageCount,
              extractedImages: fullProposal.extractedImages,
              pageImages: fullProposal.pageImages,
              uploadedAt: fullProposal.uploadedAt || new Date(),
            }).then(async (localId) => {
              console.log('💾 Auto-saved proposal to IndexedDB:', localId);
              
              // Reload recent proposals from local
              const currentState = useAppStore.getState();
              await currentState.loadRecentProposals();
            }).catch((err) => {
              console.warn('⚠️ Failed to auto-save proposal:', err);
            });
          }
        }
      }
      
      return { proposal: { ...state.proposal, ...proposal } };
    }),
  resetProposal: () => {
    clearPageImages();
    set({ proposal: initialProposalState });
  },

  // Chat state
  messages: [],
  addMessage: (message: Message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  clearMessages: () =>
    set({
      messages: [],
    }),

  // Quote state - Load from localStorage on init
  currentQuote: loadCurrentQuote(),
  setCurrentQuote: (quote: Quote | null) => {
    set({ currentQuote: quote });
    // Persist to localStorage
    if (quote) {
      try {
        localStorage.setItem('currentQuote', JSON.stringify(quote));
      } catch (error) {
        console.error('Failed to save quote to localStorage:', error);
      }
    }
  },
  updateQuote: (quote: Quote) => {
    set({ currentQuote: quote });
    // Persist to localStorage
    try {
      localStorage.setItem('currentQuote', JSON.stringify(quote));
    } catch (error) {
      console.error('Failed to save quote to localStorage:', error);
    }
  },

  // Company state - Load from localStorage on init, fallback to defaults
  companyInfo: loadCompanyInfoWithDefaults(),
  setCompanyInfo: (info: CompanyInfo) => {
    set({ companyInfo: info });
    // Persist to localStorage (always works, fallback)
    try {
      localStorage.setItem('companyInfo', JSON.stringify(info));
    } catch (error) {
      console.error('Failed to save company info to localStorage:', error);
    }
    // Also persist to database (syncs across devices)
    companyService.saveCompanySettings(info).catch(err => {
      console.warn('Database sync failed, localStorage still working:', err);
    });
  },

  // Sync company info from database (call on app init)
  syncCompanyFromDatabase: async () => {
    try {
      const dbCompany = await companyService.getCompanySettings();
      if (dbCompany) {
        console.log('✅ Loaded company info from database');
        set({ companyInfo: dbCompany });
        // Also update localStorage cache
        saveCompanyInfoToStorage(dbCompany);
      } else {
        console.log('ℹ️ No company info in database, using defaults/localStorage');
      }
    } catch (error) {
      console.warn('⚠️ Database sync failed, using localStorage:', error);
    }
  },

  // Enable real-time sync (optional, call after login)
  enableCompanySync: () => {
    const subscription = companyService.subscribeToChanges((updatedCompany) => {
      console.log('🔄 Real-time update: Company info changed');
      set({ companyInfo: updatedCompany });
      saveCompanyInfoToStorage(updatedCompany);
    });
    return subscription;
  },


  // Proposal Library state (NEW - purely additive, doesn't affect existing code)
  recentProposals: [],
  
  loadRecentProposals: async () => {
    try {
      console.log('🔍 DEBUG [loadRecentProposals]: Starting to load proposals');
      
      // Check if cloud storage is available first
      const state = useAppStore.getState();
      console.log('   Cloud storage enabled:', state.cloudStorageEnabled);
      
      let cloudProposals: StoredProposal[] = [];
      let useCloudOnly = false;
      
      if (state.cloudStorageEnabled) {
        try {
          console.log('   ☁️ Attempting to load from Supabase `proposals` table...');
          const rawCloudProposals = await loadAllProposalsFromCloud();
          cloudProposals = rawCloudProposals.map(cloudProposalToStored);
          console.log(`   ✅ Loaded ${cloudProposals.length} cloud proposals from Supabase`);
          
          if (cloudProposals.length > 0) {
            console.log('   📋 Cloud proposal filenames:');
            cloudProposals.forEach((p, idx) => {
              console.log(`      ${idx + 1}. "${p.fileName}" (${p.pageCount} pages, uploaded ${p.uploadedAt.toLocaleDateString()})`);
            });
          }
          
          useCloudOnly = true; // Successfully loaded from cloud, use cloud only
        } catch (error) {
          console.warn('   ⚠️ Failed to load cloud proposals, falling back to local:', error);
          useCloudOnly = false;
        }
      }
      
      let finalProposals: StoredProposal[];
      
      if (useCloudOnly) {
        // Use ONLY cloud proposals when cloud is available
        finalProposals = cloudProposals.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
        console.log(`   📚 Using ${finalProposals.length} cloud proposals only (local proposals ignored)`);
      } else {
        // Fall back to local proposals if cloud is unavailable
        console.log('   💾 Loading from local IndexedDB...');
        const localProposals = await loadProposalsFromDB();
        console.log(`   ✅ Loaded ${localProposals.length} local proposals from IndexedDB`);
        
        if (localProposals.length > 0) {
          console.log('   📋 Local proposal filenames:');
          localProposals.forEach((p, idx) => {
            console.log(`      ${idx + 1}. "${p.fileName}" (${p.pageCount} pages)`);
          });
        }
        
        finalProposals = localProposals.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
        console.log(`   📚 Using ${finalProposals.length} local proposals (cloud unavailable)`);
      }
      
      console.log('   ✅ Setting recentProposals in store');
      set({ recentProposals: finalProposals });
      
      console.log('🏁 DEBUG [loadRecentProposals]: Complete - stored', finalProposals.length, 'proposals');
    } catch (error) {
      console.error('❌ DEBUG [loadRecentProposals]: Failed to load recent proposals:', error);
      set({ recentProposals: [] });
    }
  },

  selectProposal: async (id: string) => {
    try {
      // HYBRID APPROACH: Try loading from IndexedDB first, then cloud if not found
      let storedProposal = await loadProposalById(id);
      let fileBlob: Blob | null = null;
      
      if (!storedProposal) {
        // Not in IndexedDB, try downloading from cloud
        console.log('💾 Proposal not found locally, checking cloud...');
        const state = useAppStore.getState();
        const cloudProposal = state.recentProposals.find(p => p.id === id && p.isCloudStored);
        
        if (cloudProposal && cloudProposal.storagePath) {
          try {
            fileBlob = await downloadProposalFile(cloudProposal.storagePath);
            storedProposal = cloudProposal;
            console.log('☁️ Downloaded proposal from cloud:', cloudProposal.fileName);
          } catch (error) {
            console.error('Failed to download cloud proposal:', error);
            return;
          }
        } else {
          console.error('Proposal not found in local or cloud storage:', id);
          return;
        }
      }
      
      // Get file blob (either from IndexedDB or downloaded from cloud)
      if (!fileBlob && !storedProposal.fileBlob) {
        console.error('No file blob available for proposal');
        return;
      }
      
      const blob = fileBlob || storedProposal.fileBlob!;
      
      // Convert Blob back to File
      const file = new File([blob], storedProposal.fileName, {
        type: storedProposal.fileType,
      });

      // If downloaded from cloud, extract PDF content to get page images
      let pageImages = storedProposal.pageImages;
      let extractedImages = storedProposal.extractedImages;
      
      if (fileBlob && storedProposal.fileType === 'application/pdf') {
        console.log('📄 Extracting images from cloud PDF...');
        try {
          const pdfResult = await extractPDFContent(file);
          pageImages = pdfResult.pageImages;
          extractedImages = pdfResult.images;
          console.log(`✅ Extracted ${pageImages?.length || 0} page images from PDF`);
        } catch (error) {
          console.warn('⚠️ Failed to extract PDF images:', error);
          // Continue with empty arrays if extraction fails
        }
      }

      // Create object URL for viewing
      const fileUrl = URL.createObjectURL(file);

      // Load the proposal into current state
      const proposalData = {
        file,
        fileName: storedProposal.fileName,
        fileUrl,
        textContent: storedProposal.textContent,
        pageCount: storedProposal.pageCount,
        currentPage: 1,
        extractedImages: extractedImages,
        pageImages: pageImages,
        uploadedAt: storedProposal.uploadedAt,
      };

      set({ proposal: proposalData });
      
      // Save page images for viewer
      if (pageImages && pageImages.length > 0) {
        savePageImagesToDB(pageImages);
        console.log(`💾 Saved ${pageImages.length} page images to IndexedDB`);
      }

      console.log('✅ Loaded proposal from library:', storedProposal.fileName);
    } catch (error) {
      console.error('Failed to select proposal:', error);
    }
  },

  deleteProposalFromLibrary: async (id: string) => {
    try {
      // HYBRID APPROACH: Delete from both local and cloud if applicable
      const state = useAppStore.getState();
      const proposal = state.recentProposals.find(p => p.id === id);
      
      // Delete from local IndexedDB (if exists locally)
      try {
        await deleteProposalFromDB(id);
        console.log('💾 Deleted from local IndexedDB:', id);
      } catch (error) {
        console.warn('⚠️ Not in local storage or already deleted:', error);
      }
      
      // Delete from cloud if it's a cloud-stored proposal
      if (proposal?.isCloudStored && proposal.storagePath && state.cloudStorageEnabled) {
        try {
          const success = await deleteProposalFromCloud(id);
          if (success) {
            console.log('☁️ Deleted from cloud storage:', id);
          }
        } catch (error) {
          console.error('Failed to delete from cloud:', error);
          // Continue even if cloud delete fails
        }
      }
      
      // Reload recent proposals after deletion (will merge local + cloud)
      await state.loadRecentProposals();
      console.log('✅ Deleted proposal and refreshed library');
    } catch (error) {
      console.error('Failed to delete proposal:', error);
    }
  },
  // Client state - Load from localStorage on init
  clientInfo: loadClientInfo(),
  setClientInfo: (info: ClientInfo) => {
    set({ clientInfo: info });
    // Persist to localStorage
    try {
      localStorage.setItem('clientInfo', JSON.stringify(info));
    } catch (error) {
      console.error('Failed to save client info to localStorage:', error);
    }
  },

  // Template state - Load from localStorage on init
  selectedTemplate: loadSelectedTemplate(),
  setSelectedTemplate: (template: TemplateType) => {
    console.log('🎨 Setting template in store:', template);
    set({ selectedTemplate: template });
    // Persist to localStorage
    try {
      localStorage.setItem('selectedTemplate', template);
      console.log('✅ Template saved to localStorage:', template);
    } catch (error) {
      console.error('Failed to save template to localStorage:', error);
    }
  },

  // Cloud Storage state (NEW - Hybrid approach: IndexedDB + Supabase)
  cloudStorageEnabled: false,

  checkCloudStorage: async () => {
    try {
      const isAvailable = await checkCloudStorageAvailability();
      set({ cloudStorageEnabled: isAvailable });
      console.log(isAvailable ? '☁️ Cloud storage enabled' : '💾 Using local storage only');
    } catch (error) {
      console.warn('⚠️ Cloud storage check failed, using local storage:', error);
      set({ cloudStorageEnabled: false });
    }
  },

  // ── Multi-location active proposals (additive – does not affect existing flow) ──
  activeProposals: [],

  addActiveProposal: async (id: string) => {
    try {
      const state = useAppStore.getState();
      // Already in active list → no-op
      if (state.activeProposals.find(p => p.id === id)) return;

      let storedProposal = await loadProposalById(id);
      let fileBlob: Blob | null = null;

      if (!storedProposal) {
        const cloudProposal = state.recentProposals.find(p => p.id === id && p.isCloudStored);
        if (cloudProposal && cloudProposal.storagePath) {
          try {
            fileBlob = await downloadProposalFile(cloudProposal.storagePath);
            storedProposal = cloudProposal;
          } catch (error) {
            console.error('Failed to download cloud proposal for active list:', error);
            return;
          }
        } else {
          console.error('Proposal not found for active list:', id);
          return;
        }
      }

      if (!fileBlob && !storedProposal.fileBlob) return;

      const blob = fileBlob || storedProposal.fileBlob!;
      const file = new File([blob], storedProposal.fileName, { type: storedProposal.fileType });

      let pageImages = storedProposal.pageImages;
      let extractedImages = storedProposal.extractedImages;

      if (fileBlob && storedProposal.fileType === 'application/pdf') {
        try {
          console.log(`🖼️ Extracting images for "${storedProposal.fileName}" (${storedProposal.pageCount} pages, limit: 10)...`);
          const pdfResult = await extractPDFContent(file, 10);
          pageImages = pdfResult.pageImages;
          extractedImages = pdfResult.images;
          console.log(`✅ "${storedProposal.fileName}": extracted ${pageImages?.length || 0} page images`);
        } catch (error) {
          console.warn('⚠️ Failed to extract images for active proposal:', error);
        }
      }

      // Stamp sourceId + sourceName on every page for multi-PDF isolation
      const stampedPageImages = (pageImages || []).map((p: any) => ({
        ...p,
        sourceId: storedProposal!.id,
        sourceName: storedProposal!.fileName,
      }));

      const fileUrl = URL.createObjectURL(file);

      const activeProposal: ActiveProposal = {
        id: storedProposal.id,
        fileName: storedProposal.fileName,
        fileType: storedProposal.fileType,
        pageCount: storedProposal.pageCount,
        textContent: storedProposal.textContent,
        fileUrl,
        pageImages: stampedPageImages,
      };

      // Deduplicate: replace any existing entry with same id, then append
      set(state => ({ activeProposals: [...state.activeProposals.filter(p => p.id !== activeProposal.id), activeProposal] }));

      // Persist pages by proposalId (no overwrite of other PDFs)
      if (stampedPageImages.length > 0) {
        await savePageImagesById(storedProposal.id, stampedPageImages);
      }

      // Persist active IDs list + metadata to localStorage so refresh restores them
      const updatedProposals = useAppStore.getState().activeProposals;
      saveActiveProposalIds(updatedProposals.map(p => p.id));
      saveActiveProposalMeta(updatedProposals.map(p => ({
        id: p.id,
        fileName: p.fileName,
        fileType: p.fileType,
        pageCount: p.pageCount,
        textContent: p.textContent,
      })));

      console.log(`📦 activeProposals now: ${useAppStore.getState().activeProposals.map(p => `${p.fileName}(${p.pageImages.length}imgs)`).join(', ')}`);

      // Also update the single proposal state for backward compatibility
      set({
        proposal: {
          file,
          fileName: storedProposal.fileName,
          fileUrl,
          textContent: storedProposal.textContent,
          pageCount: storedProposal.pageCount,
          currentPage: 1,
          extractedImages,
          pageImages: stampedPageImages,
          uploadedAt: storedProposal.uploadedAt,
        }
      });
      console.log('✅ Added to active proposals:', storedProposal.fileName);
    } catch (error) {
      console.error('Failed to add active proposal:', error);
    }
  },

  removeActiveProposal: (id: string) => {
    // Remove from memory
    set(state => ({
      activeProposals: state.activeProposals.filter(p => p.id !== id),
    }));
    // Clear that PDF's IndexedDB entry
    clearPageImagesById(id);
    // Update persisted ID list and metadata
    const updatedProposals = useAppStore.getState().activeProposals;
    saveActiveProposalIds(updatedProposals.map(p => p.id));
    saveActiveProposalMeta(updatedProposals.map(p => ({
      id: p.id,
      fileName: p.fileName,
      fileType: p.fileType,
      pageCount: p.pageCount,
      textContent: p.textContent,
    })));
    console.log(`🗑️ Removed active proposal ${id}. Remaining: ${updatedProposals.length}`);
  },

  restoreActiveProposals: async () => {
    try {
      console.log('🔄 DEBUG [restoreActiveProposals]: Starting restore process');
      
      const savedIds = loadActiveProposalIds();
      console.log('   Saved proposal IDs from localStorage:', savedIds);
      
      if (savedIds.length === 0) {
        console.log('   ℹ️ No saved proposal IDs - nothing to restore');
        return;
      }

      console.log(`   🔍 Attempting to restore ${savedIds.length} active proposals from IndexedDB...`);
      const state = useAppStore.getState();
      console.log('   Current activeProposals in memory:', state.activeProposals.length);
      console.log('   Current recentProposals in memory:', state.recentProposals.length);
      
      const restoredProposals: ActiveProposal[] = [];

      for (const id of savedIds) {
        console.log(`   \n   📦 Processing proposal ID: ${id.substring(0, 8)}...`);
        
        // Skip if already in memory
        if (state.activeProposals.find(p => p.id === id)) {
          console.log('      ⏭️ Already in memory, skipping');
          continue;
        }

        // Load pages from IndexedDB by ID
        console.log('      💾 Loading page images from IndexedDB...');
        const pages = await loadPageImagesById(id);
        console.log(`      📄 Loaded ${pages.length} page images from IndexedDB`);
        
        if (pages.length === 0) {
          console.warn(`      ⚠️ No cached pages for proposal ${id}, skipping restore`);
          continue;
        }
        
        // Debug: Show sample page data
        if (pages.length > 0) {
          console.log(`      🖼️ Sample page: Page Number=${pages[0].pageNumber}, Source="${pages[0].sourceName || 'Unknown'}"`);
        }

        // Get metadata: first try recentProposals, then fall back to saved meta
        console.log('      🔍 Looking for metadata...');
        const recentMeta = useAppStore.getState().recentProposals.find(p => p.id === id);
        const savedMeta = loadActiveProposalMeta().find(m => m.id === id);
        const meta = recentMeta || savedMeta;
        
        if (!meta) {
          console.warn(`      ⚠️ No metadata for proposal ${id}, skipping restore`);
          continue;
        }
        
        console.log(`      ✅ Found metadata: "${meta.fileName}" (${meta.pageCount} pages)`);

        restoredProposals.push({
          id: meta.id,
          fileName: meta.fileName,
          fileType: meta.fileType,
          pageCount: meta.pageCount,
          textContent: meta.textContent,
          fileUrl: meta.fileUrl || '',
          pageImages: pages,
        });
        console.log(`      ✅ Restored: ${meta.fileName} (${pages.length} pages)`);
      }

      console.log(`   \n   📊 Restore summary: ${restoredProposals.length} proposals successfully restored`);
      
      if (restoredProposals.length > 0) {
        console.log('   📋 Restored proposal list:');
        restoredProposals.forEach((p, idx) => {
          console.log(`      ${idx + 1}. "${p.fileName}" - ${p.pageImages?.length || 0} page images`);
        });
        
        set(state => ({
          activeProposals: [
            ...state.activeProposals,
            ...restoredProposals.filter(r => !state.activeProposals.find(p => p.id === r.id)),
          ],
        }));
        
        const finalCount = useAppStore.getState().activeProposals.length;
        console.log(`   ✅ Updated store: now have ${finalCount} total active proposals`);
        console.log(`🏁 DEBUG [restoreActiveProposals]: Complete`);
      } else {
        console.log('   ⚠️ No proposals were restored (all skipped or failed)');
      }
    } catch (error) {
      console.warn('⚠️ Failed to restore active proposals:', error);
    }
  },

  // ── Cloud Service Pages (PRIMARY DATA SOURCE from proposal_chunks) ──
  cloudServicePages: [],

  loadCloudServices: async () => {
    try {
      console.log('☁️ DEBUG [loadCloudServices]: Loading from proposal_chunks table...');
      
      const { loadAllServicesFromCloud, transformServicesToPages } = await import('../services/supabaseProposalService');
      
      // Load services from proposal_chunks
      const services = await loadAllServicesFromCloud();
      console.log(`   ✅ Loaded ${services.length} services from cloud`);
      
      // Transform to ExtractedPage format
      const pages = transformServicesToPages(services);
      console.log(`   📄 Transformed to ${pages.length} page objects`);
      
      // Show sample pages for debugging
      if (pages.length > 0) {
        console.log('   📋 Sample cloud pages:');
        pages.slice(0, 3).forEach((page, idx) => {
          console.log(`      ${idx + 1}. "${page.serviceName}" - ${page.city} - ${page.imageUrl ? 'Has image' : 'No image'}`);
        });
      } else {
        console.log('   ⚠️ No pages generated from services (check if metadata.images is empty)');
      }
      
      // Store in state
      set({ cloudServicePages: pages });
      console.log('🏁 DEBUG [loadCloudServices]: Complete');
      
      return pages;
    } catch (error) {
      console.error('❌ DEBUG [loadCloudServices]: Failed to load cloud services:', error);
      set({ cloudServicePages: [] });
      return [];
    }
  },
}));

// Expose store to browser console for debugging
if (typeof window !== 'undefined') {
  (window as any).__store = useAppStore;
}

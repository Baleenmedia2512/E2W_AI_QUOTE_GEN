import { CompanyInfo } from '../types/company';

const COMPANY_INFO_KEY = 'ai_quote_gen_company_info';

export const saveCompanyInfo = (companyInfo: CompanyInfo): void => {
  try {
    localStorage.setItem(COMPANY_INFO_KEY, JSON.stringify(companyInfo));
  } catch (error) {
    console.error('Failed to save company info:', error);
  }
};

export const loadCompanyInfo = (): CompanyInfo | null => {
  try {
    const stored = localStorage.getItem(COMPANY_INFO_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to load company info:', error);
    return null;
  }
};

export const clearCompanyInfo = (): void => {
  try {
    localStorage.removeItem(COMPANY_INFO_KEY);
  } catch (error) {
    console.error('Failed to clear company info:', error);
  }
};

// Session storage for chat history
const CHAT_HISTORY_KEY = 'ai_quote_gen_chat_history';

/**
 * Drop progressive chip thumbnails from persisted history (memory on refresh).
 * Keep MULTIPLE_MATCH groupedServices.imageUrl — those are per-catalog service
 * cards and must survive session restore.
 */
function stripChipImagesForStorage(messages: any[]): any[] {
  return messages.map((msg) => {
    let next = msg;
    if (msg?.progressiveOptions?.length) {
      const opts = msg.progressiveOptions;
      // Cap — restoring 90+ chips freezes the tab on reload
      const capped = opts.length > 40 ? opts.slice(0, 36) : opts;
      next = {
        ...next,
        progressiveOptions: capped.map(
          (opt: Record<string, unknown>) => {
            if (!opt) return opt;
            const { imageUrl: _drop, ...rest } = opt;
            const id = String(rest.id || '');
            if (id.startsWith('batch-group:') && id.length > 120) {
              return { ...rest, id: `batch-group:legacy|${opt.group || 'x'}|${opt.city || opt.label || ''}` };
            }
            return rest;
          },
        ),
      };
    }
    // Preserve groupedServices[].imageUrl / serviceId for service-list cards.
    if (Array.isArray(next?.groupedServices)) {
      next = {
        ...next,
        groupedServices: next.groupedServices.map((g: Record<string, unknown>) => ({
          ...g,
          services: Array.isArray(g.services)
            ? (g.services as Array<Record<string, unknown>>).map((s) => ({ ...s }))
            : g.services,
        })),
      };
    }
    // Never persist batchGroupMap (can be large); session is in memory for active turn
    if (next?.progressiveSession?.batchGroupMap) {
      const { batchGroupMap: _m, ...sessRest } = next.progressiveSession;
      next = { ...next, progressiveSession: sessRest };
    }
    return next;
  });
}

export const saveChatHistory = (messages: any[]): void => {
  try {
    sessionStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify(stripChipImagesForStorage(messages)),
    );
  } catch (error) {
    console.error('Failed to save chat history:', error);
  }
};

export const loadChatHistory = (): any[] | null => {
  try {
    const stored = sessionStorage.getItem(CHAT_HISTORY_KEY);
    if (!stored) return null;
    return stripChipImagesForStorage(JSON.parse(stored));
  } catch (error) {
    console.error('Failed to load chat history:', error);
    return null;
  }
};

export const clearChatHistory = (): void => {
  try {
    sessionStorage.removeItem(CHAT_HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear chat history:', error);
  }
};

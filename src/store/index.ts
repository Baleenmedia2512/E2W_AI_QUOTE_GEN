import { create } from 'zustand';
import { AppState, ProposalData } from '../types';

const initialProposalState: ProposalData = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 1,
  extractedImages: [],
  uploadedAt: null,
};

export const useAppStore = create<AppState>((set) => ({
  proposal: initialProposalState,
  setProposal: (proposal) =>
    set((state) => ({
      proposal: { ...state.proposal, ...proposal },
    })),
  resetProposal: () =>
    set({
      proposal: initialProposalState,
    }),
}));

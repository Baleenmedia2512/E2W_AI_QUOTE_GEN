export interface ProposalData {
  file: File | null;
  fileName: string;
  fileUrl: string;
  textContent: string;
  pageCount: number;
  currentPage: number;
  extractedImages: string[];
  uploadedAt: Date | null;
}

export interface AppState {
  proposal: ProposalData;
  setProposal: (proposal: Partial<ProposalData>) => void;
  resetProposal: () => void;
}

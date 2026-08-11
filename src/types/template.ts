import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { Quote } from './quote';
import type { PdfSpecGroup } from '../utils/metroSpecParser';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
  // Source tracking for multi-PDF isolation
  sourceId?: string;
  sourceName?: string;
}

export interface ServiceReadyData {
  refImages: string[];
  specImages: string[];
  specFields: Array<{ label: string; value: string }>;
  specGroups?: PdfSpecGroup[];
  review: { reviewerName: string; starCount: number; reviewText: string; reviewUrl: string | null } | null;
}

export interface TemplateData {
  company: CompanyInfo;
  client: ClientInfo;
  quote: Quote;
  proposalPages?: ExtractedPage[];
  // Multi-PDF map: city/sourceName key -> pages from that PDF
  proposalPageMap?: Record<string, ExtractedPage[]>;
  /** Called by ReferenceImages when images/spec/review are resolved — used by React-PDF */
  onServiceDataReady?: (serviceKey: string, data: ServiceReadyData) => void;
}

export interface TemplateProps {
  data: TemplateData;
  editable?: boolean;
  onDataChange?: (data: TemplateData) => void;
  /** Preview-only: update client from inline Name / Phone / Email fields. */
  onClientChange?: (client: ClientInfo) => void;
  /** Preview-only: jump to a section (TOC / exec summary service link). */
  onNavigateToSection?: (sectionId: string) => void;
}

export type TemplateType = 'corporate-minimal' | 'premium-agency' | 'modern-sales' | 'classic-business';

export interface Template {
  id: TemplateType;
  name: string;
  description: string;
  thumbnail: string;
  component: React.ComponentType<TemplateProps>;
}

export interface TemplateMetadata {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

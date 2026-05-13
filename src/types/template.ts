import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { Quote } from './quote';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
  // Source tracking for multi-PDF isolation
  sourceId?: string;
  sourceName?: string;
}

export interface TemplateData {
  company: CompanyInfo;
  client: ClientInfo;
  quote: Quote;
  proposalPages?: ExtractedPage[];
  // Multi-PDF map: city/sourceName key -> pages from that PDF
  proposalPageMap?: Record<string, ExtractedPage[]>;
}

export interface TemplateProps {
  data: TemplateData;
  editable?: boolean;
  onDataChange?: (data: TemplateData) => void;
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

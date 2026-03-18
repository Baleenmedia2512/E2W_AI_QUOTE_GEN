import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { Quote } from './quote';

export interface TemplateData {
  company: CompanyInfo;
  client: ClientInfo;
  quote: Quote;
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

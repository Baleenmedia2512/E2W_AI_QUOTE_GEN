import React from 'react';
import { Template, TemplateType } from '../../types';
import { CorporateMinimal } from '../Templates/CorporateMinimal';
import { PremiumAgency } from '../Templates/PremiumAgency';
import { ModernSales } from '../Templates/ModernSales';
import { ClassicBusiness } from '../Templates/ClassicBusiness';
import './TemplateSelector.css';

interface TemplateSelectorProps {
  selectedTemplate: TemplateType;
  onSelectTemplate: (template: TemplateType) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplate,
  onSelectTemplate
}) => {
  console.log('ðŸŽ¨ TemplateSelector rendered');
  console.log('Selected template:', selectedTemplate);
  
  // Template preview SVGs
  const createTemplatePreview = (id: string) => {
    const previews: Record<string, string> = {
      'corporate-minimal': `
        <svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
          <rect width="300" height="400" fill="#2c3e50"/>
          <rect x="20" y="20" width="260" height="60" fill="#34495e" rx="4"/>
          <rect x="30" y="30" width="100" height="8" fill="#ecf0f1" rx="2"/>
          <rect x="30" y="50" width="150" height="6" fill="#bdc3c7" rx="2"/>
          <rect x="20" y="100" width="260" height="150" fill="#ffffff" rx="4"/>
          <rect x="30" y="110" width="240" height="10" fill="#2c3e50" rx="2"/>
          <rect x="30" y="130" width="240" height="6" fill="#95a5a6" rx="2"/>
          <rect x="30" y="145" width="200" height="6" fill="#95a5a6" rx="2"/>
          <rect x="20" y="270" width="260" height="100" fill="#34495e" rx="4"/>
          <text x="150" y="330" font-family="Arial" font-size="24" fill="#ffffff" text-anchor="middle" font-weight="bold">Corporate</text>
        </svg>
      `,
      'premium-agency': `
        <svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#9e3f44;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#750926;stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect width="300" height="400" fill="url(#grad1)"/>
          <rect x="20" y="20" width="260" height="70" fill="rgba(255,255,255,0.2)" rx="8"/>
          <rect x="30" y="35" width="120" height="12" fill="#ffffff" rx="3"/>
          <rect x="30" y="55" width="180" height="8" fill="rgba(255,255,255,0.8)" rx="2"/>
          <rect x="20" y="110" width="260" height="160" fill="#ffffff" rx="8"/>
          <rect x="30" y="125" width="240" height="12" fill="#9e3f44" rx="3"/>
          <rect x="30" y="150" width="240" height="8" fill="#e0e0e0" rx="2"/>
          <rect x="30" y="165" width="200" height="8" fill="#e0e0e0" rx="2"/>
          <text x="150" y="340" font-family="Arial" font-size="28" fill="#ffffff" text-anchor="middle" font-weight="bold">Premium</text>
        </svg>
      `,
      'modern-sales': `
        <svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
          <rect width="300" height="400" fill="#f8f9fa"/>
          <rect width="80" height="400" fill="#750926"/>
          <rect x="10" y="20" width="60" height="60" fill="rgba(255,255,255,0.2)" rx="8"/>
          <rect x="90" y="20" width="190" height="50" fill="#ffffff" rx="6" stroke="#e0e0e0" stroke-width="1"/>
          <rect x="100" y="30" width="120" height="10" fill="#750926" rx="2"/>
          <rect x="100" y="45" width="150" height="6" fill="#bdc3c7" rx="2"/>
          <rect x="90" y="90" width="190" height="120" fill="#ffffff" rx="6" stroke="#e0e0e0" stroke-width="1"/>
          <rect x="100" y="105" width="170" height="8" fill="#333" rx="2"/>
          <rect x="100" y="120" width="170" height="6" fill="#95a5a6" rx="2"/>
          <rect x="100" y="135" width="140" height="6" fill="#95a5a6" rx="2"/>
          <text x="40" y="350" font-family="Arial" font-size="16" fill="#ffffff" text-anchor="middle" font-weight="bold" transform="rotate(-90 40 350)">Modern</text>
        </svg>
      `,
      'classic-business': `
        <svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
          <rect width="300" height="400" fill="#ffffff"/>
          <rect width="300" height="80" fill="#1a1a1a"/>
          <rect x="20" y="20" width="260" height="40" fill="rgba(255,255,255,0.1)" stroke="#ffffff" stroke-width="2" rx="4"/>
          <rect x="30" y="28" width="100" height="10" fill="#ffffff" rx="2"/>
          <rect x="30" y="42" width="140" height="6" fill="rgba(255,255,255,0.7)" rx="2"/>
          <rect x="20" y="100" width="260" height="140" fill="#f5f5f5" stroke="#1a1a1a" stroke-width="1" rx="4"/>
          <rect x="35" y="115" width="230" height="12" fill="#1a1a1a" rx="2"/>
          <rect x="35" y="140" width="230" height="8" fill="#666666" rx="2"/>
          <rect x="35" y="155" width="200" height="8" fill="#666666" rx="2"/>
          <rect x="35" y="170" width="230" height="8" fill="#666666" rx="2"/>
          <text x="150" y="330" font-family="Georgia" font-size="26" fill="#1a1a1a" text-anchor="middle" font-weight="bold">Classic Business</text>
        </svg>
      `
    };
    return previews[id] || previews['corporate-minimal'];
  };
  
  const templates: Template[] = [
    {
      id: 'corporate-minimal',
      name: 'Corporate Minimal',
      description: 'Clean and professional design perfect for corporate businesses',
      thumbnail: '',
      component: CorporateMinimal
    },
    {
      id: 'premium-agency',
      name: 'Premium Agency',
      description: 'Modern gradient design with premium styling for agencies',
      thumbnail: '',
      component: PremiumAgency
    },
    {
      id: 'modern-sales',
      name: 'Modern Sales',
      description: 'Contemporary layout with sidebar perfect for sales teams',
      thumbnail: '',
      component: ModernSales
    },
    {
      id: 'classic-business',
      name: 'Classic Business',
      description: 'Traditional formal design ideal for established businesses',
      thumbnail: '',
      component: ClassicBusiness
    }
  ];

  console.log('ðŸ“‹ Total templates:', templates.length);

  return (
    <div className="template-selector">
      {/* Header Section */}
      <div className="template-selector-header">
        <h2 className="template-heading">
          Choose Your Template
        </h2>
        <p className="template-subtitle">
          Select a professional design that matches your business style
        </p>
      </div>

      <div className="template-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '30px',
          marginTop: '30px'
        }}
      >
        {templates.map((template) => {
          console.log('ðŸ–¼ï¸ Rendering template card:', template.name);
          return (
            <div
              key={template.id}
              className={`template-card ${selectedTemplate === template.id ? 'selected' : ''}`}
              onClick={() => {
                console.log('ðŸ–±ï¸ Template card clicked:', template.id);
                onSelectTemplate(template.id);
              }}
            >
              <div className="template-thumbnail">
                <div 
                  dangerouslySetInnerHTML={{ __html: createTemplatePreview(template.id) }}
                  style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                />
                {selectedTemplate === template.id && (
                  <div className="selected-badge">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                )}
              </div>
              <div className="template-info">
                <h3 className="template-name">{template.name}</h3>
                <p className="template-description">{template.description}</p>
              </div>
              <button
                className={`select-button ${selectedTemplate === template.id ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('ðŸ–±ï¸ Select button clicked:', template.id);
                  onSelectTemplate(template.id);
                }}
              >
                {selectedTemplate === template.id ? 'SELECTED' : 'SELECT TEMPLATE'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

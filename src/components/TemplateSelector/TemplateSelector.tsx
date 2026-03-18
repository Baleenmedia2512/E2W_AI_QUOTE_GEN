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
  const templates: Template[] = [
    {
      id: 'corporate-minimal',
      name: 'Corporate Minimal',
      description: 'Clean and professional design perfect for corporate businesses',
      thumbnail: 'https://via.placeholder.com/300x400/2c3e50/ffffff?text=Corporate+Minimal',
      component: CorporateMinimal
    },
    {
      id: 'premium-agency',
      name: 'Premium Agency',
      description: 'Modern gradient design with premium styling for agencies',
      thumbnail: 'https://via.placeholder.com/300x400/667eea/ffffff?text=Premium+Agency',
      component: PremiumAgency
    },
    {
      id: 'modern-sales',
      name: 'Modern Sales',
      description: 'Contemporary layout with sidebar perfect for sales teams',
      thumbnail: 'https://via.placeholder.com/300x400/4f46e5/ffffff?text=Modern+Sales',
      component: ModernSales
    },
    {
      id: 'classic-business',
      name: 'Classic Business',
      description: 'Traditional formal design ideal for established businesses',
      thumbnail: 'https://via.placeholder.com/300x400/1a1a1a/ffffff?text=Classic+Business',
      component: ClassicBusiness
    }
  ];

  return (
    <div className="template-selector">
      <div className="template-selector-header">
        <h2>Choose Your Template</h2>
        <p>Select a professional template that best represents your brand</p>
      </div>

      <div className="template-grid">
        {templates.map((template) => (
          <div
            key={template.id}
            className={`template-card ${selectedTemplate === template.id ? 'selected' : ''}`}
            onClick={() => {
              console.log('🖱️ Template card clicked:', template.id);
              onSelectTemplate(template.id);
            }}
          >
            <div className="template-thumbnail">
              <img src={template.thumbnail} alt={template.name} />
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
                console.log('🖱️ Select button clicked:', template.id);
                onSelectTemplate(template.id);
              }}
            >
              {selectedTemplate === template.id ? 'Selected' : 'Select Template'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

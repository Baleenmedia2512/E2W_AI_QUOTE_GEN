import React, { useState, useEffect } from 'react';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonTextarea,
  IonGrid,
  IonRow,
  IonCol,
} from '@ionic/react';
import { CompanyInfo } from '../../types/company';
import { saveCompanyInfo, loadCompanyInfo } from '../../utils/localStorage';
import './CompanyInfoForm.css';

interface CompanyInfoFormProps {
  onSubmit: (companyInfo: CompanyInfo) => void;
  initialData?: CompanyInfo | null;
}

const CompanyInfoForm: React.FC<CompanyInfoFormProps> = ({ onSubmit, initialData }) => {
  const [formData, setFormData] = useState<CompanyInfo>({
    name: '',
    address: '',
    gst: '',
    phone: '',
    email: '',
    logo: '',
    website: '',
    signature: '',
    designation: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof CompanyInfo, string>>>({});
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [useSaved, setUseSaved] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
      if (initialData.logo) {
        setLogoPreview(initialData.logo);
      }
    }
  }, [initialData]);

  const handleInputChange = (field: keyof CompanyInfo, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setLogoPreview(base64String);
        setFormData(prev => ({ ...prev, logo: base64String }));
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof CompanyInfo, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Company name is required';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else if (!/^\+?[\d\s-()]+$/.test(formData.phone)) {
      newErrors.phone = 'Invalid phone number';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }

    if (formData.gst && !/^[A-Z0-9]{2,15}$/.test(formData.gst.trim())) {
      newErrors.gst = 'Invalid GST format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      onSubmit(formData);
      saveCompanyInfo(formData);
    }
  };

  const handleUseSavedInfo = () => {
    const savedInfo = loadCompanyInfo();
    if (savedInfo) {
      setFormData(savedInfo);
      if (savedInfo.logo) {
        setLogoPreview(savedInfo.logo);
      }
      setUseSaved(true);
    }
  };

  const handleClearForm = () => {
    setFormData({
      name: '',
      address: '',
      gst: '',
      phone: '',
      email: '',
      logo: '',
      website: '',
      signature: '',
      designation: '',
    });
    setLogoPreview('');
    setErrors({});
    setUseSaved(false);
  };

  return (
    <IonCard className="company-info-form">
      <IonCardHeader>
        <div className="form-header">
          <IonCardTitle>Company Information</IonCardTitle>
          {loadCompanyInfo() && !useSaved && (
            <IonButton fill="outline" size="small" onClick={handleUseSavedInfo}>
              Use Saved Info
            </IonButton>
          )}
        </div>
      </IonCardHeader>
      <IonCardContent>
        <form onSubmit={handleSubmit}>
          <IonGrid>
            {/* Logo Upload */}
            <IonRow>
              <IonCol size="12">
                <div className="logo-upload-section">
                  <IonLabel>Company Logo (Optional)</IonLabel>
                  {logoPreview && (
                    <div className="logo-preview">
                      <img src={logoPreview} alt="Company Logo" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="logo-input"
                    id="logo-upload"
                  />
                  <label htmlFor="logo-upload" className="logo-upload-label">
                    {logoPreview ? 'Change Logo' : 'Upload Logo'}
                  </label>
                </div>
              </IonCol>
            </IonRow>

            {/* Company Name */}
            <IonRow>
              <IonCol size="12">
                <IonItem className={errors.name ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Company Name <span className="required">*</span>
                  </IonLabel>
                  <IonInput
                    value={formData.name}
                    onIonInput={(e) => handleInputChange('name', e.detail.value || '')}
                    placeholder="Enter company name"
                  />
                </IonItem>
                {errors.name && <div className="error-message">{errors.name}</div>}
              </IonCol>
            </IonRow>

            {/* Address */}
            <IonRow>
              <IonCol size="12">
                <IonItem className={errors.address ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Address <span className="required">*</span>
                  </IonLabel>
                  <IonTextarea
                    value={formData.address}
                    onIonInput={(e) => handleInputChange('address', e.detail.value || '')}
                    placeholder="Enter company address"
                    rows={3}
                  />
                </IonItem>
                {errors.address && <div className="error-message">{errors.address}</div>}
              </IonCol>
            </IonRow>

            {/* GST */}
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem className={errors.gst ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">GST Number (Optional)</IonLabel>
                  <IonInput
                    value={formData.gst}
                    onIonInput={(e) => handleInputChange('gst', e.detail.value || '')}
                    placeholder="Enter GST number"
                  />
                </IonItem>
                {errors.gst && <div className="error-message">{errors.gst}</div>}
              </IonCol>

              {/* Phone */}
              <IonCol size="12" sizeMd="6">
                <IonItem className={errors.phone ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Phone <span className="required">*</span>
                  </IonLabel>
                  <IonInput
                    value={formData.phone}
                    onIonInput={(e) => handleInputChange('phone', e.detail.value || '')}
                    placeholder="Enter phone number"
                    type="tel"
                  />
                </IonItem>
                {errors.phone && <div className="error-message">{errors.phone}</div>}
              </IonCol>
            </IonRow>

            {/* Email and Website */}
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem className={errors.email ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Email <span className="required">*</span>
                  </IonLabel>
                  <IonInput
                    value={formData.email}
                    onIonInput={(e) => handleInputChange('email', e.detail.value || '')}
                    placeholder="Enter email address"
                    type="email"
                  />
                </IonItem>
                {errors.email && <div className="error-message">{errors.email}</div>}
              </IonCol>

              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Website (Optional)</IonLabel>
                  <IonInput
                    value={formData.website}
                    onIonInput={(e) => handleInputChange('website', e.detail.value || '')}
                    placeholder="Enter website URL"
                    type="url"
                  />
                </IonItem>
              </IonCol>
            </IonRow>

            {/* Designation and Signature */}
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Designation (Optional)</IonLabel>
                  <IonInput
                    value={formData.designation}
                    onIonInput={(e) => handleInputChange('designation', e.detail.value || '')}
                    placeholder="e.g., Managing Director"
                  />
                </IonItem>
              </IonCol>

              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Signature Name (Optional)</IonLabel>
                  <IonInput
                    value={formData.signature}
                    onIonInput={(e) => handleInputChange('signature', e.detail.value || '')}
                    placeholder="Enter signatory name"
                  />
                </IonItem>
              </IonCol>
            </IonRow>

            {/* Buttons */}
            <IonRow>
              <IonCol size="12">
                <div className="form-buttons">
                  <IonButton type="button" fill="clear" onClick={handleClearForm}>
                    Clear
                  </IonButton>
                  <IonButton type="submit">Continue</IonButton>
                </div>
              </IonCol>
            </IonRow>
          </IonGrid>
        </form>
      </IonCardContent>
    </IonCard>
  );
};

export default CompanyInfoForm;

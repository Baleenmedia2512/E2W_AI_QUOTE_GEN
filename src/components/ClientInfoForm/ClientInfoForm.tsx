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
import { ClientInfo } from '../../types/client';
import './ClientInfoForm.css';

interface ClientInfoFormProps {
  onSubmit: (clientInfo: ClientInfo) => void;
  onBack?: () => void;
  initialData?: ClientInfo | null;
}

const ClientInfoForm: React.FC<ClientInfoFormProps> = ({ onSubmit, onBack, initialData }) => {
  const [formData, setFormData] = useState<ClientInfo>({
    name: '',
    company: '',
    address: '',
    gst: '',
    phone: '',
    email: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof ClientInfo, string>>>({});

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleInputChange = (field: keyof ClientInfo, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof ClientInfo, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }

    if (!formData.company.trim()) {
      newErrors.company = 'Company name is required';
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
    }
  };

  const handleClearForm = () => {
    setFormData({
      name: '',
      company: '',
      address: '',
      gst: '',
      phone: '',
      email: '',
    });
    setErrors({});
  };

  return (
    <IonCard className="client-info-form">
      <IonCardHeader>
        <IonCardTitle>Client Information</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <form onSubmit={handleSubmit}>
          <IonGrid>
            {/* Client Name */}
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem className={errors.name ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Client Name <span className="required">*</span>
                  </IonLabel>
                  <IonInput
                    value={formData.name}
                    onIonInput={(e) => handleInputChange('name', e.detail.value || '')}
                    placeholder="Enter client name"
                  />
                </IonItem>
                {errors.name && <div className="error-message">{errors.name}</div>}
              </IonCol>

              {/* Company Name */}
              <IonCol size="12" sizeMd="6">
                <IonItem className={errors.company ? 'ion-invalid' : ''}>
                  <IonLabel position="stacked">
                    Company Name <span className="required">*</span>
                  </IonLabel>
                  <IonInput
                    value={formData.company}
                    onIonInput={(e) => handleInputChange('company', e.detail.value || '')}
                    placeholder="Enter company name"
                  />
                </IonItem>
                {errors.company && <div className="error-message">{errors.company}</div>}
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
                    placeholder="Enter client address"
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

            {/* Email */}
            <IonRow>
              <IonCol size="12">
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
            </IonRow>

            {/* Buttons */}
            <IonRow>
              <IonCol size="12">
                <div className="form-buttons">
                  {onBack && (
                    <IonButton type="button" fill="outline" onClick={onBack}>
                      Back
                    </IonButton>
                  )}
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

export default ClientInfoForm;

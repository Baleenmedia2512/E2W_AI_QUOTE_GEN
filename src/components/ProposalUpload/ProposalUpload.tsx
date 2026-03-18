import React, { useRef, useState } from 'react';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonIcon,
  IonText,
  IonSpinner,
  IonToast,
} from '@ionic/react';
import { cloudUploadOutline, documentTextOutline } from 'ionicons/icons';
import { useAppStore } from '../../store';
import { extractPDFContent, validatePDFFile } from '../../utils/pdfUtils';
import './ProposalUpload.css';

const ProposalUpload: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);
  const { proposal, setProposal } = useAppStore();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validatePDFFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Extract PDF content
      const { textContent, pageCount, images } = await extractPDFContent(file);

      // Create object URL for PDF viewing
      const fileUrl = URL.createObjectURL(file);

      // Update store
      setProposal({
        file,
        fileName: file.name,
        fileUrl,
        textContent,
        pageCount,
        currentPage: 1,
        extractedImages: images,
        uploadedAt: new Date(),
      });

      setSuccess(true);
    } catch (err) {
      setError('Failed to process PDF file. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="proposal-upload-container">
      <IonCard>
        <IonCardHeader>
          <IonCardTitle>Upload Proposal</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {!proposal.file ? (
            <div className="upload-area" onClick={handleUploadClick}>
              <IonIcon icon={cloudUploadOutline} className="upload-icon" />
              <IonText>
                <h3>Click to upload PDF</h3>
                <p>or drag and drop</p>
                <p className="file-info">PDF files only (max 10MB)</p>
              </IonText>
            </div>
          ) : (
            <div className="uploaded-file-info">
              <IonIcon icon={documentTextOutline} className="file-icon" />
              <div className="file-details">
                <IonText>
                  <h4>{proposal.fileName}</h4>
                  <p>{proposal.pageCount} pages</p>
                </IonText>
              </div>
              <IonButton fill="outline" size="small" onClick={handleUploadClick}>
                Change File
              </IonButton>
            </div>
          )}

          {loading && (
            <div className="loading-container">
              <IonSpinner name="crescent" />
              <IonText>Processing PDF...</IonText>
            </div>
          )}
        </IonCardContent>
      </IonCard>

      <IonToast
        isOpen={!!error}
        message={error}
        duration={3000}
        color="danger"
        onDidDismiss={() => setError('')}
      />

      <IonToast
        isOpen={success}
        message="PDF uploaded successfully!"
        duration={2000}
        color="success"
        onDidDismiss={() => setSuccess(false)}
      />
    </div>
  );
};

export default ProposalUpload;

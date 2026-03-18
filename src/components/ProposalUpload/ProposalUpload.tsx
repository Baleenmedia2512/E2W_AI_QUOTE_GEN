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
  const [isDragging, setIsDragging] = useState(false);
  const { proposal, setProposal } = useAppStore();

  const processFile = async (file: File) => {
    // Validate file
    const validation = validatePDFFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('Processing PDF file:', file.name);
      // Extract PDF content
      const { textContent, pageCount, images } = await extractPDFContent(file);

      console.log('PDF extraction successful:', {
        fileName: file.name,
        pageCount,
        textLength: textContent.length,
        hasText: textContent.length > 0
      });

      // Create object URL for PDF viewing
      const fileUrl = URL.createObjectURL(file);

      // Update store
      const proposalData = {
        file,
        fileName: file.name,
        fileUrl,
        textContent,
        pageCount,
        currentPage: 1,
        extractedImages: images,
        uploadedAt: new Date(),
      };
      
      console.log('Updating proposal store with:', proposalData);
      setProposal(proposalData);

      setSuccess(true);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to process PDF file. Please try again.';
      setError(errorMessage);
      console.error('PDF processing error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      await processFile(file);
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
            <div 
              className={`upload-area ${isDragging ? 'dragging' : ''}`}
              onClick={handleUploadClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
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
        position="bottom"
        onDidDismiss={() => setError('')}
      />

      <IonToast
        isOpen={success}
        message="PDF uploaded successfully!"
        duration={2000}
        color="success"
        position="bottom"
        onDidDismiss={() => setSuccess(false)}
      />
    </div>
  );
};

export default ProposalUpload;

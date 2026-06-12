import React, { useState } from 'react';
import { processAndStorePDF, testSearch } from '../../services/pdfEmbeddingService';
import './PDFUploader.css';

// Expose testSearch to window for console testing
if (typeof window !== 'undefined') {
  (window as any).testSearch = testSearch;
}

export const PDFUploader: React.FC = () => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (!file) return;
    
    // Validate file type
    if (file.type !== 'application/pdf') {
      setError('Please upload a PDF file');
      return;
    }
    
    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return;
    }
    
    setUploading(true);
    setError('');
    setProgress(0);
    setMessage('Starting PDF processing...');
    
    try {
      const result = await processAndStorePDF(file, (prog, msg) => {
        setProgress(Math.round(prog));
        setMessage(msg);
      });
      
      setMessage(`✅ Success! Processed ${result.servicesProcessed} services and ${result.imagesExtracted} images.`);
      
      // Reset after 3 seconds
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setMessage('');
      }, 3000);
      
    } catch (err: any) {
      setError(err.message || 'Failed to process PDF');
      setUploading(false);
    }
  };

  return (
    <div className="pdf-uploader">
      <div className="uploader-card">
        <h2>📄 Upload Rate Card PDF</h2>
        {/* <p className="description">
          Upload your Baleen Media rate card PDF (131 pages). 
          The system will extract all 32 services and generate embeddings for semantic search.
        </p> */}
        
        <div className="upload-area">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={uploading}
            id="pdf-input"
            className="file-input"
          />
          <label htmlFor="pdf-input" className={`file-label ${uploading ? 'disabled' : ''}`}>
            {uploading ? '⏳ Processing...' : '📁 Choose PDF File'}
          </label>
        </div>
        
        {uploading && (
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="progress-text">{progress}% - {message}</p>
          </div>
        )}
        
        {message && !uploading && (
          <div className="success-message">
            {message}
          </div>
        )}
        
        {error && (
          <div className="error-message">
            ❌ {error}
          </div>
        )}
        
        <div className="info-box">
          <h3>📋 What happens during upload:</h3>
          <ol>
            <li>Extract text from all pages (automatically)</li>
            <li>Parse and identify advertising services using AI</li>
            <li>Extract metadata (price, size, duration, locations)</li>
            <li>Generate embeddings for semantic search</li>
            <li>Store services in database with vector search</li>
          </ol>
          <p className="note">
            ⚠️ This process takes 1-3 minutes depending on PDF size. Image extraction is optional.
          </p>
        </div>
      </div>
    </div>
  );
};

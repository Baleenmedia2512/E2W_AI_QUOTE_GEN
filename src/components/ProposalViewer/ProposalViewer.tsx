import React, { useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonIcon,
  IonRange,
  IonText,
  IonToolbar,
} from '@ionic/react';
import {
  chevronBackOutline,
  chevronForwardOutline,
  addOutline,
  removeOutline,
} from 'ionicons/icons';
import { Document, Page, pdfjs } from 'react-pdf';
import { useAppStore } from '../../store';
import './ProposalViewer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const ProposalViewer: React.FC = () => {
  const { proposal, setProposal } = useAppStore();
  const [scale, setScale] = useState(1.0);
  const [numPages, setNumPages] = useState<number>(0);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setProposal({ pageCount: numPages });
  };

  const goToPrevPage = () => {
    if (proposal.currentPage > 1) {
      setProposal({ currentPage: proposal.currentPage - 1 });
    }
  };

  const goToNextPage = () => {
    if (proposal.currentPage < proposal.pageCount) {
      setProposal({ currentPage: proposal.currentPage + 1 });
    }
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  const handlePageJump = (e: CustomEvent) => {
    const page = Number(e.detail.value);
    setProposal({ currentPage: page });
  };

  if (!proposal.fileUrl) {
    return (
      <div className="proposal-viewer-empty">
        <IonText color="medium">
          <h3>No proposal uploaded</h3>
          <p>Please upload a PDF file to view it here</p>
        </IonText>
      </div>
    );
  }

  return (
    <div className="proposal-viewer-container">
      <IonCard>
        <IonCardHeader>
          <IonCardTitle>{proposal.fileName}</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <IonToolbar className="viewer-toolbar">
            <IonButtons slot="start">
              <IonButton onClick={goToPrevPage} disabled={proposal.currentPage === 1}>
                <IonIcon icon={chevronBackOutline} />
              </IonButton>
              <IonButton onClick={goToNextPage} disabled={proposal.currentPage === proposal.pageCount}>
                <IonIcon icon={chevronForwardOutline} />
              </IonButton>
            </IonButtons>

            <IonText slot="start" className="page-info">
              Page {proposal.currentPage} / {proposal.pageCount}
            </IonText>

            <IonButtons slot="end">
              <IonButton onClick={handleZoomOut}>
                <IonIcon icon={removeOutline} />
              </IonButton>
              <IonText className="zoom-level">{Math.round(scale * 100)}%</IonText>
              <IonButton onClick={handleZoomIn}>
                <IonIcon icon={addOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>

          <div className="pdf-container">
            <Document
              file={proposal.fileUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="pdf-loading">
                  <IonText>Loading PDF...</IonText>
                </div>
              }
            >
              <Page
                pageNumber={proposal.currentPage}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>

          <div className="page-slider">
            <IonRange
              min={1}
              max={proposal.pageCount}
              value={proposal.currentPage}
              onIonChange={handlePageJump}
              pin={true}
              snaps={true}
              ticks={false}
            />
          </div>

          <div className="page-thumbnails">
            {Array.from({ length: Math.min(proposal.pageCount, 10) }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                className={`thumbnail ${pageNum === proposal.currentPage ? 'active' : ''}`}
                onClick={() => setProposal({ currentPage: pageNum })}
              >
                <Document file={proposal.fileUrl}>
                  <Page pageNumber={pageNum} width={100} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
                <IonText className="thumbnail-label">{pageNum}</IonText>
              </div>
            ))}
            {proposal.pageCount > 10 && (
              <IonText color="medium" className="more-pages">
                +{proposal.pageCount - 10} more pages
              </IonText>
            )}
          </div>
        </IonCardContent>
      </IonCard>
    </div>
  );
};

export default ProposalViewer;

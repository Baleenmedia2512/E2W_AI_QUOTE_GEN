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
  IonToggle,
  IonTextarea,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
} from '@ionic/react';
import { addSharp, trashSharp, saveSharp } from 'ionicons/icons';
import { Quote, QuoteItem, LineItem } from '../../types/quote';
import './QuotePreview.css';

interface QuotePreviewProps {
  quote: Quote | null;
  onUpdate: (quote: Quote) => void;
  onSave?: () => void;
}

const QuotePreview: React.FC<QuotePreviewProps> = ({ quote, onUpdate, onSave }) => {
  const [localQuote, setLocalQuote] = useState<Quote | null>(quote);

  useEffect(() => {
    setLocalQuote(quote);
  }, [quote]);

  if (!localQuote) {
    return (
      <IonCard className="quote-preview-empty">
        <IonCardContent>
          <p className="empty-message">No quote generated yet. Start a chat to create one.</p>
        </IonCardContent>
      </IonCard>
    );
  }

  const calculateLineItemTotal = (item: LineItem): number => {
    return item.quantity * item.unitPrice;
  };

  const calculateItemSubtotal = (item: QuoteItem): number => {
    // Handle new structure (direct properties)
    if (item.total !== undefined) {
      return item.total;
    }
    // Handle old structure (with lineItems)
    return item.lineItems?.reduce((sum, lineItem) => sum + calculateLineItemTotal(lineItem), 0) || 0;
  };

  const calculateQuoteSubtotal = (): number => {
    return localQuote.items.reduce((sum, item) => sum + calculateItemSubtotal(item), 0);
  };

  const calculateGST = (subtotal: number): number => {
    return localQuote.gstEnabled ? subtotal * (localQuote.gstPercentage / 100) : 0;
  };

  const calculateTotal = (subtotal: number, gst: number): number => {
    return subtotal + gst;
  };

  const updateLineItem = (itemIndex: number, lineItemIndex: number, field: keyof LineItem, value: any) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    if (!item.lineItems) return;
    
    const lineItem = item.lineItems[lineItemIndex];
    (lineItem as any)[field] = value;
    lineItem.total = calculateLineItemTotal(lineItem);
    
    if (item.subtotal !== undefined) {
      item.subtotal = calculateItemSubtotal(item);
    }
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateItem = (itemIndex: number, field: keyof QuoteItem, value: any) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    (updatedQuote.items[itemIndex] as any)[field] = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const addLineItem = (itemIndex: number) => {
    if (!localQuote) return;

    const newLineItem: LineItem = {
      id: Date.now().toString(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      total: 0,
    };

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    if (!item.lineItems) {
      item.lineItems = [];
    }
    item.lineItems.push(newLineItem);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const removeLineItem = (itemIndex: number, lineItemIndex: number) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    const item = updatedQuote.items[itemIndex];
    if (!item.lineItems) return;
    
    item.lineItems.splice(lineItemIndex, 1);
    if (item.subtotal !== undefined) {
      item.subtotal = calculateItemSubtotal(item);
    }
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const addQuoteItem = () => {
    if (!localQuote) return;

    const newItem: QuoteItem = {
      id: Date.now().toString(),
      description: 'New Item',
      quantity: 1,
      rate: 0,
      total: 0,
      // Legacy fields for backward compatibility
      title: 'New Section',
      lineItems: [],
      subtotal: 0,
    };

    const updatedQuote = { ...localQuote };
    updatedQuote.items.push(newItem);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const removeQuoteItem = (itemIndex: number) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.items.splice(itemIndex, 1);
    updatedQuote.subtotal = calculateQuoteSubtotal();
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const toggleGST = () => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.gstEnabled = !updatedQuote.gstEnabled;
    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateDeliveryTimeline = (value: string) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.deliveryTimeline = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const updateTermsAndConditions = (value: string) => {
    if (!localQuote) return;

    const updatedQuote = { ...localQuote };
    updatedQuote.termsAndConditions = value;
    updatedQuote.updatedAt = new Date();

    setLocalQuote(updatedQuote);
    onUpdate(updatedQuote);
  };

  const subtotal = calculateQuoteSubtotal();
  const gst = calculateGST(subtotal);
  const total = calculateTotal(subtotal, gst);

  return (
    <IonCard className="quote-preview">
      <IonCardHeader>
        <div className="quote-header">
          <IonCardTitle>Quote Preview</IonCardTitle>
          {onSave && (
            <IonButton onClick={onSave} size="small">
              <IonIcon icon={saveSharp} slot="start" />
              Save Quote
            </IonButton>
          )}
        </div>
      </IonCardHeader>
      <IonCardContent className="quote-content">
        {/* Quote Items */}
        {localQuote.items.map((item, itemIndex) => (
          <div key={item.id} className="quote-item">
            <div className="quote-item-header">
              <IonInput
                value={item.title || ''}
                onIonInput={(e) => updateItem(itemIndex, 'title', e.detail.value)}
                className="item-title-input"
                placeholder="Section Title"
              />
              <IonButton
                fill="clear"
                color="danger"
                size="small"
                onClick={() => removeQuoteItem(itemIndex)}
              >
                <IonIcon icon={trashSharp} slot="icon-only" />
              </IonButton>
            </div>

            {/* Line Items Table */}
            <div className="line-items-table">
              <IonGrid>
                <IonRow className="table-header">
                  <IonCol size="5">Description</IonCol>
                  <IonCol size="2">Qty</IonCol>
                  <IonCol size="2">Price</IonCol>
                  <IonCol size="2">Total</IonCol>
                  <IonCol size="1"></IonCol>
                </IonRow>
                {item.lineItems?.map((lineItem, lineItemIndex) => (
                  <IonRow key={lineItem.id} className="table-row">
                    <IonCol size="5">
                      <IonInput
                        value={lineItem.description || ''}
                        onIonInput={(e) =>
                          updateLineItem(itemIndex, lineItemIndex, 'description', e.detail.value)
                        }
                        placeholder="Item description"
                      />
                    </IonCol>
                    <IonCol size="2">
                      <IonInput
                        type="number"
                        value={String(lineItem.quantity ?? 0)}
                        onIonInput={(e) =>
                          updateLineItem(
                            itemIndex,
                            lineItemIndex,
                            'quantity',
                            parseFloat(e.detail.value || '0')
                          )
                        }
                        min="0"
                      />
                    </IonCol>
                    <IonCol size="2">
                      <IonInput
                        type="number"
                        value={String(lineItem.unitPrice ?? 0)}
                        onIonInput={(e) =>
                          updateLineItem(
                            itemIndex,
                            lineItemIndex,
                            'unitPrice',
                            parseFloat(e.detail.value || '0')
                          )
                        }
                        min="0"
                        step="0.01"
                      />
                    </IonCol>
                    <IonCol size="2" className="total-col">
                      ₹{calculateLineItemTotal(lineItem).toFixed(2)}
                    </IonCol>
                    <IonCol size="1">
                      <IonButton
                        fill="clear"
                        color="danger"
                        size="small"
                        onClick={() => removeLineItem(itemIndex, lineItemIndex)}
                      >
                        <IonIcon icon={trashSharp} slot="icon-only" />
                      </IonButton>
                    </IonCol>
                  </IonRow>
                ))}
              </IonGrid>
            </div>

            <IonButton
              fill="outline"
              size="small"
              onClick={() => addLineItem(itemIndex)}
              className="add-line-item-btn"
            >
              <IonIcon icon={addSharp} slot="start" />
              Add Line Item
            </IonButton>

            <div className="item-subtotal">
              <strong>Section Subtotal:</strong> ₹{calculateItemSubtotal(item).toFixed(2)}
            </div>
          </div>
        ))}

        {/* Add Quote Item Button */}
        <IonButton fill="outline" onClick={addQuoteItem} className="add-section-btn">
          <IonIcon icon={addSharp} slot="start" />
          Add Section
        </IonButton>

        {/* Totals */}
        <div className="quote-totals">
          <div className="total-row">
            <span>Subtotal:</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>
          
          <div className="gst-section">
            <IonItem lines="none" className="gst-toggle">
              <IonLabel>Include GST</IonLabel>
              <IonToggle checked={localQuote.gstEnabled} onIonChange={toggleGST} />
            </IonItem>

            {localQuote.gstEnabled && (
              <IonItem lines="none" className="gst-percentage-input">
                <IonLabel position="stacked">GST Percentage (%)</IonLabel>
                <IonInput
                  type="number"
                  value={String(localQuote.gstPercentage || 18)}
                  onIonInput={(e) => {
                    const value = parseFloat(e.detail.value || '0');
                    if (!localQuote) return;
                    const updatedQuote = { ...localQuote };
                    updatedQuote.gstPercentage = value;
                    updatedQuote.gstAmount = calculateGST(updatedQuote.subtotal);
                    updatedQuote.total = calculateTotal(updatedQuote.subtotal, updatedQuote.gstAmount);
                    updatedQuote.updatedAt = new Date();
                    setLocalQuote(updatedQuote);
                    onUpdate(updatedQuote);
                  }}
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g., 5, 18"
                />
              </IonItem>
            )}
          </div>

          {localQuote.gstEnabled && (
            <div className="total-row">
              <span>GST ({localQuote.gstPercentage}%):</span>
              <span>₹{gst.toFixed(2)}</span>
            </div>
          )}

          <div className="total-row grand-total">
            <span>Total:</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>

        {/* Delivery Timeline */}
        <div className="quote-section">
          <IonItem>
            <IonLabel position="stacked">Delivery Timeline</IonLabel>
            <IonInput
              value={localQuote.deliveryTimeline || ''}
              onIonInput={(e) => updateDeliveryTimeline(e.detail.value || '')}
              placeholder="e.g., 4-6 weeks from approval"
            />
          </IonItem>
        </div>

        {/* Terms and Conditions */}
        <div className="quote-section">
          <IonItem>
            <IonLabel position="stacked">Terms and Conditions</IonLabel>
            <IonTextarea
              value={localQuote.termsAndConditions || ''}
              onIonInput={(e) => updateTermsAndConditions(e.detail.value || '')}
              placeholder="Enter terms and conditions..."
              rows={5}
              autoGrow
            />
          </IonItem>
        </div>
      </IonCardContent>
    </IonCard>
  );
};

export default QuotePreview;

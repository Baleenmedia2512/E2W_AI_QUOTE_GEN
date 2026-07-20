/**
 * Meta Business Messaging Types
 *
 * Covers incoming webhook payloads from:
 *   - Instagram Direct Messages
 *   - Facebook Messenger
 *   - WhatsApp Business Cloud API
 *
 * The normalized form (MetaNotificationEvent) is what the Edge Function
 * broadcasts and what the frontend receives via Supabase Realtime.
 */

// ─── Platform ─────────────────────────────────────────────────────────────────

export type MetaPlatform = 'instagram' | 'facebook' | 'whatsapp';

// ─── Normalized event broadcast by the Edge Function ─────────────────────────

export interface MetaNotificationEvent {
  /** Platform that originated the message */
  platform: MetaPlatform;
  /** Platform-specific sender ID (PSID for FB/IG, phone number for WA) */
  senderId: string;
  /** Human-readable sender name (contact name or phone number) */
  senderName: string;
  /** Plain-text message body */
  messageText: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Platform message ID — used for deduplication */
  messageId: string;
}

// ─── Raw Meta webhook payload shapes (for documentation / future parsing) ─────

export interface MetaWebhookPayload {
  object: 'instagram' | 'page' | 'whatsapp_business_account';
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  time: number;
  /** Present for Instagram DM and Facebook Messenger */
  messaging?: MetaMessagingItem[];
  /** Present for WhatsApp Business Cloud */
  changes?: MetaChangeItem[];
}

export interface MetaMessagingItem {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
  };
}

export interface MetaChangeItem {
  field: string;
  value: MetaWhatsAppValue;
}

export interface MetaWhatsAppValue {
  messaging_product: 'whatsapp';
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: MetaWhatsAppMessage[];
}

export interface MetaWhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const META_PLATFORM_LABELS: Record<MetaPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook Messenger',
  whatsapp: 'WhatsApp',
};

/** Chakra UI color scheme per platform */
export const META_PLATFORM_COLORS: Record<MetaPlatform, string> = {
  instagram: 'purple',
  facebook: 'blue',
  whatsapp: 'green',
};

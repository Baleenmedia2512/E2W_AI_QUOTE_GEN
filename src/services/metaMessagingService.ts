/**
 * Meta Messaging Service — Frontend Supabase Realtime subscriber
 *
 * Subscribes to the Supabase Realtime Broadcast channel that the
 * Edge Function publishes to whenever a Meta webhook event arrives.
 *
 * Uses the existing `supabase` client from supabaseClient.ts — no new
 * connections, keys, or environment variables required.
 *
 * Usage:
 *   metaMessagingService.subscribe(handler)   // start listening
 *   metaMessagingService.unsubscribe()        // stop listening + cleanup
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { MetaNotificationEvent } from '../types/meta';

type NotificationHandler = (event: MetaNotificationEvent) => void;

const CHANNEL_NAME =
  (import.meta.env.VITE_META_REALTIME_CHANNEL as string | undefined) ??
  'meta:notifications:v1';

class MetaMessagingService {
  private channel: RealtimeChannel | null = null;
  private handler: NotificationHandler | null = null;

  /**
   * Subscribe to incoming Meta messages.
   * Calling subscribe() a second time silently replaces the previous subscription.
   */
  subscribe(onMessage: NotificationHandler): void {
    if (this.channel) {
      this.unsubscribe();
    }

    this.handler = onMessage;

    this.channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        'broadcast',
        { event: 'new_message' },
        ({ payload }: { payload: MetaNotificationEvent }) => {
          if (this.handler) {
            this.handler(payload);
          }
        },
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Meta notifications subscribed → channel "${CHANNEL_NAME}"`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Meta notifications channel error:', err);
        } else if (status === 'CLOSED') {
          console.log('ℹ️ Meta notifications channel closed');
        }
      });
  }

  /** Remove the channel subscription and release the reference. */
  unsubscribe(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.handler = null;
      console.log(`ℹ️ Meta notifications unsubscribed from "${CHANNEL_NAME}"`);
    }
  }

  /** True if an active subscription exists. */
  get isSubscribed(): boolean {
    return this.channel !== null;
  }
}

export const metaMessagingService = new MetaMessagingService();

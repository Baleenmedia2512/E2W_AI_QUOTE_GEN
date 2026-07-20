/**
 * useMetaNotifications — React hook
 *
 * Subscribes to the Supabase Realtime channel for incoming Meta Business
 * messages (Instagram DM, Facebook Messenger, WhatsApp) and:
 *   1. Plays a notification sound (MP3 if available, synthesized beep fallback)
 *   2. Shows a Chakra UI toast at the top-right with platform, sender, and preview
 *
 * Mount once in App.tsx — it self-manages subscription lifecycle.
 *
 * Sound notes:
 *   - Browsers block audio until the user has interacted with the page.
 *     The hook tracks the first interaction and only attempts playback after.
 *   - To use a custom sound, place an MP3 at `public/sounds/notification.mp3`.
 *     If the file is absent the hook falls back to a synthesized two-tone beep.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@chakra-ui/react';
import { metaMessagingService } from '../services/metaMessagingService';
import { MetaNotificationEvent, META_PLATFORM_LABELS } from '../types/meta';

// ─── Audio Utilities ──────────────────────────────────────────────────────────

/**
 * Synthesize a short two-tone notification beep using the Web Audio API.
 * Works without any audio file and respects the browser's AudioContext rules.
 */
function playSynthesizedBeep(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();

    // Resume context in case it was suspended by autoplay policy
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    // Descending pitch: 880 Hz → 440 Hz over 280 ms
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.28);

    gainNode.gain.setValueAtTime(0.25, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.35);
    oscillator.onended = () => ctx.close();
  } catch (err) {
    console.warn('useMetaNotifications: could not play synthesized beep', err);
  }
}

/**
 * Attempt to play `public/sounds/notification.mp3`.
 * Falls back to synthesized beep if the file is missing or playback is blocked.
 */
function playNotificationSound(): void {
  try {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.7;
    audio
      .play()
      .catch(() => playSynthesizedBeep());
  } catch {
    playSynthesizedBeep();
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMetaNotifications(): void {
  const toast = useToast();
  /** Tracks whether the user has interacted with the page (required for audio). */
  const hasInteracted = useRef<boolean>(false);

  // Mark interaction on first click or keypress
  useEffect(() => {
    const markInteracted = (): void => {
      hasInteracted.current = true;
    };

    window.addEventListener('click', markInteracted, { once: true });
    window.addEventListener('keydown', markInteracted, { once: true });
    window.addEventListener('touchstart', markInteracted, { once: true });

    return () => {
      window.removeEventListener('click', markInteracted);
      window.removeEventListener('keydown', markInteracted);
      window.removeEventListener('touchstart', markInteracted);
    };
  }, []);

  // Handle incoming Meta messages
  const handleMessage = useCallback(
    (event: MetaNotificationEvent): void => {
      const platformLabel = META_PLATFORM_LABELS[event.platform] ?? event.platform;

      // Play sound only after the user has interacted with the page
      if (hasInteracted.current) {
        playNotificationSound();
      }

      const preview =
        event.messageText.length > 80
          ? `${event.messageText.slice(0, 80)}…`
          : event.messageText;

      toast({
        title: `New ${platformLabel} Message`,
        description: `${event.senderName}: ${preview}`,
        status: 'info',
        duration: 7000,
        isClosable: true,
        position: 'top-right',
      });

      console.log(
        `🔔 ${platformLabel} message from "${event.senderName}": "${preview}"`,
      );
    },
    [toast],
  );

  // Subscribe on mount, unsubscribe on unmount
  useEffect(() => {
    metaMessagingService.subscribe(handleMessage);

    return () => {
      metaMessagingService.unsubscribe();
    };
  }, [handleMessage]);
}

# Notification Sounds

Place a custom notification sound file here named exactly:

    notification.mp3

## Requirements

- Format: MP3 (best cross-browser support)
- Duration: 0.3 – 1.0 seconds recommended
- File size: keep under 50 KB for fast loading

## Behaviour

The `useMetaNotifications` hook loads `/sounds/notification.mp3` at runtime.

- **If the file exists** — it is played at 70% volume when a Meta message arrives.
- **If the file is absent or playback fails** — the hook automatically falls back to
  a programmatically synthesized two-tone beep (880 Hz → 440 Hz, ~350 ms) using
  the Web Audio API. No audio file is required for the feature to work.

## Browser Autoplay Policy

Browsers block audio playback until the user has clicked or pressed a key on the
page at least once. The hook handles this gracefully: it tracks the first
interaction and only attempts playback after that point. Before the first
interaction, a visual Chakra UI toast is still shown.

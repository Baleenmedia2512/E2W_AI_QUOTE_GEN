/** Emergency kill-switch. Default on. Set VITE_USE_NEW_CHAT_ENGINE=false only to disable golden-rule routing. */
export const USE_NEW_CHAT_ENGINE =
  import.meta.env.VITE_USE_NEW_CHAT_ENGINE !== 'false';

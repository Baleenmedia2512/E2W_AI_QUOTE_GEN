import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import App from './App';
import theme from './theme';
import './styles/global.css';
import './styles/mobileChat.css';
import AIClient from 'ai-token-monitor';

import packageJson from '../package.json';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

AIClient.initialize({
  baseURL: import.meta.env.VITE_AI_MONITOR_BASE_URL || "http://localhost:5000/api",
  sdkKey: import.meta.env.VITE_AI_MONITOR_SDK_KEY || "sdk_b41a73d8e9c402a5f17d23a10e7b998f48c32d1e0a96f3b2",
  token: import.meta.env.VITE_AI_MONITOR_TOKEN || "",
  appName: "QuoteBuddy",
  appVersion: packageJson.version || "1.0.0",
  environment: isLocalhost ? "localhost" : "production"
});

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <ColorModeScript initialColorMode={theme.config.initialColorMode} />
    <ChakraProvider theme={theme}>
      <App />
    </ChakraProvider>
  </React.StrictMode>
);

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.baleenmedia.quotegen',
  appName: 'AI Quote Generator',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Filesystem: {
      androidDisplayName: 'Quote Files'
    }
  }
};

export default config;

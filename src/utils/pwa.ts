// Service Worker Registration
export const registerServiceWorker = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      });

      console.log('Service Worker registered successfully:', registration);

      // Check for updates periodically
      setInterval(() => {
        registration.update();
      }, 60000); // Check every minute

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              if (confirm('New version available! Reload to update?')) {
                window.location.reload();
              }
            }
          });
        }
      });

      return Promise.resolve();
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return Promise.reject(error);
    }
  } else {
    console.warn('Service Workers are not supported in this browser');
    return Promise.reject(new Error('Service Workers not supported'));
  }
};

export const unregisterServiceWorker = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.unregister();
      console.log('Service Worker unregistered');
      return Promise.resolve();
    } catch (error) {
      console.error('Service Worker unregistration failed:', error);
      return Promise.reject(error);
    }
  }
  return Promise.resolve();
};

// Check if app is installed as PWA
export const isPWA = (): boolean => {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as any).standalone === true;
};

// Prompt user to install PWA
export const promptInstall = (): void => {
  let deferredPrompt: any;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show install button or prompt
    console.log('PWA install prompt available');
    
    // You can trigger this from a button click
    const installButton = document.getElementById('pwa-install-button');
    if (installButton) {
      installButton.style.display = 'block';
      installButton.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User response to install prompt: ${outcome}`);
          deferredPrompt = null;
          installButton.style.display = 'none';
        }
      });
    }
  });
};

// Track PWA installation
export const trackPWAInstall = (): void => {
  window.addEventListener('appinstalled', () => {
    console.log('PWA was installed');
    // Track installation analytics
  });
};

// Request persistent storage
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.log(`Persistent storage granted: ${isPersisted}`);
    return isPersisted;
  }
  return false;
};

// Check storage quota
export const checkStorageQuota = async (): Promise<{ usage: number; quota: number; percentage: number }> => {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;
    
    console.log(`Storage used: ${(usage / 1024 / 1024).toFixed(2)} MB of ${(quota / 1024 / 1024).toFixed(2)} MB (${percentage.toFixed(2)}%)`);
    
    return { usage, quota, percentage };
  }
  return { usage: 0, quota: 0, percentage: 0 };
};

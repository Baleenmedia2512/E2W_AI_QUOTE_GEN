// Service Worker Registration - Enhanced with update detection
export const registerServiceWorker = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      });

      console.log('✅ Service Worker registered successfully:', registration);

      // Check for updates every 30 seconds (reduced from 1 minute)
      setInterval(() => {
        registration.update();
      }, 30000);

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('🔄 New version available!');
              
              // Show update notification
              showUpdateNotification(() => {
                // Tell new service worker to skip waiting
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              });
            }
          });
        }
      });

      // Listen for service worker messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SW_ACTIVATED') {
          console.log(`✅ Service Worker activated (v${event.data.version})`);
          
          // Show success notification
          const notification = document.createElement('div');
          notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: system-ui;
          `;
          notification.textContent = `✅ Updated to v${event.data.version}`;
          document.body.appendChild(notification);
          
          setTimeout(() => notification.remove(), 3000);
        }
      });

      return Promise.resolve();
    } catch (error) {
      console.error('❌ Service Worker registration failed:', error);
      return Promise.reject(error);
    }
  } else {
    console.warn('⚠️ Service Workers are not supported in this browser');
    return Promise.reject(new Error('Service Workers not supported'));
  }
};

// Show update notification to user
const showUpdateNotification = (onUpdate: () => void): void => {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px 24px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    z-index: 10000;
    font-family: system-ui;
    max-width: 350px;
    animation: slideIn 0.3s ease-out;
  `;
  
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="font-size: 24px;">🔄</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">New Version Available!</div>
        <div style="font-size: 14px; opacity: 0.9;">Update now to get the latest features</div>
      </div>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button id="update-now-btn" style="
        flex: 1;
        background: white;
        color: #667eea;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
      ">Update Now</button>
      <button id="update-later-btn" style="
        flex: 1;
        background: rgba(255,255,255,0.2);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
      ">Later</button>
    </div>
  `;
  
  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  // Handle update button
  document.getElementById('update-now-btn')?.addEventListener('click', () => {
    onUpdate();
    notification.remove();
    // Show loading
    const loading = document.createElement('div');
    loading.style.cssText = notification.style.cssText;
    loading.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">⏳</div>
        <div style="font-weight: 600;">Updating...</div>
      </div>
    `;
    document.body.appendChild(loading);
    setTimeout(() => window.location.reload(), 500);
  });
  
  // Handle later button
  document.getElementById('update-later-btn')?.addEventListener('click', () => {
    notification.remove();
  });
  
  // Auto-dismiss after 30 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.remove();
    }
  }, 30000);
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

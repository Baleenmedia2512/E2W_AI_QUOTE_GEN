// Service Worker for Quote Buddy PWA - Enhanced with versioning
const APP_VERSION = '1.0.0'; // Auto-updated by build process
const BUILD_TIMESTAMP = Date.now();
const CACHE_NAME = `ai-quote-gen-v${APP_VERSION}-${BUILD_TIMESTAMP}`;
const RUNTIME_CACHE = `runtime-v${APP_VERSION}`;
const CACHE_MAX_AGE = 3600000; // 1 hour in milliseconds

// Resources to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html'
];

// Install event - cache essential resources and skip waiting
self.addEventListener('install', (event) => {
  console.log(`🔧 Service Worker installing... (v${APP_VERSION})`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('✅ Service Worker installed, skipping waiting');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log(`🚀 Service Worker activating... (v${APP_VERSION})`);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            // Delete all caches that don't match current version
            const isCurrentCache = cacheName === CACHE_NAME || cacheName === RUNTIME_CACHE;
            if (!isCurrentCache) {
              console.log('🗑️ Deleting old cache:', cacheName);
            }
            return !isCurrentCache;
          })
          .map(cacheName => caches.delete(cacheName))
      );
    })
    .then(() => {
      console.log('✅ Service Worker activated, claiming clients');
      return self.clients.claim(); // Take control immediately
    })
    .then(() => {
      // Notify all clients about the update
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: APP_VERSION,
            timestamp: BUILD_TIMESTAMP
          });
        });
      });
    })
  );
});

// Fetch event - Network-first with cache fallback
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  
  // API requests - always network-first, no caching
  if (url.pathname.includes('/api/') || url.pathname.includes('supabase')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For app shell (HTML, JS, CSS) - Network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Check if valid response
        if (!response || response.status !== 200) {
          return response;
        }

        // Clone and cache the response
        const responseToCache = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => {
          cache.put(event.request, responseToCache);
        });

        return response;
      })
      .catch(error => {
        // Network failed, try cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            console.log('📦 Serving from cache (offline):', event.request.url);
            return cachedResponse;
          }

          // No cache, return offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html').then(offlineResponse => {
              return offlineResponse || new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
          }

          // For other requests, just fail
          return new Response('Network error', {
            status: 408,
            statusText: 'Network error'
          });
        });
      })
  );
});

// Background sync for offline quote submissions
self.addEventListener('sync', (event) => {
  console.log('Background sync event:', event.tag);
  
  if (event.tag === 'sync-quotes') {
    event.waitUntil(syncQuotes());
  }
});

async function syncQuotes() {
  try {
    // Retrieve pending quotes from IndexedDB and sync
    console.log('Syncing pending quotes...');
    // Implementation would go here
    return Promise.resolve();
  } catch (error) {
    console.error('Sync failed:', error);
    return Promise.reject(error);
  }
}

// Push notification support (optional)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('Quote Buddy', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  event.notification.close();

  event.waitUntil(
    clients.openWindow('/')
  );
});

// Message handler for communication with clients
self.addEventListener('message', (event) => {
  console.log('📨 Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CHECK_VERSION') {
    event.ports[0].postMessage({
      version: APP_VERSION,
      timestamp: BUILD_TIMESTAMP,
      cacheName: CACHE_NAME
    });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

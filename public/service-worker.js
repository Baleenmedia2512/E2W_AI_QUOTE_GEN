// Service Worker for AI Quote Generator PWA
const CACHE_NAME = 'ai-quote-gen-v1';
const RUNTIME_CACHE = 'runtime-cache-v1';

// Resources to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache essential resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
          })
          .map(cacheName => {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache when offline, with network fallback
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Return cached response and update cache in background
        fetchAndCache(event.request);
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetchAndCache(event.request);
    })
  );
});

// Helper function to fetch and cache
function fetchAndCache(request) {
  return fetch(request).then(response => {
    // Check if valid response
    if (!response || response.status !== 200 || response.type === 'error') {
      return response;
    }

    // Clone the response
    const responseToCache = response.clone();

    // Cache the fetched response
    caches.open(RUNTIME_CACHE).then(cache => {
      cache.put(request, responseToCache);
    });

    return response;
  }).catch(error => {
    console.error('Fetch failed:', error);
    
    // Return offline page if available
    return caches.match('/offline.html').then(offlineResponse => {
      return offlineResponse || new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable'
      });
    });
  });
}

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
    self.registration.showNotification('AI Quote Generator', options)
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

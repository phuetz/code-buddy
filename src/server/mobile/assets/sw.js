/**
 * Code Buddy Mobile PWA - Service Worker
 * Minimal cache-only strategy for offline support
 */

const CACHE_NAME = 'codebuddy-mobile-v2';
const ASSETS_TO_CACHE = [
  '/__codebuddy__/mobile/',
  '/__codebuddy__/mobile/manifest.webmanifest',
  '/__codebuddy__/mobile/sw.js',
  '/__codebuddy__/mobile/assets/index.html',
  '/__codebuddy__/mobile/assets/styles.css',
  '/__codebuddy__/mobile/assets/app.js',
  '/__codebuddy__/mobile/assets/icon.svg',
  '/__codebuddy__/mobile/assets/icon-96.png',
  '/__codebuddy__/mobile/assets/icon-192.png',
  '/__codebuddy__/mobile/assets/icon-512.png'
];

// Cache assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching assets');
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => undefined)),
      ).then(() => self.skipWaiting());
    })
  );
});

// Serve from cache (cache-only strategy)
self.addEventListener('fetch', (event) => {
  // Only intercept requests within our scope
  if (event.request.url.includes('/__codebuddy__/mobile/')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          console.log('Service Worker: Serving from cache:', event.request.url);
          return response;
        }
        
        // Fallback to network
        console.log('Service Worker: Fetching from network:', event.request.url);
        return fetch(event.request).then((response) => {
          // Don't cache API calls or WebSocket connections
          if (!event.request.url.includes('/api/') && 
              !event.request.url.includes('/ws') &&
              !event.request.url.includes('/__codebuddy__/mobile/health')) {
            // Cache new assets
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        });
      })
    );
  }
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      console.log('Service Worker: Old caches cleaned up');
      return self.clients.claim();
    })
  );
});

// Handle push notifications (if enabled in the future)
self.addEventListener('push', (event) => {
  if (!self.registration.showNotification) {
    console.log('Service Worker: Push notifications not supported');
    return;
  }
  
  const data = event.data?.json();
  const title = data?.title || 'Code Buddy';
  const options = {
    body: data?.body || 'Nouvelle notification',
    icon: '/__codebuddy__/mobile/assets/icon-192.png',
    badge: '/__codebuddy__/mobile/assets/icon-72.png',
    data: data?.data || {}
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const notificationData = event.notification.data;
  const urlToOpen = notificationData.url || '/__codebuddy__/mobile/';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes('/__codebuddy__/mobile/') && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Handle background sync (if needed in the future)
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered:', event.tag);
  // Could implement sync logic for offline actions
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('Service Worker: Periodic sync triggered:', event.tag);
});

// Log service worker lifecycle events
self.addEventListener('install', () => console.log('Service Worker: Install'));
self.addEventListener('activate', () => console.log('Service Worker: Activate'));
self.addEventListener('fetch', () => {}); // Already handled above
self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received:', event.data);
});

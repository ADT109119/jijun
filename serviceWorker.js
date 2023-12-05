// 當service worker在「安裝階段」時會觸發此事件
self.addEventListener('install', function(event) {
    console.log('[Service Worker] Installing Service Worker ...', event);
});

// 當service worker在「激活階段」時會觸發此事件
self.addEventListener('activate', function(event) {
    console.log('[Service Worker] Activating Service Worker ...', event);
    return self.clients.claim();   // 加上這行是為了確保service worker被正確載入和激活，不加也行
});

self.addEventListener('fetch', function(event) {
    console.log('[Service Worker] Fetch something ...', event);
    event.respondWith(fetch(event.request));
});
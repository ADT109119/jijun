// 現代化 Service Worker
const CACHE_NAME = 'easy-accounting-v2.0.0'
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
]

// 安裝事件
self.addEventListener('install', event => {
  console.log('Service Worker 安裝中...')
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('快取檔案中...')
        return cache.addAll(urlsToCache)
      })
      .then(() => {
        console.log('Service Worker 安裝完成')
        return self.skipWaiting()
      })
  )
})

// 啟用事件
self.addEventListener('activate', event => {
  console.log('Service Worker 啟用中...')
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('刪除舊快取:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    }).then(() => {
      console.log('Service Worker 啟用完成')
      return self.clients.claim()
    })
  )
})

// 攔截請求
self.addEventListener('fetch', event => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') {
    return
  }

  // 跳過 Chrome 擴充功能和其他協議的請求
  if (!event.request.url.startsWith('http')) {
    return
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果在快取中找到，直接返回
        if (response) {
          return response
        }

        // 否則從網路獲取
        return fetch(event.request).then(response => {
          // 檢查是否為有效回應
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response
          }

          // 複製回應以便快取
          const responseToCache = response.clone()

          caches.open(CACHE_NAME)
            .then(cache => {
              // 只快取同源請求
              if (event.request.url.startsWith(self.location.origin)) {
                cache.put(event.request, responseToCache)
              }
            })

          return response
        }).catch(() => {
          // 網路失敗時，嘗試返回離線頁面
          if (event.request.destination === 'document') {
            return caches.match('/index.html')
          }
        })
      })
  )
})

// 處理訊息
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// 推送通知（未來功能）
self.addEventListener('push', event => {
  if (event.data) {
    const options = {
      body: event.data.text(),
      icon: '/icon/icon.png',
      badge: '/icon/icon.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      }
    }

    event.waitUntil(
      self.registration.showNotification('輕鬆記帳', options)
    )
  }
})

// 通知點擊處理
self.addEventListener('notificationclick', event => {
  console.log('通知被點擊:', event.notification.tag)
  event.notification.close()

  event.waitUntil(
    clients.openWindow('/')
  )
})
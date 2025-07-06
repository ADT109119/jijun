// 現代化 Service Worker
const APP_VERSION = '2.0.4.2' // 每次更新時增加版本號
const CACHE_NAME = `easy-accounting-v${APP_VERSION}`
const STATIC_CACHE = `static-v${APP_VERSION}`
const DYNAMIC_CACHE = `dynamic-v${APP_VERSION}`

// 需要預先快取的核心檔案
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/css/main.css',
  '/src/js/main.js',
  '/src/js/dataService.js',
  '/src/js/utils.js',
  '/src/js/categories.js'
]

// 需要網路優先的檔案（經常變動）
const networkFirstUrls = [
  '/src/js/',
  '/src/css/',
  '/api/'
]

// 快取優先的檔案（靜態資源）
const cacheFirstUrls = [
  '/icon/',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.woff',
  '.woff2'
]

// 安裝事件
self.addEventListener('install', event => {
  console.log(`Service Worker v${APP_VERSION} 安裝中...`)
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('快取核心檔案中...')
        return cache.addAll(urlsToCache.map(url => {
          // 為每個 URL 添加版本參數以強制更新
          return new Request(url, { cache: 'reload' })
        }))
      })
      .then(() => {
        console.log(`Service Worker v${APP_VERSION} 安裝完成`)
        // 強制跳過等待，立即激活新版本
        return self.skipWaiting()
      })
      .catch(error => {
        console.error('Service Worker 安裝失敗:', error)
      })
  )
})

// 啟用事件
self.addEventListener('activate', event => {
  console.log(`Service Worker v${APP_VERSION} 啟用中...`)
  
  event.waitUntil(
    Promise.all([
      // 清理舊版本快取
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // 刪除所有不是當前版本的快取
            if (!cacheName.includes(APP_VERSION)) {
              console.log('刪除舊快取:', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      }),
      // 立即控制所有客戶端
      self.clients.claim()
    ]).then(() => {
      console.log(`Service Worker v${APP_VERSION} 啟用完成`)
      
      // 通知所有客戶端更新完成
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: APP_VERSION
          })
          // 同時發送版本資訊
          client.postMessage({
            type: 'VERSION_INFO',
            version: APP_VERSION
          })
        })
      })
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

  const url = new URL(event.request.url)
  
  // 判斷快取策略
  if (shouldUseNetworkFirst(url.pathname)) {
    // 網路優先策略（用於經常變動的檔案）
    event.respondWith(networkFirst(event.request))
  } else if (shouldUseCacheFirst(url.pathname)) {
    // 快取優先策略（用於靜態資源）
    event.respondWith(cacheFirst(event.request))
  } else {
    // 預設：快取優先，網路備用
    event.respondWith(cacheFirst(event.request))
  }
})

// 判斷是否使用網路優先策略
function shouldUseNetworkFirst(pathname) {
  return networkFirstUrls.some(pattern => pathname.includes(pattern))
}

// 判斷是否使用快取優先策略
function shouldUseCacheFirst(pathname) {
  return cacheFirstUrls.some(pattern => pathname.includes(pattern))
}

// 網路優先策略
async function networkFirst(request) {
  try {
    // 先嘗試從網路獲取
    const networkResponse = await fetch(request)
    
    if (networkResponse && networkResponse.status === 200) {
      // 成功獲取，更新快取
      const cache = await caches.open(DYNAMIC_CACHE)
      cache.put(request, networkResponse.clone())
      return networkResponse
    }
  } catch (error) {
    console.log('網路請求失敗，嘗試從快取獲取:', request.url)
  }
  
  // 網路失敗，從快取獲取
  const cachedResponse = await caches.match(request)
  if (cachedResponse) {
    return cachedResponse
  }
  
  // 如果是頁面請求且快取中沒有，返回離線頁面
  if (request.destination === 'document') {
    return caches.match('/index.html')
  }
  
  // 其他情況返回網路錯誤
  return new Response('離線狀態，無法載入資源', {
    status: 503,
    statusText: 'Service Unavailable'
  })
}

// 快取優先策略
async function cacheFirst(request) {
  // 先從快取獲取
  const cachedResponse = await caches.match(request)
  if (cachedResponse) {
    return cachedResponse
  }
  
  try {
    // 快取中沒有，從網路獲取
    const networkResponse = await fetch(request)
    
    if (networkResponse && networkResponse.status === 200) {
      // 成功獲取，存入快取
      const cache = await caches.open(DYNAMIC_CACHE)
      
      // 只快取同源請求
      if (request.url.startsWith(self.location.origin)) {
        cache.put(request, networkResponse.clone())
      }
      
      return networkResponse
    }
    
    return networkResponse
  } catch (error) {
    console.log('網路和快取都失敗:', request.url)
    
    // 如果是頁面請求，返回離線頁面
    if (request.destination === 'document') {
      return caches.match('/index.html')
    }
    
    return new Response('資源無法載入', {
      status: 503,
      statusText: 'Service Unavailable'
    })
  }
}

// 處理訊息
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    // 回應版本資訊請求
    event.ports[0]?.postMessage({
      type: 'VERSION_INFO',
      version: APP_VERSION
    }) || event.source?.postMessage({
      type: 'VERSION_INFO',
      version: APP_VERSION
    })
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
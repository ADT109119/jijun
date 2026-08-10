// 現代化 Service Worker
// 使用統一的版本號和快取名稱
const APP_VERSION = '2.1.7.2' // 版本號，2.1.2.3 版後在 build 時自動注入 package.json 的版本號
const CACHE_NAME = self.CACHE_NAMES?.main || `easy-accounting-v${APP_VERSION}`
const STATIC_CACHE = self.CACHE_NAMES?.static || `static-v${APP_VERSION}`
const DYNAMIC_CACHE = self.CACHE_NAMES?.dynamic || `dynamic-v${APP_VERSION}`

// 需要預先快取的核心檔案
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon/icon.png',
    '/icon/icon-512.png',
    '/widgets/template.json',
    '/widgets/data.json',
]

// 需要網路優先的檔案（經常變動）
const networkFirstUrls = [
    // '/src/js/',
    // '/src/css/',
    // '/api/'
]

// 快取優先的檔案（靜態資源）
const cacheFirstUrls = [
    '/icon/',
    '.png',
    '.jpg',
    '.jpeg',
    '.svg',
    '.woff',
    '.woff2',
]

// 安裝事件
self.addEventListener('install', event => {
    console.log(`Service Worker v${APP_VERSION} 安裝中...`)

    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then(cache => {
                console.log('快取核心檔案中...')
                return cache.addAll(
                    urlsToCache.map(url => {
                        // 為每個 URL 添加版本參數以強制更新
                        return new Request(url, { cache: 'reload' })
                    })
                )
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
            self.clients.claim(),
            // 啟用時更新所有小工具
            updateAllWidgets(),
        ]).then(() => {
            console.log(`Service Worker v${APP_VERSION} 啟用完成`)

            // 通知所有客戶端更新完成
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_UPDATED',
                        version: APP_VERSION,
                    })
                    // 同時發送版本資訊
                    client.postMessage({
                        type: 'VERSION_INFO',
                        version: APP_VERSION,
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
        statusText: 'Service Unavailable',
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
            statusText: 'Service Unavailable',
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
            version: APP_VERSION,
        }) ||
            event.source?.postMessage({
                type: 'VERSION_INFO',
                version: APP_VERSION,
            })
    }

    // Handle Local PWA Notification Scheduling
    if (event.data && event.data.type === 'SCHEDULE_REMINDER') {
        const { title, body, timestamp } = event.data.payload

        // Try to use experimental TimestampTrigger for offline scheduling
        if ('showTrigger' in Notification.prototype) {
            self.registration
                .showNotification(title, {
                    tag: 'daily-reminder',
                    body: body,
                    icon: '/icon/icon-192x192.png',
                    showTrigger: new TimestampTrigger(timestamp),
                })
                .catch(err =>
                    console.error(
                        'Failed to schedule via TimestampTrigger:',
                        err
                    )
                )
        } else {
            // Fallback: If browser doesn't support offline triggers, we just
            // set a timeout. This only works reliably while the browser/SW is kept alive.
            const delay = timestamp - Date.now()
            if (delay > 0) {
                // Clear previous fallback timeout if exists
                if (self.reminderTimeout) clearTimeout(self.reminderTimeout)

                self.reminderTimeout = setTimeout(() => {
                    self.registration.showNotification(title, {
                        tag: 'daily-reminder',
                        body: body,
                        icon: '/icon/icon-192x192.png',
                    })
                }, delay)
            }
        }
    }

    if (event.data && event.data.type === 'CANCEL_REMINDER') {
        self.registration
            .getNotifications({ tag: 'daily-reminder' })
            .then(notifications => {
                notifications.forEach(n => n.close())
            })
        if (self.reminderTimeout) {
            clearTimeout(self.reminderTimeout)
            self.reminderTimeout = null
        }
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
                primaryKey: 1,
            },
        }

        event.waitUntil(self.registration.showNotification('輕鬆記帳', options))
    }
})

// 通知點擊處理
self.addEventListener('notificationclick', event => {
    console.log('通知被點擊:', event.notification.tag)
    event.notification.close()

    event.waitUntil(clients.openWindow('/'))
})

// === Microsoft Edge PWA Widget Background Handling ===

// Helper to query IndexedDB for today's totals
function getTodayTotal() {
    return new Promise(resolve => {
        // Open without version parameter to automatically use the latest active DB version
        const request = indexedDB.open('EasyAccountingDB')
        request.onerror = () => resolve({ income: 0, expense: 0 })
        request.onsuccess = event => {
            const db = event.target.result
            if (!db.objectStoreNames.contains('records')) {
                resolve({ income: 0, expense: 0 })
                return
            }
            try {
                const transaction = db.transaction('records', 'readonly')
                const store = transaction.objectStore('records')

                // Use local timezone instead of UTC to avoid early morning widget calculations showing yesterday's data
                const d = new Date()
                const year = d.getFullYear()
                const month = String(d.getMonth() + 1).padStart(2, '0')
                const date = String(d.getDate()).padStart(2, '0')
                const todayStr = `${year}-${month}-${date}`

                let income = 0
                let expense = 0

                const cursorRequest = store.openCursor()
                cursorRequest.onsuccess = e => {
                    const cursor = e.target.result
                    if (cursor) {
                        const record = cursor.value
                        if (record.date === todayStr) {
                            const amount = parseFloat(record.amount) || 0
                            if (record.type === 'income') {
                                income += amount
                            } else if (record.type === 'expense') {
                                expense += amount
                            }
                        }
                        cursor.continue()
                    } else {
                        resolve({ income, expense })
                    }
                }
                cursorRequest.onerror = () => resolve({ income: 0, expense: 0 })
            } catch (err) {
                console.error('Error querying IndexedDB in SW:', err)
                resolve({ income: 0, expense: 0 })
            }
        }
    })
}

// Helper to update widget by instance ID or tag
async function updateWidgetInstance(instanceId, tag) {
    if (!self.widgets) return
    try {
        // Fetch the Adaptive Card template
        const templateResponse = await fetch('/widgets/template.json')
        const templateText = await templateResponse.text()

        // Query today's totals
        const total = await getTodayTotal()
        const dataText = JSON.stringify({
            expense: total.expense.toLocaleString('zh-TW'),
            income: total.income.toLocaleString('zh-TW'),
        })

        // Update widget using standard Adaptive Card payload (must be stringified JSON)
        if (instanceId) {
            await self.widgets.updateByInstanceId(instanceId, {
                template: templateText,
                data: dataText,
            })
            console.log(`Widget instance ${instanceId} updated successfully.`)
        } else if (tag) {
            await self.widgets.updateByTag(tag, {
                template: templateText,
                data: dataText,
            })
            console.log(`Widget tag ${tag} updated successfully.`)
        }
    } catch (err) {
        console.error(`Failed to update widget:`, err)
    }
}

// Helper to update all installed widgets
async function updateAllWidgets() {
    if (!self.widgets) return
    try {
        const widgets = await self.widgets.matchAll({ installed: true })
        for (const widget of widgets) {
            for (const instance of widget.instances) {
                await updateWidgetInstance(instance.id)
            }
        }
    } catch (err) {
        console.error('Failed to update all widgets:', err)
    }
}

// Widget lifecycle events
self.addEventListener('widgetinstall', event => {
    const tag = event.widget?.definition?.tag || 'easy-accounting-widget'
    event.waitUntil(updateWidgetInstance(event.instanceId, tag))
})

self.addEventListener('widgetuninstall', event => {
    console.log(`Widget ${event.instanceId} uninstalled.`)
})

self.addEventListener('widgetclick', event => {
    if (event.action === 'refresh' || event.verb === 'refresh') {
        event.waitUntil(updateWidgetInstance(event.instanceId))
    }
})

// Listen to periodicsync events to update all widget instances periodically.
self.addEventListener('periodicsync', event => {
    event.waitUntil(updateWidgetInstance(null, event.tag))
})

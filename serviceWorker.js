// 現代化 Service Worker（v2：precache + opaque cache-first）
// 使用統一的版本號和 build hash 命名快取
const APP_VERSION = '2.1.7.6' // build 時自動注入 package.json 的版本號
const BUILD_HASH = 'f4b0d1f4' // build 時自動注入（assets 清單的 hash；dev 模式固定 'dev'）

// 快取命名帶 BUILD_HASH：新 build 的 SW 用新快取，舊快取在 activate 時清理
const APP_CACHE = `app-v${APP_VERSION}-${BUILD_HASH}` // install 時的 precache（本機 assets + 核心 + CDN）
const DYNAMIC_CACHE = `dynamic-v${APP_VERSION}-${BUILD_HASH}` // 執行期快取

// 核心檔案（本機伺服）
const CORE_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon/icon.png',
    '/icon/icon-512.png',
    '/widgets/template.json',
    '/widgets/data.json',
]

// 外部 CDN 資源（cross-origin → opaque 回應，cache.put 仍可儲存）
// 批次 2 後為空：Tailwind 已改 PostCSS 本地 build（CSS 進 /assets/* 被 precache）。
// 僅剩 Google OAuth/Drive（accounts.google.com/apis.google.com）在 index.html，
// 但那是登入/同步功能才動的、不屬首屏關鍵資源，不需 precache。
const CDN_URLS = []

// 安裝事件：per-URL precache（單一資源失敗不讓整個 SW 安裝失敗）
self.addEventListener('install', event => {
    console.log(`Service Worker v${APP_VERSION} (build ${BUILD_HASH}) 安裝中...`)

    event.waitUntil(
        (async () => {
            const cache = await caches.open(APP_CACHE)

            // 1) 本機 build assets（dist/precachemanifest.json，由 vite plugin 生成；dev 模式不存在 → 空）
            let assetUrls = []
            try {
                const r = await fetch('/precachemanifest.json', { cache: 'no-cache' })
                if (r.ok) assetUrls = (await r.json()).assets || []
            } catch (e) {
                // dev 或 manifest 不可用：只預快取 CORE + CDN
            }

            // 2) 逐 URL put（cross-origin 沒有 CORS header 時回應是 opaque，仍可入快取）
            const put = async url => {
                try {
                    await cache.put(url, await fetch(url, { cache: 'no-cache' }))
                } catch (err) {
                    console.warn('precache 失敗（首次使用會走網路）:', url)
                }
            }
            await Promise.all(
                [...CORE_URLS, ...assetUrls, ...CDN_URLS].map(put)
            )

            console.log(
                `Service Worker v${APP_VERSION} (build ${BUILD_HASH}) 安裝完成（${assetUrls.length} 個本機 assets）`
            )
            // 強制跳過等待，立即激活新版本
            return self.skipWaiting()
        })()
    )
})

// 啟用事件
self.addEventListener('activate', event => {
    console.log(`Service Worker v${APP_VERSION} (build ${BUILD_HASH}) 啟用中...`)

    event.waitUntil(
        Promise.all([
            // 清理舊版本快取
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== APP_CACHE && cacheName !== DYNAMIC_CACHE) {
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

    // 導覽請求（index.html / /）一律網路優先：
    // HTML 是入口，cache-first 會讓舊 SW 在更新後仍提供舊 index.html，
    // 載入舊 JS 開新版本 DB → VersionError → 資料「看似消失」的根因鏈之一。
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request))
        return
    }

    // 其他一切（本機 assets、CSS、CDN、字型）：cache-first。
    // cross-origin 的 opaque 回應（Tailwind CDN、FA 字型、Google Fonts woff2）
    // 首次載入即入快取 → 離線可活，不再受 HTTP cache TTL 限制。
    event.respondWith(cacheFirst(event.request))
})

// 網路優先策略（僅導覽請求用）
async function networkFirst(request) {
    try {
        // 先嘗試從網路獲取
        const networkResponse = await fetch(request)

        if (networkResponse && networkResponse.status === 200) {
            // 成功獲取，更新快取（只存同源）
            if (new URL(request.url).origin === self.location.origin) {
                const cache = await caches.open(DYNAMIC_CACHE)
                cache.put(request, networkResponse.clone())
            }
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

    // 如果是頁面請求且快取中沒有，返回離線頁面（precache 的 index.html）
    if (request.destination === 'document') {
        return caches.match('/index.html')
    }

    // 其他情況返回網路錯誤
    return new Response('離線狀態，無法載入資源', {
        status: 503,
        statusText: 'Service Unavailable',
    })
}

// 快取優先策略（其餘全部請求用）
async function cacheFirst(request) {
    // 先從快取獲取（opaque 回應也能 match 到）
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
        return cachedResponse
    }

    try {
        // 快取中沒有，從網路獲取
        const networkResponse = await fetch(request)

        // ok（同源）或 opaque（cross-origin 無 CORS）都入快取
        if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const cache = await caches.open(DYNAMIC_CACHE)
            cache.put(request, networkResponse.clone()).catch(() => {})
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
            // Fallback: In browsers without offline triggers, just
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
    console.log('通知點擊:', event.notification.tag)
    event.notification.close()

    event.waitUntil(clients.openWindow('/'))
})

// === Microsoft Edge PWA Widget Background Handling ===

// Helper: query IndexedDB for today's totals
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

// Helper: update widget by instance ID or tag
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

// Helper: update all installed widgets
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
    console.log(`Widget uninstalled:`, event.widget?.definition?.tag)
})

self.addEventListener('widgetclick', event => {
    if (event.action === 'refresh' || event.verb === 'refresh') {
        event.waitUntil(updateWidgetInstance(null, event.tag))
    }
})

// Listen to periodicsync events to update all widget instances periodically.
self.addEventListener('periodicsync', event => {
    event.waitUntil(updateWidgetInstance(null, event.tag))
})

// ==================== Service Worker 單元測試 ====================
// 驗證 Google Drive API / OAuth / 認證請求 / 跨域請求不被 Service Worker 快取，
// 並確保升級啟用時清理舊快取內殘留的跨域 / API 髒快取。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

function createSwHarness() {
    const listeners = {}
    const store = new Map() // cacheName -> Map<url, ResponseLike>

    const getBucket = name => {
        if (!store.has(name)) store.set(name, new Map())
        return store.get(name)
    }

    const cachesMock = {
        open: vi.fn(async name => {
            const bucket = getBucket(name)
            return {
                put: vi.fn(async (req, res) => {
                    const url = typeof req === 'string' ? req : req.url
                    bucket.set(url, res)
                }),
                delete: vi.fn(async req => {
                    const url = typeof req === 'string' ? req : req.url
                    return bucket.delete(url)
                }),
                keys: vi.fn(async () =>
                    [...bucket.keys()].map(url => ({ url }))
                ),
            }
        }),
        keys: vi.fn(async () => [...store.keys()]),
        delete: vi.fn(async name => store.delete(name)),
        match: vi.fn(async req => {
            const url = typeof req === 'string' ? req : req.url
            for (const bucket of store.values()) {
                if (bucket.has(url)) return bucket.get(url)
            }
            return undefined
        }),
    }

    const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        type: 'basic',
        clone() {
            return { ...this }
        },
    }))

    const selfObj = {
        location: { origin: 'https://jijun.the-walking-fish.com' },
        skipWaiting: vi.fn(async () => {}),
        clients: {
            claim: vi.fn(async () => {}),
            matchAll: vi.fn(async () => []),
        },
        addEventListener: vi.fn((type, handler) => {
            if (!listeners[type]) listeners[type] = []
            listeners[type].push(handler)
        }),
    }

    const context = vm.createContext({
        self: selfObj,
        caches: cachesMock,
        fetch: fetchMock,
        URL,
        Response,
        Headers,
        console: {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        setTimeout: (...args) => globalThis.setTimeout(...args),
        clearTimeout: (...args) => globalThis.clearTimeout(...args),
    })

    const swSource = readFileSync(
        resolve(process.cwd(), 'public/serviceWorker.js'),
        'utf-8'
    )
    vm.runInContext(swSource, context)

    const dispatchFetch = async ({
        url,
        method = 'GET',
        mode = 'cors',
        cache = 'default',
        headers = {},
        destination = '',
    }) => {
        const hdrs = new Headers(headers)
        let respondedPromise = null
        const waitPromises = []
        const event = {
            request: {
                url,
                method,
                mode,
                cache,
                destination,
                headers: hdrs,
            },
            respondWith: vi.fn(promise => {
                respondedPromise = Promise.resolve(promise)
            }),
            waitUntil: vi.fn(promise => {
                waitPromises.push(Promise.resolve(promise))
            }),
        }
        for (const handler of listeners.fetch || []) {
            handler(event)
        }
        const response = respondedPromise ? await respondedPromise : null
        return {
            event,
            response,
            waitPromises,
            intercepted: event.respondWith.mock.calls.length > 0,
        }
    }

    const dispatchActivate = async () => {
        const waits = []
        const event = {
            waitUntil: p => waits.push(p),
        }
        for (const handler of listeners.activate || []) {
            handler(event)
        }
        await Promise.all(waits)
    }

    return {
        store,
        cachesMock,
        fetchMock,
        dispatchFetch,
        dispatchActivate,
    }
}

describe('public/serviceWorker.js', () => {
    let harness

    beforeEach(() => {
        harness = createSwHarness()
    })

    it('Google Drive 備份列表與檔案下載等跨域 GET 請求不應被攔截或快取', async () => {
        const driveListUrl =
            "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=nextPageToken,files(id,name)&orderBy=createdTime%20desc&pageSize=100"

        const res = await harness.dispatchFetch({
            url: driveListUrl,
            headers: { Authorization: 'Bearer token_123' },
        })

        expect(res.intercepted).toBe(false)
        expect(harness.cachesMock.open).not.toHaveBeenCalled()
        expect(harness.fetchMock).not.toHaveBeenCalled()
    })

    it('即使未帶 Authorization 標頭，跨域 GET（Google Drive / OAuth / GitHub）也不應被 SW 攔截', async () => {
        const urls = [
            'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder',
            'https://www.googleapis.com/oauth2/v2/userinfo',
            'https://accounts.google.com/gsi/client',
            'https://api.github.com/repos/ADT109119/jijun',
        ]
        for (const url of urls) {
            const res = await harness.dispatchFetch({ url })
            expect(res.intercepted).toBe(false)
        }
    })

    it('明確設定 cache: no-store 或帶 Authorization 的同源請求不應被 SW 攔截', async () => {
        const noStoreRes = await harness.dispatchFetch({
            url: 'https://jijun.the-walking-fish.com/themes/dark.json',
            cache: 'no-store',
        })
        expect(noStoreRes.intercepted).toBe(false)

        const authRes = await harness.dispatchFetch({
            url: 'https://jijun.the-walking-fish.com/private/data.json',
            headers: { Authorization: 'Bearer abc' },
        })
        expect(authRes.intercepted).toBe(false)
    })

    it('同源 /api/ 請求仍直接放行不快取', async () => {
        const res = await harness.dispatchFetch({
            url: 'https://jijun.the-walking-fish.com/api/selfhost/backups',
        })
        expect(res.intercepted).toBe(false)
    })

    it('同源靜態資源仍正常走 cache-first 並寫入 DYNAMIC_CACHE', async () => {
        const assetUrl = 'https://jijun.the-walking-fish.com/assets/app-1234.css'
        const res = await harness.dispatchFetch({ url: assetUrl })

        expect(res.intercepted).toBe(true)
        expect(harness.fetchMock).toHaveBeenCalledTimes(1)
        expect(harness.store.get('dynamic-v2.1.2.4-dev')?.has(assetUrl)).toBe(true)
    })

    it('activate 時應清除 DYNAMIC_CACHE 內殘留的跨域 / Drive / API 快取項目，並保留同源資源', async () => {
        const dyn = new Map()
        dyn.set(
            'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder',
            { ok: true }
        )
        dyn.set(
            'https://jijun.the-walking-fish.com/api/selfhost/backups',
            { ok: true }
        )
        dyn.set(
            'https://jijun.the-walking-fish.com/assets/main.css',
            { ok: true }
        )
        harness.store.set('dynamic-v2.1.2.4-dev', dyn)

        await harness.dispatchActivate()

        expect(
            dyn.has('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder')
        ).toBe(false)
        expect(
            dyn.has('https://jijun.the-walking-fish.com/api/selfhost/backups')
        ).toBe(false)
        expect(
            dyn.has('https://jijun.the-walking-fish.com/assets/main.css')
        ).toBe(true)
    })

    describe('networkFirst 慢網路 5 秒快取降級開啟', () => {
        it('有快取且網路超過 5 秒無回應時，於 5 秒直接使用快取開啟，並允許背景完成更新快取', async () => {
            vi.useFakeTimers()
            try {
                const navUrl = 'https://jijun.the-walking-fish.com/'
                const cachedRes = { ok: true, status: 200, source: 'cache' }
                harness.store.set(
                    'app-v2.1.2.4-dev',
                    new Map([[navUrl, cachedRes]])
                )

                let resolveSlowFetch
                const freshRes = {
                    ok: true,
                    status: 200,
                    source: 'network-fresh',
                    clone() {
                        return { ...this }
                    },
                }
                harness.fetchMock.mockImplementationOnce(
                    () =>
                        new Promise(resolve => {
                            resolveSlowFetch = resolve
                        })
                )

                let settled = false
                const fetchPromise = harness
                    .dispatchFetch({
                        url: navUrl,
                        mode: 'navigate',
                        destination: 'document',
                    })
                    .then(r => {
                        settled = true
                        return r
                    })

                // 4.9 秒時尚未逾時
                await vi.advanceTimersByTimeAsync(4900)
                expect(settled).toBe(false)

                // 滿 5 秒立即用快取開啟，不需等 30 秒
                await vi.advanceTimersByTimeAsync(100)
                const result = await fetchPromise
                expect(settled).toBe(true)
                expect(result.response).toBe(cachedRes)

                // 背景網路最終於 15 秒後回應 → 透過 waitUntil 更新快取供下次使用
                resolveSlowFetch(freshRes)
                await Promise.all(result.waitPromises)
                expect(
                    harness.store.get('dynamic-v2.1.2.4-dev')?.get(navUrl)
                        ?.source
                ).toBe('network-fresh')
            } finally {
                vi.useRealTimers()
            }
        })

        it('有快取且網路於 5 秒內正常回應時，回傳最新網路回應並更新快取', async () => {
            vi.useFakeTimers()
            try {
                const navUrl = 'https://jijun.the-walking-fish.com/'
                const cachedRes = { ok: true, status: 200, source: 'cache' }
                harness.store.set(
                    'app-v2.1.2.4-dev',
                    new Map([[navUrl, cachedRes]])
                )

                const freshRes = {
                    ok: true,
                    status: 200,
                    source: 'network',
                    clone() {
                        return { ...this }
                    },
                }
                harness.fetchMock.mockImplementationOnce(
                    () =>
                        new Promise(resolve =>
                            setTimeout(() => resolve(freshRes), 800)
                        )
                )

                const fetchPromise = harness.dispatchFetch({
                    url: navUrl,
                    mode: 'navigate',
                    destination: 'document',
                })
                await vi.advanceTimersByTimeAsync(800)
                const result = await fetchPromise
                expect(result.response).toBe(freshRes)
            } finally {
                vi.useRealTimers()
            }
        })

        it('有快取且網路立即失敗（離線）時，立刻回傳快取無需等滿 5 秒', async () => {
            vi.useFakeTimers()
            try {
                const navUrl = 'https://jijun.the-walking-fish.com/'
                const cachedRes = { ok: true, status: 200, source: 'cache' }
                harness.store.set(
                    'app-v2.1.2.4-dev',
                    new Map([[navUrl, cachedRes]])
                )
                harness.fetchMock.mockRejectedValueOnce(new Error('offline'))

                const result = await harness.dispatchFetch({
                    url: navUrl,
                    mode: 'navigate',
                    destination: 'document',
                })
                expect(result.response).toBe(cachedRes)
            } finally {
                vi.useRealTimers()
            }
        })

        it('無任何快取且網路超過 5 秒時，不應提前中斷，仍等待網路回應', async () => {
            vi.useFakeTimers()
            try {
                const navUrl = 'https://jijun.the-walking-fish.com/'
                const freshRes = {
                    ok: true,
                    status: 200,
                    source: 'slow-network',
                    clone() {
                        return { ...this }
                    },
                }
                harness.fetchMock.mockImplementationOnce(
                    () =>
                        new Promise(resolve =>
                            setTimeout(() => resolve(freshRes), 8000)
                        )
                )

                let settled = false
                const fetchPromise = harness
                    .dispatchFetch({
                        url: navUrl,
                        mode: 'navigate',
                        destination: 'document',
                    })
                    .then(r => {
                        settled = true
                        return r
                    })

                await vi.advanceTimersByTimeAsync(5500)
                expect(settled).toBe(false)

                await vi.advanceTimersByTimeAsync(2500)
                const result = await fetchPromise
                expect(result.response).toBe(freshRes)
            } finally {
                vi.useRealTimers()
            }
        })
    })
})

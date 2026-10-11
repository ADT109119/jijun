import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    RewardService,
    checkIsNative,
    FALLBACK_INTERNAL_ADS,
} from '../../src/js/rewardService.js'

// Mock window.location.reload to prevent 'Not implemented' warning
vi.stubGlobal('location', { reload: vi.fn() })

describe('RewardService', () => {
    let service

    beforeEach(() => {
        // 清除 localStorage 中的 adFreeUntil
        localStorage.removeItem('adFreeUntil')
        service = new RewardService()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('_resolveWithCleanup', () => {
        it('第一次呼叫執行 cleanup + resolve', () => {
            const cleanupSpy = vi.spyOn(service, '_cleanupRewardedSlot')
            service._rewardedSlot = { id: 1 }
            service._listeners.push({ type: 'test', handler: vi.fn() })

            let resolvedValue
            service._resolveReward = value => {
                resolvedValue = value
            }

            service._resolveWithCleanup(true)

            expect(cleanupSpy).toHaveBeenCalledTimes(1)
            expect(resolvedValue).toBe(true)
            expect(service._hasResolved).toBe(true)
        })

        it('第二次呼叫不重複執行 cleanup 或 resolve', () => {
            const cleanupSpy = vi.spyOn(service, '_cleanupRewardedSlot')
            let resolveCallCount = 0
            service._resolveReward = () => {
                resolveCallCount++
            }

            // 第一次
            service._resolveWithCleanup(true)
            expect(cleanupSpy).toHaveBeenCalledTimes(1)
            expect(resolveCallCount).toBe(1)

            // 第二次
            cleanupSpy.mockClear()
            service._resolveWithCleanup(false)
            expect(cleanupSpy).not.toHaveBeenCalled()
            expect(resolveCallCount).toBe(1) // 不增加
        })

        it('cleanup 在 resolve 之前執行', () => {
            const cleanupOrder = []
            const originalCleanup = service._cleanupRewardedSlot.bind(service)
            vi.spyOn(service, '_cleanupRewardedSlot').mockImplementation(() => {
                cleanupOrder.push('cleanup')
                return originalCleanup()
            })

            service._resolveReward = () => {
                cleanupOrder.push('resolve')
            }

            service._resolveWithCleanup(true)
            expect(cleanupOrder).toEqual(['cleanup', 'resolve'])
        })
    })

    describe('_addGptListener / _cleanupRewardedSlot', () => {
        it('註冊 listener 後追蹤在 _listeners 陣列中', () => {
            const handler = vi.fn()
            service._addGptListener('testEvent', handler)

            expect(service._listeners).toHaveLength(1)
            expect(service._listeners[0]).toEqual({
                type: 'testEvent',
                handler,
            })
        })

        it('_cleanupRewardedSlot 清空 listeners 和 slot', () => {
            service._rewardedSlot = { id: 99 }
            service._listeners.push({ type: 'a', handler: vi.fn() })
            service._listeners.push({ type: 'b', handler: vi.fn() })

            service._cleanupRewardedSlot()

            expect(service._listeners).toEqual([])
            expect(service._rewardedSlot).toBeNull()
        })
    })

    describe('isAdFree / getAdFreeRemaining / formatRemaining', () => {
        it('沒有 adFreeUntil → isAdFree 回傳 false', () => {
            localStorage.removeItem('adFreeUntil')
            const fresh = new RewardService()
            expect(fresh.isAdFree()).toBe(false)
        })

        it('沒有 adFreeUntil → getAdFreeRemaining 回傳 0', () => {
            localStorage.removeItem('adFreeUntil')
            const fresh = new RewardService()
            expect(fresh.getAdFreeRemaining()).toBe(0)
        })

        it('沒有 adFreeUntil → formatRemaining 回傳 null', () => {
            localStorage.removeItem('adFreeUntil')
            const fresh = new RewardService()
            expect(fresh.formatRemaining()).toBeNull()
        })

        it('未來時間 → isAdFree 回傳 true', () => {
            const future = Date.now() + 24 * 60 * 60 * 1000
            localStorage.setItem('adFreeUntil', String(future))
            expect(service.isAdFree()).toBe(true)
        })

        it('過去時間 → isAdFree 回傳 false', () => {
            const past = Date.now() - 1000 * 60 * 60 // 1 小時前
            localStorage.setItem('adFreeUntil', String(past))
            expect(service.isAdFree()).toBe(false)
        })

        it('getAdFreeRemaining 回傳剩餘毫秒數', () => {
            const future = Date.now() + 3600 * 1000 // 1 小時後
            localStorage.setItem('adFreeUntil', String(future))
            const remaining = service.getAdFreeRemaining()
            expect(remaining).toBeGreaterThan(3500 * 1000)
            expect(remaining).toBeLessThanOrEqual(3600 * 1000)
        })

        it('formatRemaining 回傳可讀字串', () => {
            const future = Date.now() + (2 * 3600 + 30) * 1000 // 2 小時 30 分後
            localStorage.setItem('adFreeUntil', String(future))
            const formatted = service.formatRemaining()
            expect(formatted).toContain('小時')
            expect(formatted).toContain('分鐘')
        })

        it('不足 1 小時 → formatRemaining 顯示 0 小時', () => {
            const future = Date.now() + 45 * 60 * 1000 // 45 分後
            localStorage.setItem('adFreeUntil', String(future))
            const formatted = service.formatRemaining()
            expect(formatted).toContain('0 小時')
        })

        it('無效的 adFreeUntil → isAdFree 回傳 false', () => {
            localStorage.setItem('adFreeUntil', 'not-a-number')
            expect(service.isAdFree()).toBe(false)
        })
    })

    describe('_grantAdFree', () => {
        it('設定 adFreeUntil 為現在 + 7 天', () => {
            service._grantAdFree()
            const until = Number(localStorage.getItem('adFreeUntil'))
            expect(until).toBeGreaterThan(Date.now())
            expect(until - Date.now()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3)
        })

        it('_grantAdFree 後 isAdFree 回傳 true', () => {
            service._grantAdFree()
            expect(service.isAdFree()).toBe(true)
        })
    })

    describe('邊界值', () => {
        it('getAdFreeRemaining 過期時間 → 0', () => {
            // 設定已過期的時間
            localStorage.setItem('adFreeUntil', '1000000000000')
            expect(service.getAdFreeRemaining()).toBe(0)
        })

        it('formatRemaining 恰 60 分鐘 → 剩 60 分鐘', () => {
            const until = Date.now() + 60 * 60 * 1000
            localStorage.setItem('adFreeUntil', until.toString())
            // 60 分鐘整
            const remaining = service.getAdFreeRemaining()
            expect(remaining).toBeGreaterThan(59 * 60 * 1000)
            expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000)
        })

        it('localStorage 讀取拋錯 → isAdFree 回傳 false', () => {
            const original = Storage.prototype.getItem
            Storage.prototype.getItem = vi.fn().mockImplementation(() => {
                throw new Error('QuotaExceededError')
            })
            try {
                expect(service.isAdFree()).toBe(false)
            } finally {
                Storage.prototype.getItem = original
            }
        })
    })

    describe('平臺偵測與備用推廣廣告', () => {
        it('FALLBACK_INTERNAL_ADS 包含有效廣告項目', () => {
            expect(Array.isArray(FALLBACK_INTERNAL_ADS)).toBe(true)
            expect(FALLBACK_INTERNAL_ADS.length).toBeGreaterThan(0)
            for (const ad of FALLBACK_INTERNAL_ADS) {
                expect(ad.title).toBeTruthy()
                expect(ad.buttonText).toBeTruthy()
                expect(ad.url).toBeTruthy()
            }
        })

        it('checkIsNative 在非 Native 環境回傳 false', () => {
            expect(checkIsNative()).toBe(false)
            expect(service.isNative).toBe(false)
        })

        it('checkIsNative 在 Capacitor Native 環境動態回傳 true', () => {
            const originalCapacitor = window.Capacitor
            try {
                window.Capacitor = {
                    isNativePlatform: () => true,
                }
                expect(checkIsNative()).toBe(true)
                expect(service.isNative).toBe(true)
            } finally {
                window.Capacitor = originalCapacitor
            }
        })

        it('formatRemaining 大於 1 天時正確顯示天數與小時', () => {
            const future = Date.now() + (3 * 24 + 5) * 60 * 60 * 1000 // 3 天 5 小時
            localStorage.setItem('adFreeUntil', String(future))
            const formatted = service.formatRemaining()
            expect(formatted).toContain('3 天')
            expect(formatted).toContain('5 小時')
        })

        it('若已在無廣告期間，showRewardedAd 直接回傳 false', async () => {
            service._grantAdFree()
            const result = await service.showRewardedAd()
            expect(result).toBe(false)
        })

        it('_fallbackToInternalAd 應執行清理並呼叫 _showInternalAd', async () => {
            const cleanupSpy = vi.spyOn(service, '_cleanupRewardedSlot')
            const internalSpy = vi
                .spyOn(service, '_showInternalAd')
                .mockResolvedValue(true)

            let resolvedValue
            service._resolveReward = v => {
                resolvedValue = v
            }
            service._hasResolved = false

            service._fallbackToInternalAd()

            expect(cleanupSpy).toHaveBeenCalled()
            expect(internalSpy).toHaveBeenCalled()
            await Promise.resolve()
            expect(resolvedValue).toBe(true)
            expect(service._hasResolved).toBe(true)
        })

        it('Web 環境 GPT 無法載入時自動降級顯示內建推廣廣告', async () => {
            const internalSpy = vi
                .spyOn(service, '_showInternalAd')
                .mockResolvedValue(true)

            const appendSpy = vi
                .spyOn(document.head, 'appendChild')
                .mockImplementation(el => {
                    if (el && el.tagName === 'SCRIPT' && typeof el.onerror === 'function') {
                        el.onerror()
                    }
                    return el
                })

            delete window.googletag
            const result = await service.showRewardedAd()
            expect(internalSpy).toHaveBeenCalled()
            expect(result).toBe(true)
            appendSpy.mockRestore()
        })
    })
})

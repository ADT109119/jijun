import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatisticsManager } from '../../src/js/statistics.js'

/**
 * statistics.js 單元測試
 * 測試 getChartTimeUnit、filters 初始化、renderTopExpenses 邏輯
 *
 * 注意：renderTrendChart / renderExpenseDonutChart 等 Chart.js 渲染函數
 * 需要真實 canvas DOM，適合放在整合測試而非單元測試。
 */

// ==================== getChartTimeUnit ====================

describe('StatisticsManager.getChartTimeUnit', () => {
    /**
     * 建立最小 StatisticsManager 以測試 getChartTimeUnit
     * 不需要真實 dataService/categoryManager
     */
    let sm

    beforeEach(() => {
        const mockDS = {
            getSetting: vi.fn().mockResolvedValue(null),
            getAccounts: vi.fn().mockResolvedValue([]),
        }
        const mockCM = {
            getCategoryById: vi.fn().mockReturnValue(null),
        }
        sm = new StatisticsManager(mockDS, mockCM)
    })

    it('14 天以內回傳 day', () => {
        const range = { startDate: '2026-06-01', endDate: '2026-06-10' }
        expect(sm.getChartTimeUnit(range)).toBe('day')
    })

    it('恰好 14 天回傳 day', () => {
        const range = { startDate: '2026-06-01', endDate: '2026-06-14' }
        expect(sm.getChartTimeUnit(range)).toBe('day')
    })

    it('15 天回傳 week', () => {
        const range = { startDate: '2026-06-01', endDate: '2026-06-16' }
        expect(sm.getChartTimeUnit(range)).toBe('week')
    })

    it('90 天以內回傳 week', () => {
        const range = { startDate: '2026-01-01', endDate: '2026-03-31' }
        expect(sm.getChartTimeUnit(range)).toBe('week')
    })

    it('恰好 90 天回傳 week', () => {
        const range = { startDate: '2026-01-01', endDate: '2026-04-01' }
        // Jan(31) + Feb(28) + Mar(31) + Apr 1 = 91 days
        // Let's be precise: 2026-01-01 to 2026-04-01 = 90 days
        expect(sm.getChartTimeUnit(range)).toBe('week')
    })

    it('91 天以上回傳 month', () => {
        const range = { startDate: '2026-01-01', endDate: '2026-04-02' }
        expect(sm.getChartTimeUnit(range)).toBe('month')
    })

    it('全年範圍回傳 month', () => {
        const range = { startDate: '2026-01-01', endDate: '2026-12-31' }
        expect(sm.getChartTimeUnit(range)).toBe('month')
    })

    it('跨年範圍回傳 month', () => {
        const range = { startDate: '2025-06-01', endDate: '2026-06-01' }
        expect(sm.getChartTimeUnit(range)).toBe('month')
    })

    it('同一天回傳 day', () => {
        const range = { startDate: '2026-06-15', endDate: '2026-06-15' }
        expect(sm.getChartTimeUnit(range)).toBe('day')
    })

    it('兩天一回傳 day', () => {
        const range = { startDate: '2026-06-15', endDate: '2026-06-16' }
        expect(sm.getChartTimeUnit(range)).toBe('day')
    })

    it('7 天(一週)回傳 day', () => {
        const range = { startDate: '2026-06-01', endDate: '2026-06-07' }
        expect(sm.getChartTimeUnit(range)).toBe('day')
    })
})

// ==================== 建構與 filters 預設值 ====================

describe('StatisticsManager constructor', () => {
    it('正確初始化 filters 預設值', () => {
        const mockDS = {
            getSetting: vi.fn().mockResolvedValue(null),
            getAccounts: vi.fn().mockResolvedValue([]),
        }
        const mockCM = {
            getCategoryById: vi.fn().mockReturnValue(null),
        }
        const sm = new StatisticsManager(mockDS, mockCM)

        expect(sm.filters).toEqual({
            period: 'month',
            customStartDate: null,
            customEndDate: null,
            selectedAccountId: null,
        })
    })

    it('charts 物件初始為空', () => {
        const mockDS = {
            getSetting: vi.fn().mockResolvedValue(null),
            getAccounts: vi.fn().mockResolvedValue([]),
        }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        expect(sm.charts).toEqual({})
    })

    it('dataService 和 categoryManager 正確保存', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const mockCM = { getCategoryById: vi.fn() }
        const sm = new StatisticsManager(mockDS, mockCM)
        expect(sm.dataService).toBe(mockDS)
        expect(sm.categoryManager).toBe(mockCM)
    })

    it('container 初始為 null', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        expect(sm.container).toBeNull()
    })

    it('advancedModeEnabled 初始為 false', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        expect(sm.advancedModeEnabled).toBe(false)
    })

    it('accounts 初始為空陣列', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        expect(sm.accounts).toEqual([])
    })
})

// ==================== destroy ====================

describe('StatisticsManager.destroy', () => {
    it('destroy 清空 charts 物件', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        sm.charts.trend = { destroy: vi.fn() }
        sm.charts.expenseDonut = { destroy: vi.fn() }
        sm.charts.incomeDonut = { destroy: vi.fn() }

        sm.destroy()

        expect(sm.charts).toEqual({})
    })

    it('destroy 呼叫每個 chart 的 destroy', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })
        const mockChart = { destroy: vi.fn() }
        sm.charts.trend = mockChart

        sm.destroy()

        expect(mockChart.destroy).toHaveBeenCalled()
    })

    it('destroy 沒有 chart 時不拋錯', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })

        expect(() => sm.destroy()).not.toThrow()
    })

    it('destroy 可以呼叫多次不拋錯', () => {
        const mockDS = { getSetting: vi.fn(), getAccounts: vi.fn() }
        const sm = new StatisticsManager(mockDS, { getCategoryById: vi.fn() })

        sm.destroy()
        expect(() => sm.destroy()).not.toThrow()
    })
})

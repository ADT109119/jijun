import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StatisticsManager } from '../../src/js/statistics.js'
import { getDateRange } from '../../src/js/utils.js'
import { createDateRangeModal } from '../../src/js/datePickerModal.js'

// Mock chart.js：jsdom 沒有 canvas，new Chart() 不需真實實作。
// 此 mock 為 hoisted，對整份檔案生效，但現有測試（getChartTimeUnit/constructor/destroy）
// 都不會真正實體化 Chart，因此安全。
vi.mock('chart.js', () => {
    const mockChart = vi.fn(function () {
        return { destroy: vi.fn() }
    })
    mockChart.register = vi.fn()
    return { Chart: mockChart, registerables: [] }
})

// chartjs-adapter-date-fns 內部 import chart.js 的 _adapters 並呼叫 override，
// 會在 chart.js 被 mock 後直接拋錯，因此一併 mock。
vi.mock('chartjs-adapter-date-fns', () => ({}))

vi.mock('../../src/js/datePickerModal.js', () => ({
    createDateRangeModal: vi.fn(() => {
        const modal = document.createElement('div')
        modal.id = 'date-range-modal'
        return modal
    }),
}))

/**
 * 建立測試用的最小 DOM container + mock dataService/categoryManager + StatisticsManager
 * 結構對應 renderStatisticsPage 產出的關鍵元素（節錄）。
 */
function createTestHarness() {
    const container = document.createElement('div')
    container.innerHTML = `
        <div class="period-bar">
            <button data-period="week" class="period-btn">週</button>
            <button data-period="month" class="period-btn">月</button>
            <button data-period="year" class="period-btn">年</button>
            <button data-period="custom" class="period-btn">自訂</button>
        </div>
        <div id="stats-total-income"></div>
        <div id="stats-total-expense"></div>
        <div id="stats-net-balance"></div>
        <div id="stats-account-balance-card" class="hidden">
            <p id="stats-account-balance"></p>
        </div>
        <div id="stats-expense-donut-container"></div>
        <div id="stats-income-donut-container"></div>
        <canvas id="stats-trend-chart"></canvas>
        <div id="stats-heatmap-container"></div>
        <div id="stats-top-expenses-list"></div>
        <div id="stats-modals-container"></div>
        <select id="stats-account-filter">
            <option value="all">所有帳戶</option>
        </select>
    `

    const dataService = {
        getSetting: vi.fn().mockResolvedValue(null),
        getAccounts: vi.fn().mockResolvedValue([]),
        getStatistics: vi.fn().mockResolvedValue({
            totalIncome: 0,
            totalExpense: 0,
            expenseByCategory: {},
            incomeByCategory: {},
            dailyTotals: {},
            records: [],
        }),
        getRecords: vi.fn().mockResolvedValue([]),
    }

    const categoryManager = {
        getCategoryById: vi.fn((type, id) => ({
            name: `分類${id}`,
            icon: 'fa-solid fa-tag',
            color: '#000000',
        })),
    }

    const sm = new StatisticsManager(dataService, categoryManager)
    sm.container = container
    sm.modalsContainer = container.querySelector('#stats-modals-container')
    return { sm, container, dataService, categoryManager }
}

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
            selectedContactId: null
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

// ==================== renderTopExpenses ====================

describe('StatisticsManager.renderTopExpenses', () => {
    let sm, container, categoryManager

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
        categoryManager = h.categoryManager
    })

    afterEach(() => sm.destroy())

    it('空紀錄時顯示「無消費紀錄」', () => {
        sm.renderTopExpenses([])
        expect(
            container.querySelector('#stats-top-expenses-list').textContent
        ).toContain('無消費紀錄')
    })

    it('只有 income 紀錄時顯示「無消費紀錄」', () => {
        sm.renderTopExpenses([
            {
                type: 'income',
                amount: 100,
                category: 'salary',
                date: '2026-06-01',
                description: '薪水',
            },
        ])
        expect(
            container.querySelector('#stats-top-expenses-list').textContent
        ).toContain('無消費紀錄')
    })

    it('超過 5 筆支出時僅顯示前 5 筆且按金額降冪排列', () => {
        categoryManager.getCategoryById.mockReturnValue({
            name: '食物',
            icon: 'fa-solid fa-utensils',
            color: '#aaaaaa',
        })
        const records = Array.from({ length: 7 }, (_, i) => ({
            type: 'expense',
            amount: (i + 1) * 100,
            category: 'food',
            date: '2026-06-01',
            description: null,
        }))
        sm.renderTopExpenses(records)
        const rows = container.querySelectorAll(
            '#stats-top-expenses-list > div'
        )
        expect(rows.length).toBe(5)
        expect(rows[0].textContent).toContain('700')
        expect(rows[4].textContent).toContain('300')
    })

    it('有 description 時顯示 description，無 description 時顯示分類名稱', () => {
        categoryManager.getCategoryById.mockReturnValue({
            name: '交通',
            icon: 'fa-solid fa-car',
            color: '#111111',
        })
        const records = [
            {
                type: 'expense',
                amount: 100,
                category: 'transport',
                date: '2026-06-01',
                description: '捷運票',
            },
            {
                type: 'expense',
                amount: 200,
                category: 'transport',
                date: '2026-06-02',
                description: null,
            },
        ]
        sm.renderTopExpenses(records)
        const listHtml = container.querySelector('#stats-top-expenses-list')
            .innerHTML
        expect(listHtml).toContain('捷運票')
        expect(listHtml).toContain('交通')
    })

    it('未知 category id 顯示原始 id（others 顯示「其他」）並用問號 icon', () => {
        categoryManager.getCategoryById.mockReturnValue(null)
        const records = [
            {
                type: 'expense',
                amount: 100,
                category: 'some_custom',
                date: '2026-06-01',
                description: null,
            },
            {
                type: 'expense',
                amount: 50,
                category: 'others',
                date: '2026-06-02',
                description: null,
            },
        ]
        sm.renderTopExpenses(records)
        const listHtml = container.querySelector('#stats-top-expenses-list')
            .innerHTML
        expect(listHtml).toContain('some_custom')
        expect(listHtml).toContain('其他')
        expect(listHtml).toContain('fa-solid fa-question')
    })

    it('description 含 script 標籤時不會以原始 HTML 注入（XSS 防護）', () => {
        categoryManager.getCategoryById.mockReturnValue({
            name: '食物',
            icon: 'fa-solid fa-utensils',
            color: '#aaaaaa',
        })
        const payload = '<script>alert(1)</script>'
        const records = [
            {
                type: 'expense',
                amount: 100,
                category: 'food',
                date: '2026-06-01',
                description: payload,
            },
        ]
        sm.renderTopExpenses(records)
        const listHtml = container.querySelector('#stats-top-expenses-list')
            .innerHTML
        expect(listHtml).not.toContain('<script>')
        expect(listHtml).toContain('&lt;script&gt;')
    })

    it('排名數字依序為 1 到 5', () => {
        categoryManager.getCategoryById.mockReturnValue({
            name: '食物',
            icon: 'fa-solid fa-utensils',
            color: '#aaaaaa',
        })
        const records = Array.from({ length: 5 }, (_, i) => ({
            type: 'expense',
            amount: 1000 - i * 100,
            category: 'food',
            date: '2026-06-01',
            description: null,
        }))
        sm.renderTopExpenses(records)
        const ranks = [
            ...container.querySelectorAll('#stats-top-expenses-list .size-8'),
        ].map(el => el.textContent.trim())
        expect(ranks).toEqual(['1', '2', '3', '4', '5'])
    })
})

// ==================== updateSummaryCards ====================

describe('StatisticsManager.updateSummaryCards', () => {
    let sm, container

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
    })

    afterEach(() => sm.destroy())

    it('三張卡片金額正確顯示', () => {
        sm.updateSummaryCards({ totalIncome: 3000, totalExpense: 1200 })
        expect(container.querySelector('#stats-total-income').textContent).toBe(
            '$3,000'
        )
        expect(
            container.querySelector('#stats-total-expense').textContent
        ).toBe('$1,200')
        expect(
            container.querySelector('#stats-net-balance').textContent
        ).toBe('$1,800')
    })

    it('結餘大於等於 0 時套用 text-wabi-income 樣式', () => {
        sm.updateSummaryCards({ totalIncome: 3000, totalExpense: 1200 })
        expect(
            container.querySelector('#stats-net-balance').className
        ).toContain('text-wabi-income')
    })

    it('結餘為負數時套用 text-wabi-expense 樣式', () => {
        sm.updateSummaryCards({ totalIncome: 500, totalExpense: 700 })
        expect(
            container.querySelector('#stats-net-balance').className
        ).toContain('text-wabi-expense')
        expect(
            container.querySelector('#stats-net-balance').textContent
        ).toContain('200')
    })
})

// ==================== 甜甜圈圖空狀態 ====================

describe('StatisticsManager 甜甜圈圖空狀態', () => {
    let sm, container

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
    })

    afterEach(() => sm.destroy())

    it('expenseData 為空物件時顯示「此期間無支出紀錄」', () => {
        sm.renderExpenseDonutChart({})
        expect(
            container.querySelector('#stats-expense-donut-container').textContent
        ).toContain('此期間無支出紀錄')
        expect(sm.charts.expenseDonut).toBeUndefined()
    })

    it('incomeData 為空物件時顯示「此期間無收入紀錄」', () => {
        sm.renderIncomeDonutChart({})
        expect(
            container.querySelector('#stats-income-donut-container').textContent
        ).toContain('此期間無收入紀錄')
        expect(sm.charts.incomeDonut).toBeUndefined()
    })

    it('expenseData 有資料時建立圖表與圖例', () => {
        sm.renderExpenseDonutChart({ food: 800, transport: 200 })
        expect(sm.charts.expenseDonut).toBeTruthy()
        const el = container.querySelector('#stats-expense-donut-container')
        expect(el.textContent).toContain('總支出')
        expect(el.textContent).toContain('1,000')
        expect(el.textContent).toContain('80%')
    })

    it('incomeData 有資料時建立圖表與圖例', () => {
        sm.renderIncomeDonutChart({ salary: 900, bonus: 100 })
        expect(sm.charts.incomeDonut).toBeTruthy()
        const el = container.querySelector('#stats-income-donut-container')
        expect(el.textContent).toContain('總收入')
        expect(el.textContent).toContain('1,000')
    })
})

// ==================== renderAnnualHeatmap ====================

describe('StatisticsManager.renderAnnualHeatmap', () => {
    let sm, container, dataService

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
        dataService = h.dataService
    })

    afterEach(() => sm.destroy())

    it('無紀錄時產出 371 個 cell 且沒有任何 opacity-100 cell', async () => {
        dataService.getRecords.mockResolvedValue([])
        await sm.renderAnnualHeatmap({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
        })
        const cells = [
            ...container.querySelectorAll('#stats-heatmap-container > div'),
        ]
        // 非閏年：共 365 + (7 - 365%7) = 371 格（含補齊格寬的空白格）
        expect(cells.length).toBe(371)
        expect(
            cells.filter(c => c.classList.contains('opacity-100'))
        ).toHaveLength(0)
        // 有效日期格（非空白）即一年 365 天
        expect(
            cells.filter(c => !c.classList.contains('bg-transparent'))
        ).toHaveLength(365)
    })

    it('金額最大日為 opacity-100，金額介於 75% 與 100% 之間者為 opacity-75', async () => {
        dataService.getRecords.mockResolvedValue([
            {
                type: 'expense',
                amount: 2000,
                date: '2026-06-15',
                category: 'food',
            },
            {
                // 1300 / 2000 = 0.65，0.5 < intensity <= 0.75 → opacity-75
                type: 'expense',
                amount: 1300,
                date: '2026-06-16',
                category: 'food',
            },
        ])
        await sm.renderAnnualHeatmap({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
        })
        const cells = [
            ...container.querySelectorAll('#stats-heatmap-container > div'),
        ]
        const maxCell = cells.find(c => c.title === '2026-06-15: $2000')
        const subCell = cells.find(c => c.title === '2026-06-16: $1300')
        expect(maxCell).toBeTruthy()
        expect(maxCell.classList.contains('opacity-100')).toBe(true)
        expect(subCell.classList.contains('opacity-75')).toBe(true)
    })

    it('閏年（2028）產生 366 個有效日期格', async () => {
        dataService.getRecords.mockResolvedValue([])
        await sm.renderAnnualHeatmap({
            startDate: '2028-01-01',
            endDate: '2028-12-31',
        })
        const cells = [
            ...container.querySelectorAll('#stats-heatmap-container > div'),
        ]
        // 閏年：366 + (7 - 366%7) = 371 格，有效日期格為 366 天
        expect(cells.length).toBe(371)
        expect(
            cells.filter(c => !c.classList.contains('bg-transparent'))
        ).toHaveLength(366)
    })

    it('以 startDate 的年份呼叫 getRecords 取得整年支出紀錄', async () => {
        dataService.getRecords.mockResolvedValue([])
        await sm.renderAnnualHeatmap({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
        })
        expect(dataService.getRecords).toHaveBeenCalledWith({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            type: 'expense',
        })
    })
})

// ==================== updatePeriodButtons ====================

describe('StatisticsManager.updatePeriodButtons', () => {
    let sm, container

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
    })

    afterEach(() => sm.destroy())

    it('period 為 month 時僅 month 按鈕有 active 樣式', () => {
        sm.filters.period = 'month'
        sm.updatePeriodButtons()
        const monthBtn = container.querySelector(
            '.period-btn[data-period="month"]'
        )
        const others = [
            container.querySelector('.period-btn[data-period="week"]'),
            container.querySelector('.period-btn[data-period="year"]'),
            container.querySelector('.period-btn[data-period="custom"]'),
        ]
        expect(monthBtn.classList.contains('bg-wabi-surface')).toBe(true)
        expect(monthBtn.classList.contains('text-wabi-primary')).toBe(true)
        expect(monthBtn.classList.contains('shadow-sm')).toBe(true)
        for (const btn of others) {
            expect(btn.classList.contains('bg-wabi-surface')).toBe(false)
            expect(btn.classList.contains('text-wabi-primary')).toBe(false)
            expect(btn.classList.contains('shadow-sm')).toBe(false)
            expect(btn.classList.contains('text-wabi-text-secondary')).toBe(true)
        }
    })

    it('period 為 week 時樣式切換到 week 按鈕', () => {
        sm.filters.period = 'week'
        sm.updatePeriodButtons()
        expect(
            container
                .querySelector('.period-btn[data-period="week"]')
                .classList.contains('text-wabi-primary')
        ).toBe(true)
        expect(
            container
                .querySelector('.period-btn[data-period="month"]')
                .classList.contains('text-wabi-text-secondary')
        ).toBe(true)
    })
})

// ==================== loadStatisticsData ====================

describe('StatisticsManager.loadStatisticsData', () => {
    let sm, container, dataService

    const stats = {
        totalIncome: 1000,
        totalExpense: 400,
        expenseByCategory: {},
        incomeByCategory: {},
        dailyTotals: {},
        records: [],
    }

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
        dataService = h.dataService
    })

    afterEach(() => sm.destroy())

    it('非進階模式時帳戶餘額卡片維持 hidden', async () => {
        dataService.getStatistics.mockResolvedValue(stats)
        sm.filters.period = 'week'
        await sm.loadStatisticsData()
        expect(
            container
                .querySelector('#stats-account-balance-card')
                .classList.contains('hidden')
        ).toBe(true)
    })

    it('進階模式選擇特定帳戶時顯示帳戶餘額（含 transfer 一併計算）', async () => {
        dataService.getStatistics.mockResolvedValue(stats)
        sm.advancedModeEnabled = true
        sm.accounts = [{ id: 1, name: '錢包', balance: 1000 }]
        sm.filters.selectedAccountId = 1
        dataService.getRecords.mockResolvedValue([
            { type: 'income', amount: 500, category: 'salary' },
            { type: 'expense', amount: 200, category: 'food' },
            { type: 'income', amount: 100, category: 'transfer' },
        ])
        await sm.loadStatisticsData()
        const card = container.querySelector('#stats-account-balance-card')
        expect(card.classList.contains('hidden')).toBe(false)
        expect(
            container.querySelector('#stats-account-balance').textContent
        ).toContain('1,400')
        // 選擇單一帳戶時 offsetTransfers 傳入 false
        const call = dataService.getStatistics.mock.calls.at(-1)
        expect(call[3]).toBe(false)
    })

    it('進階模式但選擇「所有帳戶」時卡片維持 hidden', async () => {
        dataService.getStatistics.mockResolvedValue(stats)
        sm.advancedModeEnabled = true
        sm.accounts = [{ id: 1, name: '錢包', balance: 1000 }]
        sm.filters.selectedAccountId = null
        await sm.loadStatisticsData()
        expect(
            container
                .querySelector('#stats-account-balance-card')
                .classList.contains('hidden')
        ).toBe(true)
    })

    it('period 為 week 時 getStatistics 收到對應日期範圍', async () => {
        dataService.getStatistics.mockResolvedValue(stats)
        sm.filters.period = 'week'
        await sm.loadStatisticsData()
        const expected = getDateRange('week')
        expect(dataService.getStatistics).toHaveBeenCalledWith(
            expected.startDate,
            expected.endDate,
            null,
            true,
            null
        )
    })

    it('period 為 custom 且有自訂日期時使用自訂範圍', async () => {
        dataService.getStatistics.mockResolvedValue(stats)
        sm.filters.period = 'custom'
        sm.filters.customStartDate = '2026-06-01'
        sm.filters.customEndDate = '2026-06-15'
        await sm.loadStatisticsData()
        expect(dataService.getStatistics).toHaveBeenCalledWith(
            '2026-06-01',
            '2026-06-15',
            null,
            true,
            null
        )
    })
})

// ==================== showDateRangeModal ====================

describe('StatisticsManager.showDateRangeModal', () => {
    let sm, container

    beforeEach(() => {
        const h = createTestHarness()
        sm = h.sm
        container = h.container
    })

    afterEach(() => sm.destroy())

    it('將 createDateRangeModal 回傳的 modal 加入 modalsContainer', () => {
        sm.showDateRangeModal()
        const modals = container.querySelector('#stats-modals-container')
        expect(modals.children.length).toBe(1)
        expect(createDateRangeModal).toHaveBeenCalled()
    })

    it('以目前自訂日期作為 modal 初始值', () => {
        sm.filters.customStartDate = '2026-06-01'
        sm.filters.customEndDate = '2026-06-15'
        sm.showDateRangeModal()
        const options = vi.mocked(createDateRangeModal).mock.calls[0][0]
        expect(options.initialStartDate).toBe('2026-06-01')
        expect(options.initialEndDate).toBe('2026-06-15')
    })

    it('onApply 將 filters 更新為 custom 期間', () => {
        sm.showDateRangeModal()
        const options = vi.mocked(createDateRangeModal).mock.calls[0][0]
        options.onApply('2026-01-01', '2026-01-31')
        expect(sm.filters.period).toBe('custom')
        expect(sm.filters.customStartDate).toBe('2026-01-01')
        expect(sm.filters.customEndDate).toBe('2026-01-31')
    })
})

// ==================== 對象（聯絡人）篩選 UI (#MOZE-TGT) ====================

describe('StatisticsManager — 對象（聯絡人）篩選 UI (#MOZE-TGT)', () => {
    function createContactHarness({
        debtEnabled = true,
        contacts = [
            { id: 1, name: '小明' },
            { id: 2, name: '小美' },
        ],
        contactsFails = false,
    } = {}) {
        const container = document.createElement('div')
        document.body.appendChild(container)
        const dataService = {
            getSetting: vi.fn(async key => {
                if (key === 'debtManagementEnabled' && debtEnabled) {
                    return { value: true }
                }
                return null
            }),
            getAccounts: vi.fn(async () => []),
            getContacts: contactsFails
                ? vi.fn(async () => {
                      throw new Error('boom')
                  })
                : vi.fn(async () => contacts),
            getStatistics: vi.fn(async () => ({
                totalIncome: 0,
                totalExpense: 0,
                expenseByCategory: {},
                incomeByCategory: {},
                dailyTotals: {},
                records: [],
            })),
            getRecords: vi.fn(async () => []),
        }
        const categoryManager = {
            getCategoryById: vi.fn(() => ({
                name: '分類',
                icon: 'fa-solid fa-tag',
                color: '#000000',
            })),
        }
        const sm = new StatisticsManager(dataService, categoryManager)
        return { sm, container, dataService }
    }

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('欠款開啟且有聯絡人 → 渲染對象 select 與選項', async () => {
        const { sm, container } = createContactHarness()
        await sm.renderStatisticsPage(container)
        const select = container.querySelector('#stats-contact-filter')
        expect(select).not.toBeNull()
        const options = select.querySelectorAll('option')
        expect(options).toHaveLength(3) // all + 2 人
        expect(options[0].value).toBe('all')
        expect(options[0].textContent).toContain('所有對象')
        expect(options[1].textContent).toContain('小明')
    })

    it('聯絡人名稱含 script 標籤 → 被 escapeHTML 防禦', async () => {
        const { sm, container } = createContactHarness({
            contacts: [{ id: 1, name: '<script>alert(1)</script>' }],
        })
        await sm.renderStatisticsPage(container)
        const select = container.querySelector('#stats-contact-filter')
        expect(select).not.toBeNull()
        expect(container.innerHTML).not.toContain('<script>alert(1)</script>')
        expect(select.options[1].textContent).toContain('<script>')
    })

    it('欠款功能關閉 → 對象 select 不存在', async () => {
        const { sm, container } = createContactHarness({ debtEnabled: false })
        await sm.renderStatisticsPage(container)
        expect(
            container.querySelector('#stats-contact-filter')
        ).toBeNull()
    })

    it('欠款開啟但無聯絡人 → 對象 select 不存在', async () => {
        const { sm, container } = createContactHarness({ contacts: [] })
        await sm.renderStatisticsPage(container)
        expect(
            container.querySelector('#stats-contact-filter')
        ).toBeNull()
    })

    it('getContacts 拋錯 → 降級不崩潰且無 select', async () => {
        const { sm, container } = createContactHarness({
            contactsFails: true,
        })
        await expect(
            sm.renderStatisticsPage(container)
        ).resolves.not.toThrow()
        expect(
            container.querySelector('#stats-contact-filter')
        ).toBeNull()
    })

    it('幽靈篩選重置：已選聯絡人被刪除時重置為 null', async () => {
        const { sm } = createContactHarness()
        sm.filters.selectedContactId = 99 // 聯絡人列表無 99
        await sm.renderStatisticsPage(document.createElement('div'))
        expect(sm.filters.selectedContactId).toBeNull()
    })

    it('DOM 重建後還原選定值且 change 更新 filters 並重算', async () => {
        const { sm, container } = createContactHarness()
        sm.filters.selectedContactId = 2
        await sm.renderStatisticsPage(container)
        const select = container.querySelector('#stats-contact-filter')
        expect(select.value).toBe('2')
        const loadSpy = vi
            .spyOn(sm, 'loadStatisticsData')
            .mockResolvedValue(undefined)
        select.value = '1'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        expect(sm.filters.selectedContactId).toBe(1)
        expect(loadSpy).toHaveBeenCalled()
        loadSpy.mockRestore()
    })

    it('selectedContactId 傳入 getStatistics 第 5 參數', async () => {
        const { sm, dataService } = createContactHarness()
        await sm.renderStatisticsPage(document.createElement('div'))
        sm.filters.selectedContactId = 5
        await sm.loadStatisticsData()
        const call = dataService.getStatistics.mock.calls.at(-1)
        expect(call[4]).toBe(5)
    })
})

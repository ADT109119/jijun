import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordsListManager } from '../../src/js/recordsList.js'

// Mock utils.js for predictable dates
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        getDateRange: vi.fn(period => {
            if (period === 'month')
                return { startDate: '2026-06-01', endDate: '2026-06-30' }
            if (period === 'week')
                return { startDate: '2026-06-28', endDate: '2026-07-04' }
            if (period === 'today')
                return { startDate: '2026-06-30', endDate: '2026-06-30' }
            if (period === 'last7days')
                return { startDate: '2026-06-24', endDate: '2026-06-30' }
            if (period === 'year')
                return { startDate: '2026-01-01', endDate: '2026-12-31' }
            return { startDate: '2026-06-01', endDate: '2026-06-30' }
        }),
    }
})

vi.mock('../../src/js/datePickerModal.js', () => ({
    createDateRangeModal: vi.fn(() => {
        const modal = document.createElement('div')
        modal.id = 'date-range-modal'
        return modal
    }),
}))

function createDOMContainer() {
    const div = document.createElement('div')
    div.innerHTML = `
        <div class="page">
            <button id="prev-period-btn"></button>
            <h1 id="records-header-title"></h1>
            <button id="next-period-btn"></button>
            <input type="text" id="records-search-input">
            <div id="records-period-filter">
                <button class="period-btn" data-period="week">週</button>
                <button class="period-btn" data-period="month">月</button>
                <button class="period-btn" data-period="year">年</button>
                <button class="period-btn" data-period="custom">自訂</button>
            </div>
            <div id="records-type-filter">
                <button class="type-btn" data-type="all"></button>
                <button class="type-btn" data-type="expense"></button>
                <button class="type-btn" data-type="income"></button>
            </div>
            <button id="records-category-filter-btn"></button>
            <button id="records-account-filter-btn" class="hidden"></button>
            <div id="record-count">0</div>
            <div id="total-income">$0</div>
            <div id="total-expense">$0</div>
            <div id="records-list-container"></div>
            <div id="records-modals-container"></div>
        </div>
    `
    return div.querySelector('.page')
}

function createMockDataService() {
    const settings = {}
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async key =>
            settings[key] ? { key, value: settings[key] } : null
        ),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value
            return true
        }),
        getAccounts: vi.fn().mockResolvedValue([]),
        getRecords: vi.fn().mockResolvedValue([]),
        getDebt: vi.fn().mockResolvedValue(null),
        getDebts: vi.fn().mockResolvedValue([]),
    }
}

describe('RecordsListManager - 明細預設時間範圍', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = { getCategories: vi.fn().mockReturnValue([]) }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('預設無任何設定與 Session 快取時，預設為本月', async () => {
        await manager.init()
        expect(manager.filters.period).toBe('month')
        expect(manager.filters.customStartDate).toBe('2026-06-01')
        expect(manager.filters.customEndDate).toBe('2026-06-30')
        expect(
            container
                .querySelector('.period-btn[data-period="month"]')
                .classList.contains('bg-wabi-surface')
        ).toBe(true)
    })

    it('設定預設時間為「本週」時，載入本週時間區間並高亮週按鈕', async () => {
        await dataService.saveSetting({
            key: 'defaultRecordsPeriod',
            value: 'week',
        })
        await manager.init()
        expect(manager.filters.period).toBe('week')
        expect(manager.filters.customStartDate).toBe('2026-06-28')
        expect(
            container
                .querySelector('.period-btn[data-period="week"]')
                .classList.contains('bg-wabi-surface')
        ).toBe(true)
    })

    it('設定預設時間為「今天」時，載入今天時間並高亮自訂按鈕', async () => {
        await dataService.saveSetting({
            key: 'defaultRecordsPeriod',
            value: 'today',
        })
        await manager.init()
        expect(manager.filters.period).toBe('today')
        expect(manager.filters.customStartDate).toBe('2026-06-30')
        expect(
            container
                .querySelector('.period-btn[data-period="custom"]')
                .classList.contains('bg-wabi-surface')
        ).toBe(true)
    })

    it('設定預設時間為「近 7 天」時，載入近 7 天時間並高亮自訂按鈕', async () => {
        await dataService.saveSetting({
            key: 'defaultRecordsPeriod',
            value: 'last7days',
        })
        await manager.init()
        expect(manager.filters.period).toBe('last7days')
        expect(
            container
                .querySelector('.period-btn[data-period="custom"]')
                .classList.contains('bg-wabi-surface')
        ).toBe(true)
    })

    it('設定預設時間為「上次時間範圍」時，載入上次時間範圍紀錄', async () => {
        await dataService.saveSetting({
            key: 'defaultRecordsPeriod',
            value: 'last',
        })
        await dataService.saveSetting({
            key: 'lastRecordsPeriodState',
            value: {
                period: 'custom',
                customStartDate: '2026-06-10',
                customEndDate: '2026-06-20',
            },
        })
        await manager.init()
        expect(manager.filters.period).toBe('custom')
        expect(manager.filters.customStartDate).toBe('2026-06-10')
        expect(
            container
                .querySelector('.period-btn[data-period="custom"]')
                .classList.contains('bg-wabi-surface')
        ).toBe(true)
    })

    it('優先讀取 session 暫存的過濾條件，而非預設設定', async () => {
        sessionStorage.setItem(
            'jijun_records_filters',
            JSON.stringify({
                period: 'week',
                type: 'expense',
                categories: [],
                accounts: [],
                customStartDate: '2026-06-28',
                customEndDate: '2026-07-04',
                searchQuery: '測試',
            })
        )
        await dataService.saveSetting({
            key: 'defaultRecordsPeriod',
            value: 'month',
        })
        await manager.init()
        expect(manager.filters.period).toBe('week')
        expect(manager.filters.searchQuery).toBe('測試')
    })
})

describe('RecordsListManager - 轉帳抵消與摘要計算', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = {
            getCategoryById: vi
                .fn()
                .mockReturnValue({
                    name: '伙食',
                    icon: 'fa-solid fa-utensils',
                    color: '#f97316',
                }),
        }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('轉帳配對成功時從摘要中排除', async () => {
        const transfers = [
            {
                id: 1,
                type: 'expense',
                category: 'transfer',
                amount: 500,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'income',
                category: 'transfer',
                amount: 500,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(transfers)
        await manager.init()
        expect(container.querySelector('#total-expense').textContent).toBe('$0')
        expect(container.querySelector('#total-income').textContent).toBe('$0')
    })

    it('轉帳配對失敗時保留在摘要中', async () => {
        const transfers = [
            {
                id: 1,
                type: 'expense',
                category: 'transfer',
                amount: 500,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'income',
                category: 'transfer',
                amount: 300,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(transfers)
        await manager.init()
        expect(container.querySelector('#total-expense').textContent).toBe(
            '$500'
        )
        expect(container.querySelector('#total-income').textContent).toBe(
            '$300'
        )
    })

    it('普通紀錄正常計算摘要', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '午餐',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'income',
                category: 'salary',
                amount: 5000,
                date: '2026-06-01',
                description: '薪水',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        await manager.init()
        expect(container.querySelector('#total-expense').textContent).toBe(
            '$200'
        )
        expect(container.querySelector('#total-income').textContent).toBe(
            '$5,000'
        )
    })
})

describe('RecordsListManager - 搜尋與類型過濾', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = {
            getCategoryById: vi
                .fn()
                .mockReturnValue({
                    name: '伙食',
                    icon: 'fa-solid fa-utensils',
                    color: '#f97316',
                }),
        }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('搜尋描述關鍵字會過濾紀錄', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '午餐便當',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'expense',
                category: 'food',
                amount: 300,
                date: '2026-06-16',
                description: '晚餐燒烤',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        await manager.init()
        manager.filters.searchQuery = '午餐'
        manager.applyFiltersAndRender()
        expect(container.querySelector('#record-count').textContent).toBe('1')
    })

    it('類型過濾為 expense 時只顯示支出', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'income',
                category: 'salary',
                amount: 5000,
                date: '2026-06-01',
                description: '',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        await manager.init()
        manager.filters.type = 'expense'
        manager.applyFiltersAndRender()
        expect(container.querySelector('#record-count').textContent).toBe('1')
    })
})

describe('RecordsListManager - 日期區間推移', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = { getCategories: vi.fn().mockReturnValue([]) }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('按下上一個月按鈕，日期往後退一個月', async () => {
        await manager.init()
        manager.filters.customStartDate = '2026-06-01'
        manager.filters.customEndDate = '2026-06-30'
        manager.shiftDateRange(-1)
        expect(manager.filters.customStartDate).toBe('2026-05-01')
        expect(manager.filters.period).toBe('custom')
    })

    it('按下下一個月按鈕，日期往前推一個月', async () => {
        await manager.init()
        manager.filters.customStartDate = '2026-06-01'
        manager.filters.customEndDate = '2026-06-30'
        manager.shiftDateRange(1)
        expect(manager.filters.customStartDate).toBe('2026-07-01')
    })

    it('年期間推移時以年為單位', async () => {
        await manager.init()
        manager.filters.period = 'year'
        manager.filters.customStartDate = '2026-01-01'
        manager.shiftDateRange(-1)
        expect(manager.filters.customStartDate).toBe('2025-01-01')
    })
})

describe('RecordsListManager - 標題顯示邏輯', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = { getCategories: vi.fn().mockReturnValue([]) }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('顯示某月初到月底時格式為「YYYY年MM月」', () => {
        manager.filters.customStartDate = '2026-06-01'
        manager.filters.customEndDate = '2026-06-30'
        manager.updateHeaderTitle()
        expect(
            container.querySelector('#records-header-title').textContent
        ).toBe('2026年6月')
    })

    it('同月非整月時顯示日期範圍', () => {
        manager.filters.customStartDate = '2026-06-10'
        manager.filters.customEndDate = '2026-06-20'
        manager.updateHeaderTitle()
        expect(
            container.querySelector('#records-header-title').textContent
        ).toBe('2026年6月10號 ~ 20號')
    })

    it('跨月時顯示完整月份範圍', () => {
        manager.filters.customStartDate = '2026-06-25'
        manager.filters.customEndDate = '2026-07-05'
        manager.updateHeaderTitle()
        expect(
            container.querySelector('#records-header-title').textContent
        ).toBe('2026年6月25號 ~ 7月5號')
    })

    it('跨年時顯示年份資訊', () => {
        manager.filters.customStartDate = '2025-12-25'
        manager.filters.customEndDate = '2026-01-05'
        manager.updateHeaderTitle()
        expect(
            container.querySelector('#records-header-title').textContent
        ).toBe('2025年12月25號 ~ 2026年1月5號')
    })
})

describe('RecordsListManager - Session 過濾器管理', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = { getCategories: vi.fn().mockReturnValue([]) }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('_saveSessionFilters 正確儲存至 sessionStorage', () => {
        manager.filters.type = 'expense'
        manager.filters.categories.add('food')
        manager._saveSessionFilters()
        const raw = sessionStorage.getItem('jijun_records_filters')
        const data = JSON.parse(raw)
        expect(data.type).toBe('expense')
        expect(data.categories).toEqual(['food'])
    })

    it('_loadSessionFilters 回傳 Set 物件', () => {
        sessionStorage.setItem(
            'jijun_records_filters',
            JSON.stringify({
                period: 'week',
                type: 'all',
                categories: ['food'],
                accounts: [],
                customStartDate: null,
                customEndDate: null,
                searchQuery: '',
            })
        )
        const loaded = manager._loadSessionFilters()
        expect(loaded.categories instanceof Set).toBe(true)
        expect(loaded.categories.has('food')).toBe(true)
    })

    it('_loadSessionFilters 無資料時回傳 null', () => {
        expect(manager._loadSessionFilters()).toBeNull()
    })

    it('hashchange 觸發 _saveSessionFilters', async () => {
        await manager.init()
        // Verify the hashchange handler is registered by checking the saved state
        manager.filters.type = 'expense'
        // Simulate hashchange
        window.dispatchEvent(new HashChangeEvent('hashchange'))
        const savedAfter = sessionStorage.getItem('jijun_records_filters')
        // The handler should have saved the session filters
        expect(savedAfter).not.toBeNull()
        const data = JSON.parse(savedAfter)
        expect(data.type).toBe('expense')
    })
})

describe('RecordsListManager - 欠款顯示邏輯', () => {
    let container, dataService, categoryManager, manager

    beforeEach(() => {
        sessionStorage.clear()
        container = createDOMContainer()
        dataService = createMockDataService()
        categoryManager = {
            getCategoryById: vi
                .fn()
                .mockReturnValue({
                    name: '伙食',
                    icon: 'fa-solid fa-utensils',
                    color: '#f97316',
                }),
        }
        manager = new RecordsListManager(
            dataService,
            categoryManager,
            container
        )
    })

    afterEach(() => {
        window.removeEventListener('beforeunload', manager._saveSessionFilters)
    })

    it('未結清欠款顯示待還款狀態', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 500,
                date: '2026-06-15',
                description: '',
                debtId: 1,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        dataService.getDebts.mockResolvedValueOnce([
            {
                id: 1,
                type: 'receivable',
                settled: false,
                originalAmount: 200,
            }
        ])
        await manager.init()
        expect(
            container.querySelector('#records-list-container').textContent
        ).toContain('待還款')
    })

    it('已結清欠款顯示已還清狀態', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 500,
                date: '2026-06-15',
                description: '',
                debtId: 1,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        dataService.getDebts.mockResolvedValueOnce([
            {
                id: 1,
                type: 'receivable',
                settled: true,
                originalAmount: 200,
            }
        ])
        await manager.init()
        expect(
            container.querySelector('#records-list-container').textContent
        ).toContain('已還清')
    })

    it('欠款回收和償還類別不計入摘要', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'debt_repayment',
                amount: 1000,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 2,
                type: 'income',
                category: 'debt_collection',
                amount: 2000,
                date: '2026-06-16',
                description: '',
                debtId: null,
                amortizationId: null,
            },
            {
                id: 3,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '',
                debtId: null,
                amortizationId: null,
            },
        ]
        dataService.getRecords.mockResolvedValueOnce(records)
        await manager.init()
        expect(container.querySelector('#total-expense').textContent).toBe(
            '$200'
        )
        expect(container.querySelector('#total-income').textContent).toBe('$0')
    })
})

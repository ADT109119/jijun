// ==================== BudgetManager 單元測試 ====================
// 測試重點：預算加載、儲存、預算狀態計算、分類預算排序
// BudgetManager 的 UI 方法 (renderBudgetWidget, showBudgetModal) 不在此測試
// 因為它們依賴完整的 DOM 與 window.app，適合 E2E 測試

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock SortableJS (BudgetManager 依賴)
vi.mock('sortablejs', () => ({
    default: class SortableMock {
        constructor(el, opts) {
            this.el = el
            this.opts = opts
        }
        destroy() {}
    },
}))

// Mock utils.js 的函數
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn(v => `NT$${Math.round(v)}`),
    getDateRange: vi.fn((period, offsetMonths = 0) => {
        // #AB4：monthOffset 以 2024-01 為基準月（offset=0），與 'month' 一致
        if (period === 'month' || (period === 'monthOffset' && offsetMonths === 0)) {
            return { startDate: '2024-01-01', endDate: '2024-01-31' }
        }
        if (period === 'monthOffset') {
            const baseYear = 2024
            const baseMonthIndex = 0 // 2024-01
            const targetMonthIndex = baseMonthIndex + offsetMonths
            const y = baseYear + Math.floor(targetMonthIndex / 12)
            const m = ((targetMonthIndex % 12) + 12) % 12
            const lastDay = new Date(y, m + 1, 0).getDate()
            return {
                startDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
                endDate: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
            }
        }
        return { startDate: '2024-01-01', endDate: '2024-01-31' }
    }),
    showToast: vi.fn(),
    escapeHTML: vi.fn(s => s),
    // #SEC04：getSafeIconClass 以真實語意提供（白名單外一律 fallback）
    getSafeIconClass: (icon, fallback = 'fa-solid fa-circle-question') =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(icon.trim())
            ? icon.trim()
            : fallback,
}))

import { BudgetManager } from '../../src/js/budgetManager.js'

// 建立最小化的 DataService mock
function createMockDataService() {
    const settings = {}
    const changes = []
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async key => {
            return settings[key] ? { key, value: settings[key] } : null
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value
            return true
        }),
        logChange: vi.fn((type, key, val, payload) => {
            changes.push({ type, key, val, payload })
        }),
        getStatistics: vi.fn(async () => ({
            totalExpense: 0,
            totalIncome: 0,
            expenseByCategory: {},
        })),
    }
}

describe('BudgetManager', () => {
    let bm, ds

    beforeEach(() => {
        localStorage.clear()
        ds = createMockDataService()
        bm = new BudgetManager(ds)
    })

    afterEach(() => {
        bm.closeBudgetModal()
    })

    // ==================== Constructor ====================

    describe('constructor', () => {
        it('初始值正確', () => {
            expect(bm.currentBudget).toBe(0)
            expect(bm.categoryBudgets).toEqual({})
            expect(bm.categoryBudgetOrder).toEqual([])
            expect(bm.excludedBudgetCategories).toEqual([])
        })

        it('持有 dataService 引用', () => {
            expect(bm.dataService).toBe(ds)
        })
    })

    // ==================== loadBudget ====================

    describe('loadBudget', () => {
        it('無資料時預設為 0', async () => {
            await bm.loadBudget()
            expect(bm.currentBudget).toBe(0)
            expect(bm.categoryBudgets).toEqual({})
        })

        it('從 IndexedDB 讀取預算', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 10000,
                    categoryBudgets: { food: 3000 },
                    categoryBudgetOrder: ['food'],
                },
            })

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(10000)
            expect(bm.categoryBudgets).toEqual({ food: 3000 })
            expect(bm.categoryBudgetOrder).toEqual(['food'])
        })

        it('從 localStorage fallback 讀取', async () => {
            ds.getSetting.mockResolvedValueOnce(null)
            localStorage.setItem('monthlyBudget_1', '5000')
            localStorage.setItem(
                'categoryBudgets_1',
                JSON.stringify({ transport: 2000 })
            )
            localStorage.setItem(
                'categoryBudgetOrder_1',
                JSON.stringify(['transport'])
            )

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(5000)
            expect(bm.categoryBudgets).toEqual({ transport: 2000 })
        })

        it('IndexedDB 失敗時不崩潰', async () => {
            ds.getSetting.mockRejectedValueOnce(new Error('DB error'))
            localStorage.clear()

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(0)
            expect(bm.categoryBudgets).toEqual({})
        })

        it('從 IndexedDB 讀取成功後同步寫入 localStorage 快照', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 12000,
                    categoryBudgets: { food: 4000 },
                    categoryBudgetOrder: ['food'],
                    excludedBudgetCategories: ['investment'],
                },
            })

            await bm.loadBudget()

            expect(localStorage.getItem('monthlyBudget_1')).toBe('12000')
            expect(JSON.parse(localStorage.getItem('categoryBudgets_1'))).toEqual({ food: 4000 })
        })

        it('當 activeLedgerId 非 1 但為第一主帳本時，讀取不到可 fallback 至全域 budget_settings', async () => {
            ds.activeLedgerId = 2
            ds.getLedgers = vi.fn().mockResolvedValue([{ id: 2, name: '主帳本' }])
            ds.getSetting.mockImplementation(async key => {
                if (key === 'budget_settings_2') return null
                if (key === 'budget_settings') {
                    return {
                        key: 'budget_settings',
                        value: {
                            monthlyBudget: 20000,
                            categoryBudgets: {},
                        },
                    }
                }
                return null
            })

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(20000)
            expect(localStorage.getItem('monthlyBudget_2')).toBe('20000')
        })

        it('預算值與分類預算非數字時，防禦回退為 0', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 'not_a_number',
                    categoryBudgets: { food: 'invalid_val' },
                    categoryBudgetOrder: [],
                },
            })

            await bm.loadBudget()
            expect(bm.currentBudget).toBe(0)
            expect(bm.categoryBudgets).toEqual({ food: 0 })
        })

        // ==================== #BUDGET-KEY-H5：localStorage fallback 主帳本守門 ====================

        it('#BUDGET-KEY-H5 非主帳本不得撿全域 legacy 預算（未設預算的新帳本保持 0）', async () => {
            ds.activeLedgerId = 2
            ds.getLedgers = vi
                .fn()
                .mockResolvedValue([{ id: 1, name: '主帳本' }, { id: 2, name: '新帳本' }])
            // 只有 legacy 全域鍵（無後綴）存在預算——屬主帳本時代遺留
            localStorage.setItem('monthlyBudget', '5000')
            localStorage.setItem('categoryBudgets', JSON.stringify({ food: 3000 }))

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(0)
            expect(bm.categoryBudgets).toEqual({})
            // 未被污染固化：不會把全域預算存成新帳本的正式預算
            expect(ds.saveSetting).not.toHaveBeenCalled()
        })

        it('#BUDGET-KEY-H5 主帳本保留全域 legacy 預算遷移退回（id=1）', async () => {
            // activeLedgerId=1（預設 mock）→ 主帳本
            localStorage.setItem('monthlyBudget', '5000')

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(5000)
        })

        it('#BUDGET-KEY-H5 非主帳本讀自己後綴鍵的正常路徑不受影響', async () => {
            ds.activeLedgerId = 2
            ds.getLedgers = vi
                .fn()
                .mockResolvedValue([{ id: 1, name: '主帳本' }, { id: 2, name: '新帳本' }])
            localStorage.setItem('monthlyBudget_2', '3000')
            localStorage.setItem(
                'categoryBudgets_2',
                JSON.stringify({ transport: 1000 })
            )

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(3000)
            expect(bm.categoryBudgets).toEqual({ transport: 1000 })
        })

        it('#BUDGET-KEY-H5 getLedgers 拋錯時保守視為非主帳本，不 fallback 全域', async () => {
            ds.activeLedgerId = 2
            ds.getLedgers = vi.fn().mockRejectedValue(new Error('DB down'))
            localStorage.setItem('monthlyBudget', '5000')

            await bm.loadBudget()

            expect(bm.currentBudget).toBe(0)
        })
    })

    // ==================== saveBudget ====================

    describe('saveBudget', () => {
        it('儲存成功回傳 true', async () => {
            const result = await bm.saveBudget(8000)
            expect(result).toBe(true)
            expect(bm.currentBudget).toBe(8000)
        })

        it('同時儲存分類預算', async () => {
            const cats = { food: 3000, transport: 2000 }
            const order = ['food', 'transport']
            const result = await bm.saveBudget(10000, cats, order)

            expect(result).toBe(true)
            expect(bm.categoryBudgets).toEqual(cats)
            expect(bm.categoryBudgetOrder).toEqual(order)
        })

        it('呼叫 dataService.saveSetting 與 logChange', async () => {
            await bm.saveBudget(10000, { food: 3000 }, ['food'])

            expect(ds.saveSetting).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: 'budget_settings_1',
                    value: expect.objectContaining({
                        monthlyBudget: 10000,
                        categoryBudgets: { food: 3000 },
                    }),
                })
            )
            expect(ds.logChange).toHaveBeenCalled()
        })

        it('skipLog=true 時不呼叫 logChange', async () => {
            await bm.saveBudget(5000, {}, [], [], true)
            expect(ds.logChange).not.toHaveBeenCalled()
        })

        it('dataService 出錯時回傳 false', async () => {
            ds.saveSetting.mockRejectedValueOnce(new Error('save failed'))
            const result = await bm.saveBudget(10000)
            expect(result).toBe(false)
        })

        it('寫入 localStorage 備份', async () => {
            await bm.saveBudget(7000, { food: 2000 }, ['food'])

            expect(localStorage.getItem('monthlyBudget_1')).toBe('7000')
            expect(
                JSON.parse(localStorage.getItem('categoryBudgets_1'))
            ).toEqual({ food: 2000 })
        })

        it('localStorage.setItem 失敗時，不影響 IndexedDB 的正常儲存', async () => {
            const originalSetItem = localStorage.setItem
            localStorage.setItem = vi.fn(() => {
                throw new Error('QuotaExceededError')
            })

            try {
                const result = await bm.saveBudget(10000, { food: 3000 }, ['food'])
                expect(result).toBe(true)
                expect(ds.saveSetting).toHaveBeenCalled()
            } finally {
                localStorage.setItem = originalSetItem
            }
        })
    })

    // ==================== getBudgetStatus ====================

    describe('getBudgetStatus', () => {
        it('零預算回傳正確狀態', async () => {
            const status = await bm.getBudgetStatus()
            expect(status.budget).toBe(0)
            expect(status.spent).toBe(0)
            expect(status.remaining).toBe(0)
            expect(status.percentage).toBe(0)
            expect(status.isOverBudget).toBe(false)
        })

        it('預算 > 0 且無支出', async () => {
            bm.currentBudget = 10000
            const status = await bm.getBudgetStatus()

            expect(status.budget).toBe(10000)
            expect(status.spent).toBe(0)
            expect(status.remaining).toBe(10000)
            expect(status.percentage).toBe(0)
        })

        it('支出 < 預算', async () => {
            bm.currentBudget = 10000
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 6000,
                totalIncome: 15000,
                expenseByCategory: { food: 3000 },
            })

            const status = await bm.getBudgetStatus()

            expect(status.spent).toBe(6000)
            expect(status.remaining).toBe(4000)
            expect(status.percentage).toBe(60)
            expect(status.isOverBudget).toBe(false)
        })

        it('支出 > 預算', async () => {
            bm.currentBudget = 5000
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 7000,
                totalIncome: 0,
                expenseByCategory: {},
            })

            const status = await bm.getBudgetStatus()

            expect(status.budget).toBe(5000)
            expect(status.spent).toBe(7000)
            expect(status.isOverBudget).toBe(true)
            expect(status.remaining).toBe(0)
            expect(status.percentage).toBe(100)
        })

        it('分類預算狀態正確計算', async () => {
            bm.currentBudget = 10000
            bm.categoryBudgets = { food: 3000, transport: 2000 }
            bm.categoryBudgetOrder = ['food', 'transport']

            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 5000,
                totalIncome: 0,
                expenseByCategory: { food: 2500, transport: 1800 },
            })

            // Mock window.app.categoryManager
            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn((type, id) => {
                        const map = {
                            food: { name: '餐飲', icon: 'fa-utensils' },
                            transport: { name: '交通', icon: 'fa-car' },
                        }
                        return map[id] || null
                    }),
                },
            }

            const status = await bm.getBudgetStatus()

            expect(status.categoryStatuses).toHaveLength(2)
            expect(status.categoryStatuses[0].categoryId).toBe('food')
            expect(status.categoryStatuses[0].spent).toBe(2500)
            expect(status.categoryStatuses[0].percentage).toBeCloseTo(83.33, 1)
            expect(status.categoryStatuses[1].categoryId).toBe('transport')
            expect(status.categoryStatuses[1].isOverBudget).toBe(false)
        })

        it('分類超預算時 isOverBudget=true', async () => {
            bm.currentBudget = 10000
            bm.categoryBudgets = { food: 2000 }
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 3000,
                expenseByCategory: { food: 2500 },
            })

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn(() => ({ name: 'food', icon: '' })),
                },
            }

            const status = await bm.getBudgetStatus()
            expect(status.categoryStatuses[0].isOverBudget).toBe(true)
        })

        it('分類預算排序：依 custom order', async () => {
            bm.currentBudget = 10000
            bm.categoryBudgets = { a: 1000, b: 2000, c: 3000 }
            bm.categoryBudgetOrder = ['c', 'a', 'b']

            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 0,
                expenseByCategory: { a: 500, b: 500, c: 500 },
            })

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn((_, id) => ({ name: id, icon: '' })),
                },
            }

            const status = await bm.getBudgetStatus()
            const ids = status.categoryStatuses.map(s => s.categoryId)
            expect(ids).toEqual(['c', 'a', 'b'])
        })

        it('分類預算 = 0 時跳過', async () => {
            bm.currentBudget = 10000
            bm.categoryBudgets = { food: 3000, skip: 0 }
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 1000,
                expenseByCategory: { food: 1000 },
            })

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn(() => ({ name: 'x', icon: '' })),
                },
            }

            const status = await bm.getBudgetStatus()
            expect(status.categoryStatuses).toHaveLength(1)
            expect(status.categoryStatuses[0].categoryId).toBe('food')
        })

        it('排除類別從總支出中扣除', async () => {
            bm.currentBudget = 10000
            bm.excludedBudgetCategories = ['food']
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 8000,
                expenseByCategory: { food: 3000, transport: 5000 },
            })

            const status = await bm.getBudgetStatus()
            expect(status.spent).toBe(5000) // 8000 - 3000 (excluded food)
            expect(status.remaining).toBe(5000)
        })

        it('排除類別的分類標記 isExcluded=true', async () => {
            bm.currentBudget = 10000
            bm.categoryBudgets = { food: 3000, transport: 2000 }
            bm.excludedBudgetCategories = ['food']
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 5000,
                expenseByCategory: { food: 2500, transport: 2500 },
            })

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn((_, id) => ({ name: id, icon: '' })),
                },
            }

            const status = await bm.getBudgetStatus()
            const foodStatus = status.categoryStatuses.find(
                s => s.categoryId === 'food'
            )
            const transportStatus = status.categoryStatuses.find(
                s => s.categoryId === 'transport'
            )
            expect(foodStatus.isExcluded).toBe(true)
            expect(transportStatus.isExcluded).toBe(false)
        })

        it('排除類別扣完後 spent 不低於 0', async () => {
            bm.currentBudget = 10000
            bm.excludedBudgetCategories = ['food']
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 2000,
                expenseByCategory: { food: 3000 },
            })

            const status = await bm.getBudgetStatus()
            expect(status.spent).toBe(0) // Math.max(0, 2000 - 3000) = 0
        })
    })

    // ==================== Excluded Budget Categories ====================

    describe('excludedBudgetCategories', () => {
        it('loadBudget 從 IndexedDB 讀取排除類別', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 10000,
                    categoryBudgets: {},
                    categoryBudgetOrder: [],
                    excludedBudgetCategories: ['food', 'traffic'],
                },
            })

            await bm.loadBudget()
            expect(bm.excludedBudgetCategories).toEqual(['food', 'traffic'])
        })

        it('loadBudget 從 localStorage fallback 讀取排除類別', async () => {
            ds.getSetting.mockResolvedValueOnce(null)
            localStorage.setItem('monthlyBudget_1', '5000')
            localStorage.setItem('categoryBudgets_1', '{}')
            localStorage.setItem('categoryBudgetOrder_1', '[]')
            localStorage.setItem(
                'excludedBudgetCategories_1',
                JSON.stringify(['life'])
            )

            await bm.loadBudget()
            expect(bm.excludedBudgetCategories).toEqual(['life'])
        })

        it('loadBudget catch 時重置 excludedBudgetCategories', async () => {
            ds.getSetting.mockRejectedValueOnce(new Error('DB error'))
            bm.excludedBudgetCategories = ['food']

            await bm.loadBudget()
            expect(bm.excludedBudgetCategories).toEqual([])
        })

        it('saveBudget 儲存排除類別', async () => {
            await bm.saveBudget(10000, {}, [], ['food', 'traffic'])

            expect(bm.excludedBudgetCategories).toEqual(['food', 'traffic'])
            expect(localStorage.getItem('excludedBudgetCategories_1')).toBe(
                JSON.stringify(['food', 'traffic'])
            )
            expect(ds.saveSetting).toHaveBeenCalledWith(
                expect.objectContaining({
                    value: expect.objectContaining({
                        excludedBudgetCategories: ['food', 'traffic'],
                    }),
                })
            )
        })

        it('saveBudget 不傳 excludedBudgetCategories 時不覆蓋', async () => {
            bm.excludedBudgetCategories = ['food']
            await bm.saveBudget(10000)

            expect(bm.excludedBudgetCategories).toEqual(['food'])
        })

        it('loadBudget 與 saveBudget 對排除類別進行去重', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 10000,
                    categoryBudgets: {},
                    categoryBudgetOrder: [],
                    excludedBudgetCategories: ['food', 'food', 'traffic'],
                },
            })

            await bm.loadBudget()
            expect(bm.excludedBudgetCategories).toEqual(['food', 'traffic'])

            await bm.saveBudget(10000, {}, [], ['traffic', 'traffic', 'food'])
            expect(bm.excludedBudgetCategories).toEqual(['traffic', 'food'])
        })
    })

    // ==================== checkBudgetWarning ====================

    describe('checkBudgetWarning', () => {
        it('當分類預算總和小於等於全局預算時，回傳 false', () => {
            const isWarning = bm.checkBudgetWarning(10000, { food: 3000, traffic: 2000 })
            expect(isWarning).toBe(false)
        })

        it('當分類預算總和大於全局預算時，回傳 true', () => {
            const isWarning = bm.checkBudgetWarning(4000, { food: 3000, traffic: 2000 })
            expect(isWarning).toBe(true)
        })

        it('當全局預算為 0 時，不觸發警報（回傳 false）', () => {
            const isWarning = bm.checkBudgetWarning(0, { food: 3000 })
            expect(isWarning).toBe(false)
        })
    })

    // ==================== closeBudgetModal ====================

    describe('closeBudgetModal', () => {
        it('移除 DOM 中的彈窗', () => {
            const modal = document.createElement('div')
            modal.id = 'budget-modal'
            document.body.appendChild(modal)

            bm.closeBudgetModal()
            expect(document.getElementById('budget-modal')).toBeNull()
        })

        it('無彈窗時不報錯', () => {
            expect(() => bm.closeBudgetModal()).not.toThrow()
        })
    })

    // ==================== #AB4：月份偏移（未來月份預覽） ====================

    describe('getBudgetStatus 月份偏移 (#AB4)', () => {
        it('offset=0 時與原行為一致（2024-01 範圍、本月標籤）', async () => {
            bm.currentBudget = 10000
            const status = await bm.getBudgetStatus(0)

            expect(ds.getStatistics).toHaveBeenCalledWith(
                '2024-01-01',
                '2024-01-31',
                null,
                true
            )
            expect(status.offsetMonths).toBe(0)
            expect(status.isPreview).toBe(false)
            expect(status.monthLabel).toBe('本月')
        })

        it('offset=1 時查詢下月範圍（2024-02，含閏年 29 天）', async () => {
            bm.currentBudget = 10000
            const status = await bm.getBudgetStatus(1)

            expect(ds.getStatistics).toHaveBeenCalledWith(
                '2024-02-01',
                '2024-02-29',
                null,
                true
            )
            expect(status.offsetMonths).toBe(1)
            expect(status.isPreview).toBe(true)
            // monthLabel 用系統真實日期計算（與 mock 的 2024-01 基準不同月），只驗格式
            expect(status.monthLabel).toMatch(/\d{4}年\d{1,2}月/)
        })

        it('offset=12 跨年（mock 基準 2024-01 + 12 = 2025-01）', async () => {
            bm.currentBudget = 5000
            const status = await bm.getBudgetStatus(12)

            expect(ds.getStatistics).toHaveBeenCalledWith(
                '2025-01-01',
                '2025-01-31',
                null,
                true
            )
            expect(status.offsetMonths).toBe(12)
            expect(status.isPreview).toBe(true)
            expect(status.monthLabel).toMatch(/\d{4}年\d{1,2}月/)
        })

        it('未來月份支出為 0 時 remaining=budget、percentage=0', async () => {
            bm.currentBudget = 8000
            ds.getStatistics.mockResolvedValue({
                totalExpense: 0,
                totalIncome: 0,
                expenseByCategory: {},
            })
            const status = await bm.getBudgetStatus(3)

            expect(status.spent).toBe(0)
            expect(status.remaining).toBe(8000)
            expect(status.percentage).toBe(0)
            expect(status.isOverBudget).toBe(false)
        })

        it('不傳參時等同 offset=0（欄位齊全）', async () => {
            bm.currentBudget = 10000
            const status = await bm.getBudgetStatus()

            expect(status.offsetMonths).toBe(0)
            expect(status.isPreview).toBe(false)
            expect(status.monthLabel).toBe('本月')
            expect(ds.getStatistics).toHaveBeenCalledWith(
                '2024-01-01',
                '2024-01-31',
                null,
                true
            )
        })
    })

    describe('renderBudgetWidget 月份選擇器 (#AB4)', () => {
        beforeEach(() => {
            ds.getStatistics.mockResolvedValue({
                totalExpense: 5000,
                totalIncome: 0,
                expenseByCategory: {},
            })
        })

        afterEach(() => {
            bm.closeBudgetMonthPickerModal()
        })

        it('budget>0 時 HTML 包含月份選擇按鈕', async () => {
            bm.currentBudget = 10000
            const html = await bm.renderBudgetWidget()

            expect(html).toContain('id="budget-month-btn"')
            expect(html).toContain('fa-calendar')
            expect(html).toContain('id="edit-budget-btn"')
            // 月份選擇 Modal 未開啟時不在 widget HTML 中
            expect(html).not.toContain('budget-month-select')
        })

        it('預覽月份（offset>0）時 HTML 包含提示文字', async () => {
            bm.currentBudget = 10000
            bm.budgetMonthOffset = 1
            const html = await bm.renderBudgetWidget()

            expect(html).toContain('尚未來臨的月份')
        })

        it('本月（offset=0）時 HTML 不含預覽提示', async () => {
            bm.currentBudget = 10000
            bm.budgetMonthOffset = 0
            const html = await bm.renderBudgetWidget()

            expect(html).not.toContain('尚未來臨的月份')
        })

        it('renderBudgetWidget 的 RAF 綁定會在下一 frame 後掛上 budget-month-btn.onclick（防死碼回歸）', async () => {
            bm.currentBudget = 10000
            const html = await bm.renderBudgetWidget()

            // 模擬 homePage 的 DOM 插入
            const host = document.createElement('div')
            host.innerHTML = html
            document.body.appendChild(host)

            // RAF 回呼在下一 frame 執行，等待其完成
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

            const btn = document.getElementById('budget-month-btn')
            expect(btn).not.toBeNull()
            expect(typeof btn.onclick).toBe('function')

            // 觸發 onclick：月份選擇 Modal 應開啟
            btn.onclick()
            await new Promise(resolve => setTimeout(resolve, 0))
            expect(document.getElementById('budget-month-picker-modal')).not.toBeNull()

            // 清理
            bm.closeBudgetMonthPickerModal()
            host.remove()
        })

        it('月份選擇 Modal：確認選定後回呼新 offset', async () => {
            bm.currentBudget = 10000
            const onSelect = vi.fn()
            bm.showBudgetMonthPickerModal(onSelect)

            const modal = document.getElementById('budget-month-picker-modal')
            expect(modal).not.toBeNull()

            const select = modal.querySelector('#budget-month-select')
            expect(select).not.toBeNull()
            // 選項：本月 + 11 個月 = 12 個
            expect(select.querySelectorAll('option')).toHaveLength(12)

            // 選 offset=2 並確認
            select.value = '2'
            modal.querySelector('#confirm-budget-month-btn').click()

            expect(bm.budgetMonthOffset).toBe(2)
            expect(onSelect).toHaveBeenCalledWith(2)
            expect(document.getElementById('budget-month-picker-modal')).toBeNull()
        })

        it('月份選擇 Modal：取消時不變更 offset', () => {
            bm.currentBudget = 10000
            bm.budgetMonthOffset = 0
            const onSelect = vi.fn()
            bm.showBudgetMonthPickerModal(onSelect)

            const modal = document.getElementById('budget-month-picker-modal')
            modal.querySelector('#cancel-budget-month-btn').click()

            expect(bm.budgetMonthOffset).toBe(0)
            expect(onSelect).not.toHaveBeenCalled()
            expect(document.getElementById('budget-month-picker-modal')).toBeNull()
        })
    })
})

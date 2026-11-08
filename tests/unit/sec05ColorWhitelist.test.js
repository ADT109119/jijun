// ==================== #SEC05 顏色渲染面白名單回歸測試 ====================
// 與 #SEC04 圖示白名單同根因：歷史分類/帳本資料（#CAT-SEC/#SEC04 入庫收口前
// 建立）可能帶有 `#fff;background-image:url(evil)` 或 `"><img src=x onerror=...>`
// 之類的髒 color，直接嵌入 `style="background-color: ${color}"` 即可逃脫屬性
// 注入 CSS 規則或 DOM。本輪統一收口的渲染面：
//   utils.getSafeBgColorStyle / getSafeHexColor / isSafeHexColor / isSafeBgClass
//   homePage（最近紀錄 + 帳本切換器）/ recordsList / quickSelectManager /
//   debtManager 群組詳情 / addPage 分類格 + 選中 UI / statistics 圖例 /
//   ledgerManager 入庫端（createLedger/updateLedger）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// chart.js 在 jsdom 無 canvas，mock 掉避免 getContext 噪音（同 statistics.test.js）
vi.mock('chart.js', () => {
    const mockChart = vi.fn(function () {
        return { destroy: vi.fn() }
    })
    mockChart.register = vi.fn()
    return { Chart: mockChart, registerables: [] }
})
vi.mock('chartjs-adapter-date-fns', () => ({}))

// debtManager 的 categories mock：分類名安全，顏色為注入 payload 本體
vi.mock('../../src/js/categories.js', () => ({
    getCategoryById: vi.fn(() => ({
        name: '餐飲',
        icon: 'fa-solid fa-utensils',
        color: '#fff;background-image:url(evil)',
    })),
}))

import {
    isSafeHexColor,
    isSafeBgClass,
    getSafeBgColorStyle,
    getSafeHexColor,
} from '../../src/js/utils.js'
import { RecordsListManager } from '../../src/js/recordsList.js'
import { QuickSelectManager } from '../../src/js/quickSelectManager.js'
import { DebtManager } from '../../src/js/debtManager.js'
import { HomePage } from '../../src/js/pages/homePage.js'
import { LedgerManager } from '../../src/js/ledgerManager.js'

const INJECT_HEX = '#fff;background-image:url(evil)'
const BREAKOUT = '"><img src=x onerror=alert(1)>'

// ==================== 1. utils 白名單純函數 ====================

describe('#SEC05 utils 顏色白名單純函數', () => {
    describe('isSafeHexColor', () => {
        it('接受 3/4/6/8 位 hex', () => {
            expect(isSafeHexColor('#fff')).toBe(true)
            expect(isSafeHexColor('#ffff')).toBe(true)
            expect(isSafeHexColor('#334A52')).toBe(true)
            expect(isSafeHexColor('#334A5280')).toBe(true)
        })
        it('拒絕 CSS 逃脫、breakout、非字串與空值', () => {
            expect(isSafeHexColor(INJECT_HEX)).toBe(false)
            expect(isSafeHexColor(BREAKOUT)).toBe(false)
            expect(isSafeHexColor('red')).toBe(false)
            expect(isSafeHexColor('bg-red-500')).toBe(false)
            expect(isSafeHexColor('')).toBe(false)
            expect(isSafeHexColor(null)).toBe(false)
            expect(isSafeHexColor(undefined)).toBe(false)
            expect(isSafeHexColor(123)).toBe(false)
        })
    })

    describe('isSafeBgClass', () => {
        it('接受 Tailwind bg-* class', () => {
            expect(isSafeBgClass('bg-gray-400')).toBe(true)
            expect(isSafeBgClass('bg-blue-500')).toBe(true)
            expect(isSafeBgClass('bg-emerald-500')).toBe(true)
        })
        it('拒絕 class breakout 與 hex', () => {
            expect(isSafeBgClass('bg-red-500 hidden" onclick="alert(1)')).toBe(
                false
            )
            expect(isSafeBgClass(BREAKOUT)).toBe(false)
            expect(isSafeBgClass('#fff')).toBe(false)
            expect(isSafeBgClass(null)).toBe(false)
        })
    })

    describe('getSafeBgColorStyle', () => {
        it('合法 hex → style 帶 background-color、className 空', () => {
            expect(getSafeBgColorStyle('#FF5733')).toEqual({
                style: 'background-color: #FF5733',
                className: '',
            })
        })
        it('合法 bg-* class → className 原值、style 空', () => {
            expect(getSafeBgColorStyle('bg-blue-400')).toEqual({
                style: '',
                className: 'bg-blue-400',
            })
        })
        it('髒值 → 雙空（不輸出任何顏色屬性）', () => {
            expect(getSafeBgColorStyle(INJECT_HEX)).toEqual({
                style: '',
                className: '',
            })
            expect(getSafeBgColorStyle(BREAKOUT)).toEqual({
                style: '',
                className: '',
            })
            expect(getSafeBgColorStyle(null)).toEqual({
                style: '',
                className: '',
            })
        })
    })

    describe('getSafeHexColor', () => {
        it('合法 hex 原值回傳', () => {
            expect(getSafeHexColor('#334A52')).toBe('#334A52')
        })
        it('白名單外退回 fallback（可自訂）', () => {
            expect(getSafeHexColor(INJECT_HEX)).toBe('#334A52')
            expect(getSafeHexColor(null, '#059669')).toBe('#059669')
            expect(getSafeHexColor('bg-red-500', '#059669')).toBe('#059669')
        })
    })
})

// ==================== 2. RecordsListManager 明細列 ====================

describe('RecordsListManager - #SEC05 明細列髒 color 渲染', () => {
    let manager, categoryManager

    beforeEach(() => {
        categoryManager = {
            getCategoryById: vi.fn(() => ({
                name: '髒分類',
                icon: 'fa-solid fa-tag',
                color: INJECT_HEX,
            })),
        }
        manager = new RecordsListManager(
            { getDebts: vi.fn(async () => []) },
            categoryManager,
            document.createElement('div')
        )
    })

    it('hex 逃脫值：不產生 style 內容、不產生 img 節點', () => {
        const html = manager._renderSingleRecord({
            id: 1,
            type: 'expense',
            category: 'evil',
            amount: 100,
            date: '2026-10-01',
            description: 'x',
        })
        expect(html).not.toContain('background-image')
        expect(html).not.toContain('url(evil)')
        expect(html).not.toContain('<img')
    })

    it('合法 hex 分類色仍正常輸出（零影響）', () => {
        categoryManager.getCategoryById = vi.fn(() => ({
            name: '餐飲',
            icon: 'fa-solid fa-utensils',
            color: '#FF5733',
        }))
        const html = manager._renderSingleRecord({
            id: 2,
            type: 'expense',
            category: 'food',
            amount: 100,
            date: '2026-10-01',
        })
        expect(html).toContain('background-color: #FF5733')
    })
})

// ==================== 3. QuickSelectManager 快速記帳膠囊 ====================

describe('QuickSelectManager - #SEC05 膠囊髒 color 渲染', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('hex 逃脫值：渲染 HTML 不含注入內容', () => {
        const qsm = new QuickSelectManager()
        qsm.addRecord('expense', 'evil', '午餐', null)
        const container = document.createElement('div')
        qsm.render(
            container,
            null,
            {
                getCategoryById: vi.fn(() => ({
                    name: '髒分類',
                    icon: 'fa-solid fa-tag',
                    color: INJECT_HEX,
                })),
            },
            false
        )
        expect(container.innerHTML).not.toContain('background-image')
        expect(container.innerHTML).not.toContain('url(evil)')
        expect(container.innerHTML).not.toContain('<img')
        // 合法 bg-* 值不受影響的對照由既有測試保障
    })

    it('合法 bg-* class 正常輸出 class、不輸出 style', () => {
        const qsm = new QuickSelectManager()
        qsm.addRecord('expense', 'food', '午餐', null)
        const container = document.createElement('div')
        qsm.render(
            container,
            null,
            {
                getCategoryById: vi.fn(() => ({
                    name: '餐飲',
                    icon: 'fa-solid fa-utensils',
                    color: 'bg-red-500',
                })),
            },
            false
        )
        expect(container.innerHTML).toContain('bg-red-500')
    })
})

// ==================== 4. DebtManager 群組詳情彈窗 ====================

describe('DebtManager - #SEC05 群組詳情彈窗髒 color', () => {
    let dm

    beforeEach(() => {
        dm = new DebtManager({ activeLedgerId: 1 })
    })

    it('分類 color 為 CSS 逃脫值：彈窗不產生注入內容、退回灰底', async () => {
        // categories.js mock 回傳 color = INJECT_HEX
        dm.dataService = {
            getGroupMeta: vi.fn(async () => ({
                name: '聚餐群',
                settled: false,
            })),
            getGroupRecords: vi.fn(async () => [
                {
                    id: 1,
                    type: 'expense',
                    category: 'evilcat',
                    amount: 100,
                    date: '2026-10-01',
                    description: 'normal',
                },
            ]),
            _calculateGroupNetAsync: vi.fn(async () => ({
                netAmount: -100,
                totalExpense: 100,
                totalIncome: 0,
            })),
            getDebts: vi.fn(async () => []),
            // v2.1.8.2：群組詳情彈窗會批次載入聯絡人（欠款人標示）
            getContacts: vi.fn(async () => []),
        }
        await dm.showGroupDetailsModal('group-1')
        const modal = document.getElementById('group-details-modal')
        expect(modal).toBeTruthy()
        expect(modal.innerHTML).not.toContain('background-image')
        expect(modal.innerHTML).not.toContain('url(evil)')
        expect(modal.innerHTML).not.toContain('<img')
        // 髒值退回中性灰底（合法分類仍有顏色，不會全無底色）
        expect(modal.innerHTML).toContain('bg-gray-500')
        modal.remove()
    })
})

// ==================== 5. HomePage 最近紀錄 + 帳本切換器 ====================

describe('HomePage - #SEC05 最近紀錄與帳本切換器髒 color', () => {
    let app, homePage, container

    beforeEach(() => {
        container = document.createElement('div')
        document.body.innerHTML = ''
        document.body.appendChild(container)
        app = {
            appContainer: container,
            dataService: {
                getSetting: vi.fn(async () => null),
                getGroups: vi.fn(async () => []),
                getStatistics: vi.fn(async () => ({
                    totalIncome: 0,
                    totalExpense: 0,
                })),
                getRecords: vi.fn(async () => [
                    {
                        id: 1,
                        type: 'expense',
                        category: 'evilcat',
                        amount: 100,
                        date: '2026-10-01',
                        description: '午餐',
                    },
                ]),
            },
            categoryManager: {
                getCategoryById: vi.fn(() => ({
                    name: '髒分類',
                    icon: 'fa-solid fa-tag',
                    color: INJECT_HEX,
                })),
            },
            budgetManager: {
                renderBudgetWidget: vi.fn(async () => ''),
            },
            ledgerManager: {
                getActiveLedger: vi.fn().mockReturnValue({
                    id: 2,
                    name: '"><img src=x onerror=alert(1)>',
                    icon: 'fa-solid fa-book',
                    color: BREAKOUT,
                }),
                getAllLedgers: vi
                    .fn()
                    .mockReturnValue([{ id: 1 }, { id: 2 }]),
            },
            pluginManager: { renderHomeWidgets: vi.fn() },
            showLedgerSwitcherPopup: vi.fn(),
        }
        homePage = new HomePage(app)
    })

    it('render 後：髒帳本色與髒分類色皆不產生注入內容；帳本名轉義', async () => {
        await homePage.render()
        const html = container.innerHTML
        expect(html).not.toContain('url(evil)')
        expect(html).not.toContain('background-image')
        // 帳本切換器：髒 color 退回預設深藍灰，髒 name 經轉義不可執行
        expect(html).toContain('background-color: #334A52')
        expect(container.querySelector('img[src="x"]')).toBeNull()
        expect(html).not.toContain('onerror=alert(1)"><')
        // 最近紀錄仍正常渲染（髒色退灰但內容在）
        expect(html).toContain('午餐')
    })
})

// ==================== 6. LedgerManager 入庫端 ====================

describe('LedgerManager - #SEC05 顏色入庫端白名單', () => {
    let mockDataService, lm

    beforeEach(() => {
        mockDataService = {
            activeLedgerId: 1,
            getLedgers: vi.fn().mockResolvedValue([]),
            addLedger: vi.fn().mockResolvedValue(2),
            addAccount: vi.fn().mockResolvedValue(1),
            updateLedger: vi.fn(),
            setActiveLedger: vi.fn(),
            getLedger: vi.fn(),
        }
        lm = new LedgerManager(mockDataService, {
            showActiveLedgerChange: vi.fn(),
            updateSidebarLedger: vi.fn(),
        })
        lm.ledgers = []
    })

    it('createLedger 拒絕 CSS 逃脫色，不寫入', async () => {
        await expect(
            lm.createLedger({ name: '新帳本', color: INJECT_HEX })
        ).rejects.toThrow('顏色格式不正確')
        expect(mockDataService.addLedger).not.toHaveBeenCalled()
    })

    it('createLedger 合法 hex 正常通過', async () => {
        await lm.createLedger({ name: '新帳本', color: '#059669' })
        expect(mockDataService.addLedger).toHaveBeenCalledWith(
            expect.objectContaining({ color: '#059669' })
        )
    })

    it('updateLedger 拒絕 breakout 色，不寫入', async () => {
        await expect(
            lm.updateLedger(2, { color: BREAKOUT })
        ).rejects.toThrow('顏色格式不正確')
        expect(mockDataService.updateLedger).not.toHaveBeenCalled()
    })

    it('updateLedger 未帶 color 欄位不受影響', async () => {
        await lm.updateLedger(2, { name: '改名' })
        expect(mockDataService.updateLedger).toHaveBeenCalledWith(
            2,
            expect.objectContaining({ name: '改名' })
        )
    })
})

// ==================== 7. Statistics 圖例 ====================
// renderExpenseDonutChart 的顏色映射：髒 hex 過 isSafeHexColor 白名單，
// 非法值退回 colorMap/預設灰，圖例 style 不再直接嵌入歷史髒值。

import { StatisticsManager } from '../../src/js/statistics.js'

describe('StatisticsManager - #SEC05 圖例髒 color 退回預設灰', () => {
    let sm, container

    beforeEach(() => {
        container = document.createElement('div')
        container.innerHTML = `
            <div id="stats-expense-donut-container"></div>
            <div id="stats-income-donut-container"></div>
        `
        const categoryManager = {
            getCategoryById: vi.fn(() => ({
                name: '髒分類',
                icon: 'fa-solid fa-tag',
                color: INJECT_HEX,
            })),
        }
        sm = new StatisticsManager({}, categoryManager)
        sm.container = container
        sm.charts = {}
    })

    afterEach(() => {
        try {
            sm.destroy()
        } catch (_) {
            /* noop */
        }
    })

    it('圖例 style 使用白名單外的預設灰，不含注入內容', () => {
        sm.renderExpenseDonutChart({ evilcat: 500 })
        const el = container.querySelector('#stats-expense-donut-container')
        expect(el.innerHTML).not.toContain('background-image')
        expect(el.innerHTML).not.toContain('url(evil)')
        // 圖例圓點退回 Tailwind 灰（colorMap fallback '#9ca3af'）
        expect(el.innerHTML).toContain('#9ca3af')
    })

    it('合法 hex 分類色照常輸出（零影響）', () => {
        sm.categoryManager = {
            getCategoryById: vi.fn(() => ({
                name: '餐飲',
                icon: 'fa-solid fa-utensils',
                color: '#FF5733',
            })),
        }
        sm.renderExpenseDonutChart({ food: 500 })
        const el = container.querySelector('#stats-expense-donut-container')
        expect(el.innerHTML).toContain('#FF5733')
    })
})

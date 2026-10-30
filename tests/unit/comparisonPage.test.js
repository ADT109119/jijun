import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock chart.js：jsdom 沒有 canvas，new Chart() 不需真實實作（模式同 statistics.test.js）
vi.mock('chart.js', () => {
    const mockChart = vi.fn(function () {
        return { destroy: vi.fn() }
    })
    mockChart.register = vi.fn()
    return { Chart: mockChart, registerables: [] }
})

import { Chart as MockChart } from 'chart.js'

// Mock ComparisonReport：頁面內部 `new ComparisonReport(...)` 需可控制
const { MockCompCtor } = vi.hoisted(() => ({ MockCompCtor: vi.fn() }))
vi.mock('../../src/js/comparisonReport.js', () => ({
    ComparisonReport: MockCompCtor,
}))

vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn(v => String(v)),
    escapeHTML: vi.fn(s =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    ),
}))

import { ComparisonPage } from '../../src/js/pages/comparisonPage.js'

// 與真實 ComparisonReport.getLastYearPeriods 相同語意（static 掛在 mock class 上）
MockCompCtor.getLastYearPeriods = periods =>
    periods.map(p => {
        const parts = p.split('-')
        if (parts.length === 2) return `${Number(parts[0]) - 1}-${parts[1]}`
        return String(Number(parts[0]) - 1)
    })

const flush = () => new Promise(r => setTimeout(r, 0))

const DEFAULT_MONTHS = ['2026-01', '2026-02', '2026-03']
const DEFAULT_YEARS = ['2025', '2026']

function makeData({ periodType = 'month', periods, typeFilter = 'all' } = {}) {
    return {
        periodLabels: periods || ['2026-02', '2026-03'],
        periodType,
        typeFilter,
        periodData: [
            { label: '2026-02', income: 1000, expense: 500 },
            { label: '2026-03', income: 1200, expense: 600 },
        ],
        categoryComparisons: [
            {
                category: 'food',
                period0: 100,
                period0Signed: -100,
                period1: 120,
                period1Signed: -120,
            },
        ],
    }
}

let comp
let lastData

beforeEach(() => {
    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    appContainer.id = 'appContainer'
    document.body.appendChild(appContainer)

    lastData = null
    comp = {
        getAvailablePeriods: vi.fn(
            type =>
                Promise.resolve(
                    type === 'month' ? DEFAULT_MONTHS : DEFAULT_YEARS
                )
        ),
        calculateComparison: vi.fn(async (pt, periods, opts = {}) => {
            lastData = makeData({
                periodType: pt,
                periods,
                typeFilter: opts.typeFilter || 'all',
            })
            return lastData
        }),
        renderSummaryCards: vi.fn(el => {
            el.innerHTML = '<div class="summary-card">SUMMARY</div>'
        }),
        renderSavingsRates: vi.fn(el => {
            el.innerHTML = '<div class="savings">SAVINGS</div>'
        }),
        renderPercentageTable: vi.fn(el => {
            el.innerHTML = '<div class="pct">PCT</div>'
        }),
        renderDailyAverages: vi.fn(el => {
            el.innerHTML = '<div class="daily">DAILY</div>'
        }),
        renderCategoryRankings: vi.fn(el => {
            el.innerHTML = '<div class="ranking">RANK</div>'
        }),
        renderCategoryTable: vi.fn(el => {
            el.innerHTML = '<div class="table">TABLE</div>'
        }),
        exportToCSV: vi.fn(() => '期間,收入\n2026-02,1000'),
    }
    // 每個測試回傳同一個 comp 實例（spies 可跨 render 保留）
    // 注意：頁面用 `new ComparisonReport(...)`，arrow function 無法被 new 呼叫，
    // 必須用一般 function（回傳物件時 new 的結果會取該物件）
    MockCompCtor.mockImplementation(function () {
        return comp
    })

    const app = { appContainer, dataService: {}, categoryManager: {} }
    globalThis.__page = new ComparisonPage(app)
    globalThis.__app = app
})

afterEach(() => {
    delete globalThis.__page
    delete globalThis.__app
})

// ── 輔助函數 ─────────────────────────────────────────────
function getContainer() {
    return globalThis.__app.appContainer
}

function getResults() {
    return getContainer().querySelector('#comp-results')
}

function getCountText() {
    return getContainer()
        .querySelector('#comp-selected-count')
        .textContent
}

function getCheckedValues() {
    return [...getContainer().querySelectorAll('.comp-checkbox:checked')].map(
        cb => cb.value
    )
}

async function clickRun() {
    getContainer().querySelector('#comp-run-btn').click()
    await flush()
    await flush()
}

function checkPeriod(value) {
    const cb = [...getContainer().querySelectorAll('.comp-checkbox')].find(
        c => c.value === value
    )
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
}

function uncheckPeriod(value) {
    const cb = [...getContainer().querySelectorAll('.comp-checkbox')].find(
        c => c.value === value
    )
    cb.checked = false
    cb.dispatchEvent(new Event('change', { bubbles: true }))
}

async function runDefaultComparison() {
    await globalThis.__page.render()
    await clickRun()
}

// ==================== render() 骨架 ====================

describe('ComparisonPage - render() 骨架', () => {
    it('渲染返回連結、標題、容器與按鈕', async () => {
        await globalThis.__page.render()
        const back = getContainer().querySelector('a[href="#stats"]')
        expect(back).not.toBeNull()
        expect(back.textContent).toContain('返回')
        const title = getContainer().querySelector('h1')
        expect(title.textContent).toContain('跨月比較報表')
        expect(
            getContainer().querySelector('#comparison-container')
        ).not.toBeNull()
        expect(getContainer().querySelector('#comp-run-btn')).not.toBeNull()
        expect(
            getContainer().querySelector('#comp-lastyear-btn')
        ).not.toBeNull()
    })

    it('預設按月模式：按月按鈕帶 active 樣式、按年為 secondary', async () => {
        await globalThis.__page.render()
        const monthBtn = getContainer().querySelector('#comp-period-month')
        const yearBtn = getContainer().querySelector('#comp-period-year')
        expect(monthBtn.classList.contains('bg-wabi-surface')).toBe(true)
        expect(monthBtn.classList.contains('text-wabi-primary')).toBe(true)
        expect(yearBtn.classList.contains('text-wabi-text-secondary')).toBe(
            true
        )
        expect(yearBtn.classList.contains('bg-wabi-surface')).toBe(false)
    })

    it('預設選取最後 2 個月且計數顯示 2', async () => {
        await globalThis.__page.render()
        expect(getCountText()).toBe('2')
        expect(getCheckedValues().sort()).toEqual(['2026-02', '2026-03'])
    })

    it('無歷史數據時顯示空狀態提示', async () => {
        comp.getAvailablePeriods = vi.fn(() => Promise.resolve([]))
        await globalThis.__page.render()
        expect(
            getContainer().querySelector('#comp-checkboxes').textContent
        ).toContain('暫無歷史數據可比較')
        expect(getCountText()).toBe('0')
    })
})

// ==================== 期間類型切換 ====================

describe('ComparisonPage - 期間類型切換', () => {
    it('切到按年：年度 checkbox 渲染、active 樣式移動、選取重置為年度', async () => {
        await globalThis.__page.render()
        getContainer().querySelector('#comp-period-year').click()
        const values = getCheckedValues().sort()
        expect(values).toEqual(['2025', '2026'])
        expect(getCountText()).toBe('2')
        const monthBtn = getContainer().querySelector('#comp-period-month')
        const yearBtn = getContainer().querySelector('#comp-period-year')
        expect(yearBtn.classList.contains('bg-wabi-surface')).toBe(true)
        expect(monthBtn.classList.contains('text-wabi-text-secondary')).toBe(
            true
        )
    })

    it('切回按月：月份 checkbox 恢復且選取回到最後 2 個月', async () => {
        await globalThis.__page.render()
        getContainer().querySelector('#comp-period-year').click()
        getContainer().querySelector('#comp-period-month').click()
        const values = getCheckedValues().sort()
        expect(values).toEqual(['2026-02', '2026-03'])
        expect(getCountText()).toBe('2')
    })
})

// ==================== 期間選取（max 4） ====================

describe('ComparisonPage - 期間選取上限', () => {
    it('最多選 4 個：第 5 個勾選被拒絕且計數不變', async () => {
        comp.getAvailablePeriods = vi.fn(type =>
            Promise.resolve(
                type === 'month'
                    ? ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
                    : DEFAULT_YEARS
            )
        )
        await globalThis.__page.render()
        // 預設選 2026-04、2026-05
        checkPeriod('2026-01')
        checkPeriod('2026-02')
        expect(getCountText()).toBe('4')
        const cb5 = [...getContainer().querySelectorAll('.comp-checkbox')].find(
            c => c.value === '2026-03'
        )
        cb5.checked = true
        cb5.dispatchEvent(new Event('change', { bubbles: true }))
        expect(cb5.checked).toBe(false)
        expect(getCountText()).toBe('4')
    })

    it('取消勾選更新計數', async () => {
        comp.getAvailablePeriods = vi.fn(type =>
            Promise.resolve(
                type === 'month'
                    ? ['2026-01', '2026-02', '2026-03', '2026-04']
                    : DEFAULT_YEARS
            )
        )
        await globalThis.__page.render()
        // 預設選 2026-03、2026-04
        checkPeriod('2026-01')
        checkPeriod('2026-02')
        expect(getCountText()).toBe('4')
        uncheckPeriod('2026-02')
        expect(getCountText()).toBe('3')
        expect(getCheckedValues().sort()).toEqual([
            '2026-01',
            '2026-03',
            '2026-04',
        ])
    })
})

// ==================== 開始比較驗證 ====================

describe('ComparisonPage - 開始比較驗證', () => {
    it('只選 1 個期間時顯示錯誤且不呼叫計算', async () => {
        await globalThis.__page.render()
        uncheckPeriod('2026-02')
        expect(getCountText()).toBe('1')
        await clickRun()
        expect(getResults().textContent).toContain('請至少選擇 2 個期間')
        expect(comp.calculateComparison).not.toHaveBeenCalled()
    })

    it('未選任何期間時顯示錯誤且不呼叫計算', async () => {
        await globalThis.__page.render()
        uncheckPeriod('2026-02')
        uncheckPeriod('2026-03')
        expect(getCountText()).toBe('0')
        await clickRun()
        expect(getResults().textContent).toContain('請至少選擇 2 個期間')
        expect(comp.calculateComparison).not.toHaveBeenCalled()
    })
})

// ==================== 開始比較成功 ====================

describe('ComparisonPage - 開始比較成功', () => {
    it('呼叫參數正確（month + 排序選取 + typeFilter all）且按鈕恢復', async () => {
        await globalThis.__page.render()
        const runBtn = getContainer().querySelector('#comp-run-btn')
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledTimes(1)
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2026-02', '2026-03'],
            { typeFilter: 'all', contactId: null, contactName: null }
        )
        expect(runBtn.disabled).toBe(false)
        expect(runBtn.innerHTML).toContain('開始比較')
        expect(getResults().textContent).toContain('SUMMARY')
        expect(getResults().textContent).toContain('SAVINGS')
        expect(getResults().textContent).toContain('儲蓄率比較')
    })

    it('僅支出篩選：typeFilter=expense 且標題為分類支出比較', async () => {
        await globalThis.__page.render()
        getContainer().querySelector('#comp-filter-expense').click()
        const expenseBtn = getContainer().querySelector('#comp-filter-expense')
        expect(expenseBtn.classList.contains('bg-wabi-surface')).toBe(true)
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2026-02', '2026-03'],
            { typeFilter: 'expense', contactId: null, contactName: null }
        )
        expect(getResults().textContent).toContain('分類支出比較')
        expect(getResults().textContent).toContain('支出比例比較')
        expect(getResults().textContent).toContain('日均支出比較')
        expect(getResults().textContent).toContain('分類排名比較')
    })

    it('全部篩選：標題為分類收支比較且含完整比較區塊', async () => {
        await globalThis.__page.render()
        await clickRun()
        expect(getResults().textContent).toContain('分類收支比較')
        expect(getResults().textContent).toContain('PCT')
        expect(getResults().textContent).toContain('DAILY')
        expect(getResults().textContent).toContain('RANK')
        expect(getResults().textContent).toContain('TABLE')
        expect(
            getResults().querySelector('#comp-summary')
        ).not.toBeNull()
        expect(
            getResults().querySelector('#comp-export-csv')
        ).not.toBeNull()
    })
})

// ==================== 開始比較失敗 ====================

describe('ComparisonPage - 開始比較失敗', () => {
    it('計算失敗時顯示錯誤訊息且按鈕恢復', async () => {
        await globalThis.__page.render()
        comp.calculateComparison = vi.fn(() =>
            Promise.reject(new Error('boom'))
        )
        const runBtn = getContainer().querySelector('#comp-run-btn')
        await clickRun()
        expect(getResults().textContent).toContain('計算失敗: boom')
        expect(runBtn.disabled).toBe(false)
        expect(runBtn.innerHTML).toContain('開始比較')
    })
})

// ==================== typeFilter=income ====================

describe('ComparisonPage - 僅收入篩選', () => {
    it('隱藏支出比例/日均/排名區塊，標題為分類收入比較', async () => {
        await globalThis.__page.render()
        getContainer().querySelector('#comp-filter-income').click()
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2026-02', '2026-03'],
            { typeFilter: 'income', contactId: null, contactName: null }
        )
        const results = getResults().textContent
        expect(results).toContain('分類收入比較')
        expect(results).toContain('儲蓄率比較')
        expect(results).not.toContain('支出比例比較')
        expect(results).not.toContain('日均支出比較')
        expect(results).not.toContain('分類排名比較')
    })
})

// ==================== 去年同月快捷 ====================

describe('ComparisonPage - 去年同月快捷', () => {
    it('月份模式：合併去年同月（2 個月 → 4 個月）', async () => {
        comp.getAvailablePeriods = vi.fn(type =>
            Promise.resolve(
                type === 'month'
                    ? ['2025-02', '2025-03', '2026-02', '2026-03']
                    : DEFAULT_YEARS
            )
        )
        await globalThis.__page.render()
        // 預設選 2026-02、2026-03
        getContainer().querySelector('#comp-lastyear-btn').click()
        expect(getCheckedValues().sort()).toEqual([
            '2025-02',
            '2025-03',
            '2026-02',
            '2026-03',
        ])
        expect(getCountText()).toBe('4')
    })

    it('合併超過 4 個時保留最舊 4 個並可正常計算', async () => {
        comp.getAvailablePeriods = vi.fn(type =>
            Promise.resolve(
                type === 'month'
                    ? ['2025-01', '2025-02', '2025-03', '2025-04']
                    : DEFAULT_YEARS
            )
        )
        await globalThis.__page.render()
        // 預設選 2025-03、2025-04；再勾 2025-01、2025-02 → 4 個
        checkPeriod('2025-01')
        checkPeriod('2025-02')
        getContainer().querySelector('#comp-lastyear-btn').click()
        // merged = 2024-01..04 + 2025-01..04（8 個）> 4 → 保留最舊 4 個
        expect(getCountText()).toBe('4')
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2024-01', '2024-02', '2024-03', '2024-04'],
            { typeFilter: 'all', contactId: null, contactName: null }
        )
    })

    it('年度模式：點擊快捷不改變選取（僅月份模式合併）', async () => {
        await globalThis.__page.render()
        getContainer().querySelector('#comp-period-year').click()
        getContainer().querySelector('#comp-lastyear-btn').click()
        expect(getCheckedValues().sort()).toEqual(['2025', '2026'])
        expect(getCountText()).toBe('2')
    })

    it('未選任何期間時點擊快捷不動作', async () => {
        await globalThis.__page.render()
        uncheckPeriod('2026-02')
        uncheckPeriod('2026-03')
        getContainer().querySelector('#comp-lastyear-btn').click()
        expect(getCountText()).toBe('0')
        expect(getCheckedValues()).toEqual([])
    })
})

// ==================== 匯出 CSV ====================

describe('ComparisonPage - 匯出 CSV', () => {
    let origCreateObjectURL
    let origRevokeObjectURL
    let clickSpy

    beforeEach(() => {
        origCreateObjectURL = globalThis.URL.createObjectURL
        origRevokeObjectURL = globalThis.URL.revokeObjectURL
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake')
        globalThis.URL.revokeObjectURL = vi.fn()
        clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    })

    afterEach(() => {
        if (origCreateObjectURL) {
            globalThis.URL.createObjectURL = origCreateObjectURL
        }
        if (origRevokeObjectURL) {
            globalThis.URL.revokeObjectURL = origRevokeObjectURL
        }
        clickSpy.mockRestore()
    })

    it('點擊匯出：anchor 檔名含 vs 期間標籤且 href 為 objectURL', async () => {
        await runDefaultComparison()
        getContainer().querySelector('#comp-export-csv').click()
        expect(comp.exportToCSV).toHaveBeenCalledTimes(1)
        expect(comp.exportToCSV).toHaveBeenCalledWith(lastData)
        expect(clickSpy).toHaveBeenCalledTimes(1)
        const anchor = clickSpy.mock.contexts[0]
        expect(anchor.download).toBe('比較報表_2026-02vs2026-03.csv')
        expect(anchor.href).toBe('blob:fake')
        expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    })

    it('CSV Blob 帶 UTF-8 BOM 且 MIME 為 text/csv', async () => {
        // jsdom 的 Blob 內容解碼會丟掉 BOM 字元（環境差異，非 source 行為），
        // 因此改在 Blob constructor 攔截實際傳入的字串來斷言 BOM 前綴
        const origBlob = globalThis.Blob
        const blobSpy = vi.spyOn(globalThis, 'Blob')
        let seenParts
        blobSpy.mockImplementation(function (parts, opts) {
            seenParts = parts
            return new origBlob(parts, opts)
        })
        try {
            await runDefaultComparison()
            getContainer().querySelector('#comp-export-csv').click()
            expect(blobSpy).toHaveBeenCalledTimes(1)
            expect(seenParts).toHaveLength(1)
            expect(seenParts[0].charCodeAt(0)).toBe(0xfeff)
            expect(seenParts[0]).toContain('2026-02,1000')
            const blob = globalThis.URL.createObjectURL.mock.calls[0][0]
            expect(blob.type).toBe('text/csv;charset=utf-8;')
        } finally {
            blobSpy.mockRestore()
        }
    })
})

// ==================== 圖表生命週期 ====================

describe('ComparisonPage - 圖表生命週期', () => {
    it('比較成功後建立 Chart：labels 與 income/expense datasets 正確', async () => {
        await runDefaultComparison()
        const page = globalThis.__page
        expect(page.charts.comparison).toBeTruthy()
        // 最後一次 new Chart(ctx, config)
        const calls = MockChart.mock.calls
        const config = calls[calls.length - 1][1]
        expect(config.type).toBe('bar')
        expect(config.data.labels).toEqual(['2026-02', '2026-03'])
        expect(config.data.datasets).toHaveLength(2)
        expect(config.data.datasets[0].label).toBe('收入')
        expect(config.data.datasets[0].data).toEqual([1000, 1200])
        expect(config.data.datasets[1].label).toBe('支出')
        expect(config.data.datasets[1].data).toEqual([500, 600])
    })

    it('重複 render 時銷毀舊圖表並移除舊 canvas', async () => {
        await runDefaultComparison()
        const oldChart = globalThis.__page.charts.comparison
        expect(oldChart).toBeTruthy()
        const oldCanvas = document.getElementById('comp-bar-chart')
        expect(oldCanvas).not.toBeNull()
        await globalThis.__page.render()
        expect(oldChart.destroy).toHaveBeenCalledTimes(1)
        expect(oldCanvas.isConnected).toBe(false)
    })

    it('destroy() 清空圖表集合並銷毀所有圖表', async () => {
        await runDefaultComparison()
        const chart = globalThis.__page.charts.comparison
        expect(chart).toBeTruthy()
        globalThis.__page.destroy()
        expect(globalThis.__page.charts).toEqual({})
        expect(chart.destroy).toHaveBeenCalledTimes(1)
    })

    it('未 render 時呼叫 destroy() 不拋錯', () => {
        expect(() => globalThis.__page.destroy()).not.toThrow()
        expect(globalThis.__page.charts).toEqual({})
    })
})

// ==================== 對象（聯絡人）篩選 (#MOZE-TGT) ====================

describe('ComparisonPage — 對象（聯絡人）篩選 (#MOZE-TGT)', () => {
    function setContactsDS({ debtEnabled = true, contacts = [{ id: 7, name: '小明' }], fails = false } = {}) {
        globalThis.__app.dataService = {
            getSetting: vi.fn(async key =>
                key === 'debtManagementEnabled' && debtEnabled
                    ? { value: true }
                    : null
            ),
            getContacts: fails
                ? vi.fn(async () => {
                      throw new Error('boom')
                  })
                : vi.fn(async () => contacts),
        }
    }

    it('欠款開啟且有聯絡人 → 對象 select 存在', async () => {
        setContactsDS()
        await globalThis.__page.render()
        expect(
            getContainer().querySelector('#comp-contact-filter')
        ).not.toBeNull()
    })

    it('欠款關閉 → select 不存在且渲染正常', async () => {
        setContactsDS({ debtEnabled: false })
        await globalThis.__page.render()
        expect(
            getContainer().querySelector('#comp-contact-filter')
        ).toBeNull()
        expect(getContainer().querySelector('#comp-run-btn')).not.toBeNull()
    })

    it('getContacts 拋錯 → 降級不崩潰且無 select', async () => {
        setContactsDS({ fails: true })
        await expect(globalThis.__page.render()).resolves.not.toThrow()
        expect(
            getContainer().querySelector('#comp-contact-filter')
        ).toBeNull()
    })

    it('聯絡人名稱含 script → 被 escapeHTML 防禦', async () => {
        setContactsDS({ contacts: [{ id: 7, name: '<script>alert(1)</script>' }] })
        await globalThis.__page.render()
        const select = getContainer().querySelector('#comp-contact-filter')
        expect(select).not.toBeNull()
        expect(getContainer().innerHTML).not.toContain(
            '<script>alert(1)</script>'
        )
    })

    it('選定對象後開始比較 → 第三參數帶 contactId/contactName', async () => {
        setContactsDS()
        await globalThis.__page.render()
        const select = getContainer().querySelector('#comp-contact-filter')
        select.value = '7'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2026-02', '2026-03'],
            { typeFilter: 'all', contactId: 7, contactName: '小明' }
        )
    })

    it('選回所有對象 → contactId/contactName 為 null', async () => {
        setContactsDS()
        await globalThis.__page.render()
        const select = getContainer().querySelector('#comp-contact-filter')
        select.value = '7'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        select.value = 'all'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await clickRun()
        expect(comp.calculateComparison).toHaveBeenCalledWith(
            'month',
            ['2026-02', '2026-03'],
            { typeFilter: 'all', contactId: null, contactName: null }
        )
    })
})

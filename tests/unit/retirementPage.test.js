/**
 * retirementPage.test.js — #AB1 退休分析報告頁面測試
 *
 * 模式仿 comparisonPage.test.js：mock chart.js（jsdom 無 canvas）、
 * mock RetirementReport 模組控制 simulate/snapshot、mock utils。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock chart.js：jsdom 沒有 canvas（模式同 comparisonPage.test.js）
vi.mock('chart.js', () => {
    const mockChart = vi.fn(function () {
        return { destroy: vi.fn() }
    })
    mockChart.register = vi.fn()
    return { Chart: mockChart, registerables: [] }
})

import { Chart as MockChart } from 'chart.js'

// Mock RetirementReport：頁面 new RetirementReport(...) + 靜態 simulate
const { MockReportCtor, mockSimulate, mockSnapshot } = vi.hoisted(
    () => ({
        MockReportCtor: vi.fn(),
        mockSimulate: vi.fn(),
        mockSnapshot: vi.fn()
    })
)
vi.mock('../../src/js/retirementReport.js', () => ({
    RetirementReport: MockReportCtor
}))

vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn(v => `$${Math.round(v)}`),
    escapeHTML: vi.fn(s =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    ),
    showToast: vi.fn()
}))

import { RetirementPage } from '../../src/js/pages/retirementPage.js'
import { showToast } from '../../src/js/utils.js'

const flush = () => new Promise(r => setTimeout(r, 0))

function makeResult(overrides = {}) {
    return {
        simCount: 1000,
        years: 30,
        successCount: 850,
        depletedCount: 150,
        successRate: 0.85,
        p10: 200000,
        p25: 500000,
        median: 1200000,
        p75: 2500000,
        p90: 4000000,
        medianDepletionYear: 18,
        params: {},
        ...overrides
    }
}

let page
let appContainer

beforeEach(() => {
    document.body.innerHTML = ''
    appContainer = document.createElement('div')
    appContainer.id = 'appContainer'
    document.body.appendChild(appContainer)

    MockReportCtor.mockImplementation(function () {
        return { collectFinancialSnapshot: mockSnapshot }
    })
    // 靜態方法掛在 mock class 上
    MockReportCtor.simulate = mockSimulate
    mockSimulate.mockReset()
    mockSnapshot.mockReset()
    mockSimulate.mockResolvedValue(makeResult())
    mockSnapshot.mockResolvedValue({
        netWorth: 800000,
        monthlyIncome: 60000,
        monthlyExpense: 40000,
        monthlyNet: 20000,
        monthsSampled: 6,
        accountCount: 2
    })

    const app = {
        appContainer,
        dataService: {},
        categoryManager: {}
    }
    page = new RetirementPage(app)
})

afterEach(() => {
    if (page && typeof page.destroy === 'function') page.destroy()
    document.body.innerHTML = ''
    vi.clearAllMocks()
})

describe('RetirementPage render', () => {
    it('渲染骨架：標題、返回連結、實驗性警示、表單欄位與執行按鈕', async () => {
        await page.render()
        const html = appContainer.innerHTML
        expect(html).toContain('退休分析')
        expect(html).toContain('href="#stats"')
        expect(html).toContain('實驗性')
        expect(appContainer.querySelector('#ret-start-balance')).not.toBeNull()
        expect(appContainer.querySelector('#ret-monthly-net')).not.toBeNull()
        expect(appContainer.querySelector('#ret-withdrawal')).not.toBeNull()
        expect(appContainer.querySelector('#ret-years')).not.toBeNull()
        expect(appContainer.querySelector('#ret-return')).not.toBeNull()
        expect(
            appContainer.querySelector('#ret-volatility')
        ).not.toBeNull()
        expect(appContainer.querySelector('#ret-seed')).not.toBeNull()
        expect(appContainer.querySelector('#ret-run')).not.toBeNull()
        expect(
            appContainer.querySelector('#retirement-prefill')
        ).not.toBeNull()
    })

    it('結果區初始為 hidden，模擬後顯示', async () => {
        await page.render()
        expect(
            appContainer.querySelector('#retirement-results').classList.contains(
                'hidden'
            )
        ).toBe(true)

        appContainer.querySelector('#ret-run').click()
        await flush()
        await flush()
        expect(
            appContainer.querySelector('#retirement-results').classList.contains(
                'hidden'
            )
        ).toBe(false)
    })
})

describe('RetirementPage 執行模擬', () => {
    it('點擊執行 → 以表單值呼叫 simulate（百分比轉小數）並渲染結果', async () => {
        await page.render()
        const set = (id, v) => {
            appContainer.querySelector(id).value = String(v)
        }
        set('#ret-start-balance', 500000)
        set('#ret-monthly-net', 20000)
        set('#ret-withdrawal', 5000)
        set('#ret-years', 25)
        set('#ret-return', 6)
        set('#ret-volatility', 12)
        set('#ret-sim-count', 500)
        set('#ret-seed', 99)

        const btn = appContainer.querySelector('#ret-run')
        btn.click()
        // 表單讀取 → setTimeout(0) 讓按鈕狀態刷新 → 同步行數千次模擬
        await flush()
        await flush()

        expect(mockSimulate).toHaveBeenCalledTimes(1)
        const opts = mockSimulate.mock.calls[0][0]
        expect(opts.startBalance).toBe(500000)
        expect(opts.monthlyNet).toBe(20000)
        expect(opts.monthlyWithdrawal).toBe(5000)
        expect(opts.years).toBe(25)
        expect(opts.annualReturn).toBeCloseTo(0.06)
        expect(opts.volatility).toBeCloseTo(0.12)
        expect(opts.simCount).toBe(500)
        expect(opts.seed).toBe(99)

        // 摘要渲染：成功率 85.0%、中位數、P10、破產 15.0%
        const cards = appContainer.querySelector('#ret-summary-cards')
        expect(cards.innerHTML).toContain('85.0%')
        expect(cards.innerHTML).toContain('15.0%')
        expect(cards.innerHTML).toContain('$1200000')
        // 破產說明：部分破產 → 中位破產年 18
        expect(
            appContainer.querySelector('#ret-depletion').innerHTML
        ).toContain('18')
    })

    it('全數成功情境 → 顯示未破產文案', async () => {
        mockSimulate.mockResolvedValue(
            makeResult({
                successCount: 1000,
                depletedCount: 0,
                successRate: 1,
                medianDepletionYear: null
            })
        )
        await page.render()
        appContainer.querySelector('#ret-run').click()
        await flush()
        await flush()
        const dep = appContainer.querySelector('#ret-depletion')
        expect(dep.innerHTML).toContain('所有模擬情境均未破產')
    })

    it('必填欄位空白 → toast 錯誤且不调用 simulate', async () => {
        await page.render()
        appContainer.querySelector('#ret-years').value = ''
        appContainer.querySelector('#ret-run').click()
        await flush()
        await flush()
        expect(mockSimulate).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('請完整填寫模擬參數', 'error')
    })

    it('simulate throw（參數越界）→ toast 帶錯誤訊息且按鈕恢復可用', async () => {
        mockSimulate.mockRejectedValue(new Error('推估年數必須為 1-80 的整數'))
        await page.render()
        appContainer.querySelector('#ret-years').value = '999'
        const btn = appContainer.querySelector('#ret-run')
        btn.click()
        await flush()
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '推估年數必須為 1-80 的整數',
            'error',
            4000
        )
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('執行模擬')
    })

    it('模擬中按鈕防重複點擊（disabled 時第二次 click 被忽略）', async () => {
        let release
        mockSimulate.mockReturnValue(
            new Promise(res => {
                release = () => res(makeResult())
            })
        )
        await page.render()
        const btn = appContainer.querySelector('#ret-run')
        btn.click()
        btn.click() // disabled 狀態下應被忽略
        await flush()
        expect(btn.disabled).toBe(true)
        expect(mockSimulate).toHaveBeenCalledTimes(1)
        release()
        await flush()
        await flush()
        expect(btn.disabled).toBe(false)
    })
})

describe('RetirementPage 預填', () => {
    it('點擊預填 → 以快照值寫入起始資產與每月淨儲蓄欄位', async () => {
        await page.render()
        appContainer.querySelector('#retirement-prefill').click()
        await flush()
        await flush()
        expect(
            appContainer.querySelector('#ret-start-balance').value
        ).toBe('800000')
        expect(appContainer.querySelector('#ret-monthly-net').value).toBe(
            '20000'
        )
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('已預填'),
            'success',
            4000
        )
    })

    it('快照失敗 → 降級 error toast，欄位不動', async () => {
        mockSnapshot.mockRejectedValue(new Error('db fail'))
        await page.render()
        const before = appContainer.querySelector('#ret-start-balance').value
        appContainer.querySelector('#retirement-prefill').click()
        await flush()
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '讀取資料失敗，請手動輸入參數',
            'error'
        )
        expect(appContainer.querySelector('#ret-start-balance').value).toBe(
            before
        )
    })

    it('無帳戶且淨資產為 0 時 → 保留起始資產既有值、僅預填每月淨儲蓄', async () => {
        mockSnapshot.mockResolvedValue({
            netWorth: 0,
            monthlyIncome: 50000,
            monthlyExpense: 30000,
            monthlyNet: 20000,
            monthsSampled: 6,
            accountCount: 0
        })
        await page.render()
        const before = appContainer.querySelector('#ret-start-balance').value
        appContainer.querySelector('#retirement-prefill').click()
        await flush()
        await flush()
        expect(appContainer.querySelector('#ret-start-balance').value).toBe(
            before
        )
        expect(appContainer.querySelector('#ret-monthly-net').value).toBe(
            '20000'
        )
    })
})

describe('RetirementPage Chart 生命週期與 destroy', () => {
    it('模擬成功建立 Chart；重複模擬先 destroy 舊圖表', async () => {
        await page.render()
        const btn = appContainer.querySelector('#ret-run')
        btn.click()
        await flush()
        await flush()
        expect(MockChart).toHaveBeenCalledTimes(1)
        const first = page.chart

        btn.click()
        await flush()
        await flush()
        expect(first.destroy).toHaveBeenCalled()
        expect(MockChart).toHaveBeenCalledTimes(2)
    })

    it('destroy 清空 chart 引用；未 render 呼叫不拋錯', async () => {
        await page.render()
        appContainer.querySelector('#ret-run').click()
        await flush()
        await flush()
        expect(page.chart).not.toBeNull()
        page.destroy()
        expect(page.chart).toBeNull()
        expect(() => new RetirementPage({ appContainer }).destroy()).not.toThrow()
    })

    it('重複 render 銷毀舊 Chart 與殘留狀態（防記憶體洩漏）', async () => {
        await page.render()
        appContainer.querySelector('#ret-run').click()
        await flush()
        await flush()
        const first = page.chart
        await page.render()
        expect(first.destroy).toHaveBeenCalled()
        expect(page.chart).toBeNull()
    })
})

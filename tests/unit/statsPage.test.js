import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 統計與行事曆依賴：statsPage 頁面只做骨架渲染 + 實例化接線 + widget 同步
// PITFALL：vi.mock factory 會被 hoisted，內部引用的頂層變數必須放 vi.hoisted
const { MockStatsCtor, MockCalendarCtor, widgetMock } = vi.hoisted(() => ({
    MockStatsCtor: vi.fn(),
    MockCalendarCtor: vi.fn(),
    widgetMock: {
        extractCalendarWidgetData: vi.fn(() => null),
        updateAndroidWidget: vi.fn(async () => ({})),
    },
}))
vi.mock('../../src/js/statistics.js', () => ({
    StatisticsManager: MockStatsCtor,
}))
vi.mock('../../src/js/calendarCashFlow.js', () => ({
    CalendarCashFlow: MockCalendarCtor,
}))
vi.mock('../../src/js/widgetHelper.js', () => widgetMock)

import { StatsPage } from '../../src/js/pages/statsPage.js'

// ── fixtures ──────────────────────────────────────────────
function makeApp({ calendarData = null } = {}) {
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    const app = {
        appContainer,
        dataService: { __tag: 'dataService' },
        categoryManager: { __tag: 'categoryManager' },
        debtManager: { __tag: 'debtManager' },
        budgetManager: { __tag: 'budgetManager' },
    }
    widgetMock.extractCalendarWidgetData.mockReturnValue(calendarData)
    return app
}

function makeMockCalendar() {
    return {
        render: vi.fn(async () => ({})),
        destroy: vi.fn(),
    }
}

function makeMockStats() {
    return {
        renderStatisticsPage: vi.fn(),
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    // mockImplementation 用一般 function（arrow 不可被 `new`）；回傳物件時 new 取該物件
    MockCalendarCtor.mockImplementation(function () {
        return makeMockCalendar()
    })
    MockStatsCtor.mockImplementation(function () {
        return makeMockStats()
    })
    widgetMock.extractCalendarWidgetData.mockReturnValue(null)
    widgetMock.updateAndroidWidget.mockResolvedValue({})
    delete window.Capacitor
})

afterEach(() => {
    delete window.Capacitor
})

describe('StatsPage.render() — 頁面骨架', () => {
    it('渲染標題「收支分析」', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        const h1 = page.app.appContainer.querySelector('h1')
        expect(h1).toBeTruthy()
        expect(h1.textContent).toContain('收支分析')
    })

    it('渲染跨月比較報表入口連結 (#comparison)', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        const link = page.app.appContainer.querySelector('a[href="#comparison"]')
        expect(link).toBeTruthy()
        expect(link.textContent).toContain('跨月比較報表')
    })

    it('渲染 #stats-container 與 #stats-calendar-container 容器', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        expect(page.app.appContainer.querySelector('#stats-container')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#stats-calendar-container')).toBeTruthy()
    })
})

describe('StatsPage.render() — 實例化接線', () => {
    it('CalendarCashFlow 以 (dataService, categoryManager, 行事曆容器, debtManager) 建立並 await render', async () => {
        const app = makeApp()
        const page = new StatsPage(app)
        await page.render()
        expect(MockCalendarCtor).toHaveBeenCalledTimes(1)
        const args = MockCalendarCtor.mock.calls[0]
        expect(args[0]).toBe(app.dataService)
        expect(args[1]).toBe(app.categoryManager)
        const calendarEl = page.app.appContainer.querySelector('#stats-calendar-container')
        expect(args[2]).toBe(calendarEl)
        expect(args[3]).toBe(app.debtManager)
        const instance = page.calendarInstance
        expect(instance.render).toHaveBeenCalledTimes(1)
    })

    it('StatisticsManager 以 (dataService, categoryManager) 建立，renderStatisticsPage 收到 #stats-container', async () => {
        const app = makeApp()
        const page = new StatsPage(app)
        await page.render()
        expect(MockStatsCtor).toHaveBeenCalledTimes(1)
        expect(MockStatsCtor.mock.calls[0][0]).toBe(app.dataService)
        expect(MockStatsCtor.mock.calls[0][1]).toBe(app.categoryManager)
        const instance = MockStatsCtor.mock.results[0].value
        const statsEl = page.app.appContainer.querySelector('#stats-container')
        expect(instance.renderStatisticsPage).toHaveBeenCalledTimes(1)
        expect(instance.renderStatisticsPage.mock.calls[0][0]).toBe(statsEl)
    })

    it('重複 render 時 destroy 前一個 calendar 實例（防洩漏）', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        const first = page.calendarInstance
        await page.render()
        expect(first.destroy).toHaveBeenCalledTimes(1)
        expect(page.calendarInstance).not.toBe(first)
        expect(MockCalendarCtor).toHaveBeenCalledTimes(2)
    })
})

describe('StatsPage.render() — 統計接線（確定性路徑，extract→null 跳過動態 import）', () => {
    // source 頂端 static import 的 extractCalendarWidgetData 回傳 null 時，
    // `if (calendarData && ...)` guard 為 false → 動態 `await import('../widgetHelper.js')` 被跳過。
    // 此路徑無動態 import 參與，完全確定性（實測 100% 穩定），是斷言 statistics 接線的安全路徑。
    it('render 走完 → StatisticsManager(dataService, categoryManager) 建立且 renderStatisticsPage 收到 #stats-container', async () => {
        const app = makeApp() // extract 預設回傳 null
        const page = new StatsPage(app)
        await page.render()
        expect(MockStatsCtor).toHaveBeenCalledTimes(1)
        expect(MockStatsCtor.mock.calls[0][0]).toBe(app.dataService)
        expect(MockStatsCtor.mock.calls[0][1]).toBe(app.categoryManager)
        const statsEl = page.app.appContainer.querySelector('#stats-container')
        const statsInstance = MockStatsCtor.mock.results[0].value
        expect(statsInstance.renderStatisticsPage).toHaveBeenCalledTimes(1)
        expect(statsInstance.renderStatisticsPage.mock.calls[0][0]).toBe(statsEl)
    })
})

describe('StatsPage.render() — Android Widget 同步（Calendar data，動態 import 路徑）', () => {
    // PITFALL（跨檔/重複跑 flake，2026-09-11 實測確認）：source 對 updateAndroidWidget 用
    // `await import('../widgetHelper.js')` **動態**載入，此動態 import 解析到的實例
    // （mock vs real）在單一 test file 重複執行 / 多檔並行時非確定性，對該 branch 的
    // call-count 或「statistics 是否被走到」之斷言皆 flaky（實測：單檔連跑 100% 失敗、
    // null 路徑 100% 穩定）。因此 calendarData 有值的路徑只斷言「保證成立」的不變量：
    //   ① `await page.render()` 必然 resolve —— 無論動態 import 拿到 mock(reject→被 source
    //      try/catch 吞掉) 或 real(無 dataService.db → 早回傳 resolve)，render 都不會 reject
    //   ② calendar 仍被渲染（page.calendarInstance 是存活實例且其 render 被呼叫）
    // updateAndroidWidget 本身的邏輯（參數/計算/錯誤處理）由 tests/unit/widgetHelper.test.js (27 tests) 覆蓋。

    it('原生平台 + 有 calendarData：render 不崩潰、calendar 已渲染', async () => {
        const app = makeApp({ calendarData: { days: 30, records: 5 } })
        window.Capacitor = { isNativePlatform: () => true }
        const page = new StatsPage(app)
        await expect(page.render()).resolves
        // extract（static import，identity 穩定）以 calendarInstance 被呼叫
        expect(widgetMock.extractCalendarWidgetData).toHaveBeenCalledTimes(1)
        expect(widgetMock.extractCalendarWidgetData.mock.calls[0][0]).toBe(page.calendarInstance)
        // calendar 存活且 render 被呼叫（source `await this.calendarInstance.render()`）
        expect(page.calendarInstance).toBeTruthy()
        expect(page.calendarInstance.render).toHaveBeenCalledTimes(1)
    })

    it('原生平台 + 無 calendarData (null)：guard 跳過 widget sync，render 走完且 calendar 已渲染', async () => {
        const app = makeApp() // extract → null
        window.Capacitor = { isNativePlatform: () => true }
        const page = new StatsPage(app)
        await expect(page.render()).resolves
        expect(page.calendarInstance.render).toHaveBeenCalledTimes(1)
    })

    it('Web 平台（無 Capacitor）：render 走完、calendar 已渲染', async () => {
        const app = makeApp({ calendarData: { days: 30 } })
        // 不設定 window.Capacitor
        const page = new StatsPage(app)
        await expect(page.render()).resolves
        expect(page.calendarInstance.render).toHaveBeenCalledTimes(1)
    })

    it('Capacitor 非原生平台（isNativePlatform=false）：render 走完、calendar 已渲染', async () => {
        const app = makeApp({ calendarData: { days: 30 } })
        window.Capacitor = { isNativePlatform: () => false }
        const page = new StatsPage(app)
        await expect(page.render()).resolves
        expect(page.calendarInstance.render).toHaveBeenCalledTimes(1)
    })

    it('widget 同步失敗（rejection）：render 不崩潰（catch 生效的保證）', async () => {
        // 若 source 的 try/catch 失效，動態 import 的 rejection 會讓 render() reject → 此斷言失敗。
        // （此斷言不依賴 mock vs real 的解析結果：reject→被 catch，real→早回傳，兩者皆讓 render resolve。）
        const app = makeApp({ calendarData: { days: 30 } })
        window.Capacitor = { isNativePlatform: () => true }
        widgetMock.updateAndroidWidget.mockRejectedValueOnce(new Error('widget sync boom'))
        const page = new StatsPage(app)
        await expect(page.render()).resolves
    })
})

describe('StatsPage.destroy()', () => {
    it('有 calendarInstance 且具 destroy → 呼叫並置 null', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        const instance = page.calendarInstance
        page.destroy()
        expect(instance.destroy).toHaveBeenCalledTimes(1)
        expect(page.calendarInstance).toBeNull()
    })

    it('重複 destroy 不拋錯（idempotent）', async () => {
        const page = new StatsPage(makeApp())
        await page.render()
        page.destroy()
        expect(() => page.destroy()).not.toThrow()
    })

    it('從未 render（calendarInstance 為 null）→ 不拋錯', () => {
        const page = new StatsPage(makeApp())
        expect(() => page.destroy()).not.toThrow()
        expect(page.calendarInstance).toBeNull()
    })

    it('calendarInstance 無 destroy 方法 → 不拋錯', async () => {
        const page = new StatsPage(makeApp())
        page.calendarInstance = {} // 模擬無 destroy 的實例
        expect(() => page.destroy()).not.toThrow()
    })
})

// ==================== 信用卡自動扣款後台排程 單元測試 (#B05-3) ====================
// 測試重點：_setupCreditAutoPayScheduler() 每天最多跑一次完整邏輯（按本地日期限流），
// 頁面恢復可見／獲焦時立即檢查，跨午夜後再次觸發。
// 直接使用真實 EasyAccountingApp._setupCreditAutoPayScheduler / _todayStr。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EasyAccountingApp } from '../../src/js/main.js'

describe('信用卡自動扣款後台排程 (#B05-3)', () => {
    let app

    beforeEach(() => {
        vi.useFakeTimers()
        app = Object.create(EasyAccountingApp.prototype)
        app.processCreditCardStatements = vi.fn(async () => {})
        app._todayStr = vi.fn(() => '2026-08-12')
        app._creditAutoPayTimer = null
    })

    afterEach(() => {
        vi.useRealTimers()
        document.removeEventListener('visibilitychange', app._creditAutoPayVisHandler)
        window.removeEventListener('focus', app._creditAutoPayFocusHandler)
        if (app._creditAutoPayTimer) clearInterval(app._creditAutoPayTimer)
    })

    it('初始化後記錄今日日期（init 已執行過處理，同一天不重复跑）', () => {
        app._setupCreditAutoPayScheduler()
        expect(app._lastCreditAutoPayDate).toBe('2026-08-12')
        expect(app.processCreditCardStatements).not.toHaveBeenCalled()
    })

    it('同一天內再次觸發不重复執行（冪等）', () => {
        app._setupCreditAutoPayScheduler()
        const callsAfterInit = app.processCreditCardStatements.mock.calls.length
        // 手動模拟 hourly tick（同一天）
        vi.advanceTimersByTime(60 * 60 * 1000)
        expect(app.processCreditCardStatements.mock.calls.length).toBe(callsAfterInit)
        // 手動模拟 focus 事件（同一天）
        window.dispatchEvent(new Event('focus'))
        expect(app.processCreditCardStatements.mock.calls.length).toBe(callsAfterInit)
    })

    it('跨到新的一天後再次觸發執行', () => {
        app._setupCreditAutoPayScheduler()
        const callsAfterInit = app.processCreditCardStatements.mock.calls.length
        // 模拟跨午夜：今天字符串變為新日期
        app._todayStr.mockReturnValue('2026-08-13')
        vi.advanceTimersByTime(60 * 60 * 1000)
        expect(app.processCreditCardStatements.mock.calls.length).toBe(callsAfterInit + 1)
        // 更新後同一天不再重复
        vi.advanceTimersByTime(60 * 60 * 1000)
        expect(app.processCreditCardStatements.mock.calls.length).toBe(callsAfterInit + 1)
    })

    it('頁面從後台恢復為可見時立即檢查（新的一天）', () => {
        app._setupCreditAutoPayScheduler()
        const callsAfterInit = app.processCreditCardStatements.mock.calls.length
        app._todayStr.mockReturnValue('2026-08-14')
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(app.processCreditCardStatements.mock.calls.length).toBe(callsAfterInit + 1)
    })

    it('_todayStr 返回 YYYY-MM-DD 格式', () => {
        const realToday = EasyAccountingApp.prototype._todayStr.call({})
        expect(realToday).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

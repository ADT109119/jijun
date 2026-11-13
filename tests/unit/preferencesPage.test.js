import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(async () => true),
}))
vi.mock('../../src/js/widgetHelper.js', () => ({
    updateAndroidWidget: vi.fn(async () => {}),
}))

import { PreferencesPage } from '../../src/js/pages/preferencesPage.js'
import { showToast } from '../../src/js/utils.js'

const flush = () => new Promise(r => setTimeout(r, 0))

function makeApp(overrides = {}) {
    const settings = overrides.settings || {}
    const dataService = {
        getSetting: vi.fn(async key =>
            key in settings ? { key, value: settings[key] } : null
        ),
        saveSetting: vi.fn(async () => true),
    }
    const guideManager = {
        showToggleTour: vi.fn(),
    }
    const notificationService = {
        requestPermission: vi.fn(async () => true),
        applyCurrentSettings: vi.fn(async () => {}),
    }

    const appContainer = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(appContainer)

    const app = {
        appContainer,
        dataService,
        guideManager,
        notificationService,
    }
    return { app, dataService, guideManager, notificationService }
}

describe('PreferencesPage - 記帳與系統偏好設定', () => {
    let app, page, dataService, guideManager, notificationService

    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new PreferencesPage(app)
        dataService = ctx.dataService
        guideManager = ctx.guideManager
        notificationService = ctx.notificationService
        vi.clearAllMocks()
    })

    it('計算機 toggle 勾選 = 停用計算機（saveSetting false + 顯示說明）', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('calculator-mode-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'calculatorModeEnabled',
            value: false,
        })
        expect(
            document.getElementById('calculator-mode-info').classList.contains('hidden')
        ).toBe(false)
        expect(showToast).toHaveBeenCalledWith('小鍵盤計算機模式已停用')
    })

    it('計算機 toggle 取消勾選 = 啟用計算機（隱藏說明）', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('calculator-mode-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'calculatorModeEnabled',
            value: true,
        })
        expect(
            document.getElementById('calculator-mode-info').classList.contains('hidden')
        ).toBe(true)
        expect(showToast).toHaveBeenCalledWith('小鍵盤計算機模式已啟用')
    })

    it('餘額不足提醒開啟：存設定 + 顯示說明 + 觸發導覽', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('low-balance-warning-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'lowBalanceWarningEnabled',
            value: true,
        })
        expect(
            document.getElementById('low-balance-warning-info').classList.contains('hidden')
        ).toBe(false)
        expect(guideManager.showToggleTour).toHaveBeenCalledWith('lowBalance')
        expect(showToast).toHaveBeenCalledWith('餘額不足提醒已啟用')
    })

    it('行事曆繳款圓點 toggle：預設勾選（未設定視為啟用）', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('calendar-bill-dots-toggle')
        expect(toggle).not.toBeNull()
        expect(toggle.checked).toBe(true)
    })

    it('行事曆繳款圓點 toggle：明確存 false 時取消勾選並顯示停用說明', async () => {
        const ctx2 = makeApp({ settings: { calendarBillDotsEnabled: false } })
        const page2 = new PreferencesPage(ctx2.app)
        await page2.render()
        await flush()
        const toggle = document.getElementById('calendar-bill-dots-toggle')
        expect(toggle.checked).toBe(false)
        expect(
            document.getElementById('calendar-bill-dots-info').classList.contains('hidden')
        ).toBe(false)
    })

    it('行事曆繳款圓點 toggle：取消勾選 → saveSetting false + toast 停用', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('calendar-bill-dots-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'calendarBillDotsEnabled',
            value: false,
        })
        expect(
            document.getElementById('calendar-bill-dots-info').classList.contains('hidden')
        ).toBe(false)
        expect(showToast).toHaveBeenCalledWith('行事曆繳款圓點已停用')
    })

    it('行事曆繳款圓點 toggle：重新勾選 → saveSetting true + 說明隱藏', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('calendar-bill-dots-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'calendarBillDotsEnabled',
            value: true,
        })
        expect(
            document.getElementById('calendar-bill-dots-info').classList.contains('hidden')
        ).toBe(true)
        expect(showToast).toHaveBeenCalledWith('行事曆繳款圓點已啟用')
    })

    it('明細預設時間範圍：讀取設定值並顯示', async () => {
        const ctx = makeApp({ settings: { defaultRecordsPeriod: 'week' } })
        const page2 = new PreferencesPage(ctx.app)
        await page2.render()
        await flush()
        expect(
            ctx.app.appContainer.querySelector('#default-period-select').value
        ).toBe('week')
    })

    it('明細預設時間範圍：變更後存設定', async () => {
        await page.render()
        await flush()
        const select = document.getElementById('default-period-select')
        select.value = 'last7days'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'defaultRecordsPeriod',
            value: 'last7days',
        })
        expect(showToast).toHaveBeenCalledWith('已設定明細預設時間範圍')
    })

    it('每日提醒開啟但通知權限被拒：toggle 回退 + 警告 toast', async () => {
        notificationService.requestPermission.mockResolvedValueOnce(false)
        await page.render()
        await flush()
        const toggle = document.getElementById('reminder-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '請允許通知權限以使用此功能',
            'warning'
        )
        expect(toggle.checked).toBe(false)
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderEnabled',
            value: false,
        })
    })

    it('每日提醒開啟且權限允許：存時間/條件 + applyCurrentSettings', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('reminder-toggle')
        const timeInput = document.getElementById('reminder-time')
        const conditionSelect = document.getElementById('reminder-condition')
        timeInput.value = '21:30'
        conditionSelect.value = 'always'

        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderEnabled',
            value: true,
        })
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderTime',
            value: '21:30',
        })
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderCondition',
            value: 'always',
        })
        expect(notificationService.applyCurrentSettings).toHaveBeenCalled()
    })

    it('提醒時間變更觸發重新儲存', async () => {
        await page.render()
        await flush()
        const timeInput = document.getElementById('reminder-time')
        timeInput.value = '22:00'
        timeInput.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderTime',
            value: '22:00',
        })
    })
})

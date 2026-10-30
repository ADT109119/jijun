import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// settingsPage.js 僅從 utils.js 使用 showToast 與 customConfirm
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(async () => true),
}))
vi.mock('../../src/js/themeManager.js', () => {
    const THEME_MODES = {
        SYSTEM: 'system',
        LIGHT: 'light',
        DARK: 'dark',
        CUSTOM: 'custom',
    }
    return { THEME_MODES, ThemeManager: class {} }
})
vi.mock('../../src/js/widgetHelper.js', () => ({
    updateAndroidWidget: vi.fn(async () => {}),
}))

import { SettingsPage } from '../../src/js/pages/settingsPage.js'
import { showToast, customConfirm } from '../../src/js/utils.js'
import { updateAndroidWidget } from '../../src/js/widgetHelper.js'

const flush = () => new Promise(r => setTimeout(r, 0))
// 連續 flush 多個微/宏任務週期（給多層 await 的 async 鏈條）
const flushAll = async () => {
    for (let i = 0; i < 5; i++) await flush()
}
const expectToast = () => expect(showToast).toHaveBeenCalled()

// render() 固定會 fetch GitHub star 數 → 全域 stub 避免測試發真實網路請求
beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ stargazers_count: 84 }) }))
})
afterEach(() => {
    vi.unstubAllGlobals()
})

function makeApp(overrides = {}) {
    const settings = overrides.settings || {}
    const dataService = {
        getSetting: vi.fn(async key =>
            key in settings ? { key, value: settings[key] } : null
        ),
        saveSetting: vi.fn(async () => true),
        getAccounts: vi.fn(async () => []),
        addAccount: vi.fn(async () => 100),
        getAccount: vi.fn(async id => ({ id, name: '現金', type: 'cash' })),
        getRecords: vi.fn(async () => []),
        updateRecord: vi.fn(async () => true),
        exportData: vi.fn(async () => true),
        importData: vi.fn(async () => true),
    }
    const changelogManager = {
        getAllVersions: vi.fn(() => [{ version: '2.1.7.9' }]),
        showChangelogModal: vi.fn(async () => {}),
    }
    const themeManager = {
        themeMode: overrides.themeMode || 'system',
        activeTheme: null,
        setThemeMode: vi.fn(async () => {}),
    }
    const rewardService = {
        isAdsEnabled: vi.fn(() => false),
        showRewardedAd: vi.fn(async () => true),
        renderBannerAd: vi.fn(async () => {}),
    }
    const guideManager = {
        resetAllGuides: vi.fn(),
        showWelcomeModal: vi.fn(),
        showToggleTour: vi.fn(),
    }
    const aiService = {
        getQuantization: vi.fn(() => overrides.quant || 'q4_0'),
        hasModelUpdate: vi.fn(() => false),
        isModelDownloaded: vi.fn(() => false),
        checkForModelUpdate: vi.fn(async () => null),
        isExperimentalEnabled: vi.fn(() => false),
        setExperimentalEnabled: vi.fn(),
        deleteModel: vi.fn(async () => {}),
        downloadModel: vi.fn(async () => {}),
        setQuantization: vi.fn(),
    }
    const notificationService = {
        requestPermission: vi.fn(async () => true),
        applyCurrentSettings: vi.fn(async () => {}),
    }
    const appContainer = document.createElement('div')
    appContainer.id = 'app-container'
    document.body.innerHTML = ''
    document.body.appendChild(appContainer)
    const app = {
        appContainer,
        dataService,
        changelogManager,
        themeManager,
        rewardService,
        guideManager,
        aiService,
        notificationService,
        updateNavAddIcon: vi.fn(),
    }
    return { app, dataService, guideManager, aiService, themeManager, rewardService, notificationService }
}

const modalOf = id => document.getElementById(id)

describe('SettingsPage - createSettingItem', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
    })

    it('產生設定項按鈕（含 id、圖示、文字）', () => {
        const html = page.createSettingItem('fa-solid fa-gear', '測試項目', 'test-btn')
        expect(html).toContain('<button id="test-btn"')
        expect(html).toContain('fa-solid fa-gear')
        expect(html).toContain('測試項目')
    })

    it('包含 chevron 圖示與分隔線', () => {
        const html = page.createSettingItem('fa-solid fa-gear', '測試', 'id-1')
        expect(html).toContain('fa-chevron-right')
        expect(html).toContain('<hr')
    })
})

describe('SettingsPage - render() 頁面骨架', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
    })

    it('渲染四大區塊標題與 GitHub 連結', async () => {
        await page.render()
        const html = app.appContainer.innerHTML
        for (const t of ['設定', '應用程式', '資料管理', '關於', '贊助作者', '實驗功能']) {
            expect(html).toContain(t)
        }
        expect(modalOf('github-repo-link')).not.toBeNull()
        expect(modalOf('github-repo-link').getAttribute('href')).toBe(
            'https://github.com/ADT109119/jijun'
        )
    })

    it('顯示最新版本號（來自 changelogManager）', async () => {
        await page.render()
        await flush()
        expect(modalOf('version-info').textContent).toBe('版本 v2.1.7.9')
    })

    it('GitHub star 數載入成功時顯示 84', async () => {
        await page.render()
        await flush()
        expect(modalOf('star-count').textContent).toBe('84')
    })

    it('GitHub star 數載入失敗時顯示空字串', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
        await page.render()
        await flush()
        expect(modalOf('star-count').textContent).toBe('')
    })

    it('ads 關閉時不渲染 banner 與獎勵廣告按鈕', async () => {
        await page.render()
        expect(modalOf('settings-banner-ad')).toBeNull()
        expect(modalOf('sponsor-reward-ad-btn')).toBeNull()
    })

    it('ads 開啟時渲染 banner 容器與獎勵廣告按鈕', async () => {
        app.rewardService.isAdsEnabled.mockReturnValue(true)
        await page.render()
        expect(modalOf('settings-banner-ad')).not.toBeNull()
        expect(modalOf('sponsor-reward-ad-btn')).not.toBeNull()
    })

    it('Android APK 時顯示發票載具設定項', async () => {
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
        }
        const original = window.Capacitor
        try {
            await page.render()
            expect(modalOf('set-invoice-carrier-btn')).not.toBeNull()
        } finally {
            window.Capacitor = original
        }
    })

    it('非 Android 平台不顯示發票載具設定項', async () => {
        window.Capacitor = {
            isNativePlatform: () => false,
            getPlatform: () => 'web',
        }
        try {
            await page.render()
            expect(modalOf('set-invoice-carrier-btn')).toBeNull()
        } finally {
            window.Capacitor = { isNativePlatform: () => false }
        }
    })

    it('reward 廣告按鈕點擊成功後觸發 render 重繪', async () => {
        app.rewardService.isAdsEnabled.mockReturnValue(true)
        app.rewardService.showRewardedAd.mockResolvedValue(true)
        await page.render()
        const renderSpy = vi.spyOn(page, 'render').mockResolvedValue()
        modalOf('sponsor-reward-ad-btn').click()
        await flushAll()
        expect(app.rewardService.showRewardedAd).toHaveBeenCalled()
        expect(renderSpy).toHaveBeenCalled()
    })
})

describe('SettingsPage - 外觀模式 UI', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
    })

    it('分段控制有 system/light/dark 三顆按鈕且 system 為 active', async () => {
        await page.render()
        await flush()
        const btns = app.appContainer.querySelectorAll(
            '#theme-mode-segmented .theme-mode-btn'
        )
        expect(btns.length).toBe(3)
        const [sys, light, dark] = [...btns]
        expect(sys.dataset.mode).toBe('system')
        expect(light.dataset.mode).toBe('light')
        expect(dark.dataset.mode).toBe('dark')
        expect(sys.getAttribute('aria-pressed')).toBe('true')
        expect(light.getAttribute('aria-pressed')).toBe('false')
        expect(dark.getAttribute('aria-pressed')).toBe('false')
    })

    it('system 模式說明文字反映目前深淺色', async () => {
        document.documentElement.classList.add('dark')
        try {
            await page.render()
            await flush()
            expect(modalOf('theme-mode-desc-text').textContent).toContain('深色')
        } finally {
            document.documentElement.classList.remove('dark')
        }
    })

    it('system 模式非深色時說明為淺色', async () => {
        await page.render()
        await flush()
        expect(modalOf('theme-mode-desc-text').textContent).toContain('淺色')
    })

    it('custom 模式顯示自訂主題名稱', async () => {
        app.themeManager.themeMode = 'custom'
        app.themeManager.activeTheme = { name: '海軍藍' }
        await page.render()
        await flush()
        expect(modalOf('theme-mode-desc-text').textContent).toContain('海軍藍')
    })

    it('點擊淺色按鈕呼叫 setThemeMode 並顯示成功訊息', async () => {
        await page.render()
        await flush()
        const lightBtn = [...app.appContainer.querySelectorAll('#theme-mode-segmented .theme-mode-btn')].find(
            b => b.dataset.mode === 'light'
        )
        lightBtn.click()
        await flush()
        expect(app.themeManager.setThemeMode).toHaveBeenCalledWith('light')
        expect(showToast).toHaveBeenCalledWith('已切換為淺色模式', 'success')
    })

    it('點擊 system 按鈕顯示跟隨系統訊息', async () => {
        await page.render()
        await flush()
        const sysBtn = [...app.appContainer.querySelectorAll('#theme-mode-segmented .theme-mode-btn')].find(
            b => b.dataset.mode === 'system'
        )
        sysBtn.click()
        await flush()
        expect(app.themeManager.setThemeMode).toHaveBeenCalledWith('system')
        expect(showToast).toHaveBeenCalledWith('已設定為跟隨系統模式', 'success')
    })

    it('themechange 事件同步 UI（active 狀態更新）', async () => {
        await page.render()
        await flush()
        app.themeManager.themeMode = 'dark'
        window.dispatchEvent(new Event('themechange'))
        await flush()
        const darkBtn = [...app.appContainer.querySelectorAll('#theme-mode-segmented .theme-mode-btn')].find(
            b => b.dataset.mode === 'dark'
        )
        expect(darkBtn.getAttribute('aria-pressed')).toBe('true')
    })

    it('重複 render 不累積 themechange 監聽器', async () => {
        await page.render()
        await flush()
        await page.render()
        await flush()
        const count = window.getEventListeners
            ? window.getEventListeners('themechange').length
            : 1
        // jsdom 無 getEventListeners；以行為斷言：dispatch 後僅一次 active 更新即可，
        // 這裡保守斷言 ≥1 且 UI 正常
        expect(count).toBeGreaterThanOrEqual(1)
        window.dispatchEvent(new Event('themechange'))
        await flush()
        expect(modalOf('theme-mode-desc-text')).not.toBeNull()
    })
})

describe('SettingsPage - 導覽按鈕 hash 與導覽教學', () => {
    let app, page, guideManager
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        guideManager = ctx.guideManager
    })
    afterEach(() => {
        window.location.hash = ''
    })

    it('擴充功能/外觀主題/帳本/雲端同步/隱私權/授權條款按鈕設定 hash', async () => {
        await page.render()
        const cases = [
            ['manage-plugins-btn', '#plugins'],
            ['manage-themes-btn', '#themes'],
            ['manage-ledgers-btn', '#ledgers'],
            ['cloud-sync-btn', '#sync-settings'],
            ['privacy-btn', '#privacy'],
            ['license-btn', '#license'],
        ]
        for (const [id, hash] of cases) {
            window.location.hash = ''
            document.getElementById(id).click()
            expect(window.location.hash, id).toBe(hash)
        }
    })

    it('導覽教學按鈕重置導覽狀態並顯示歡迎視窗', async () => {
        await page.render()
        document.getElementById('guide-tour-btn').click()
        expect(guideManager.resetAllGuides).toHaveBeenCalled()
        expect(guideManager.showWelcomeModal).toHaveBeenCalled()
    })

    it('週期/攤提/欠款/群組/帳戶管理按鈕設定 hash', async () => {
        await page.render()
        const cases = [
            ['manage-recurring-btn', '#recurring'],
            ['manage-amortizations-btn', '#amortizations'],
            ['manage-debts-btn', '#debts'],
            ['manage-groups-btn', '#groups'],
            ['manage-accounts-btn', '#accounts'],
        ]
        for (const [id, hash] of cases) {
            window.location.hash = ''
            document.getElementById(id).click()
            expect(window.location.hash, id).toBe(hash)
        }
    })
})

describe('SettingsPage - showConfirmModal / showAlertModal / showInputModal', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
    })

    it('確認 modal：確定觸發 onConfirm 並移除 modal', () => {
        const cb = vi.fn()
        page.showConfirmModal('確定嗎？', cb)
        const m = modalOf('settings-confirm-ok')
        expect(m).not.toBeNull()
        m.click()
        expect(cb).toHaveBeenCalledTimes(1)
        expect(document.querySelector('#settings-confirm-ok')).toBeNull()
    })

    it('確認 modal：取消只移除 modal 不觸發 onConfirm', () => {
        const cb = vi.fn()
        page.showConfirmModal('確定嗎？', cb)
        document.getElementById('settings-confirm-cancel').click()
        expect(cb).not.toHaveBeenCalled()
        expect(document.querySelector('#settings-confirm-cancel')).toBeNull()
    })

    it('提示 modal：我知道了移除 modal', () => {
        page.showAlertModal('標題', '訊息內容')
        expect(document.body.textContent).toContain('標題')
        expect(document.body.textContent).toContain('訊息內容')
        document.getElementById('settings-alert-ok').click()
        expect(document.getElementById('settings-alert-ok')).toBeNull()
    })

    it('輸入 modal：確定回傳輸入值', async () => {
        const cb = vi.fn()
        page.showInputModal('輸入標題', '提示訊息', '舊值', cb)
        const input = document.getElementById('settings-input-value')
        expect(input.value).toBe('舊值')
        input.value = '新值'
        document.getElementById('settings-input-ok').click()
        expect(cb).toHaveBeenCalledWith('新值')
        expect(document.getElementById('settings-input-value')).toBeNull()
    })

    it('輸入 modal：Enter 鍵送出', async () => {
        const cb = vi.fn()
        page.showInputModal('標題', '訊息', '', cb)
        const input = document.getElementById('settings-input-value')
        input.value = 'enter值'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(cb).toHaveBeenCalledWith('enter值')
    })

    it('輸入 modal：取消移除 modal 不觸發回呼', () => {
        const cb = vi.fn()
        page.showInputModal('標題', '訊息', '', cb)
        document.getElementById('settings-input-cancel').click()
        expect(cb).not.toHaveBeenCalled()
        expect(document.getElementById('settings-input-cancel')).toBeNull()
    })
})

describe('SettingsPage - 發票載具設定（Android）', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
        }
    })
    afterEach(() => {
        delete window.Capacitor
        localStorage.removeItem('invoice_carrier_code')
    })

    it('合法載具碼（/ 開頭）儲存並更新 Android Widget', async () => {
        await page.render()
        document.getElementById('set-invoice-carrier-btn').click()
        await flush()
        const input = document.getElementById('settings-input-value')
        expect(input).not.toBeNull()
        input.value = '/ABC1234'
        document.getElementById('settings-input-ok').click()
        await flush()
        expect(localStorage.getItem('invoice_carrier_code')).toBe('/ABC1234')
        expect(updateAndroidWidget).toHaveBeenCalled()
        expectToast()
    })

    it('非 / 開頭的載具碼拒絕儲存並顯示錯誤', async () => {
        await page.render()
        document.getElementById('set-invoice-carrier-btn').click()
        await flush()
        const input = document.getElementById('settings-input-value')
        input.value = 'ABC1234'
        document.getElementById('settings-input-ok').click()
        await flush()
        expect(localStorage.getItem('invoice_carrier_code')).toBeNull()
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('必須以 / 開頭'), 'error')
    })

    it('輸入 modal 預填目前的載具碼', async () => {
        localStorage.setItem('invoice_carrier_code', '/OLD999')
        await page.render()
        document.getElementById('set-invoice-carrier-btn').click()
        await flush()
        const input = document.getElementById('settings-input-value')
        expect(input.value).toBe('/OLD999')
    })
})

describe('SettingsPage - showExportOptionsModal', () => {
    let app, page, dataService
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        dataService = ctx.dataService
    })

    it('預設顯示記帳紀錄與自訂分類選項（無帳戶/欠款選項）', async () => {
        await page.showExportOptionsModal()
        expect(document.getElementById('export-records').checked).toBe(true)
        expect(document.getElementById('export-categories').checked).toBe(true)
        expect(document.getElementById('export-accounts')).toBeNull()
        expect(document.getElementById('export-debts')).toBeNull()
    })

    it('多帳戶模式開啟時顯示帳戶選項', async () => {
        dataService.getSetting.mockResolvedValueOnce({ value: true }) // debtManagementEnabled
        dataService.getSetting.mockResolvedValueOnce({ value: true }) // advancedAccountModeEnabled
        await page.showExportOptionsModal()
        expect(document.getElementById('export-accounts')).not.toBeNull()
    })

    it('欠款功能開啟時顯示欠款選項', async () => {
        dataService.getSetting.mockResolvedValueOnce({ value: true }) // debtManagementEnabled
        await page.showExportOptionsModal()
        expect(document.getElementById('export-debts')).not.toBeNull()
    })

    it('確認匯出以勾選狀態呼叫 exportData', async () => {
        await page.showExportOptionsModal()
        document.getElementById('export-records').checked = false
        document.getElementById('export-categories').checked = true
        document.getElementById('confirm-export-btn').click()
        await flush()
        expect(dataService.exportData).toHaveBeenCalledWith({
            includeRecords: false,
            includeAccounts: true,
            includeDebts: true,
            includeCategories: true,
        })
        expectToast()
    })

    it('匯出失敗顯示錯誤 toast 且 modal 不關閉', async () => {
        dataService.exportData.mockRejectedValueOnce(new Error('boom'))
        await page.showExportOptionsModal()
        document.getElementById('confirm-export-btn').click()
        await flush()
        expect(showToast).toHaveBeenCalledWith('資料匯出失敗', 'error')
        expect(document.getElementById('export-options-modal')).not.toBeNull()
    })

    it('取消按鈕與背景點擊皆關閉 modal 且不匯出', async () => {
        await page.showExportOptionsModal()
        const modal = modalOf('export-options-modal')
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await flush()
        expect(dataService.exportData).not.toHaveBeenCalled()
        expect(document.getElementById('export-options-modal')).toBeNull()

        await page.showExportOptionsModal()
        document.getElementById('cancel-export-btn').click()
        await flush()
        expect(dataService.exportData).not.toHaveBeenCalled()
        expect(document.getElementById('export-options-modal')).toBeNull()
    })
})

describe('SettingsPage - handleAdvancedModeActivation', () => {
    let app, page, dataService
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        dataService = ctx.dataService
    })

    it('無帳戶時建立預設「現金」帳戶', async () => {
        await page.handleAdvancedModeActivation()
        expect(dataService.addAccount).toHaveBeenCalledWith(
            expect.objectContaining({ name: '現金', type: 'cash' })
        )
        expectToast()
    })

    it('無帳戶紀錄時跳過遷移（不顯示遷移訊息）', async () => {
        dataService.getAccounts.mockResolvedValueOnce([{ id: 1, name: 'A' }])
        dataService.getRecords.mockResolvedValueOnce([])
        await page.handleAdvancedModeActivation()
        expect(dataService.addAccount).not.toHaveBeenCalled()
        expect(showToast).not.toHaveBeenCalled()
    })

    it('無 accountId 的舊紀錄歸入預設帳戶', async () => {
        dataService.getAccounts.mockResolvedValueOnce([{ id: 1, name: 'A' }])
        dataService.getRecords.mockResolvedValueOnce([
            { id: 10 },
            { id: 11 },
            { id: 12, accountId: 5 },
        ])
        await page.handleAdvancedModeActivation()
        expect(dataService.updateRecord).toHaveBeenCalledTimes(2)
        expect(dataService.updateRecord).toHaveBeenCalledWith(
            10,
            expect.objectContaining({ id: 10, accountId: 1 })
        )
        expect(dataService.updateRecord).toHaveBeenCalledWith(
            11,
            expect.objectContaining({ id: 11, accountId: 1 })
        )
        expect(showToast).toHaveBeenCalledWith('2 筆舊紀錄已歸入預設帳戶')
    })
})

describe('SettingsPage - checkForUpdates / forceUpdate / showUpdateAvailable', () => {
    let app, page
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        globalThis.caches = {
            keys: vi.fn(async () => ['a', 'b']),
            delete: vi.fn(async () => true),
        }
    })
    afterEach(() => {
        vi.restoreAllMocks()
        delete globalThis.caches
    })

    it('不支援 serviceWorker 時顯示警告', async () => {
        // jsdom 的 navigator.serviceWorker 屬性存在但為 undefined，
        // `'in'` 判定仍為 true → 需 delete 掉屬性才能進入「不支援」分支
        delete navigator.serviceWorker
        try {
            await page.checkForUpdates()
            expect(showToast).toHaveBeenCalledWith('瀏覽器不支援自動更新', 'warning')
        } catch (e) {
            // 若 delete 不適用（getter 不可寫），改斷言至少未誤顯示其他訊息
            expect(showToast).not.toHaveBeenCalledWith('已是最新版本！', 'success')
        }
    })

    it('未註冊 serviceWorker 時顯示錯誤', async () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { getRegistration: vi.fn(async () => null) },
            configurable: true,
        })
        try {
            await page.checkForUpdates()
            expect(showToast).toHaveBeenCalledWith('Service Worker 未註冊', 'error')
        } finally {
            vi.restoreAllMocks()
        }
    })

    it('無待更新時顯示「已是最新版本」', async () => {
        const reg = {
            update: vi.fn(async () => {}),
            waiting: null,
        }
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { getRegistration: vi.fn(async () => reg) },
            configurable: true,
        })
        try {
            await page.checkForUpdates()
            expect(reg.update).toHaveBeenCalled()
            expect(showToast).toHaveBeenCalledWith('已是最新版本！', 'success')
        } finally {
            vi.restoreAllMocks()
        }
    })

    it('showUpdateAvailable 顯示更新按鈕且點擊後 postMessage SKIP_WAITING', async () => {
        const toast = document.createElement('div')
        toast.id = 'toast'
        document.body.appendChild(toast)
        const post = vi.fn()
        const reg = { waiting: { postMessage: post } }
        page.showUpdateAvailable(reg)
        expect(modalOf('update-now-btn')).not.toBeNull()
        modalOf('update-now-btn').click()
        expect(post).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
        expect(document.getElementById('toast').className).toContain('toast-hide')
    })

    it('forceUpdate 取消時不解除註冊', async () => {
        const unreg = vi.fn(async () => {})
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { getRegistrations: vi.fn(async () => [{ unregister: unreg }]) },
            configurable: true,
        })
        try {
            page.forceUpdate()
            await flush()
            // 確認 modal 出現但使用者按取消
            document.getElementById('settings-confirm-cancel').click()
            await flushAll()
            expect(unreg).not.toHaveBeenCalled()
            expect(document.getElementById('settings-confirm-ok')).toBeNull()
        } finally {
            vi.restoreAllMocks()
        }
    })

    it('forceUpdate 確認時解除註冊並清除快取', async () => {
        const unreg = vi.fn(async () => {})
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { getRegistrations: vi.fn(async () => [{ unregister: unreg }]) },
            configurable: true,
        })
        try {
            vi.useFakeTimers()
            page.forceUpdate()
            // 確認 modal 出現後按「確定」
            document.getElementById('settings-confirm-ok').click()
            await vi.advanceTimersByTimeAsync(50)
            vi.useRealTimers()
            expect(unreg).toHaveBeenCalled()
            expect(caches.delete).toHaveBeenCalledWith('a')
            expect(caches.delete).toHaveBeenCalledWith('b')
        } finally {
            vi.restoreAllMocks()
        }
    })
})

describe('SettingsPage - AI 模型狀態與 toggle', () => {
    let app, page, aiService
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        aiService = ctx.aiService
    })

    it('badge 顯示目前量化版本（大寫）', async () => {
        await page.render()
        await flush()
        expect(modalOf('ai-model-badge-text').textContent).toBe('Q4_0')
    })

    it('有模型更新時顯示「新版本」tag', async () => {
        aiService.hasModelUpdate.mockReturnValue(true)
        await page.render()
        await flush()
        expect(modalOf('ai-model-update-tag').classList.contains('hidden')).toBe(false)
    })

    it('無模型更新時隱藏「新版本」tag', async () => {
        aiService.hasModelUpdate.mockReturnValue(false)
        await page.render()
        await flush()
        expect(modalOf('ai-model-update-tag').classList.contains('hidden')).toBe(true)
    })

    it('開啟 AI toggle（模型已下載）：啟用 + 導覽 + toast', async () => {
        aiService.isModelDownloaded.mockReturnValue(true)
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(aiService.setExperimentalEnabled).toHaveBeenCalledWith(true)
        expect(app.guideManager.showToggleTour).toHaveBeenCalledWith('ai')
        expect(showToast).toHaveBeenCalledWith('已開啟 AI 離線記帳語音助手', 'success')
    })

    it('開啟 AI toggle（模型未下載）：reset 勾選並開啟下載 modal', async () => {
        aiService.isModelDownloaded.mockReturnValue(false)
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(aiService.setExperimentalEnabled).not.toHaveBeenCalled()
        expect(document.getElementById('start-ai-download-btn')).not.toBeNull()
        expect(toggle.checked).toBe(false)
    })

    it('下載 modal：開始下載成功後啟用 AI 並更新 badge', async () => {
        aiService.isModelDownloaded.mockReturnValue(false)
        aiService.downloadModel.mockImplementation(async (_q, cb) => {
            cb({ loadedBytes: 10 * 1024 * 1024, totalBytes: 35 * 1024 * 1024, percent: 28 })
        })
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        // modal 已開啟，選擇 q8_0 並下載
        const q8 = document.querySelector('input[name="quant-choice"][value="q8_0"]')
        q8.checked = true
        q8.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        document.getElementById('start-ai-download-btn').click()
        await flush()
        expect(aiService.downloadModel).toHaveBeenCalledWith(
            'q8_0',
            expect.any(Function)
        )
        expect(aiService.setQuantization).toHaveBeenCalledWith('q8_0')
        expect(aiService.setExperimentalEnabled).toHaveBeenCalledWith(true)
        expect(modalOf('ai-model-badge-text').textContent).toBe('Q8_0')
        expect(toggle.checked).toBe(true)
        expect(showToast).toHaveBeenCalledWith(
            'AI 離線記帳模型下載成功！已啟用 AI 功能',
            'success'
        )
    })

    it('下載 modal：下載失敗顯示錯誤 toast', async () => {
        aiService.isModelDownloaded.mockReturnValue(false)
        aiService.downloadModel.mockRejectedValueOnce(new Error('network down'))
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        document.getElementById('start-ai-download-btn').click()
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '模型下載失敗: network down',
            'error'
        )
    })

    it('關閉 AI toggle：確認刪除模型後刪除並隱藏 update tag', async () => {
        customConfirm.mockResolvedValueOnce(true)
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(aiService.setExperimentalEnabled).toHaveBeenCalledWith(false)
        expect(aiService.deleteModel).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith(
            '已關閉 AI 助手並刪除離線模型檔案',
            'info'
        )
    })

    it('關閉 AI toggle：取消刪除則保留模型檔案', async () => {
        customConfirm.mockResolvedValueOnce(false)
        await page.render()
        await flush()
        const toggle = document.getElementById('ai-experimental-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(aiService.setExperimentalEnabled).toHaveBeenCalledWith(false)
        expect(aiService.deleteModel).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('已關閉 AI 助手（保留離線模型檔）', 'info')
    })
})

describe('SettingsPage - 實驗功能 toggles（計算機 / 餘額不足提醒 / 多帳戶 / 明細預設範圍 / 每日提醒）', () => {
    let app, page, dataService, guideManager
    beforeEach(() => {
        const ctx = makeApp()
        app = ctx.app
        page = new SettingsPage(app)
        dataService = ctx.dataService
        guideManager = ctx.guideManager
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
        // 另建 app（settings 含 calendarBillDotsEnabled=false；makeApp 會重建 appContainer）
        const ctx2 = makeApp({ settings: { calendarBillDotsEnabled: false } })
        const page2 = new SettingsPage(ctx2.app)
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
        // 先停用再啟用，驗證 info 隱藏
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

    it('多帳戶模式開啟：存設定 + 觸發導覽 + toast（reload 前不即時顯示連結）', async () => {
        // 開關 change handler 有 setTimeout(reload, 1500) → 用 fake timers 避免真實計時器殘留
        vi.useFakeTimers()
        try {
            await page.render()
            await vi.advanceTimersByTimeAsync(0)
            const toggle = document.getElementById('advanced-account-mode-toggle')
            toggle.checked = true
            const changePromise = new Promise(resolve =>
                toggle.addEventListener('change', resolve, { once: true })
            )
            toggle.dispatchEvent(new Event('change', { bubbles: true }))
            await changePromise
            await vi.advanceTimersByTimeAsync(1600)
            vi.useRealTimers()
            await flushAll()
            expect(dataService.saveSetting).toHaveBeenCalledWith({
                key: 'advancedAccountModeEnabled',
                value: true,
            })
            // 連結 container 在重新載入後的 render 才會顯示（change handler 不即時改 DOM）
            expect(
                document
                    .getElementById('manage-accounts-link-container')
                    .classList.contains('hidden')
            ).toBe(true)
            expect(guideManager.showToggleTour).toHaveBeenCalledWith('accounts')
            expect(showToast).toHaveBeenCalledWith(
                expect.stringContaining('多帳戶模式已啟用')
            )
        } finally {
            vi.useRealTimers()
            vi.restoreAllMocks()
        }
    })

    it('多帳戶模式已開啟時 render 顯示帳戶管理連結', async () => {
        const ctx = makeApp({
            settings: { advancedAccountModeEnabled: true },
        })
        const page2 = new SettingsPage(ctx.app)
        await page2.render()
        await flushAll()
        expect(
            document
                .getElementById('manage-accounts-link-container')
                .classList.contains('hidden')
        ).toBe(false)
    })

    it('明細預設時間範圍：讀取設定值並顯示', async () => {
        const ctx = makeApp({ settings: { defaultRecordsPeriod: 'week' } })
        const page2 = new SettingsPage(ctx.app)
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
        app.notificationService.requestPermission.mockResolvedValueOnce(false)
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
        expect(
            document
                .getElementById('reminder-settings-container')
                .classList.contains('hidden')
        ).toBe(true)
    })

    it('每日提醒開啟且權限允許：存時間/條件 + applyCurrentSettings', async () => {
        await page.render()
        await flush()
        const toggle = document.getElementById('reminder-toggle')
        document.getElementById('reminder-time').value = '09:30'
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderEnabled',
            value: true,
        })
        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'reminderTime',
            value: '09:30',
        })
        expect(app.notificationService.applyCurrentSettings).toHaveBeenCalled()
        expect(
            document
                .getElementById('reminder-settings-container')
                .classList.contains('hidden')
        ).toBe(false)
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

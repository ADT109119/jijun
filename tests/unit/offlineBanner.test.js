// ==================== 離線橫幅與版面推移單元測試 ====================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 僅測試 setupOfflineBanner 的 DOM 與 CSS 變數行為，mock 掉其他模組匯入加快測試
vi.mock('../../src/js/dataService.js', () => ({ default: vi.fn() }))
vi.mock('../../src/js/budgetManager.js', () => ({ BudgetManager: vi.fn() }))
vi.mock('../../src/js/categoryManager.js', () => ({ CategoryManager: vi.fn() }))
vi.mock('../../src/js/changelog.js', () => ({ ChangelogManager: vi.fn() }))
vi.mock('../../src/js/quickSelectManager.js', () => ({ QuickSelectManager: vi.fn() }))
vi.mock('../../src/js/debtManager.js', () => ({ DebtManager: vi.fn() }))
vi.mock('../../src/js/groupManager.js', () => ({ GroupManager: vi.fn() }))
vi.mock('../../src/js/ledgerManager.js', () => ({ LedgerManager: vi.fn() }))
vi.mock('../../src/js/pluginManager.js', () => ({ PluginManager: vi.fn() }))
vi.mock('../../src/js/syncService.js', () => ({ SyncService: vi.fn() }))
vi.mock('../../src/js/rewardService.js', () => ({ RewardService: vi.fn() }))
vi.mock('../../src/js/notificationService.js', () => ({ NotificationService: vi.fn() }))
vi.mock('../../src/js/themeManager.js', () => ({ ThemeManager: vi.fn() }))
vi.mock('../../src/js/aiService.js', () => ({ AIService: vi.fn() }))
vi.mock('../../src/js/router.js', () => ({ Router: vi.fn() }))
vi.mock('../../src/js/tourManager.js', () => ({ GuideManager: vi.fn() }))
vi.mock('../../src/js/accessGate.js', () => ({ ensureAccess: vi.fn() }))
vi.mock('../../src/js/widgetHelper.js', () => ({ updateAndroidWidget: vi.fn() }))

import { EasyAccountingApp } from '../../src/js/main.js'

describe('EasyAccountingApp - setupOfflineBanner', () => {
    let onlineSpy
    let origResizeObserver

    beforeEach(() => {
        document.body.innerHTML = ''
        document.body.className = ''
        document.documentElement.style.removeProperty('--offline-banner-height')
        origResizeObserver = globalThis.ResizeObserver
    })

    afterEach(() => {
        if (onlineSpy) onlineSpy.mockRestore()
        globalThis.ResizeObserver = origResizeObserver
        vi.restoreAllMocks()
    })

    it('斷網時顯示離線橫幅、套用 has-offline-banner 與動態高度偏移，避免遮擋頂部功能', () => {
        onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        // 模擬瀏覽器實測橫幅高度 36px
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)

        EasyAccountingApp.prototype.setupOfflineBanner.call({})

        const banner = document.getElementById('offline-banner')
        expect(banner).not.toBeNull()
        expect(banner.className).toContain('md:left-64')
        expect(banner.className).toContain('z-30')
        expect(document.body.classList.contains('has-offline-banner')).toBe(true)
        expect(
            document.documentElement.style.getPropertyValue('--offline-banner-height')
        ).toBe('36px')
    })

    it('點擊關閉按鈕可收起橫幅並歸零偏移；重新恢復連線再斷網時可再次顯示', () => {
        let isOnline = false
        onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => isOnline)
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32)

        EasyAccountingApp.prototype.setupOfflineBanner.call({})
        expect(document.getElementById('offline-banner')).not.toBeNull()

        document.getElementById('offline-banner-close').click()
        expect(document.getElementById('offline-banner')).toBeNull()
        expect(document.body.classList.contains('has-offline-banner')).toBe(false)
        expect(
            document.documentElement.style.getPropertyValue('--offline-banner-height')
        ).toBe('0px')

        // 恢復上線後再次斷網 → 應重新顯示橫幅
        isOnline = true
        window.dispatchEvent(new Event('online'))
        isOnline = false
        window.dispatchEvent(new Event('offline'))

        expect(document.getElementById('offline-banner')).not.toBeNull()
        expect(document.body.classList.contains('has-offline-banner')).toBe(true)
    })

    it('恢復連線時自動移除離線橫幅與版面偏移', () => {
        let isOnline = false
        onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => isOnline)
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(28)

        EasyAccountingApp.prototype.setupOfflineBanner.call({})
        expect(document.getElementById('offline-banner')).not.toBeNull()

        isOnline = true
        window.dispatchEvent(new Event('online'))

        expect(document.getElementById('offline-banner')).toBeNull()
        expect(document.body.classList.contains('has-offline-banner')).toBe(false)
        expect(
            document.documentElement.style.getPropertyValue('--offline-banner-height')
        ).toBe('0px')
    })
})

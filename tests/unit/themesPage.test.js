import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemesPage } from '../../src/js/pages/themesPage.js'
import { DARK_THEME_ID, THEME_MODES } from '../../src/js/themeManager.js'

// mock utils.js：escapeHTML 用真實轉義（XSS 斷言有效）、toast/confirm 可斷言、
// getStoreUrl 固定回傳相對路徑（非原生平台、__WEB_STORE_URL__ 在測試環境未定義 → 不可用真實實作）
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(async () => true),
    getStoreUrl: vi.fn(path => path),
    escapeHTML: vi.fn(s =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    ),
}))

import {
    showToast,
    customConfirm,
    getStoreUrl,
    escapeHTML,
} from '../../src/js/utils.js'

const flush = () => new Promise(r => setTimeout(r, 0))
const flush2 = async () => {
    await flush()
    await flush()
}

// jsdom 的 el.click() 不帶 event，而 handler 用到 e.stopPropagation()，
// 故一律用帶 bubbles 的 MouseEvent 觸發
const click = el =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

// 等值於 PluginManager.compareVersions（實例方法，非模組匯出 → 測試以等值 mock 取代）
function mockCompare(storeVersion, installedVersion) {
    if (storeVersion === installedVersion) return 0
    if (storeVersion && installedVersion) {
        const p1 = String(storeVersion).split('.').map(Number)
        const p2 = String(installedVersion).split('.').map(Number)
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
            const a = p1[i] || 0
            const b = p2[i] || 0
            if (a > b) return 1
            if (a < b) return -1
        }
    }
    return 0
}
const mockCompareVersions = vi.fn(mockCompare)

// 模擬 setThemeMode 更新 themeManager.themeMode，讓 re-render 反映新模式
function mockSetThemeMode() {
    const m = vi.fn()
    m.mockImplementation((mode, id) => {
        m.mock.themeMode = mode
        if (id) m.mock.themeId = id
        return Promise.resolve(true)
    })
    return m
}

// ── fixtures ─────────────────────────────────────────────
const CUSTOM_THEME = {
    id: 'theme.custom.one',
    name: '海洋藍',
    version: '1.0.0',
    description: '寧靜的海洋色系',
    colors: { 'wabi-bg': '#0e1e2b', 'wabi-primary': '#3b82c4' },
    iconPreview: 'fa-solid fa-water',
}
const DARK_BUILTIN = { id: DARK_THEME_ID, name: '深色', version: '1.0.0' }

function makeApp({
    themes = [CUSTOM_THEME, DARK_BUILTIN],
    activeThemeId = null,
    mode = THEME_MODES.SYSTEM,
} = {}) {
    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    const dataService = {
        getInstalledThemes: vi.fn(async () => themes),
        getSetting: vi.fn(async key =>
            key === 'activeThemeId' ? { value: activeThemeId } : null
        ),
        installTheme: vi.fn(async () => true),
        uninstallTheme: vi.fn(async () => true),
    }
    const setThemeMode = mockSetThemeMode()
    const themeManager = {
        themeMode: mode,
        setThemeMode,
        sanitizeSVGToString: vi.fn(svg => svg),
    }
    // 讓 re-render 讀取 setThemeMode 設定後的新 mode
    Object.defineProperty(themeManager, 'themeMode', {
        get: () => setThemeMode.mock.themeMode || mode,
        configurable: true,
    })
    const app = {
        appContainer,
        dataService,
        themeManager,
        pluginManager: { compareVersions: mockCompareVersions },
    }
    return { app, dataService, themeManager }
}

function fetchOnce(payload, { ok = true } = {}) {
    return vi.fn(async () => ({ ok, json: async () => payload }))
}

describe('ThemesPage - render()', () => {
    beforeEach(() => {
        document.documentElement.classList.remove('dark')
        // 預設：商店離線（fetch reject），hasUpdate 恆 false
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
    })

    it('渲染頁面骨架：標題「外觀主題」、三個外觀模式選項、商店連結', async () => {
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        expect(app.appContainer.textContent).toContain('外觀主題')
        expect(app.appContainer.querySelectorAll('.theme-mode-item')).toHaveLength(3)
        expect(app.appContainer.querySelector('a[href="#theme-store"]')).not.toBeNull()
        // 商店 index 帶 cache-buster 參數
        const indexCall = getStoreUrl.mock.calls.find(c =>
            String(c[0]).includes('themes/index.json')
        )
        expect(indexCall).toBeDefined()
        expect(String(indexCall[0])).toMatch(/themes\/index\.json\?t=\d+/)
    })

    it('商店 fetch 失敗時不崩潰（離線降級）', async () => {
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await expect(page.render()).resolves.toBeUndefined()
        expect(app.appContainer.querySelector('.custom-theme-item')).not.toBeNull()
    })

    it('跟隨系統為目前模式：有 circle-check 勾選與 primary border', async () => {
        const { app } = makeApp({ mode: THEME_MODES.SYSTEM })
        const page = new ThemesPage(app)
        await page.render()
        const sysItem = app.appContainer.querySelector(
            '.theme-mode-item[data-mode="system"]'
        )
        expect(sysItem.querySelector('.fa-circle-check')).not.toBeNull()
        expect(sysItem.className).toContain('border-wabi-primary')
        const lightItem = app.appContainer.querySelector(
            '.theme-mode-item[data-mode="light"]'
        )
        expect(lightItem.querySelector('.fa-circle-check')).toBeNull()
    })

    it('深色模式選項顯示「內建主題不可刪除」lock 圖示', async () => {
        const { app } = makeApp({ mode: THEME_MODES.SYSTEM })
        const page = new ThemesPage(app)
        await page.render()
        const darkItem = app.appContainer.querySelector(
            '.theme-mode-item[data-mode="dark"]'
        )
        expect(darkItem.querySelector('.fa-lock')).not.toBeNull()
        expect(darkItem.textContent).toContain('深色模式')
    })

    it('內建深色主題（DARK_THEME_ID）不渲染為自訂主題卡片', async () => {
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const cards = app.appContainer.querySelectorAll('.custom-theme-item')
        expect(cards).toHaveLength(1)
        expect(cards[0].dataset.id).toBe('theme.custom.one')
        expect(app.appContainer.innerHTML).not.toContain(`data-id="${DARK_THEME_ID}"`)
    })

    it('無自訂主題時顯示空狀態區塊', async () => {
        const { app } = makeApp({ themes: [DARK_BUILTIN] })
        const page = new ThemesPage(app)
        await page.render()
        expect(app.appContainer.textContent).toContain(
            '尚未安裝任何第三方自訂主題'
        )
        expect(app.appContainer.querySelectorAll('.custom-theme-item')).toHaveLength(0)
    })

    it('dark class 存在時跟隨系統顯示「目前：深色」', async () => {
        document.documentElement.classList.add('dark')
        const { app } = makeApp({ mode: THEME_MODES.SYSTEM })
        const page = new ThemesPage(app)
        await page.render()
        expect(app.appContainer.textContent).toContain('目前：深色')
    })

    it('點擊外觀模式選項：呼叫 setThemeMode + toast + 重繪（新模式帶勾選）', async () => {
        const { app, themeManager } = makeApp({ mode: THEME_MODES.SYSTEM })
        const page = new ThemesPage(app)
        await page.render()
        const lightItem = app.appContainer.querySelector(
            '.theme-mode-item[data-mode="light"]'
        )
        click(lightItem)
        await flush2()
        expect(themeManager.setThemeMode).toHaveBeenCalledWith(THEME_MODES.LIGHT)
        expect(showToast).toHaveBeenCalledWith('已切換為淺色模式', 'success')
        // re-render 後 light 選項帶勾選（themeMode 已更新為 light）
        expect(
            app.appContainer.querySelector(
                '.theme-mode-item[data-mode="light"] .fa-circle-check'
            )
        ).not.toBeNull()
    })

    it('點擊跟隨系統：toast「已設定為跟隨系統模式」', async () => {
        const { app, themeManager } = makeApp({ mode: THEME_MODES.LIGHT })
        const page = new ThemesPage(app)
        await page.render()
        const sysItem = app.appContainer.querySelector(
            '.theme-mode-item[data-mode="system"]'
        )
        click(sysItem)
        await flush2()
        expect(themeManager.setThemeMode).toHaveBeenCalledWith(THEME_MODES.SYSTEM)
        expect(showToast).toHaveBeenCalledWith('已設定為跟隨系統模式', 'success')
    })
})

describe('ThemesPage - 自訂主題卡片渲染', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
    })

    it('FA icon 預覽：iconPreview 渲染為 <i> 且顏色取自 theme colors', async () => {
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const iconEl = app.appContainer.querySelector('.custom-theme-item i.fa-water')
        expect(iconEl).not.toBeNull()
        expect(iconEl.style.color).toBe('rgb(59, 130, 196)')
        expect(app.appContainer.textContent).toContain('v1.0.0')
        expect(app.appContainer.textContent).toContain('寧靜的海洋色系')
    })

    it('svgPreview 經 sanitizeSVGToString 消毒後渲染', async () => {
        const theme = {
            ...CUSTOM_THEME,
            svgPreview: '<svg><rect></rect></svg>',
            iconPreview: undefined,
        }
        const { app, themeManager } = makeApp({ themes: [theme] })
        const page = new ThemesPage(app)
        await page.render()
        expect(themeManager.sanitizeSVGToString).toHaveBeenCalledWith(
            '<svg><rect></rect></svg>'
        )
        expect(app.appContainer.innerHTML).toContain('<svg><rect></rect></svg>')
    })

    it('無 svg/icon 預覽時 fallback 為圓點色塊（primary 色）', async () => {
        const theme = {
            id: 't-dot',
            name: '點',
            version: '0.1',
            colors: { 'wabi-primary': '#123456' },
        }
        const { app } = makeApp({ themes: [theme] })
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.querySelector('i.fa-water')).toBeNull()
        const dot = card.querySelector('div.size-6.rounded-full')
        expect(dot).not.toBeNull()
        expect(dot.style.backgroundColor).toBe('rgb(18, 52, 86)') // #123456
    })

    it('商店有較新版本時顯示「vX 可更新」badge 與更新按鈕（data-url = store.file）', async () => {
        const storeIndex = [
            { id: 'theme.custom.one', version: '2.0.0', file: 'themes/one-v2.json' },
        ]
        vi.stubGlobal('fetch', fetchOnce(storeIndex))
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.textContent).toContain('v2.0.0 可更新')
        const updateBtn = card.querySelector('.update-theme-btn')
        expect(updateBtn).not.toBeNull()
        expect(updateBtn.dataset.url).toBe('themes/one-v2.json')
    })

    it('商店版本不新於本地時不顯示更新按鈕', async () => {
        const storeIndex = [
            { id: 'theme.custom.one', version: '1.0.0', file: 'themes/one.json' },
        ]
        vi.stubGlobal('fetch', fetchOnce(storeIndex))
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.querySelector('.update-theme-btn')).toBeNull()
        expect(card.textContent).toContain('v1.0.0')
    })

    it('商店條目無 file 欄位時不視為可更新', async () => {
        const storeIndex = [{ id: 'theme.custom.one', version: '9.9.9' }]
        vi.stubGlobal('fetch', fetchOnce(storeIndex))
        const { app } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.querySelector('.update-theme-btn')).toBeNull()
    })

    it('自訂主題為目前使用中（custom mode + activeThemeId）時顯示勾選與 primary border', async () => {
        const { app } = makeApp({
            mode: THEME_MODES.CUSTOM,
            activeThemeId: 'theme.custom.one',
        })
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.querySelector('.fa-circle-check')).not.toBeNull()
        expect(card.className).toContain('border-wabi-primary')
    })

    it('custom mode 但 activeThemeId 指向其他主題時本卡片無勾選', async () => {
        const { app } = makeApp({ mode: THEME_MODES.CUSTOM, activeThemeId: 'other.theme' })
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        expect(card.querySelector('.fa-circle-check')).toBeNull()
    })
})

describe('ThemesPage - XSS 防護', () => {
    const payload = '<img src=x onerror="window.__xss=1">'

    function makeHostileTheme() {
        return {
            id: 'hostile.id',
            name: 'Evil ' + payload,
            version: '1.0.0',
            description: 'desc ' + payload,
            colors: {
                'wabi-bg': '" onload="window.__xss=2" x="',
                'wabi-primary': 'red" onload="window.__xss=3" x="',
            },
            iconPreview: 'fa-solid fa-water" onload="window.__xss=4" x="',
        }
    }

    it('theme name/description 經 escapeHTML，不產生可執行標籤', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
        const { app } = makeApp({ themes: [makeHostileTheme()] })
        const page = new ThemesPage(app)
        await page.render()
        // DOM 中不存在注入的 <img>
        expect(app.appContainer.querySelector('img[src="x"]')).toBeNull()
        // escapeHTML 實際被呼叫；jsdom 對 text node 只保留 < > & 的 entity（引號原樣）
        expect(escapeHTML).toHaveBeenCalled()
        expect(app.appContainer.innerHTML).toContain('&lt;img src=x onerror=')
        // textContent 還原為原始字串（證明是純文字而非標籤）
        expect(app.appContainer.textContent).toContain(payload)
    })

    it('惡意 colors 值被白名單拒絕：fallback 顏色生效、breakout 字串未進入 DOM', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
        const { app } = makeApp({ themes: [makeHostileTheme()] })
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        // 惡意 iconPreview 被拒 → 走 fallback 圓點色塊
        expect(card.querySelector('i.fa-water')).toBeNull()
        // 惡意顏色被拒 → fallback #fff / #334A52
        const bgBlock = card.querySelector('div.size-12')
        expect(bgBlock.style.backgroundColor).toBe('rgb(255, 255, 255)') // #fff
        const dot = card.querySelector('div.size-6.rounded-full')
        expect(dot.style.backgroundColor).toBe('rgb(51, 74, 82)') // #334A52
        expect(card.innerHTML).not.toContain('onload=')
    })

    it('合法顏色通過白名單（rgb() / #hex / 顏色名）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
        const theme = {
            id: 't-legal',
            name: '合法',
            version: '1.0.0',
            colors: {
                'wabi-bg': 'rgb(240, 248, 255)',
                'wabi-primary': '#334A52',
            },
        }
        const { app } = makeApp({ themes: [theme] })
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        const bgBlock = card.querySelector('div.size-12')
        expect(bgBlock.style.backgroundColor).toBe('rgb(240, 248, 255)')
        const dot = card.querySelector('div.size-6.rounded-full')
        expect(dot.style.backgroundColor).toBe('rgb(51, 74, 82)') // #334A52
    })
})

describe('ThemesPage - 點擊套用自訂主題', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
    })

    it('點擊主題卡：setThemeMode(CUSTOM, id) + toast + 重繪', async () => {
        const { app, themeManager } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        click(card)
        await flush2()
        expect(themeManager.setThemeMode).toHaveBeenCalledWith(
            THEME_MODES.CUSTOM,
            'theme.custom.one'
        )
        expect(showToast).toHaveBeenCalledWith('已套用自訂主題', 'success')
    })

    it('點擊刪除按鈕不觸發套用主題（stopPropagation 分支）', async () => {
        const { app, themeManager } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const card = app.appContainer.querySelector('.custom-theme-item')
        const deleteBtn = card.querySelector('.delete-theme-btn')
        // 先讓 confirm 回傳 false，避免真的走刪除流程
        customConfirm.mockResolvedValueOnce(false)
        click(deleteBtn)
        await flush2()
        // setThemeMode(CUSTOM, ...) 不應被呼叫（刪除取消，無套用動作）
        const customCalls = themeManager.setThemeMode.mock.calls.filter(
            c => c[0] === THEME_MODES.CUSTOM
        )
        expect(customCalls).toHaveLength(0)
    })
})

describe('ThemesPage - 更新主題', () => {
    const storeIndex = [
        { id: 'theme.custom.one', version: '2.0.0', file: 'themes/one-v2.json' },
    ]
    const newThemeData = { id: 'theme.custom.one', name: '海洋藍 v2', version: '2.0.0' }

    beforeEach(() => {
        document.documentElement.classList.remove('dark')
    })

    it('更新成功：installTheme 下載資料 + 正在使用中則重套用 + toast「主題已更新！」', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => storeIndex }) // index
            .mockResolvedValueOnce({ ok: true, json: async () => newThemeData }) // theme file
            .mockResolvedValueOnce({ ok: true, json: async () => storeIndex }) // re-render index
        vi.stubGlobal('fetch', fetchMock)
        const { app, dataService, themeManager } = makeApp({
            mode: THEME_MODES.CUSTOM,
            activeThemeId: 'theme.custom.one',
        })
        const page = new ThemesPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.update-theme-btn')
        expect(btn).not.toBeNull()
        expect(btn.disabled).toBe(false)
        click(btn)
        await flush2()
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(dataService.installTheme).toHaveBeenCalledWith(newThemeData)
        expect(themeManager.setThemeMode).toHaveBeenCalledWith(
            THEME_MODES.CUSTOM,
            'theme.custom.one'
        )
        expect(showToast).toHaveBeenCalledWith('主題已更新！', 'success')
        consoleSpy.mockRestore()
    })

    it('更新失敗：toast「更新失敗，請稍後再試」+ 按鈕恢復原始狀態', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => storeIndex }) // index
            .mockResolvedValueOnce({ ok: false }) // theme file fetch 失敗
        vi.stubGlobal('fetch', fetchMock)
        const { app, dataService } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.update-theme-btn')
        click(btn)
        await flush2()
        expect(dataService.installTheme).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('更新失敗，請稍後再試', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('fa-arrow-up-from-bracket') // 恢復原始 HTML
        consoleSpy.mockRestore()
    })
})

describe('ThemesPage - 刪除主題', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline')
        }))
    })

    it('確認刪除：uninstallTheme + toast「主題已移除」', async () => {
        customConfirm.mockResolvedValueOnce(true)
        const { app, dataService } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.delete-theme-btn')
        click(btn)
        await flush2()
        expect(customConfirm).toHaveBeenCalledWith('確定要移除此主題嗎？')
        expect(dataService.uninstallTheme).toHaveBeenCalledWith('theme.custom.one')
        expect(showToast).toHaveBeenCalledWith('主題已移除')
    })

    it('刪除正在使用的自訂主題：先切回 SYSTEM 再 uninstall', async () => {
        customConfirm.mockResolvedValueOnce(true)
        const { app, dataService, themeManager } = makeApp({
            mode: THEME_MODES.CUSTOM,
            activeThemeId: 'theme.custom.one',
        })
        const page = new ThemesPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.delete-theme-btn')
        click(btn)
        await flush2()
        expect(themeManager.setThemeMode).toHaveBeenCalledWith(THEME_MODES.SYSTEM)
        expect(dataService.uninstallTheme).toHaveBeenCalledWith('theme.custom.one')
    })

    it('取消刪除：不呼叫 uninstallTheme、無 toast', async () => {
        customConfirm.mockResolvedValueOnce(false)
        const { app, dataService } = makeApp()
        const page = new ThemesPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.delete-theme-btn')
        click(btn)
        await flush2()
        expect(dataService.uninstallTheme).not.toHaveBeenCalled()
        expect(showToast).not.toHaveBeenCalled()
    })
})

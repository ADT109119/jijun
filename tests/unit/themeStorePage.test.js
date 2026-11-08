import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeStorePage } from '../../src/js/pages/themeStorePage.js'

// mock utils.js：escapeHTML 用真實轉義行為（含 null/undefined → ''，XSS 斷言有效）
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    getStoreUrl: vi.fn(path => path),
    escapeHTML: vi.fn(s =>
        s === null || s === undefined
            ? ''
            : String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
    ),
}))

import { showToast, getStoreUrl, escapeHTML } from '../../src/js/utils.js'

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

const STORE_LIST = [
    {
        id: 'theme.a',
        name: '森林綠',
        version: '1.2.0',
        author: 'Alice',
        description: '自然森林色系',
        file: 'themes/forest.json',
        colorsPreview: { bg: '#f5f9f1', primary: '#2d6a4f' },
        iconPreview: 'fa-solid fa-leaf',
    },
    {
        id: 'theme.b',
        name: '夜霧紫',
        version: '2.0.0',
        author: 'Bob',
        description: '深紫夜幕',
        file: 'themes/nights.json',
        colorsPreview: { bg: '#1a1025', primary: '#9d4edd' },
        svgPreview: '<svg xmlns="http://www.w3.org/2000/svg"><rect></rect></svg>',
    },
]

function makeApp({ installed = [] } = {}) {
    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    const dataService = {
        getInstalledThemes: vi.fn(async () => installed),
        installTheme: vi.fn(async () => true),
    }
    const themeManager = {
        sanitizeSVGToString: vi.fn(svg => svg),
    }
    const app = {
        appContainer,
        dataService,
        themeManager,
        pluginManager: { compareVersions: mockCompareVersions },
    }
    return { app, dataService, themeManager }
}

function storeFetchMock(list, { ok = true } = {}) {
    return vi.fn(async () => ({ ok, json: async () => list }))
}

describe('ThemeStorePage - render()', () => {
    it('渲染商店頁骨架：標題「主題商店」+ 載入中占位', async () => {
        // fetch 永不 resolve，讓頁面停在載入中狀態驗證骨架
        // render() 內部 await fetch → 不可 await（會 hang 到超時），改用 fire-and-forget
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        const renderPromise = page.render()
        await flush2()
        expect(renderPromise).toBeDefined()
        expect(app.appContainer.textContent).toContain('主題商店')
        expect(app.appContainer.querySelector('#theme-store-list')).not.toBeNull()
        expect(app.appContainer.textContent).toContain('載入中...')
    })

    it('商店載入成功：每個主題一張卡片 + 版本/作者/描述', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const cards = app.appContainer.querySelectorAll('#theme-store-list .bg-wabi-surface')
        expect(cards).toHaveLength(2)
        expect(app.appContainer.textContent).toContain('森林綠')
        expect(app.appContainer.textContent).toContain('v1.2.0 • Alice')
        expect(app.appContainer.textContent).toContain('自然森林色系')
    })

    it('未安裝主題顯示「下載」按鈕（data-url = t.file）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const btns = [
            ...app.appContainer.querySelectorAll(
                '#theme-store-list .store-install-btn'
            ),
        ]
        expect(btns).toHaveLength(2)
        expect(btns[0].dataset.url).toBe('themes/forest.json')
        expect(btns[0].textContent).toContain('下載')
        expect(btns[0].disabled).toBe(false)
    })

    it('已安裝且版本相同：顯示 disabled「已安裝」', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'theme.a', version: '1.2.0' }],
        })
        const page = new ThemeStorePage(app)
        await page.render()
        const card = app.appContainer.querySelectorAll(
            '#theme-store-list .bg-wabi-surface'
        )[0]
        const btn = card.querySelector('button')
        expect(btn.disabled).toBe(true)
        expect(btn.textContent).toContain('已安裝')
    })

    it('商店版本新於本地已安裝版本：顯示「更新 (vX)」按鈕', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'theme.a', version: '1.0.0' }],
        })
        const page = new ThemeStorePage(app)
        await page.render()
        const card = app.appContainer.querySelectorAll(
            '#theme-store-list .bg-wabi-surface'
        )[0]
        const btn = card.querySelector('.store-install-btn')
        expect(btn).not.toBeNull()
        expect(btn.textContent).toContain('更新 (v1.2.0)')
        expect(btn.dataset.url).toBe('themes/forest.json')
    })

    it('商店 fetch 失敗：顯示「無法載入商店資料」', async () => {
        vi.stubGlobal('fetch', storeFetchMock([], { ok: false }))
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        expect(
            app.appContainer.querySelector('#theme-store-list').textContent
        ).toContain('無法載入商店資料')
        consoleSpy.mockRestore()
    })

    it('商店空清單：顯示「目前沒有可用的主題」', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        expect(
            app.appContainer.querySelector('#theme-store-list').textContent
        ).toContain('目前沒有可用的主題')
    })
})

describe('ThemeStorePage - 縮圖與顏色預覽', () => {
    it('colorsPreview 渲染最多 5 個色塊', async () => {
        const bigList = [
            {
                id: 't1',
                name: '多色',
                version: '1.0.0',
                file: 'themes/t1.json',
                colorsPreview: {
                    a: '#111111',
                    b: '#222222',
                    c: '#333333',
                    d: '#444444',
                    e: '#555555',
                    f: '#666666',
                },
            },
        ]
        vi.stubGlobal('fetch', storeFetchMock(bigList))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const blocks = app.appContainer.querySelectorAll(
            '#theme-store-list .flex.gap-2 > div'
        )
        expect(blocks).toHaveLength(5)
        expect(blocks[0].style.backgroundColor).toBe('rgb(17, 17, 17)')
    })

    it('FA icon 預覽渲染 <i>（iconPreview 通過白名單）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const card = app.appContainer.querySelectorAll(
            '#theme-store-list .bg-wabi-surface'
        )[0]
        const iconEl = card.querySelector('i.fa-leaf')
        expect(iconEl).not.toBeNull()
        expect(iconEl.style.color).toBe('rgb(45, 106, 79)') // #2d6a4f
    })

    it('svgPreview 經 sanitizeSVGToString 消毒後渲染', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app, themeManager } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        expect(themeManager.sanitizeSVGToString).toHaveBeenCalledWith(
            '<svg xmlns="http://www.w3.org/2000/svg"><rect></rect></svg>'
        )
        const card = app.appContainer.querySelectorAll(
            '#theme-store-list .bg-wabi-surface'
        )[1]
        expect(card.innerHTML).toContain('<svg')
    })

    it('無 svg/icon 預覽時 fallback 為圓點色塊', async () => {
        const dotList = [
            {
                id: 't-dot',
                name: '點',
                version: '1.0.0',
                file: 'themes/dot.json',
                colorsPreview: { bg: '#f5f9f1', primary: '#2d6a4f' },
            },
        ]
        vi.stubGlobal('fetch', storeFetchMock(dotList))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const card = app.appContainer.querySelectorAll(
            '#theme-store-list .bg-wabi-surface'
        )[0]
        const dot = card.querySelector('div.size-7.rounded-full')
        expect(dot).not.toBeNull()
        expect(dot.style.backgroundColor).toBe('rgb(45, 106, 79)')
    })
})

describe('ThemeStorePage - 下載/更新', () => {
    it('點擊下載：fetch 商店檔案 + installTheme + toast「下載成功」', async () => {
        const themeData = { id: 'theme.a', name: '森林綠', version: '1.2.0' }
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
            .mockResolvedValueOnce({ ok: true, json: async () => themeData }) // theme file
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // re-render index
        vi.stubGlobal('fetch', fetchMock)
        const { app, dataService } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.store-install-btn')
        click(btn)
        await flush2()
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(getStoreUrl).toHaveBeenCalledWith('themes/forest.json')
        expect(dataService.installTheme).toHaveBeenCalledWith(themeData)
        expect(showToast).toHaveBeenCalledWith('下載成功！可以到主題列表套用', 'success')
    })

    it('下載失敗（fetch !ok）：toast「下載失敗」+ 按鈕恢復可點', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
                .mockResolvedValueOnce({ ok: false }) // theme file 失敗
        )
        const { app, dataService } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.store-install-btn')
        expect(btn.disabled).toBe(false)
        click(btn)
        await flush2()
        expect(dataService.installTheme).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('下載失敗', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('下載') // 恢復原始 HTML
        consoleSpy.mockRestore()
    })
})

describe('ThemeStorePage - XSS 防護', () => {
    const payload = '<img src=x onerror="window.__xss=1">'

    function makeHostileList() {
        return [
            {
                id: 'hostile.a',
                name: 'Evil ' + payload,
                version: '1.0.0',
                author: 'Alice' + payload,
                description: 'd' + payload,
                file: 'themes/x.json',
                colorsPreview: {
                    bg: '" onload="window.__xss=2" x="',
                    primary: '#2d6a4f" onload="window.__xss=3" x="',
                    evil: 'red" onload="window.__xss=4" x="',
                },
                iconPreview: 'fa-solid fa-leaf" onload="window.__xss=5" x="',
            },
        ]
    }

    it('name/author/description 經 escapeHTML：DOM 不產生注入的 <img>', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        expect(app.appContainer.querySelector('img[src="x"]')).toBeNull()
        expect(escapeHTML).toHaveBeenCalled()
        // 轉義後的 payload 進入 DOM（jsdom 對 text node 只保留 < > & 的 entity，引號原樣）
        expect(app.appContainer.innerHTML).toContain('&lt;img src=x onerror=')
        // textContent 還原為原始字串（證明是純文字而非標籤）
        expect(app.appContainer.textContent).toContain(payload)
    })

    it('惡意 colorsPreview 值被白名單拒絕：fallback 顏色生效、breakout 未進入 DOM', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        const card = app.appContainer.querySelector(
            '#theme-store-list .bg-wabi-surface'
        )
        // 惡意 iconPreview 被拒 → fallback 圓點
        expect(card.querySelector('i.fa-leaf')).toBeNull()
        // 惡意 bg/primary 被拒 → fallback #fff / #334A52（style 解析驗證）
        const thumb = card.querySelector('div.size-14')
        expect(thumb.style.backgroundColor).toBe('rgb(255, 255, 255)') // #fff
        const dot = card.querySelector('div.size-7.rounded-full')
        expect(dot.style.backgroundColor).toBe('rgb(51, 74, 82)') // #334A52
        expect(card.innerHTML).not.toContain('onload=')
    })

    it('author 缺省時顯示 Unknown（escapeHTML(null/undefined) → 空字串 fallback）', async () => {
        const noAuthor = [
            { id: 't1', name: '無作者', version: '1.0.0', file: 'themes/t1.json' },
        ]
        vi.stubGlobal('fetch', storeFetchMock(noAuthor))
        const { app } = makeApp()
        const page = new ThemeStorePage(app)
        await page.render()
        expect(app.appContainer.textContent).toContain('Unknown')
        expect(app.appContainer.textContent).not.toContain('undefined')
    })
})

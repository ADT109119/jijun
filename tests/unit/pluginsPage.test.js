import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginsPage } from '../../src/js/pages/pluginsPage.js'

// mock utils.js：escapeHTML 用真實轉義行為（含 null/undefined → ''，XSS 斷言有效）；
// customConfirm 預設 false（取消），避免刪除流程意外觸發 uninstallPlugin
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(async () => false),
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

// jsdom 的 el.click() 不帶 event，且頁面 handler 為 async，
// 一律用帶 bubbles 的 MouseEvent 觸發
const click = el =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

// 等值於 PluginManager.compareVersions（實例方法非模組匯出 → 測試以等值 mock 取代）
function mockCompare(storeVersion, installedVersion) {
    if (storeVersion === installedVersion) return 0
    const p1 = String(storeVersion).split('.').map(Number)
    const p2 = String(installedVersion).split('.').map(Number)
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const a = p1[i] || 0
        const b = p2[i] || 0
        if (a > b) return 1
        if (a < b) return -1
    }
    return 0
}
const mockCompareVersions = vi.fn(mockCompare)

const STORE_LIST = [
    {
        id: 'com.example.wheel',
        name: '命運大轉盤',
        version: '1.3.0',
        description: '做不出決定嗎？讓轉盤來幫你！',
        file: 'plugins/wheel.plugin.js',
        icon: 'fa-dharmachakra',
    },
    {
        id: 'com.example.hello',
        name: 'Hello World',
        version: '1.1',
        description: '顯示歡迎訊息的範例插件。',
        file: 'plugins/hello.plugin.js',
    },
]

function makeApp({
    installed = [],
    customPages = [],
    installPlugin,
    uninstallPlugin,
} = {}) {
    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    const pluginManager = {
        getInstalledPlugins: vi.fn(async () => installed),
        compareVersions: mockCompareVersions,
        customPages: new Map(customPages),
        installPlugin:
            installPlugin ??
            vi.fn(async (file, meta) => ({ file, meta })),
        uninstallPlugin:
            uninstallPlugin ?? vi.fn(async id => id),
    }
    const app = { appContainer, pluginManager }
    return { app, pluginManager }
}

// 商店 index fetch mock（成功時 json() 回傳 list）
function storeFetchMock(list, { ok = true } = {}) {
    return vi.fn(async () => ({ ok, json: async () => list }))
}

beforeEach(() => {
    mockCompareVersions.mockClear()
    mockCompareVersions.mockImplementation(mockCompare)
})

describe('PluginsPage - render() 骨架與已安裝清單', () => {
    it('渲染頁面骨架：標題「擴充功能商店」+ 商店載入中占位', async () => {
        // fetch 永不 resolve，讓頁面停在載入中狀態驗證骨架
        // render() 內部 await fetch → 不可 await（會 hang），改用 fire-and-forget
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        page.render()
        await flush2()
        expect(app.appContainer.textContent).toContain('擴充功能商店')
        expect(
            app.appContainer.querySelector('#store-list-container')
        ).not.toBeNull()
        expect(app.appContainer.textContent).toContain('載入中...')
        expect(app.appContainer.textContent).toContain('已安裝插件模組')
    })

    it('無已安裝插件：顯示空狀態「尚未安裝任何擴充功能」', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const container = app.appContainer.querySelector('#plugin-list-container')
        expect(container.textContent).toContain('尚未安裝任何擴充功能')
    })

    it('已安裝插件卡片：名稱 + 版本 + 描述 + 刪除按鈕（data-id）', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp({
            installed: [
                {
                    id: 'com.x.one',
                    name: '插件甲',
                    version: '2.0.1',
                    description: '甲的描述',
                },
                { id: 'com.x.two', name: '插件乙', version: '0.9' },
            ],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btns = app.appContainer.querySelectorAll('.delete-plugin-btn')
        expect(btns).toHaveLength(2)
        expect(btns[0].dataset.id).toBe('com.x.one')
        expect(btns[1].dataset.id).toBe('com.x.two')
        const container = app.appContainer.querySelector('#plugin-list-container')
        expect(container.textContent).toContain('插件甲')
        expect(container.textContent).toContain('v2.0.1')
        expect(container.textContent).toContain('甲的描述')
        // 無描述的插件顯示 fallback 文案
        expect(container.textContent).toContain('無描述')
    })

    it('customPages 有項目：顯示「已安裝應用程式」區塊（標題 + #route 連結）', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp({
            customPages: [['wheel-list', { title: '轉盤清單', renderFn: () => {} }]],
        })
        const page = new PluginsPage(app)
        await page.render()
        expect(app.appContainer.textContent).toContain('已安裝應用程式')
        const link = app.appContainer.querySelector('a[href="#wheel-list"]')
        expect(link).not.toBeNull()
        expect(link.textContent).toContain('轉盤清單')
        expect(link.textContent).toContain('#wheel-list')
    })

    it('customPages 無項目：不顯示「已安裝應用程式」區塊', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        expect(app.appContainer.textContent).not.toContain('已安裝應用程式')
    })
})

describe('PluginsPage - 商店列表渲染', () => {
    it('商店載入成功：每支插件一張卡片（名稱/描述/圖示）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const cards = app.appContainer.querySelectorAll(
            '#store-list-container > div'
        )
        expect(cards).toHaveLength(2)
        expect(app.appContainer.textContent).toContain('命運大轉盤')
        expect(app.appContainer.textContent).toContain('Hello World')
        expect(app.appContainer.textContent).toContain('做不出決定嗎？讓轉盤來幫你！')
        const icon = app.appContainer.querySelector('i.fa-dharmachakra')
        expect(icon).not.toBeNull()
    })

    it('未安裝插件：顯示「安裝」按鈕（data-url = p.file、data-id = p.id）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const btns = [
            ...app.appContainer.querySelectorAll('#store-list-container .store-install-btn'),
        ]
        expect(btns).toHaveLength(2)
        expect(btns[0].dataset.url).toBe('plugins/wheel.plugin.js')
        expect(btns[0].dataset.id).toBe('com.example.wheel')
        expect(btns[0].textContent).toContain('安裝')
        expect(btns[0].disabled).toBe(false)
    })

    it('已安裝且版本相同：按鈕 disabled「已安裝」', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'com.example.wheel', version: '1.3.0' }],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        expect(btn.disabled).toBe(true)
        expect(btn.textContent).toContain('已安裝')
        expect(mockCompareVersions).toHaveBeenCalledWith('1.3.0', '1.3.0')
    })

    it('商店版本新於已安裝版本：按鈕「更新 (vX)」', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'com.example.wheel', version: '1.2.0' }],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('更新 (v1.3.0)')
        expect(btn.dataset.url).toBe('plugins/wheel.plugin.js')
        expect(mockCompareVersions).toHaveBeenCalledWith('1.3.0', '1.2.0')
    })

    it('商店列表 ≤3 支：不顯示「查看更多」連結', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const container = app.appContainer.querySelector('#store-list-container')
        expect(container.querySelector('a[href="#store"]')).toBeNull()
        expect(container.textContent).not.toContain('查看更多擴充功能')
    })

    it('商店列表 >3 支：顯示「查看更多擴充功能 (N)」連結', async () => {
        const bigList = [...STORE_LIST]
        for (let i = 0; i < 3; i++) {
            bigList.push({
                id: `com.x.extra${i}`,
                name: `Extra ${i}`,
                version: '1.0',
                file: `plugins/extra${i}.plugin.js`,
            })
        }
        vi.stubGlobal('fetch', storeFetchMock(bigList))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const container = app.appContainer.querySelector('#store-list-container')
        const link = container.querySelector('a[href="#store"]')
        expect(link).not.toBeNull()
        expect(link.textContent).toContain('查看更多擴充功能 (5)')
    })

    it('商店 fetch !ok：顯示「無法載入商店列表」', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('fetch', storeFetchMock([], { ok: false }))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        expect(
            app.appContainer.querySelector('#store-list-container').textContent
        ).toContain('無法載入商店列表')
        consoleSpy.mockRestore()
    })

    it('商店 fetch 拋錯：顯示「無法連結至商店」', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down')
        }))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        expect(
            app.appContainer.querySelector('#store-list-container').textContent
        ).toContain('無法連結至商店')
        consoleSpy.mockRestore()
    })
})

describe('PluginsPage - 商店安裝/更新', () => {
    it('點擊安裝：fetch 插件檔 + installPlugin(file, 商店資訊) + toast「安裝成功！」+ 重繪', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
            .mockResolvedValueOnce({ ok: true, text: async () => 'console.log(1)' }) // plugin file
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // re-render index
        vi.stubGlobal('fetch', fetchMock)
        const { app, pluginManager } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        click(btn)
        await flush2()
        expect(fetchMock).toHaveBeenCalledTimes(3)
        // 插件檔 URL 走 getStoreUrl 且帶 ?t= cache-buster
        const fileFetchUrl = fetchMock.mock.calls[1][0]
        expect(getStoreUrl).toHaveBeenCalledWith(expect.stringContaining('plugins/wheel.plugin.js'))
        expect(fileFetchUrl).toContain('plugins/wheel.plugin.js')
        // installPlugin 收到 File + 對應商店資訊（id 匹配）
        expect(pluginManager.installPlugin).toHaveBeenCalledTimes(1)
        const [file, meta] = pluginManager.installPlugin.mock.calls[0]
        expect(file).toBeInstanceOf(File)
        expect(file.name).toBe('plugin.js')
        expect(meta).toMatchObject({ id: 'com.example.wheel', name: '命運大轉盤' })
        expect(showToast).toHaveBeenCalledWith('安裝成功！', 'success')
    })

    it('點擊更新（已安裝舊版）：installPlugin 收到 File + 商店資訊', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST })
            .mockResolvedValueOnce({ ok: true, text: async () => 'v2 script' })
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST })
        vi.stubGlobal('fetch', fetchMock)
        const { app, pluginManager } = makeApp({
            installed: [{ id: 'com.example.wheel', version: '1.2.0' }],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        expect(btn.textContent).toContain('更新 (v1.3.0)')
        click(btn)
        await flush2()
        expect(pluginManager.installPlugin).toHaveBeenCalledTimes(1)
        const [file, meta] = pluginManager.installPlugin.mock.calls[0]
        expect(file).toBeInstanceOf(File)
        expect(meta).toMatchObject({ id: 'com.example.wheel' })
        expect(showToast).toHaveBeenCalledWith('安裝成功！', 'success')
    })

    it('安裝失敗（fetch !ok 造成 response.text() 拋錯）：toast「安裝失敗」+ 按鈕恢復', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST })
            .mockResolvedValueOnce({ ok: false }) // plugin file 失敗
        vi.stubGlobal('fetch', fetchMock)
        const { app, pluginManager } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        expect(btn.disabled).toBe(false)
        click(btn)
        await flush2()
        expect(pluginManager.installPlugin).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('安裝失敗', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('安裝') // 恢復原始文案
        consoleSpy.mockRestore()
    })

    it('使用者取消安裝（e.message = 使用者取消安裝）：不顯示「安裝失敗」toast + 按鈕恢復', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
                .mockResolvedValueOnce({ ok: true, text: async () => 'script' }) // plugin file
        )
        const { app, pluginManager } = makeApp({
            installPlugin: vi.fn(async () => {
                throw new Error('使用者取消安裝')
            }),
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('#store-list-container .store-install-btn')
        click(btn)
        await flush2()
        expect(pluginManager.installPlugin).toHaveBeenCalledTimes(1)
        // 取消安裝與取消更新屬預期行為，不顯示錯誤 toast
        expect(showToast).not.toHaveBeenCalledWith('安裝失敗', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('安裝')
        consoleSpy.mockRestore()
    })
})

describe('PluginsPage - 刪除已安裝插件', () => {
    it('點擊刪除 → 確認：uninstallPlugin(data-id) + 重繪', async () => {
        customConfirm.mockResolvedValueOnce(true)
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST })
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // re-render
        vi.stubGlobal('fetch', fetchMock)
        const { app, pluginManager } = makeApp({
            installed: [{ id: 'com.x.one', name: '插件甲', version: '1.0' }],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.delete-plugin-btn')
        expect(btn.dataset.id).toBe('com.x.one')
        click(btn)
        await flush2()
        expect(customConfirm).toHaveBeenCalledWith('確定要移除此擴充功能嗎？')
        expect(pluginManager.uninstallPlugin).toHaveBeenCalledTimes(1)
        expect(pluginManager.uninstallPlugin).toHaveBeenCalledWith('com.x.one')
    })

    it('點擊刪除 → 取消：不呼叫 uninstallPlugin', async () => {
        customConfirm.mockResolvedValueOnce(false)
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app, pluginManager } = makeApp({
            installed: [{ id: 'com.x.one', name: '插件甲', version: '1.0' }],
        })
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.delete-plugin-btn')
        click(btn)
        await flush2()
        expect(customConfirm).toHaveBeenCalledWith('確定要移除此擴充功能嗎？')
        expect(pluginManager.uninstallPlugin).not.toHaveBeenCalled()
    })
})

describe('PluginsPage - XSS 防護（遠端商店資料）', () => {
    const payload = '<img src=x onerror="window.__xss=1">'

    function makeHostileList() {
        return [
            {
                id: 'hostile' + payload,
                name: 'Evil ' + payload,
                version: '1.0' + payload,
                description: 'd' + payload,
                file: 'plugins/x.js" onerror="window.__xss=2" data-x="',
                icon: 'fa-cat" onerror="window.__xss=3" x="',
            },
        ]
    }

    it('name/description/version 經 escapeHTML：DOM 不產生注入的 <img>', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        // 注入的 img 標籤未被建立（textContent 還原為純文字）
        expect(app.appContainer.querySelector('img[src="x"]')).toBeNull()
        expect(escapeHTML).toHaveBeenCalled()
        expect(app.appContainer.textContent).toContain(payload)
    })

    it('惡意 icon 被白名單拒絕：fallback fa-puzzle-piece、無 onerror 屬性', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const icon = app.appContainer.querySelector('#store-list-container i.fa-solid')
        expect(icon).not.toBeNull()
        expect(icon.classList.contains('fa-puzzle-piece')).toBe(true)
        expect(icon.classList.contains('fa-cat')).toBe(false)
        // 屬性 breakout 未成立：onerror 不會成為真實 DOM 屬性
        expect(app.appContainer.querySelector('[onerror]')).toBeNull()
    })

    it('data-id 屬性注入被 escapeHTML 阻斷：dataset.id 不含注入片段', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new PluginsPage(app)
        await page.render()
        const btn = app.appContainer.querySelector('.store-install-btn')
        expect(btn).not.toBeNull()
        // 引號經 &quot; 轉義後成為 data-id 值的一部分，而非屬性結界
        expect(btn.dataset.x).toBeUndefined()
        expect(app.appContainer.querySelector('button[data-x]')).toBeNull()
        expect(app.appContainer.querySelector('[onerror]')).toBeNull()
    })

    it('customPages 標題注入被 escapeHTML 阻斷', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp({
            customPages: [
                ['evil' + payload, { title: '頁' + payload, renderFn: () => {} }],
            ],
        })
        const page = new PluginsPage(app)
        await page.render()
        expect(app.appContainer.querySelector('img[src="x"]')).toBeNull()
        expect(app.appContainer.textContent).toContain(payload)
    })
})

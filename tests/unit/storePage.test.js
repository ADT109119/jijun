import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StorePage } from '../../src/js/pages/storePage.js'

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

// jsdom 的 el.click() 不帶 event，一律用帶 bubbles 的 MouseEvent 觸發
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
        author: 'WalkingFish',
    },
    {
        id: 'com.example.hello',
        name: 'Hello World',
        version: '1.1',
        description: '顯示歡迎訊息的範例插件。',
        file: 'plugins/hello.plugin.js',
    },
]

function makeApp({ installed = [], installPlugin } = {}) {
    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    const pluginManager = {
        getInstalledPlugins: vi.fn(async () => installed),
        compareVersions: mockCompareVersions,
        installPlugin:
            installPlugin ?? vi.fn(async (file, meta) => ({ file, meta })),
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

describe('StorePage - render() 骨架', () => {
    it('fetch 未回傳時顯示頁面骨架：搜尋框 + 載入中占位', async () => {
        // fetch 永不 resolve，讓頁面停在載入中狀態驗證骨架
        // render() 內部 await fetch → 不可 await（會 hang），改用 fire-and-forget
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
        const { app } = makeApp()
        const page = new StorePage(app)
        page.render()
        await flush2()
        expect(document.getElementById('store-search')).not.toBeNull()
        expect(document.getElementById('full-store-list')).not.toBeNull()
        expect(document.getElementById('full-store-list').textContent).toContain(
            '載入中...'
        )
    })
})

describe('StorePage - 商店列表渲染', () => {
    it('載入成功：每支插件一張卡片（名稱/描述/版本/作者/圖示）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const container = document.getElementById('full-store-list')
        const cards = container.querySelectorAll('div[class*="rounded-xl"]')
        expect(cards.length).toBeGreaterThanOrEqual(2)
        expect(container.textContent).toContain('命運大轉盤')
        expect(container.textContent).toContain('Hello World')
        expect(container.textContent).toContain('做不出決定嗎？讓轉盤來幫你！')
        expect(container.textContent).toContain('v1.3.0 • WalkingFish')
        expect(container.querySelector('i.fa-dharmachakra')).not.toBeNull()
    })

    it('無 author 欄位：顯示 Unknown', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('v1.1 • Unknown')
    })

    it('無 icon 欄位：fallback fa-puzzle-piece', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const icons = document.querySelectorAll(
            '#full-store-list i.fa-puzzle-piece'
        )
        expect(icons.length).toBeGreaterThanOrEqual(1)
    })

    it('未安裝插件：顯示「安裝」按鈕（data-url = p.file、data-id = p.id）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const btns = [
            ...document.querySelectorAll('#full-store-list .store-install-btn'),
        ]
        expect(btns).toHaveLength(2)
        expect(btns[0].dataset.url).toBe('plugins/wheel.plugin.js')
        expect(btns[0].dataset.id).toBe('com.example.wheel')
        expect(btns[0].textContent).toContain('安裝')
        expect(btns[0].disabled).toBe(false)
    })

    it('已安裝且版本相同：按鈕 disabled「已安裝」（無 data-url）', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'com.example.wheel', version: '1.3.0' }],
        })
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector(
            '#full-store-list .store-install-btn'
        )
        expect(btn.disabled).toBe(true)
        expect(btn.textContent).toContain('已安裝')
        expect(mockCompareVersions).toHaveBeenCalledWith('1.3.0', '1.3.0')
    })

    it('商店版本新於已安裝版本：按鈕「更新 (vX)」', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp({
            installed: [{ id: 'com.example.wheel', version: '1.2.0' }],
        })
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector(
            '#full-store-list .store-install-btn'
        )
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('更新 (v1.3.0)')
        expect(btn.dataset.url).toBe('plugins/wheel.plugin.js')
        expect(mockCompareVersions).toHaveBeenCalledWith('1.3.0', '1.2.0')
    })

    it('商店列表為空：顯示「沒有找到相關插件」', async () => {
        vi.stubGlobal('fetch', storeFetchMock([]))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('沒有找到相關插件')
    })

    it('fetch !ok：維持載入中占位（無卡片）', async () => {
        vi.stubGlobal('fetch', storeFetchMock([], { ok: false }))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('載入中...')
    })

    it('fetch 拋錯：顯示「無法載入商店資料」', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down')
            })
        )
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('無法載入商店資料')
    })
})

describe('StorePage - 搜尋過濾', () => {
    it('輸入關鍵字：依名稱過濾列表', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const input = document.getElementById('store-search')
        input.value = '轉'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await flush2()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('命運大轉盤')
        expect(container.textContent).not.toContain('Hello World')
    })

    it('輸入不存在的關鍵字：顯示「沒有找到相關插件」', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const input = document.getElementById('store-search')
        input.value = 'zzz-not-exist'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await flush2()
        expect(document.getElementById('full-store-list').textContent).toContain(
            '沒有找到相關插件'
        )
    })

    it('清空關鍵字：恢復完整列表', async () => {
        vi.stubGlobal('fetch', storeFetchMock(STORE_LIST))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const input = document.getElementById('store-search')
        input.value = '轉'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await flush2()
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await flush2()
        const container = document.getElementById('full-store-list')
        expect(container.textContent).toContain('命運大轉盤')
        expect(container.textContent).toContain('Hello World')
    })
})

describe('StorePage - 安裝/更新', () => {
    it('點擊安裝：fetch 插件檔 + installPlugin(file, 商店資訊) + toast「安裝成功！」', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
            .mockResolvedValueOnce({ ok: true, text: async () => 'console.log(1)' }) // plugin file
        vi.stubGlobal('fetch', fetchMock)
        const { app, pluginManager } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector(
            '#full-store-list .store-install-btn'
        )
        click(btn)
        await flush2()
        // 插件檔 URL 走 getStoreUrl
        const fileFetchUrl = fetchMock.mock.calls[1][0]
        expect(fileFetchUrl).toContain('plugins/wheel.plugin.js')
        // installPlugin 收到 File + 對應商店資訊（id 匹配）
        expect(pluginManager.installPlugin).toHaveBeenCalledTimes(1)
        const [file, meta] = pluginManager.installPlugin.mock.calls[0]
        expect(file).toBeInstanceOf(File)
        expect(file.name).toBe('plugin.js')
        expect(meta).toMatchObject({ id: 'com.example.wheel', name: '命運大轉盤' })
        expect(showToast).toHaveBeenCalledWith('安裝成功！', 'success')
    })

    it('安裝失敗（plugin file fetch 拋錯）：toast「安裝失敗」+ 按鈕恢復', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => STORE_LIST }) // index
                .mockRejectedValueOnce(new Error('network down')) // plugin file 失敗
        )
        const { app, pluginManager } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector(
            '#full-store-list .store-install-btn'
        )
        expect(btn.disabled).toBe(false)
        click(btn)
        await flush2()
        expect(pluginManager.installPlugin).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('安裝失敗', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('安裝') // 恢復原始文案
    })

    it('使用者取消安裝（e.message = 使用者取消安裝）：不顯示「安裝失敗」toast + 按鈕恢復', async () => {
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
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector(
            '#full-store-list .store-install-btn'
        )
        click(btn)
        await flush2()
        expect(pluginManager.installPlugin).toHaveBeenCalledTimes(1)
        // 取消安裝屬預期行為，不顯示錯誤 toast
        expect(showToast).not.toHaveBeenCalledWith('安裝失敗', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.textContent).toContain('安裝')
    })
})

describe('StorePage - XSS 防護（遠端商店資料）', () => {
    const payload = '<img src=x onerror="window.__xss=1">'

    function makeHostileList() {
        return [
            {
                id: 'hostile' + payload,
                name: 'Evil ' + payload,
                version: '1.0' + payload,
                description: 'd' + payload,
                author: 'a' + payload,
                file: 'plugins/x.js" onerror="window.__xss=2" data-x="',
                icon: 'fa-cat" onerror="window.__xss=3" x="',
            },
        ]
    }

    it('name/description/version/author 經 escapeHTML：DOM 不產生注入的 <img>', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        // 注入的 img 標籤未被建立（textContent 還原為純文字）
        expect(document.getElementById('full-store-list').querySelector('img[src="x"]')).toBeNull()
        expect(escapeHTML).toHaveBeenCalled()
        expect(document.getElementById('full-store-list').textContent).toContain(payload)
    })

    it('惡意 icon 被白名單拒絕：fallback fa-puzzle-piece、無 onerror 屬性', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const icon = document.querySelector('#full-store-list i.fa-solid')
        expect(icon).not.toBeNull()
        expect(icon.classList.contains('fa-puzzle-piece')).toBe(true)
        expect(icon.classList.contains('fa-cat')).toBe(false)
        // 屬性 breakout 未成立：onerror 不會成為真實 DOM 屬性
        expect(document.querySelector('[onerror]')).toBeNull()
    })

    it('data-id/data-url 屬性注入被 escapeHTML 阻斷：dataset 不含注入片段', async () => {
        vi.stubGlobal('fetch', storeFetchMock(makeHostileList()))
        const { app } = makeApp()
        const page = new StorePage(app)
        await page.render()
        const btn = document.querySelector('.store-install-btn')
        expect(btn).not.toBeNull()
        // 引號經 &quot; 轉義後成為 data-id 值的一部分，而非屬性結界
        expect(btn.dataset.x).toBeUndefined()
        expect(document.querySelector('button[data-x]')).toBeNull()
        expect(document.querySelector('[onerror]')).toBeNull()
    })
})

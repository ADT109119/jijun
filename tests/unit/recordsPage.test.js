import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock RecordsListManager：recordsPage 內部 `new RecordsListManager(dataService, categoryManager, pageElement)`
// PITFALL：mockImplementation 必須用一般 function（arrow function 不可被 `new` 呼叫）
const { MockRecordsListCtor } = vi.hoisted(() => ({ MockRecordsListCtor: vi.fn() }))
vi.mock('../../src/js/recordsList.js', () => ({
    RecordsListManager: MockRecordsListCtor,
}))

import { RecordsPage } from '../../src/js/pages/recordsPage.js'

// ── fixtures ──────────────────────────────────────────────
function makeApp() {
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)
    return {
        appContainer,
        dataService: { __tag: 'dataService' },
        categoryManager: { __tag: 'categoryManager' },
    }
}

function makeMockRecordsList() {
    return {
        init: vi.fn(),
        destroy: vi.fn(),
        highlightGroupId: null,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    // 每次 new 回傳一個全新的 mock 實例（一般 function 可被 `new`，回傳物件時 new 取該物件）
    MockRecordsListCtor.mockImplementation(function () {
        return makeMockRecordsList()
    })
})

describe('RecordsPage.render() — 頁面骨架', () => {
    it('渲染 header 前後期按鈕 + 標題', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        const container = page.app.appContainer
        expect(container.querySelector('#prev-period-btn')).toBeTruthy()
        expect(container.querySelector('#next-period-btn')).toBeTruthy()
        expect(container.querySelector('#records-header-title')).toBeTruthy()
    })

    it('渲染搜尋列（input + 清空按鈕 hidden）', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        const input = page.app.appContainer.querySelector('#records-search-input')
        expect(input).toBeTruthy()
        expect(input.type).toBe('text')
        const clearBtn = page.app.appContainer.querySelector('#records-clear-search-btn')
        expect(clearBtn).toBeTruthy()
        expect(clearBtn.classList.contains('hidden')).toBe(true)
    })

    it('渲染週期篩選（週/月/年/自訂）且預設「月」active', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        const filter = page.app.appContainer.querySelector('#records-period-filter')
        const btns = [...filter.querySelectorAll('.period-btn')]
        expect(btns.map(b => b.dataset.period)).toEqual(['week', 'month', 'year', 'custom'])
        expect(btns[1].classList.contains('bg-wabi-surface')).toBe(true) // 預設月
        expect(btns[0].classList.contains('bg-wabi-surface')).toBe(false)
    })

    it('渲染類型篩選（全部/支出/收入）且預設「全部」active', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        const btns = [...page.app.appContainer.querySelectorAll('#records-type-filter .type-btn')]
        expect(btns.map(b => b.dataset.type)).toEqual(['all', 'expense', 'income'])
        expect(btns[0].classList.contains('bg-wabi-surface')).toBe(true)
    })

    it('渲染分類/帳戶/欄位三個篩選按鈕', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        expect(page.app.appContainer.querySelector('#records-category-filter-btn')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#records-account-filter-btn')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#records-fields-btn')).toBeTruthy()
    })

    it('渲染摘要卡（筆數/收入/支出）', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        expect(page.app.appContainer.querySelector('#record-count')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#total-income')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#total-expense')).toBeTruthy()
    })

    it('渲染明細列表容器與 modals 容器', async () => {
        const page = new RecordsPage(makeApp())
        await page.render()
        expect(page.app.appContainer.querySelector('#records-list-container')).toBeTruthy()
        expect(page.app.appContainer.querySelector('#records-modals-container')).toBeTruthy()
    })
})

describe('RecordsPage.render() — RecordsListManager 接線', () => {
    it('以 (dataService, categoryManager, pageElement) 建立並 init', async () => {
        const app = makeApp()
        const page = new RecordsPage(app)
        await page.render()
        expect(MockRecordsListCtor).toHaveBeenCalledTimes(1)
        const args = MockRecordsListCtor.mock.calls[0]
        expect(args[0]).toBe(app.dataService)
        expect(args[1]).toBe(app.categoryManager)
        // 第三參數是真實的 .page DOM 元素
        expect(args[2]).toBeInstanceOf(HTMLElement)
        expect(args[2].classList.contains('page')).toBe(true)
        const instance = page._recordsListManager
        expect(instance.init).toHaveBeenCalledTimes(1)
    })

    it('重複 render 時 destroy 前一例（防事件監聽器洩漏）', async () => {
        const app = makeApp()
        const page = new RecordsPage(app)
        await page.render()
        const first = page._recordsListManager
        await page.render()
        expect(first.destroy).toHaveBeenCalledTimes(1)
        expect(page._recordsListManager).not.toBe(first)
        expect(MockRecordsListCtor).toHaveBeenCalledTimes(2)
    })
})

describe('RecordsPage.render(params) — groupId 參數', () => {
    it('帶 groupId 參數時設定 highlightGroupId', async () => {
        const app = makeApp()
        const page = new RecordsPage(app)
        const params = new URLSearchParams('groupId=42')
        await page.render(params)
        expect(page._recordsListManager.highlightGroupId).toBe('42')
    })

    it('無 groupId 參數時不設定（維持 null）', async () => {
        const app = makeApp()
        const page = new RecordsPage(app)
        await page.render(new URLSearchParams('other=x'))
        expect(page._recordsListManager.highlightGroupId).toBeNull()
    })

    it('params 為 null 時不設定且不拋錯', async () => {
        const app = makeApp()
        const page = new RecordsPage(app)
        await page.render(null)
        expect(page._recordsListManager.highlightGroupId).toBeNull()
        expect(page._recordsListManager.init).toHaveBeenCalled()
    })
})

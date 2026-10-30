// ==================== RecurringPage 單元測試 ====================
// 測試重點：週期性交易拖曳排序（#AB5）
// - static sortOrder() 排序邏輯（無自訂順序 / 部分覆蓋 / 完全覆蓋 / 邊界）
// - _getSavedOrder / _saveOrder per-ledger setting key
// - render() 列表以自訂順序呈現 + 拖曳把手 + SortableJS onEnd 回寫

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock SortableJS — 捕捉 onEnd 供手動觸發，避免依賴真實拖曳
const sortableInstances = []
vi.mock('sortablejs', () => ({
    default: class SortableMock {
        constructor(el, opts) {
            this.el = el
            this.opts = opts
            this.destroyed = false
            sortableInstances.push(this)
        }
        destroy() {
            this.destroyed = true
        }
    },
}))

import { RecurringPage } from '../../src/js/pages/recurringPage.js'
import DataService from '../../src/js/dataService.js'

function clearMockData() {
    // 與 DataService 共用的 mock DB（globalThis.idb.openDB 回傳同一個 mockDb）
    const db = globalThis.idb?.openDB?.()
    return Promise.resolve(db).then(d => {
        if (d && d._storeData) {
            for (const name of Object.keys(d._storeData)) {
                d._storeData[name].length = 0
            }
        }
    })
}

// nextDueDate 與 id 順序故意不一致，驗證排序確實生效
const SEED_DEFS = [
    { id: 1, description: '房租', amount: 10000, nextDueDate: '2026-09-05' },
    { id: 2, description: '訂閱', amount: 300, nextDueDate: '2026-08-28' },
    { id: 3, description: '保險', amount: 5000, nextDueDate: '2026-10-01' },
]

describe('RecurringPage.sortOrder (靜態排序方法)', () => {
    function makeTxs() {
        return SEED_DEFS.map(t => ({ ...t }))
    }

    it('無自訂順序時依 nextDueDate 升序排列', () => {
        const txs = makeTxs()
        const sorted = RecurringPage.sortOrder(txs, null)
        expect(sorted.map(t => t.id)).toEqual([2, 1, 3])
    })

    it('完全覆蓋的自訂順序優於 nextDueDate', () => {
        const txs = makeTxs()
        const sorted = RecurringPage.sortOrder(txs, [3, 1, 2])
        expect(sorted.map(t => t.id)).toEqual([3, 1, 2])
    })

    it('部分覆蓋：未在順序中的項目依 nextDueDate 排在自訂項目之後', () => {
        const txs = makeTxs()
        // 只指定 id 1 在第一位；2/3 未指定 → 依 nextDueDate：2 (08-28) 在 3 (10-01) 前
        const sorted = RecurringPage.sortOrder(txs, [1])
        expect(sorted.map(t => t.id)).toEqual([1, 2, 3])
    })

    it('nextDueDate 相同時依 id 排序（穩定性）', () => {
        const txs = [
            { id: 5, description: 'A', nextDueDate: '2026-09-01' },
            { id: 2, description: 'B', nextDueDate: '2026-09-01' },
        ]
        const sorted = RecurringPage.sortOrder(txs, null)
        expect(sorted.map(t => t.id)).toEqual([2, 5])
    })

    it('缺少 nextDueDate 的項目視為空字串（排最前）', () => {
        const txs = [
            { id: 1, description: '有日期', nextDueDate: '2026-09-01' },
            { id: 2, description: '無日期' },
        ]
        const sorted = RecurringPage.sortOrder(txs, null)
        expect(sorted.map(t => t.id)).toEqual([2, 1])
    })

    it('不修改原始陣列（回傳新陣列）', () => {
        const txs = makeTxs()
        const original = txs.map(t => t.id)
        RecurringPage.sortOrder(txs, [3, 2, 1])
        expect(txs.map(t => t.id)).toEqual(original)
    })

    it('savedOrder 含非數字值時被過濾', () => {
        const txs = makeTxs()
        const sorted = RecurringPage.sortOrder(txs, [2, 'x', null, 1])
        // 'x'/null 被過濾 → 有效順序 [2, 1]，3 排最後
        expect(sorted.map(t => t.id)).toEqual([2, 1, 3])
    })

    it('空陣列回傳空陣列', () => {
        expect(RecurringPage.sortOrder([], null)).toEqual([])
        expect(RecurringPage.sortOrder([], [1, 2])).toEqual([])
    })
})

describe('RecurringPage per-ledger 排序存取', () => {
    let mockApp
    let ds
    let page

    beforeEach(async () => {
        await clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 2
        mockApp = {
            appContainer: document.createElement('div'),
            dataService: ds,
        }
        page = new RecurringPage(mockApp)
    })

    it('_getSavedOrder 讀取 per-ledger key (recurringOrder_2)', async () => {
        await ds.saveSetting({ key: 'recurringOrder_2', value: [3, 1, 2] })
        const order = await page._getSavedOrder()
        expect(order).toEqual([3, 1, 2])
    })

    it('無自訂順序時 _getSavedOrder 回傳 null（不會誤讀其他帳本的 key）', async () => {
        // 另一帳本 (ledger 5) 有順序，但 active 是 2
        await ds.saveSetting({ key: 'recurringOrder_5', value: [9, 9, 9] })
        const order = await page._getSavedOrder()
        expect(order).toBeNull()
    })

    it('_saveOrder 寫入 per-ledger key 且值為 id 陣列', async () => {
        await page._saveOrder([3, 2, 1])
        const setting = await ds.getSetting('recurringOrder_2')
        expect(setting.value).toEqual([3, 2, 1])
    })
})

describe('RecurringPage render 拖曳排序整合', () => {
    let mockApp
    let ds
    let page
    // 實際 DB id（mock IDB 忽略手動指定的 id，改用 auto-increment 回傳值）
    let idA // 房租 (09-05)
    let idB // 訂閱 (08-28)
    let idC // 保險 (10-01)

    beforeEach(async () => {
        await clearMockData()
        sortableInstances.length = 0
        document.body.innerHTML = '<div id="app-container"></div>'
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        mockApp = {
            appContainer: document.getElementById('app-container'),
            dataService: ds,
        }
        page = new RecurringPage(mockApp)
        const stored = []
        for (const def of SEED_DEFS) {
            const { id, ...rest } = def
            stored.push({ id: await ds.addRecurringTransaction(rest), due: def.nextDueDate })
        }
        // 依 nextDueDate 排序取 A(最早 08-28)、B(09-05)、C(10-01)
        stored.sort((a, b) => a.due.localeCompare(b.due))
        idA = stored[0].id // 訂閱
        idB = stored[1].id // 房租
        idC = stored[2].id // 保險
    })

    function containerOrder() {
        return Array.from(
            document.querySelector('#recurring-list-container').children
        ).map(el => el.dataset.id)
    }

    it('預設依 nextDueDate 呈現列表', async () => {
        await page.render()
        // 訂閱(08-28) → 房租(09-05) → 保險(10-01)
        expect(containerOrder()).toEqual([String(idA), String(idB), String(idC)])
    })

    it('每筆項目有拖曳把手 (drag-handle)', async () => {
        await page.render()
        const handles = document.querySelectorAll(
            '#recurring-list-container .drag-handle'
        )
        expect(handles.length).toBe(3)
    })

    it('有自訂順序時依自訂順序呈現', async () => {
        await ds.saveSetting({ key: 'recurringOrder_1', value: [idC, idB, idA] })
        await page.render()
        expect(containerOrder()).toEqual([String(idC), String(idB), String(idA)])
    })

    it('空列表時不建立 Sortable 實例', async () => {
        await clearMockData()
        sortableInstances.length = 0
        await page.render()
        expect(sortableInstances.length).toBe(0)
        const html = document.querySelector('#recurring-list-container').innerHTML
        expect(html).toContain('尚未建立任何週期性交易')
    })

    it('有項目時建立 SortableJS 且 handle 為 .drag-handle', async () => {
        await page.render()
        expect(sortableInstances.length).toBe(1)
        expect(sortableInstances[0].opts.handle).toBe('.drag-handle')
    })

    it('重新 render 時先 destroy 舊 Sortable 實例（防洩漏）', async () => {
        await page.render()
        const first = sortableInstances[0]
        await page.render()
        expect(first.destroyed).toBe(true)
        expect(sortableInstances.length).toBe(2)
    })

    it('Sortable onEnd 回寫自訂順序到 per-ledger setting', async () => {
        await page.render()
        const container = document.querySelector('#recurring-list-container')
        const elA = container.querySelector(`[data-id="${idA}"]`)
        const elC = container.querySelector(`[data-id="${idC}"]`)
        // 模擬拖曳：把 idC 移到最前（container.children 順序改變）
        container.insertBefore(elC, elA)
        await sortableInstances[0].opts.onEnd()
        const setting = await ds.getSetting('recurringOrder_1')
        // 原順序 A,B,C → C 移到 A 前 → C,A,B
        expect(setting.value).toEqual([idC, idA, idB])
    })

    it('onEnd 回寫的順序在下次 render 時生效（持久化驗證）', async () => {
        await page.render()
        const container = document.querySelector('#recurring-list-container')
        const elA = container.querySelector(`[data-id="${idA}"]`)
        // 把 idA（原本第一位）拖到最後 → 期望順序 B,C,A
        container.appendChild(elA)
        await sortableInstances[0].opts.onEnd()
        await page.render()
        expect(containerOrder()).toEqual([String(idB), String(idC), String(idA)])
    })
})

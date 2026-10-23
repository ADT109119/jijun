import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddPage } from '../../src/js/pages/addPage.js'

/**
 * #AB6 記帳頁帳戶釘選 (Pinned Accounts)
 * 覆蓋：sortAccountsForSelection 純邏輯 + showAccountSelectionModal 整合（排序渲染 / 釘選 toggle / 設定讀取失敗降級）
 */

// 等待 async IIFE 的微工作完成（modal 列表是異步渲染）
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))

const makeAccounts = () => [
    { id: 1, name: '現金', icon: 'fa-solid fa-coins', color: '#10b981', type: 'wallet' },
    { id: 2, name: '銀行', icon: 'fa-solid fa-building-columns', color: '#3b82f6', type: 'wallet' },
    { id: 3, name: '信用卡', icon: 'fa-solid fa-credit-card', color: '#ef4444', type: 'credit_card' },
]

describe('AddPage - 帳戶釘選 (Pinned Accounts)', () => {
    let app, addPage, getSetting, saveSetting

    beforeEach(() => {
        document.body.innerHTML = ''
        getSetting = vi.fn().mockResolvedValue(null)
        saveSetting = vi.fn().mockResolvedValue(undefined)
        app = {
            aiService: {},
            dataService: {
                activeLedgerId: 1,
                getSetting,
                saveSetting,
                getAccounts: vi.fn().mockResolvedValue(makeAccounts()),
            },
        }
        addPage = new AddPage(app)
    })

    describe('sortAccountsForSelection', () => {
        it('pinnedIds 為 null 時回傳原順序的新陣列', () => {
            const accounts = makeAccounts()
            const result = addPage.sortAccountsForSelection(accounts, null)
            expect(result.map(a => a.id)).toEqual([1, 2, 3])
            expect(result).not.toBe(accounts)
        })

        it('pinnedIds 為 undefined 時回傳原順序的新陣列', () => {
            const accounts = makeAccounts()
            const result = addPage.sortAccountsForSelection(accounts, undefined)
            expect(result.map(a => a.id)).toEqual([1, 2, 3])
        })

        it('pinnedIds 非陣列（字串）時回傳原順序的新陣列', () => {
            const accounts = makeAccounts()
            const result = addPage.sortAccountsForSelection(accounts, 'abc')
            expect(result.map(a => a.id)).toEqual([1, 2, 3])
        })

        it('pinnedIds 空陣列時回傳原順序的新陣列', () => {
            const accounts = makeAccounts()
            const result = addPage.sortAccountsForSelection(accounts, [])
            expect(result.map(a => a.id)).toEqual([1, 2, 3])
        })

        it('不修改原始陣列（順序與內容皆不變）', () => {
            const accounts = makeAccounts()
            const originalOrder = accounts.map(a => a.id)
            const originalLength = accounts.length
            addPage.sortAccountsForSelection(accounts, [3, 1])
            expect(accounts.map(a => a.id)).toEqual(originalOrder)
            expect(accounts.length).toBe(originalLength)
        })

        it('釘選帳戶依 pinnedIds 順序置前', () => {
            const result = addPage.sortAccountsForSelection(makeAccounts(), [3, 1])
            expect(result.map(a => a.id)).toEqual([3, 1, 2])
        })

        it('pinnedIds 中不存在的帳戶 id 自動忽略', () => {
            const result = addPage.sortAccountsForSelection(makeAccounts(), [99, 2])
            expect(result.map(a => a.id)).toEqual([2, 1, 3])
        })

        it('全部釘選時只改變順序、不遺失帳戶', () => {
            const result = addPage.sortAccountsForSelection(makeAccounts(), [3, 2, 1])
            expect(result.map(a => a.id)).toEqual([3, 2, 1])
            expect(result).toHaveLength(3)
        })

        it('pinnedIds 含重複 id 時不重複渲染', () => {
            const result = addPage.sortAccountsForSelection(makeAccounts(), [2, 2, 1])
            expect(result.map(a => a.id)).toEqual([2, 1, 3])
        })
    })

    describe('showAccountSelectionModal - 整合', () => {
        it('依釘選設定渲染（[3,1] → 順序 3,1,2）', async () => {
            getSetting.mockImplementation(async key =>
                key === 'pinnedAccounts_1' ? { value: [3, 1] } : null
            )
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            expect(modal).not.toBeNull()
            const items = modal.querySelectorAll('.account-select-item')
            expect(items).toHaveLength(3)
            const order = [...items].map(el => el.dataset.id)
            expect(order).toEqual(['3', '1', '2'])
        })

        it('getSetting 無設定時依原順序渲染', async () => {
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            const order = [...modal.querySelectorAll('.account-select-item')].map(
                el => el.dataset.id
            )
            expect(order).toEqual(['1', '2', '3'])
            // 確認 suffix 正確（per-ledger key）
            expect(getSetting).toHaveBeenCalledWith('pinnedAccounts_1')
        })

        it('getSetting reject 時仍正常渲染 3 列且順序不變', async () => {
            getSetting.mockRejectedValue(new Error('DB error'))
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            const items = modal.querySelectorAll('.account-select-item')
            expect(items).toHaveLength(3)
            const order = [...items].map(el => el.dataset.id)
            expect(order).toEqual(['1', '2', '3'])
        })

        it('釘選圖示：已釘選 fa-solid、未釘選 fa-regular', async () => {
            getSetting.mockImplementation(async key =>
                key === 'pinnedAccounts_1' ? { value: [3, 1] } : null
            )
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            const pins = modal.querySelectorAll('.pin-toggle-btn')
            expect(pins).toHaveLength(3)
            // 依渲染順序 3,1,2 → 3 已釘選、1 已釘選、2 未釘選
            expect(pins[0].className).toContain('fa-solid')
            expect(pins[0].className).toContain('text-wabi-accent')
            expect(pins[1].className).toContain('fa-solid')
            expect(pins[2].className).toContain('fa-regular')
            expect(pins[2].className).toContain('text-wabi-text-secondary')
        })

        it('點 pin toggle 釘選：saveSetting 呼叫正確、新 id 置前、不觸發 onSelect', async () => {
            getSetting.mockImplementation(async key =>
                key === 'pinnedAccounts_1' ? { value: [3, 1] } : null
            )
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            // 點 id=2 列的 pin toggle
            const pin2 = modal.querySelector('.pin-toggle-btn[data-id="2"]')
            expect(pin2).not.toBeNull()
            pin2.dispatchEvent(new Event('click'))
            await flushMicrotasks()

            expect(onSelect).not.toHaveBeenCalled()
            expect(saveSetting).toHaveBeenCalledTimes(1)
            const arg = saveSetting.mock.calls[0][0]
            expect(arg.key).toBe('pinnedAccounts_1')
            expect(arg.value).toEqual([2, 3, 1])
            // 重繪後：pin 變已釘選（fa-solid），順序 2,3,1
            const order = [...modal.querySelectorAll('.account-select-item')].map(
                el => el.dataset.id
            )
            expect(order).toEqual(['2', '3', '1'])
        })

        it('再點同一 pin toggle 取消釘選：value 移除該 id', async () => {
            getSetting.mockImplementation(async key =>
                key === 'pinnedAccounts_1' ? { value: [3, 1] } : null
            )
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            // 第一次：釘選 id=2
            modal.querySelector('.pin-toggle-btn[data-id="2"]').dispatchEvent(new Event('click'))
            await flushMicrotasks()
            // 第二次：取消釘選 id=2（重繪後需重新取元素）
            const pin2Again = modal.querySelector('.pin-toggle-btn[data-id="2"]')
            pin2Again.dispatchEvent(new Event('click'))
            await flushMicrotasks()

            expect(saveSetting).toHaveBeenCalledTimes(2)
            expect(saveSetting.mock.calls[1][0].key).toBe('pinnedAccounts_1')
            expect(saveSetting.mock.calls[1][0].value).toEqual([3, 1])
            expect(onSelect).not.toHaveBeenCalled()
            // 順序回到 3,1,2
            const order = [...modal.querySelectorAll('.account-select-item')].map(
                el => el.dataset.id
            )
            expect(order).toEqual(['3', '1', '2'])
        })

        it('點帳戶名稱（非 pin）仍觸發 onSelect 並關閉 modal', async () => {
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            const row = modal.querySelector('.account-select-item[data-id="3"]')
            row.dispatchEvent(new Event('click'))
            await flushMicrotasks()

            expect(onSelect).toHaveBeenCalledWith(3)
            expect(document.querySelector('#account-selection-modal')).toBeNull()
        })

        it('saveSetting 失敗時不重繪、不觸發 onSelect、modal 保留', async () => {
            saveSetting.mockRejectedValue(new Error('save failed'))
            const onSelect = vi.fn()
            addPage.showAccountSelectionModal(makeAccounts(), 1, onSelect)
            await flushMicrotasks()

            const modal = document.querySelector('#account-selection-modal')
            modal.querySelector('.pin-toggle-btn[data-id="2"]').dispatchEvent(new Event('click'))
            await flushMicrotasks()

            expect(onSelect).not.toHaveBeenCalled()
            expect(document.querySelector('#account-selection-modal')).not.toBeNull()
            // 順序不變（未重繪）
            const order = [...modal.querySelectorAll('.account-select-item')].map(
                el => el.dataset.id
            )
            expect(order).toEqual(['1', '2', '3'])
        })
    })
})

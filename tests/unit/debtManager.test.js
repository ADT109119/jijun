// ==================== DebtManager 單元測試 ====================
// 測試重點：欠款金額計算、剩餘金額回退邏輯、總結卡片計算、
//           聯絡人摘要計算、分頁邏輯、部分付款驗證、刪除欠款雙岔流程、
//           編輯欠款結清判定、XSS 跳脫
// DebtManager 的 UI 方法 (renderDebtsPage, showAddDebtModal 等) 不在此測試
// 因為它們依賴完整的 DOM 與 window.app，適合 E2E 測試
// 備註：核心業務邏輯皆透過「真實 DebtManager 實例」驗證，不使用內嵌副本

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock utils.js 的函數（escapeHTML 保留真實實作，避免繞過 XSS 跳脫）
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        formatCurrency: vi.fn(v => `NT$${Math.round(v)}`),
        formatDate: vi.fn(d => d || '2024/01/01'),
        formatDateToString: vi.fn(() => '2024-01-01'),
        showToast: vi.fn(),
        customConfirm: vi.fn(() => Promise.resolve(true)),
        customAlert: vi.fn(),
    }
})

import { DebtManager } from '../../src/js/debtManager.js'
import { customConfirm, customAlert } from '../../src/js/utils.js'

// 建立最小化的 DataService mock
function createMockDataService() {
    const debts = []
    const contacts = []
    const records = []

    return {
        activeLedgerId: 1,
        getDebts: vi.fn(async filters => {
            let result = [...debts]
            if (filters && filters.settled !== undefined) {
                result = result.filter(d => d.settled === filters.settled)
            }
            if (filters && filters.contactId !== undefined) {
                result = result.filter(d => d.contactId === filters.contactId)
            }
            return result
        }),
        getDebtsByUUID: vi.fn(
            async uuid => debts.find(d => d.uuid === uuid) || null
        ),
        getDebt: vi.fn(async id => debts.find(d => d.id === id) || null),
        addDebt: vi.fn(async debt => {
            const id =
                debts.length > 0 ? Math.max(...debts.map(d => d.id)) + 1 : 100
            const newDebt = {
                ...debt,
                id,
                settled: debt.settled ?? false,
                uuid: debt.uuid || `uuid-${id}`,
            }
            debts.push(newDebt)
            return newDebt
        }),
        updateDebt: vi.fn(async (id, updates) => {
            const idx = debts.findIndex(d => d.id === id)
            if (idx >= 0) debts[idx] = { ...debts[idx], ...updates }
            return debts[idx]
        }),
        deleteDebt: vi.fn(async id => {
            const idx = debts.findIndex(d => d.id === id)
            if (idx >= 0) debts.splice(idx, 1)
        }),
        getContacts: vi.fn(async () => [...contacts]),
        getContact: vi.fn(async id => contacts.find(c => c.id === id) || null),
        addContact: vi.fn(async contact => {
            const id =
                contacts.length > 0
                    ? Math.max(...contacts.map(c => c.id)) + 1
                    : 50
            const newContact = { ...contact, id }
            contacts.push(newContact)
            return newContact
        }),
        addRecord: vi.fn(async record => {
            const id =
                records.length > 0
                    ? Math.max(...records.map(r => r.id)) + 1
                    : 200
            const newRecord = { ...record, id }
            records.push(newRecord)
            return newRecord
        }),
        deleteRecord: vi.fn(async id => {
            const idx = records.findIndex(r => r.id === id)
            if (idx >= 0) records.splice(idx, 1)
        }),
        updateRecord: vi.fn(async () => {}),
        getRecords: vi.fn(async filters => {
            let result = [...records]
            if (filters && filters.debtId) {
                result = result.filter(r => r.debtId === filters.debtId)
            }
            return result
        }),
        // 群組資料：未使用群組功能的測試一律回傳空陣列
        getGroups: vi.fn(async () => []),
        getGroupMeta: vi.fn(async () => null),
        getGroupRecords: vi.fn(async () => []),
        getSetting: vi.fn(async () => null),
        settleDebt: vi.fn(async () => {}),
        addPartialPayment: vi.fn(async () => {}),
        getRecord: vi.fn(async () => null),
        getAccounts: vi.fn(async () => []),
        getFile: vi.fn(async () => null),
        logChange: vi.fn(),
    }
}

// ── Helper: 渲染頁面並回傳容器 ──
async function renderPage(dm) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await dm.renderDebtsPage(container)
    return container
}

// ── Helper: 等待非同步事件處理完成 ──
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// ==================== 核心業務邏輯測試（透過真實實例） ====================
describe('DebtManager - 核心業務邏輯（真實實例）', () => {
    let dm, ds

    beforeEach(() => {
        ds = createMockDataService()
        dm = new DebtManager(ds)
    })

    describe('總結卡片金額計算 (updateSummaryCards)', () => {
        it('有 remainingAmount 時使用 remainingAmount', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                remainingAmount: 5000,
                originalAmount: 10000,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[0].textContent).toContain('5000')
            expect(cards[0].textContent).not.toContain('10000')
        })

        it('無 remainingAmount 但有 originalAmount 時使用 originalAmount', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'payable',
                originalAmount: 3000,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[1].textContent).toContain('3000')
        })

        it('只有 amount (舊格式) 時使用 amount', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 2000,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[0].textContent).toContain('2000')
        })

        it('所有金額欄位皆無時回退為 0', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'payable',
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[1].textContent).toContain('NT$0')
        })

        it('正確累加 receivable 和 payable', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                remainingAmount: 1000,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                remainingAmount: 2000,
                date: '2024-01-02',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'payable',
                remainingAmount: 500,
                date: '2024-01-03',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'payable',
                remainingAmount: 1500,
                date: '2024-01-04',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[0].textContent).toContain('3000')
            expect(cards[1].textContent).toContain('2000')
        })

        it('已結清的欠款不計入總結卡片', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 500,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 900,
                settled: true,
                date: '2024-01-02',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[0].textContent).toContain('500')
            expect(cards[0].textContent).not.toContain('900')
        })

        it('type 為 undefined 時歸類為「我欠別人」(payable)', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                amount: 800,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[1].textContent).toContain('800')
            expect(cards[0].textContent).not.toContain('800')
        })

        it('渲染時會載入群組資料以顯示未結清群組卡片', async () => {
            const container = await renderPage(dm)
            expect(ds.getGroups).toHaveBeenCalled()
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards.length).toBe(3)
            expect(cards[2].textContent).toContain('未結清群組')
            expect(cards[2].textContent).toContain('0 個')
        })
    })

    describe('聯絡人摘要 (showContactSummaryModal)', () => {
        it('正確按聯絡人分組並計算淨額', async () => {
            const c1 = await ds.addContact({ name: '小明', phone: '0911111111' })
            const c2 = await ds.addContact({ name: '小華', phone: '0922222222' })
            await ds.addDebt({
                contactId: c1.id,
                type: 'receivable',
                amount: 1000,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: c1.id,
                type: 'payable',
                amount: 300,
                date: '2024-01-02',
            })
            await ds.addDebt({
                contactId: c2.id,
                type: 'receivable',
                amount: 2000,
                date: '2024-01-03',
            })

            await renderPage(dm)
            await dm.showContactSummaryModal()
            const modal = document.querySelector('#contact-summary-modal')
            expect(modal).toBeTruthy()
            const rows = modal.querySelectorAll('tr[data-contact-id]')
            expect(rows.length).toBe(2)
            // 小明：欠我 1000，我欠 300 → 淨額 +700
            expect(rows[0].textContent).toContain('小明')
            expect(rows[0].textContent).toContain('1000')
            expect(rows[0].textContent).toContain('300')
            expect(rows[0].textContent).toContain('700')
            // 小華：欠我 2000 → 淨額 +2000
            expect(rows[1].textContent).toContain('小華')
            expect(rows[1].textContent).toContain('2000')
        })

        it('已結清欠款不顯示在聯絡人摘要', async () => {
            const c1 = await ds.addContact({ name: '小明', phone: '0911111111' })
            await ds.addDebt({
                contactId: c1.id,
                type: 'receivable',
                amount: 500,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: c1.id,
                type: 'receivable',
                amount: 999,
                settled: true,
                date: '2024-01-02',
            })

            await renderPage(dm)
            await dm.showContactSummaryModal()
            const modal = document.querySelector('#contact-summary-modal')
            expect(modal.textContent).toContain('500')
            expect(modal.textContent).not.toContain('999')
        })
    })

    describe('分頁邏輯 (loadDebtList)', () => {
        async function addDebts(count) {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            for (let i = 1; i <= count; i++) {
                await ds.addDebt({
                    contactId: contact.id,
                    type: 'receivable',
                    amount: 100 + i,
                    date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
                })
            }
        }

        it('15 筆資料分成 2 頁，第 1 頁顯示 10 筆並有分頁控制', async () => {
            await addDebts(15)
            const container = await renderPage(dm)
            const list = container.querySelector('#debt-list-container')
            expect(list.querySelectorAll('[data-debt-id]').length).toBe(10)
            expect(list.textContent).toContain('1 / 2')
            expect(container.querySelector('#next-page-btn')).toBeTruthy()
        })

        it('點擊下一頁後顯示第 2 頁剩餘 5 筆', async () => {
            await addDebts(15)
            window.scrollTo = vi.fn()
            const container = await renderPage(dm)
            const list = container.querySelector('#debt-list-container')
            container.querySelector('#next-page-btn').click()
            await flush()
            expect(list.querySelectorAll('[data-debt-id]').length).toBe(5)
            expect(list.textContent).toContain('2 / 2')
        })
    })

    describe('進度百分比計算 (loadDebtList)', () => {
        it('部分還款時顯示正確進度百分比', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 500,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            expect(container.textContent).toContain('50%')
            expect(container.textContent).toContain('已收款')
        })
    })

    describe('部分付款驗證 (showPartialPaymentModal)', () => {
        it.each([
            { value: '', label: '空值' },
            { value: '0', label: '0' },
            { value: '-50', label: '負數' },
        ])('金額為 $label 時顯示錯誤且不建立付款', async ({ value }) => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 1000,
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showPartialPaymentModal(debt.id)
            const modal = document.querySelector('#partial-payment-modal')
            modal.querySelector('#partial-amount').value = value
            modal.querySelector('#confirm-partial-btn').click()
            await flush()

            expect(customAlert).toHaveBeenCalled()
            expect(ds.addPartialPayment).not.toHaveBeenCalled()
        })

        it('金額超過剩餘金額時顯示錯誤且不建立付款', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 1000,
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showPartialPaymentModal(debt.id)
            const modal = document.querySelector('#partial-payment-modal')
            modal.querySelector('#partial-amount').value = '1500'
            modal.querySelector('#confirm-partial-btn').click()
            await flush()

            expect(customAlert).toHaveBeenCalled()
            expect(ds.addPartialPayment).not.toHaveBeenCalled()
        })

        it('金額有效時呼叫 addPartialPayment 並帶入正確金額', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 1000,
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showPartialPaymentModal(debt.id)
            const modal = document.querySelector('#partial-payment-modal')
            modal.querySelector('#partial-amount').value = '300'
            modal.querySelector('#confirm-partial-btn').click()
            await flush()

            expect(ds.addPartialPayment).toHaveBeenCalledWith(debt.id, 300, {
                accountId: null,
            })
        })
    })

    describe('刪除欠款雙岔流程 (delete-debt-btn)', () => {
        it('刪除無關聯紀錄的欠款只呼叫 deleteDebt', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 100,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            customConfirm.mockReset()
            customConfirm.mockResolvedValueOnce(true)
            container.querySelector('.delete-debt-btn').click()
            await flush()

            expect(customConfirm).toHaveBeenCalledTimes(1)
            expect(ds.deleteDebt).toHaveBeenCalledWith(debt.id)
            expect(ds.deleteRecord).not.toHaveBeenCalled()
            expect(ds.updateRecord).not.toHaveBeenCalled()
        })

        it('刪除有關聯紀錄的欠款且確認時，會連帶刪除紀錄', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 100,
                recordId: 999,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            customConfirm.mockReset()
            customConfirm.mockResolvedValueOnce(true) // 確認刪除欠款
            customConfirm.mockResolvedValueOnce(true) // 確認一併刪除紀錄
            container.querySelector('.delete-debt-btn').click()
            await flush()

            expect(ds.deleteDebt).toHaveBeenCalledWith(debt.id)
            expect(ds.deleteRecord).toHaveBeenCalledWith(999)
            expect(ds.updateRecord).not.toHaveBeenCalled()
        })

        it('刪除有關聯紀錄的欠款但取消時，清除紀錄上的反向引用', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 100,
                recordId: 999,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            customConfirm.mockReset()
            customConfirm.mockResolvedValueOnce(true) // 確認刪除欠款
            customConfirm.mockResolvedValueOnce(false) // 不刪除關聯紀錄
            container.querySelector('.delete-debt-btn').click()
            await flush()

            expect(ds.deleteDebt).toHaveBeenCalledWith(debt.id)
            expect(ds.deleteRecord).not.toHaveBeenCalled()
            expect(ds.updateRecord).toHaveBeenCalledWith(999, { debtId: null })
        })

        it('取消第一次確認時不刪除任何資料', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 100,
                recordId: 999,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            customConfirm.mockReset()
            customConfirm.mockResolvedValueOnce(false)
            container.querySelector('.delete-debt-btn').click()
            await flush()

            expect(ds.deleteDebt).not.toHaveBeenCalled()
            expect(ds.deleteRecord).not.toHaveBeenCalled()
            expect(ds.updateRecord).not.toHaveBeenCalled()
        })
    })

    describe('編輯欠款結清判定 (showAddDebtModal)', () => {
        it('編輯時餘額歸零且原本未結清 → 自動標記為已結清', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 600,
                settled: false,
                payments: [{ amount: 400 }],
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showAddDebtModal(debt)
            const modal = document.querySelector('#add-debt-modal')
            modal.querySelector('#debt-amount').value = '400'
            modal.querySelector('#save-debt-btn').click()
            await flush()

            expect(ds.updateDebt).toHaveBeenCalledWith(
                debt.id,
                expect.objectContaining({
                    settled: true,
                    remainingAmount: 0,
                })
            )
        })

        it('編輯時餘額大於 0 且原本已結清 → 恢復為未結清', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 0,
                settled: true,
                settledAt: 123456,
                payments: [{ amount: 1000 }],
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showAddDebtModal(debt)
            const modal = document.querySelector('#add-debt-modal')
            modal.querySelector('#debt-amount').value = '1200'
            modal.querySelector('#save-debt-btn').click()
            await flush()

            expect(ds.updateDebt).toHaveBeenCalledWith(
                debt.id,
                expect.objectContaining({
                    settled: false,
                    settledAt: null,
                    remainingAmount: 200,
                })
            )
        })

        it('編輯時餘額大於 0 且原本未結清 → 維持未結清狀態', async () => {
            const contact = await ds.addContact({ name: '甲', phone: '1' })
            const debt = await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                originalAmount: 1000,
                remainingAmount: 600,
                settled: false,
                payments: [{ amount: 400 }],
                date: '2024-01-01',
            })

            await renderPage(dm)
            await dm.showAddDebtModal(debt)
            const modal = document.querySelector('#add-debt-modal')
            modal.querySelector('#debt-amount').value = '500'
            modal.querySelector('#save-debt-btn').click()
            await flush()

            const [updateId, updateData] = ds.updateDebt.mock.calls[0]
            expect(updateId).toBe(debt.id)
            expect(updateData).toEqual(
                expect.objectContaining({ remainingAmount: 100 })
            )
            expect(updateData).not.toHaveProperty('settled')
        })
    })

    describe('XSS 防護 (真實 escapeHTML)', () => {
        it('聯絡人名稱與備註中的 HTML 會被跳脫，不產生可執行的 script', async () => {
            const malicious = '<script>alert(1)</script>'
            const contact = await ds.addContact({
                name: malicious,
                phone: '1',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 100,
                description: malicious,
                date: '2024-01-01',
            })

            const container = await renderPage(dm)
            // 不應產生真實的 <script> 元素
            expect(container.querySelector('script')).toBeNull()
            // 原始 HTML 中不應含有未跳脫的 script 標籤
            expect(container.innerHTML).not.toContain('<script>')
            // 內容應以 HTML 實體形式呈現
            expect(container.innerHTML).toContain('&lt;script&gt;')
        })
    })
})

// ==================== DebtManager 實例測試 ====================
describe('DebtManager - 建構與基本狀態', () => {
    let dm, ds

    beforeEach(() => {
        ds = createMockDataService()
        dm = new DebtManager(ds)
    })

    describe('constructor', () => {
        it('正確初始化屬性', () => {
            expect(dm.dataService).toBe(ds)
            expect(dm.container).toBeNull()
            expect(dm.currentFilter).toBe('unsettled')
            expect(dm.currentContactFilter).toBeNull()
            expect(dm.currentPage).toBe(1)
            expect(dm.pageSize).toBe(10)
        })
    })

    describe('renderDebtsPage', () => {
        it('渲染後容器有正確的 DOM 結構', async () => {
            const container = document.createElement('div')
            await dm.renderDebtsPage(container)
            expect(container.querySelector('h1').textContent).toBe('欠款管理')
            expect(
                container.querySelector('#summary-cards-container')
            ).toBeTruthy()
            expect(
                container.querySelector('#contact-filter-select')
            ).toBeTruthy()
            expect(container.querySelector('#debt-list-container')).toBeTruthy()
            expect(container.querySelector('#add-debt-btn')).toBeTruthy()
            expect(
                container.querySelector('#show-summary-table-btn')
            ).toBeTruthy()
        })

        it('渲染後過濾器按鈕有正確狀態', async () => {
            const container = document.createElement('div')
            await dm.renderDebtsPage(container)
            const unsettledBtn = container.querySelector(
                '[data-filter="unsettled"]'
            )
            expect(unsettledBtn.classList.contains('bg-wabi-surface')).toBe(
                true
            )
            const settledBtn = container.querySelector(
                '[data-filter="settled"]'
            )
            expect(settledBtn.classList.contains('bg-wabi-surface')).toBe(false)
        })

        it('沒有欠款時顯示空狀態訊息', async () => {
            const container = document.createElement('div')
            await dm.renderDebtsPage(container)
            const list = container.querySelector('#debt-list-container')
            expect(list.textContent).toContain('沒有')
            expect(list.textContent).toContain('未結清的')
        })

        it('過濾器和聯絡人選擇器渲染正確', async () => {
            const contact = await ds.addContact({
                name: '測試聯絡人',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 1000,
                date: '2024-01-01',
            })

            const container = document.createElement('div')
            await dm.renderDebtsPage(container)
            const select = container.querySelector('#contact-filter-select')
            const options = select.querySelectorAll('option')
            expect(options.length).toBeGreaterThan(1)
        })
    })

    describe('updateSummaryCards - 透過實例測試', async () => {
        it('正確顯示別人欠我和我欠別人的總額', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                remainingAmount: 1000,
                originalAmount: 1000,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'payable',
                remainingAmount: 500,
                originalAmount: 500,
                date: '2024-01-01',
            })

            const container = document.createElement('div')
            await dm.renderDebtsPage(container)

            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            // 兩張金額卡片 + 一張未結清群組卡片
            expect(cards.length).toBe(3)
            // 第一張卡片: 別人欠我 NT$1000
            expect(cards[0].textContent).toContain('1000')
            // 第二張卡片: 我欠別人 NT$500
            expect(cards[1].textContent).toContain('500')
        })

        it('聯絡人篩選後正確更新總額', async () => {
            const c1 = await ds.addContact({ name: 'A', phone: '0911111111' })
            const c2 = await ds.addContact({ name: 'B', phone: '0922222222' })
            await ds.addDebt({
                contactId: c1.id,
                type: 'receivable',
                remainingAmount: 1000,
                originalAmount: 1000,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: c2.id,
                type: 'receivable',
                remainingAmount: 2000,
                originalAmount: 2000,
                date: '2024-01-01',
            })

            const container = document.createElement('div')
            await dm.renderDebtsPage(container)

            // 篩選聯絡人 c1
            dm.currentContactFilter = c1.id
            await dm.updateSummaryCards()

            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            expect(cards[0].textContent).toContain('1000')
            expect(cards[0].textContent).toContain('A')
        })
    })
})

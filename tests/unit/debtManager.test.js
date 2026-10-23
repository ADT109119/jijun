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
import { customConfirm, customAlert, showToast } from '../../src/js/utils.js'

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
        _calculateGroupNet: vi.fn(() => ({ netAmount: 0, totalExpense: 0, totalIncome: 0 })),
        _calculateGroupNetAsync: vi.fn(async () => ({ netAmount: 0, totalExpense: 0, totalIncome: 0 })),
        getSetting: vi.fn(async () => null),
        settleDebt: vi.fn(async () => {}),
        addPartialPayment: vi.fn(async () => {}),
        getRecord: vi.fn(async () => null),
        getAccounts: vi.fn(async () => []),
        resolveDefaultSettleAccountId: vi.fn(async () => null),
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

    it('summary 卡以全帳本為準：無 ledgerId 的群組欠款不被帳本過濾掉（agy M1）', async () => {
        // 模擬真實 getDebts 帳本語義：非 allLedgers 時只回傳 d.ledgerId === activeLedgerId
        ds.activeLedgerId = 1
        const groupDebt = {
            id: 900,
            contactId: 1,
            type: 'receivable',
            remainingAmount: 5000,
            originalAmount: 5000,
            settled: false,
            recordId: null,
            date: '2026-09-01',
        }
        ds.getDebts = vi.fn(async (filters = {}) => {
            let list = [groupDebt]
            if (!filters.allLedgers) {
                const target = filters.ledgerId ?? ds.activeLedgerId
                list = list.filter(d => d.ledgerId === target)
            }
            if (filters.settled === false) list = list.filter(d => !d.settled)
            return list
        })
        ds.getContacts = vi.fn(async () => [{ id: 1, name: '小明', phone: '0912' }])

        const container = document.createElement('div')
        document.body.appendChild(container)
        container.innerHTML = '<div id="summary-cards-container"></div>'
        dm.container = container
        await dm.updateSummaryCards()

        // 若誤限當前帳本（activeLedgerId=1），無 ledgerId 的群組欠款會被過濾掉 → 金額 0
        expect(container.textContent).toContain('5000')
        document.body.innerHTML = ''
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

        it('群組內的欠款應正確計入總結卡片金額', async () => {
            const contact = await ds.addContact({
                name: '小明',
                phone: '0912345678',
            })
            // 個人欠款 500（應收）
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 500,
                date: '2024-01-01',
            })
            // 屬於群組的欠款 999（應收）：關聯記錄有 groupId，亦應被計入
            const groupRecord = await ds.addRecord({
                groupId: 'group-1',
                type: 'expense',
                amount: 999,
                categoryId: 1,
            })
            await ds.addDebt({
                contactId: contact.id,
                type: 'receivable',
                amount: 999,
                recordId: groupRecord.id,
                date: '2024-01-02',
            })

            const container = await renderPage(dm)
            const cards = container.querySelectorAll(
                '#summary-cards-container > div'
            )
            // 應收卡片應同時包含個人欠款 500 與群組欠款 999 (總計 1499)
            expect(cards[0].textContent).toContain('1499')
        })

        it('同一群組中有多個欠款人時，篩選個別聯絡人不會誤算其他人的欠款', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })
            const cBob = await ds.addContact({ name: 'Bob', phone: '0922' })

            // 同一個群組 group-multi
            await ds.addDebt({
                contactId: cAlice.id,
                type: 'receivable',
                amount: 500,
                groupId: 'group-multi',
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cBob.id,
                type: 'receivable',
                amount: 300,
                groupId: 'group-multi',
                date: '2024-01-02',
            })

            const container = await renderPage(dm)

            // 1. 未篩選聯絡人：總應收為 500 + 300 = 800
            let cards = container.querySelectorAll('#summary-cards-container > div')
            expect(cards[0].textContent).toContain('800')

            // 2. 篩選 Alice：應收 Alice 僅有 500，絕不含 Bob 的 300
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            cards = container.querySelectorAll('#summary-cards-container > div')
            expect(cards[0].textContent).toContain('500')
            expect(cards[0].textContent).not.toContain('800')
            expect(cards[0].textContent).not.toContain('300')

            // 3. 篩選 Bob：應收 Bob 僅有 300，絕不含 Alice 的 500
            dm.currentContactFilter = cBob.id
            await dm.updateSummaryCards()
            cards = container.querySelectorAll('#summary-cards-container > div')
            expect(cards[0].textContent).toContain('300')
            expect(cards[0].textContent).not.toContain('800')
            expect(cards[0].textContent).not.toContain('500')
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

        it('加入群組的欠款亦正確計入聯絡人摘要', async () => {
            const c1 = await ds.addContact({ name: '小明', phone: '0911111111' })
            await ds.addDebt({
                contactId: c1.id,
                type: 'receivable',
                amount: 800,
                groupId: 'group-1',
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: c1.id,
                type: 'payable',
                amount: 200,
                groupId: 'group-2',
                date: '2024-01-02',
            })

            await renderPage(dm)
            await dm.showContactSummaryModal()
            const modal = document.querySelector('#contact-summary-modal')
            expect(modal).toBeTruthy()
            const rows = modal.querySelectorAll('tr[data-contact-id]')
            expect(rows.length).toBe(1)
            // 應收 800，應付 200，淨額 +600
            expect(rows[0].textContent).toContain('小明')
            expect(rows[0].textContent).toContain('800')
            expect(rows[0].textContent).toContain('200')
            expect(rows[0].textContent).toContain('600')
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

        it('refreshCurrentView 在群組頁面觸發時自動渲染 groupsPage 且不拋出 DOM null 異常', async () => {
            const renderFn = vi.fn()
            const mockApp = {
                router: {
                    routes: {
                        groups: { render: renderFn },
                    },
                },
            }
            const debtMgr = new DebtManager(ds, mockApp)
            
            window.location.hash = '#groups'
            await debtMgr.refreshCurrentView()

            expect(renderFn).toHaveBeenCalledTimes(1)
        })
    })

    describe('群組結清淨額方向 (showSettleGroupModal)', () => {
        it('netAmount > 0 時顯示「群組欠我」（应收/入帳）', async () => {
            ds.getGroupMeta.mockResolvedValue({ name: '飯錢群組', settled: false })
            ds.getGroupRecords.mockResolvedValue([])
            ds._calculateGroupNet.mockReturnValue({
                netAmount: 1000,
                totalExpense: 1000,
                totalIncome: 0,
            })
            // 開啟進階账户模式，使「入帳帳戶」标签渲染
            ds.getSetting.mockImplementation(async key =>
                key === 'advancedAccountModeEnabled' ? { value: true } : null
            )
            ds.getAccounts.mockResolvedValue([{ id: 1, name: '現金' }])

            await dm.showSettleGroupModal('group-1')
            const modal = document.querySelector(
                '.fixed.inset-0.bg-black.bg-opacity-50.z-50'
            )
            expect(modal).toBeTruthy()
            // netAmount > 0 = 群組欠我（应收）
            expect(modal.textContent).toContain('飯錢群組欠我')
            // 結清時应收應為「入帳」帳戶
            expect(modal.textContent).toContain('入帳帳戶')
            modal.remove()
        })

        it('netAmount < 0 時顯示「我欠群組」（應付/出帳）', async () => {
            ds.getGroupMeta.mockResolvedValue({ name: '飯錢群組', settled: false })
            ds.getGroupRecords.mockResolvedValue([])
            ds._calculateGroupNet.mockReturnValue({
                netAmount: -500,
                totalExpense: 0,
                totalIncome: 500,
            })
            // 開啟進階账户模式，使「出帳帳戶」标签渲染
            ds.getSetting.mockImplementation(async key =>
                key === 'advancedAccountModeEnabled' ? { value: true } : null
            )
            ds.getAccounts.mockResolvedValue([{ id: 1, name: '現金' }])

            await dm.showSettleGroupModal('group-1')
            const modal = document.querySelector(
                '.fixed.inset-0.bg-black.bg-opacity-50.z-50'
            )
            expect(modal.textContent).toContain('我欠飯錢群組')
            expect(modal.textContent).toContain('出帳帳戶')
            modal.remove()
        })
    })

    describe('群組詳情彈窗方向 (showGroupDetailsModal)', () => {
        it('netAmount > 0 時顯示「應收」+ 部分收款按钮 + income 绿色', async () => {
            ds.getGroupMeta.mockResolvedValue({ name: '飯錢群組', settled: false })
            ds.getGroupRecords.mockResolvedValue([])
            ds._calculateGroupNetAsync.mockResolvedValue({
                netAmount: 1000,
                totalExpense: 1000,
                totalIncome: 0,
            })
            ds.getDebts.mockResolvedValue([])

            await dm.showGroupDetailsModal('group-1')
            const modal = document.querySelector(
                '.fixed.inset-0.bg-black.bg-opacity-50.z-50'
            )
            expect(modal).toBeTruthy()
            // netAmount > 0 = 应收（群组欠我）→ 應收措辞（netDirection = '應收 飯錢群組'）
            expect(modal.textContent).toContain('應收')
            expect(modal.textContent).toContain('飯錢群組')
            // 应收 → 净額用 income 绿色
            expect(modal.innerHTML).toContain(
                'text-wabi-income'
            )
            // 应收 → 「部分收款」按钮
            expect(modal.innerHTML).toContain('部分收款')
            expect(modal.innerHTML).not.toContain('部分退款')
            modal.remove()
        })

        it('netAmount < 0 時顯示「應付」+ 部分付款按钮 + expense 红色', async () => {
            ds.getGroupMeta.mockResolvedValue({ name: '飯錢群組', settled: false })
            ds.getGroupRecords.mockResolvedValue([])
            ds._calculateGroupNetAsync.mockResolvedValue({
                netAmount: -500,
                totalExpense: 0,
                totalIncome: 500,
            })
            ds.getDebts.mockResolvedValue([])

            await dm.showGroupDetailsModal('group-1')
            const modal = document.querySelector(
                '.fixed.inset-0.bg-black.bg-opacity-50.z-50'
            )
            expect(modal).toBeTruthy()
            // netAmount < 0 = 应付（我欠群组）→ 應付措辞（netDirection = '應付 飯錢群組'）
            expect(modal.textContent).toContain('應付')
            expect(modal.textContent).toContain('飯錢群組')
            // 应付 → 净額用 expense 红色
            expect(modal.innerHTML).toContain(
                'text-wabi-expense'
            )
            // 应付 → 「部分付款」按钮
            expect(modal.innerHTML).toContain('部分付款')
            expect(modal.innerHTML).not.toContain('部分退款')
            modal.remove()
        })

        it('應在群組明細清單中清楚顯示關聯欠款人／成員標籤與角色', async () => {
            const contactAlice = { id: 10, name: 'Alice' }
            const contactBob = { id: 20, name: 'Bob' }
            ds.getGroupMeta.mockResolvedValue({ name: '日本旅遊', settled: false })
            ds.getContacts.mockResolvedValue([contactAlice, contactBob])
            ds.getDebts.mockResolvedValue([
                { id: 101, contactId: 10, type: 'receivable' },
                { id: 102, contactId: 20, type: 'payable' }
            ])
            ds.getGroupRecords.mockResolvedValue([
                { id: 1, debtId: 101, type: 'expense', amount: 300, description: '洋蔥餅', category: 'food', date: '2024-01-01', groupStatus: 'active' },
                { id: 2, debtId: 102, type: 'income', amount: 500, description: '藥妝', category: 'daily', date: '2024-01-02', groupStatus: 'active' },
                { id: 3, type: 'expense', amount: 150, description: '車票', category: 'traffic', date: '2024-01-03' }
            ])
            ds._calculateGroupNetAsync.mockResolvedValue({
                netAmount: 300,
                totalExpense: 450,
                totalIncome: 500,
            })

            await dm.showGroupDetailsModal('group-1')
            const modal = document.querySelector('#group-details-modal')
            expect(modal).toBeTruthy()

            // 頂部成員清單
            expect(modal.textContent).toContain('群組成員:')
            expect(modal.textContent).toContain('Alice')
            expect(modal.textContent).toContain('Bob')

            // 第一筆：應收 Alice（欠款人）
            expect(modal.textContent).toContain('欠款人：Alice')
            expect(modal.innerHTML).toContain('Alice')

            // 第二筆：應付 Bob（代墊人）
            expect(modal.textContent).toContain('代墊人：Bob')
            expect(modal.innerHTML).toContain('Bob')

            // 第三筆：一般消費無關聯欠款人
            expect(modal.textContent).toContain('一般消費')

            modal.remove()
        })
    })

    describe('單筆明細個別還款彈窗 (showSettleGroupRecordModal)', () => {
        it('應在確認還款彈窗中顯示欠款人／對象名稱', async () => {
            const contactAlice = { id: 10, name: 'Alice' }
            ds.getRecords.mockResolvedValue([
                { id: 1, debtId: 101, type: 'expense', amount: 300, description: '洋蔥餅', date: '2024-01-01', groupStatus: 'active' }
            ])
            ds.getDebt.mockResolvedValue({ id: 101, contactId: 10, type: 'receivable' })
            ds.getContact.mockResolvedValue(contactAlice)

            await dm.showSettleGroupRecordModal(1, 'group-1')
            const modal = document.querySelector('.fixed.inset-0.z-\\[60\\]')
            expect(modal).toBeTruthy()
            expect(modal.textContent).toContain('洋蔥餅')
            expect(modal.textContent).toContain('Alice')
            expect(modal.textContent).toContain('欠款人：Alice')
            modal.remove()
        })
    })

    describe('聯絡人篩選群組邏輯 (loadDebtList & updateSummaryCards)', () => {
        it('選擇聯絡人後，不含該聯絡人欠款的群組不應顯示', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })
            const cBob = await ds.addContact({ name: 'Bob', phone: '0922' })

            // 群組 1：只包含 Alice 的欠款
            const rec1 = await ds.addRecord({
                groupId: 'group-1',
                type: 'expense',
                amount: 500,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cAlice.id,
                type: 'receivable',
                amount: 500,
                recordId: rec1.id,
                groupId: 'group-1',
                settled: false,
                date: '2024-01-01',
            })

            // 群組 2：純專案，無任何欠款
            await ds.addRecord({
                groupId: 'group-2',
                type: 'expense',
                amount: 300,
                date: '2024-01-02',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: 'Alice群組', settled: false, netAmount: 500, totalExpense: 500, totalIncome: 0, dateFrom: '2024-01-01', dateTo: '2024-01-01', recordCount: 1 },
                { id: 'group-2', name: '專案群組', settled: false, netAmount: 300, totalExpense: 300, totalIncome: 0, dateFrom: '2024-01-02', dateTo: '2024-01-02', recordCount: 1 },
            ])

            const container = await renderPage(dm)

            // 預設（無篩選聯絡人）：顯示所有群組
            expect(container.textContent).toContain('Alice群組')
            expect(container.textContent).toContain('專案群組')

            // 篩選 Bob（在群組 1、2 皆無欠款）：兩個群組皆不應顯示
            dm.currentContactFilter = cBob.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()

            expect(container.querySelector('.group-card[data-group-id="group-1"]')).toBeNull()
            expect(container.querySelector('.group-card[data-group-id="group-2"]')).toBeNull()
            const summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('0 個')

            // 篩選 Alice（在群組 1 有欠款）：群組 1 顯示，群組 2 隱藏
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()

            expect(container.querySelector('.group-card[data-group-id="group-1"]')).not.toBeNull()
            expect(container.querySelector('.group-card[data-group-id="group-2"]')).toBeNull()
            const summaryCardsAlice = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCardsAlice[2].textContent).toContain('1 個')
        })

        it('未結清篩選下，若聯絡人在該群組的欠款已結清，群組不應顯示在未結清列表', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })

            // 群組 1：Alice 的欠款已結清
            const rec1 = await ds.addRecord({
                groupId: 'group-1',
                type: 'expense',
                amount: 500,
                date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cAlice.id,
                type: 'receivable',
                amount: 500,
                recordId: rec1.id,
                groupId: 'group-1',
                settled: true,
                date: '2024-01-01',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: 'Alice已結清群組', settled: false, netAmount: 0, totalExpense: 500, totalIncome: 0, dateFrom: '2024-01-01', dateTo: '2024-01-01', recordCount: 1 },
            ])

            const container = await renderPage(dm)
            dm.currentFilter = 'unsettled'
            dm.currentContactFilter = cAlice.id

            await dm.updateSummaryCards()
            await dm.loadDebtList()

            expect(container.querySelector('.group-card[data-group-id="group-1"]')).toBeNull();
        })

        it('選擇個別聯絡人時，群組金額只算該聯絡人的分擔（而非整群淨額）', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })
            const cBob = await ds.addContact({ name: 'Bob', phone: '0912' })

            // 同一群組：Alice 欠 500、Bob 欠 300 → 整群淨額 800
            const rec1 = await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 500, date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cAlice.id, type: 'receivable', amount: 500,
                recordId: rec1.id, groupId: 'group-1', settled: false, date: '2024-01-01',
            })
            const rec2 = await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 300, date: '2024-01-02',
            })
            await ds.addDebt({
                contactId: cBob.id, type: 'receivable', amount: 300,
                recordId: rec2.id, groupId: 'group-1', settled: false, date: '2024-01-02',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: '旅行群組', settled: false, netAmount: 800, totalExpense: 800, totalIncome: 0, dateFrom: '2024-01-01', dateTo: '2024-01-02', recordCount: 2 },
            ])

            const container = await renderPage(dm)

            // 無篩選：群組卡顯示整群淨額 800
            let summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('800')
            expect(summaryCards[2].textContent).toContain('1 個')

            // 篩選 Alice：群組卡只算 Alice 分擔 500；v2.1.8.0 起群組欠款
            // 一律計入聯絡人應收/應付統計（遠端修復：關聯群組不再導致漏算）
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()
            summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('Alice')
            expect(summaryCards[2].textContent).toContain('500')
            expect(summaryCards[2].textContent).not.toContain('800')
            // 群組欠款計入個人應收卡（v2.1.8.0 語意：無論是否屬於群組皆累加）
            expect(summaryCards[0].textContent).toContain('500')
            // 列表群組卡也顯示該聯絡人分擔
            const groupCard = container.querySelector('.group-card[data-group-id="group-1"]')
            expect(groupCard).not.toBeNull()
            expect(groupCard.textContent).toContain('500')
            expect(groupCard.textContent).not.toContain('800')
            expect(groupCard.textContent).toContain('此聯絡人分擔')

            // 篩選 Bob：群組卡只算 Bob 分擔 300
            dm.currentContactFilter = cBob.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()
            summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('Bob')
            expect(summaryCards[2].textContent).toContain('300')
            expect(summaryCards[2].textContent).not.toContain('800')
        })

        it('聯絡人在群組中欠款已結清時，分擔金額為 0', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })
            const cBob = await ds.addContact({ name: 'Bob', phone: '0912' })

            const rec1 = await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 500, date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cAlice.id, type: 'receivable', amount: 500,
                recordId: rec1.id, groupId: 'group-1', settled: true, date: '2024-01-01',
            })
            const rec2 = await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 300, date: '2024-01-02',
            })
            await ds.addDebt({
                contactId: cBob.id, type: 'receivable', amount: 300,
                recordId: rec2.id, groupId: 'group-1', settled: false, date: '2024-01-02',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: '旅行群組', settled: false, netAmount: 300, totalExpense: 800, totalIncome: 0, dateFrom: '2024-01-01', dateTo: '2024-01-02', recordCount: 2 },
            ])

            const container = await renderPage(dm)
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()

            const summaryCards = container.querySelectorAll('#summary-cards-container > div')
            // Alice 的欠款已結清 → 群組對 Alice 而言已無未結清分擔 → 0 個、淨額 0（不是整群的 300）
            expect(summaryCards[2].textContent).toContain('0 個')
            expect(summaryCards[2].textContent).toContain('NT$0')
            expect(summaryCards[2].textContent).not.toContain('300')

            // 未結清篩選下，Alice 已無未結清群組欠款 → 群組卡不顯示
            const groupCard = container.querySelector('.group-card[data-group-id="group-1"]')
            expect(groupCard).toBeNull()
        })

        it('聯絡人在群組中僅有 record（無未結清 debt 分擔）時，群組卡金額歸零不洩漏整群淨額', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })
            const cBob = await ds.addContact({ name: 'Bob', phone: '0912' })

            // 群組 netAmount 800 全來自 Bob 的未結清欠款；
            // Alice 只掛了 record（無 debt），屬於該群組但無未結清分擔
            await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 200, date: '2024-01-01',
                contactId: cAlice.id,
            })
            const rec2 = await ds.addRecord({
                groupId: 'group-1', type: 'expense', amount: 300, date: '2024-01-02',
            })
            await ds.addDebt({
                contactId: cBob.id, type: 'receivable', amount: 300,
                recordId: rec2.id, groupId: 'group-1', settled: false, date: '2024-01-02',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: '旅行群組', settled: false, netAmount: 800, totalExpense: 800, totalIncome: 0, dateFrom: '2024-01-01', dateTo: '2024-01-02', recordCount: 2 },
            ])

            const container = await renderPage(dm)
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()

            // 頂部摘要卡：Alice 無未結清分擔 → 淨額 NT$0
            const summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('NT$0')
            expect(summaryCards[2].textContent).not.toContain('800')

            // 列表群組卡（因 record 路徑仍顯示該群組）：金額必須歸零，
            // 不得回退顯示整群淨額 800，與頂部摘要卡保持一致
            const groupCard = container.querySelector('.group-card[data-group-id="group-1"]')
            expect(groupCard).not.toBeNull()
            expect(groupCard.textContent).toContain('NT$0')
            expect(groupCard.textContent).not.toContain('800')
            expect(groupCard.textContent).toContain('此聯絡人在此群組無未結清欠款')
        })

        it('群組內部分擔為應付時，聯絡人分擔淨額為負值', async () => {
            const cAlice = await ds.addContact({ name: 'Alice', phone: '0911' })

            // Alice 欠別人（payable）500 在群組中
            const rec1 = await ds.addRecord({
                groupId: 'group-1', type: 'income', amount: 500, date: '2024-01-01',
            })
            await ds.addDebt({
                contactId: cAlice.id, type: 'payable', amount: 500,
                recordId: rec1.id, groupId: 'group-1', settled: false, date: '2024-01-01',
            })

            ds.getGroups.mockResolvedValue([
                { id: 'group-1', name: '宿舍群組', settled: false, netAmount: -500, totalExpense: 0, totalIncome: 500, dateFrom: '2024-01-01', dateTo: '2024-01-01', recordCount: 1 },
            ])

            const container = await renderPage(dm)
            dm.currentContactFilter = cAlice.id
            await dm.updateSummaryCards()
            await dm.loadDebtList()

            const summaryCards = container.querySelectorAll('#summary-cards-container > div')
            expect(summaryCards[2].textContent).toContain('500')
            // 群組卡分擔方向為應付
            const groupCard = container.querySelector('.group-card[data-group-id="group-1"]')
            expect(groupCard).not.toBeNull()
            expect(groupCard.textContent).toContain('應付')
        })
    })
})

// ==================== 匯出聯絡人欠款資訊 (#DEBT-EXP1) ====================
// buildContactDebtExportText 為純函數；showContactDebtExportModal 用真實 DebtManager + mock dataService
describe('匯出聯絡人欠款資訊 #DEBT-EXP1', () => {
    let ds
    let dm

    beforeEach(() => {
        ds = createMockDataService()
        dm = new DebtManager(ds)
    })

    describe('buildContactDebtExportText (純函數)', () => {
        it('空陣列回傳標題 +（沒有欠款紀錄）', () => {
            const text = dm.buildContactDebtExportText('小明', [])
            expect(text).toContain('小明的欠款明細（共 0 筆）')
            expect(text).toContain('（沒有欠款紀錄）')
        })

        it('非陣列輸入回傳標題 +（沒有欠款紀錄）', () => {
            const text = dm.buildContactDebtExportText('小明', null)
            expect(text).toContain('小明的欠款明細（共 0 筆）')
            expect(text).toContain('（沒有欠款紀錄）')
        })

        it('單筆未結清 receivable → 標題 + 月份 + 明細行 + 應收合計', () => {
            const debts = [{
                id: 1, type: 'receivable', originalAmount: 500,
                remainingAmount: 500, date: '2026-07-15',
                description: '午餐代墊', settled: false, createdAt: 1,
            }]
            const text = dm.buildContactDebtExportText('小明', debts)
            expect(text).toContain('小明的欠款明細（共 1 筆）')
            expect(text).toContain('2026-07')
            expect(text).toContain('- 2026-07-15 午餐代墊 NT$500（未結清）')
            expect(text).toContain('應收 NT$500')
            expect(text).toContain('應付 NT$0')
        })

        it('多月份 → 月份降序排列（最近月份在前）', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 100, remainingAmount: 100, date: '2026-07-10', description: null, settled: false, createdAt: 1 },
                { id: 2, type: 'payable', originalAmount: 200, remainingAmount: 200, date: '2026-09-01', description: null, settled: false, createdAt: 2 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            const idxAug = text.indexOf('2026-09')
            const idxJul = text.indexOf('2026-07')
            expect(idxAug).toBeGreaterThan(-1)
            expect(idxJul).toBeGreaterThan(-1)
            expect(idxAug).toBeLessThan(idxJul)
        })

        it('同月多筆 → date 降序排列', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 100, remainingAmount: 100, date: '2026-07-01', description: '早', settled: false, createdAt: 1 },
                { id: 2, type: 'payable', originalAmount: 200, remainingAmount: 200, date: '2026-07-20', description: '晚', settled: false, createdAt: 2 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            const idxEarly = text.indexOf('2026-07-01')
            const idxLate = text.indexOf('2026-07-20')
            expect(idxLate).toBeLessThan(idxEarly)
        })

        it('已結清 → 顯示 originalAmount +（已結清），不計入未結清合計', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 300, remainingAmount: 0, date: '2026-06-01', description: null, settled: true, createdAt: 1 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            expect(text).toContain('- 2026-06-01 NT$300（已結清）')
            expect(text).toContain('全部 1 筆已結清')
            expect(text).not.toContain('未結清合計')
        })

        it('無 description → 行內無逗號/空格殘留（日期後直接跟金額）', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 100, remainingAmount: 100, date: '2026-07-01', description: null, settled: false, createdAt: 1 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            expect(text).toContain('- 2026-07-01 NT$100（未結清）')
        })

        it('remainingAmount 為 null（舊資料）→ fallback originalAmount', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 400, remainingAmount: null, date: '2026-07-01', description: null, settled: false, createdAt: 1 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            expect(text).toContain('NT$400（未結清）')
            expect(text).toContain('應付 NT$400')
        })

        it('混合 receivable + payable + type undefined（歸應付）→ 合計分算正確', () => {
            const debts = [
                { id: 1, type: 'receivable', originalAmount: 500, remainingAmount: 300, date: '2026-07-01', description: null, settled: false, createdAt: 1 },
                { id: 2, type: 'payable', originalAmount: 200, remainingAmount: 200, date: '2026-07-02', description: null, settled: false, createdAt: 2 },
                { id: 3, type: undefined, originalAmount: 100, remainingAmount: 100, date: '2026-07-03', description: null, settled: false, createdAt: 3 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            // 應收 = 300（receivable 的 remaining）；應付 = 200 + 100（payable + 舊格式）
            expect(text).toContain('應收 NT$300')
            expect(text).toContain('應付 NT$300')
        })

        it('部分結清 → 顯示未結清合計（已結清筆不計入）', () => {
            const debts = [
                { id: 1, type: 'payable', originalAmount: 100, remainingAmount: 0, date: '2026-06-01', description: null, settled: true, createdAt: 1 },
                { id: 2, type: 'payable', originalAmount: 200, remainingAmount: 200, date: '2026-07-01', description: null, settled: false, createdAt: 2 },
            ]
            const text = dm.buildContactDebtExportText('小明', debts)
            expect(text).toContain('未結清合計')
            expect(text).toContain('應付 NT$200')
            expect(text).not.toContain('全部 2 筆已結清')
        })
    })

    describe('showContactDebtExportModal', () => {
        it('聯絡人不存在 → showToast 錯誤、不建 modal', async () => {
            await dm.showContactDebtExportModal(999)
            expect(showToast).toHaveBeenCalledWith('找不到聯絡人', 'error')
            expect(document.querySelector('#contact-debt-export-modal')).toBeNull()
        })

        it('該聯絡人無欠款 → modal 顯示（沒有欠款紀錄）', async () => {
            const c = await ds.addContact({ name: '小明' })
            await dm.showContactDebtExportModal(c.id)
            const modal = document.querySelector('#contact-debt-export-modal')
            expect(modal).not.toBeNull()
            const ta = modal.querySelector('#export-debt-text')
            expect(ta.value).toContain('（沒有欠款紀錄）')
            expect(ta.value).toContain('小明的欠款明細（共 0 筆）')
            expect(modal.querySelector('h3').textContent).toContain('匯出欠款 — 小明')
            modal.remove()
        })

        it('有欠款 → modal 顯示月份分組文字', async () => {
            const c = await ds.addContact({ name: '小明' })
            await ds.addDebt({
                contactId: c.id, type: 'receivable', originalAmount: 500,
                remainingAmount: 500, date: '2026-07-15', description: '午餐代墊', settled: false,
            })
            await dm.showContactDebtExportModal(c.id)
            const modal = document.querySelector('#contact-debt-export-modal')
            expect(modal).not.toBeNull()
            const text = modal.querySelector('#export-debt-text').value
            expect(text).toContain('2026-07')
            expect(text).toContain('午餐代墊')
            expect(text).toContain('未結清')
            modal.remove()
        })

        it('XSS 防護：debt.description 含 script 標籤 → innerHTML 不含原始 script', async () => {
            const c = await ds.addContact({ name: '小明' })
            await ds.addDebt({
                contactId: c.id, type: 'payable', originalAmount: 100,
                remainingAmount: 100, date: '2026-07-01',
                description: '<script>alert(1)</script>', settled: false,
            })
            await dm.showContactDebtExportModal(c.id)
            const modal = document.querySelector('#contact-debt-export-modal')
            expect(modal).not.toBeNull()
            expect(modal.innerHTML).not.toContain('<script>')
            // 顯示文字應為 escape 後的實體
            expect(modal.querySelector('#export-debt-text').value).toContain('<script>alert(1)</script>')
            modal.remove()
        })

        it('複製按鈕 → clipboard.writeText 被呼叫 + modal 移除', async () => {
            const c = await ds.addContact({ name: '小明' })
            await ds.addDebt({
                contactId: c.id, type: 'payable', originalAmount: 100,
                remainingAmount: 100, date: '2026-07-01', description: null, settled: false,
            })
            const writeText = vi.fn(async () => {})
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText },
                configurable: true,
            })
            await dm.showContactDebtExportModal(c.id)
            const copyBtn = document.querySelector('#copy-export-debt-btn')
            expect(copyBtn).not.toBeNull()
            copyBtn.click()
            await flush()
            expect(writeText).toHaveBeenCalledTimes(1)
            expect(document.querySelector('#contact-debt-export-modal')).toBeNull()
            expect(customAlert).toHaveBeenCalled()
        })

        it('關閉按鈕 → modal 移除', async () => {
            const c = await ds.addContact({ name: '小明' })
            await dm.showContactDebtExportModal(c.id)
            document.querySelector('#close-export-debt-btn').click()
            expect(document.querySelector('#contact-debt-export-modal')).toBeNull()
        })

        it('背景點擊 → modal 移除', async () => {
            const c = await ds.addContact({ name: '小明' })
            await dm.showContactDebtExportModal(c.id)
            const modal = document.querySelector('#contact-debt-export-modal')
            modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            expect(document.querySelector('#contact-debt-export-modal')).toBeNull()
        })
    })

    describe('renderContactsPage 匯出按鈕入口', () => {
        it('每個聯絡人列有匯出欠款按鈕，點擊觸發 showContactDebtExportModal', async () => {
            await ds.addContact({ name: '小明' })
            await ds.addContact({ name: '阿明' })
            const spy = vi.spyOn(dm, 'showContactDebtExportModal').mockResolvedValue(undefined)
            const container = document.createElement('div')
            document.body.appendChild(container)
            await dm.renderContactsPage(container)

            const exportBtns = container.querySelectorAll('.export-debt-btn')
            expect(exportBtns.length).toBe(2)

            // 點第一個聯絡人的匯出按鈕
            exportBtns[0].click()
            await flush()
            expect(spy).toHaveBeenCalledTimes(1)
            const calledId = spy.mock.calls[0][0]
            // data-id 為數字 id（mock addContact 從 50 起遞增）
            expect(typeof calledId).toBe('number')
            container.remove()
        })
    })
})


// ==================== 既有款項登記（initialPaidAmount 基線） ====================
describe('DebtManager - 既有款項登記基線', () => {
    let dm, ds

    beforeEach(() => {
        ds = createMockDataService()
        dm = new DebtManager(ds)
    })

    it('新增模式顯示「已還／已收金額」欄位，編輯模式不顯示', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await renderPage(dm)

        await dm.showAddDebtModal()
        expect(document.querySelector('#debt-initial-paid')).not.toBeNull()
        document.querySelector('#add-debt-modal').remove()

        const debt = await ds.addDebt({
            contactId: 50, type: 'receivable', amount: 1000, date: '2024-01-01',
        })
        const fresh = await ds.getDebt(debt.id ?? debt)
        await dm.showAddDebtModal(fresh)
        expect(document.querySelector('#debt-initial-paid')).toBeNull()
        document.querySelector('#add-debt-modal').remove()
    })

    it('填寫基線 → addDebt 帶 initialPaidAmount', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await renderPage(dm)
        await dm.showAddDebtModal()
        const modal = document.querySelector('#add-debt-modal')
        modal.querySelector('#debt-amount').value = '1000'
        modal.querySelector('#debt-initial-paid').value = '400'
        modal.querySelector('#save-debt-btn').click()
        await flush()

        expect(ds.addDebt).toHaveBeenCalledTimes(1)
        const arg = ds.addDebt.mock.calls[0][0]
        expect(arg.amount).toBe(1000)
        expect(arg.initialPaidAmount).toBe(400)
    })

    it('基線留空 → debtData 不含 initialPaidAmount（零污染）', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await renderPage(dm)
        await dm.showAddDebtModal()
        const modal = document.querySelector('#add-debt-modal')
        modal.querySelector('#debt-amount').value = '700'
        modal.querySelector('#save-debt-btn').click()
        await flush()

        const arg = ds.addDebt.mock.calls[0][0]
        expect('initialPaidAmount' in arg).toBe(false)
    })

    it('基線大於總額 → 彈出警示且不建立欠款', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await renderPage(dm)
        await dm.showAddDebtModal()
        const modal = document.querySelector('#add-debt-modal')
        modal.querySelector('#debt-amount').value = '500'
        modal.querySelector('#debt-initial-paid').value = '800'
        modal.querySelector('#save-debt-btn').click()
        await flush()

        expect(customAlert).toHaveBeenCalledWith(expect.stringContaining('不能大於'))
        expect(ds.addDebt).not.toHaveBeenCalled()
        document.querySelector('#add-debt-modal')?.remove()
    })

    it('編輯欠款：已還總額含基線（基線 400 + payments 200，金額 1000→900 時 remaining=300）', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await ds.addDebt({
            contactId: 50,
            type: 'receivable',
            amount: 1000,
            date: '2024-01-01',
        })
        // 直接改造 mock 內部 debt：加基線與一筆付款
        const d = (await ds.getDebts())[0]
        d.initialPaidAmount = 400
        d.remainingAmount = 400
        d.payments = [{ amount: 200, date: '2024-02-01' }]

        await renderPage(dm)
        await dm.showAddDebtModal(d)
        const modal = document.querySelector('#add-debt-modal')
        modal.querySelector('#debt-amount').value = '900'
        modal.querySelector('#save-debt-btn').click()
        await flush()

        expect(ds.updateDebt).toHaveBeenCalledWith(
            d.id,
            expect.objectContaining({
                originalAmount: 900,
                remainingAmount: 300,
            })
        )
    })

    it('還款歷程 modal：已還合計含基線並顯示基線列', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await ds.addDebt({
            contactId: 50,
            type: 'payable',
            amount: 1000,
            date: '2024-01-01',
        })
        const d = (await ds.getDebts())[0]
        d.initialPaidAmount = 400
        d.remainingAmount = 400
        d.payments = [{ amount: 200, date: '2024-02-01' }]

        await renderPage(dm)
        await dm.showPaymentHistoryModal(d.id)
        const modal = document.querySelector('#payment-history-modal')
        expect(modal).not.toBeNull()
        expect(modal.innerHTML).toContain('NT$600')
        expect(modal.innerHTML).toContain('含既有款項基線')
        expect(modal.innerHTML).toContain('NT$400')
        modal.remove()
    })

    it('還款歷程 modal：無基線的欠款不顯示基線列（舊行為不變）', async () => {
        await ds.addContact({ name: '小明', phone: '1' })
        await ds.addDebt({
            contactId: 50,
            type: 'payable',
            amount: 1000,
            date: '2024-01-01',
        })
        const d = (await ds.getDebts())[0]
        d.remainingAmount = 700
        d.payments = [{ amount: 300, date: '2024-02-01' }]

        await renderPage(dm)
        await dm.showPaymentHistoryModal(d.id)
        const modal = document.querySelector('#payment-history-modal')
        expect(modal.innerHTML).not.toContain('含既有款項基線')
        expect(modal.innerHTML).toContain('NT$300')
        modal.remove()
    })
})

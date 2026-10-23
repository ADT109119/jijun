import { describe, it, expect, beforeEach, vi } from 'vitest'
import DataService from '../../src/js/dataService.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('debtPaymentsPrune — recalculateDebtState payments 修剪與回寫', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('1. 刪除明細紀錄時，recalculateDebtState 成功修剪引用該紀錄的幽靈 payment', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        // 模擬結清產生明細與 payment
        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 400,
            date: '2026-10-02',
            debtId,
            ledgerId: 1,
        })

        await ds.updateDebt(debtId, {
            remainingAmount: 600,
            payments: [{ amount: 400, date: '2026-10-02', recordId: recId }],
        })

        // 刪除該明細紀錄
        await ds.deleteRecord(recId)

        // 驗證 debt 的 payments 已被修剪為空，剩餘金額恢復為 1000
        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.remainingAmount).toBe(1000)
        expect(updatedDebt.settled).toBe(false)
        expect(updatedDebt.payments).toEqual([])
    })

    it('2. 編輯明細金額時，recalculateDebtState 成功回寫 payment.amount 為最新金額', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 500,
            date: '2026-10-02',
            debtId,
            ledgerId: 1,
        })

        await ds.updateDebt(debtId, {
            remainingAmount: 500,
            payments: [{ amount: 500, date: '2026-10-02', recordId: recId }],
        })

        // 明細頁修改還款金額為 300
        await ds.updateRecord(recId, { amount: 300 })

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.remainingAmount).toBe(700)
        expect(updatedDebt.payments).toHaveLength(1)
        expect(updatedDebt.payments[0].amount).toBe(300)
    })

    it('3. 編輯明細日期時，recalculateDebtState 成功回寫 payment.date 為最新日期', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 500,
            date: '2026-10-02',
            debtId,
            ledgerId: 1,
        })

        await ds.updateDebt(debtId, {
            remainingAmount: 500,
            payments: [{ amount: 500, date: '2026-10-02', recordId: recId }],
        })

        // 明細頁修改還款日期
        await ds.updateRecord(recId, { date: '2026-10-15' })

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.payments[0].date).toBe('2026-10-15')
    })

    it('4. 孤兒付款（無 recordId 且無 recordUuid）保留不修剪，供 repairOrphanedDebtRecords 處理', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const orphanPayment = {
            amount: 200,
            date: '2026-10-02',
            recordId: null,
        }
        await ds.updateDebt(debtId, {
            remainingAmount: 800,
            payments: [orphanPayment],
        })

        // 觸發重新計算
        await ds.recalculateDebtState(debtId)

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.payments).toHaveLength(1)
        expect(updatedDebt.payments[0].amount).toBe(200)
        expect(updatedDebt.remainingAmount).toBe(800)
    })

    it('5. 舊形態付款（payment.recordId === debt.recordId）保留不修剪', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
            recordId: 99,
        })

        const legacyPayment = { amount: 300, date: '2026-10-02', recordId: 99 }
        await ds.updateDebt(debtId, {
            remainingAmount: 700,
            payments: [legacyPayment],
        })

        await ds.recalculateDebtState(debtId)

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.payments).toHaveLength(1)
        expect(updatedDebt.payments[0].amount).toBe(300)
        expect(updatedDebt.remainingAmount).toBe(700)
    })

    it('6. 支援以 recordUuid 匹配明細（即使 recordId 未直接對上）', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 350,
            date: '2026-10-02',
            debtId,
            uuid: 'rec-uuid-12345',
            ledgerId: 1,
        })

        // payment 僅帶 recordUuid，recordId 為 null
        await ds.updateDebt(debtId, {
            remainingAmount: 650,
            payments: [
                {
                    amount: 350,
                    date: '2026-10-02',
                    recordId: null,
                    recordUuid: 'rec-uuid-12345',
                },
            ],
        })

        await ds.recalculateDebtState(debtId)

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.payments).toHaveLength(1)
        expect(updatedDebt.payments[0].recordId).toBe(recId)
        expect(updatedDebt.payments[0].amount).toBe(350)
    })

    it('7. 支援字串與數字混用的 recordId 匹配', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 450,
            date: '2026-10-02',
            debtId,
            ledgerId: 1,
        })

        // payment 的 recordId 為字串型別
        await ds.updateDebt(debtId, {
            remainingAmount: 550,
            payments: [
                { amount: 450, date: '2026-10-02', recordId: String(recId) },
            ],
        })

        await ds.recalculateDebtState(debtId)

        const updatedDebt = await ds.getDebt(debtId)
        expect(updatedDebt.payments).toHaveLength(1)
        expect(updatedDebt.payments[0].amount).toBe(450)
    })

    it('8. 零震盪（No-op if unchanged）：payments 無變更時不觸發無謂的 payments 重寫', async () => {
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明',
        })

        const recId = await ds.addRecord({
            type: 'income',
            category: 'debt_collection',
            amount: 200,
            date: '2026-10-02',
            debtId,
            ledgerId: 1,
        })

        const rec = await ds.getRecord(recId)
        const initialPayments = [
            {
                amount: 200,
                date: '2026-10-02',
                recordId: recId,
                recordUuid: rec.uuid,
            },
        ]
        await ds.updateDebt(debtId, {
            remainingAmount: 800,
            payments: initialPayments,
        })

        // 監聽 updateDebt 是否被呼叫
        const updateSpy = vi.spyOn(ds, 'updateDebt')

        // 執行 recalculateDebtState
        await ds.recalculateDebtState(debtId)

        // updates 中不應包含 payments 欄位（因為 payments 內容完全無差異）
        expect(updateSpy).toHaveBeenCalled()
        const lastCallArgs = updateSpy.mock.calls[0]
        const updatesPassed = lastCallArgs[1]
        expect(updatesPassed.payments).toBeUndefined()

        updateSpy.mockRestore()
    })

    it('9. 端到端流程：addDebt → settleDebt → deleteRecord → 重算 → 編輯欠款算式不掩蓋實際未收款項', async () => {
        // 1. 建立借出 $1,000 的欠款
        const debtId = await ds.addDebt({
            type: 'receivable',
            amount: 1000,
            date: '2026-10-01',
            description: '借小明 1000',
        })

        // 2. 還款 $1,000 結清
        await ds.settleDebt(debtId, 1000)
        const settledDebt = await ds.getDebt(debtId)
        expect(settledDebt.settled).toBe(true)
        expect(settledDebt.remainingAmount).toBe(0)
        expect(settledDebt.payments).toHaveLength(1)
        const paymentRecordId = settledDebt.payments[0].recordId

        // 3. 使用者發現是誤記，從明細頁刪除該筆還款明細
        await ds.deleteRecord(paymentRecordId)

        // 4. 重算後驗證：payments 幽靈付款被修剪，remainingAmount 救回 1000，settled 變為 false
        const debtAfterDelete = await ds.getDebt(debtId)
        expect(debtAfterDelete.remainingAmount).toBe(1000)
        expect(debtAfterDelete.settled).toBe(false)
        expect(debtAfterDelete.payments).toEqual([])

        // 5. 模擬 debtManager.js 編輯欠款儲存算式：max(0, originalAmount - Σpayments)
        const principal =
            debtAfterDelete.originalAmount || debtAfterDelete.amount || 1000
        const paidAmount = (debtAfterDelete.payments || []).reduce(
            (sum, p) => sum + p.amount,
            0
        )
        const newRemaining = Math.max(0, principal - paidAmount)

        // 驗證：未收金額 1,000 絕對不會被幽靈付款掩蓋成 0！
        expect(paidAmount).toBe(0)
        expect(newRemaining).toBe(1000)
    })
})

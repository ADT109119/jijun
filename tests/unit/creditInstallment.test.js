import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EasyAccountingApp } from '../../src/js/main.js'

// 構造 app 級測試實例：真實 processAmortizations + mock dataService
function makeApp() {
    const app = Object.create(EasyAccountingApp.prototype)
    app.dataService = {
        getAmortizations: vi.fn(async () => app.__items),
        getRecords: vi.fn(async () => app.__records),
        addRecord: vi.fn(async (r) => {
            app.__records.push({ ...r, id: ++app.__seq })
            return app.__seq
        }),
        updateAmortization: vi.fn(async (id, u) => {
            const it = app.__items.find(x => x.id === id)
            Object.assign(it, u)
        }),
        getAccounts: vi.fn(async () => app.__accounts),
    }
    app.__seq = 0
    app.__records = []
    return app
}

describe('processAmortizations — upfront 信用卡分期', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-05T10:00:00')) // 第二期到期
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('到期產生轉帳對：支出=扣款帳戶、收入=卡，皆帶 amortizationId', async () => {
        const app = makeApp()
        app.__accounts = [
            { id: 1, name: '現金', type: 'wallet' },
            { id: 2, name: '銀行', type: 'bank' },
            { id: 3, name: '卡', type: 'credit_card', autoPayAccountId: 2 },
        ]
        app.__items = [{
            id: 10, name: 'iPhone 分期', type: 'installment',
            recordType: 'expense', category: '3C',
            totalAmount: 30000, downPayment: 0, interestRate: 0,
            periods: 12, completedPeriods: 1, amountPerPeriod: 2500,
            frequency: 'monthly', decimalStrategy: 'round',
            startDate: '2026-08-01', nextDueDate: '2026-09-01',
            status: 'active', accountId: 3, chargeMode: 'upfront', ledgerId: 1,
        }]
        await app.processAmortizations()
        // 一期轉帳對
        const exp = app.__records.find(r => r.type === 'expense')
        const inc = app.__records.find(r => r.type === 'income')
        expect(exp).toMatchObject({ accountId: 2, amount: 2500, category: 'transfer', amortizationId: 10, ledgerId: 1 })
        expect(inc).toMatchObject({ accountId: 3, amount: 2500, category: 'transfer', amortizationId: 10, ledgerId: 1 })
        expect(exp.description).toContain('第 2/12 期')
        expect(app.__items[0].completedPeriods).toBe(2)
        expect(app.__items[0].nextDueDate).toBe('2026-10-01')
    })

    it('無 autoPayAccountId：不產生紀錄、只推進期數', async () => {
        const app = makeApp()
        app.__accounts = [{ id: 3, name: '卡', type: 'credit_card' }]
        app.__items = [{
            id: 11, name: '無扣款卡分期', type: 'installment', recordType: 'expense',
            category: '3C', totalAmount: 6000, downPayment: 0, interestRate: 0,
            periods: 6, completedPeriods: 1, amountPerPeriod: 1000,
            frequency: 'monthly', decimalStrategy: 'round',
            startDate: '2026-08-01', nextDueDate: '2026-09-01',
            status: 'active', accountId: 3, chargeMode: 'upfront', ledgerId: 1,
        }]
        await app.processAmortizations()
        expect(app.__records).toHaveLength(0)
        expect(app.__items[0].completedPeriods).toBe(2)
    })

    it('滿期 status=completed（末期差額沿用現行邏輯）', async () => {
        const app = makeApp()
        app.__accounts = [
            { id: 2, name: '銀行', type: 'bank' },
            { id: 3, name: '卡', type: 'credit_card', autoPayAccountId: 2 },
        ]
        app.__items = [{
            id: 12, name: '末期', type: 'installment', recordType: 'expense',
            category: '3C', totalAmount: 2500, downPayment: 0, interestRate: 0,
            periods: 1, completedPeriods: 0, amountPerPeriod: 2500,
            frequency: 'monthly', decimalStrategy: 'round',
            startDate: '2026-09-01', nextDueDate: '2026-09-01',
            status: 'active', accountId: 3, chargeMode: 'upfront', ledgerId: 1,
        }]
        await app.processAmortizations()
        expect(app.__items[0].status).toBe('completed')
        expect(app.__records.find(r => r.type === 'income')).toMatchObject({ amount: 2500, accountId: 3 })
    })

    it('periodic（預設）行為不變：仍產生單筆支出', async () => {
        const app = makeApp()
        app.__accounts = [{ id: 1, name: '現金', type: 'wallet' }]
        app.__items = [{
            id: 13, name: '舊式分期', type: 'installment', recordType: 'expense',
            category: '3C', totalAmount: 3000, downPayment: 0, interestRate: 0,
            periods: 3, completedPeriods: 1, amountPerPeriod: 1000,
            frequency: 'monthly', decimalStrategy: 'round',
            startDate: '2026-08-01', nextDueDate: '2026-09-01',
            status: 'active', accountId: 1, chargeMode: 'periodic', ledgerId: 1,
        }]
        await app.processAmortizations()
        expect(app.__records).toHaveLength(1)
        expect(app.__records[0]).toMatchObject({ type: 'expense', accountId: 1, amount: 1000 })
    })

    it('upfront 末期差額只算卡端收入（轉帳對不雙重計數）', async () => {
        const app = makeApp()
        app.__accounts = [
            { id: 2, name: '銀行', type: 'bank' },
            { id: 3, name: '卡', type: 'credit_card', autoPayAccountId: 2 },
        ]
        // 模擬前 5 期已各產生轉帳對（各 1000）：卡端收入累計 5000
        for (let i = 1; i <= 5; i++) {
            app.__records.push({
                id: ++app.__seq, type: 'expense', category: 'transfer',
                amount: 1000, accountId: 2, ledgerId: 1, amortizationId: 20,
            })
            app.__records.push({
                id: ++app.__seq, type: 'income', category: 'transfer',
                amount: 1000, accountId: 3, ledgerId: 1, amortizationId: 20,
            })
        }
        app.__items = [{
            id: 20, name: '末期修正', type: 'installment', recordType: 'expense',
            category: '3C', totalAmount: 7000, downPayment: 0, interestRate: 0,
            periods: 6, completedPeriods: 5, amountPerPeriod: 1000,
            frequency: 'monthly', decimalStrategy: 'round',
            startDate: '2026-03-01', nextDueDate: '2026-09-01',
            status: 'active', accountId: 3, chargeMode: 'upfront', ledgerId: 1,
        }]
        await app.processAmortizations()
        // 末期應補 7000 - 5000 = 2000（若雙重計數會變成 7000-10000=0，不產生紀錄）
        const inc = app.__records.find(r => r.type === 'income' && r.amortizationId === 20 && r.id > 10)
        expect(inc).toMatchObject({ amount: 2000, accountId: 3 })
        expect(app.__items[0].status).toBe('completed')
    })

    it('補跑多期（跨月未開 app）末期不超額：同一次執行補第 11+12 期，末期差額含本輪第 11 期', async () => {
        // fake now = 2026-09-05。週頻率、nextDueDate=2026-08-19：
        // 一次補跑 8/19（第 11 期）+ 8/26（第 12 期，末期差額分支）
        // 12 期 × 2500 = 30000（0% 利率）
        const app = makeApp()
        app.__accounts = [
            { id: 2, name: '銀行', type: 'bank' },
            { id: 3, name: '卡', type: 'credit_card', autoPayAccountId: 2 },
        ]
        // 前 10 期各 2500 已入卡（income 腿）
        for (let i = 1; i <= 10; i++) {
            app.__records.push({
                id: ++app.__seq, type: 'income', category: 'transfer',
                amount: 2500, accountId: 3, ledgerId: 1, amortizationId: 30,
            })
        }
        app.__items = [{
            id: 30, name: '補跑末期', type: 'installment', recordType: 'expense',
            category: '3C', totalAmount: 30000, downPayment: 0, interestRate: 0,
            periods: 12, completedPeriods: 10, amountPerPeriod: 2500,
            frequency: 'weekly', decimalStrategy: 'round',
            startDate: '2025-07-19', nextDueDate: '2026-08-19',
            status: 'active', accountId: 3, chargeMode: 'upfront', ledgerId: 1,
        }]
        await app.processAmortizations()
        // 若快取未同步 → 末期 = 30000-25000 = 5000（多扣 2500）
        // 正確：第 11 期 2500 + 第 12 期 30000-27500 = 2500
        const incomes = app.__records
            .filter(r => r.type === 'income' && r.amortizationId === 30)
        const totalPaid = incomes.reduce((s, r) => s + r.amount, 0)
        expect(totalPaid).toBe(30000) // 不多扣、不少扣
        expect(app.__items[0].status).toBe('completed')
    })
})

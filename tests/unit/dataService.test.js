import { describe, it, expect, vi } from 'vitest'
import DataService from '../../src/js/dataService.js'

// 取得 mock DB 的內部狀態
function getMockStore(name) {
    return globalThis.indexedDB._storeData?.[name] || []
}

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('DataService — _exportFullBackup / _restoreFromBackup', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        // 模擬 init() 後的 db 引用
        ds.db = await globalThis.idb.openDB()
    })

    describe('_exportFullBackup', () => {
        it('備份包含所有 store 的資料', async () => {
            const mockDb = ds.db

            // 寫入測試資料到各 store
            const tx1 = mockDb.transaction('records', 'readwrite')
            await tx1.store.add({
                type: 'expense',
                amount: 100,
                date: '2024-01-01',
            })
            await tx1.done

            const tx2 = mockDb.transaction('ledgers', 'readwrite')
            await tx2.store.add({ name: '測試帳本' })
            await tx2.done

            // 寫入 localStorage settings
            localStorage.setItem('easy_accounting_test_key', 'test_value')

            const backup = await ds._exportFullBackup()

            expect(backup.records).toHaveLength(1)
            expect(backup.records[0].amount).toBe(100)
            expect(backup.ledgers).toHaveLength(1)
            expect(backup.ledgers[0].name).toBe('測試帳本')
        })

        it('備份包含 localStorage settings', async () => {
            const mockDb = ds.db

            localStorage.setItem('easy_accounting_setting_a', 'value_a')
            localStorage.setItem(
                'easy_accounting_setting_b',
                JSON.stringify({ key: 'val' })
            )

            const backup = await ds._exportFullBackup()

            expect(backup._settings).toBeDefined()
            expect(backup._settings['easy_accounting_setting_a']).toBe(
                'value_a'
            )
            expect(
                JSON.parse(backup._settings['easy_accounting_setting_b'])
            ).toEqual({ key: 'val' })
        })

        it('備份空 store 回傳空陣列', async () => {
            const mockDb = ds.db

            // 確保所有 store 都是空的（beforeEach 已清理）
            clearMockData()

            const backup = await ds._exportFullBackup()

            expect(backup.records).toEqual([])
            expect(backup.accounts).toEqual([])
        })
    })

    describe('_restoreFromBackup', () => {
        it('還原 records store 資料', async () => {
            const mockDb = ds.db

            // 先寫入不同資料（模擬匯入前的 DB 狀態）
            const tx1 = mockDb.transaction('records', 'readwrite')
            await tx1.store.add({ type: 'expense', amount: 999 })
            await tx1.done

            // 建立備份快照（還原目標資料）
            const backup = {
                records: [{ type: 'income', amount: 500, date: '2024-06-01' }],
                ledgers: [],
                accounts: [],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
            }

            await ds._restoreFromBackup(backup)

            // 從 DB 重新讀出，驗證 DB 狀態確實已被還原
            const tx2 = mockDb.transaction('records', 'readonly')
            const allRecords = await tx2.store.toArray()
            await tx2.done

            expect(allRecords).toHaveLength(1)
            expect(allRecords[0].amount).toBe(500)
            expect(allRecords[0].type).toBe('income')
        })

        it('還原 localStorage settings', async () => {
            const mockDb = ds.db

            // 修改 localStorage
            localStorage.setItem('easy_accounting_key1', 'new_value')

            const backup = {
                _settings: { easy_accounting_key1: 'original_value' },
                records: [],
                ledgers: [],
                accounts: [],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
            }

            await ds._restoreFromBackup(backup)
            expect(localStorage.getItem('easy_accounting_key1')).toBe(
                'original_value'
            )
        })

        it('還原後 records 資料恢復為備份狀態', async () => {
            const mockDb = ds.db

            // 建立包含資料的備份
            const backup = {
                records: [
                    { type: 'expense', amount: 100, date: '2024-01-15' },
                    { type: 'income', amount: 200, date: '2024-02-20' },
                ],
                ledgers: [],
                accounts: [],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
            }

            await ds._restoreFromBackup(backup)

            const tx = mockDb.transaction('records', 'readonly')
            const allRecords = await tx.store.toArray()
            await tx.done

            expect(allRecords).toHaveLength(2)
            expect(allRecords[0].amount).toBe(100)
            expect(allRecords[1].amount).toBe(200)
        })
    })
})

describe('DataService — clearAll*', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    it('clearAllRecords 清空 records store', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' })
        await tx.done

        await ds.clearAllRecords()

        const tx2 = mockDb.transaction('records', 'readonly')
        const count = await tx2.store.count()
        await tx2.done
        expect(count).toBe(0)
    })

    it('clearAllAccounts 清空 accounts store', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('accounts', 'readwrite')
        await tx.store.add({ name: '測試帳戶' })
        await tx.done

        await ds.clearAllAccounts()

        const tx2 = mockDb.transaction('accounts', 'readonly')
        const count = await tx2.store.count()
        await tx2.done
        expect(count).toBe(0)
    })

    it('clearAllContacts 清空 contacts store', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('contacts', 'readwrite')
        await tx.store.add({ name: '測試聯絡人' })
        await tx.done

        await ds.clearAllContacts()

        const tx2 = mockDb.transaction('contacts', 'readonly')
        const count = await tx2.store.count()
        await tx2.done
        expect(count).toBe(0)
    })

    it('clearAllDebts 清空 debts store', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('debts', 'readwrite')
        await tx.store.add({ name: '測試欠款' })
        await tx.done

        await ds.clearAllDebts()

        const tx2 = mockDb.transaction('debts', 'readonly')
        const count = await tx2.store.count()
        await tx2.done
        expect(count).toBe(0)
    })
})

describe('DataService — getRecords / getAllRecords', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    it('getRecords 回傳 records', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' })
        await tx.store.add({ type: 'income', amount: 500, date: '2024-01-02' })
        await tx.done

        const records = await ds.getRecords({ allLedgers: true })
        expect(records).toHaveLength(2)
    })

    it('getAllRecords 回傳所有帳本紀錄', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 100, ledgerId: 1 })
        await tx.store.add({ type: 'income', amount: 500, ledgerId: 2 })
        await tx.done

        const allRecords = await ds.getAllRecords()
        expect(allRecords).toHaveLength(2)
    })
})

describe('DataService — addRecord / getRecords filtering', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    it('addRecord 新增紀錄並回傳 ID', async () => {
        const mockDb = ds.db

        const id = await ds.addRecord({
            type: 'expense',
            amount: 100,
            date: '2024-01-01',
        })
        expect(typeof id).toBe('number')

        const records = await ds.getRecords()
        expect(records).toHaveLength(1)
        expect(records[0].amount).toBe(100)
    })

    it('getRecords 可過濾 type', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' })
        await tx.store.add({ type: 'income', amount: 500, date: '2024-01-02' })
        await tx.done

        const expenses = await ds.getRecords({
            type: 'expense',
            allLedgers: true,
        })
        expect(expenses).toHaveLength(1)
        expect(expenses[0].amount).toBe(100)
    })
})

describe('DataService — Credit Card (Schema v13)', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    describe('addAccount with credit_card type', () => {
        it('新增信用卡帳戶應有正確預設值', async () => {
            const id = await ds.addAccount({
                name: 'Test Credit Card',
                icon: 'fa-credit-card',
                balance: 0,
                type: 'credit_card',
                color: '#ff0000',
            })
            expect(typeof id).toBe('number')

            const account = await ds.getAccount(id)
            expect(account.type).toBe('credit_card')
            expect(account.creditLimit).toBe(0)
            expect(account.statementDay).toBe(25)
            expect(account.dueDay).toBe(15)
        })

        it('信用卡可自訂 creditLimit', async () => {
            const id = await ds.addAccount({
                name: 'Premium Card',
                icon: 'fa-credit-card',
                balance: 0,
                type: 'credit_card',
                creditLimit: 50000,
                statementDay: 20,
                dueDay: 10,
                color: '#00ff00',
            })

            const account = await ds.getAccount(id)
            expect(account.creditLimit).toBe(50000)
            expect(account.statementDay).toBe(20)
            expect(account.dueDay).toBe(10)
        })

        it('普通帳戶不應有信用卡欄位預設值', async () => {
            const id = await ds.addAccount({
                name: '現金',
                icon: 'fa-wallet',
                balance: 1000,
                color: '#0000ff',
            })

            const account = await ds.getAccount(id)
            expect(account.type).toBe('wallet')
            expect(account.creditLimit).toBeUndefined()
        })
    })

    describe('addCreditStatement', () => {
        it('新增信用卡帳單並回傳 ID', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                statementDate: Date.now(),
                dueDate: Date.now() + 86400000 * 15,
                amount: 1000,
                status: 'unpaid',
                recordCount: 5,
                createdAt: Date.now(),
            })
            expect(typeof id).toBe('number')

            const stmt = await ds.getCreditStatement(id)
            expect(stmt).not.toBeNull()
            expect(stmt.amount).toBe(1000)
            expect(stmt.status).toBe('unpaid')
            expect(stmt.period).toBe('2024-06')
        })

        it('新增帳單時自動產生 uuid', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                amount: 500,
                status: 'unpaid',
                createdAt: Date.now(),
            })

            const stmt = await ds.getCreditStatement(id)
            expect(stmt.uuid).toBeDefined()
            expect(stmt.uuid).toHaveLength(36)
        })
    })

    describe('getCreditStatements', () => {
        beforeEach(async () => {
            const mockDb = ds.db
            const tx = mockDb.transaction('credit_statements', 'readwrite')
            await tx.store.add({
                id: 1,
                accountId: 1,
                period: '2024-06',
                amount: 1000,
                status: 'unpaid',
                createdAt: Date.now(),
                ledgerId: 1,
            })
            await tx.store.add({
                id: 2,
                accountId: 1,
                period: '2024-05',
                amount: 500,
                status: 'paid',
                createdAt: Date.now(),
                ledgerId: 1,
            })
            await tx.store.add({
                id: 3,
                accountId: 2,
                period: '2024-06',
                amount: 2000,
                status: 'unpaid',
                createdAt: Date.now(),
                ledgerId: 1,
            })
            await tx.done
            // Set activeLedgerId so the ledger filter works
            ds.activeLedgerId = 1
        })

        it('回傳所有帳單 (allLedgers)', async () => {
            const statements = await ds.getCreditStatements({
                allLedgers: true,
            })
            expect(statements).toHaveLength(3)
        })

        it('可過濾 accountId', async () => {
            const statements = await ds.getCreditStatements({
                accountId: 2,
                allLedgers: true,
            })
            expect(statements).toHaveLength(1)
            expect(statements[0].accountId).toBe(2)
        })

        it('可過濾 status', async () => {
            const unpaid = await ds.getCreditStatements({
                status: 'unpaid',
                allLedgers: true,
            })
            expect(unpaid).toHaveLength(2)
            unpaid.forEach(s => expect(s.status).toBe('unpaid'))
        })

        it('可過濾 period', async () => {
            const june = await ds.getCreditStatements({
                period: '2024-06',
                allLedgers: true,
            })
            expect(june).toHaveLength(2)
            june.forEach(s => expect(s.period).toBe('2024-06'))
        })

        it('多條件過濾', async () => {
            const filtered = await ds.getCreditStatements({
                accountId: 1,
                status: 'unpaid',
                allLedgers: true,
            })
            expect(filtered).toHaveLength(1)
            expect(filtered[0].amount).toBe(1000)
        })

        it('不使用 allLedgers 時只回傳當前帳本', async () => {
            // Add a statement for a different ledger
            const mockDb = ds.db
            const tx = mockDb.transaction('credit_statements', 'readwrite')
            await tx.store.add({
                id: 4,
                accountId: 1,
                period: '2024-07',
                amount: 3000,
                status: 'unpaid',
                createdAt: Date.now(),
                ledgerId: 99,
            })
            await tx.done

            // Without allLedgers, only activeLedgerId (1) should be returned
            const statements = await ds.getCreditStatements({})
            expect(statements).toHaveLength(3) // only ledgerId 1
        })
    })

    describe('updateCreditStatement', () => {
        it('更新帳單狀態為已繳', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                amount: 1000,
                status: 'unpaid',
                createdAt: Date.now(),
            })

            const updated = await ds.updateCreditStatement(id, {
                status: 'paid',
            })
            expect(updated.status).toBe('paid')

            const fetched = await ds.getCreditStatement(id)
            expect(fetched.status).toBe('paid')
        })

        it('更新不存在的帳單拋出錯誤', async () => {
            await expect(
                ds.updateCreditStatement(9999, { status: 'paid' })
            ).rejects.toThrow('Credit statement not found')
        })
    })

    describe('deleteCreditStatement', () => {
        it('刪除帳單', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                amount: 1000,
                status: 'unpaid',
                createdAt: Date.now(),
            })

            const result = await ds.deleteCreditStatement(id)
            expect(result).toBe(true)

            const stmt = await ds.getCreditStatement(id)
            expect(stmt).toBeNull()
        })
    })

    describe('clearAllCreditStatements', () => {
        it('清除所有信用卡帳單', async () => {
            await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                amount: 1000,
                status: 'unpaid',
                createdAt: Date.now(),
            })
            await ds.addCreditStatement({
                accountId: 1,
                period: '2024-05',
                amount: 500,
                status: 'paid',
                createdAt: Date.now(),
            })

            const result = await ds.clearAllCreditStatements()
            expect(result).toBe(true)

            const statements = await ds.getCreditStatements({
                allLedgers: true,
            })
            expect(statements).toHaveLength(0)
        })
    })

    describe('getStatementPeriod', () => {
        it('計算正確的帳單週期', () => {
            const account = { statementDay: 25 }
            const { startDate, endDate } = ds.getStatementPeriod(
                account,
                '2024-06'
            )

            // 6/26 ~ 7/25
            expect(startDate.getFullYear()).toBe(2024)
            expect(startDate.getMonth()).toBe(5) // June (0-indexed)
            expect(startDate.getDate()).toBe(26)

            expect(endDate.getFullYear()).toBe(2024)
            expect(endDate.getMonth()).toBe(6) // July
            expect(endDate.getDate()).toBe(25)
        })

        it('使用預設帳單日 (25)', () => {
            const account = {}
            const { startDate, endDate } = ds.getStatementPeriod(
                account,
                '2024-01'
            )

            // 1/26 ~ 2/25
            expect(startDate.getDate()).toBe(26)
            expect(endDate.getMonth()).toBe(1) // February
        })

        it('跨年帳單週期', () => {
            const account = { statementDay: 25 }
            const { startDate, endDate } = ds.getStatementPeriod(
                account,
                '2024-12'
            )

            expect(startDate.getFullYear()).toBe(2024)
            expect(endDate.getFullYear()).toBe(2025)
        })
    })

    describe('autoGenerateCreditStatements (修正自動產生與截止日邏輯)', () => {
        it('在結帳日前不應提前自動產生帳單，結帳日後則正確自動產生帳單且繳款截止日正確', async () => {
            // 建立一張信用卡：出帳日 25，繳款日 15，額度 50000
            const cardId = await ds.addAccount({
                name: '富邦卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#123456',
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            // 模擬當前時間為 2026-06-20 (小於 25 日，表示 6 月期的帳單(5/26 ~ 6/25) 尚未到期)
            // 最近一個已出帳期別應該是 5 月期(4/26 ~ 5/25)，期別字串 '2026-04'
            const originalDate = globalThis.Date

            // 模擬現在是 2026-06-20
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-06-20T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-06-20T12:00:00').getTime()
                }
            }

            try {
                // 執行自動產生
                await ds.autoGenerateCreditStatements()

                // 2026-06-20 這天，不應該產生 2026-05 的帳單（因為其結束日是 2026-06-25，還沒到！）
                // 此時只能產生 2026-04 期（結束日是 2026-05-25，已過）
                const statements = await ds.getCreditStatements({
                    accountId: cardId,
                    allLedgers: true,
                })
                // 確保只產生了 2026-04 的帳單，沒有 2026-05
                expect(statements.map(s => s.period)).toContain('2026-04')
                expect(statements.map(s => s.period)).not.toContain('2026-05')

                const stmt04 = statements.find(s => s.period === '2026-04')
                // 2026-04 期 (4/26 ~ 5/25) 結帳，繳款日是 6 月 15 日
                const due = new originalDate(stmt04.dueDate)
                expect(due.getFullYear()).toBe(2026)
                expect(due.getMonth()).toBe(5) // 6月 (0-indexed)
                expect(due.getDate()).toBe(15)
            } finally {
                // 還原 Date
                globalThis.Date = originalDate
            }
        })

        it('在結帳日後應自動產生帳單，且計算出正確的下月截止日', async () => {
            const cardId = await ds.addAccount({
                name: '台新卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#abcdef',
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            const originalDate = globalThis.Date

            // 模擬現在是 2026-06-28 (大於 25 日，此時 6 月期(5/26 ~ 6/25) 的帳單應出帳，期別名稱 '2026-05')
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-06-28T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-06-28T12:00:00').getTime()
                }
            }

            try {
                await ds.autoGenerateCreditStatements()

                const statements = await ds.getCreditStatements({
                    accountId: cardId,
                    allLedgers: true,
                })
                // 應包含 2026-05 帳單 (5/26 ~ 6/25 結帳)
                expect(statements.map(s => s.period)).toContain('2026-05')

                const stmt05 = statements.find(s => s.period === '2026-05')
                // 繳款截止日應是結帳日 6/25 的下個月 15 日，即 7 月 15 日
                const due = new originalDate(stmt05.dueDate)
                expect(due.getFullYear()).toBe(2026)
                expect(due.getMonth()).toBe(6) // 7月 (0-indexed)
                expect(due.getDate()).toBe(15)
            } finally {
                globalThis.Date = originalDate
            }
        })
        it('12 月結帳應正確進位至隔年 1 月的繳款日', async () => {
            const cardId = await ds.addAccount({
                name: '跨年測試卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#ff0000',
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            const originalDate = globalThis.Date

            // 模擬現在是 2026-12-28 (大於 25 日，此時 12 月結帳的帳單應出帳，結束日是 12/25)
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-12-28T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-12-28T12:00:00').getTime()
                }
            }

            try {
                await ds.autoGenerateCreditStatements()

                const statements = await ds.getCreditStatements({
                    accountId: cardId,
                    allLedgers: true,
                })
                // 應包含 11 月期 (11/26 ~ 12/25 結帳)
                expect(statements.map(s => s.period)).toContain('2026-11')

                const stmt11 = statements.find(s => s.period === '2026-11')
                // 繳款截止日應是結帳日 12/25 的下個月 15 日，即 2027 年 1 月 15 日
                const due = new originalDate(stmt11.dueDate)
                expect(due.getFullYear()).toBe(2027) // 正確跨年
                expect(due.getMonth()).toBe(0) // 1月 (0-indexed)
                expect(due.getDate()).toBe(15)
            } finally {
                globalThis.Date = originalDate
            }
        })
    })

    describe('calculateCreditCardBalance (結帳日邊界與時區防禦)', () => {
        it('應正確包含結帳日當天的消費，不受 JS 預設 UTC 時區解析的干擾', async () => {
            const cardId = await ds.addAccount({
                name: '時區測試卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#654321',
                ledgerId: 1,
            })

            // 建立該信用卡的消費紀錄
            const tx = ds.db.transaction('records', 'readwrite')
            // 週期 2024-05 為 5/26 ~ 6/25
            // 寫入 6/25 (結帳日當天) 的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-06-25',
                amount: 888,
                type: 'expense',
                ledgerId: 1,
            })
            // 寫入 5/26 (開始日當天) 的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-05-26',
                amount: 112,
                type: 'expense',
                ledgerId: 1,
            })
            // 寫入一個不在週期內的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-06-26',
                amount: 5000,
                type: 'expense',
                ledgerId: 1,
            })
            await tx.done

            const { startDate, endDate } = ds.getStatementPeriod(
                { statementDay: 25 },
                '2024-05'
            )
            // 呼叫計算
            const balance = await ds.calculateCreditCardBalance(
                cardId,
                startDate,
                endDate
            )

            // 應正確加總 888 + 112 = 1000 元
            expect(balance.totalExpense).toBe(1000)
            expect(balance.currentBalance).toBe(1000)
        })
    })

    describe('updateCreditStatementsStatus (FIFO 銷帳邏輯)', () => {
        it('應根據結帳日後還款紀錄自動更新未繳帳單狀態，按 FIFO 順序沖銷', async () => {
            const cardId = await ds.addAccount({
                name: '測試銷帳卡',
                type: 'credit_card',
                statementDay: 25,
                ledgerId: 1,
            })

            // 新增兩筆未繳帳單：2024-05 期 (1000 元) 與 2024-06 期 (2000 元)
            // 2024-05 期出帳日是 2024-06-25，2024-06 期出帳日是 2024-07-25
            const stmt1Id = await ds.addCreditStatement({
                accountId: cardId,
                period: '2024-05',
                statementDate: new Date('2024-06-25').getTime(),
                dueDate: new Date('2024-07-15').getTime(),
                amount: 1000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now(),
            })

            const stmt2Id = await ds.addCreditStatement({
                accountId: cardId,
                period: '2024-06',
                statementDate: new Date('2024-07-25').getTime(),
                dueDate: new Date('2024-08-15').getTime(),
                amount: 2000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now(),
            })

            // 寫入一筆在 2024-06-25 之後的轉帳還款 (1500 元)
            // 這筆 1500 元還款應該能剛好沖銷第一筆 1000 元帳單，剩下 500 元不足以沖銷第二筆 2000 元帳單
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({
                accountId: cardId,
                date: '2024-07-01',
                amount: 1500,
                type: 'income',
                category: 'transfer',
                ledgerId: 1,
            })
            await tx.done

            // 執行銷帳狀態更新
            await ds.updateCreditStatementsStatus()

            // 驗證第一筆帳單狀態變為 paid，第二筆仍為 unpaid
            const stmt1 = await ds.getCreditStatement(stmt1Id)
            const stmt2 = await ds.getCreditStatement(stmt2Id)

            expect(stmt1.status).toBe('paid')
            expect(stmt2.status).toBe('unpaid')
        })
    })

    describe('autoPayCreditStatements (自動扣繳邏輯)', () => {
        it('應於繳款日當天或之後自動從指定扣款帳戶轉帳扣繳卡費，並能隨後被沖銷狀態', async () => {
            // 建立扣款帳戶 (銀行帳戶，初始餘額 10000)
            const bankId = await ds.addAccount({
                name: '扣款銀行帳戶',
                type: 'bank',
                balance: 10000,
                ledgerId: 1,
            })

            // 建立信用卡：設定自動扣款與扣款帳戶
            const cardId = await ds.addAccount({
                name: '自動扣繳信用卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            // 建立一筆未繳帳單： dueDate 為 2026-07-15
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-05',
                statementDate: new Date('2026-06-25').getTime(),
                dueDate: new Date('2026-07-15').getTime(),
                amount: 3000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now(),
            })

            // 模擬當前時間為 2026-07-16 (過了繳款日 7/15)
            const originalDate = globalThis.Date
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-07-16T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-07-16T12:00:00').getTime()
                }
            }

            try {
                // 執行自動扣款
                await ds.autoPayCreditStatements()

                // 驗證是否寫入了轉帳記錄：
                // 1. 銀行帳戶支出 3000
                // 2. 信用卡帳戶收入 3000
                const bankRecords = await ds.db.getAllFromIndex(
                    'records',
                    'accountId',
                    bankId
                )
                const cardRecords = await ds.db.getAllFromIndex(
                    'records',
                    'accountId',
                    cardId
                )

                expect(bankRecords).toHaveLength(1)
                expect(bankRecords[0].type).toBe('expense')
                expect(bankRecords[0].amount).toBe(3000)
                expect(bankRecords[0].category).toBe('transfer')

                expect(cardRecords).toHaveLength(1)
                expect(cardRecords[0].type).toBe('income')
                expect(cardRecords[0].amount).toBe(3000)
                expect(cardRecords[0].category).toBe('transfer')

                // 隨後執行狀態沖銷，驗證帳單是否變為 paid
                await ds.updateCreditStatementsStatus()
                const stmt = await ds.getCreditStatement(stmtId)
                expect(stmt.status).toBe('paid')
            } finally {
                globalThis.Date = originalDate
            }
        })
    })

    describe('deleteAccount (Cascading Delete)', () => {
        it('刪除帳戶時應級聯刪除該帳戶所有的信用卡帳單', async () => {
            const mockDb = ds.db

            // 1. 新增一個帳戶
            const accTx = mockDb.transaction('accounts', 'readwrite')
            await accTx.store.add({ id: 10, name: '信用卡 A', type: 'credit' })
            await accTx.done

            // 2. 為該帳戶新增信用卡帳單
            await ds.addCreditStatement({
                id: 101,
                accountId: 10,
                period: '2024-06',
                amount: 1000,
                status: 'unpaid',
                createdAt: Date.now(),
            })
            await ds.addCreditStatement({
                id: 102,
                accountId: 10,
                period: '2024-05',
                amount: 500,
                status: 'paid',
                createdAt: Date.now(),
            })

            // 驗證原本帳單存在
            let statements = await ds.getCreditStatements({
                accountId: 10,
                allLedgers: true,
            })
            expect(statements).toHaveLength(2)

            // 3. 刪除該帳戶
            await ds.deleteAccount(10)

            // 驗證帳戶已被刪除
            const account = await ds.getAccount(10)
            expect(account).toBeNull()

            // 驗證該帳戶的信用卡帳單也被全部刪除
            statements = await ds.getCreditStatements({
                accountId: 10,
                allLedgers: true,
            })
            expect(statements).toHaveLength(0)
        })
    })

    describe('getRecords (Date Index Query)', () => {
        it('支援 startDate 與 endDate 區間查詢且返回正確的結果', async () => {
            const mockDb = ds.db

            // 寫入一些不同日期的紀錄，使用 add() 回傳的動態 ID 斷言
            const tx = mockDb.transaction('records', 'readwrite')
            const id1 = await tx.store.add({
                date: '2024-06-01',
                amount: 100,
                ledgerId: 1,
            })
            const id2 = await tx.store.add({
                date: '2024-06-15',
                amount: 200,
                ledgerId: 1,
            })
            const id3 = await tx.store.add({
                date: '2024-06-30',
                amount: 300,
                ledgerId: 1,
            })
            const id4 = await tx.store.add({
                date: '2024-07-01',
                amount: 400,
                ledgerId: 1,
            })
            await tx.done

            // 查詢 2024-06-05 到 2024-06-30 之間的記錄
            const records = await ds.getRecords({
                startDate: '2024-06-05',
                endDate: '2024-06-30',
            })
            expect(records).toHaveLength(2)
            expect(records.map(r => r.id)).toContain(id2)
            expect(records.map(r => r.id)).toContain(id3)
        })
    })
})

describe('DataService — settleDebt 欠款結清', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        // 基本聯絡人與帳戶
        ds.db._storeData.contacts.push({ id: 1, name: '測試聯絡人' })
        ds.db._storeData.accounts.push({
            id: 10,
            name: '現金',
            ledgerId: 1,
            uuid: 'acc-uuid-10',
        })
    })

    async function addDebt(debt) {
        ds.db._storeData.debts.push(debt)
    }

    it('純欠款（未連結紀錄）結清會建立還款紀錄並標記已結清', async () => {
        await addDebt({
            id: 1,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-1',
            recordId: null,
            payments: [],
        })

        const result = await ds.settleDebt(1, 1000, { accountId: 10 })

        expect(result.settled).toBe(true)
        expect(result.remainingAmount).toBe(0)

        const records = ds.db._storeData.records
        expect(records).toHaveLength(1)
        expect(records[0].category).toBe('debt_repayment')
        expect(records[0].debtId).toBe(1)
        expect(records[0].ledgerId).toBe(1)
    })

    it('連結欠款結清會建立還款紀錄（預期新行為：雙向跳轉需要 recordId）', async () => {
        ds.db._storeData.records.push({
            id: 5,
            type: 'expense',
            amount: 1000,
            accountId: 10,
            ledgerId: 1,
        })
        await addDebt({
            id: 2,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-2',
            recordId: 5,
            recordUuid: 'rec-uuid-5',
            payments: [],
        })

        const result = await ds.settleDebt(2, 1000, { accountId: 10 })

        expect(result.settled).toBe(true)
        const records = ds.db._storeData.records
        const repayment = records.find(r => r.debtId === 2)
        expect(repayment).toBeDefined()
        expect(repayment.category).toBe('debt_repayment')
        expect(repayment.accountId).toBe(10)
        // 雙向跳轉依賴 payment 帶有 recordId
        expect(result.payments).toHaveLength(1)
        expect(result.payments[0].recordId).toBe(repayment.id)
    })

    it('跨帳戶還款強制建立還款明細並使用還款帳戶', async () => {
        ds.db._storeData.accounts.push({
            id: 20,
            name: '銀行',
            ledgerId: 1,
            uuid: 'acc-uuid-20',
        })
        ds.db._storeData.records.push({
            id: 6,
            type: 'expense',
            amount: 500,
            accountId: 20,
            ledgerId: 1,
        })
        await addDebt({
            id: 3,
            type: 'receivable',
            description: '借出',
            originalAmount: 500,
            remainingAmount: 500,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-3',
            recordId: 6,
            recordUuid: 'rec-uuid-6',
            payments: [],
        })

        const result = await ds.settleDebt(3, 500, { accountId: 10 })

        expect(result.settled).toBe(true)
        const records = ds.db._storeData.records
        const collection = records.find(r => r.debtId === 3)
        expect(collection).toBeDefined()
        expect(collection.category).toBe('debt_collection')
        expect(collection.accountId).toBe(10)
    })
})

describe('DataService — repairOrphanedDebtRecords 完整性修復', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        ds.db._storeData.contacts.push({ id: 1, name: '測試聯絡人' })
        ds.db._storeData.accounts.push({
            id: 10,
            name: '現金',
            ledgerId: 1,
            uuid: 'acc-uuid-10',
        })
    })

    it('為缺少 recordId 的付款補建還款紀錄並回寫 payment', async () => {
        ds.db._storeData.debts.push({
            id: 1,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 500,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-1',
            recordId: null,
            // 模擬操作中斷：付款已寫入，但對應紀錄未建立
            payments: [{ amount: 500, date: '2024-01-01' }],
        })

        const result = await ds.repairOrphanedDebtRecords()

        expect(result.repairedCount).toBe(1)
        const records = ds.db._storeData.records
        expect(records).toHaveLength(1)
        expect(records[0].category).toBe('debt_repayment')
        expect(records[0].debtId).toBe(1)
        expect(records[0].ledgerId).toBe(1)
        expect(records[0].accountId).toBe(10)

        // debt.payments 已回寫 recordId / recordUuid
        const debt = ds.db._storeData.debts[0]
        expect(debt.payments[0].recordId).toBe(records[0].id)
        expect(debt.payments[0].recordUuid).toBe(records[0].uuid)
    })

    it('已完整的付款不會重複建立紀錄（冪等）', async () => {
        ds.db._storeData.records.push({
            id: 99,
            type: 'expense',
            amount: 500,
            accountId: 10,
            ledgerId: 1,
            debtId: 2,
            uuid: 'rec-uuid-99',
        })
        ds.db._storeData.debts.push({
            id: 2,
            type: 'receivable',
            description: '借出',
            originalAmount: 500,
            remainingAmount: 0,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-2',
            recordId: null,
            payments: [
                { amount: 500, date: '2024-01-01', recordId: 99, recordUuid: 'rec-uuid-99' },
            ],
        })

        const result = await ds.repairOrphanedDebtRecords()
        expect(result.repairedCount).toBe(0)
        expect(ds.db._storeData.records).toHaveLength(1)
    })

    it('needsDebtRepair 在存在殘留付款時回傳 true', async () => {
        ds.db._storeData.debts.push({
            id: 3,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-3',
            recordId: null,
            payments: [{ amount: 1000, date: '2024-01-01' }],
        })

        const needs = await ds.needsDebtRepair()
        expect(needs).toBe(true)
    })

    it('修復舊式付款：payment.recordId === debt.recordId 時補建還款紀錄', async () => {
        ds.db._storeData.records.push({
            id: 77,
            type: 'expense',
            amount: 1000,
            accountId: 10,
            ledgerId: 1,
        })
        ds.db._storeData.debts.push({
            id: 4,
            type: 'payable',
            description: '舊版借款',
            originalAmount: 1000,
            remainingAmount: 500,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-4',
            recordId: 77,
            recordUuid: 'rec-uuid-77',
            // 舊版行為：payment 指向原始欠款紀錄，而非獨立的還款明細
            payments: [
                { amount: 500, date: '2024-06-01', recordId: 77, recordUuid: 'rec-uuid-77' },
            ],
        })

        const result = await ds.repairOrphanedDebtRecords()

        expect(result.repairedCount).toBe(1)
        const records = ds.db._storeData.records
        const repayment = records.find(r => r.debtId === 4)
        expect(repayment).toBeDefined()
        expect(repayment.category).toBe('debt_repayment')
        expect(repayment.id).not.toBe(77)

        // payment 已被更新為指向新建立的還款紀錄
        const debt = ds.db._storeData.debts[0]
        expect(debt.payments[0].recordId).toBe(repayment.id)
        expect(debt.payments[0].recordUuid).toBe(repayment.uuid)

        // 冪等：再次執行不重複建立
        const result2 = await ds.repairOrphanedDebtRecords()
        expect(result2.repairedCount).toBe(0)
    })

    it('needsDebtRepair 偵測舊式 payment 回傳 true', async () => {
        ds.db._storeData.records.push({
            id: 88,
            type: 'expense',
            amount: 1000,
            accountId: 10,
            ledgerId: 1,
        })
        ds.db._storeData.debts.push({
            id: 5,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 0,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-5',
            recordId: 88,
            recordUuid: 'rec-uuid-88',
            payments: [
                { amount: 1000, date: '2024-01-01', recordId: 88, recordUuid: 'rec-uuid-88' },
            ],
        })

        expect(await ds.needsDebtRepair()).toBe(true)
    })
})

describe('DataService — Recurring Transactions CRUD', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('addRecurringTransaction 應產生 uuid（若未提供）', async () => {
        const id = await ds.addRecurringTransaction({
            type: 'expense',
            amount: 100,
            frequency: 'monthly',
            interval: 1,
            nextDueDate: '2026-08-01',
        }, true)

        expect(typeof id).toBe('number')

        const tx = ds.db.transaction('recurring_transactions', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.uuid).toBeDefined()
        expect(item.uuid).toHaveLength(36)
    })

    it('addRecurringTransaction 應自動補上 accountUuid（若提供 accountId）', async () => {
        ds.db._storeData.accounts.push({
            id: 50,
            name: '現金',
            uuid: 'acc-uuid-50',
            ledgerId: 1,
        })

        const id = await ds.addRecurringTransaction({
            type: 'expense',
            amount: 200,
            frequency: 'monthly',
            interval: 1,
            nextDueDate: '2026-09-01',
            accountId: 50,
        }, true)

        const tx = ds.db.transaction('recurring_transactions', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.accountUuid).toBe('acc-uuid-50')
    })

    it('addRecurringTransaction 應設定 ledgerId 預設值', async () => {
        const id = await ds.addRecurringTransaction({
            type: 'income',
            amount: 500,
            frequency: 'monthly',
            interval: 1,
            nextDueDate: '2026-09-01',
        }, true)

        const tx = ds.db.transaction('recurring_transactions', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.ledgerId).toBe(1)
    })

    it('updateRecurringTransaction 應更新 accountUuid 當 accountId 改變', async () => {
        ds.db._storeData.accounts.push({
            id: 60,
            name: '銀行',
            uuid: 'acc-uuid-60',
            ledgerId: 1,
        })
        const tx = ds.db.transaction('recurring_transactions', 'readwrite')
        const id = await tx.store.add({
            type: 'expense',
            amount: 300,
            frequency: 'monthly',
            interval: 1,
            nextDueDate: '2026-10-01',
            accountId: null,
            accountUuid: null,
            ledgerId: 1,
            uuid: 'rt-uuid-upd',
        })
        await tx.done

        await ds.updateRecurringTransaction(id, { accountId: 60 }, true)

        const tx2 = ds.db.transaction('recurring_transactions', 'readonly')
        const updated = await tx2.store.get(id)
        await tx2.done

        expect(updated.accountUuid).toBe('acc-uuid-60')
    })

    it('deleteRecurringTransaction 應正確刪除並回傳 true', async () => {
        const tx = ds.db.transaction('recurring_transactions', 'readwrite')
        const id = await tx.store.add({
            type: 'expense',
            amount: 150,
            frequency: 'monthly',
            interval: 1,
            nextDueDate: '2026-11-01',
            ledgerId: 1,
            uuid: 'rt-uuid-del',
        })
        await tx.done

        const result = await ds.deleteRecurringTransaction(id, true)

        expect(result).toBe(true)

        const tx2 = ds.db.transaction('recurring_transactions', 'readonly')
        const deleted = await tx2.store.get(id)
        await tx2.done

        expect(deleted).toBeNull()
    })

    it('getRecurringTransactions 應支援 allLedgers 過濾器', async () => {
        const tx = ds.db.transaction('recurring_transactions', 'readwrite')
        await tx.store.add({
            type: 'expense', amount: 100, frequency: 'monthly', interval: 1,
            nextDueDate: '2026-12-01', ledgerId: 1, uuid: 'rt-uuid-1',
        })
        await tx.store.add({
            type: 'income', amount: 200, frequency: 'monthly', interval: 1,
            nextDueDate: '2026-12-01', ledgerId: 2, uuid: 'rt-uuid-2',
        })
        await tx.done

        const all = await ds.getRecurringTransactions({ allLedgers: true })
        expect(all).toHaveLength(2)

        const filtered = await ds.getRecurringTransactions({})
        expect(filtered).toHaveLength(1)
        expect(filtered[0].ledgerId).toBe(1)
    })
})

// 模擬 FileReader 讀取 JSON 內容，用於測試 importData（不依賴真實檔案）
function stubFileReader(content) {
    const OriginalFileReader = globalThis.FileReader
    globalThis.FileReader = class {
        readAsText() {
            this.result = content
            if (this.onload) this.onload({ target: this })
        }
    }
    return () => {
        globalThis.FileReader = OriginalFileReader
    }
}

describe('DataService — importData (匯入) groupMeta ID 處理', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    afterEach(() => {
        // stubFileReader 的回復函式在每個測試內呼叫
    })

    it('匯入時 groupMeta 保留原始 ID（keyPath: id，非 autoIncrement）', async () => {
        // 開始時無任何紀錄，故不會觸發 customConfirm
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
            },
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '原帳本', uuid: 'ledger-uuid-1' }],
            records: [
                {
                    id: 10,
                    type: 'expense',
                    amount: 100,
                    date: '2024-01-01',
                    category: '餐飲',
                    ledgerId: 1,
                    uuid: 'rec-uuid-1',
                },
            ],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [
                { id: 'gm-1', name: '群組A', ledgerId: 1, uuid: 'gm-uuid-1' },
            ],
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })

            expect(result.success).toBe(true)

            // 帳本被重新指派 ID，activeLedgerId 指向新帳本
            const ledgers = await ds.getLedgers()
            expect(ledgers).toHaveLength(1)
            const newLedgerId = ledgers[0].id
            expect(ds.activeLedgerId).toBe(newLedgerId)

            // 關鍵：groupMeta 應保留原始 id 'gm-1'，不會被重新指派
            const gm = await ds.getGroupMeta('gm-1')
            expect(gm).not.toBeNull()
            expect(gm.id).toBe('gm-1')
            expect(gm.name).toBe('群組A')
            expect(gm.uuid).toBe('gm-uuid-1')
            // ledgerId 需對應至新帳本 ID
            expect(gm.ledgerId).toBe(newLedgerId)

            // 紀錄：id 重新產生（不再是 10），uuid 保留，ledgerId 對應新帳本
            const records = await ds.getRecords({ allLedgers: true })
            expect(records).toHaveLength(1)
            expect(records[0].id).not.toBe(10)
            expect(records[0].uuid).toBe('rec-uuid-1')
            expect(records[0].ledgerId).toBe(newLedgerId)
        } finally {
            restore()
        }
    })

    it('匯入時 groupMeta 無 uuid 會自動產生', async () => {
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
            },
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '原帳本', uuid: 'ledger-uuid-1' }],
            records: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [{ id: 'gm-2', name: '無UUID群組', ledgerId: 1 }],
        })
        const restore = stubFileReader(json)

        try {
            await ds.importData({ name: 'backup.json' })

            const gm = await ds.getGroupMeta('gm-2')
            expect(gm).not.toBeNull()
            expect(gm.id).toBe('gm-2')
            expect(gm.uuid).toBeDefined()
            expect(gm.uuid).toHaveLength(36)
        } finally {
            restore()
        }
    })

    it('匯入後 records 與 groupMeta 的 ledgerId 一致（ID 重新對映）', async () => {
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
            },
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '工作帳本', uuid: 'ledger-uuid-2' }],
            records: [
                {
                    id: 20,
                    type: 'expense',
                    amount: 250,
                    date: '2024-02-01',
                    category: '交通',
                    ledgerId: 1,
                    uuid: 'rec-uuid-2',
                },
            ],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [
                { id: 'gm-3', name: '公款', ledgerId: 1, uuid: 'gm-uuid-3' },
            ],
        })
        const restore = stubFileReader(json)

        try {
            await ds.importData({ name: 'backup.json' })

            const gm = await ds.getGroupMeta('gm-3')
            const records = await ds.getRecords({ allLedgers: true })
            // 兩者皆應指向匯入後重新對映的同一帳本
            expect(gm.ledgerId).toBe(records[0].ledgerId)
            expect(gm.ledgerId).toBe(ds.activeLedgerId)
        } finally {
            restore()
        }
    })
})

describe('DataService — 匯出/備份結構完整性', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('_exportFullBackup 包含 groupMeta store', async () => {
        await ds.saveGroupMeta({ id: 'gx-1', name: '備份群組', ledgerId: 1 })

        const backup = await ds._exportFullBackup()

        expect(backup.groupMeta).toBeDefined()
        expect(backup.groupMeta).toHaveLength(1)
        expect(backup.groupMeta[0].id).toBe('gx-1')
    })

    it('_exportFullBackup 包含所有核心 store 與 _settings', async () => {
        const tx = ds.db.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 50, date: '2024-01-01' })
        await tx.done
        localStorage.setItem('easy_accounting_custom_key', 'abc')

        const backup = await ds._exportFullBackup()

        expect(backup.records).toHaveLength(1)
        expect(backup.ledgers).toEqual([])
        expect(backup.accounts).toEqual([])
        expect(backup.contacts).toEqual([])
        expect(backup.debts).toEqual([])
        expect(backup.recurring_transactions).toEqual([])
        expect(backup.amortizations).toEqual([])
        expect(backup.credit_statements).toEqual([])
        expect(backup.groupMeta).toEqual([])
        expect(backup._settings['easy_accounting_custom_key']).toBe('abc')
    })

    it('_restoreFromBackup 還原 groupMeta 時保留原始 id', async () => {
        await ds.saveGroupMeta({ id: 'gkeep', name: '保留群組', ledgerId: 1 })

        const backup = await ds._exportFullBackup()

        // 模擬先清空再還原
        await ds._restoreFromBackup(backup)

        const restored = await ds.getGroupMeta('gkeep')
        expect(restored).not.toBeNull()
        expect(restored.id).toBe('gkeep')
        expect(restored.name).toBe('保留群組')
    })

    it('_restoreFromBackup 還原 records 時重新指派 ID 但保留 uuid', async () => {
        const backup = {
            records: [
                {
                    id: 999,
                    type: 'expense',
                    amount: 300,
                    date: '2024-03-01',
                    category: '餐飲',
                    uuid: 'backup-rec-uuid',
                    ledgerId: 1,
                },
            ],
            ledgers: [],
            accounts: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [],
        }

        await ds._restoreFromBackup(backup)

        const records = await ds.getRecords({ allLedgers: true })
        expect(records).toHaveLength(1)
        expect(records[0].id).not.toBe(999)
        expect(records[0].uuid).toBe('backup-rec-uuid')
    })
})

describe('DataService — 帳本切換與邊界情境', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('setActiveLedger 更新 activeLedgerId 並寫入 localStorage', () => {
        ds.setActiveLedger(3)
        expect(ds.activeLedgerId).toBe(3)
        expect(localStorage.getItem('activeLedgerId')).toBe('3')
    })

    it('addLedger 使用預設 icon / color / type', async () => {
        const id = await ds.addLedger({ name: '新帳本' })
        const ledger = await ds.getLedger(id)
        expect(ledger.icon).toBe('fa-solid fa-book')
        expect(ledger.color).toBe('#334A52')
        expect(ledger.type).toBe('personal')
        expect(ledger.uuid).toBeDefined()
    })

    it('updateLedger 更新不存在的帳本時拋錯', async () => {
        await expect(ds.updateLedger(999, { name: 'X' })).rejects.toThrow(
            'Ledger not found'
        )
    })

    it('deleteLedger 不可刪除預設帳本 (id=1)', async () => {
        await expect(ds.deleteLedger(1)).rejects.toThrow('不可刪除預設帳本')
    })

    it('deleteLedger 連帶刪除該帳本的紀錄與帳戶', async () => {
        // 準備帳本 2 的資料
        ds.db._storeData.ledgers.push({ id: 2, name: '帳本二', uuid: 'l2' })
        ds.db._storeData.records.push({
            id: 1,
            type: 'expense',
            amount: 100,
            ledgerId: 2,
        })
        ds.db._storeData.records.push({
            id: 2,
            type: 'expense',
            amount: 50,
            ledgerId: 1,
        })
        ds.db._storeData.accounts.push({
            id: 1,
            name: '帳本二帳戶',
            ledgerId: 2,
        })
        ds.db._storeData.accounts.push({
            id: 2,
            name: '帳本一帳戶',
            ledgerId: 1,
        })

        await ds.deleteLedger(2)

        // 帳本 2 的資料被清除，帳本 1 的資料保留
        const records = await ds.getRecords({ allLedgers: true })
        expect(records).toHaveLength(1)
        expect(records[0].ledgerId).toBe(1)
        const accounts = await ds.getAccounts({ allLedgers: true })
        expect(accounts).toHaveLength(1)
        expect(accounts[0].ledgerId).toBe(1)
    })

    it('刪除目前使用的帳本後自動切回預設帳本', async () => {
        ds.db._storeData.ledgers.push({ id: 5, name: '進行中帳本', uuid: 'l5' })
        ds.setActiveLedger(5)

        await ds.deleteLedger(5)

        expect(ds.activeLedgerId).toBe(1)
        expect(localStorage.getItem('activeLedgerId')).toBe('1')
    })
})

describe('DataService — 帳戶 CRUD 驗證', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('addAccount 未指定 type 時預設為 wallet', async () => {
        const id = await ds.addAccount({ name: '現金' })
        const account = await ds.getAccount(id)
        expect(account.type).toBe('wallet')
    })

    it('addAccount 自動產生 uuid', async () => {
        const id = await ds.addAccount({ name: '測試帳戶' })
        const account = await ds.getAccount(id)
        expect(account.uuid).toBeDefined()
        expect(account.uuid).toHaveLength(36)
    })

    it('updateAccount 更新不存在的帳戶時拋錯', async () => {
        await expect(ds.updateAccount(999, { name: 'X' })).rejects.toThrow(
            'Account not found'
        )
    })

    it('updateAccount 在 skipLog 模式鎖定 uuid 不被覆寫', async () => {
        const id = await ds.addAccount({ name: '原帳戶', uuid: 'acc-uuid-1' })
        await ds.updateAccount(
            id,
            { name: '新帳戶', uuid: 'tampered-uuid' },
            true
        )
        const account = await ds.getAccount(id)
        expect(account.name).toBe('新帳戶')
        expect(account.uuid).toBe('acc-uuid-1')
    })

    it('deleteAccount 刪除不存在的帳戶不會拋錯', async () => {
        const result = await ds.deleteAccount(9999)
        expect(result).toBe(true)
    })
})

describe('DataService — 重複紀錄預防與 UUID 去重', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('addRecord 未提供 uuid 時自動產生唯一 uuid', async () => {
        const id1 = await ds.addRecord({
            type: 'expense',
            amount: 100,
            date: '2024-01-01',
        })
        const id2 = await ds.addRecord({
            type: 'expense',
            amount: 200,
            date: '2024-01-02',
        })

        const r1 = await ds.getRecord(id1)
        const r2 = await ds.getRecord(id2)
        expect(r1.uuid).toBeDefined()
        expect(r2.uuid).toBeDefined()
        expect(r1.uuid).not.toBe(r2.uuid)
    })

    it('addRecord 保留呼叫端提供的 uuid（用於同步去重）', async () => {
        const id = await ds.addRecord({
            type: 'expense',
            amount: 300,
            date: '2024-01-03',
            uuid: 'provided-uuid',
        })
        const record = await ds.getRecord(id)
        expect(record.uuid).toBe('provided-uuid')
    })

    it('getByUUID 可依 uuid 找到紀錄', async () => {
        await ds.addRecord({
            type: 'expense',
            amount: 400,
            date: '2024-01-04',
            uuid: 'findable-uuid',
        })
        const found = await ds.getByUUID('records', 'findable-uuid')
        expect(found).not.toBeNull()
        expect(found.uuid).toBe('findable-uuid')
    })

    it('getByUUID 找不到時回傳 null', async () => {
        const found = await ds.getByUUID('records', 'nonexistent-uuid')
        expect(found).toBeNull()
    })

    it('_restoreFromBackup 保留 uuid 供跨裝置去重', async () => {
        const backup = {
            records: [
                {
                    id: 123,
                    type: 'expense',
                    amount: 500,
                    date: '2024-05-01',
                    category: '其他',
                    uuid: 'restored-uuid',
                    ledgerId: 1,
                },
            ],
            ledgers: [],
            accounts: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [],
        }

        await ds._restoreFromBackup(backup)

        const found = await ds.getByUUID('records', 'restored-uuid')
        expect(found).not.toBeNull()
    })
})

describe('DataService — logChange 外鍵補全', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        ds.db._storeData.ledgers.push({
            id: 1,
            name: '預設帳本',
            uuid: 'ledger-uuid-1',
        })
        ds.db._storeData.accounts.push({
            id: 70,
            name: '信用卡',
            uuid: 'acc-uuid-70',
            ledgerId: 1,
        })
    })

    it('logChange 對 recurring_transactions 應自動補全 accountUuid', async () => {
        await ds.logChange('add', 'recurring_transactions', 99, {
            accountId: 70,
            ledgerId: 1,
        })

        const syncLog = ds.db._storeData['sync_log'] || []
        expect(syncLog).toHaveLength(1)
        expect(syncLog[0].data.accountUuid).toBe('acc-uuid-70')
    })

    it('logChange 對 recurring_transactions 應自動補全 ledgerUuid', async () => {
        await ds.logChange('add', 'recurring_transactions', 99, {
            ledgerId: 1,
        })

        const syncLog = ds.db._storeData['sync_log'] || []
        expect(syncLog).toHaveLength(1)
        expect(syncLog[0].data.ledgerUuid).toBe('ledger-uuid-1')
    })
})

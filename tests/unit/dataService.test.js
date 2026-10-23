import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataService from '../../src/js/dataService.js'

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
            // 確保所有 store 都是空的（beforeEach 已清理）
            clearMockData()

            const backup = await ds._exportFullBackup()

            expect(backup.records).toEqual([])
            expect(backup.accounts).toEqual([])
        })

        it('備份包含 settings store（預算設定含忽略的類別）', async () => {
            const mockDb = ds.db

            // 寫入預算設定（含 excludedBudgetCategories「忽略的類別」）
            const budgetPayload = {
                monthlyBudget: 10000,
                categoryBudgets: { food: 3000, transport: 1500 },
                categoryBudgetOrder: ['food', 'transport'],
                excludedBudgetCategories: ['transfer', 'investment'],
            }
            const tx = mockDb.transaction('settings', 'readwrite')
            await tx.store.put({
                key: 'budget_settings_1',
                value: budgetPayload,
            })
            await tx.store.put({ key: 'advancedAccountModeEnabled', value: true })
            await tx.done

            const backup = await ds._exportFullBackup()

            expect(backup.settings).toBeDefined()
            const budgetSetting = backup.settings.find(
                s => s.key === 'budget_settings_1'
            )
            expect(budgetSetting).toBeDefined()
            expect(budgetSetting.value).toEqual(budgetPayload)
            expect(budgetSetting.value.excludedBudgetCategories).toEqual([
                'transfer',
                'investment',
            ])
            // 其他設定也要一併備份
            expect(
                backup.settings.some(s => s.key === 'advancedAccountModeEnabled')
            ).toBe(true)
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

        it('匯入失敗還原後，預算設定（含忽略的類別）完整存活', async () => {
            const mockDb = ds.db

            // 1) 匯入前：DB 裡有原本的預算設定
            const originalBudget = {
                monthlyBudget: 20000,
                categoryBudgets: { food: 5000 },
                categoryBudgetOrder: ['food'],
                excludedBudgetCategories: ['salary'],
            }
            const tx1 = mockDb.transaction('settings', 'readwrite')
            await tx1.store.put({
                key: 'budget_settings_1',
                value: originalBudget,
            })
            await tx1.done

            // 2) 建立快照（importData 流程的 _exportFullBackup）
            const backup = await ds._exportFullBackup()

            // 3) 模擬「匯入失敗」：匯入檔覆寫了預算設定（新的、錯誤的值）
            const tx2 = mockDb.transaction('settings', 'readwrite')
            await tx2.store.put({
                key: 'budget_settings_1',
                value: {
                    monthlyBudget: 1,
                    categoryBudgets: {},
                    categoryBudgetOrder: [],
                    excludedBudgetCategories: [],
                },
            })
            await tx2.done

            // 4) 自動還原（_restoreFromBackup）
            await ds._restoreFromBackup(backup)

            // 5) 驗證原預算設定被完整救回（put 保留原 key）
            const restored = await mockDb.get('settings', 'budget_settings_1')
            expect(restored).toBeDefined()
            expect(restored.value).toEqual(originalBudget)
            expect(restored.value.excludedBudgetCategories).toEqual(['salary'])
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

    it('getRecords 正確按日期降序、timestamp 降序、ID 降序排序，缺少 timestamp 不會導致排序損毀', async () => {
        const mockDb = ds.db

        const tx = mockDb.transaction('records', 'readwrite')
        // 舊紀錄 (無 timestamp)
        await tx.store.add({ type: 'expense', amount: 100, date: '2026-08-01' })
        await tx.store.add({ type: 'expense', amount: 200, date: '2026-08-02' })
        // 新紀錄 (有 timestamp，當天新增)
        await tx.store.add({ type: 'expense', amount: 300, date: '2026-08-03', timestamp: 1000 })
        await tx.store.add({ type: 'expense', amount: 400, date: '2026-08-03', timestamp: 2000 })
        await tx.done

        const records = await ds.getRecords({ allLedgers: true })
        expect(records).toHaveLength(4)
        // 第一筆應為最新日期 2026-08-03 且 timestamp 較大的 400
        expect(records[0].amount).toBe(400)
        expect(records[1].amount).toBe(300)
        expect(records[2].amount).toBe(200)
        expect(records[3].amount).toBe(100)
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

        it('31 日出帳遇平年 2 月：結束日收斂到 2/28 不溢出到 3 月', () => {
            // 修復前：new Date(2026, 1, 31) → 2026-03-03，整個帳單週期錯開
            const { startDate, endDate } = ds.getStatementPeriod(
                { statementDay: 31 },
                '2026-01'
            )
            // '2026-01'：起 = 1 月的 31 日隔天 → 2/1；訖 = 2 月的出帳日收斂 2/28
            expect(startDate.getFullYear()).toBe(2026)
            expect(startDate.getMonth()).toBe(1) // 2月
            expect(startDate.getDate()).toBe(1)
            expect(endDate.getMonth()).toBe(1) // 仍在 2 月（修復前會溢出到 3 月）
            expect(endDate.getDate()).toBe(28)
        })

        it('31 日出帳遇閏年 2 月：結束日收斂到 2/29', () => {
            const { endDate } = ds.getStatementPeriod(
                { statementDay: 31 },
                '2028-01'
            )
            expect(endDate.getFullYear()).toBe(2028)
            expect(endDate.getMonth()).toBe(1)
            expect(endDate.getDate()).toBe(29)
        })

        it('31 日出帳遇小月（6 月結帳）：結束日收斂到 6/30', () => {
            // '2026-05'：訖 = 6 月的 31 日 → 收斂 6/30
            const { startDate, endDate } = ds.getStatementPeriod(
                { statementDay: 31 },
                '2026-05'
            )
            // 起 = 5 月 31 日隔天 → 6/1
            expect(startDate.getMonth()).toBe(5)
            expect(startDate.getDate()).toBe(1)
            expect(endDate.getMonth()).toBe(5) // 6月
            expect(endDate.getDate()).toBe(30)
        })

        it('月底收斂不影響一般出帳日（25 日）的既有週期', () => {
            const { startDate, endDate } = ds.getStatementPeriod(
                { statementDay: 25 },
                '2026-06'
            )
            expect(startDate.getMonth()).toBe(5) // 6/26
            expect(startDate.getDate()).toBe(26)
            expect(endDate.getMonth()).toBe(6) // 7/25
            expect(endDate.getDate()).toBe(25)
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

        it('長時間未開 app 後再啟動，應逐期補生成中間漏掉的已結帳期別', async () => {
            const cardId = await ds.addAccount({
                name: '出差補帳卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            // 既有帳單只到 2026-04 期（上次開 app 是 5 月底）
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-04',
                statementDate: new Date('2026-05-25').getTime(),
                dueDate: new Date('2026-06-15').getTime(),
                amount: 1000,
                status: 'paid',
                ledgerId: 1,
                createdAt: Date.now(),
            })

            const originalDate = globalThis.Date
            // 模擬現在是 2026-08-28（已錯過 05/06/07 三期出帳）
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-08-28T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-08-28T12:00:00').getTime()
                }
            }

            try {
                await ds.autoGenerateCreditStatements()

                const periods = (
                    await ds.getCreditStatements({
                        accountId: cardId,
                        allLedgers: true,
                    })
                )
                    .map(s => s.period)
                    .sort()
                // 舊版只補最近一期 2026-07，漏掉 05/06；新版逐期補齊 05/06/07
                expect(periods).toEqual(
                    expect.arrayContaining([
                        '2026-04',
                        '2026-05',
                        '2026-06',
                        '2026-07',
                    ])
                )
            } finally {
                globalThis.Date = originalDate
            }
        })

        it('全新無帳單的卡只補最近一期，不回填全部歷史', async () => {
            const cardId = await ds.addAccount({
                name: '新卡只補一期',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            const originalDate = globalThis.Date
            // 卡是今天建的，但已有三年消費紀錄也不該回填三年帳單
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-08-28T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-08-28T12:00:00').getTime()
                }
            }

            try {
                await ds.autoGenerateCreditStatements()
                const periods = (
                    await ds.getCreditStatements({
                        accountId: cardId,
                        allLedgers: true,
                    })
                ).map(s => s.period)
                // 僅一筆：最近已結帳期 2026-07
                expect(periods).toEqual(['2026-07'])
            } finally {
                globalThis.Date = originalDate
            }
        })

        it('既有帳單落後超過 24 期時，只補最近 24 期（不無限回填）', async () => {
            const cardId = await ds.addAccount({
                name: '舊卡重啟',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                ledgerId: 1,
            })
            ds.activeLedgerId = 1

            // 既有帳單停在 2022-01 期（三年前）
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2022-01',
                statementDate: new Date('2022-02-25').getTime(),
                dueDate: new Date('2022-03-15').getTime(),
                amount: 100,
                status: 'paid',
                ledgerId: 1,
                createdAt: Date.now(),
            })

            const originalDate = globalThis.Date
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-08-28T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-08-28T12:00:00').getTime()
                }
            }

            try {
                await ds.autoGenerateCreditStatements()
                const periods = (
                    await ds.getCreditStatements({
                        accountId: cardId,
                        allLedgers: true,
                    })
                )
                    .map(s => s.period)
                    .sort()
                // 2022-01 之後有 55 個月差距，只補最近 24 期（至 2026-07 為止）
                expect(periods.length).toBe(1 + 24) // 既有 1 筆 + 補 24 筆
                expect(periods.at(-1)).toBe('2026-07')
                expect(periods.at(1)).toBe('2024-08') // 2026-07 往前數第 24 期
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

            // 驗證第一筆帳單狀態變為 paid，第二筆為 partial（已分配 500/2000）
            // （舊版第二筆直接留 unpaid——部分繳款痕跡遺失，繳款 UI 重複提示全額、
            //  自動扣繳再次全額扣款；新語意以 partial + paidAmount 如實反映）
            const stmt1 = await ds.getCreditStatement(stmt1Id)
            const stmt2 = await ds.getCreditStatement(stmt2Id)

            expect(stmt1.status).toBe('paid')
            expect(stmt1.paidAmount).toBe(1000)
            expect(stmt2.status).toBe('partial')
            expect(stmt2.paidAmount).toBe(500)
        })

        it('冪等性：重複執行銷帳不重複計入、狀態不震盪', async () => {
            const cardId = await ds.addAccount({
                name: '冪等銷帳卡',
                type: 'credit_card',
                statementDay: 25,
                ledgerId: 1,
            })
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2024-05',
                statementDate: new Date('2024-06-25').getTime(),
                dueDate: new Date('2024-07-15').getTime(),
                amount: 2000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now(),
            })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({
                accountId: cardId,
                date: '2024-07-01',
                amount: 500,
                type: 'income',
                category: 'transfer',
                ledgerId: 1,
            })
            await tx.done

            await ds.updateCreditStatementsStatus()
            const first = await ds.getCreditStatement(stmtId)
            expect(first.status).toBe('partial')
            expect(first.paidAmount).toBe(500)

            // 再跑三次：partial 狀態與金額必須穩定（不因已轉 partial 而基準漂移）
            await ds.updateCreditStatementsStatus()
            await ds.updateCreditStatementsStatus()
            await ds.updateCreditStatementsStatus()
            const stable = await ds.getCreditStatement(stmtId)
            expect(stable.status).toBe('partial')
            expect(stable.paidAmount).toBe(500)
        })

        it('partial 帳單後續補足額還款 → 升級為 paid，且 partial 保持沖銷基準', async () => {
            const cardId = await ds.addAccount({
                name: '補足銷帳卡',
                type: 'credit_card',
                statementDay: 25,
                ledgerId: 1,
            })
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2024-05',
                statementDate: new Date('2024-06-25').getTime(),
                dueDate: new Date('2024-07-15').getTime(),
                amount: 2000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now(),
            })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({
                accountId: cardId,
                date: '2024-07-01',
                amount: 500,
                type: 'income',
                category: 'transfer',
                ledgerId: 1,
            })
            await tx.done
            await ds.updateCreditStatementsStatus()
            expect((await ds.getCreditStatement(stmtId)).status).toBe(
                'partial'
            )

            // 補一筆 1500 還款（視窗視同一張 partial 帳單出帳日，總計 2000 足額）
            const tx2 = ds.db.transaction('records', 'readwrite')
            await tx2.store.add({
                accountId: cardId,
                date: '2024-07-10',
                amount: 1500,
                type: 'income',
                category: 'transfer',
                ledgerId: 1,
            })
            await tx2.done
            await ds.updateCreditStatementsStatus()

            const paid = await ds.getCreditStatement(stmtId)
            expect(paid.status).toBe('paid')
            expect(paid.paidAmount).toBe(2000)
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
                expect(bankRecords[0].category).toBe('debt_repayment')

                expect(cardRecords).toHaveLength(1)
                expect(cardRecords[0].type).toBe('income')
                expect(cardRecords[0].amount).toBe(3000)
                expect(cardRecords[0].category).toBe('debt_repayment')

                // 隨後執行狀態沖銷，驗證帳單是否變為 paid
                await ds.updateCreditStatementsStatus()
                const stmt = await ds.getCreditStatement(stmtId)
                expect(stmt.status).toBe('paid')
            } finally {
                globalThis.Date = originalDate
            }
        })

        it('partial 帳單到期只扣剩額（帳單額 − 已繳），不重複全額扣款', async () => {
            const bankId = await ds.addAccount({
                name: '剩額扣繳銀行',
                type: 'bank',
                balance: 10000,
                ledgerId: 1,
            })
            const cardId = await ds.addAccount({
                name: '剩額扣繳卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })
            // 帳單 3000，已手動繳 1000（partial）
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-05',
                statementDate: new Date('2026-06-25').getTime(),
                dueDate: new Date('2026-07-15').getTime(),
                amount: 3000,
                status: 'partial',
                paidAmount: 1000,
                ledgerId: 1,
                createdAt: Date.now(),
            })

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
                await ds.autoPayCreditStatements()
                const bankRecords = await ds.db.getAllFromIndex(
                    'records',
                    'accountId',
                    bankId
                )
                // 舊版按全額 3000 扣款（重複扣繳）；新版只扣剩額 2000
                expect(bankRecords).toHaveLength(1)
                expect(bankRecords[0].amount).toBe(2000)
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
            await tx.store.add({
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
            await tx.store.add({
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

describe('DataService — resolveDefaultSettleAccountId 還款預設帳戶', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    function addAccount(acc) {
        ds.db._storeData.accounts.push(acc)
    }

    it('偏好帳戶非信用卡時直接沿用', async () => {
        addAccount({ id: 10, name: '現金', ledgerId: 1, uuid: 'a10' })
        addAccount({
            id: 20,
            name: '銀行',
            type: 'bank',
            ledgerId: 1,
            uuid: 'a20',
        })

        await expect(ds.resolveDefaultSettleAccountId(20)).resolves.toBe(20)
        // 無偏好時：回現金帳戶
        await expect(ds.resolveDefaultSettleAccountId(null)).resolves.toBe(10)
    })

    it('偏好帳戶為信用卡且有自動扣繳帳戶時轉導到扣繳帳戶', async () => {
        addAccount({ id: 10, name: '現金', ledgerId: 1, uuid: 'a10' })
        addAccount({
            id: 20,
            name: '扣款銀行',
            type: 'bank',
            ledgerId: 1,
            uuid: 'a20',
        })
        addAccount({
            id: 30,
            name: '信用卡',
            type: 'credit_card',
            autoPayAccountId: 20,
            ledgerId: 1,
            uuid: 'a30',
        })

        await expect(ds.resolveDefaultSettleAccountId(30)).resolves.toBe(20)
    })

    it('偏好帳戶為信用卡且無自動扣繳時預設現金帳戶', async () => {
        addAccount({ id: 10, name: '現金', ledgerId: 1, uuid: 'a10' })
        addAccount({
            id: 20,
            name: '銀行',
            type: 'bank',
            ledgerId: 1,
            uuid: 'a20',
        })
        addAccount({
            id: 30,
            name: '信用卡',
            type: 'credit_card',
            ledgerId: 1,
            uuid: 'a30',
        })

        await expect(ds.resolveDefaultSettleAccountId(30)).resolves.toBe(10)
    })

    it('無現金帳戶時兜底第一非信用卡帳戶', async () => {
        addAccount({
            id: 20,
            name: '銀行',
            type: 'bank',
            ledgerId: 1,
            uuid: 'a20',
        })
        addAccount({
            id: 30,
            name: '信用卡',
            type: 'credit_card',
            ledgerId: 1,
            uuid: 'a30',
        })

        await expect(ds.resolveDefaultSettleAccountId(30)).resolves.toBe(20)
    })

    it('僅有信用卡時回傳 null（不強塞信用卡）', async () => {
        addAccount({
            id: 30,
            name: '信用卡',
            type: 'credit_card',
            ledgerId: 1,
            uuid: 'a30',
        })

        await expect(ds.resolveDefaultSettleAccountId(30)).resolves.toBeNull()
        await expect(ds.resolveDefaultSettleAccountId(null)).resolves.toBeNull()
    })

    it('無任何帳戶時回傳 null', async () => {
        await expect(ds.resolveDefaultSettleAccountId(null)).resolves.toBeNull()
    })
})

describe('DataService — settleDebt 信用卡還款轉導', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        ds.db._storeData.contacts.push({ id: 1, name: '測試聯絡人' })
    })

    it('原始紀錄為信用卡（有自動扣繳）：未指定帳戶時還款落到扣繳帳戶', async () => {
        ds.db._storeData.accounts.push(
            { id: 10, name: '現金', ledgerId: 1, uuid: 'acc-10' },
            {
                id: 20,
                name: '扣款銀行',
                type: 'bank',
                ledgerId: 1,
                uuid: 'acc-20',
            },
            {
                id: 30,
                name: '信用卡',
                type: 'credit_card',
                autoPayAccountId: 20,
                ledgerId: 1,
                uuid: 'acc-30',
            },
        )
        // 原始刷卡紀錄（欠款關聯到此）
        ds.db._storeData.records.push({
            id: 5,
            type: 'expense',
            amount: 1000,
            accountId: 30,
            ledgerId: 1,
        })
        ds.db._storeData.debts.push({
            id: 1,
            type: 'payable',
            description: '刷卡代墊',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-cc-1',
            recordId: 5,
            recordUuid: 'rec-cc-5',
            payments: [],
        })

        // 未指定 accountId（走 fallback）
        const result = await ds.settleDebt(1)

        expect(result.settled).toBe(true)
        const repayment = ds.db._storeData.records.find(
            r => r.debtId === 1 && r.category === 'debt_repayment',
        )
        expect(repayment).toBeDefined()
        // 不落入信用卡，落到自動扣繳帳戶（銀行）
        expect(repayment.accountId).toBe(20)
    })

    it('原始紀錄為信用卡（無自動扣繳）：未指定帳戶時還款落到現金', async () => {
        ds.db._storeData.accounts.push(
            { id: 10, name: '現金', ledgerId: 1, uuid: 'acc-10' },
            {
                id: 30,
                name: '信用卡',
                type: 'credit_card',
                ledgerId: 1,
                uuid: 'acc-30',
            },
        )
        ds.db._storeData.records.push({
            id: 6,
            type: 'expense',
            amount: 500,
            accountId: 30,
            ledgerId: 1,
        })
        ds.db._storeData.debts.push({
            id: 2,
            type: 'payable',
            description: '刷卡代墊',
            originalAmount: 500,
            remainingAmount: 500,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-cc-2',
            recordId: 6,
            recordUuid: 'rec-cc-6',
            payments: [],
        })

        const result = await ds.settleDebt(2)

        expect(result.settled).toBe(true)
        const repayment = ds.db._storeData.records.find(
            r => r.debtId === 2 && r.category === 'debt_repayment',
        )
        expect(repayment).toBeDefined()
        expect(repayment.accountId).toBe(10)
    })

    it('明確指定帳戶時仍依使用者選擇（不轉導）', async () => {
        ds.db._storeData.accounts.push(
            { id: 10, name: '現金', ledgerId: 1, uuid: 'acc-10' },
            {
                id: 20,
                name: '銀行',
                type: 'bank',
                ledgerId: 1,
                uuid: 'acc-20',
            },
            {
                id: 30,
                name: '信用卡',
                type: 'credit_card',
                autoPayAccountId: 10,
                ledgerId: 1,
                uuid: 'acc-30',
            },
        )
        ds.db._storeData.records.push({
            id: 7,
            type: 'expense',
            amount: 300,
            accountId: 30,
            ledgerId: 1,
        })
        ds.db._storeData.debts.push({
            id: 3,
            type: 'payable',
            description: '刷卡代墊',
            originalAmount: 300,
            remainingAmount: 300,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-cc-3',
            recordId: 7,
            recordUuid: 'rec-cc-7',
            payments: [],
        })

        // 使用者明確選銀行（非信用卡）
        const result = await ds.settleDebt(3, null, { accountId: 20 })

        expect(result.settled).toBe(true)
        const repayment = ds.db._storeData.records.find(
            r => r.debtId === 3 && r.category === 'debt_repayment',
        )
        expect(repayment).toBeDefined()
        expect(repayment.accountId).toBe(20)
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

    it('補建紀錄帶入預先解析的 accountUuid / debtUuid（免 addRecord 逐筆重查）', async () => {
        ds.db._storeData.debts.push({
            id: 6,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-6',
            recordId: null,
            payments: [{ amount: 1000, date: '2024-01-01' }],
        })

        await ds.repairOrphanedDebtRecords()

        const record = ds.db._storeData.records[0]
        expect(record).toBeDefined()
        // 外鍵 UUID 應已帶入紀錄（來源為帳戶/欠款的預先解析值）
        expect(record.accountUuid).toBe('acc-uuid-10')
        expect(record.debtUuid).toBe('debt-uuid-6')
        // payment.recordUuid 必須與補建紀錄的 uuid 一致（不再 getRecord 查回）
        expect(ds.db._storeData.debts[0].payments[0].recordUuid).toBe(record.uuid)
    })

    it('多筆殘留付款各補建一條紀錄且 payment 對應正確（UUID 快取共用）', async () => {
        ds.db._storeData.debts.push({
            id: 7,
            type: 'payable',
            description: '借款',
            originalAmount: 3000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-7',
            recordId: null,
            payments: [
                { amount: 1000, date: '2024-01-01' },
                { amount: 1000, date: '2024-02-01' },
            ],
        })

        const result = await ds.repairOrphanedDebtRecords()
        expect(result.repairedCount).toBe(2)

        const records = ds.db._storeData.records
        expect(records).toHaveLength(2)
        const [first, second] = records
        expect(first.amount).toBe(1000)
        expect(second.amount).toBe(1000)
        // 兩筆紀錄各有獨立 uuid（不共用同一 uuid）
        expect(first.uuid).not.toBe(second.uuid)
        // 各 payment 指向對應紀錄
        const payments = ds.db._storeData.debts[0].payments
        expect(payments[0].recordId).toBe(first.id)
        expect(payments[0].recordUuid).toBe(first.uuid)
        expect(payments[1].recordId).toBe(second.id)
        expect(payments[1].recordUuid).toBe(second.uuid)
        // 共用同一 debtUuid / accountUuid
        expect(first.debtUuid).toBe(second.debtUuid)
        expect(first.debtUuid).toBe('debt-uuid-7')
        expect(first.accountUuid).toBe(second.accountUuid)
        expect(first.accountUuid).toBe('acc-uuid-10')
    })

    it('addRecord 被 hook 取消時不標記修復、payment 保留原狀待下次重試', async () => {
        ds.db._storeData.debts.push({
            id: 8,
            type: 'payable',
            description: '借款',
            originalAmount: 1000,
            remainingAmount: 1000,
            contactId: 1,
            ledgerId: 1,
            uuid: 'debt-uuid-8',
            recordId: null,
            payments: [{ amount: 1000, date: '2024-01-01' }],
        })

        // 模擬 onRecordSaveBefore hook 取消紀錄建立（addRecord 回傳 null）
        vi.spyOn(ds, 'addRecord').mockResolvedValue(null)

        const result = await ds.repairOrphanedDebtRecords()
        expect(result.repairedCount).toBe(0)
        expect(ds.db._storeData.records).toHaveLength(0)
        // payment 未被標記為已修復（無 recordId/recordUuid）
        const payment = ds.db._storeData.debts[0].payments[0]
        expect(payment.recordId).toBeUndefined()
        expect(payment.recordUuid).toBeUndefined()
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

describe('DataService — Amortizations accountUuid (#SYNC-AMORT)', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('addAmortization 應自動補上 accountUuid（若提供 accountId）', async () => {
        ds.db._storeData.accounts.push({
            id: 70,
            name: '台新卡',
            type: 'credit_card',
            uuid: 'acc-uuid-70',
            ledgerId: 1,
        })

        const id = await ds.addAmortization(
            {
                name: '手機分期',
                type: '分期',
                periods: 12,
                amount: 1000,
                accountId: 70,
                chargeMode: 'upfront',
            },
            true
        )

        const tx = ds.db.transaction('amortizations', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.accountUuid).toBe('acc-uuid-70')
    })

    it('addAmortization 無 accountId 時不寫入 accountUuid', async () => {
        const id = await ds.addAmortization(
            {
                name: '軟體攤提',
                type: '攤提',
                periods: 24,
                amount: 1200,
            },
            true
        )

        const tx = ds.db.transaction('amortizations', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.accountUuid).toBeUndefined()
    })

    it('addAmortization accountId 查無帳戶時不寫入 accountUuid', async () => {
        const id = await ds.addAmortization(
            {
                name: '查無帳戶分期',
                type: '分期',
                periods: 6,
                amount: 600,
                accountId: 999, // 不存在
            },
            true
        )

        const tx = ds.db.transaction('amortizations', 'readonly')
        const item = await tx.store.get(id)
        await tx.done

        expect(item.accountId).toBe(999)
        expect(item.accountUuid).toBeUndefined()
    })

    it('updateAmortization 應更新 accountUuid 當 accountId 改變', async () => {
        ds.db._storeData.accounts.push({
            id: 80,
            name: '銀行',
            uuid: 'acc-uuid-80',
            ledgerId: 1,
        })
        const tx = ds.db.transaction('amortizations', 'readwrite')
        const id = await tx.store.add({
            name: '既有分期',
            type: '分期',
            periods: 12,
            amount: 1200,
            accountId: null,
            accountUuid: null,
            ledgerId: 1,
            status: 'active',
            uuid: 'am-uuid-upd',
        })
        await tx.done

        await ds.updateAmortization(id, { accountId: 80 }, true)

        const tx2 = ds.db.transaction('amortizations', 'readonly')
        const updated = await tx2.store.get(id)
        await tx2.done

        expect(updated.accountUuid).toBe('acc-uuid-80')
    })

    it('updateAmortization accountId 改為 null 時 accountUuid 也清為 null', async () => {
        const tx = ds.db.transaction('amortizations', 'readwrite')
        const id = await tx.store.add({
            name: '要移除帳戶的分期',
            type: '分期',
            periods: 6,
            amount: 600,
            accountId: 5,
            accountUuid: 'acc-uuid-old',
            ledgerId: 1,
            status: 'active',
            uuid: 'am-uuid-clear',
        })
        await tx.done

        await ds.updateAmortization(id, { accountId: null }, true)

        const tx2 = ds.db.transaction('amortizations', 'readonly')
        const updated = await tx2.store.get(id)
        await tx2.done

        expect(updated.accountId).toBeNull()
        expect(updated.accountUuid).toBeNull()
    })

    it('updateAmortization 未動 accountId 時不影響既有 accountUuid', async () => {
        const tx = ds.db.transaction('amortizations', 'readwrite')
        const id = await tx.store.add({
            name: '只改名稱',
            type: '分期',
            periods: 6,
            amount: 600,
            accountId: 9,
            accountUuid: 'acc-uuid-keep',
            ledgerId: 1,
            status: 'active',
            uuid: 'am-uuid-name',
        })
        await tx.done

        await ds.updateAmortization(id, { name: '改名後' }, true)

        const tx2 = ds.db.transaction('amortizations', 'readonly')
        const updated = await tx2.store.get(id)
        await tx2.done

        expect(updated.name).toBe('改名後')
        expect(updated.accountUuid).toBe('acc-uuid-keep')
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

    it('_restoreFromBackup 還原 records 時保留原始 ID 與 uuid（維持外鍵完整）', async () => {
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
        // 保留原始 id：還原後 records.accountId/debtId 等外鍵才能對得上
        expect(records[0].id).toBe(999)
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

    it('deleteLedger 連帶刪除該帳本的 groupMeta（明細群組），避免孤兒殘留', async () => {
        ds.db._storeData.ledgers.push({ id: 2, name: '帳本二', uuid: 'l2' })
        // 帳本 2 的群組
        ds.db._storeData.groupMeta.push({
            id: 1,
            name: '帳本二群組',
            ledgerId: 2,
            uuid: 'gm-l2',
        })
        // 帳本 1 的群組（應保留）
        ds.db._storeData.groupMeta.push({
            id: 2,
            name: '帳本一群組',
            ledgerId: 1,
            uuid: 'gm-l1',
        })

        await ds.deleteLedger(2)

        const groups = await ds.getAllGroupMeta()
        expect(groups).toHaveLength(1)
        expect(groups[0].ledgerId).toBe(1)
        expect(groups[0].name).toBe('帳本一群組')
    })

    it('刪除目前使用的帳本後自動切回預設帳本', async () => {
        ds.db._storeData.ledgers.push({ id: 5, name: '進行中帳本', uuid: 'l5' })
        ds.setActiveLedger(5)

        await ds.deleteLedger(5)

        expect(ds.activeLedgerId).toBe(1)
        expect(localStorage.getItem('activeLedgerId')).toBe('1')
    })

    it('deleteLedger 級聯清理共用帳本相關的 6 組 settings 鍵', async () => {
        const ledger = {
            id: 9,
            name: '待刪共用帳本',
            uuid: 'target-shared-uuid',
            sharedManifestId: 'mf_cleanup_test',
        }
        ds.db._storeData.ledgers.push(ledger)

        await ds.saveSetting({ key: 'sync_shared_devlog_target-shared-uuid', value: 'dl_1' })
        await ds.saveSetting({ key: 'shared_migrated_target-shared-uuid', value: true })
        await ds.saveSetting({ key: 'sync_shared_member_checked_target-shared-uuid', value: {} })
        await ds.saveSetting({ key: 'sync_shared_incomplete_target-shared-uuid', value: {} })
        await ds.saveSetting({ key: 'sync_shared_granted_target-shared-uuid_dl_1', value: ['a@test.com'] })
        await ds.saveSetting({ key: 'sync_manifest_pending_mf_cleanup_test', value: ['pending@test.com'] })

        await ds.deleteLedger(9)

        expect((await ds.getSetting('sync_shared_devlog_target-shared-uuid'))?.value).toBeNull()
        expect((await ds.getSetting('shared_migrated_target-shared-uuid'))?.value).toBeNull()
        expect((await ds.getSetting('sync_shared_member_checked_target-shared-uuid'))?.value).toBeNull()
        expect((await ds.getSetting('sync_shared_incomplete_target-shared-uuid'))?.value).toBeNull()
        expect((await ds.getSetting('sync_shared_granted_target-shared-uuid_dl_1'))?.value).toBeNull()
        expect((await ds.getSetting('sync_manifest_pending_mf_cleanup_test'))?.value).toBeNull()
    })

    it('#BUDGET-KEY-H6 deleteLedger 清除該帳本預算鍵，殭屍預算不被新帳本 id 繼承', async () => {
        ds.db._storeData.ledgers.push({ id: 2, name: '待刪帳本', uuid: 'l-budget' })
        // 該帳本的預算（IndexedDB + localStorage 兩層）
        await ds.saveSetting({ key: 'budget_settings_2', value: { monthlyBudget: 8888 } })
        // 其他帳本預算與 legacy 全域鍵（應保留不動）
        await ds.saveSetting({ key: 'budget_settings_1', value: { monthlyBudget: 1111 } })
        await ds.saveSetting({ key: 'budget_settings', value: { monthlyBudget: 2222 } })
        localStorage.setItem('monthlyBudget_2', '8888')
        localStorage.setItem('categoryBudgets_2', '{"food":100}')
        localStorage.setItem('categoryBudgetOrder_2', '["food"]')
        localStorage.setItem('excludedBudgetCategories_2', '["transfer"]')

        await ds.deleteLedger(2)

        expect((await ds.getSetting('budget_settings_2'))?.value).toBeNull()
        expect(localStorage.getItem('monthlyBudget_2')).toBeNull()
        expect(localStorage.getItem('categoryBudgets_2')).toBeNull()
        expect(localStorage.getItem('categoryBudgetOrder_2')).toBeNull()
        expect(localStorage.getItem('excludedBudgetCategories_2')).toBeNull()
        // 其他帳本與 legacy 全域鍵完全不動
        expect((await ds.getSetting('budget_settings_1'))?.value).toEqual({ monthlyBudget: 1111 })
        expect((await ds.getSetting('budget_settings'))?.value).toEqual({ monthlyBudget: 2222 })
    })

    it('N1 防護：addAmortization 與 addRecurringTransaction 在 skipLog=true 時剝離外部傳入的 id，避免主鍵撞擊', async () => {
        const id1 = await ds.addAmortization({ name: '分期 1', periods: 12, totalAmount: 1200 })
        const id2 = await ds.addAmortization({ id: id1, name: '分期 2', periods: 6, totalAmount: 600 }, true)
        expect(id2).not.toBe(id1)
        expect(id2).toBeGreaterThan(id1)

        const rt1 = await ds.addRecurringTransaction({ description: '週期 1', amount: 100 })
        const rt2 = await ds.addRecurringTransaction({ id: rt1, description: '週期 2', amount: 200 }, true)
        expect(rt2).not.toBe(rt1)
        expect(rt2).toBeGreaterThan(rt1)
    })

    it('logChange 自動補齊 amortizationUuid', async () => {
        const amortId = await ds.addAmortization({ name: '計畫A', periods: 3, totalAmount: 300 })
        const amort = await ds.getAmortization(amortId)

        await ds.logChange('add', 'records', 99, {
            description: '分期明細',
            amount: 100,
            amortizationId: amortId,
        })

        const logs = await ds.db.getAll('sync_log')
        const lastLog = logs[logs.length - 1]
        expect(lastLog.data.amortizationUuid).toBe(amort.uuid)
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

describe('DataService — groupManagementEnabled 設定項匯出/匯入/同步', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('exportData 與 exportDataForSync 應包含 groupManagementEnabled 設定', async () => {
        await ds.saveSetting({
            key: 'groupManagementEnabled',
            value: true,
        })

        let exportedPayload = null
        const originalBlob = globalThis.Blob
        globalThis.Blob = class extends originalBlob {
            constructor(parts, options) {
                super(parts, options)
                try {
                    exportedPayload = JSON.parse(parts[0])
                } catch {
                    exportedPayload = null
                }
            }
        }

        try {
            await ds.exportData()
            expect(exportedPayload).not.toBeNull()
            expect(exportedPayload.settings.groupManagementEnabled).toBe(true)
        } finally {
            globalThis.Blob = originalBlob
        }

        const syncExport = await ds.exportDataForSync()
        expect(syncExport.settings).toBeDefined()
        expect(syncExport.settings.groupManagementEnabled).toBe(true)
    })

    it('importData 應正確還原 groupManagementEnabled 設定', async () => {
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
                groupManagementEnabled: true,
            },
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '預設帳本', uuid: 'ledger-uuid-1' }],
            records: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [{ id: 'gm-1', name: '出差群組', ledgerId: 1, uuid: 'gm-uuid-1' }],
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            const setting = await ds.getSetting('groupManagementEnabled')
            expect(setting?.value).toBe(true)
        } finally {
            restore()
        }
    })

    it('exportDataForSync 應包含 budgetSettingsMap 與 activeLedgerId，並提供 budgetSettings fallback', async () => {
        const budgetPayload = {
            monthlyBudget: 25000,
            categoryBudgets: { food: 8000, transport: 3000 },
            categoryBudgetOrder: ['food', 'transport'],
            excludedBudgetCategories: ['investment'],
        }
        await ds.saveSetting({
            key: `budget_settings_${ds.activeLedgerId}`,
            value: budgetPayload,
        })

        const syncExport = await ds.exportDataForSync()
        expect(syncExport.activeLedgerId).toBe(ds.activeLedgerId)
        expect(syncExport.budgetSettingsMap).toBeDefined()
        expect(syncExport.budgetSettingsMap[`budget_settings_${ds.activeLedgerId}`]).toEqual(budgetPayload)
        expect(syncExport.budgetSettings).toEqual(budgetPayload)
    })

    it('importData 應正確還原 budgetSettingsMap 並重寫 ledgerId，同時同步 localStorage', async () => {
        const budgetPayload = {
            monthlyBudget: 30000,
            categoryBudgets: { dining: 10000 },
            categoryBudgetOrder: ['dining'],
            excludedBudgetCategories: [],
        }
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {},
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '主帳本', uuid: 'ledger-uuid-test' }],
            records: [],
            budgetSettingsMap: {
                budget_settings_1: budgetPayload,
            },
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            const ledgers = await ds.getLedgers()
            const newLedgerId = ledgers[0].id
            const setting = await ds.getSetting(`budget_settings_${newLedgerId}`)
            expect(setting?.value).toEqual(budgetPayload)
            expect(localStorage.getItem(`monthlyBudget_${newLedgerId}`)).toBe('30000')
        } finally {
            restore()
        }
    })

    it('#BUDGET-KEY-M10 importData 跳過未映射帳本的 per-ledger 預算鍵，不污染本機同號帳本與全域快取', async () => {
        const mappedBudget = {
            monthlyBudget: 9000,
            categoryBudgets: { food: 1000 },
            categoryBudgetOrder: ['food'],
            excludedBudgetCategories: [],
        }
        const orphanBudget = {
            monthlyBudget: 77777,
            categoryBudgets: { evil: 1 },
            categoryBudgetOrder: ['evil'],
            excludedBudgetCategories: [],
        }
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {},
            activeLedgerId: 1,
            // 只匯入 1 個帳本 → 備份檔中 budget_settings_99 屬未映射孤兒鍵
            ledgers: [{ id: 1, name: '主帳本', uuid: 'ledger-uuid-m10' }],
            records: [],
            budgetSettingsMap: {
                budget_settings_1: mappedBudget,
                budget_settings_99: orphanBudget,
            },
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            const ledgers = await ds.getLedgers()
            const newLedgerId = ledgers[0].id
            // 已映射鍵正常寫入重映射後的新 key
            expect((await ds.getSetting(`budget_settings_${newLedgerId}`))?.value).toEqual(mappedBudget)
            // 未映射鍵不被寫入（不會蓋到本機同號帳本）
            expect(await ds.getSetting('budget_settings_99')).toBeFalsy()
            // 全域 legacy 鍵不被未映射鍵污染（orphanBudget 的 77777 不得出現）
            expect(localStorage.getItem('monthlyBudget')).toBeNull()
            expect(localStorage.getItem(`monthlyBudget_${newLedgerId}`)).toBe('9000')
        } finally {
            restore()
        }
    })

    it('importData 應支援只有舊版 budgetSettings 的備份檔並補齊當前帳本 key', async () => {
        const legacyBudget = {
            monthlyBudget: 15000,
            categoryBudgets: { snack: 2000 },
            categoryBudgetOrder: ['snack'],
            excludedBudgetCategories: [],
        }
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {},
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '主帳本', uuid: 'ledger-uuid-legacy' }],
            records: [],
            budgetSettings: legacyBudget,
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            const ledgers = await ds.getLedgers()
            const newLedgerId = ledgers[0].id
            const scopedSetting = await ds.getSetting(`budget_settings_${newLedgerId}`)
            expect(scopedSetting?.value).toEqual(legacyBudget)
            const globalSetting = await ds.getSetting('budget_settings')
            expect(globalSetting?.value).toEqual(legacyBudget)
            expect(localStorage.getItem('monthlyBudget')).toBe('15000')
        } finally {
            restore()
        }
    })
})

describe('DataService — 多帳本預算設定匯出/匯入/同步備份', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('exportDataForSync 應包含 per-ledger 預算 (budgetSettingsMap)', async () => {
        // seed 兩筆預算：legacy 全域 key + per-ledger key
        await ds.saveSetting({
            key: 'budget_settings',
            value: {
                monthlyBudget: 1000,
                categoryBudgets: {},
                categoryBudgetOrder: [],
                excludedBudgetCategories: [],
            },
        })
        await ds.saveSetting({
            key: 'budget_settings_1',
            value: {
                monthlyBudget: 5000,
                categoryBudgets: { food: 2000 },
                categoryBudgetOrder: ['food'],
                excludedBudgetCategories: [],
            },
        })
        await ds.saveSetting({
            key: 'budget_settings_2',
            value: {
                monthlyBudget: 3000,
                categoryBudgets: {},
                categoryBudgetOrder: [],
                excludedBudgetCategories: ['food'],
            },
        })

        const syncExport = await ds.exportDataForSync()

        // budgetSettingsMap 應包含三個 key
        expect(syncExport.budgetSettingsMap).toBeDefined()
        expect(syncExport.budgetSettingsMap['budget_settings'].monthlyBudget).toBe(
            1000
        )
        expect(syncExport.budgetSettingsMap['budget_settings_1'].monthlyBudget).toBe(
            5000
        )
        expect(syncExport.budgetSettingsMap['budget_settings_1'].categoryBudgets).toEqual({
            food: 2000,
        })
        expect(syncExport.budgetSettingsMap['budget_settings_2'].monthlyBudget).toBe(
            3000
        )
        expect(syncExport.budgetSettingsMap['budget_settings_2'].excludedBudgetCategories).toEqual(
            ['food']
        )

        // budgetSettings legacy fallback 應存在
        expect(syncExport.budgetSettings).toBeDefined()
        expect(syncExport.budgetSettings.monthlyBudget).toBe(1000)
    })

    it('exportDataForSync 無預算時 budgetSettingsMap 為空物件、budgetSettings 為 null', async () => {
        const syncExport = await ds.exportDataForSync()
        expect(syncExport.budgetSettingsMap).toEqual({})
        expect(syncExport.budgetSettings).toBeNull()
    })

    it('exportDataForSync 只有 per-ledger key（無 legacy）時 budgetSettings 為 null 但 map 有值', async () => {
        await ds.saveSetting({
            key: 'budget_settings_1',
            value: {
                monthlyBudget: 5000,
                categoryBudgets: { food: 2000 },
                categoryBudgetOrder: ['food'],
                excludedBudgetCategories: [],
            },
        })
        const syncExport = await ds.exportDataForSync()
        expect(syncExport.budgetSettingsMap['budget_settings_1'].monthlyBudget).toBe(
            5000
        )
        // v2.1.8.1（origin）：activeLedgerId 的 per-ledger key 會提升為 budgetSettings
        // fallback（與上方 activeLedgerId fallback 測試同語意，較 3661ef1 舊版「null」更友善）
        expect(syncExport.budgetSettings.monthlyBudget).toBe(5000)
    })

    it('exportData 應包含 budgetSettingsMap（手動匯出）', async () => {
        await ds.saveSetting({
            key: 'budget_settings_1',
            value: {
                monthlyBudget: 5000,
                categoryBudgets: { food: 2000 },
                categoryBudgetOrder: ['food'],
                excludedBudgetCategories: [],
            },
        })

        let exportedPayload = null
        const originalBlob = globalThis.Blob
        globalThis.Blob = class extends originalBlob {
            constructor(parts, options) {
                super(parts, options)
                try {
                    exportedPayload = JSON.parse(parts[0])
                } catch {
                    exportedPayload = null
                }
            }
        }

        try {
            await ds.exportData()
            expect(exportedPayload).not.toBeNull()
            expect(exportedPayload.budgetSettingsMap).toBeDefined()
            expect(
                exportedPayload.budgetSettingsMap['budget_settings_1'].monthlyBudget
            ).toBe(5000)
        } finally {
            globalThis.Blob = originalBlob
        }
    })

    it('importData 應還原 per-ledger 預算並重映射 ledger ID', async () => {
        // 匯入檔：舊裝置 ledger 1, 2；新裝置會重新分配 id
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
                groupManagementEnabled: false,
            },
            activeLedgerId: 1,
            ledgers: [
                { id: 1, name: '預設帳本', uuid: 'ledger-uuid-1' },
                { id: 2, name: '旅行帳本', uuid: 'ledger-uuid-2' },
            ],
            records: [],
            accounts: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [],
            budgetSettingsMap: {
                budget_settings_1: {
                    monthlyBudget: 5000,
                    categoryBudgets: { food: 2000 },
                    categoryBudgetOrder: ['food'],
                    excludedBudgetCategories: [],
                },
                budget_settings_2: {
                    monthlyBudget: 3000,
                    categoryBudgets: {},
                    categoryBudgetOrder: [],
                    excludedBudgetCategories: ['food'],
                },
            },
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            // 取得新裝置的 ledger id
            const ledgers = await ds.getLedgers()
            const ledger1NewId = ledgers.find(
                l => l.uuid === 'ledger-uuid-1'
            )?.id
            const ledger2NewId = ledgers.find(
                l => l.uuid === 'ledger-uuid-2'
            )?.id

            // 驗證預算已重映射到新 ledger id
            const budget1 = await ds.getSetting(`budget_settings_${ledger1NewId}`)
            expect(budget1?.value?.monthlyBudget).toBe(5000)
            expect(budget1?.value?.categoryBudgets).toEqual({ food: 2000 })

            const budget2 = await ds.getSetting(`budget_settings_${ledger2NewId}`)
            expect(budget2?.value?.monthlyBudget).toBe(3000)
            expect(budget2?.value?.excludedBudgetCategories).toEqual(['food'])
        } finally {
            restore()
        }
    })

    it('importData 無 budgetSettingsMap 但有 budgetSettings legacy 時仍可用', async () => {
        const json = JSON.stringify({
            version: '2.3.0',
            settings: {
                advancedAccountModeEnabled: false,
                debtManagementEnabled: false,
                groupManagementEnabled: false,
            },
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '預設帳本', uuid: 'ledger-uuid-1' }],
            records: [],
            accounts: [],
            contacts: [],
            debts: [],
            recurring_transactions: [],
            amortizations: [],
            credit_statements: [],
            groupMeta: [],
            budgetSettings: {
                monthlyBudget: 8000,
                categoryBudgets: { food: 3000 },
                categoryBudgetOrder: ['food'],
                excludedBudgetCategories: [],
            },
        })
        const restore = stubFileReader(json)

        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)

            const budget = await ds.getSetting('budget_settings')
            expect(budget?.value?.monthlyBudget).toBe(8000)
        } finally {
            restore()
        }
    })
})

describe('DataService — addAmortization chargeMode', () => {
    let ds
    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('未指定 chargeMode 預設 periodic', async () => {
        const id = await ds.addAmortization({
            name: 'A', type: 'installment', recordType: 'expense',
            category: '購物', totalAmount: 1000, periods: 3,
            completedPeriods: 0, amountPerPeriod: 333,
            frequency: 'monthly', startDate: '2026-08-01',
            nextDueDate: '2026-08-01', status: 'active',
        })
        const item = await ds.getAmortization(id)
        expect(item.chargeMode).toBe('periodic')
    })

    it('顯式 upfront 保留', async () => {
        const id = await ds.addAmortization({
            name: 'B', type: 'installment', recordType: 'expense',
            category: '購物', totalAmount: 30000, periods: 12,
            completedPeriods: 0, amountPerPeriod: 2500,
            frequency: 'monthly', startDate: '2026-08-01',
            nextDueDate: '2026-08-01', status: 'active',
            chargeMode: 'upfront', accountId: 99,
        })
        const item = await ds.getAmortization(id)
        expect(item.chargeMode).toBe('upfront')
    })
})

describe('DataService — calculateAccountCurrentBalance', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        // 直接寫入 mock store（保留明確 id）
        ds.db._storeData.accounts = []
        ds.db._storeData.records = []
        ds.db._storeData.debts = []
    })

    it('一般帳戶：初始餘額 + 收入 - 支出', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'income', amount: 500, ledgerId: 1 },
            { id: 2, accountId: 1, type: 'expense', amount: 300, ledgerId: 1 },
            { id: 3, accountId: 1, type: 'expense', amount: 200, ledgerId: 1 }
        )
        // 1000 + 500 - 300 - 200 = 1000
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(1000)
    })

    it('一般帳戶：支出超過初始餘額時餘額轉負', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 1500, ledgerId: 1 }
        )
        // 1000 - 1500 = -500
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(-500)
    })

    it('一般帳戶：排除 payable 欠款的原始紀錄（debtId + payable + 非 debt_repayment）', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.debts.push({ id: 10, type: 'payable', ledgerId: 1, createdAt: 1 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 200, debtId: 10, category: 'food', ledgerId: 1 }
        )
        // 該筆 200 屬 payable 欠款原始紀錄 → 排除 → 餘額維持 1000
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(1000)
    })

    it('一般帳戶：payable 欠款的 debt_repayment 還款紀錄「不」排除（實際現金流要計入）', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.debts.push({ id: 10, type: 'payable', ledgerId: 1, createdAt: 1 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 200, debtId: 10, category: 'debt_repayment', ledgerId: 1 }
        )
        // debt_repayment 不屬排除條件 → 計入 → 1000 - 200 = 800
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(800)
    })

    it('一般帳戶：receivable 欠款的紀錄「不」排除', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.debts.push({ id: 10, type: 'receivable', ledgerId: 1, createdAt: 1 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 200, debtId: 10, category: 'food', ledgerId: 1 }
        )
        // receivable 不排除 → 1000 - 200 = 800
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(800)
    })

    it('一般帳戶：debtId 為 null 的普通紀錄正常計入', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 200, debtId: null, category: 'food', ledgerId: 1 }
        )
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(800)
    })

    it('信用卡：餘額為淨現金流（消費負、繳款正），負值代表欠款', async () => {
        ds.db._storeData.accounts.push({
            id: 3, name: '信用卡', type: 'credit_card', balance: 0, creditLimit: 20000,
        })
        ds.db._storeData.records.push(
            { id: 1, accountId: 3, type: 'expense', amount: 5000, ledgerId: 1 },
            { id: 2, accountId: 3, type: 'income', amount: 2000, ledgerId: 1 }
        )
        // 0 - 5000 + 2000 = -3000（欠款 3000）
        expect(await ds.calculateAccountCurrentBalance(3)).toBe(-3000)
    })

    it('找不到帳戶時回傳 0', async () => {
        expect(await ds.calculateAccountCurrentBalance(999)).toBe(0)
    })

    it('帳戶無 balance 欄位時以 0 為起點', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet' })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 300, ledgerId: 1 }
        )
        // 0（無初始）- 300 = -300
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(-300)
    })

    it('其他帳戶的紀錄不計入本帳戶餘額（accountId 隔離）', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 2, type: 'expense', amount: 9999, ledgerId: 1 }
        )
        // accountId=2 的紀錄不屬於帳戶 1 → 1000
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(1000)
    })

    it('其他帳本的紀錄不計入本帳戶餘額（ledgerId 隔離）', async () => {
        ds.db._storeData.accounts.push({ id: 1, name: '現金', type: 'wallet', balance: 1000 })
        ds.db._storeData.records.push(
            { id: 1, accountId: 1, type: 'expense', amount: 9999, ledgerId: 2 }
        )
        // 同 accountId 但 ledgerId=2（非 active ledger 1）→ 不計入 → 1000
        expect(await ds.calculateAccountCurrentBalance(1)).toBe(1000)
    })
})

// ==================== getStatistics — 對象（聯絡人）篩選 (#MOZE-TGT) ====================

describe('DataService.getStatistics — 對象（聯絡人）篩選 (#MOZE-TGT)', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    function seedContactData() {
        // debt 1 → contact 1（小明）、debt 2 → contact 2（小美）
        // receivable（應收代墊）未結清的 expense 保留全額 effectiveAmount，會出現在 stats.records
        ds.db._storeData.debts.push(
            { id: 1, contactId: 1, type: 'receivable', originalAmount: 300, ledgerId: 1, settled: false, createdAt: 1 },
            { id: 2, contactId: 2, type: 'receivable', originalAmount: 500, ledgerId: 1, settled: false, createdAt: 2 }
        )
        ds.db._storeData.records.push(
            // 掛 contact 1 欠款的兩筆（代墊支出）
            { id: 1, type: 'expense', amount: 300, category: 'food', date: '2026-06-05', debtId: 1, ledgerId: 1 },
            { id: 2, type: 'expense', amount: 200, category: 'transport', date: '2026-06-10', debtId: 1, ledgerId: 1 },
            // 掛 contact 2 欠款的一筆
            { id: 3, type: 'expense', amount: 500, category: 'food', date: '2026-06-07', debtId: 2, ledgerId: 1 },
            // 無 debtId 的一般紀錄（不屬於任何對象）
            { id: 4, type: 'expense', amount: 999, category: 'shopping', date: '2026-06-08', ledgerId: 1 },
            // debtId 引用不存在 debt 的紀錄
            { id: 5, type: 'expense', amount: 777, category: 'shopping', date: '2026-06-09', debtId: 999, ledgerId: 1 }
        )
    }

    it('contactId 命中時只保留該對象欠款關聯的紀錄', async () => {
        seedContactData()
        const stats = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            1
        )
        const ids = stats.records.map(r => r.id).sort()
        expect(ids).toEqual([1, 2])
    })

    it('無 debtId 的一般紀錄在任何 contactId 篩選下都被過濾', async () => {
        seedContactData()
        const stats = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            2
        )
        expect(stats.records.map(r => r.id)).toEqual([3])
    })

    it('debtId 引用不存在 debt 的紀錄被過濾', async () => {
        seedContactData()
        const stats = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            1
        )
        expect(stats.records.some(r => r.id === 5)).toBe(false)
    })

    it('contactId 為 null（不傳）時不過濾，全部紀錄計入', async () => {
        seedContactData()
        const stats = await ds.getStatistics('2026-06-01', '2026-06-30')
        // receivable 未結清的 expense 保留全額 effectiveAmount，全部 5 筆皆計入；
        // 明確傳 null 與不傳（預設）結果應一致
        const noFilter = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            null
        )
        expect(stats.records.length).toBe(noFilter.records.length)
        expect(stats.records).toHaveLength(5)
    })

    it('篩選後 totalExpense 只累計命中紀錄的金額', async () => {
        // receivable（應收代墊）未結清的 expense 保留全額，可直接驗證金額累計
        ds.db._storeData.debts.push(
            { id: 10, contactId: 7, type: 'receivable', originalAmount: 1000, ledgerId: 1, settled: false, createdAt: 1 },
            { id: 11, contactId: 8, type: 'receivable', originalAmount: 500, ledgerId: 1, settled: false, createdAt: 2 }
        )
        ds.db._storeData.records.push(
            { id: 20, type: 'expense', amount: 1000, category: 'food', date: '2026-06-05', debtId: 10, ledgerId: 1 },
            { id: 21, type: 'expense', amount: 500, category: 'food', date: '2026-06-06', debtId: 11, ledgerId: 1 }
        )
        const stats = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            7
        )
        expect(stats.totalExpense).toBe(1000)
        expect(stats.records.map(r => r.id)).toEqual([20])
    })

    it('stats.records 回傳欄位同步過濾（income 腿驗證）', async () => {
        ds.db._storeData.debts.push(
            { id: 30, contactId: 7, type: 'receivable', originalAmount: 800, ledgerId: 1, settled: true, createdAt: 1 },
            { id: 31, contactId: 8, type: 'receivable', originalAmount: 600, ledgerId: 1, settled: true, createdAt: 2 }
        )
        ds.db._storeData.records.push(
            { id: 40, type: 'income', amount: 800, category: 'debt_recovery', date: '2026-06-05', debtId: 30, ledgerId: 1 },
            { id: 41, type: 'income', amount: 600, category: 'debt_recovery', date: '2026-06-06', debtId: 31, ledgerId: 1 }
        )
        const stats = await ds.getStatistics(
            '2026-06-01',
            '2026-06-30',
            null,
            false,
            8
        )
        expect(stats.records.map(r => r.id)).toEqual([41])
        expect(stats.totalIncome).toBe(600)
    })
})

describe('DataService — 既有款項登記基線 (initialPaidAmount)', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        ds.db._storeData.contacts.push({ id: 1, name: '測試聯絡人', uuid: 'c-uuid-1' })
    })

    it('addDebt 帶基線 → remainingAmount = 總額 − 基線，基線欄位寫入', async () => {
        const id = await ds.addDebt({
            type: 'receivable',
            contactId: 1,
            amount: 1000,
            initialPaidAmount: 400,
            date: '2024-01-01',
            description: '車款',
        })
        const debt = await ds.getDebt(id)
        expect(debt.originalAmount).toBe(1000)
        expect(debt.remainingAmount).toBe(600)
        expect(debt.initialPaidAmount).toBe(400)
        expect(debt.settled).toBe(false)
    })

    it('addDebt 基線等於總額 → 建立當下直接結清', async () => {
        const id = await ds.addDebt({
            type: 'payable',
            contactId: 1,
            amount: 500,
            initialPaidAmount: 500,
            date: '2024-01-01',
        })
        const debt = await ds.getDebt(id)
        expect(debt.remainingAmount).toBe(0)
        expect(debt.settled).toBe(true)
        expect(debt.settledAt).toBeTruthy()
    })

    it('addDebt 基線超過總額 → 收斂為總額（remaining 0、不為負）', async () => {
        const id = await ds.addDebt({
            type: 'payable',
            contactId: 1,
            amount: 300,
            initialPaidAmount: 999,
            date: '2024-01-01',
        })
        const debt = await ds.getDebt(id)
        expect(debt.remainingAmount).toBe(0)
        expect(debt.initialPaidAmount).toBe(300)
    })

    it('addDebt 非法基線（負數/NaN/字串）→ 歸 0，remaining = 總額且無基線欄位', async () => {
        for (const bad of [-100, 'abc', NaN, undefined, null]) {
            await ds.addDebt({
                type: 'payable',
                contactId: 1,
                amount: 200,
                initialPaidAmount: bad,
                date: '2024-01-01',
            })
        }
        const debts = await ds.getDebts()
        expect(debts).toHaveLength(5)
        for (const d of debts) {
            expect(d.remainingAmount).toBe(200)
            expect(d.initialPaidAmount).toBeUndefined()
        }
    })

    it('addDebt 不帶基線 → 與舊行為完全一致（零污染）', async () => {
        const id = await ds.addDebt({
            type: 'payable',
            contactId: 1,
            amount: 800,
            date: '2024-01-01',
        })
        const debt = await ds.getDebt(id)
        expect(debt.remainingAmount).toBe(800)
        expect('initialPaidAmount' in debt).toBe(false)
        expect(debt.settled).toBe(false)
    })

    it('skipLog（同步接收）路徑保留 initialPaidAmount 欄位', async () => {
        const id = await ds.addDebt(
            {
                type: 'receivable',
                contactId: 1,
                originalAmount: 1000,
                remainingAmount: 600,
                initialPaidAmount: 400,
                date: '2024-01-01',
                settled: false,
            },
            true
        )
        const debt = await ds.getDebt(id)
        expect(debt.initialPaidAmount).toBe(400)
        expect(debt.remainingAmount).toBe(600)
    })

    it('recalculateDebtState 把基線計入已還總額（漏計會誤還原結清）', async () => {
        // 總額 1000、基線 400、payments 600 全有對應還款紀錄 → 應維持結清
        ds.db._storeData.debts.push({
            id: 77,
            type: 'receivable',
            contactId: 1,
            originalAmount: 1000,
            remainingAmount: 0,
            settled: true,
            settledAt: 1,
            initialPaidAmount: 400,
            ledgerId: 1,
            recordId: null,
            payments: [
                { amount: 600, date: '2024-02-01', recordId: 81, recordUuid: 'r-81' },
            ],
        })
        ds.db._storeData.records.push({
            id: 81,
            type: 'income',
            category: 'debt_collection',
            amount: 600,
            debtId: 77,
            ledgerId: 1,
            date: '2024-02-01',
        })

        const updated = await ds.recalculateDebtState(77)
        expect(updated.remainingAmount).toBe(0)
        expect(updated.settled).toBe(true)
    })

    it('recalculateDebtState 基線＋部分還款後仍結清', async () => {
        // 總額 1000、基線 400、僅 300 有還款紀錄（另外 300 付款紀錄被刪）→ 重算應為 300 未結清
        ds.db._storeData.debts.push({
            id: 78,
            type: 'payable',
            contactId: 1,
            originalAmount: 1000,
            remainingAmount: 0,
            settled: true,
            settledAt: 1,
            initialPaidAmount: 400,
            ledgerId: 1,
            recordId: null,
            payments: [
                { amount: 300, date: '2024-02-01', recordId: 82, recordUuid: 'r-82' },
            ],
        })
        ds.db._storeData.records.push({
            id: 82,
            type: 'expense',
            category: 'debt_repayment',
            amount: 300,
            debtId: 78,
            ledgerId: 1,
            date: '2024-02-01',
        })

        const updated = await ds.recalculateDebtState(78)
        expect(updated.remainingAmount).toBe(300)
        expect(updated.settled).toBe(false)
        expect(updated.settledAt).toBeNull()
    })

    it('recalculateDebtState 無基線舊欠款行為不變', async () => {
        ds.db._storeData.debts.push({
            id: 79,
            type: 'payable',
            contactId: 1,
            originalAmount: 500,
            remainingAmount: 200,
            settled: false,
            ledgerId: 1,
            recordId: null,
            payments: [{ amount: 300, date: '2024-02-01', recordId: 83, recordUuid: 'r-83' }],
        })
        ds.db._storeData.records.push({
            id: 83,
            type: 'expense',
            category: 'debt_repayment',
            amount: 300,
            debtId: 79,
            ledgerId: 1,
            date: '2024-02-01',
        })
        const updated = await ds.recalculateDebtState(79)
        expect(updated.remainingAmount).toBe(200)
        expect(updated.settled).toBe(false)
    })
})

describe('importData 進度回報與確認跳過', () => {
    let ds
    beforeEach(async () => {
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('importData 觸發 onProgress 並支援 skipConfirm', async () => {
        // 先建立一筆紀錄，若無 skipConfirm 則會調用 customConfirm
        await ds.addRecord({
            type: 'expense',
            amount: 50,
            date: '2024-01-01',
            category: '餐飲',
            ledgerId: 1,
            uuid: 'existing-rec',
        })

        const customCats = {
            expense: [
                {
                    id: 'custom_cat_1',
                    name: '自訂分類A',
                    icon: 'fa-solid fa-star',
                    color: 'bg-yellow-400',
                },
            ],
            income: [],
        }

        const json = JSON.stringify({
            version: '2.3.0',
            settings: {},
            activeLedgerId: 1,
            ledgers: [{ id: 1, name: '主帳本', uuid: 'ledger-uuid-test' }],
            records: [
                {
                    id: 1,
                    type: 'expense',
                    amount: 100,
                    date: '2024-01-02',
                    category: 'custom_cat_1',
                    ledgerId: 1,
                    uuid: 'rec-1',
                },
            ],
            customCategories: {
                "1": customCats,
            },
        })
        const restore = stubFileReader(json)

        const progressUpdates = []
        try {
            const result = await ds.importData(
                { name: 'backup.json' },
                {
                    skipConfirm: true,
                    onProgress: (percent, message) => {
                        progressUpdates.push({ percent, message })
                    },
                }
            )

            expect(result.success).toBe(true)
            expect(progressUpdates.length).toBeGreaterThan(0)
            expect(progressUpdates[0].percent).toBe(5)
            expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100)

            // 驗證自訂類別同步到 global settings 及 localStorage
            const scopedSetting = await ds.getCategorySetting('custom_categories', ds.activeLedgerId)
            expect(scopedSetting?.value).toEqual(customCats)
            const globalSetting = await ds.getSetting('custom_categories')
            expect(globalSetting?.value).toEqual(customCats)
            expect(JSON.parse(localStorage.getItem('customCategories'))).toEqual(customCats)
        } finally {
            restore()
        }
    })
})

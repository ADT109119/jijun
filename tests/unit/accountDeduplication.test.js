import { describe, it, expect, beforeEach, vi } from 'vitest'
import DataService from '../../src/js/dataService.js'
import { SyncService } from '../../src/js/syncService.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

// 模擬 FileReader 讀取 JSON 內容，用於測試 importData
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

describe('帳戶去重與雲端同步冪等整合測試 (Account Deduplication & Sync Idempotence)', () => {
    let ds
    let syncService

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        syncService = new SyncService(ds)
        syncService.accessToken = 'test-token'
        syncService.deviceId = 'test-device-id'
    })

    describe('DataService.prototype.deduplicateAccounts', () => {
        it('自動合併同帳本同名帳戶，將關聯 records, debts, recurring, amortizations, statements 轉移並刪除冗餘帳戶', async () => {
            // 建立主帳戶 (帶有明細與初始餘額)
            const acc1Id = await ds.addAccount({
                name: '中信',
                balance: 12503,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'acc-uuid-1',
            }, true)

            // 建立同名冗餘帳戶 (無明細)
            const acc2Id = await ds.addAccount({
                name: '中信',
                balance: 12503,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'acc-uuid-2',
            }, true)

            // 建立不同帳本的同名帳戶 (不應被合併)
            await ds.addAccount({
                name: '中信',
                balance: 5000,
                ledgerId: 2,
                type: 'wallet',
                uuid: 'acc-uuid-other',
            }, true)

            // 建立關聯資料
            // 紀錄關聯至 acc1
            await ds.addRecord({
                amount: 5000,
                type: 'expense',
                date: '2026-08-01',
                accountId: acc1Id,
                ledgerId: 1,
                category: '餐飲',
            }, true)

            // 欠款關聯至 acc2 (故意關聯到冗餘帳戶以驗證轉移)
            const debt1Id = await ds.addDebt({
                amount: 1000,
                type: 'receivable',
                accountId: acc2Id,
                ledgerId: 1,
                person: '小明',
            }, true)

            // 週期交易關聯至 acc2
            const rt1Id = await ds.addRecurringTransaction({
                title: '月租',
                amount: 8000,
                type: 'expense',
                accountId: acc2Id,
                ledgerId: 1,
                frequency: 'monthly',
                nextDueDate: '2026-09-01',
            })

            // 攤提分期關聯至 acc2
            const am1Id = await ds.addAmortization({
                name: '筆電分期',
                totalAmount: 36000,
                totalPeriods: 12,
                type: 'installment',
                accountId: acc2Id,
                ledgerId: 1,
            }, true)

            // 信用卡帳單關聯至 acc2
            const stmt1Id = await ds.addCreditStatement({
                accountId: acc2Id,
                period: '2026-08',
                status: 'unpaid',
                ledgerId: 1,
            }, true)

            // 另一張信用卡設置 autoPayAccountId 指向 acc2
            const cardId = await ds.addAccount({
                name: '國泰卡',
                type: 'credit_card',
                ledgerId: 1,
                autoPayAccountId: acc2Id,
            }, true)

            // 執行去重
            const result = await ds.deduplicateAccounts()
            expect(result.mergedCount).toBe(1)
            expect(result.groupsProcessed).toBe(1)

            // 驗證帳戶列表：帳本1僅剩 1 個「中信」與 1 個「國泰卡」，帳本2的「中信」依然存在
            const accountsL1 = await ds.getAccounts({ ledgerId: 1 })
            const zhongxinAccounts = accountsL1.filter(a => a.name === '中信')
            expect(zhongxinAccounts).toHaveLength(1)
            expect(zhongxinAccounts[0].id).toBe(acc1Id)

            const accountsL2 = await ds.getAccounts({ ledgerId: 2 })
            expect(accountsL2.filter(a => a.name === '中信')).toHaveLength(1)

            // 驗證關聯資料皆重定向至 acc1Id
            const updatedDebt = await ds.getDebt(debt1Id)
            expect(updatedDebt.accountId).toBe(acc1Id)

            const allRts = await ds.getRecurringTransactions({ allLedgers: true })
            const updatedRt = allRts.find(r => r.id === rt1Id)
            expect(updatedRt).toBeDefined()
            expect(updatedRt.accountId).toBe(acc1Id)

            const updatedAm = await ds.getAmortization(am1Id)
            expect(updatedAm.accountId).toBe(acc1Id)

            const updatedStmt = await ds.getCreditStatement(stmt1Id)
            expect(updatedStmt.accountId).toBe(acc1Id)

            const updatedCard = await ds.getAccount(cardId)
            expect(updatedCard.autoPayAccountId).toBe(acc1Id)

            // 驗證冗餘帳戶已被刪除
            const deletedAcc = await ds.getAccount(acc2Id)
            expect(deletedAcc).toBeNull()
        })

        it('若主帳戶初始餘額為 0，冗餘帳戶有初始餘額時，自動繼承其非零初始餘額', async () => {
            // acc1 餘額 0
            const acc1Id = await ds.addAccount({
                name: '現金',
                balance: 0,
                ledgerId: 1,
                type: 'wallet',
            }, true)

            // acc2 餘額 3500
            await ds.addAccount({
                name: '現金',
                balance: 3500,
                ledgerId: 1,
                type: 'wallet',
            }, true)

            // acc1 有紀錄，acc2 無紀錄 -> acc1 為主帳戶
            await ds.addRecord({
                amount: 100,
                type: 'expense',
                date: '2026-08-01',
                accountId: acc1Id,
                ledgerId: 1,
                category: '餐飲',
            }, true)

            await ds.deduplicateAccounts()

            const survivor = await ds.getAccount(acc1Id)
            expect(survivor).not.toBeNull()
            expect(survivor.balance).toBe(3500)
        })
    })

    describe('DataService.prototype.importData', () => {
        it('匯入備份檔案中若含有同名重複帳戶，自動去重並將紀錄統一重映射至主帳戶', async () => {
            const backupJson = JSON.stringify({
                version: '2.3.0',
                settings: {
                    advancedAccountModeEnabled: true,
                    debtManagementEnabled: false,
                },
                activeLedgerId: 1,
                ledgers: [{ id: 1, name: '預設帳本', uuid: 'ledger-uuid-1' }],
                // 備份中含有兩個同名帳戶
                accounts: [
                    { id: 101, name: '中信', balance: 12503, ledgerId: 1, type: 'wallet', uuid: 'u-101' },
                    { id: 102, name: '中信', balance: 12503, ledgerId: 1, type: 'wallet', uuid: 'u-102' },
                ],
                // 一筆紀錄指向 101，另一筆紀錄指向 102
                records: [
                    { id: 1, amount: 200, type: 'expense', date: '2026-08-01', accountId: 101, ledgerId: 1, category: '餐飲' },
                    { id: 2, amount: 300, type: 'expense', date: '2026-08-02', accountId: 102, ledgerId: 1, category: '交通' },
                ],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
                credit_statements: [],
            })

            const restore = stubFileReader(backupJson)
            try {
                const res = await ds.importData({ name: 'backup.json' })
                expect(res.success).toBe(true)

                // 檢查資料庫帳戶數量：同名帳戶必須只有 1 個
                const accounts = await ds.getAccounts({ allLedgers: true })
                expect(accounts).toHaveLength(1)
                expect(accounts[0].name).toBe('中信')

                // 檢查所有紀錄：兩筆紀錄的 accountId 均成功映射至同一個新帳戶 ID
                const records = await ds.getRecords({ allLedgers: true })
                expect(records).toHaveLength(2)
                expect(records[0].accountId).toBe(accounts[0].id)
                expect(records[1].accountId).toBe(accounts[0].id)
            } finally {
                restore()
            }
        })
    })

    describe('SyncService 冪等性與日誌標記', () => {
        it('applyRemoteChanges 遇到同帳本同名帳戶時視為冪等略過，不重複建立', async () => {
            // 本地已有帳戶「中信」
            const existingId = await ds.addAccount({
                name: '中信',
                balance: 7005,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'local-uuid-1',
            }, true)

            // 遠端日誌到達：新增同名帳戶「中信」
            const changes = [
                {
                    operation: 'add',
                    storeName: 'accounts',
                    deviceId: 'other-device',
                    timestamp: 1000,
                    data: {
                        name: '中信',
                        balance: 12503,
                        ledgerId: 1,
                        type: 'wallet',
                        uuid: 'remote-uuid-1',
                    },
                },
            ]

            const appliedKeys = await syncService.applyRemoteChanges(changes)
            expect(appliedKeys.size).toBe(1)

            // 帳戶數量依然只有 1 個
            const accounts = await ds.getAccounts({ ledgerId: 1 })
            expect(accounts).toHaveLength(1)
            expect(accounts[0].id).toBe(existingId)
            expect(accounts[0].balance).toBe(7005)
        })

        it('applyRemoteChanges 遇到同帳本同名聯絡人時視為冪等略過，不重複建立', async () => {
            const existingContactId = await ds.addContact({
                name: '大雄',
                ledgerId: 1,
                uuid: 'local-contact-1',
            }, true)

            const changes = [
                {
                    operation: 'add',
                    storeName: 'contacts',
                    deviceId: 'other-device',
                    timestamp: 1000,
                    data: {
                        name: '大雄',
                        ledgerId: 1,
                        uuid: 'remote-contact-1',
                    },
                },
            ]

            const appliedKeys = await syncService.applyRemoteChanges(changes)
            expect(appliedKeys.size).toBe(1)

            const contacts = await ds.getContacts({ ledgerId: 1 })
            expect(contacts).toHaveLength(1)
            expect(contacts[0].id).toBe(existingContactId)
        })

        it('markAllRemoteChangesAsPulled 正確持久化 sync_personal_checked_map 與 sync_personal_applied_keys', async () => {
            // Mock fetch 回傳一個 sync log 檔案
            const fakeFile = {
                id: 'file-123',
                name: 'sync_log_remote.json',
                modifiedTime: '2026-08-01T12:00:00.000Z',
            }

            globalThis.fetch = vi.fn().mockImplementation(async url => {
                if (url.includes('spaces=appDataFolder')) {
                    return {
                        ok: true,
                        json: async () => ({ files: [fakeFile] }),
                    }
                }
                return { ok: false }
            })

            // Mock _downloadFile
            syncService._downloadFile = vi.fn().mockResolvedValue({
                data: {
                    changes: [
                        {
                            deviceId: 'remote-dev',
                            timestamp: 123456,
                            operation: 'add',
                            storeName: 'records',
                            recordId: 1,
                            data: { uuid: 'rec-1' },
                        },
                    ],
                },
            })

            await syncService.markAllRemoteChangesAsPulled()

            const checkedMapSetting = await ds.getSetting('sync_personal_checked_map')
            expect(checkedMapSetting).not.toBeNull()
            expect(checkedMapSetting.value['file-123']).toBe(
                new Date('2026-08-01T12:00:00.000Z').getTime()
            )

            const appliedKeysSetting = await ds.getSetting('sync_personal_applied_keys')
            expect(appliedKeysSetting).not.toBeNull()
            expect(appliedKeysSetting.value.length).toBeGreaterThan(0)
        })

        it('遠端 add 到達時若本地同名帳戶 UUID 不一致，自動對齊為遠端 UUID 並同步更新關聯明細的 accountUuid', async () => {
            // 本地帳戶（舊 UUID）
            const accId = await ds.addAccount({
                name: '國泰',
                balance: 1000,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'local-cathay-uuid',
            }, true)

            // 本地明細關聯此帳戶與舊 UUID
            const recId = await ds.addRecord({
                amount: 50,
                type: 'expense',
                date: '2026-08-01',
                accountId: accId,
                accountUuid: 'local-cathay-uuid',
                ledgerId: 1,
                category: '交通',
            }, true)

            // 遠端同步傳來同名帳戶，UUID 為 remote-cathay-uuid
            const changes = [
                {
                    operation: 'add',
                    storeName: 'accounts',
                    deviceId: 'device-b',
                    timestamp: 2000,
                    data: {
                        name: '國泰',
                        balance: 1000,
                        ledgerId: 1,
                        type: 'wallet',
                        uuid: 'remote-cathay-uuid',
                    },
                },
            ]

            await syncService.applyRemoteChanges(changes)

            // 帳戶依然只有 1 個，但 UUID 已對齊為遠端 UUID
            const accounts = await ds.getAccounts({ ledgerId: 1 })
            expect(accounts).toHaveLength(1)
            expect(accounts[0].id).toBe(accId)
            expect(accounts[0].uuid).toBe('remote-cathay-uuid')

            // 關聯紀錄的 accountUuid 也被同步對齊為 remote-cathay-uuid
            const updatedRec = await ds.getRecord(recId)
            expect(updatedRec.accountUuid).toBe('remote-cathay-uuid')
        })

        it('遠端 update 到達時即使 UUID 不一致，依同帳本同名找到本地帳戶對齊 UUID 並更新，不建立重複帳戶', async () => {
            const accId = await ds.addAccount({
                name: '富邦',
                balance: 2000,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'local-fubon-old',
            }, true)

            const changes = [
                {
                    operation: 'update',
                    storeName: 'accounts',
                    recordId: 999, // 遠端整數 ID
                    deviceId: 'device-b',
                    timestamp: 3000,
                    data: {
                        name: '富邦',
                        balance: 3500, // 更新餘額
                        ledgerId: 1,
                        type: 'wallet',
                        uuid: 'remote-fubon-new', // 遠端新 UUID
                    },
                },
            ]

            await syncService.applyRemoteChanges(changes)

            // 帳戶依然只有 1 個，餘額已更新，UUID 已對齊，絕無新增重複項
            const accounts = await ds.getAccounts({ ledgerId: 1 })
            expect(accounts).toHaveLength(1)
            expect(accounts[0].id).toBe(accId)
            expect(accounts[0].uuid).toBe('remote-fubon-new')
            expect(accounts[0].balance).toBe(3500)
        })

        it('遠端 delete 到達時即使 UUID 不一致，依同帳本同名業務鍵精確刪除本地帳戶，防止刪除脫鉤', async () => {
            await ds.addAccount({
                name: '台新',
                balance: 500,
                ledgerId: 1,
                type: 'wallet',
                uuid: 'local-taishin-old',
            }, true)

            const changes = [
                {
                    operation: 'delete',
                    storeName: 'accounts',
                    recordId: 999,
                    deviceId: 'device-b',
                    timestamp: 4000,
                    data: {
                        name: '台新',
                        ledgerId: 1,
                        uuid: 'remote-taishin-diverged-uuid',
                    },
                },
            ]

            await syncService.applyRemoteChanges(changes)

            const accounts = await ds.getAccounts({ ledgerId: 1 })
            expect(accounts.find(a => a.name === '台新')).toBeUndefined()
        })

        it('遠端 add 週期性交易到達時，若同業務特徵項目已存在則自動對齊 UUID，不產生重複週期交易', async () => {
            const rtId = await ds.addRecurringTransaction({
                description: '房租',
                amount: 15000,
                frequency: 'monthly',
                type: 'expense',
                ledgerId: 1,
                uuid: 'local-rent-uuid',
                nextDueDate: '2026-09-01',
            })

            const changes = [
                {
                    operation: 'add',
                    storeName: 'recurring_transactions',
                    deviceId: 'device-b',
                    timestamp: 5000,
                    data: {
                        description: '房租',
                        amount: 15000,
                        frequency: 'monthly',
                        type: 'expense',
                        ledgerId: 1,
                        uuid: 'remote-rent-uuid',
                        nextDueDate: '2026-09-01',
                    },
                },
            ]

            await syncService.applyRemoteChanges(changes)

            const rts = await ds.getRecurringTransactions({ ledgerId: 1 })
            expect(rts).toHaveLength(1)
            expect(rts[0].id).toBe(rtId)
            expect(rts[0].uuid).toBe('remote-rent-uuid')
        })
    })
})

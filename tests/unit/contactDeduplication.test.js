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

describe('聯絡人去重與防重整合測試 (Contact Deduplication & Idempotence)', () => {
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

    describe('DataService.prototype.deduplicateContacts', () => {
        it('自動合併同帳本同名聯絡人，將關聯 debts 與 records 轉移並刪除冗餘聯絡人', async () => {
            // 建立主聯絡人 (有 1 筆欠款與 1 筆明細)
            const c1Id = await ds.addContact({
                name: '小明',
                ledgerId: 1,
                uuid: 'contact-uuid-1',
            }, true)

            const debt1Id = await ds.addDebt({
                contactId: c1Id,
                contactUuid: 'contact-uuid-1',
                amount: 1000,
                type: 'receivable',
                ledgerId: 1,
            })

            const rec1Id = await ds.addRecord({
                amount: 1000,
                type: 'expense',
                contactId: c1Id,
                ledgerId: 1,
                date: '2026-10-01',
            })

            // 建立同名冗餘聯絡人 (有 1 筆欠款，但評分較低)
            const c2Id = await ds.addContact({
                name: '小明',
                ledgerId: 1,
                uuid: 'contact-uuid-2',
            }, true)

            const debt2Id = await ds.addDebt({
                contactId: c2Id,
                contactUuid: 'contact-uuid-2',
                amount: 500,
                type: 'payable',
                ledgerId: 1,
            })

            const res = await ds.deduplicateContacts()
            expect(res.mergedCount).toBe(1)
            expect(res.groupsProcessed).toBe(1)

            // 驗證聯絡人只剩 1 個 (主聯絡人 c1)
            const contacts = await ds.getContacts({ allLedgers: true })
            expect(contacts).toHaveLength(1)
            expect(contacts[0].id).toBe(c1Id)
            expect(contacts[0].uuid).toBe('contact-uuid-1')

            // 驗證原本 c2 關聯的 debt2 已轉移至 c1
            const updatedDebt2 = await ds.getDebt(debt2Id)
            expect(updatedDebt2.contactId).toBe(c1Id)
            expect(updatedDebt2.contactUuid).toBe('contact-uuid-1')

            // 驗證 debt1 與 rec1 依然完好
            const updatedDebt1 = await ds.getDebt(debt1Id)
            expect(updatedDebt1.contactId).toBe(c1Id)
            const updatedRec1 = await ds.getRecord(rec1Id)
            expect(updatedRec1.contactId).toBe(c1Id)
        })

        it('若主聯絡人無頭像而冗餘聯絡人有頭像，應自動繼承頭像', async () => {
            const c1Id = await ds.addContact({
                name: '大華',
                ledgerId: 1,
                uuid: 'dahwa-uuid-1',
            }, true)

            // 讓 c1 有更多欠款記錄，使其成為 primary
            await ds.addDebt({ contactId: c1Id, amount: 200, type: 'receivable', ledgerId: 1 })

            const c2Id = await ds.addContact({
                name: '大華',
                ledgerId: 1,
                uuid: 'dahwa-uuid-2',
                avatarFileId: 'avatar-file-999',
            }, true)

            await ds.deduplicateContacts()

            const contacts = await ds.getContacts({ allLedgers: true })
            expect(contacts).toHaveLength(1)
            expect(contacts[0].id).toBe(c1Id)
            expect(contacts[0].avatarFileId).toBe('avatar-file-999')
        })

        it('不同帳本的同名聯絡人不應被合併', async () => {
            const c1Id = await ds.addContact({
                name: 'Alice',
                ledgerId: 1,
                uuid: 'alice-l1',
            }, true)

            const c2Id = await ds.addContact({
                name: 'Alice',
                ledgerId: 2,
                uuid: 'alice-l2',
            }, true)

            const res = await ds.deduplicateContacts()
            expect(res.mergedCount).toBe(0)

            const contacts = await ds.getContacts({ allLedgers: true })
            expect(contacts).toHaveLength(2)
        })

        it('忽略大小寫與首尾空白進行同名辨識', async () => {
            const c1Id = await ds.addContact({
                name: 'Bob',
                ledgerId: 1,
                uuid: 'bob-1',
            }, true)

            const c2Id = await ds.addContact({
                name: '  bob  ',
                ledgerId: 1,
                uuid: 'bob-2',
            }, true)

            const res = await ds.deduplicateContacts()
            expect(res.mergedCount).toBe(1)

            const contacts = await ds.getContacts({ allLedgers: true })
            expect(contacts).toHaveLength(1)
        })
    })

    describe('匯入還原後自動去重 (importData)', () => {
        it('匯入含有重複同名聯絡人的資料包時，匯入完成後自動清理去重', async () => {
            const mockImportData = {
                metadata: { version: '2.0.0', exportDate: '2026-10-01' },
                ledgers: [{ id: 1, name: '預設帳本', isDefault: true, uuid: 'ledger-uuid-1' }],
                contacts: [
                    { id: 101, name: '測試聯絡人', ledgerId: 1, uuid: 'contact-import-1' },
                    { id: 102, name: '測試聯絡人', ledgerId: 1, uuid: 'contact-import-2' },
                ],
                debts: [
                    { id: 201, contactId: 101, contactUuid: 'contact-import-1', amount: 300, type: 'receivable', ledgerId: 1 },
                    { id: 202, contactId: 102, contactUuid: 'contact-import-2', amount: 600, type: 'payable', ledgerId: 1 },
                ],
                records: [],
                accounts: [],
            }

            const restoreFileReader = stubFileReader(JSON.stringify(mockImportData))
            try {
                const fakeFile = new File(['dummy'], 'backup.json', { type: 'application/json' })
                await ds.importData(fakeFile, { skipConfirm: true })
            } finally {
                restoreFileReader()
            }

            // 驗證 contacts 已經去重，只剩 1 個
            const contacts = await ds.getContacts({ allLedgers: true })
            expect(contacts).toHaveLength(1)
            const remainingContact = contacts[0]

            // 驗證兩筆欠款的 contactId 均指向該唯一聯絡人
            const debts = await ds.getDebts({ allLedgers: true })
            expect(debts).toHaveLength(2)
            expect(debts[0].contactId).toBe(remainingContact.id)
            expect(debts[1].contactId).toBe(remainingContact.id)
        })
    })

    describe('雲端同步時的聯絡人同名防重與跨帳本外鍵解析', () => {
        it('遠端 add 聯絡人到達時，若同名聯絡人已存在則自動對齊 UUID，不新增重複聯絡人', async () => {
            const localContactId = await ds.addContact({
                name: '阿強',
                ledgerId: 1,
                uuid: 'local-achang-old',
            }, true)

            const changes = [
                {
                    operation: 'add',
                    storeName: 'contacts',
                    deviceId: 'device-b',
                    timestamp: 1000,
                    data: {
                        name: '阿強',
                        ledgerId: 1,
                        uuid: 'remote-achang-new',
                    },
                },
            ]

            await syncService.applyRemoteChanges(changes)

            // 聯絡人依然只有 1 個，但 UUID 對齊為遠端的 remote-achang-new
            const contacts = await ds.getContacts({ ledgerId: 1 })
            expect(contacts).toHaveLength(1)
            expect(contacts[0].id).toBe(localContactId)
            expect(contacts[0].uuid).toBe('remote-achang-new')
        })

        it('syncService._resolveDebtContactId 在 activeLedgerId 與欠款帳本不同時，仍可正確查到聯絡人 ID', async () => {
            // 當前 activeLedgerId 為 1
            ds.activeLedgerId = 1

            // 在帳本 2 建立聯絡人
            const contactInL2Id = await ds.addContact({
                name: '小王',
                ledgerId: 2,
                uuid: 'uuid-xiaowang-l2',
            }, true)

            // 透過 _resolveDebtContactId 解析帳本 2 的欠款
            const resolvedData = await syncService._resolveDebtContactId({
                contactId: 999, // 遠端整數 ID
                contactUuid: 'uuid-xiaowang-l2',
                ledgerId: 2,
            })

            expect(resolvedData.contactId).toBe(contactInL2Id)
        })
    })
})

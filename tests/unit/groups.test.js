import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataService from '../../src/js/dataService.js'
import { formatDateToString } from '../../src/js/utils.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('DataService — Record Groups', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    describe('getGroupRecords()', () => {
        it('回傳指定群組的紀錄', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 300, date: '2024-01-03', groupId: 'g2', ledgerId: 1 })
            await tx.done

            const g1Records = await ds.getGroupRecords('g1')
            expect(g1Records).toHaveLength(2)
            expect(g1Records.every(r => r.groupId === 'g1')).toBe(true)

            const g2Records = await ds.getGroupRecords('g2')
            expect(g2Records).toHaveLength(1)
        })

        it('無 groupId 時回傳所有群組化的紀錄', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: null, ledgerId: 1 })
            await tx.done

            const grouped = await ds.getGroupRecords()
            expect(grouped).toHaveLength(1)
            expect(grouped[0].groupId).toBe('g1')
        })

        it('空群組回傳空陣列', async () => {
            const records = await ds.getGroupRecords('nonexistent')
            expect(records).toEqual([])
        })
    })

    describe('saveGroupMeta / getGroupMeta / getAllGroupMeta', () => {
        it('儲存並讀取群組元資料', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試群組', ledgerId: 1 })
            const meta = await ds.getGroupMeta('g1')
            expect(meta).not.toBeNull()
            expect(meta.name).toBe('測試群組')
        })

        it('getAllGroupMeta 回傳所有群組', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '群組A', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: '群組B', ledgerId: 1 })
            const all = await ds.getAllGroupMeta()
            expect(all).toHaveLength(2)
        })

        it('getAllGroupMeta 依 ledgerId 過濾', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '帳本1群組', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: '帳本2群組', ledgerId: 2 })
            const ledger1 = await ds.getAllGroupMeta(1)
            const ledger2 = await ds.getAllGroupMeta(2)
            expect(ledger1).toHaveLength(1)
            expect(ledger2).toHaveLength(1)
            expect(ledger1[0].id).toBe('g1')
            expect(ledger2[0].id).toBe('g2')
        })
    })

    describe('getGroups()', () => {
        it('回傳群組列表含統計', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 500, date: '2024-01-03', groupId: 'g1', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            expect(groups).toHaveLength(1)
            expect(groups[0].name).toBe('公款')
            expect(groups[0].totalExpense).toBe(500)
            expect(groups[0].totalIncome).toBe(500)
            expect(groups[0].netAmount).toBe(0)
            expect(groups[0].recordCount).toBe(3)
            expect(groups[0].settled).toBe(false)
        })

        it('排除 group_settlement 類別的統計', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 500, date: '2024-01-03', groupId: 'g1', category: 'group_settlement', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            expect(groups[0].totalExpense).toBe(300)
            expect(groups[0].totalIncome).toBe(0)
            expect(groups[0].netAmount).toBe(-300)
        })

        it('空群組回傳 count=0', async () => {
            await ds.saveGroupMeta({ id: 'empty', name: '空群組', ledgerId: 1 })
            const groups = await ds.getGroups()
            expect(groups).toHaveLength(1)
            expect(groups[0].recordCount).toBe(0)
            expect(groups[0].netAmount).toBe(0)
        })
    })

    describe('_calculateGroupNet()', () => {
        it('M03: 基本淨額計算', () => {
            const records = [
                { type: 'expense', amount: 300 },
                { type: 'income', amount: 500 },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(300)
            expect(result.totalIncome).toBe(500)
            expect(result.netAmount).toBe(200)
        })

        it('M03: 空陣列回傳零', () => {
            const result = ds._calculateGroupNet([])
            expect(result.totalExpense).toBe(0)
            expect(result.totalIncome).toBe(0)
            expect(result.netAmount).toBe(0)
        })

        it('M03: 排除 group_settlement 類別', () => {
            const records = [
                { type: 'expense', amount: 300 },
                { type: 'income', amount: 100, category: 'group_settlement' },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(300)
            expect(result.totalIncome).toBe(0)
            expect(result.netAmount).toBe(-300)
        })

        it('M03: 金額為 null/undefined 時視為 0', () => {
            const records = [
                { type: 'expense', amount: 300 },
                { type: 'expense', amount: null },
                { type: 'income' },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(300)
            expect(result.totalIncome).toBe(0)
        })

        it('M03: 純支出為負淨額', () => {
            const records = [
                { type: 'expense', amount: 500 },
                { type: 'expense', amount: 200 },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(700)
            expect(result.totalIncome).toBe(0)
            expect(result.netAmount).toBe(-700)
        })

        it('M03: 純收入為正淨額', () => {
            const records = [
                { type: 'income', amount: 1000 },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(0)
            expect(result.totalIncome).toBe(1000)
            expect(result.netAmount).toBe(1000)
        })

        it('M03: 浮點數精度（100.99 + 0.01）', () => {
            const records = [
                { type: 'expense', amount: 100.99 },
                { type: 'expense', amount: 0.01 },
            ]
            const result = ds._calculateGroupNet(records)
            // 浮點數加法可能有精度問題，用 closeTo 驗證
            expect(result.totalExpense).toBeCloseTo(101, 10)
        })

        it('M03: 金額為 0 時正常處理', () => {
            const records = [
                { type: 'expense', amount: 0 },
                { type: 'income', amount: 0 },
            ]
            const result = ds._calculateGroupNet(records)
            expect(result.totalExpense).toBe(0)
            expect(result.totalIncome).toBe(0)
        })
    })

    describe('settleGroup()', () => {
        it('結清群組後不產生 group_settlement 假紀錄，而是觸發真實欠款還清並標記 group.settled', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const contactId = await ds.addContact({ name: '張三' })
            const debtId = await ds.addDebt({ type: 'receivable', amount: 300, date: '2024-01-01', contactId })
            
            const recId = await ds.addRecord({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', debtId, ledgerId: 1 })

            await ds.settleGroup('g1', 300, null, '2024-06-01', '結清')

            const meta = await ds.getGroupMeta('g1')
            expect(meta.settled).toBe(true)
            expect(meta.settledAt).toBeGreaterThan(0)

            const updatedDebt = await ds.getDebt(debtId)
            expect(updatedDebt.settled).toBe(true)
            expect(updatedDebt.remainingAmount).toBe(0)

            const records = await ds.getRecords({ allLedgers: true })
            const settlementRecords = records.filter(r => r.category === 'group_settlement')
            expect(settlementRecords).toHaveLength(0)

            const repaymentRecords = records.filter(r => r.category === 'debt_collection')
            expect(repaymentRecords).toHaveLength(1)
            expect(repaymentRecords[0].amount).toBe(300)
        })
    })

    describe('partialSettleGroup()', () => {
        it('M01: null 金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', null, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: undefined 金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', undefined, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: 負數金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', -100, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: 零金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', 0, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: NaN 金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', NaN, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: Infinity 金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', Infinity, null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })

        it('M01: 字串金額拋出錯誤', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            await expect(ds.partialSettleGroup('g1', '100', null, '2024-06-01', '退款')).rejects.toThrow('部分退款金額無效')
        })
    })

    describe('跨帳本隔離', () => {
        it('getGroups 只回傳 activeLedgerId 的群組', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '帳本1群組', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: '帳本2群組', ledgerId: 2 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g2', ledgerId: 2 })
            await tx.done

            const groups1 = await ds.getGroups(1)
            expect(groups1).toHaveLength(1)
            expect(groups1[0].name).toBe('帳本1群組')

            const groups2 = await ds.getGroups(2)
            expect(groups2).toHaveLength(1)
            expect(groups2[0].name).toBe('帳本2群組')
        })

        it('getGroupRecords 依 ledgerId 過濾', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g1', ledgerId: 2 })
            await tx.done

            const ledger1Records = await ds.getGroupRecords('g1', 1)
            const ledger2Records = await ds.getGroupRecords('g1', 2)
            expect(ledger1Records).toHaveLength(1)
            expect(ledger2Records).toHaveLength(1)
        })
    })

    describe('匯出/匯入完整性', () => {
        it('匯出包含 groupMeta', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '群組A', ledgerId: 1 })
            const backup = await ds._exportFullBackup()
            expect(backup.groupMeta).toBeDefined()
            expect(backup.groupMeta).toHaveLength(1)
            expect(backup.groupMeta[0].name).toBe('群組A')
        })

        it('匯入還原後 groupMeta 一致', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '原始群組', ledgerId: 1 })
            const backup = await ds._exportFullBackup()

            await ds._restoreFromBackup(backup)

            const restored = await ds.getAllGroupMeta()
            expect(restored).toHaveLength(1)
            expect(restored[0].name).toBe('原始群組')
        })
    })

    describe('getGroups Map 聚合', () => {
        it('多群組多紀錄時使用 Map 正確聚合', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '聚餐', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: '旅行', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 500, date: '2024-01-01', groupId: 'g2', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 300, date: '2024-01-01', groupId: 'g2', ledgerId: 1 })
            // 無群組的紀錄
            await tx.store.add({ type: 'expense', amount: 50, date: '2024-01-01', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            expect(groups).toHaveLength(2)

            const g1 = groups.find(g => g.id === 'g1')
            expect(g1.recordCount).toBe(2)
            expect(g1.totalExpense).toBe(300)
            expect(g1.totalIncome).toBe(0)

            const g2 = groups.find(g => g.id === 'g2')
            expect(g2.recordCount).toBe(2)
            expect(g2.totalExpense).toBe(500)
            expect(g2.totalIncome).toBe(300)
        })

        it('deleteGroupMeta 後 records 已 unlink', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '測試', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.done

            await ds.deleteGroupMeta('g1')

            const meta = await ds.getGroupMeta('g1')
            expect(meta).toBeNull()

            const records = await ds.getRecords({ allLedgers: true })
            const linkedRecords = records.filter(r => r.groupId === 'g1')
            expect(linkedRecords).toHaveLength(0)
        })

        it('clearAllGroupMeta 清除 meta 並 unlink 所有 records', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: 'A', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: 'B', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g2', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 50, date: '2024-01-01', ledgerId: 1 })
            await tx.done

            await ds.clearAllGroupMeta()

            const metas = await ds.getAllGroupMeta()
            expect(metas).toHaveLength(0)

            const records = await ds.getRecords({ allLedgers: true })
            const linkedRecords = records.filter(r => r.groupId)
            expect(linkedRecords).toHaveLength(0)
        })
    })

    describe('settleGroup() 進階', () => {
        it('群組不存在時拋錯', async () => {
            await expect(ds.settleGroup('nonexistent', null, null, '2024-06-01', '結清')).rejects.toThrow('Group not found')
        })

        it('保留 meta 原有欄位（name、createdAt）', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', createdAt: 1000, ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.done

            await ds.settleGroup('g1', 300, null, '2024-06-01', '結清')

            const meta = await ds.getGroupMeta('g1')
            expect(meta.name).toBe('公款')
            expect(meta.createdAt).toBe(1000)
            expect(meta.settled).toBe(true)
        })
    })

    describe('partialSettleGroup() 進階', () => {
        it('群組不存在時拋錯', async () => {
            await expect(ds.partialSettleGroup('nonexistent', 100, null, '2024-06-01', '退款')).rejects.toThrow('Group not found')
        })

        it('能對群組內欠款進行部分分攤還款', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const contactId = await ds.addContact({ name: '王五' })
            const debtId = await ds.addDebt({ type: 'receivable', amount: 500, date: '2024-01-01', contactId })
            await ds.addRecord({ type: 'expense', amount: 500, date: '2024-01-01', groupId: 'g1', debtId, ledgerId: 1 })

            const res = await ds.partialSettleGroup('g1', 200, null, '2024-06-01', '部分還款')
            expect(res.amount).toBe(200)

            const updatedDebt = await ds.getDebt(debtId)
            expect(updatedDebt.remainingAmount).toBe(300)
            expect(updatedDebt.settled).toBe(false)
        })
    })

    describe('getGroups() dateFrom/dateTo/recordIds', () => {
        it('dateFrom 等於最小日期、dateTo 等於最大日期', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-03', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            expect(groups[0].dateFrom).toBe('2024-01-01')
            expect(groups[0].dateTo).toBe('2024-01-03')
        })

        it('空群組 dateFrom/dateTo 為 null', async () => {
            await ds.saveGroupMeta({ id: 'empty', name: '空群組', ledgerId: 1 })
            const groups = await ds.getGroups()
            expect(groups[0].dateFrom).toBeNull()
            expect(groups[0].dateTo).toBeNull()
        })

        it('recordIds 陣列包含該群組所有紀錄 ID', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            const id1 = await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            const id2 = await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            // recordIds 排序跟 getRecords 一致 (date desc → timestamp desc → id desc)
            // id2 (2024-01-02) 比較晚，排在前面
            expect(groups[0].recordIds).toContain(id1)
            expect(groups[0].recordIds).toContain(id2)
            expect(groups[0].recordIds).toHaveLength(2)
        })
    })

    describe('unlinkRecordsFromGroup()', () => {
        it('呼叫後 record.groupId 和 groupStatus 都為 null', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', groupStatus: 'active', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: 'g1', groupStatus: 'active', ledgerId: 1 })
            await tx.done

            await ds.unlinkRecordsFromGroup('g1')

            const records = await ds.getRecords({ allLedgers: true })
            expect(records).toHaveLength(2)
            expect(records.every(r => r.groupId === null)).toBe(true)
            expect(records.every(r => r.groupStatus === null)).toBe(true)
        })

        it('非存在群組的 unlink 呼叫不報錯', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', ledgerId: 1 })
            await tx.done

            await expect(ds.unlinkRecordsFromGroup('nonexistent')).resolves.toBeUndefined()
            const records = await ds.getRecords({ allLedgers: true })
            expect(records).toHaveLength(1)
        })
    })

    describe('群組生命周期整合', () => {
        it('完整生命周期：建立 → 支出 → 部分退款 → 結清', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.done

            let groups = await ds.getGroups()
            expect(groups[0].netAmount).toBe(-500)

            await ds.partialSettleGroup('g1', 100, null, '2024-06-01', '部分退款')

            groups = await ds.getGroups()
            expect(groups[0].netAmount).toBe(-500)
            expect(groups[0].settled).toBe(false)

            await ds.settleGroup('g1', null, null, '2024-06-02', '結清')

            const meta = await ds.getGroupMeta('g1')
            expect(meta.settled).toBe(true)
        })

        it('多筆 group_settlement 紀錄在 getGroups 中都被排除', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 500, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 100, date: '2024-01-05', groupId: 'g1', category: 'group_settlement', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 200, date: '2024-01-06', groupId: 'g1', category: 'group_settlement', ledgerId: 1 })
            await tx.done

            const groups = await ds.getGroups()
            expect(groups[0].totalIncome).toBe(0)
            expect(groups[0].totalExpense).toBe(500)
            expect(groups[0].netAmount).toBe(-500)
        })
    })

    describe('saveGroupMeta 更新', () => {
        it('更新已有群組名稱，保留 createdAt', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '舊名稱', createdAt: 1000, ledgerId: 1 })

            const meta = await ds.getGroupMeta('g1')
            await ds.saveGroupMeta({ ...meta, name: '新名稱' })

            const updated = await ds.getGroupMeta('g1')
            expect(updated.name).toBe('新名稱')
            expect(updated.createdAt).toBe(1000)
            expect(updated.ledgerId).toBe(1)
        })
    })

    describe('邊界情境', () => {
        it('getGroupRecords 跨帳本隔離（預設使用 activeLedgerId，可指定 ledgerId）', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-01', groupId: 'g1', ledgerId: 2 })
            await tx.done

            const defaultRecords = await ds.getGroupRecords('g1')
            expect(defaultRecords).toHaveLength(1)
            expect(defaultRecords[0].ledgerId).toBe(1)

            const ledger2Records = await ds.getGroupRecords('g1', 2)
            expect(ledger2Records).toHaveLength(1)
            expect(ledger2Records[0].ledgerId).toBe(2)
        })

        it('getAllGroupMeta 無參數時回傳所有帳本群組', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '帳本1群組', ledgerId: 1 })
            await ds.saveGroupMeta({ id: 'g2', name: '帳本2群組', ledgerId: 2 })

            const all = await ds.getAllGroupMeta()
            expect(all).toHaveLength(2)
        })

        it('getGroupRecords(undefined) 排除沒有 groupId 欄位的紀錄', async () => {
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            // 沒有 groupId 欄位的紀錄
            await tx.store.add({ type: 'expense', amount: 200, date: '2024-01-02', ledgerId: 1 })
            // groupId 為 null 的紀錄
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-03', groupId: null, ledgerId: 1 })
            await tx.done

            const records = await ds.getGroupRecords(undefined)
            // 只有 groupId='g1' 的紀錄被納入
            expect(records).toHaveLength(1)
            expect(records[0].groupId).toBe('g1')
        })

        it('匯入還原後 groupMeta 保留原始 id', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', createdAt: 1000, ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.done

            const backup = await ds._exportFullBackup()
            await ds._restoreFromBackup(backup)

            // 還原後 groupMeta 'g1' 仍可取得
            const meta = await ds.getGroupMeta('g1')
            expect(meta).toBeDefined()
            expect(meta.name).toBe('公款')
            expect(meta.createdAt).toBe(1000)
            // 紀錄仍關聯
            const groupRecords = await ds.getGroupRecords('g1')
            expect(groupRecords).toHaveLength(1)
        })
    })

    describe('settleGroupRecord()', () => {
        it('能對群組內單筆紀錄進行個別結清並自動更新待結清淨額', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '旅遊分帳', ledgerId: 1 })
            const contactId = await ds.addContact({ name: '李四' })
            const debt1 = await ds.addDebt({ type: 'receivable', amount: 300, date: '2024-01-01', contactId })
            const debt2 = await ds.addDebt({ type: 'receivable', amount: 200, date: '2024-01-02', contactId })

            const r1Id = await ds.addRecord({ type: 'expense', amount: 300, date: '2024-01-01', description: '景點門票', groupId: 'g1', debtId: debt1, groupStatus: 'active', ledgerId: 1 })
            const r2Id = await ds.addRecord({ type: 'expense', amount: 200, date: '2024-01-02', description: '午餐', groupId: 'g1', debtId: debt2, groupStatus: 'active', ledgerId: 1 })

            let groups = await ds.getGroups()
            expect(groups[0].netAmount).toBe(-500) // 代墊 500

            // 個別結清 r1 (300)
            await ds.settleGroupRecord(r1Id)
            const r1Updated = (await ds.getRecords({ allLedgers: true })).find(r => r.id === r1Id)
            expect(r1Updated.groupStatus).toBe('settled')

            const d1Updated = await ds.getDebt(debt1)
            expect(d1Updated.settled).toBe(true)
            expect(d1Updated.settled).toBe(true)

            groups = await ds.getGroups()
            expect(groups[0].netAmount).toBe(-200) // 扣除已結清後剩餘 200 待結清
            expect(groups[0].settled).toBe(false)

            // 個別結清 r2 (200)
            await ds.settleGroupRecord(r2Id)
            groups = await ds.getGroups()
            expect(groups[0].netAmount).toBe(0)
            expect(groups[0].settled).toBe(true) // 全部紀錄皆已結清，自動標記群組為 settled
        })
    })

    describe('_ensureGroupMetaStore() Hot-Upgrade', () => {
        it('當資料庫缺乏 groupMeta store 時，自動執行熱升級建立該 store 且不拋錯', async () => {
            if (!ds.db || !ds.db.objectStoreNames) return
            const orig = ds.db.objectStoreNames.contains ? ds.db.objectStoreNames.contains.bind(ds.db.objectStoreNames) : () => true
            ds.db.objectStoreNames.contains = (name) => {
                if (name === 'groupMeta') return false
                return orig(name)
            }

            await ds.saveGroupMeta({ id: 'g99', name: '恢復測試', ledgerId: 1 })
            const meta = await ds.getGroupMeta('g99')
            expect(meta).toBeDefined()
            expect(meta.name).toBe('恢復測試')
        })
    })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataService from '../../src/js/dataService.js'

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

    describe('settleGroup()', () => {
        it('結清群組後產生 group_settlement 紀錄並標記 settled', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 300, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.done

            await ds.settleGroup('g1', 300, null, '2024-06-01', '結清')

            const meta = await ds.getGroupMeta('g1')
            expect(meta.settled).toBe(true)
            expect(meta.settledAt).toBeGreaterThan(0)

            const records = await ds.getRecords({ allLedgers: true })
            const settlementRecords = records.filter(r => r.category === 'group_settlement')
            expect(settlementRecords).toHaveLength(1)
            expect(settlementRecords[0].amount).toBe(300)
            expect(settlementRecords[0].groupId).toBe('g1')
        })

        it('淨額為負時產生收入紀錄', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 500, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.done

            await ds.settleGroup('g1', 500, null, '2024-06-01', '結清')
            const records = await ds.getRecords({ allLedgers: true })
            const settle = records.find(r => r.category === 'group_settlement')
            expect(settle.type).toBe('income')
        })
    })

    describe('partialSettleGroup()', () => {
        it('我代墊（支出多）時部分退款產生 income 紀錄', async () => {
            await ds.saveGroupMeta({ id: 'g1', name: '公款', ledgerId: 1 })
            // 加入支出紀錄（我代墊）
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'expense', amount: 500, date: '2024-01-01', groupId: 'g1', ledgerId: 1 })
            await tx.store.add({ type: 'income', amount: 100, date: '2024-01-02', groupId: 'g1', ledgerId: 1 })
            await tx.done

            const record = await ds.partialSettleGroup('g1', 100, null, '2024-06-01', '部分退款')
            // netAmount = 100 - 500 = -400 < 0 → income（有人還我）
            expect(record.type).toBe('income')
            expect(record.category).toBe('group_settlement')
            expect(record.amount).toBe(100)
            expect(record.groupStatus).toBe('active')

            const meta = await ds.getGroupMeta('g1')
            expect(meta.settled).not.toBe(true)
        })

        it('我多拿（收入多）時部分退款產生 expense 紀錄', async () => {
            await ds.saveGroupMeta({ id: 'g2', name: '公費聚餐', ledgerId: 1 })
            // 加入收入紀錄（我多拿）
            const tx = ds.db.transaction('records', 'readwrite')
            await tx.store.add({ type: 'income', amount: 300, date: '2024-01-01', groupId: 'g2', ledgerId: 1 })
            await tx.store.add({ type: 'expense', amount: 50, date: '2024-01-02', groupId: 'g2', ledgerId: 1 })
            await tx.done

            const record = await ds.partialSettleGroup('g2', 80, null, '2024-06-01', '退款')
            // netAmount = 300 - 50 = 250 >= 0 → expense（我退錢）
            expect(record.type).toBe('expense')
            expect(record.category).toBe('group_settlement')
            expect(record.amount).toBe(80)
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
})

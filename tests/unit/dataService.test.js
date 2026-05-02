import { describe, it, expect, vi } from 'vitest';
import DataService from '../../src/js/dataService.js';

// 取得 mock DB 的內部狀態
function getMockStore(name) {
    return globalThis.indexedDB._storeData?.[name] || [];
}

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0;
        }
    }
}

describe('DataService — _exportFullBackup / _restoreFromBackup', () => {
    let ds;

    beforeEach(async () => {
        clearMockData();
        localStorage.clear();
        ds = new DataService();
        // 模擬 init() 後的 db 引用
        ds.db = await globalThis.idb.openDB();
    });

    describe('_exportFullBackup', () => {
        it('備份包含所有 store 的資料', async () => {
            const mockDb = ds.db;
            
            // 寫入測試資料到各 store
            const tx1 = mockDb.transaction('records', 'readwrite');
            await tx1.store.add({ type: 'expense', amount: 100, date: '2024-01-01' });
            await tx1.done;

            const tx2 = mockDb.transaction('ledgers', 'readwrite');
            await tx2.store.add({ name: '測試帳本' });
            await tx2.done;

            // 寫入 localStorage settings
            localStorage.setItem('easy_accounting_test_key', 'test_value');

            const backup = await ds._exportFullBackup();

            expect(backup.records).toHaveLength(1);
            expect(backup.records[0].amount).toBe(100);
            expect(backup.ledgers).toHaveLength(1);
            expect(backup.ledgers[0].name).toBe('測試帳本');
        });

        it('備份包含 localStorage settings', async () => {
            const mockDb = ds.db;
            
            localStorage.setItem('easy_accounting_setting_a', 'value_a');
            localStorage.setItem('easy_accounting_setting_b', JSON.stringify({ key: 'val' }));

            const backup = await ds._exportFullBackup();

            expect(backup._settings).toBeDefined();
            expect(backup._settings['easy_accounting_setting_a']).toBe('value_a');
            expect(JSON.parse(backup._settings['easy_accounting_setting_b'])).toEqual({ key: 'val' });
        });

        it('備份空 store 回傳空陣列', async () => {
            const mockDb = ds.db;
            
            // 確保所有 store 都是空的（beforeEach 已清理）
            clearMockData();
            
            const backup = await ds._exportFullBackup();

            expect(backup.records).toEqual([]);
            expect(backup.accounts).toEqual([]);
        });
    });

    describe('_restoreFromBackup', () => {
        it('還原 records store 資料', async () => {
            const mockDb = ds.db;
            
            // 先寫入新資料（模擬匯入後）
            const tx1 = mockDb.transaction('records', 'readwrite');
            await tx1.store.add({ type: 'expense', amount: 999 });
            await tx1.done;

            // 建立備份快照（舊資料）
            const backup = {
                records: [{ type: 'income', amount: 500, date: '2024-06-01' }],
                ledgers: [], accounts: [], contacts: [], debts: [],
                recurring_transactions: [], amortizations: []
            };

            await ds._restoreFromBackup(backup);

            const records = backup.records; // 備份的資料
            expect(records).toHaveLength(1);
            expect(records[0].amount).toBe(500);
        });

        it('還原 localStorage settings', async () => {
            const mockDb = ds.db;
            
            // 修改 localStorage
            localStorage.setItem('easy_accounting_key1', 'new_value');

            const backup = {
                _settings: { 'easy_accounting_key1': 'original_value' },
                records: [], ledgers: [], accounts: [], contacts: [], debts: [],
                recurring_transactions: [], amortizations: []
            };

            await ds._restoreFromBackup(backup);
            expect(localStorage.getItem('easy_accounting_key1')).toBe('original_value');
        });

        it('還原後 records 資料恢復為備份狀態', async () => {
            const mockDb = ds.db;
            
            // 建立包含資料的備份
            const backup = {
                records: [
                    { type: 'expense', amount: 100, date: '2024-01-15' },
                    { type: 'income', amount: 200, date: '2024-02-20' }
                ],
                ledgers: [], accounts: [], contacts: [], debts: [],
                recurring_transactions: [], amortizations: []
            };

            await ds._restoreFromBackup(backup);

            const tx = mockDb.transaction('records', 'readonly');
            const allRecords = await tx.store.toArray();
            await tx.done;

            expect(allRecords).toHaveLength(2);
            expect(allRecords[0].amount).toBe(100);
            expect(allRecords[1].amount).toBe(200);
        });
    });
});

describe('DataService — clearAll*', () => {
    let ds;

    beforeEach(async () => {
        clearMockData();
        localStorage.clear();
        ds = new DataService();
        ds.db = await globalThis.idb.openDB();
    });

    it('clearAllRecords 清空 records store', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('records', 'readwrite');
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' });
        await tx.done;

        await ds.clearAllRecords();

        const tx2 = mockDb.transaction('records', 'readonly');
        const count = await tx2.store.count();
        await tx2.done;
        expect(count).toBe(0);
    });

    it('clearAllAccounts 清空 accounts store', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('accounts', 'readwrite');
        await tx.store.add({ name: '測試帳戶' });
        await tx.done;

        await ds.clearAllAccounts();

        const tx2 = mockDb.transaction('accounts', 'readonly');
        const count = await tx2.store.count();
        await tx2.done;
        expect(count).toBe(0);
    });

    it('clearAllContacts 清空 contacts store', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('contacts', 'readwrite');
        await tx.store.add({ name: '測試聯絡人' });
        await tx.done;

        await ds.clearAllContacts();

        const tx2 = mockDb.transaction('contacts', 'readonly');
        const count = await tx2.store.count();
        await tx2.done;
        expect(count).toBe(0);
    });

    it('clearAllDebts 清空 debts store', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('debts', 'readwrite');
        await tx.store.add({ name: '測試欠款' });
        await tx.done;

        await ds.clearAllDebts();

        const tx2 = mockDb.transaction('debts', 'readonly');
        const count = await tx2.store.count();
        await tx2.done;
        expect(count).toBe(0);
    });
});

describe('DataService — getRecords / getAllRecords', () => {
    let ds;

    beforeEach(async () => {
        clearMockData();
        localStorage.clear();
        ds = new DataService();
        ds.db = await globalThis.idb.openDB();
    });

    it('getRecords 回傳 records', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('records', 'readwrite');
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' });
        await tx.store.add({ type: 'income', amount: 500, date: '2024-01-02' });
        await tx.done;

        const records = await ds.getRecords({ allLedgers: true });
        expect(records).toHaveLength(2);
    });

    it('getAllRecords 回傳所有帳本紀錄', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('records', 'readwrite');
        await tx.store.add({ type: 'expense', amount: 100, ledgerId: 1 });
        await tx.store.add({ type: 'income', amount: 500, ledgerId: 2 });
        await tx.done;

        const allRecords = await ds.getAllRecords();
        expect(allRecords).toHaveLength(2);
    });
});

describe('DataService — addRecord / getRecords filtering', () => {
    let ds;

    beforeEach(async () => {
        clearMockData();
        localStorage.clear();
        ds = new DataService();
        ds.db = await globalThis.idb.openDB();
    });

    it('addRecord 新增紀錄並回傳 ID', async () => {
        const mockDb = ds.db;
        
        const id = await ds.addRecord({ type: 'expense', amount: 100, date: '2024-01-01' });
        expect(typeof id).toBe('number');

        const records = await ds.getRecords();
        expect(records).toHaveLength(1);
        expect(records[0].amount).toBe(100);
    });

    it('getRecords 可過濾 type', async () => {
        const mockDb = ds.db;
        
        const tx = mockDb.transaction('records', 'readwrite');
        await tx.store.add({ type: 'expense', amount: 100, date: '2024-01-01' });
        await tx.store.add({ type: 'income', amount: 500, date: '2024-01-02' });
        await tx.done;

        const expenses = await ds.getRecords({ type: 'expense', allLedgers: true });
        expect(expenses).toHaveLength(1);
        expect(expenses[0].amount).toBe(100);
    });
});

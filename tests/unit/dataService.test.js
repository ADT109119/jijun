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
            
            // 先寫入不同資料（模擬匯入前的 DB 狀態）
            const tx1 = mockDb.transaction('records', 'readwrite');
            await tx1.store.add({ type: 'expense', amount: 999 });
            await tx1.done;

            // 建立備份快照（還原目標資料）
            const backup = {
                records: [{ type: 'income', amount: 500, date: '2024-06-01' }],
                ledgers: [], accounts: [], contacts: [], debts: [],
                recurring_transactions: [], amortizations: []
            };

            await ds._restoreFromBackup(backup);

            // 從 DB 重新讀出，驗證 DB 狀態確實已被還原
            const tx2 = mockDb.transaction('records', 'readonly');
            const allRecords = await tx2.store.toArray();
            await tx2.done;

            expect(allRecords).toHaveLength(1);
            expect(allRecords[0].amount).toBe(500);
            expect(allRecords[0].type).toBe('income');
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

describe('DataService — Credit Card (Schema v13)', () => {
    let ds;

    beforeEach(async () => {
        clearMockData();
        localStorage.clear();
        ds = new DataService();
        ds.db = await globalThis.idb.openDB();
    });

    describe('addAccount with credit_card type', () => {
        it('新增信用卡帳戶應有正確預設值', async () => {
            const id = await ds.addAccount({
                name: 'Test Credit Card',
                icon: 'fa-credit-card',
                balance: 0,
                type: 'credit_card',
                color: '#ff0000'
            });
            expect(typeof id).toBe('number');

            const account = await ds.getAccount(id);
            expect(account.type).toBe('credit_card');
            expect(account.creditLimit).toBe(0);
            expect(account.statementDay).toBe(25);
            expect(account.dueDay).toBe(15);
        });

        it('信用卡可自訂 creditLimit', async () => {
            const id = await ds.addAccount({
                name: 'Premium Card',
                icon: 'fa-credit-card',
                balance: 0,
                type: 'credit_card',
                creditLimit: 50000,
                statementDay: 20,
                dueDay: 10,
                color: '#00ff00'
            });

            const account = await ds.getAccount(id);
            expect(account.creditLimit).toBe(50000);
            expect(account.statementDay).toBe(20);
            expect(account.dueDay).toBe(10);
        });

        it('普通帳戶不應有信用卡欄位預設值', async () => {
            const id = await ds.addAccount({
                name: '現金',
                icon: 'fa-wallet',
                balance: 1000,
                color: '#0000ff'
            });

            const account = await ds.getAccount(id);
            expect(account.type).toBe('wallet');
            expect(account.creditLimit).toBeUndefined();
        });
    });

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
                createdAt: Date.now()
            });
            expect(typeof id).toBe('number');

            const stmt = await ds.getCreditStatement(id);
            expect(stmt).not.toBeNull();
            expect(stmt.amount).toBe(1000);
            expect(stmt.status).toBe('unpaid');
            expect(stmt.period).toBe('2024-06');
        });

        it('新增帳單時自動產生 uuid', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1,
                period: '2024-06',
                amount: 500,
                status: 'unpaid',
                createdAt: Date.now()
            });

            const stmt = await ds.getCreditStatement(id);
            expect(stmt.uuid).toBeDefined();
            expect(stmt.uuid).toHaveLength(36);
        });
    });

    describe('getCreditStatements', () => {
        beforeEach(async () => {
            const mockDb = ds.db;
            const tx = mockDb.transaction('credit_statements', 'readwrite');
            await tx.store.add({
                id: 1, accountId: 1, period: '2024-06', amount: 1000,
                status: 'unpaid', createdAt: Date.now(), ledgerId: 1
            });
            await tx.store.add({
                id: 2, accountId: 1, period: '2024-05', amount: 500,
                status: 'paid', createdAt: Date.now(), ledgerId: 1
            });
            await tx.store.add({
                id: 3, accountId: 2, period: '2024-06', amount: 2000,
                status: 'unpaid', createdAt: Date.now(), ledgerId: 1
            });
            await tx.done;
            // Set activeLedgerId so the ledger filter works
            ds.activeLedgerId = 1;
        });

        it('回傳所有帳單 (allLedgers)', async () => {
            const statements = await ds.getCreditStatements({ allLedgers: true });
            expect(statements).toHaveLength(3);
        });

        it('可過濾 accountId', async () => {
            const statements = await ds.getCreditStatements({ accountId: 2, allLedgers: true });
            expect(statements).toHaveLength(1);
            expect(statements[0].accountId).toBe(2);
        });

        it('可過濾 status', async () => {
            const unpaid = await ds.getCreditStatements({ status: 'unpaid', allLedgers: true });
            expect(unpaid).toHaveLength(2);
            unpaid.forEach(s => expect(s.status).toBe('unpaid'));
        });

        it('可過濾 period', async () => {
            const june = await ds.getCreditStatements({ period: '2024-06', allLedgers: true });
            expect(june).toHaveLength(2);
            june.forEach(s => expect(s.period).toBe('2024-06'));
        });

        it('多條件過濾', async () => {
            const filtered = await ds.getCreditStatements({
                accountId: 1,
                status: 'unpaid',
                allLedgers: true
            });
            expect(filtered).toHaveLength(1);
            expect(filtered[0].amount).toBe(1000);
        });

        it('不使用 allLedgers 時只回傳當前帳本', async () => {
            // Add a statement for a different ledger
            const mockDb = ds.db;
            const tx = mockDb.transaction('credit_statements', 'readwrite');
            await tx.store.add({
                id: 4, accountId: 1, period: '2024-07', amount: 3000,
                status: 'unpaid', createdAt: Date.now(), ledgerId: 99
            });
            await tx.done;

            // Without allLedgers, only activeLedgerId (1) should be returned
            const statements = await ds.getCreditStatements({});
            expect(statements).toHaveLength(3); // only ledgerId 1
        });
    });

    describe('updateCreditStatement', () => {
        it('更新帳單狀態為已繳', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1, period: '2024-06', amount: 1000,
                status: 'unpaid', createdAt: Date.now()
            });

            const updated = await ds.updateCreditStatement(id, { status: 'paid' });
            expect(updated.status).toBe('paid');

            const fetched = await ds.getCreditStatement(id);
            expect(fetched.status).toBe('paid');
        });

        it('更新不存在的帳單拋出錯誤', async () => {
            await expect(ds.updateCreditStatement(9999, { status: 'paid' }))
                .rejects.toThrow('Credit statement not found');
        });
    });

    describe('deleteCreditStatement', () => {
        it('刪除帳單', async () => {
            const id = await ds.addCreditStatement({
                accountId: 1, period: '2024-06', amount: 1000,
                status: 'unpaid', createdAt: Date.now()
            });

            const result = await ds.deleteCreditStatement(id);
            expect(result).toBe(true);

            const stmt = await ds.getCreditStatement(id);
            expect(stmt).toBeNull();
        });
    });

    describe('clearAllCreditStatements', () => {
        it('清除所有信用卡帳單', async () => {
            await ds.addCreditStatement({
                accountId: 1, period: '2024-06', amount: 1000,
                status: 'unpaid', createdAt: Date.now()
            });
            await ds.addCreditStatement({
                accountId: 1, period: '2024-05', amount: 500,
                status: 'paid', createdAt: Date.now()
            });

            const result = await ds.clearAllCreditStatements();
            expect(result).toBe(true);

            const statements = await ds.getCreditStatements({ allLedgers: true });
            expect(statements).toHaveLength(0);
        });
    });

    describe('getStatementPeriod', () => {
        it('計算正確的帳單週期', () => {
            const account = { statementDay: 25 };
            const { startDate, endDate } = ds.getStatementPeriod(account, '2024-06');

            // 6/26 ~ 7/25
            expect(startDate.getFullYear()).toBe(2024);
            expect(startDate.getMonth()).toBe(5); // June (0-indexed)
            expect(startDate.getDate()).toBe(26);

            expect(endDate.getFullYear()).toBe(2024);
            expect(endDate.getMonth()).toBe(6); // July
            expect(endDate.getDate()).toBe(25);
        });

        it('使用預設帳單日 (25)', () => {
            const account = {};
            const { startDate, endDate } = ds.getStatementPeriod(account, '2024-01');

            // 1/26 ~ 2/25
            expect(startDate.getDate()).toBe(26);
            expect(endDate.getMonth()).toBe(1); // February
        });

        it('跨年帳單週期', () => {
            const account = { statementDay: 25 };
            const { startDate, endDate } = ds.getStatementPeriod(account, '2024-12');

            expect(startDate.getFullYear()).toBe(2024);
            expect(endDate.getFullYear()).toBe(2025);
        });
    });

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
                ledgerId: 1
            });
            ds.activeLedgerId = 1;

            // 模擬當前時間為 2026-06-20 (小於 25 日，表示 6 月期的帳單(5/26 ~ 6/25) 尚未到期)
            // 最近一個已出帳期別應該是 5 月期(4/26 ~ 5/25)，期別字串 '2026-04'
            const originalDate = globalThis.Date;
            
            // 模擬現在是 2026-06-20
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-06-20T12:00:00');
                    }
                    return new originalDate(...args);
                }
                static now() {
                    return new originalDate('2026-06-20T12:00:00').getTime();
                }
            };

            try {
                // 執行自動產生
                await ds.autoGenerateCreditStatements();

                // 2026-06-20 這天，不應該產生 2026-05 的帳單（因為其結束日是 2026-06-25，還沒到！）
                // 此時只能產生 2026-04 期（結束日是 2026-05-25，已過）
                const statements = await ds.getCreditStatements({ accountId: cardId, allLedgers: true });
                // 確保只產生了 2026-04 的帳單，沒有 2026-05
                expect(statements.map(s => s.period)).toContain('2026-04');
                expect(statements.map(s => s.period)).not.toContain('2026-05');

                const stmt04 = statements.find(s => s.period === '2026-04');
                // 2026-04 期 (4/26 ~ 5/25) 結帳，繳款日是 6 月 15 日
                const due = new originalDate(stmt04.dueDate);
                expect(due.getFullYear()).toBe(2026);
                expect(due.getMonth()).toBe(5); // 6月 (0-indexed)
                expect(due.getDate()).toBe(15);
            } finally {
                // 還原 Date
                globalThis.Date = originalDate;
            }
        });

        it('在結帳日後應自動產生帳單，且計算出正確的下月截止日', async () => {
            const cardId = await ds.addAccount({
                name: '台新卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#abcdef',
                ledgerId: 1
            });
            ds.activeLedgerId = 1;

            const originalDate = globalThis.Date;
            
            // 模擬現在是 2026-06-28 (大於 25 日，此時 6 月期(5/26 ~ 6/25) 的帳單應出帳，期別名稱 '2026-05')
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-06-28T12:00:00');
                    }
                    return new originalDate(...args);
                }
                static now() {
                    return new originalDate('2026-06-28T12:00:00').getTime();
                }
            };

            try {
                await ds.autoGenerateCreditStatements();

                const statements = await ds.getCreditStatements({ accountId: cardId, allLedgers: true });
                // 應包含 2026-05 帳單 (5/26 ~ 6/25 結帳)
                expect(statements.map(s => s.period)).toContain('2026-05');
                
                const stmt05 = statements.find(s => s.period === '2026-05');
                // 繳款截止日應是結帳日 6/25 的下個月 15 日，即 7 月 15 日
                const due = new originalDate(stmt05.dueDate);
                expect(due.getFullYear()).toBe(2026);
                expect(due.getMonth()).toBe(6); // 7月 (0-indexed)
                expect(due.getDate()).toBe(15);
            } finally {
                globalThis.Date = originalDate;
            }
        });
        it('12 月結帳應正確進位至隔年 1 月的繳款日', async () => {
            const cardId = await ds.addAccount({
                name: '跨年測試卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#ff0000',
                ledgerId: 1
            });
            ds.activeLedgerId = 1;

            const originalDate = globalThis.Date;
            
            // 模擬現在是 2026-12-28 (大於 25 日，此時 12 月結帳的帳單應出帳，結束日是 12/25)
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-12-28T12:00:00');
                    }
                    return new originalDate(...args);
                }
                static now() {
                    return new originalDate('2026-12-28T12:00:00').getTime();
                }
            };

            try {
                await ds.autoGenerateCreditStatements();

                const statements = await ds.getCreditStatements({ accountId: cardId, allLedgers: true });
                // 應包含 11 月期 (11/26 ~ 12/25 結帳)
                expect(statements.map(s => s.period)).toContain('2026-11');
                
                const stmt11 = statements.find(s => s.period === '2026-11');
                // 繳款截止日應是結帳日 12/25 的下個月 15 日，即 2027 年 1 月 15 日
                const due = new originalDate(stmt11.dueDate);
                expect(due.getFullYear()).toBe(2027); // 正確跨年
                expect(due.getMonth()).toBe(0); // 1月 (0-indexed)
                expect(due.getDate()).toBe(15);
            } finally {
                globalThis.Date = originalDate;
            }
        });
    });

    describe('calculateCreditCardBalance (結帳日邊界與時區防禦)', () => {
        it('應正確包含結帳日當天的消費，不受 JS 預設 UTC 時區解析的干擾', async () => {
            const cardId = await ds.addAccount({
                name: '時區測試卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                color: '#654321',
                ledgerId: 1
            });

            // 建立該信用卡的消費紀錄
            const tx = ds.db.transaction('records', 'readwrite');
            // 週期 2024-05 為 5/26 ~ 6/25
            // 寫入 6/25 (結帳日當天) 的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-06-25',
                amount: 888,
                type: 'expense',
                ledgerId: 1
            });
            // 寫入 5/26 (開始日當天) 的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-05-26',
                amount: 112,
                type: 'expense',
                ledgerId: 1
            });
            // 寫入一個不在週期內的消費
            await tx.store.add({
                accountId: cardId,
                date: '2024-06-26',
                amount: 5000,
                type: 'expense',
                ledgerId: 1
            });
            await tx.done;

            const { startDate, endDate } = ds.getStatementPeriod({ statementDay: 25 }, '2024-05');
            // 呼叫計算
            const balance = await ds.calculateCreditCardBalance(cardId, startDate, endDate);
            
            // 應正確加總 888 + 112 = 1000 元
            expect(balance.totalExpense).toBe(1000);
            expect(balance.currentBalance).toBe(1000);
        });
    });

    describe('updateCreditStatementsStatus (FIFO 銷帳邏輯)', () => {
        it('應根據結帳日後還款紀錄自動更新未繳帳單狀態，按 FIFO 順序沖銷', async () => {
            const cardId = await ds.addAccount({
                name: '測試銷帳卡',
                type: 'credit_card',
                statementDay: 25,
                ledgerId: 1
            });

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
                createdAt: Date.now()
            });

            const stmt2Id = await ds.addCreditStatement({
                accountId: cardId,
                period: '2024-06',
                statementDate: new Date('2024-07-25').getTime(),
                dueDate: new Date('2024-08-15').getTime(),
                amount: 2000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now()
            });

            // 寫入一筆在 2024-06-25 之後的轉帳還款 (1500 元)
            // 這筆 1500 元還款應該能剛好沖銷第一筆 1000 元帳單，剩下 500 元不足以沖銷第二筆 2000 元帳單
            const tx = ds.db.transaction('records', 'readwrite');
            await tx.store.add({
                accountId: cardId,
                date: '2024-07-01',
                amount: 1500,
                type: 'income',
                category: 'transfer',
                ledgerId: 1
            });
            await tx.done;

            // 執行銷帳狀態更新
            await ds.updateCreditStatementsStatus();

            // 驗證第一筆帳單狀態變為 paid，第二筆仍為 unpaid
            const stmt1 = await ds.getCreditStatement(stmt1Id);
            const stmt2 = await ds.getCreditStatement(stmt2Id);

            expect(stmt1.status).toBe('paid');
            expect(stmt2.status).toBe('unpaid');
        });
    });

    describe('autoPayCreditStatements (自動扣繳邏輯)', () => {
        it('應於繳款日當天或之後自動從指定扣款帳戶轉帳扣繳卡費，並能隨後被沖銷狀態', async () => {
            // 建立扣款帳戶 (銀行帳戶，初始餘額 10000)
            const bankId = await ds.addAccount({
                name: '扣款銀行帳戶',
                type: 'bank',
                balance: 10000,
                ledgerId: 1
            });

            // 建立信用卡：設定自動扣款與扣款帳戶
            const cardId = await ds.addAccount({
                name: '自動扣繳信用卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1
            });

            // 建立一筆未繳帳單： dueDate 為 2026-07-15
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-05',
                statementDate: new Date('2026-06-25').getTime(),
                dueDate: new Date('2026-07-15').getTime(),
                amount: 3000,
                status: 'unpaid',
                ledgerId: 1,
                createdAt: Date.now()
            });

            // 模擬當前時間為 2026-07-16 (過了繳款日 7/15)
            const originalDate = globalThis.Date;
            globalThis.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-07-16T12:00:00');
                    }
                    return new originalDate(...args);
                }
                static now() {
                    return new originalDate('2026-07-16T12:00:00').getTime();
                }
            };

            try {
                // 執行自動扣款
                await ds.autoPayCreditStatements();

                // 驗證是否寫入了轉帳記錄：
                // 1. 銀行帳戶支出 3000
                // 2. 信用卡帳戶收入 3000
                const bankRecords = await ds.db.getAllFromIndex('records', 'accountId', bankId);
                const cardRecords = await ds.db.getAllFromIndex('records', 'accountId', cardId);

                expect(bankRecords).toHaveLength(1);
                expect(bankRecords[0].type).toBe('expense');
                expect(bankRecords[0].amount).toBe(3000);
                expect(bankRecords[0].category).toBe('transfer');

                expect(cardRecords).toHaveLength(1);
                expect(cardRecords[0].type).toBe('income');
                expect(cardRecords[0].amount).toBe(3000);
                expect(cardRecords[0].category).toBe('transfer');

                // 隨後執行狀態沖銷，驗證帳單是否變為 paid
                await ds.updateCreditStatementsStatus();
                const stmt = await ds.getCreditStatement(stmtId);
                expect(stmt.status).toBe('paid');
            } finally {
                globalThis.Date = originalDate;
            }
        });
    });

    describe('deleteAccount (Cascading Delete)', () => {
        it('刪除帳戶時應級聯刪除該帳戶所有的信用卡帳單', async () => {
            const mockDb = ds.db;
            
            // 1. 新增一個帳戶
            const accTx = mockDb.transaction('accounts', 'readwrite');
            await accTx.store.add({ id: 10, name: '信用卡 A', type: 'credit' });
            await accTx.done;

            // 2. 為該帳戶新增信用卡帳單
            await ds.addCreditStatement({
                id: 101, accountId: 10, period: '2024-06', amount: 1000,
                status: 'unpaid', createdAt: Date.now()
            });
            await ds.addCreditStatement({
                id: 102, accountId: 10, period: '2024-05', amount: 500,
                status: 'paid', createdAt: Date.now()
            });

            // 驗證原本帳單存在
            let statements = await ds.getCreditStatements({ accountId: 10, allLedgers: true });
            expect(statements).toHaveLength(2);

            // 3. 刪除該帳戶
            await ds.deleteAccount(10);

            // 驗證帳戶已被刪除
            const account = await ds.getAccount(10);
            expect(account).toBeNull();

            // 驗證該帳戶的信用卡帳單也被全部刪除
            statements = await ds.getCreditStatements({ accountId: 10, allLedgers: true });
            expect(statements).toHaveLength(0);
        });
    });

    describe('getRecords (Date Index Query)', () => {
        it('支援 startDate 與 endDate 區間查詢且返回正確的結果', async () => {
            const mockDb = ds.db;

            // 寫入一些不同日期的紀錄，使用 add() 回傳的動態 ID 斷言
            const tx = mockDb.transaction('records', 'readwrite');
            const id1 = await tx.store.add({ date: '2024-06-01', amount: 100, ledgerId: 1 });
            const id2 = await tx.store.add({ date: '2024-06-15', amount: 200, ledgerId: 1 });
            const id3 = await tx.store.add({ date: '2024-06-30', amount: 300, ledgerId: 1 });
            const id4 = await tx.store.add({ date: '2024-07-01', amount: 400, ledgerId: 1 });
            await tx.done;

            // 查詢 2024-06-05 到 2024-06-30 之間的記錄
            const records = await ds.getRecords({ startDate: '2024-06-05', endDate: '2024-06-30' });
            expect(records).toHaveLength(2);
            expect(records.map(r => r.id)).toContain(id2);
            expect(records.map(r => r.id)).toContain(id3);
        });
    });
});

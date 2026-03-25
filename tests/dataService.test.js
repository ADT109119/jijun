import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto'; // This mocks indexedDB globally for Node.js
import { openDB } from 'idb'; // Assuming idb is used in the codebase
import DataService from '../src/js/dataService.js';

describe('DataService', () => {
  let dataService;

  beforeEach(async () => {
    // Setup global window and idb for DataService to use
    globalThis.window = {
      idb: { openDB }
    };

    // Clear localStorage
    globalThis.localStorage = {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = String(value); },
      removeItem(key) { delete this.store[key]; },
      clear() { this.store = {}; }
    };

    // Use fake crypto if not available
    if (!globalThis.crypto) {
        globalThis.crypto = {
            randomUUID: () => '1234-5678-9012-3456'
        };
    } else if (!globalThis.crypto.randomUUID) {
        globalThis.crypto.randomUUID = () => '1234-5678-9012-3456';
    }

    dataService = new DataService();
    // Use a unique test DB name to avoid collision and blocked deleteDatabase calls
    dataService.dbName = 'EasyAccountingDB_Test_' + Date.now() + '_' + Math.random();
    await dataService.init();
  });

  afterEach(async () => {
    if (dataService.db) {
        dataService.db.close();
        await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(dataService.dbName);
            req.onsuccess = resolve;
            req.onerror = resolve; // Ignore errors during cleanup
            req.onblocked = resolve;
        });
    }
  });

  describe('Initialization & Schemas', () => {
    it('should initialize the database with all object stores', () => {
      expect(dataService.db).toBeDefined();
      expect(dataService.useLocalStorage).toBe(false);
      const storeNames = dataService.db.objectStoreNames;
      expect(storeNames.contains('records')).toBe(true);
      expect(storeNames.contains('settings')).toBe(true);
      expect(storeNames.contains('accounts')).toBe(true);
      expect(storeNames.contains('debts')).toBe(true);
      expect(storeNames.contains('ledgers')).toBe(true);
    });

    it('should fallback to localStorage if indexedDB is not available', async () => {
      // openDB was resolved at module load time in DataService.js,
      // so simply changing window.idb here won't override it.
      // We can simulate it by throwing an error during init DB.
      const fallbackService = new DataService();
      vi.spyOn(fallbackService, 'migrateFromLocalStorage').mockRejectedValueOnce(new Error('Simulated DB failure'));
      await fallbackService.init();
      expect(fallbackService.useLocalStorage).toBe(true);
    });
  });

  describe('Record Operations', () => {
    it('should add a new record and generate UUID', async () => {
      const newRecord = {
        type: 'expense',
        amount: 100,
        category: 'food',
        date: '2023-10-25'
      };

      const id = await dataService.addRecord(newRecord);
      expect(id).toBeDefined();

      const savedRecord = await dataService.getRecord(id);
      expect(savedRecord).toBeDefined();
      expect(savedRecord.amount).toBe(100);
      expect(savedRecord.uuid).toBeDefined();
      expect(savedRecord.ledgerId).toBe(1); // Default ledger
    });

    it('should update an existing record', async () => {
      const id = await dataService.addRecord({ type: 'expense', amount: 50, date: '2023-10-25', category: 'food' });

      const updated = await dataService.updateRecord(id, { amount: 75, category: 'transport' });
      expect(updated.amount).toBe(75);
      expect(updated.category).toBe('transport');

      const fetched = await dataService.getRecord(id);
      expect(fetched.amount).toBe(75);
    });

    it('should delete a record', async () => {
      const id = await dataService.addRecord({ type: 'expense', amount: 50, date: '2023-10-25', category: 'food' });

      const result = await dataService.deleteRecord(id);
      expect(result).toBe(true);

      const fetched = await dataService.getRecord(id);
      expect(fetched).toBeUndefined();
    });

    it('should fetch records with filters', async () => {
      await dataService.addRecord({ type: 'expense', amount: 10, date: '2023-10-20', category: 'food' });
      await dataService.addRecord({ type: 'income', amount: 100, date: '2023-10-21', category: 'salary' });
      await dataService.addRecord({ type: 'expense', amount: 20, date: '2023-10-22', category: 'transport' });

      // Filter by type
      const incomes = await dataService.getRecords({ type: 'income' });
      expect(incomes).toHaveLength(1);
      expect(incomes[0].amount).toBe(100);

      // Filter by date range
      const rangeRecords = await dataService.getRecords({ startDate: '2023-10-20', endDate: '2023-10-21' });
      expect(rangeRecords).toHaveLength(2);
    });
  });

  describe('Account & Multi-Ledger Operations', () => {
    it('should manage multiple accounts', async () => {
        const accId = await dataService.addAccount({ name: 'Cash', balance: 1000, type: 'cash' });
        expect(accId).toBeDefined();

        const account = await dataService.getAccount(accId);
        expect(account.name).toBe('Cash');
        expect(account.ledgerId).toBe(1); // default ledger

        await dataService.updateAccount(accId, { balance: 500 });
        const updated = await dataService.getAccount(accId);
        expect(updated.balance).toBe(500);

        const allAccs = await dataService.getAccounts();
        expect(allAccs).toHaveLength(1);

        await dataService.deleteAccount(accId);
        expect(await dataService.getAccounts()).toHaveLength(0);
    });

    it('should separate records by ledger', async () => {
        // Create second ledger
        const ledger2Id = await dataService.addLedger({ name: 'Business' });

        // Add record to default ledger
        await dataService.addRecord({ type: 'expense', amount: 10, date: '2023-10-20', category: 'food', ledgerId: 1 });
        // Add record to second ledger
        await dataService.addRecord({ type: 'expense', amount: 50, date: '2023-10-21', category: 'office', ledgerId: ledger2Id });

        // Currently active ledger is 1
        let records = await dataService.getRecords();
        expect(records).toHaveLength(1);
        expect(records[0].amount).toBe(10);

        // Switch active ledger
        dataService.setActiveLedger(ledger2Id);
        records = await dataService.getRecords();
        expect(records).toHaveLength(1);
        expect(records[0].amount).toBe(50);

        // Fetch all across ledgers
        records = await dataService.getRecords({ allLedgers: true });
        expect(records).toHaveLength(2);
    });
  });

  describe('Debt Operations', () => {
    it('should add and retrieve a debt', async () => {
        const contactId = await dataService.addContact({ name: 'Alice' });

        const debtId = await dataService.addDebt({
            type: 'receivable',
            contactId: contactId,
            amount: 500,
            date: '2023-10-25'
        });

        const debt = await dataService.getDebt(debtId);
        expect(debt.originalAmount).toBe(500);
        expect(debt.remainingAmount).toBe(500);
        expect(debt.settled).toBe(false);
        expect(debt.contactUuid).toBeDefined(); // Should resolve contact uuid
    });

    it('should settle a debt completely', async () => {
        const contactId = await dataService.addContact({ name: 'Bob' });
        const debtId = await dataService.addDebt({
            type: 'payable',
            contactId: contactId,
            amount: 300,
            date: '2023-10-25'
        });

        const updatedDebt = await dataService.settleDebt(debtId);

        expect(updatedDebt.remainingAmount).toBe(0);
        expect(updatedDebt.settled).toBe(true);
        expect(updatedDebt.payments).toHaveLength(1);
        expect(updatedDebt.payments[0].amount).toBe(300);

        // A transaction record should be created
        const records = await dataService.getRecords({ allLedgers: true });
        expect(records).toHaveLength(1);
        expect(records[0].amount).toBe(300);
        expect(records[0].category).toBe('debt_repayment');
    });

    it('should allow partial debt settlement', async () => {
        const contactId = await dataService.addContact({ name: 'Charlie' });
        const debtId = await dataService.addDebt({
            type: 'receivable',
            contactId: contactId,
            amount: 1000,
            date: '2023-10-25'
        });

        const updatedDebt = await dataService.addPartialPayment(debtId, 400);

        expect(updatedDebt.remainingAmount).toBe(600);
        expect(updatedDebt.settled).toBe(false);
        expect(updatedDebt.payments).toHaveLength(1);
        expect(updatedDebt.payments[0].amount).toBe(400);

        // Another payment to settle
        const finalDebt = await dataService.addPartialPayment(debtId, 600);
        expect(finalDebt.remainingAmount).toBe(0);
        expect(finalDebt.settled).toBe(true);
        expect(finalDebt.payments).toHaveLength(2);
    });
  });

  describe('Statistics & Calculations', () => {
    it('should calculate statistics correctly', async () => {
        await dataService.addRecord({ type: 'income', amount: 1000, date: '2023-10-20', category: 'salary' });
        await dataService.addRecord({ type: 'expense', amount: 200, date: '2023-10-21', category: 'food' });
        await dataService.addRecord({ type: 'expense', amount: 100, date: '2023-10-21', category: 'food' });
        await dataService.addRecord({ type: 'expense', amount: 50, date: '2023-10-22', category: 'transport' });

        // Add a transfer (should be offset if requested)
        await dataService.addRecord({ type: 'expense', amount: 500, date: '2023-10-23', category: 'transfer' });

        const stats = await dataService.getStatistics('2023-10-20', '2023-10-24', null, true); // offsetTransfers = true

        expect(stats.totalIncome).toBe(1000);
        expect(stats.totalExpense).toBe(350); // 200 + 100 + 50 (transfer ignored)
        expect(stats.expenseByCategory['food']).toBe(300);
        expect(stats.expenseByCategory['transport']).toBe(50);
        expect(stats.dailyTotals['2023-10-21'].expense).toBe(300);
        expect(stats.records).toHaveLength(4); // Excludes transfer
    });
  });

  describe('Import/Export Data Format Conversion', () => {
    it('should correctly convert old localStorage format to new format', () => {
        const oldData = {
            "2022": {
                "10": {
                    "01": {
                        "OutType": {
                            "food": {
                                "money": [0, "100", "50"],
                                "description": ["", "lunch", "dinner"]
                            }
                        },
                        "InType": {
                            "salary": {
                                "money": [0, "5000"],
                                "description": ["", "bonus"]
                            }
                        }
                    }
                }
            }
        };

        const converted = dataService.convertOldDataFormat(oldData);
        expect(converted).toHaveLength(3);

        const expense1 = converted.find(r => r.amount === 100);
        expect(expense1.type).toBe('expense');
        expect(expense1.category).toBe('food');
        expect(expense1.description).toBe('lunch');
        expect(expense1.date).toBe('2022-10-01');

        const income1 = converted.find(r => r.amount === 5000);
        expect(income1.type).toBe('income');
        expect(income1.category).toBe('salary');
    });
  });

  describe('Sync Hook Logging', () => {
    it('should log changes when adding or updating records', async () => {
        const id = await dataService.addRecord({ type: 'expense', amount: 100, date: '2023-10-25', category: 'food' });
        const logs = await dataService.getChangesSince(0);

        // One log for add
        expect(logs.length).toBeGreaterThanOrEqual(1);
        const addLog = logs.find(l => l.operation === 'add' && l.storeName === 'records' && l.recordId === id);
        expect(addLog).toBeDefined();

        await dataService.updateRecord(id, { amount: 150 });
        const logsAfterUpdate = await dataService.getChangesSince(0);
        const updateLog = logsAfterUpdate.find(l => l.operation === 'update' && l.storeName === 'records' && l.recordId === id);
        expect(updateLog).toBeDefined();
        expect(updateLog.data.amount).toBe(150);
    });

    it('should not log changes if skipLog is true', async () => {
        const id = await dataService.addRecord({ type: 'expense', amount: 100, date: '2023-10-25', category: 'food' }, true);
        const logs = await dataService.getChangesSince(0);
        expect(logs).toHaveLength(0); // Assuming no other setup creates logs
    });
  });
});

// 資料服務模組 - 使用 IndexedDB 進行資料儲存
// 如果 idb 不可用，使用全域的 idb
const openDB = window.idb?.openDB || (() => {
  console.warn('IndexedDB 不可用，將使用 localStorage')
  return null
})

class DataService {
  constructor() {
    this.dbName = 'EasyAccountingDB'
    this.dbVersion = 9 // Schema version 9: Remove unique constraint for account name (multi-ledger support)
    this.db = null
    this.useLocalStorage = false
    this.hookProvider = null; // Function to trigger hooks
    this._syncDeviceId = localStorage.getItem('sync_device_id') || 'unknown';

    /** @type {number} 當前啟用的帳本 ID（預設 1 = 預設帳本） */
    this.activeLedgerId = parseInt(localStorage.getItem('activeLedgerId') || '1', 10);
  }

  setHookProvider(fn) {
      this.hookProvider = fn;
  }

  async triggerHook(hookName, payload) {
      if (this.hookProvider) {
          return await this.hookProvider(hookName, payload);
      }
      return payload;
  }

  async init() {
    try {
      if (openDB && typeof openDB === 'function') {
        this.db = await openDB(this.dbName, this.dbVersion, {
          async upgrade(db, oldVersion, newVersion, transaction) {
            // Schema version 1
            if (oldVersion < 1) {
              if (!db.objectStoreNames.contains('records')) {
                const recordStore = db.createObjectStore('records', {
                  keyPath: 'id',
                  autoIncrement: true
                })
                recordStore.createIndex('date', 'date')
                recordStore.createIndex('type', 'type')
                recordStore.createIndex('category', 'category')
              }
              if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' })
              }
            }
            // Schema version 2
            if (oldVersion < 2) {
              if (!db.objectStoreNames.contains('accounts')) {
                const accountStore = db.createObjectStore('accounts', {
                  keyPath: 'id',
                  autoIncrement: true
                });
                accountStore.createIndex('name', 'name', { unique: true });
              }
              const recordStore = transaction.objectStore('records');
              if (!recordStore.indexNames.contains('accountId')) {
                recordStore.createIndex('accountId', 'accountId');
              }
            }
            // Schema version 3
            if (oldVersion < 3) {
                if (!db.objectStoreNames.contains('recurring_transactions')) {
                    const recurringStore = db.createObjectStore('recurring_transactions', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    recurringStore.createIndex('nextDueDate', 'nextDueDate');
                }
            }
            // Schema version 4: Debt management system
            if (oldVersion < 4) {
                // Files store for storing blobs (avatars, etc.)
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                }
                // Contacts store for debt management
                if (!db.objectStoreNames.contains('contacts')) {
                    const contactStore = db.createObjectStore('contacts', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    contactStore.createIndex('name', 'name');
                }
                // Debts store for tracking receivables and payables
                if (!db.objectStoreNames.contains('debts')) {
                    const debtStore = db.createObjectStore('debts', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    debtStore.createIndex('contactId', 'contactId');
                    debtStore.createIndex('type', 'type');
                    debtStore.createIndex('settled', 'settled');
                }
            }
            // Schema version 5: Plugin System
            if (oldVersion < 5) {
                if (!db.objectStoreNames.contains('plugins')) {
                    db.createObjectStore('plugins', { keyPath: 'id' });
                    // id: plugin identifier (e.g. 'com.example.myplugin')
                    // name, version, script (blob/string), enabled (bool)
                }
            }
            // Schema version 6: Sync log for multi-device sync
            if (oldVersion < 6) {
                if (!db.objectStoreNames.contains('sync_log')) {
                    const syncStore = db.createObjectStore('sync_log', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    syncStore.createIndex('timestamp', 'timestamp');
                }
            }
            // Schema version 7: UUIDs for sync deduplication
            if (oldVersion < 7) {
                const stores = ['records', 'accounts', 'contacts', 'debts', 'recurring_transactions'];
                for (const storeName of stores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName);
                        if (!store.indexNames.contains('uuid')) {
                            store.createIndex('uuid', 'uuid', { unique: true });
                        }
                        // Iterate and assign UUIDs to existing records
                        let cursor = await store.openCursor();
                        while (cursor) {
                            const updateData = cursor.value;
                            if (!updateData.uuid) {
                                // Simple UUID v4 generator
                                updateData.uuid = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() :
                                    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                                        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                                        return v.toString(16);
                                    });
                                await cursor.update(updateData);
                            }
                            cursor = await cursor.continue();
                        }
                    }
                }
            }
            // Schema version 8: Multi-ledger support
            if (oldVersion < 8) {
                // 1. 建立 ledgers object store
                if (!db.objectStoreNames.contains('ledgers')) {
                    const ledgerStore = db.createObjectStore('ledgers', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    ledgerStore.createIndex('uuid', 'uuid', { unique: true });
                }

                // 2. 為所有資料 store 新增 ledgerId index
                const dataStores = ['records', 'accounts', 'contacts', 'debts', 'recurring_transactions'];
                for (const storeName of dataStores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName);
                        if (!store.indexNames.contains('ledgerId')) {
                            store.createIndex('ledgerId', 'ledgerId');
                        }
                    }
                }

                // 3. 插入預設帳本
                const ledgerStore = transaction.objectStore('ledgers');
                const defaultUuid = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() :
                    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                await ledgerStore.add({
                    id: 1,
                    uuid: defaultUuid,
                    name: '預設帳本',
                    icon: 'fa-solid fa-book',
                    color: '#334A52',
                    type: 'personal',
                    createdAt: Date.now(),
                });

                // 4. 為所有現有資料打上 ledgerId = 1
                for (const storeName of dataStores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName);
                        let cursor = await store.openCursor();
                        while (cursor) {
                            const data = cursor.value;
                            if (data.ledgerId === undefined || data.ledgerId === null) {
                                data.ledgerId = 1;
                                await cursor.update(data);
                            }
                            cursor = await cursor.continue();
                        }
                    }
                }
            }
            // Schema version 9: Remove unique constraint on account name
            if (oldVersion < 9) {
                if (db.objectStoreNames.contains('accounts')) {
                    const accountStore = transaction.objectStore('accounts');
                    if (accountStore.indexNames.contains('name')) {
                        accountStore.deleteIndex('name');
                    }
                    accountStore.createIndex('name', 'name', { unique: false });
                }
            }
          }
        })
        
        // If it's the first time using the app, try to migrate from localStorage
        await this.migrateFromLocalStorage()
      } else {
        throw new Error('IndexedDB not available')
      }
    } catch (error) {
      console.error('Database initialization failed:', error)
      // Fallback to localStorage if IndexedDB is not available
      this.useLocalStorage = true
      console.log('Using localStorage as a fallback')
    }
  }

  // 從舊的 localStorage 遷移資料
  async migrateFromLocalStorage() {
    const oldData = localStorage.getItem('AllTheData')
    if (oldData && this.db) {
      try {
        const parsedData = JSON.parse(oldData)
        const records = this.convertOldDataFormat(parsedData)
        
        const tx = this.db.transaction('records', 'readwrite')
        const store = tx.objectStore('records')
        
        for (const record of records) {
          await store.add(record)
        }
        
        await tx.done
        console.log('資料遷移完成')
        
        // 備份舊資料後清除
        localStorage.setItem('AllTheData_backup', oldData)
        localStorage.removeItem('AllTheData')
      } catch (error) {
        console.error('資料遷移失敗:', error)
      }
    }
  }

  // 生成 UUID
  generateUUID() {
    if (self.crypto && self.crypto.randomUUID) {
      return self.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // 轉換舊資料格式
  convertOldDataFormat(oldData) {
    const records = []
    
    for (const year in oldData) {
      for (const month in oldData[year]) {
        for (const day in oldData[year][month]) {
          const dayData = oldData[year][month][day]
          
          // 處理支出資料
          if (dayData.OutType) {
            for (const category in dayData.OutType) {
              const categoryData = dayData.OutType[category]
              if (categoryData.money && categoryData.money.length > 1) {
                for (let i = 1; i < categoryData.money.length; i++) {
                  records.push({
                    date: `${year}-${month}-${day}`,
                    type: 'expense',
                    category: category,
                    amount: parseFloat(categoryData.money[i]),
                    description: categoryData.description[i] || '',
                    timestamp: new Date(`${year}-${month}-${day}`).getTime()
                  })
                }
              }
            }
          }
          
          // 處理收入資料
          if (dayData.InType) {
            for (const category in dayData.InType) {
              const categoryData = dayData.InType[category]
              if (categoryData.money && categoryData.money.length > 1) {
                for (let i = 1; i < categoryData.money.length; i++) {
                  records.push({
                    date: `${year}-${month}-${day}`,
                    type: 'income',
                    category: category,
                    amount: parseFloat(categoryData.money[i]),
                    description: categoryData.description[i] || '',
                    timestamp: new Date(`${year}-${month}-${day}`).getTime()
                  })
                }
              }
            }
          }
        }
      }
    }
    
    return records
  }

  // 新增記錄
  async addRecord(record, skipLog = false) {
    // 補充 accountUuid / debtUuid 以便跨裝置同步時正確解析外鍵
    let resolvedAccountUuid = record.accountUuid || null;
    if (record.accountId && !resolvedAccountUuid) {
      try {
        const account = await this.db.get('accounts', record.accountId);
        if (account?.uuid) resolvedAccountUuid = account.uuid;
      } catch (_) { /* 查不到帳號不影響儲存 */ }
    }

    let resolvedDebtUuid = record.debtUuid || null;
    if (record.debtId && !resolvedDebtUuid) {
      try {
        const debt = await this.db.get('debts', record.debtId);
        if (debt?.uuid) resolvedDebtUuid = debt.uuid;
      } catch (_) { /* 查不到欠款不影響儲存 */ }
    }

    const recordWithTimestamp = {
      ...record,
      ledgerId: record.ledgerId ?? this.activeLedgerId,
      timestamp: Date.now(),
      uuid: record.uuid || this.generateUUID(),
      ...(resolvedAccountUuid ? { accountUuid: resolvedAccountUuid } : {}),
      ...(resolvedDebtUuid   ? { debtUuid:    resolvedDebtUuid    } : {}),
    }

    if (this.useLocalStorage) {
      return this.addRecordToLocalStorage(recordWithTimestamp)
    }

    // 同步接收路徑：移除來源裝置的 integer id，讓 IndexedDB 自動產生新 id
    // 若保留來源 id，接收端可能因 key 衝突而静默失敗
    if (skipLog) delete recordWithTimestamp.id;

    try {
      // Hook: Before Save
      let recordToSave = recordWithTimestamp;
      if (!skipLog) {
        recordToSave = await this.triggerHook('onRecordSaveBefore', recordToSave);
        if (!recordToSave) return null; // Cancelled
      }

      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const result = await store.add(recordToSave)
      await tx.done
      
      // Hook: After Save
      if (!skipLog) {
        await this.triggerHook('onRecordSaveAfter', { ...recordToSave, id: result });
      }

      // Change tracking for sync
      if (!skipLog) {
        await this.logChange('add', 'records', result, { ...recordToSave, id: result });
      }

      return result
    } catch (error) {
      console.error('新增記錄失敗:', error)
      throw error
    }
  }

  // Get by UUID (Generic)
  async getByUUID(storeName, uuid) {
    try {
      if (this.useLocalStorage) return null;
      const tx = this.db.transaction(storeName, 'readonly');
      const index = tx.store.index('uuid');
      return await index.get(uuid);
    } catch (err) {
      console.error(`Failed to get by UUID from ${storeName}:`, err);
      return null;
    }
  }

  // 獲取記錄
  async getRecords(filters = {}) {
    if (this.useLocalStorage) {
      return this.getRecordsFromLocalStorage(filters)
    }

    try {
      const tx = this.db.transaction('records', 'readonly')
      const store = tx.objectStore('records')
      let records = await store.getAll()

      // 帳本篩選（allLedgers = true 時跳過，用於匯出/備份）
      if (!filters.allLedgers) {
        const targetLedgerId = filters.ledgerId ?? this.activeLedgerId;
        records = records.filter(r => r.ledgerId === targetLedgerId);
      }

      // 應用篩選器
      if (filters.startDate || filters.endDate) {
        records = records.filter(record => {
          const recordDate = record.date // 使用字符串比較，格式為 YYYY-MM-DD
          if (filters.startDate && recordDate < filters.startDate) return false
          if (filters.endDate && recordDate > filters.endDate) return false
          return true
        })
      }

      if (filters.type) {
        records = records.filter(record => record.type === filters.type)
      }

      if (filters.category) {
        records = records.filter(record => record.category === filters.category)
      }

      if (filters.accountId) {
        records = records.filter(record => record.accountId === filters.accountId);
      }

      return records.sort((a, b) => b.timestamp - a.timestamp)
    } catch (error) {
      console.error('獲取記錄失敗:', error)
      return []
    }
  }

  async getRecord(id) {
    if (this.useLocalStorage) {
      const records = JSON.parse(localStorage.getItem('records') || '[]');
      return records.find(r => r.id === id);
    }
    try {
      return await this.db.get('records', id);
    } catch (error) {
      console.error('獲取單條記錄失敗:', error);
      return null;
    }
  }

  // 更新記錄
  async updateRecord(id, updates, skipLog = false) {
    if (this.useLocalStorage) {
      return this.updateRecordInLocalStorage(id, updates)
    }

    try {
      // 若更新包含 accountId / debtId，同步更新對應 UUID
      let extraUpdates = {};
      if (updates.accountId !== undefined) {
        if (updates.accountId) {
          try {
            const account = await this.db.get('accounts', updates.accountId);
            if (account?.uuid) extraUpdates.accountUuid = account.uuid;
          } catch (_) { /* 查不到帳號不影響更新 */ }
        } else {
          extraUpdates.accountUuid = null;
        }
      }
      if (updates.debtId !== undefined) {
        if (updates.debtId) {
          try {
            const debt = await this.db.get('debts', updates.debtId);
            if (debt?.uuid) extraUpdates.debtUuid = debt.uuid;
          } catch (_) { /* 查不到欠款不影響更新 */ }
        } else {
          extraUpdates.debtUuid = null;
        }
      }

      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const record = await store.get(id)
      
      if (record) {
        let finalUpdates = { ...updates, ...extraUpdates };
        if (!skipLog) {
          // Hook: Before Update
          const updatesWithHook = await this.triggerHook('onRecordUpdateBefore', { old: record, updates: finalUpdates });
          if (!updatesWithHook) throw new Error('Update cancelled by plugin');
          finalUpdates = updatesWithHook.updates || finalUpdates;
        } else {
            // 同步模式 (skipLog=true): 來自遠端數據，保護本地核心關聯標識
            delete finalUpdates.id; // 防止修改本機 integer key
            if (record.uuid) finalUpdates.uuid = record.uuid; // 鎖定 UUID，避免 Unique Constraint 衝突
        }
        
        const updatedRecord = { ...record, ...finalUpdates }
        await store.put(updatedRecord)
        await tx.done
        
        if (!skipLog) {
          await this.triggerHook('onRecordUpdateAfter', updatedRecord);
          await this.logChange('update', 'records', id, updatedRecord);
        }

        return updatedRecord
      }
      
      throw new Error('記錄不存在')
    } catch (error) {
      console.error('更新記錄失敗:', error)
      throw error
    }
  }

  // 刪除記錄
  async deleteRecord(id, skipLog = false) {
    if (this.useLocalStorage) {
      return this.deleteRecordFromLocalStorage(id)
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      
      let uuid = null;
      if (!skipLog) {
        const record = await store.get(id);
        uuid = record?.uuid;

        const shouldDelete = await this.triggerHook('onRecordDeleteBefore', { id });
        if (!shouldDelete) throw new Error('Delete cancelled by plugin');
      }

      await store.delete(id)
      await tx.done
      
      if (!skipLog) {
        await this.triggerHook('onRecordDeleteAfter', { id });
        await this.logChange('delete', 'records', id, { uuid });
      }

      return true
    } catch (error) {
      console.error('刪除記錄失敗:', error)
      throw error;
    }
  }

  // --- Recurring Transaction Methods ---
  async addRecurringTransaction(transaction, skipLog = false) {
    try {
      if (!transaction.uuid) transaction.uuid = this.generateUUID();

      // 補充 accountUuid 以便跨裝置同步時正確解析 accountId
      let accountUuid = transaction.accountUuid || null;
      if (transaction.accountId && !accountUuid) {
        try {
          const account = await this.db.get('accounts', transaction.accountId);
          if (account?.uuid) accountUuid = account.uuid;
        } catch (_) { /* 查不到帳號不影響儲存 */ }
      }

      const dataToSave = {
        ...transaction,
        ledgerId: transaction.ledgerId ?? this.activeLedgerId,
        ...(accountUuid ? { accountUuid } : {}),
      };

      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      const id = await tx.store.add(dataToSave);
      await tx.done;
      if (!skipLog) await this.logChange('add', 'recurring_transactions', id, dataToSave);
      return id;
    } catch (error) {
      console.error('Failed to add recurring transaction:', error);
      throw error;
    }
  }

  async getRecurringTransactions(filters = {}) {
    try {
      let items = await this.db.getAll('recurring_transactions');
      if (!filters.allLedgers) {
        const targetLedgerId = filters.ledgerId ?? this.activeLedgerId;
        items = items.filter(t => t.ledgerId === targetLedgerId);
      }
      return items;
    } catch (error) {
      console.error('Failed to get recurring transactions:', error);
      return [];
    }
  }

  async updateRecurringTransaction(id, updates, skipLog = false) {
    try {
      // 若更新包含 accountId，同步更新 accountUuid
      let extraUpdates = {};
      if (updates.accountId !== undefined) {
        if (updates.accountId) {
          try {
            const account = await this.db.get('accounts', updates.accountId);
            if (account?.uuid) extraUpdates.accountUuid = account.uuid;
          } catch (_) { /* 查不到帳號不影響更新 */ }
        } else {
          extraUpdates.accountUuid = null;
        }
      }

      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      const transaction = await tx.store.get(id);
      if (transaction) {
        let finalUpdates = { ...updates, ...extraUpdates };
        if (skipLog) {
            delete finalUpdates.id;
            if (transaction.uuid) finalUpdates.uuid = transaction.uuid;
        }
        const updatedTransaction = { ...transaction, ...finalUpdates };
        await tx.store.put(updatedTransaction);
        await tx.done;
        if (!skipLog) await this.logChange('update', 'recurring_transactions', id, updatedTransaction);
        return updatedTransaction;
      }
      throw new Error('Recurring transaction not found');
    } catch (error) {
      console.error(`Failed to update recurring transaction ${id}:`, error);
      throw error;
    }
  }

  async deleteRecurringTransaction(id, skipLog = false) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      let uuid = null;
      if (!skipLog) {
          const rt = await tx.store.get(id);
          uuid = rt?.uuid;
      }
      await tx.store.delete(id);
      await tx.done;
      if (!skipLog) await this.logChange('delete', 'recurring_transactions', id, { uuid });
      return true;
    } catch (error) {
      console.error(`Failed to delete recurring transaction ${id}:`, error);
      throw error;
    }
  }

  // LocalStorage 備用方法
  addRecordToLocalStorage(record) {
    const records = this.getRecordsFromLocalStorage()
    record.id = Date.now() // 簡單的 ID 生成
    records.push(record)
    localStorage.setItem('records', JSON.stringify(records))
    return record.id
  }

  getRecordsFromLocalStorage(filters = {}) {
    let records = JSON.parse(localStorage.getItem('records') || '[]')
    
    // 應用篩選器
    if (filters.startDate || filters.endDate) {
      records = records.filter(record => {
        const recordDate = record.date // 使用字符串比較，格式為 YYYY-MM-DD
        if (filters.startDate && recordDate < filters.startDate) return false
        if (filters.endDate && recordDate > filters.endDate) return false
        return true
      })
    }

    if (filters.type) {
      records = records.filter(record => record.type === filters.type)
    }

    if (filters.category) {
      records = records.filter(record => record.category === filters.category)
    }

    return records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  }

  updateRecordInLocalStorage(id, updates) {
    const records = this.getRecordsFromLocalStorage()
    const index = records.findIndex(r => r.id === id)
    if (index !== -1) {
      records[index] = { ...records[index], ...updates }
      localStorage.setItem('records', JSON.stringify(records))
      return records[index]
    }
    throw new Error('記錄不存在')
  }

  deleteRecordFromLocalStorage(id) {
    const records = this.getRecordsFromLocalStorage()
    const filteredRecords = records.filter(r => r.id !== id)
    localStorage.setItem('records', JSON.stringify(filteredRecords))
    return true
  }

  // 獲取統計資料
  async getStatistics(startDate, endDate, accountId = null, offsetTransfers = false) {
    const filters = { startDate, endDate };
    if (accountId) {
      filters.accountId = accountId;
    }
    let records = await this.getRecords(filters);

    if (offsetTransfers) {
        records = records.filter(r => r.category !== 'transfer');
    }

    // Exclude debt-related categories from statistics
    // These are just "moving money" not real income/expense
    records = records.filter(r => 
        r.category !== 'debt_collection' && r.category !== 'debt_repayment'
    );
    
    const stats = {
      totalIncome: 0,
      totalExpense: 0,
      incomeByCategory: {},
      expenseByCategory: {},
      dailyTotals: {},
      records: records // Include filtered records in result
    }

    records.forEach(record => {
      if (record.type === 'income') {
        stats.totalIncome += record.amount
        stats.incomeByCategory[record.category] = 
          (stats.incomeByCategory[record.category] || 0) + record.amount
      } else {
        stats.totalExpense += record.amount
        stats.expenseByCategory[record.category] = 
          (stats.expenseByCategory[record.category] || 0) + record.amount
      }

      const date = record.date
      if (!stats.dailyTotals[date]) {
        stats.dailyTotals[date] = { income: 0, expense: 0 }
      }
      stats.dailyTotals[date][record.type === 'income' ? 'income' : 'expense'] += record.amount
    })

    return stats
  }

  // 匯出所有資料
  async exportData(options = {}) {
    // Default options - include all data types
    const {
      includeRecords = true,
      includeAccounts = true,
      includeDebts = true,
      includeCategories = true
    } = options;

    try {
      const ledgers = await this.getLedgers();
      const records = includeRecords ? await this.getRecords({ allLedgers: true }) : [];
      const customCategoriesSetting = includeCategories ? await this.getSetting('custom_categories') : null;
      const customCategories = customCategoriesSetting?.value || null;
      const categoryOrderSetting = includeCategories ? await this.getSetting('category_order') : null;
      const categoryOrder = categoryOrderSetting?.value || null;
      const hiddenCategoriesSetting = includeCategories ? await this.getSetting('hidden_categories') : null;
      const hiddenCategories = hiddenCategoriesSetting?.value || null;
      
      const allSettings = await this.db.getAll('settings');
      const budgetSettingsMap = {};
      allSettings.forEach(s => {
          if (s.key && (s.key === 'budget_settings' || s.key.startsWith('budget_settings_'))) {
              budgetSettingsMap[s.key] = s.value;
          }
      });

      const accounts = includeAccounts ? await this.getAccounts({ allLedgers: true }) : [];
      const advancedAccountModeEnabled = await this.getSetting('advancedAccountModeEnabled');
      const debtManagementEnabled = await this.getSetting('debtManagementEnabled');
      const contacts = includeDebts ? await this.getContacts({ allLedgers: true }) : [];
      const debts = includeDebts ? await this.getDebts({ allLedgers: true }) : [];
      let recurring_transactions = [];
      try {
          recurring_transactions = await this.db.getAll('recurring_transactions');
      } catch (e) {}

      const exportData = {
        version: '2.3.0',
        exportDate: new Date().toISOString(),
        settings: {
            advancedAccountModeEnabled: advancedAccountModeEnabled?.value || false,
            debtManagementEnabled: debtManagementEnabled?.value || false,
        },
        activeLedgerId: this.activeLedgerId,
        ledgers: ledgers,
        accounts: accounts,
        records: records,
        contacts: contacts,
        debts: debts,
        recurring_transactions: recurring_transactions,
        customCategories: customCategories,
        categoryOrder: categoryOrder,
        hiddenCategories: hiddenCategories,
        budgetSettingsMap: budgetSettingsMap,
        metadata: {
          totalRecords: records.length,
          totalContacts: contacts.length,
          totalDebts: debts.length,
          totalLedgers: ledgers.length,
          dateRange: {
            start: records.length > 0 ? Math.min(...records.map(r => new Date(r.date).getTime())) : null,
            end: records.length > 0 ? Math.max(...records.map(r => new Date(r.date).getTime())) : null
          }
        }
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `記帳資料_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      return true
    } catch (error) {
      console.error('匯出資料失敗:', error)
      throw error
    }
  }

  // 匯入資料（支援舊版格式）
  async importData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result)

          // 確認是否要覆蓋現有資料
          if ((await this.getRecords()).length > 0) {
            const confirmed = confirm(`匯入新資料將會覆蓋所有現有資料 (包含紀錄、帳戶、分類設定)。\n\n確定要繼續嗎？`)
            if (!confirmed) {
              resolve({ success: false, message: '使用者取消操作' })
              return
            }
          }

          // --- 清除所有舊資料 ---
          await this.clearAllRecords();
          await this.clearAllAccounts();
          await this.clearAllContacts();
          await this.clearAllDebts();
          if (!this.useLocalStorage) {
            try {
              const txR = this.db.transaction('recurring_transactions', 'readwrite');
              await txR.store.clear();
              await txR.done;
            } catch (e) {}
          }
          await this.saveSetting({ key: 'custom_categories', value: { expense: [], income: [] } });
          await this.saveSetting({ key: 'advancedAccountModeEnabled', value: false });
          await this.saveSetting({ key: 'debtManagementEnabled', value: false });


          // --- 開始匯入 ---
          // 1. 匯入設定
          const advancedModeEnabled = data.settings?.advancedAccountModeEnabled || false;
          const debtManagementEnabled = data.settings?.debtManagementEnabled || false;
          await this.saveSetting({ key: 'advancedAccountModeEnabled', value: advancedModeEnabled });
          await this.saveSetting({ key: 'debtManagementEnabled', value: debtManagementEnabled });

          // 2. 匯入自訂分類
          if (data.customCategories) {
            await this.saveSetting({ key: 'custom_categories', value: data.customCategories });
          }
          if (data.categoryOrder) {
            await this.saveSetting({ key: 'category_order', value: data.categoryOrder });
          }
          if (data.hiddenCategories) {
            await this.saveSetting({ key: 'hidden_categories', value: data.hiddenCategories });
          }
          
          // 3. 匯入帳本 (ledgers) 及建立 mapped ID
          const oldLedgerIdToNewIdMap = new Map();
          if (data.ledgers && Array.isArray(data.ledgers) && data.ledgers.length > 0) {
              if (!this.useLocalStorage) {
                  try {
                      const txL = this.db.transaction('ledgers', 'readwrite');
                      await txL.store.clear();
                      await txL.done;
                  } catch(e){}
              }
              for (const ledger of data.ledgers) {
                  const oldId = ledger.id;
                  const { id, ...ledgerData } = ledger;
                  // Ensure UUID for avoid PK collision in sync
                  if (!ledgerData.uuid) ledgerData.uuid = this.generateUUID();
                  const tx = this.db.transaction('ledgers', 'readwrite');
                  const newId = await tx.store.add(ledgerData);
                  await tx.done;
                  oldLedgerIdToNewIdMap.set(oldId, newId);
              }
              if (data.activeLedgerId && oldLedgerIdToNewIdMap.has(data.activeLedgerId)) {
                  this.setActiveLedger(oldLedgerIdToNewIdMap.get(data.activeLedgerId));
              } else {
                  this.setActiveLedger(oldLedgerIdToNewIdMap.values().next().value || 1);
              }
          }

          const getMappedLedgerId = (oldLedgerId) => {
              if (oldLedgerId !== undefined && oldLedgerIdToNewIdMap.has(oldLedgerId)) {
                  return oldLedgerIdToNewIdMap.get(oldLedgerId);
              }
              return this.activeLedgerId;
          };

          if (data.budgetSettingsMap) {
            for (const [key, val] of Object.entries(data.budgetSettingsMap)) {
                let newKey = key;
                if (newKey !== 'budget_settings') {
                    // rewrite ledger id if it has one
                    const parts = newKey.split('_');
                    const lId = parseInt(parts[2]);
                    if (!isNaN(lId) && oldLedgerIdToNewIdMap.has(lId)) {
                        newKey = `budget_settings_${oldLedgerIdToNewIdMap.get(lId)}`;
                    }
                }
                await this.saveSetting({ key: newKey, value: val });
            }
          } else if (data.budgetSettings) {
            await this.saveSetting({ key: 'budget_settings', value: data.budgetSettings });
          }

          // 4. 匯入帳戶並建立 ID Map
          const oldAccountIdToNewIdMap = new Map();
          if (advancedModeEnabled && data.accounts && Array.isArray(data.accounts)) {
            for (const account of data.accounts) {
                const oldId = account.id;
                const { id, ...accountData } = account;
                accountData.ledgerId = getMappedLedgerId(accountData.ledgerId);
                const newId = await this.addAccount(accountData);
                oldAccountIdToNewIdMap.set(oldId, newId);
            }
          }

          // 5. 匯入聯絡人並建立 ID Map
          const oldContactIdToNewIdMap = new Map();
          if (data.contacts && Array.isArray(data.contacts)) {
            for (const contact of data.contacts) {
                const oldId = contact.id;
                const { id, ...contactData } = contact;
                contactData.ledgerId = getMappedLedgerId(contactData.ledgerId);
                const newId = await this.addContact(contactData);
                oldContactIdToNewIdMap.set(oldId, newId);
            }
          }

          // 6. 匯入欠款 (Phase 1: Insert & Map IDs)
          // We use direct DB insertion instead of addDebt to preserve imported state (amounts, payments, etc.)
          const oldDebtIdToNewIdMap = new Map();
          const debtsToUpdate = []; // Keep track for Phase 2 linking

          if (data.debts && Array.isArray(data.debts)) {
            const tx = this.db.transaction('debts', 'readwrite');
            for (const debt of data.debts) {
                const oldId = debt.id;
                const { id, ...debtData } = debt;
                
                // Ensure UUID
                if (!debtData.uuid) debtData.uuid = this.generateUUID();

                // Ensure ledgerId
                debtData.ledgerId = getMappedLedgerId(debtData.ledgerId);

                // Update contactId
                if (debtData.contactId) {
                    debtData.contactId = oldContactIdToNewIdMap.get(debtData.contactId);
                }

                // Fix missing amount fields (e.g. from legacy data)
                if (debtData.remainingAmount === undefined || debtData.remainingAmount === null) {
                    debtData.remainingAmount = debtData.originalAmount ?? debtData.amount ?? 0;
                }
                if (debtData.originalAmount === undefined || debtData.originalAmount === null) {
                    debtData.originalAmount = debtData.amount ?? debtData.remainingAmount ?? 0;
                }

                // Fix potential bug where remainingAmount is 0 but debt is not settled
                if (debtData.remainingAmount === 0 && !debtData.settled) {
                    const paid = (debtData.payments || []).reduce((sum, p) => sum + p.amount, 0);
                    if (debtData.originalAmount > paid) {
                        debtData.remainingAmount = debtData.originalAmount - paid;
                    } else if (debtData.originalAmount > 0 && paid === 0) {
                        debtData.remainingAmount = debtData.originalAmount;
                    }
                }

                // Insert directly to preserve logical state (amount, payments, settled)
                const newId = await tx.store.add(debtData);
                oldDebtIdToNewIdMap.set(oldId, newId);
                debtsToUpdate.push({ newId, oldData: debt });
            }
            await tx.done;
          }

          // 7. 匯入紀錄
          const oldRecordIdToNewIdMap = new Map();
          
          let recordsSource = [];
          if (data.version && data.version.startsWith('2.')) {
            recordsSource = data.records || []
          } else {
            recordsSource = this.convertOldDataFormat(data)
          }

          const validRecords = recordsSource.filter(record => 
            record.date && record.type && record.category && typeof record.amount === 'number'
          );

          const txRecords = this.db.transaction('records', 'readwrite');
          for (const record of validRecords) {
            const oldRecordId = record.id;
            const { id, ...recordData } = record;

            // Update accountId
            if (advancedModeEnabled && recordData.accountId !== undefined) {
                recordData.accountId = oldAccountIdToNewIdMap.get(recordData.accountId);
            }

            // Update debtId
            if (recordData.debtId) {
                recordData.debtId = oldDebtIdToNewIdMap.get(recordData.debtId);
            }

            // Add timestamp if missing or use existing, ensure new ID generation
            if (!recordData.timestamp) recordData.timestamp = Date.now();
            
            // Ensure UUID
            if (!recordData.uuid) recordData.uuid = this.generateUUID();

            // Ensure ledgerId
            recordData.ledgerId = getMappedLedgerId(recordData.ledgerId);

            const newRecordId = await txRecords.store.add(recordData);
            if (oldRecordId) {
                oldRecordIdToNewIdMap.set(oldRecordId, newRecordId);
            }
          }
          await txRecords.done;

          // 8. Update Debts (Phase 2: Link Records)
          // Now that we have newRecordIds, we can update debt references
          if (debtsToUpdate.length > 0) {
            const txUpdate = this.db.transaction('debts', 'readwrite');
            for (const item of debtsToUpdate) {
                const debt = await txUpdate.store.get(item.newId);
                if (debt) {
                    let changed = false;

                    // Link creation record
                    if (item.oldData.recordId) {
                        const newRecId = oldRecordIdToNewIdMap.get(item.oldData.recordId);
                        if (newRecId) {
                            debt.recordId = newRecId;
                            changed = true;
                        }
                    }

                    // Link payment records
                    if (debt.payments && Array.isArray(debt.payments)) {
                        const newPayments = debt.payments.map(p => {
                            if (p.recordId) {
                                const newRecId = oldRecordIdToNewIdMap.get(p.recordId);
                                if (newRecId) {
                                    changed = true;
                                    return { ...p, recordId: newRecId };
                                }
                            }
                            return p;
                        });
                        if (changed) {
                            debt.payments = newPayments;
                        }
                    }

                    if (changed) {
                        await txUpdate.store.put(debt);
                    }
                }
            }
            await txUpdate.done;
          }

          // 9. 匯入 Recurring Transactions
          if (data.recurring_transactions && Array.isArray(data.recurring_transactions)) {
              const txRecur = this.db.transaction('recurring_transactions', 'readwrite');
              for (const rt of data.recurring_transactions) {
                  const { id, ...rtData } = rt;
                  if (!rtData.uuid) rtData.uuid = this.generateUUID();
                  rtData.ledgerId = getMappedLedgerId(rtData.ledgerId);
                  
                  if (rtData.accountId !== undefined && oldAccountIdToNewIdMap.has(rtData.accountId)) {
                      rtData.accountId = oldAccountIdToNewIdMap.get(rtData.accountId);
                  }
                  await txRecur.store.add(rtData);
              }
              await txRecur.done;
          }

          resolve({ 
            success: true, 
            message: `成功匯入 ${validRecords.length} 筆記錄`,
          })

        } catch (error) {
          console.error('解析匯入檔案失敗:', error)
          reject(new Error('檔案格式錯誤或損壞'))
        }
      }

      reader.onerror = () => {
        reject(new Error('讀取檔案失敗'))
      }

      reader.readAsText(file)
    }) 
  }

  // 清除所有記錄
  async clearAllRecords() {
    if (this.useLocalStorage) {
      localStorage.removeItem('records')
      return true
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      await store.clear()
      await tx.done
      return true
    } catch (error) {
      console.error('清除記錄失敗:', error)
      throw error
    }
  }

  // 獲取所有記錄（用於匯出，包含所有帳本）
  async getAllRecords() {
    return await this.getRecords({ allLedgers: true })
  }

  // --- Sync Methods ---

  /**
   * 記錄變更到 sync_log（用於多裝置同步）
   * @param {string} operation - 'add', 'update', 'delete'
   * @param {string} storeName - object store 名稱
   * @param {number|string} recordId - 記錄 ID
   * @param {object|null} data - 記錄資料
   */
  async logChange(operation, storeName, recordId, data) {
    if (this.useLocalStorage || !this.db) return;
    try {
      let syncData = data;
      // Add ledgerUuid if record has ledgerId but no ledgerUuid
      if (syncData && syncData.ledgerId !== undefined && !syncData.ledgerUuid) {
        try {
          const ltx = this.db.transaction('ledgers', 'readonly');
          const ledger = await ltx.store.get(syncData.ledgerId);
          if (ledger && ledger.uuid) {
            syncData = { ...syncData, ledgerUuid: ledger.uuid };
          }
        } catch(e) {}
      }

      const tx = this.db.transaction('sync_log', 'readwrite');
      await tx.store.add({
        operation,
        storeName,
        recordId,
        data: syncData,
        timestamp: Date.now(),
        deviceId: this._syncDeviceId,
      });
      await tx.done;
    } catch (err) {
      console.warn('[DataService] logChange error:', err);
    }
  }

  /**
   * 取得指定時間戳之後的所有變更
   * @param {number} sinceTimestamp - 起始時間戳
   * @returns {Promise<Array>}
   */
  async getChangesSince(sinceTimestamp, options = {}) {
    if (this.useLocalStorage || !this.db) return [];
    try {
      const isSharedSync = !!options.sharedLedgerUuid;
      const targetUuid = options.sharedLedgerUuid;

      const allLedgers = await this.db.getAll('ledgers');
      const sharedUuids = new Set(allLedgers.filter(l => l.isShared).map(l => l.uuid));

      const tx = this.db.transaction('sync_log', 'readonly');
      const index = tx.store.index('timestamp');
      const range = IDBKeyRange.lowerBound(sinceTimestamp, true);
      const allChanges = await index.getAll(range);

      return allChanges.filter(log => {
        let logLedgerUuid = log.data?.ledgerUuid;
        if (!logLedgerUuid && log.storeName === 'ledgers') {
             logLedgerUuid = log.data?.uuid || null;
        }

        if (isSharedSync) {
            return logLedgerUuid === targetUuid;
        } else {
            // For personal sync, filter OUT if it belongs to any shared ledger
            if (logLedgerUuid) {
               return !sharedUuids.has(logLedgerUuid);
            }
            return true; // global stuff (settings) synced personally
        }
      });
    } catch (err) {
      console.error('[DataService] getChangesSince error:', err);
      return [];
    }
  }

  /**
   * 清除指定時間戳之前的同步日誌
   * @param {number} beforeTimestamp
   */
  async clearSyncLog(beforeTimestamp) {
    if (this.useLocalStorage || !this.db) return;
    try {
      const tx = this.db.transaction('sync_log', 'readwrite');
      const index = tx.store.index('timestamp');
      const range = IDBKeyRange.upperBound(beforeTimestamp);
      let cursor = await index.openCursor(range);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    } catch (err) {
      console.error('[DataService] clearSyncLog error:', err);
    }
  }

  /**
   * 匯出資料用於同步（回傳物件而非下載檔案）
   * @returns {Promise<object>}
   */
  async exportDataForSync(options = {}) {
    const isSharedSync = !!options.sharedLedgerUuid;
    const targetUuid = options.sharedLedgerUuid;

    let ledgers = await this.getLedgers();
    if (isSharedSync) {
        ledgers = ledgers.filter(l => l.uuid === targetUuid);
    } else {
        ledgers = ledgers.filter(l => !l.isShared);
    }
    
    const validLedgerIds = new Set(ledgers.map(l => l.id));

    // Filter all relevant object stores based on validLedgerIds
    const records = (await this.getRecords({ allLedgers: true })).filter(r => validLedgerIds.has(r.ledgerId));
    const accounts = (await this.getAccounts({ allLedgers: true })).filter(a => validLedgerIds.has(a.ledgerId));
    const contacts = (await this.getContacts({ allLedgers: true })).filter(c => validLedgerIds.has(c.ledgerId));
    const debts = (await this.getDebts({ allLedgers: true })).filter(d => validLedgerIds.has(d.ledgerId));
    const recurring_transactions = (await this.getRecurringTransactions({ allLedgers: true })).filter(r => validLedgerIds.has(r.ledgerId));

    const customCategoriesSetting = await this.getSetting('custom_categories');
    const customCategories = customCategoriesSetting?.value || null;
    const categoryOrderSetting = await this.getSetting('category_order');
    const categoryOrder = categoryOrderSetting?.value || null;
    const hiddenCategoriesSetting = await this.getSetting('hidden_categories');
    const hiddenCategories = hiddenCategoriesSetting?.value || null;
    const budgetSettingsSetting = await this.getSetting('budget_settings');
    const budgetSettings = budgetSettingsSetting?.value || null;
    const advancedAccountModeEnabled = await this.getSetting('advancedAccountModeEnabled');
    const debtManagementEnabled = await this.getSetting('debtManagementEnabled');


    return {
      version: '2.3.0',
      exportDate: new Date().toISOString(),
      settings: {
        advancedAccountModeEnabled: advancedAccountModeEnabled?.value || false,
        debtManagementEnabled: debtManagementEnabled?.value || false,
      },
      ledgers,
      accounts,
      records,
      contacts,
      debts,
      recurring_transactions,
      ...(isSharedSync ? {} : {
        customCategories,
        categoryOrder,
        hiddenCategories,
        budgetSettings
      }),
      metadata: {
        totalRecords: records.length,
        totalContacts: contacts.length,
        totalDebts: debts.length,
        totalLedgers: ledgers.length,
      },
    };
  }

  // --- Settings Methods ---
  async getSetting(key) {
    if (this.useLocalStorage) {
      return JSON.parse(localStorage.getItem(key) || 'null');
    }
    try {
      return await this.db.get('settings', key);
    } catch (error) {
      console.error(`Failed to get setting '${key}':`, error);
      return null;
    }
  }

  async saveSetting(setting) {
    if (this.useLocalStorage) {
      localStorage.setItem(setting.key, JSON.stringify(setting));
      return;
    }
    try {
      const tx = this.db.transaction('settings', 'readwrite');
      await tx.store.put(setting);
      await tx.done;
    } catch (error) {
      console.error(`Failed to save setting '${setting.key}':`, error);
      throw error;
    }
  }

  // --- Account Methods ---
  async addAccount(account, skipLog = false) {
    try {
      if (!account.uuid) account.uuid = this.generateUUID();
      // 同步接收路徑：移除來源裝置的 integer id，讓 IndexedDB 自動產生新 id
      const { id: _rid, ...accountWithoutId } = account;
      const dataToAdd = skipLog ? accountWithoutId : account;
      dataToAdd.ledgerId = dataToAdd.ledgerId ?? this.activeLedgerId;
      const tx = this.db.transaction('accounts', 'readwrite');
      const id = await tx.store.add(dataToAdd);
      await tx.done;
      if (!skipLog) await this.logChange('add', 'accounts', id, { ...dataToAdd, id });
      return id;
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  }

  async getAccount(id) {
    try {
      return await this.db.get('accounts', id);
    } catch (error) {
      console.error(`Failed to get account ${id}:`, error);
      return null;
    }
  }

  async getAccounts(filters = {}) {
    try {
      let accounts = await this.db.getAll('accounts');
      if (!filters.allLedgers) {
        const targetLedgerId = filters.ledgerId ?? this.activeLedgerId;
        accounts = accounts.filter(a => a.ledgerId === targetLedgerId);
      }
      return accounts;
    } catch (error) {
      console.error('Failed to get accounts:', error);
      return [];
    }
  }

  async updateAccount(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('accounts', 'readwrite');
      const account = await tx.store.get(id);
      if (account) {
        let finalUpdates = { ...updates };
        if (skipLog) {
            delete finalUpdates.id;
            if (account.uuid) finalUpdates.uuid = account.uuid;
        }
        const updatedAccount = { ...account, ...finalUpdates };
        await tx.store.put(updatedAccount);
        await tx.done;
        if (!skipLog) await this.logChange('update', 'accounts', id, updatedAccount);
        return updatedAccount;
      }
      throw new Error('Account not found');
    } catch (error) {
      console.error(`Failed to update account ${id}:`, error);
      throw error;
    }
  }

  async deleteAccount(id, skipLog = false) {
    const tx = this.db.transaction('accounts', 'readwrite');
    let uuid = null;
    if (!skipLog) {
        const record = await tx.store.get(id);
        uuid = record?.uuid;
    }
    await tx.store.delete(id);
    await tx.done;
    if (!skipLog) await this.logChange('delete', 'accounts', id, { uuid });
    return true;
  }

  // 清除所有帳戶
  async clearAllAccounts() {
    try {
      const tx = this.db.transaction('accounts', 'readwrite');
      await tx.store.clear();
      await tx.done;
      return true;
    } catch (error) {
      console.error('Failed to clear accounts:', error);
      throw error;
    }
  }

  // 清除所有聯絡人
  async clearAllContacts() {
    try {
      const tx = this.db.transaction('contacts', 'readwrite');
      await tx.store.clear();
      await tx.done;
      return true;
    } catch (error) {
      console.error('Failed to clear contacts:', error);
      throw error;
    }
  }

  // 清除所有欠款
  async clearAllDebts() {
    try {
      const tx = this.db.transaction('debts', 'readwrite');
      await tx.store.clear();
      await tx.done;
      return true;
    } catch (error) {
      console.error('Failed to clear debts:', error);
      throw error;
    }
  }

  // --- File Methods (for storing avatars, etc.) ---
  async addFile(file) {
    try {
      const fileData = {
        name: file.name || 'file',
        type: file.type || 'application/octet-stream',
        data: file.data, // Blob
        createdAt: Date.now()
      };
      const tx = this.db.transaction('files', 'readwrite');
      const id = await tx.store.add(fileData);
      await tx.done;
      return id;
    } catch (error) {
      console.error('Failed to add file:', error);
      throw error;
    }
  }

  async getFile(id) {
    try {
      return await this.db.get('files', id);
    } catch (error) {
      console.error(`Failed to get file ${id}:`, error);
      return null;
    }
  }

  async deleteFile(id) {
    try {
      const tx = this.db.transaction('files', 'readwrite');
      await tx.store.delete(id);
      await tx.done;
      return true;
    } catch (error) {
      console.error(`Failed to delete file ${id}:`, error);
      throw error;
    }
  }

  // --- Contact Methods ---
  async addContact(contact, skipLog = false) {
    try {
      let contactData;
      if (skipLog) {
        // 同步接收路徑：保留所有傳入欄位
        contactData = { ...contact, uuid: contact.uuid || this.generateUUID() };
      } else {
        // 正規新建路徑：使用明確欄位結構
        contactData = {
          name: contact.name,
          avatarFileId: contact.avatarFileId || null,
          createdAt: Date.now(),
          uuid: contact.uuid || this.generateUUID()
        };
      }
      contactData.ledgerId = contactData.ledgerId ?? this.activeLedgerId;
      delete contactData.id; // 讓 IndexedDB 自動產生，避免 key 衝突
      const tx = this.db.transaction('contacts', 'readwrite');
      const id = await tx.store.add(contactData);
      await tx.done;
      if (!skipLog) await this.logChange('add', 'contacts', id, { ...contactData, id });
      return id;
    } catch (error) {
      console.error('Failed to add contact:', error);
      throw error;
    }
  }

  async getContact(id) {
    try {
      return await this.db.get('contacts', id);
    } catch (error) {
      console.error(`Failed to get contact ${id}:`, error);
      return null;
    }
  }

  async getContacts(filters = {}) {
    try {
      let contacts = await this.db.getAll('contacts');
      if (!filters.allLedgers) {
        const targetLedgerId = filters.ledgerId ?? this.activeLedgerId;
        contacts = contacts.filter(c => c.ledgerId === targetLedgerId);
      }
      return contacts;
    } catch (error) {
      console.error('Failed to get contacts:', error);
      return [];
    }
  }

  async updateContact(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('contacts', 'readwrite');
      const contact = await tx.store.get(id);
      if (contact) {
        let finalUpdates = { ...updates };
        if (skipLog) {
            delete finalUpdates.id;
            if (contact.uuid) finalUpdates.uuid = contact.uuid;
        }
        const updatedContact = { ...contact, ...finalUpdates };
        await tx.store.put(updatedContact);
        await tx.done;
        if (!skipLog) await this.logChange('update', 'contacts', id, updatedContact);
        return updatedContact;
      }
      throw new Error('Contact not found');
    } catch (error) {
      console.error(`Failed to update contact ${id}:`, error);
      throw error;
    }
  }

  async deleteContact(id, skipLog = false) {
    try {
      const tx = this.db.transaction('contacts', 'readwrite');
      let uuid = null;
      if (!skipLog) {
          const record = await tx.store.get(id);
          uuid = record?.uuid;
      }
      await tx.store.delete(id);
      await tx.done;
      if (!skipLog) await this.logChange('delete', 'contacts', id, { uuid });
      return true;
    } catch (error) {
      console.error(`Failed to delete contact ${id}:`, error);
      throw error;
    }
  }

  // --- Debt Methods ---
  async addDebt(debt, skipLog = false) {
    try {
      // 補充 contactUuid / recordUuid 以便跨裝置同步時正確解析外鍵
      let contactUuid = debt.contactUuid || null;
      if (debt.contactId && !contactUuid) {
        try {
          const contact = await this.db.get('contacts', debt.contactId);
          if (contact?.uuid) contactUuid = contact.uuid;
        } catch (_) { /* 查不到聯絡人不影響儲存 */ }
      }

      let recordUuid = debt.recordUuid || null;
      if (debt.recordId && !recordUuid) {
        try {
          const rec = await this.db.get('records', debt.recordId);
          if (rec?.uuid) recordUuid = rec.uuid;
        } catch (_) { /* 查不到紀錄不影響儲存 */ }
      }

      let debtData;

      if (skipLog) {
        // ── 同步接收路徑：保留所有傳入欄位（含 settled、payments、金額等）──
        const amount = debt.amount ?? debt.originalAmount ?? debt.remainingAmount ?? 0;
        debtData = {
          ...debt,
          contactUuid,
          ...(recordUuid ? { recordUuid } : {}),
          originalAmount: debt.originalAmount ?? amount,
          remainingAmount: debt.remainingAmount ?? amount,
          uuid: debt.uuid || this.generateUUID(),
        };
      } else {
        // ── 正規新建路徑：使用明確初始化的欄位結構 ──
        const amount = debt.amount;
        debtData = {
          type: debt.type, // 'receivable' | 'payable'
          contactId: debt.contactId,
          contactUuid,
          originalAmount: amount,
          remainingAmount: amount,
          recordId: debt.recordId || null,
          ...(recordUuid ? { recordUuid } : {}),
          date: debt.date,
          description: debt.description || '',
          settled: false,
          settledAt: null,
          payments: [],
          createdAt: Date.now(),
          uuid: debt.uuid || this.generateUUID()
        };
      }

      debtData.ledgerId = debtData.ledgerId ?? this.activeLedgerId;
      // 移除 id（讓 IndexedDB 自動產生），避免 key 衝突
      delete debtData.id;

      const tx = this.db.transaction('debts', 'readwrite');
      const id = await tx.store.add(debtData);
      await tx.done;
      if (!skipLog) await this.logChange('add', 'debts', id, { ...debtData, id });
      return id;
    } catch (error) {
      console.error('Failed to add debt:', error);
      throw error;
    }
  }

  async getDebt(id) {
    try {
      return await this.db.get('debts', id);
    } catch (error) {
      console.error(`Failed to get debt ${id}:`, error);
      return null;
    }
  }

  async getDebts(filters = {}) {
    try {
      let debts = await this.db.getAll('debts');

      // 帳本篩選
      if (!filters.allLedgers) {
        const targetLedgerId = filters.ledgerId ?? this.activeLedgerId;
        debts = debts.filter(d => d.ledgerId === targetLedgerId);
      }

      if (filters.contactId !== undefined) {
        debts = debts.filter(d => d.contactId === filters.contactId);
      }
      if (filters.type) {
        debts = debts.filter(d => d.type === filters.type);
      }
      if (filters.settled !== undefined) {
        debts = debts.filter(d => d.settled === filters.settled);
      }
      
      return debts.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('Failed to get debts:', error);
      return [];
    }
  }

  async updateDebt(id, updates, skipLog = false) {
    try {
      // 若更新包含 contactId / recordId，同步更新對應 UUID
      let extraUpdates = {};
      if (updates.contactId !== undefined) {
        if (updates.contactId) {
          try {
            const contact = await this.db.get('contacts', updates.contactId);
            if (contact?.uuid) extraUpdates.contactUuid = contact.uuid;
          } catch (_) { /* 查不到聯絡人不影響更新 */ }
        } else {
          extraUpdates.contactUuid = null;
        }
      }
      if (updates.recordId !== undefined) {
        if (updates.recordId) {
          try {
            const record = await this.db.get('records', updates.recordId);
            if (record?.uuid) extraUpdates.recordUuid = record.uuid;
          } catch (_) { /* 查不到紀錄不影響更新 */ }
        } else {
          extraUpdates.recordUuid = null;
        }
      }

      const tx = this.db.transaction('debts', 'readwrite');
      const debt = await tx.store.get(id);
      if (debt) {
        // 同步路徑時 (skipLog=true)，數據來自遠端，可能包含遠端 ID 或 UUID
        // 必須確保本地 UUID 不被意外覆蓋，除非遠端 UUID 確定是正確的關聯標識
        // 通常同步時我們會根據 UUID 找到本地 ID，所以傳入的 updates.uuid 理應與本地相同
        // 但為了保險起見，保護本地 uuid 與 id 不被 `...updates` 覆蓋
        let finalUpdates = { ...updates, ...extraUpdates };
        if (skipLog) {
            delete finalUpdates.id;
            // 確保不覆蓋本地 UUID
            if (debt.uuid) {
               finalUpdates.uuid = debt.uuid; 
            }
        }

        const updatedDebt = { ...debt, ...finalUpdates };
        await tx.store.put(updatedDebt);
        await tx.done;
        if (!skipLog) await this.logChange('update', 'debts', id, updatedDebt);
        return updatedDebt;
      }
      throw new Error('Debt not found');
    } catch (error) {
      console.error(`Failed to update debt ${id}:`, error);
      throw error;
    }
  }

  async deleteDebt(id, skipLog = false) {
    try {
      const tx = this.db.transaction('debts', 'readwrite');
      let uuid = null;
      if (!skipLog) {
          const record = await tx.store.get(id);
          uuid = record?.uuid;
      }
      await tx.store.delete(id);
      await tx.done;
      if (!skipLog) await this.logChange('delete', 'debts', id, { uuid });
      return true;
    } catch (error) {
      console.error(`Failed to delete debt ${id}:`, error);
      throw error;
    }
  }

  async settleDebt(id, paymentAmount = null) {
    try {
      const debt = await this.getDebt(id);
      if (!debt) throw new Error('Debt not found');
      if (debt.settled) return debt; // Already settled
      
      // Determine payment amount (full or partial)
      const amount = paymentAmount || debt.remainingAmount;
      const newRemainingAmount = debt.remainingAmount - amount;
      const isFullySettled = newRemainingAmount <= 0;
      
      // Create payment record in history
      const paymentRecord = {
        amount,
        date: new Date().toISOString().split('T')[0],
        recordId: null
      };
      
      // Only create a transaction record if this debt was NOT linked to an existing expense/income
      // If it was linked (recordId exists), the cash flow was already recorded at creation
      // Creating another record would cause double-counting in statistics
      let newRecordId = null;
      if (!debt.recordId) {
        const contact = await this.getContact(debt.contactId);
        const contactName = contact?.name || '未知聯絡人';
        
        const record = {
          type: debt.type === 'receivable' ? 'income' : 'expense',
          category: debt.type === 'receivable' ? 'debt_collection' : 'debt_repayment',
          amount: amount,
          date: new Date().toISOString().split('T')[0],
          description: debt.type === 'receivable' 
            ? `收回欠款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`
            : `還款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`,
          ledgerId: debt.ledgerId,
          debtId: id
        };
        
        newRecordId = await this.addRecord(record);
      }
      
      paymentRecord.recordId = newRecordId;
      if (newRecordId) {
        const newRecord = await this.getRecord(newRecordId);
        if (newRecord?.uuid) {
          paymentRecord.recordUuid = newRecord.uuid;
        }
      } else if (debt.recordUuid) {
        // If linked to original record, use original record's UUID for identification in payments array
        paymentRecord.recordUuid = debt.recordUuid;
        paymentRecord.recordId = debt.recordId;
      }
      
      // Update debt with new payment
      const updatedPayments = [...(debt.payments || []), paymentRecord];
      const updates = {
        remainingAmount: Math.max(0, newRemainingAmount),
        payments: updatedPayments
      };
      
      if (isFullySettled) {
        updates.settled = true;
        updates.settledAt = Date.now();
      }
      
      const updatedDebt = await this.updateDebt(id, updates);
      return updatedDebt;
    } catch (error) {
      console.error(`Failed to settle debt ${id}:`, error);
      throw error;
    }
  }

  // Add partial payment to a debt
  async addPartialPayment(debtId, amount) {
    return this.settleDebt(debtId, amount);
  }

  // Get debt summary by contact
  async getDebtSummary() {
    try {
      const debts = await this.getDebts({ settled: false });
      const contacts = await this.getContacts();
      
      let totalReceivable = 0;
      let totalPayable = 0;
      const byContact = {};
      
      for (const debt of debts) {
        // Use remainingAmount for calculations, fallback to originalAmount for backward compatibility
        const amount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
        
        if (debt.type === 'receivable') {
          totalReceivable += amount;
        } else {
          totalPayable += amount;
        }
        
        if (!byContact[debt.contactId]) {
          const contact = contacts.find(c => c.id === debt.contactId);
          byContact[debt.contactId] = {
            contact: contact || { id: debt.contactId, name: '未知聯絡人' },
            receivable: 0,
            payable: 0,
            debts: []
          };
        }
        
        if (debt.type === 'receivable') {
          byContact[debt.contactId].receivable += amount;
        } else {
          byContact[debt.contactId].payable += amount;
        }
        byContact[debt.contactId].debts.push(debt);
      }
      
      return {
        totalReceivable,
        totalPayable,
        byContact: Object.values(byContact)
      };
    } catch (error) {
      console.error('Failed to get debt summary:', error);
      return { totalReceivable: 0, totalPayable: 0, byContact: [] };
    }
  }

  // ==================== 帳本管理 ====================

  /**
   * 切換當前帳本
   * @param {number} ledgerId
   */
  setActiveLedger(ledgerId) {
    this.activeLedgerId = ledgerId;
    localStorage.setItem('activeLedgerId', String(ledgerId));
  }

  /**
   * 新增帳本
   * @param {object} ledger { name, icon, color, type }
   * @returns {Promise<number>} 新帳本 ID
   */
  async addLedger(ledger, skipLog = false) {
    try {
      const data = {
        name: ledger.name,
        icon: ledger.icon || 'fa-solid fa-book',
        color: ledger.color || '#334A52',
        type: ledger.type || 'personal',
        uuid: ledger.uuid || this.generateUUID(),
        createdAt: Date.now(),
      };
      const tx = this.db.transaction('ledgers', 'readwrite');
      const id = await tx.store.add(data);
      await tx.done;
      if (!skipLog) await this.logChange('add', 'ledgers', id, { ...data, id });
      return id;
    } catch (error) {
      console.error('Failed to add ledger:', error);
      throw error;
    }
  }

  /**
   * 取得單一帳本
   * @param {number} id
   */
  async getLedger(id) {
    try {
      return await this.db.get('ledgers', id);
    } catch (error) {
      console.error(`Failed to get ledger ${id}:`, error);
      return null;
    }
  }

  /**
   * 取得所有帳本
   * @returns {Promise<Array>}
   */
  async getLedgers() {
    try {
      return await this.db.getAll('ledgers');
    } catch (error) {
      console.error('Failed to get ledgers:', error);
      return [];
    }
  }

  /**
   * 更新帳本
   * @param {number} id
   * @param {object} updates
   */
  async updateLedger(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('ledgers', 'readwrite');
      const ledger = await tx.store.get(id);
      if (!ledger) throw new Error('Ledger not found');
      let finalUpdates = { ...updates };
      if (skipLog) {
          delete finalUpdates.id;
          if (ledger.uuid) finalUpdates.uuid = ledger.uuid;
      }
      const updated = { ...ledger, ...finalUpdates };
      await tx.store.put(updated);
      await tx.done;
      if (!skipLog) await this.logChange('update', 'ledgers', id, updated);
      return updated;
    } catch (error) {
      console.error(`Failed to update ledger ${id}:`, error);
      throw error;
    }
  }

  /**
   * 刪除帳本 + 連帶刪除所有歸屬該帳本的資料
   * @param {number} id 帳本 ID（不可刪除預設帳本 id=1）
   */
  async deleteLedger(id, skipLog = false) {
    if (id === 1) throw new Error('不可刪除預設帳本');
    try {
      // 連帶刪除歸屬此帳本的所有資料
      const dataStores = ['records', 'accounts', 'contacts', 'debts', 'recurring_transactions'];
      for (const storeName of dataStores) {
        const tx = this.db.transaction(storeName, 'readwrite');
        const index = tx.store.index('ledgerId');
        let cursor = await index.openCursor(IDBKeyRange.only(id));
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
        await tx.done;
      }

      const tx = this.db.transaction('ledgers', 'readwrite');
      let uuid = null;
      if (!skipLog) {
          const ledger = await tx.store.get(id);
          uuid = ledger?.uuid;
      }
      await tx.store.delete(id);
      await tx.done;

      if (!skipLog) await this.logChange('delete', 'ledgers', id, { uuid });

      // 若當前帳本被刪除，切回預設帳本
      if (this.activeLedgerId === id) {
        this.setActiveLedger(1);
      }
      return true;
    } catch (error) {
      console.error(`Failed to delete ledger ${id}:`, error);
      throw error;
    }
  }
}

export default DataService
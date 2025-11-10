// 資料服務模組 - 使用 IndexedDB 進行資料儲存
// 如果 idb 不可用，使用全域的 idb
const openDB = window.idb?.openDB || (() => {
  console.warn('IndexedDB 不可用，將使用 localStorage')
  return null
})

class DataService {
  constructor() {
    this.dbName = 'EasyAccountingDB'
    this.dbVersion = 3 // <<<<<<< CHANGE: Bump version for schema upgrade
    this.db = null
    this.init()
  }

  async init() {
    try {
      if (openDB && typeof openDB === 'function') {
        this.db = await openDB(this.dbName, this.dbVersion, {
          upgrade(db, oldVersion, newVersion, transaction) {
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
  async addRecord(record) {
    const recordWithTimestamp = {
      ...record,
      timestamp: Date.now()
    }

    if (this.useLocalStorage) {
      return this.addRecordToLocalStorage(recordWithTimestamp)
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const result = await store.add(recordWithTimestamp)
      await tx.done
      return result
    } catch (error) {
      console.error('新增記錄失敗:', error)
      throw error
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

  // 更新記錄
  async updateRecord(id, updates) {
    if (this.useLocalStorage) {
      return this.updateRecordInLocalStorage(id, updates)
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const record = await store.get(id)
      
      if (record) {
        const updatedRecord = { ...record, ...updates }
        await store.put(updatedRecord)
        await tx.done
        return updatedRecord
      }
      
      throw new Error('記錄不存在')
    } catch (error) {
      console.error('更新記錄失敗:', error)
      throw error
    }
  }

  // 刪除記錄
  async deleteRecord(id) {
    if (this.useLocalStorage) {
      return this.deleteRecordFromLocalStorage(id)
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      await store.delete(id)
      await tx.done
      return true
    } catch (error) {
      console.error('刪除記錄失敗:', error)
      throw error;
    }
  }

  // --- Recurring Transaction Methods ---
  async addRecurringTransaction(transaction) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      const id = await tx.store.add(transaction);
      await tx.done;
      return id;
    } catch (error) {
      console.error('Failed to add recurring transaction:', error);
      throw error;
    }
  }

  async getRecurringTransactions() {
    try {
      return await this.db.getAll('recurring_transactions');
    } catch (error) {
      console.error('Failed to get recurring transactions:', error);
      return [];
    }
  }

  async updateRecurringTransaction(id, updates) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      const transaction = await tx.store.get(id);
      if (transaction) {
        const updatedTransaction = { ...transaction, ...updates };
        await tx.store.put(updatedTransaction);
        await tx.done;
        return updatedTransaction;
      }
      throw new Error('Recurring transaction not found');
    } catch (error) {
      console.error(`Failed to update recurring transaction ${id}:`, error);
      throw error;
    }
  }

  async deleteRecurringTransaction(id) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite');
      await tx.store.delete(id);
      await tx.done;
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
    
    const stats = {
      totalIncome: 0,
      totalExpense: 0,
      incomeByCategory: {},
      expenseByCategory: {},
      dailyTotals: {}
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
  async exportData() {
    try {
      const records = await this.getRecords();
      const customCategories = JSON.parse(localStorage.getItem('customCategories') || 'null');
      const accounts = await this.getAccounts();
      const advancedAccountModeEnabled = await this.getSetting('advancedAccountModeEnabled');

      const exportData = {
        version: '2.1.1', // New version to indicate accounts are included
        exportDate: new Date().toISOString(),
        settings: {
            advancedAccountModeEnabled: advancedAccountModeEnabled?.value || false,
        },
        accounts: accounts,
        records: records,
        customCategories: customCategories,
        metadata: {
          totalRecords: records.length,
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
          localStorage.removeItem('customCategories');
          await this.saveSetting({ key: 'advancedAccountModeEnabled', value: false });


          // --- 開始匯入 ---
          // 1. 匯入設定
          const advancedModeEnabled = data.settings?.advancedAccountModeEnabled || false;
          await this.saveSetting({ key: 'advancedAccountModeEnabled', value: advancedModeEnabled });

          // 2. 匯入自訂分類
          if (data.customCategories) {
            localStorage.setItem('customCategories', JSON.stringify(data.customCategories));
          }

          // 3. 匯入帳戶並建立 ID Map
          const oldIdToNewIdMap = new Map();
          if (advancedModeEnabled && data.accounts && Array.isArray(data.accounts)) {
            for (const account of data.accounts) {
                const oldId = account.id;
                const { id, ...accountData } = account;
                const newId = await this.addAccount(accountData);
                oldIdToNewIdMap.set(oldId, newId);
            }
          }

          // 4. 匯入紀錄
          let records = [];
          if (data.version && data.version.startsWith('2.')) {
            records = data.records || []
          } else {
            records = this.convertOldDataFormat(data)
          }

          const validRecords = records.filter(record => 
            record.date && record.type && record.category && typeof record.amount === 'number'
          );

          for (const record of validRecords) {
            // 如果是進階模式，更新 accountId
            if (advancedModeEnabled && record.accountId !== undefined) {
                record.accountId = oldIdToNewIdMap.get(record.accountId);
            }
            await this.addRecord(record);
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

  // 獲取所有記錄（用於匯出）
  async getAllRecords() {
    return await this.getRecords()
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
  async addAccount(account) {
    try {
      const tx = this.db.transaction('accounts', 'readwrite');
      const id = await tx.store.add(account);
      await tx.done;
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

  async getAccounts() {
    try {
      return await this.db.getAll('accounts');
    } catch (error) {
      console.error('Failed to get accounts:', error);
      return [];
    }
  }

  async updateAccount(id, updates) {
    try {
      const tx = this.db.transaction('accounts', 'readwrite');
      const account = await tx.store.get(id);
      if (account) {
        const updatedAccount = { ...account, ...updates };
        await tx.store.put(updatedAccount);
        await tx.done;
        return updatedAccount;
      }
      throw new Error('Account not found');
    } catch (error) {
      console.error(`Failed to update account ${id}:`, error);
      throw error;
    }
  }

  async deleteAccount(id) {
    // Note: This doesn't re-assign records from the deleted account.
    // That logic should be handled at the application level.
    try {
      const tx = this.db.transaction('accounts', 'readwrite');
      await tx.store.delete(id);
      await tx.done;
      return true;
    } catch (error) {
      throw error;
    }
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
}

export default DataService
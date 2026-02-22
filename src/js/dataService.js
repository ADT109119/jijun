// 資料服務模組 - 使用 IndexedDB 進行資料儲存
// 如果 idb 不可用，使用全域的 idb
const openDB =
  window.idb?.openDB ||
  (() => {
    console.warn('IndexedDB 不可用，將使用 localStorage')
    return null
  })

class DataService {
  constructor() {
    this.dbName = 'EasyAccountingDB'
    this.dbVersion = 6 // Schema version 6: Add sync_log
    this.db = null
    this.init()
    this.hookProvider = null // Function to trigger hooks
    this._syncDeviceId = localStorage.getItem('sync_device_id') || 'unknown'
  }

  setHookProvider(fn) {
    this.hookProvider = fn
  }

  async triggerHook(hookName, payload) {
    if (this.hookProvider) {
      return await this.hookProvider(hookName, payload)
    }
    return payload
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
                  autoIncrement: true,
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
                  autoIncrement: true,
                })
                accountStore.createIndex('name', 'name', { unique: true })
              }
              const recordStore = transaction.objectStore('records')
              if (!recordStore.indexNames.contains('accountId')) {
                recordStore.createIndex('accountId', 'accountId')
              }
            }
            // Schema version 3
            if (oldVersion < 3) {
              if (!db.objectStoreNames.contains('recurring_transactions')) {
                const recurringStore = db.createObjectStore(
                  'recurring_transactions',
                  {
                    keyPath: 'id',
                    autoIncrement: true,
                  }
                )
                recurringStore.createIndex('nextDueDate', 'nextDueDate')
              }
            }
            // Schema version 4: Debt management system
            if (oldVersion < 4) {
              // Files store for storing blobs (avatars, etc.)
              if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files', {
                  keyPath: 'id',
                  autoIncrement: true,
                })
              }
              // Contacts store for debt management
              if (!db.objectStoreNames.contains('contacts')) {
                const contactStore = db.createObjectStore('contacts', {
                  keyPath: 'id',
                  autoIncrement: true,
                })
                contactStore.createIndex('name', 'name')
              }
              // Debts store for tracking receivables and payables
              if (!db.objectStoreNames.contains('debts')) {
                const debtStore = db.createObjectStore('debts', {
                  keyPath: 'id',
                  autoIncrement: true,
                })
                debtStore.createIndex('contactId', 'contactId')
                debtStore.createIndex('type', 'type')
                debtStore.createIndex('settled', 'settled')
              }
            }
            // Schema version 5: Plugin System
            if (oldVersion < 5) {
              if (!db.objectStoreNames.contains('plugins')) {
                const pluginStore = db.createObjectStore('plugins', {
                  keyPath: 'id',
                })
                // id: plugin identifier (e.g. 'com.example.myplugin')
                // name, version, script (blob/string), enabled (bool)
              }
            }
            // Schema version 6: Sync log for multi-device sync
            if (oldVersion < 6) {
              if (!db.objectStoreNames.contains('sync_log')) {
                const syncStore = db.createObjectStore('sync_log', {
                  keyPath: 'id',
                  autoIncrement: true,
                })
                syncStore.createIndex('timestamp', 'timestamp')
              }
            }
          },
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
                    timestamp: new Date(`${year}-${month}-${day}`).getTime(),
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
                    timestamp: new Date(`${year}-${month}-${day}`).getTime(),
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
    const recordWithTimestamp = {
      ...record,
      timestamp: Date.now(),
    }

    if (this.useLocalStorage) {
      return this.addRecordToLocalStorage(recordWithTimestamp)
    }

    try {
      // Hook: Before Save
      let recordToSave = recordWithTimestamp
      if (!skipLog) {
        recordToSave = await this.triggerHook(
          'onRecordSaveBefore',
          recordToSave
        )
        if (!recordToSave) return null // Cancelled
      }

      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const result = await store.add(recordToSave)
      await tx.done

      // Hook: After Save
      if (!skipLog) {
        await this.triggerHook('onRecordSaveAfter', {
          ...recordToSave,
          id: result,
        })
      }

      // Change tracking for sync
      if (!skipLog) {
        await this.logChange('add', 'records', result, {
          ...recordToSave,
          id: result,
        })
      }

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
        records = records.filter(
          record => record.accountId === filters.accountId
        )
      }

      return records.sort((a, b) => b.timestamp - a.timestamp)
    } catch (error) {
      console.error('獲取記錄失敗:', error)
      return []
    }
  }

  // 更新記錄
  async updateRecord(id, updates, skipLog = false) {
    if (this.useLocalStorage) {
      return this.updateRecordInLocalStorage(id, updates)
    }

    try {
      const tx = this.db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      const record = await store.get(id)

      if (record) {
        let finalUpdates = updates
        if (!skipLog) {
          // Hook: Before Update
          const updatesWithHook = await this.triggerHook(
            'onRecordUpdateBefore',
            { old: record, updates }
          )
          if (!updatesWithHook) throw new Error('Update cancelled by plugin')
          finalUpdates = updatesWithHook.updates || updates
        }

        const updatedRecord = { ...record, ...finalUpdates }
        await store.put(updatedRecord)
        await tx.done

        if (!skipLog) {
          await this.triggerHook('onRecordUpdateAfter', updatedRecord)
          await this.logChange('update', 'records', id, updatedRecord)
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

      if (!skipLog) {
        const shouldDelete = await this.triggerHook('onRecordDeleteBefore', {
          id,
        })
        if (!shouldDelete) throw new Error('Delete cancelled by plugin')
      }

      await store.delete(id)
      await tx.done

      if (!skipLog) {
        await this.triggerHook('onRecordDeleteAfter', { id })
        await this.logChange('delete', 'records', id, null)
      }

      return true
    } catch (error) {
      console.error('刪除記錄失敗:', error)
      throw error
    }
  }

  // --- Recurring Transaction Methods ---
  async addRecurringTransaction(transaction) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite')
      const id = await tx.store.add(transaction)
      await tx.done
      return id
    } catch (error) {
      console.error('Failed to add recurring transaction:', error)
      throw error
    }
  }

  async getRecurringTransactions() {
    try {
      return await this.db.getAll('recurring_transactions')
    } catch (error) {
      console.error('Failed to get recurring transactions:', error)
      return []
    }
  }

  async updateRecurringTransaction(id, updates) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite')
      const transaction = await tx.store.get(id)
      if (transaction) {
        const updatedTransaction = { ...transaction, ...updates }
        await tx.store.put(updatedTransaction)
        await tx.done
        return updatedTransaction
      }
      throw new Error('Recurring transaction not found')
    } catch (error) {
      console.error(`Failed to update recurring transaction ${id}:`, error)
      throw error
    }
  }

  async deleteRecurringTransaction(id) {
    try {
      const tx = this.db.transaction('recurring_transactions', 'readwrite')
      await tx.store.delete(id)
      await tx.done
      return true
    } catch (error) {
      console.error(`Failed to delete recurring transaction ${id}:`, error)
      throw error
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
  async getStatistics(
    startDate,
    endDate,
    accountId = null,
    offsetTransfers = false
  ) {
    const filters = { startDate, endDate }
    if (accountId) {
      filters.accountId = accountId
    }
    let records = await this.getRecords(filters)

    if (offsetTransfers) {
      records = records.filter(r => r.category !== 'transfer')
    }

    // Exclude debt-related categories from statistics
    // These are just "moving money" not real income/expense
    records = records.filter(
      r => r.category !== 'debt_collection' && r.category !== 'debt_repayment'
    )

    const stats = {
      totalIncome: 0,
      totalExpense: 0,
      incomeByCategory: {},
      expenseByCategory: {},
      dailyTotals: {},
      records: records, // Include filtered records in result
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
      stats.dailyTotals[date][
        record.type === 'income' ? 'income' : 'expense'
      ] += record.amount
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
      includeCategories = true,
    } = options

    try {
      const records = includeRecords ? await this.getRecords() : []
      const customCategories = includeCategories
        ? JSON.parse(localStorage.getItem('customCategories') || 'null')
        : null
      const accounts = includeAccounts ? await this.getAccounts() : []
      const advancedAccountModeEnabled = await this.getSetting(
        'advancedAccountModeEnabled'
      )
      const debtManagementEnabled = await this.getSetting(
        'debtManagementEnabled'
      )
      const contacts = includeDebts ? await this.getContacts() : []
      const debts = includeDebts ? await this.getDebts() : []

      const exportData = {
        version: '2.2.0', // Version 2.2.0 includes debt management
        exportDate: new Date().toISOString(),
        settings: {
          advancedAccountModeEnabled:
            advancedAccountModeEnabled?.value || false,
          debtManagementEnabled: debtManagementEnabled?.value || false,
        },
        accounts: accounts,
        records: records,
        contacts: contacts,
        debts: debts,
        customCategories: customCategories,
        metadata: {
          totalRecords: records.length,
          totalContacts: contacts.length,
          totalDebts: debts.length,
          dateRange: {
            start:
              records.length > 0
                ? Math.min(...records.map(r => new Date(r.date).getTime()))
                : null,
            end:
              records.length > 0
                ? Math.max(...records.map(r => new Date(r.date).getTime()))
                : null,
          },
        },
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      })
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

      reader.onload = async event => {
        try {
          const data = JSON.parse(event.target.result)

          // 確認是否要覆蓋現有資料
          if ((await this.getRecords()).length > 0) {
            const confirmed = confirm(
              `匯入新資料將會覆蓋所有現有資料 (包含紀錄、帳戶、分類設定)。\n\n確定要繼續嗎？`
            )
            if (!confirmed) {
              resolve({ success: false, message: '使用者取消操作' })
              return
            }
          }

          // --- 清除所有舊資料 ---
          await this.clearAllRecords()
          await this.clearAllAccounts()
          await this.clearAllContacts()
          await this.clearAllDebts()
          localStorage.removeItem('customCategories')
          await this.saveSetting({
            key: 'advancedAccountModeEnabled',
            value: false,
          })
          await this.saveSetting({ key: 'debtManagementEnabled', value: false })

          // --- 開始匯入 ---
          // 1. 匯入設定
          const advancedModeEnabled =
            data.settings?.advancedAccountModeEnabled || false
          const debtManagementEnabled =
            data.settings?.debtManagementEnabled || false
          await this.saveSetting({
            key: 'advancedAccountModeEnabled',
            value: advancedModeEnabled,
          })
          await this.saveSetting({
            key: 'debtManagementEnabled',
            value: debtManagementEnabled,
          })

          // 2. 匯入自訂分類
          if (data.customCategories) {
            localStorage.setItem(
              'customCategories',
              JSON.stringify(data.customCategories)
            )
          }

          // 3. 匯入帳戶並建立 ID Map
          const oldAccountIdToNewIdMap = new Map()
          if (
            advancedModeEnabled &&
            data.accounts &&
            Array.isArray(data.accounts)
          ) {
            for (const account of data.accounts) {
              const oldId = account.id
              const { id, ...accountData } = account
              const newId = await this.addAccount(accountData)
              oldAccountIdToNewIdMap.set(oldId, newId)
            }
          }

          // 4. 匯入聯絡人並建立 ID Map
          const oldContactIdToNewIdMap = new Map()
          if (data.contacts && Array.isArray(data.contacts)) {
            for (const contact of data.contacts) {
              const oldId = contact.id
              const { id, ...contactData } = contact
              const newId = await this.addContact(contactData)
              oldContactIdToNewIdMap.set(oldId, newId)
            }
          }

          // 5. 匯入欠款 (Phase 1: Insert & Map IDs)
          // We use direct DB insertion instead of addDebt to preserve imported state (amounts, payments, etc.)
          const oldDebtIdToNewIdMap = new Map()
          const debtsToUpdate = [] // Keep track for Phase 2 linking

          if (data.debts && Array.isArray(data.debts)) {
            const tx = this.db.transaction('debts', 'readwrite')
            for (const debt of data.debts) {
              const oldId = debt.id
              const { id, ...debtData } = debt

              // Update contactId
              if (debtData.contactId) {
                debtData.contactId = oldContactIdToNewIdMap.get(
                  debtData.contactId
                )
              }

              // Insert directly to preserve logical state (amount, payments, settled)
              const newId = await tx.store.add(debtData)
              oldDebtIdToNewIdMap.set(oldId, newId)
              debtsToUpdate.push({ newId, oldData: debt })
            }
            await tx.done
          }

          // 6. 匯入紀錄
          const oldRecordIdToNewIdMap = new Map()

          let recordsSource = []
          if (data.version && data.version.startsWith('2.')) {
            recordsSource = data.records || []
          } else {
            recordsSource = this.convertOldDataFormat(data)
          }

          const validRecords = recordsSource.filter(
            record =>
              record.date &&
              record.type &&
              record.category &&
              typeof record.amount === 'number'
          )

          const txRecords = this.db.transaction('records', 'readwrite')
          for (const record of validRecords) {
            const oldRecordId = record.id
            const { id, ...recordData } = record

            // Update accountId
            if (advancedModeEnabled && recordData.accountId !== undefined) {
              recordData.accountId = oldAccountIdToNewIdMap.get(
                recordData.accountId
              )
            }

            // Update debtId
            if (recordData.debtId) {
              recordData.debtId = oldDebtIdToNewIdMap.get(recordData.debtId)
            }

            // Add timestamp if missing or use existing, ensure new ID generation
            if (!recordData.timestamp) recordData.timestamp = Date.now()

            const newRecordId = await txRecords.store.add(recordData)
            if (oldRecordId) {
              oldRecordIdToNewIdMap.set(oldRecordId, newRecordId)
            }
          }
          await txRecords.done

          // 7. Update Debts (Phase 2: Link Records)
          // Now that we have newRecordIds, we can update debt references
          if (debtsToUpdate.length > 0) {
            const txUpdate = this.db.transaction('debts', 'readwrite')
            for (const item of debtsToUpdate) {
              const debt = await txUpdate.store.get(item.newId)
              if (debt) {
                let changed = false

                // Link creation record
                if (item.oldData.recordId) {
                  const newRecId = oldRecordIdToNewIdMap.get(
                    item.oldData.recordId
                  )
                  if (newRecId) {
                    debt.recordId = newRecId
                    changed = true
                  }
                }

                // Link payment records
                if (debt.payments && Array.isArray(debt.payments)) {
                  const newPayments = debt.payments.map(p => {
                    if (p.recordId) {
                      const newRecId = oldRecordIdToNewIdMap.get(p.recordId)
                      if (newRecId) {
                        changed = true
                        return { ...p, recordId: newRecId }
                      }
                    }
                    return p
                  })
                  if (changed) {
                    debt.payments = newPayments
                  }
                }

                if (changed) {
                  await txUpdate.store.put(debt)
                }
              }
            }
            await txUpdate.done
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

  // --- Sync Methods ---

  /**
   * 記錄變更到 sync_log（用於多裝置同步）
   * @param {string} operation - 'add', 'update', 'delete'
   * @param {string} storeName - object store 名稱
   * @param {number|string} recordId - 記錄 ID
   * @param {object|null} data - 記錄資料
   */
  async logChange(operation, storeName, recordId, data) {
    if (this.useLocalStorage || !this.db) return
    try {
      const tx = this.db.transaction('sync_log', 'readwrite')
      await tx.store.add({
        operation,
        storeName,
        recordId,
        data,
        timestamp: Date.now(),
        deviceId: this._syncDeviceId,
      })
      await tx.done
    } catch (err) {
      console.warn('[DataService] logChange error:', err)
    }
  }

  /**
   * 取得指定時間戳之後的所有變更
   * @param {number} sinceTimestamp - 起始時間戳
   * @returns {Promise<Array>}
   */
  async getChangesSince(sinceTimestamp) {
    if (this.useLocalStorage || !this.db) return []
    try {
      const tx = this.db.transaction('sync_log', 'readonly')
      const index = tx.store.index('timestamp')
      const range = IDBKeyRange.lowerBound(sinceTimestamp, true)
      return await index.getAll(range)
    } catch (err) {
      console.error('[DataService] getChangesSince error:', err)
      return []
    }
  }

  /**
   * 清除指定時間戳之前的同步日誌
   * @param {number} beforeTimestamp
   */
  async clearSyncLog(beforeTimestamp) {
    if (this.useLocalStorage || !this.db) return
    try {
      const tx = this.db.transaction('sync_log', 'readwrite')
      const index = tx.store.index('timestamp')
      const range = IDBKeyRange.upperBound(beforeTimestamp)
      let cursor = await index.openCursor(range)
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    } catch (err) {
      console.error('[DataService] clearSyncLog error:', err)
    }
  }

  /**
   * 匯出資料用於同步（回傳物件而非下載檔案）
   * @returns {Promise<object>}
   */
  async exportDataForSync() {
    const records = await this.getRecords()
    const customCategories = JSON.parse(
      localStorage.getItem('customCategories') || 'null'
    )
    const accounts = await this.getAccounts()
    const advancedAccountModeEnabled = await this.getSetting(
      'advancedAccountModeEnabled'
    )
    const debtManagementEnabled = await this.getSetting('debtManagementEnabled')
    const contacts = await this.getContacts()
    const debts = await this.getDebts()

    return {
      version: '2.2.0',
      exportDate: new Date().toISOString(),
      settings: {
        advancedAccountModeEnabled: advancedAccountModeEnabled?.value || false,
        debtManagementEnabled: debtManagementEnabled?.value || false,
      },
      accounts,
      records,
      contacts,
      debts,
      customCategories,
      metadata: {
        totalRecords: records.length,
        totalContacts: contacts.length,
        totalDebts: debts.length,
      },
    }
  }

  // --- Settings Methods ---
  async getSetting(key) {
    if (this.useLocalStorage) {
      return JSON.parse(localStorage.getItem(key) || 'null')
    }
    try {
      return await this.db.get('settings', key)
    } catch (error) {
      console.error(`Failed to get setting '${key}':`, error)
      return null
    }
  }

  async saveSetting(setting) {
    if (this.useLocalStorage) {
      localStorage.setItem(setting.key, JSON.stringify(setting))
      return
    }
    try {
      const tx = this.db.transaction('settings', 'readwrite')
      await tx.store.put(setting)
      await tx.done
    } catch (error) {
      console.error(`Failed to save setting '${setting.key}':`, error)
      throw error
    }
  }

  // --- Account Methods ---
  async addAccount(account, skipLog = false) {
    try {
      const tx = this.db.transaction('accounts', 'readwrite')
      const id = await tx.store.add(account)
      await tx.done
      if (!skipLog)
        await this.logChange('add', 'accounts', id, { ...account, id })
      return id
    } catch (error) {
      console.error('Failed to add account:', error)
      throw error
    }
  }

  async getAccount(id) {
    try {
      return await this.db.get('accounts', id)
    } catch (error) {
      console.error(`Failed to get account ${id}:`, error)
      return null
    }
  }

  async getAccounts() {
    try {
      return await this.db.getAll('accounts')
    } catch (error) {
      console.error('Failed to get accounts:', error)
      return []
    }
  }

  async updateAccount(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('accounts', 'readwrite')
      const account = await tx.store.get(id)
      if (account) {
        const updatedAccount = { ...account, ...updates }
        await tx.store.put(updatedAccount)
        await tx.done
        if (!skipLog)
          await this.logChange('update', 'accounts', id, updatedAccount)
        return updatedAccount
      }
      throw new Error('Account not found')
    } catch (error) {
      console.error(`Failed to update account ${id}:`, error)
      throw error
    }
  }

  async deleteAccount(id, skipLog = false) {
    const tx = this.db.transaction('accounts', 'readwrite')
    await tx.store.delete(id)
    await tx.done
    if (!skipLog) await this.logChange('delete', 'accounts', id, null)
    return true
  }

  // 清除所有帳戶
  async clearAllAccounts() {
    try {
      const tx = this.db.transaction('accounts', 'readwrite')
      await tx.store.clear()
      await tx.done
      return true
    } catch (error) {
      console.error('Failed to clear accounts:', error)
      throw error
    }
  }

  // 清除所有聯絡人
  async clearAllContacts() {
    try {
      const tx = this.db.transaction('contacts', 'readwrite')
      await tx.store.clear()
      await tx.done
      return true
    } catch (error) {
      console.error('Failed to clear contacts:', error)
      throw error
    }
  }

  // 清除所有欠款
  async clearAllDebts() {
    try {
      const tx = this.db.transaction('debts', 'readwrite')
      await tx.store.clear()
      await tx.done
      return true
    } catch (error) {
      console.error('Failed to clear debts:', error)
      throw error
    }
  }

  // --- File Methods (for storing avatars, etc.) ---
  async addFile(file) {
    try {
      const fileData = {
        name: file.name || 'file',
        type: file.type || 'application/octet-stream',
        data: file.data, // Blob
        createdAt: Date.now(),
      }
      const tx = this.db.transaction('files', 'readwrite')
      const id = await tx.store.add(fileData)
      await tx.done
      return id
    } catch (error) {
      console.error('Failed to add file:', error)
      throw error
    }
  }

  async getFile(id) {
    try {
      return await this.db.get('files', id)
    } catch (error) {
      console.error(`Failed to get file ${id}:`, error)
      return null
    }
  }

  async deleteFile(id) {
    try {
      const tx = this.db.transaction('files', 'readwrite')
      await tx.store.delete(id)
      await tx.done
      return true
    } catch (error) {
      console.error(`Failed to delete file ${id}:`, error)
      throw error
    }
  }

  // --- Contact Methods ---
  async addContact(contact, skipLog = false) {
    try {
      const contactData = {
        name: contact.name,
        avatarFileId: contact.avatarFileId || null,
        createdAt: Date.now(),
      }
      const tx = this.db.transaction('contacts', 'readwrite')
      const id = await tx.store.add(contactData)
      await tx.done
      if (!skipLog)
        await this.logChange('add', 'contacts', id, { ...contactData, id })
      return id
    } catch (error) {
      console.error('Failed to add contact:', error)
      throw error
    }
  }

  async getContact(id) {
    try {
      return await this.db.get('contacts', id)
    } catch (error) {
      console.error(`Failed to get contact ${id}:`, error)
      return null
    }
  }

  async getContacts() {
    try {
      return await this.db.getAll('contacts')
    } catch (error) {
      console.error('Failed to get contacts:', error)
      return []
    }
  }

  async updateContact(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('contacts', 'readwrite')
      const contact = await tx.store.get(id)
      if (contact) {
        const updatedContact = { ...contact, ...updates }
        await tx.store.put(updatedContact)
        await tx.done
        if (!skipLog)
          await this.logChange('update', 'contacts', id, updatedContact)
        return updatedContact
      }
      throw new Error('Contact not found')
    } catch (error) {
      console.error(`Failed to update contact ${id}:`, error)
      throw error
    }
  }

  async deleteContact(id, skipLog = false) {
    try {
      const tx = this.db.transaction('contacts', 'readwrite')
      await tx.store.delete(id)
      await tx.done
      if (!skipLog) await this.logChange('delete', 'contacts', id, null)
      return true
    } catch (error) {
      console.error(`Failed to delete contact ${id}:`, error)
      throw error
    }
  }

  // --- Debt Methods ---
  async addDebt(debt, skipLog = false) {
    try {
      const amount = debt.amount
      const debtData = {
        type: debt.type, // 'receivable' | 'payable'
        contactId: debt.contactId,
        originalAmount: amount, // Original debt amount
        remainingAmount: amount, // Remaining amount (for partial payments)
        recordId: debt.recordId || null, // Linked record ID
        date: debt.date,
        description: debt.description || '',
        settled: false,
        settledAt: null,
        payments: [], // Partial payment history
        createdAt: Date.now(),
      }
      const tx = this.db.transaction('debts', 'readwrite')
      const id = await tx.store.add(debtData)
      await tx.done
      if (!skipLog)
        await this.logChange('add', 'debts', id, { ...debtData, id })
      return id
    } catch (error) {
      console.error('Failed to add debt:', error)
      throw error
    }
  }

  async getDebt(id) {
    try {
      return await this.db.get('debts', id)
    } catch (error) {
      console.error(`Failed to get debt ${id}:`, error)
      return null
    }
  }

  async getDebts(filters = {}) {
    try {
      let debts = await this.db.getAll('debts')

      if (filters.contactId !== undefined) {
        debts = debts.filter(d => d.contactId === filters.contactId)
      }
      if (filters.type) {
        debts = debts.filter(d => d.type === filters.type)
      }
      if (filters.settled !== undefined) {
        debts = debts.filter(d => d.settled === filters.settled)
      }

      return debts.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      console.error('Failed to get debts:', error)
      return []
    }
  }

  async updateDebt(id, updates, skipLog = false) {
    try {
      const tx = this.db.transaction('debts', 'readwrite')
      const debt = await tx.store.get(id)
      if (debt) {
        const updatedDebt = { ...debt, ...updates }
        await tx.store.put(updatedDebt)
        await tx.done
        if (!skipLog) await this.logChange('update', 'debts', id, updatedDebt)
        return updatedDebt
      }
      throw new Error('Debt not found')
    } catch (error) {
      console.error(`Failed to update debt ${id}:`, error)
      throw error
    }
  }

  async deleteDebt(id, skipLog = false) {
    try {
      const tx = this.db.transaction('debts', 'readwrite')
      await tx.store.delete(id)
      await tx.done
      if (!skipLog) await this.logChange('delete', 'debts', id, null)
      return true
    } catch (error) {
      console.error(`Failed to delete debt ${id}:`, error)
      throw error
    }
  }

  async settleDebt(id, paymentAmount = null) {
    try {
      const debt = await this.getDebt(id)
      if (!debt) throw new Error('Debt not found')
      if (debt.settled) return debt // Already settled

      // Determine payment amount (full or partial)
      const amount = paymentAmount || debt.remainingAmount
      const newRemainingAmount = debt.remainingAmount - amount
      const isFullySettled = newRemainingAmount <= 0

      // Create payment record in history
      const paymentRecord = {
        amount,
        date: new Date().toISOString().split('T')[0],
        recordId: null,
      }

      // Only create a transaction record if this debt was NOT linked to an existing expense
      // If it was linked (recordId exists), the expense was already recorded
      // Creating another record would cause double-counting
      let newRecordId = null
      if (!debt.recordId) {
        const contact = await this.getContact(debt.contactId)
        const contactName = contact?.name || '未知聯絡人'

        const record = {
          type: debt.type === 'receivable' ? 'income' : 'expense',
          category:
            debt.type === 'receivable' ? 'debt_collection' : 'debt_repayment',
          amount: amount,
          date: new Date().toISOString().split('T')[0],
          description:
            debt.type === 'receivable'
              ? `收回欠款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`
              : `還款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`,
          debtId: id,
        }

        newRecordId = await this.addRecord(record)
      }
      paymentRecord.recordId = newRecordId

      // Update debt with new payment
      const updatedPayments = [...(debt.payments || []), paymentRecord]
      const updates = {
        remainingAmount: Math.max(0, newRemainingAmount),
        payments: updatedPayments,
      }

      if (isFullySettled) {
        updates.settled = true
        updates.settledAt = Date.now()
      }

      const updatedDebt = await this.updateDebt(id, updates)
      return updatedDebt
    } catch (error) {
      console.error(`Failed to settle debt ${id}:`, error)
      throw error
    }
  }

  // Add partial payment to a debt
  async addPartialPayment(debtId, amount) {
    return this.settleDebt(debtId, amount)
  }

  // Get debt summary by contact
  async getDebtSummary() {
    try {
      const debts = await this.getDebts({ settled: false })
      const contacts = await this.getContacts()

      let totalReceivable = 0
      let totalPayable = 0
      const byContact = {}

      for (const debt of debts) {
        // Use remainingAmount for calculations, fallback to originalAmount for backward compatibility
        const amount =
          debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0

        if (debt.type === 'receivable') {
          totalReceivable += amount
        } else {
          totalPayable += amount
        }

        if (!byContact[debt.contactId]) {
          const contact = contacts.find(c => c.id === debt.contactId)
          byContact[debt.contactId] = {
            contact: contact || { id: debt.contactId, name: '未知聯絡人' },
            receivable: 0,
            payable: 0,
            debts: [],
          }
        }

        if (debt.type === 'receivable') {
          byContact[debt.contactId].receivable += amount
        } else {
          byContact[debt.contactId].payable += amount
        }
        byContact[debt.contactId].debts.push(debt)
      }

      return {
        totalReceivable,
        totalPayable,
        byContact: Object.values(byContact),
      }
    } catch (error) {
      console.error('Failed to get debt summary:', error)
      return { totalReceivable: 0, totalPayable: 0, byContact: [] }
    }
  }
}

export default DataService

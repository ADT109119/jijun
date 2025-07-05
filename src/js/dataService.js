// 資料服務模組 - 使用 IndexedDB 進行資料儲存
// 如果 idb 不可用，使用全域的 idb
const openDB = window.idb?.openDB || (() => {
  console.warn('IndexedDB 不可用，將使用 localStorage')
  return null
})

class DataService {
  constructor() {
    this.dbName = 'EasyAccountingDB'
    this.dbVersion = 1
    this.db = null
    this.init()
  }

  async init() {
    try {
      if (openDB && typeof openDB === 'function') {
        this.db = await openDB(this.dbName, this.dbVersion, {
          upgrade(db) {
            // 創建記帳記錄表
            if (!db.objectStoreNames.contains('records')) {
              const recordStore = db.createObjectStore('records', {
                keyPath: 'id',
                autoIncrement: true
              })
              recordStore.createIndex('date', 'date')
              recordStore.createIndex('type', 'type')
              recordStore.createIndex('category', 'category')
            }

            // 創建設定表
            if (!db.objectStoreNames.contains('settings')) {
              db.createObjectStore('settings', { keyPath: 'key' })
            }
          }
        })
        
        // 如果是首次使用，嘗試從 localStorage 遷移資料
        await this.migrateFromLocalStorage()
      } else {
        throw new Error('IndexedDB 不可用')
      }
    } catch (error) {
      console.error('資料庫初始化失敗:', error)
      // 如果 IndexedDB 不可用，回退到 localStorage
      this.useLocalStorage = true
      console.log('使用 localStorage 作為備用儲存')
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
          const recordDate = new Date(record.date)
          if (filters.startDate && recordDate < new Date(filters.startDate)) return false
          if (filters.endDate && recordDate > new Date(filters.endDate)) return false
          return true
        })
      }

      if (filters.type) {
        records = records.filter(record => record.type === filters.type)
      }

      if (filters.category) {
        records = records.filter(record => record.category === filters.category)
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
    const records = JSON.parse(localStorage.getItem('records') || '[]')
    // 應用篩選器邏輯...
    return records
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
  async getStatistics(startDate, endDate) {
    const records = await this.getRecords({ startDate, endDate })
    
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
}

export default DataService
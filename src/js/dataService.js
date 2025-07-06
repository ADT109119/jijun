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

  // 匯出所有資料
  async exportData() {
    try {
      const records = await this.getRecords()
      const exportData = {
        version: '2.0.0',
        exportDate: new Date().toISOString(),
        records: records,
        metadata: {
          totalRecords: records.length,
          dateRange: {
            start: records.length > 0 ? Math.min(...records.map(r => new Date(r.date).getTime())) : null,
            end: records.length > 0 ? Math.max(...records.map(r => new Date(r.date).getTime())) : null
          }
        }
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
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
          let records = []

          // 檢查資料格式版本
          if (data.version && data.version === '2.0.0') {
            // 新版格式
            records = data.records || []
          } else if (data.records && Array.isArray(data.records)) {
            // 可能是舊版但已轉換的格式
            records = data.records
          } else {
            // 舊版格式，需要轉換
            records = this.convertOldDataFormat(data)
          }

          // 驗證資料格式
          const validRecords = records.filter(record => {
            return record.date && 
                   record.type && 
                   (record.type === 'income' || record.type === 'expense') &&
                   record.category && 
                   typeof record.amount === 'number' &&
                   record.amount >= 0
          })

          if (validRecords.length !== records.length) {
            console.warn(`過濾了 ${records.length - validRecords.length} 筆無效記錄`)
          }

          // 確認是否要覆蓋現有資料
          const existingRecords = await this.getRecords()
          if (existingRecords.length > 0) {
            const confirmed = confirm(`目前已有 ${existingRecords.length} 筆記錄。\n匯入 ${validRecords.length} 筆新記錄將會覆蓋現有資料。\n\n確定要繼續嗎？`)
            if (!confirmed) {
              resolve({ success: false, message: '使用者取消操作' })
              return
            }
          }

          // 清除現有資料
          await this.clearAllRecords()

          // 匯入新資料
          let importedCount = 0
          for (const record of validRecords) {
            try {
              await this.addRecord(record)
              importedCount++
            } catch (error) {
              console.error('匯入記錄失敗:', record, error)
            }
          }

          resolve({ 
            success: true, 
            message: `成功匯入 ${importedCount} 筆記錄`,
            importedCount,
            totalRecords: validRecords.length
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
}

export default DataService
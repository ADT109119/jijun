// 記錄列表模組
import { formatCurrency, formatDate, showToast, getDateRange } from './utils.js'
import { getCategoryName, getCategoryIcon } from './categories.js'

export class RecordsListManager {
  constructor(dataService) {
    this.dataService = dataService
    this.currentFilter = 'all'
    this.currentPeriod = 'month'
    this.customStartDate = null
    this.customEndDate = null
    this.selectedCategories = new Set() // 改為支援多選
    this.records = []
  }

  /**
   * 渲染記錄列表頁面
   */
  async renderRecordsListPage() {
    const container = document.getElementById('app')
    
    container.innerHTML = `
      <div class="container mx-auto px-4 py-6 max-w-md">

        <!-- 篩選器 -->
        <div class="mb-6 space-y-4">
          <!-- 時間範圍 -->
          <div class="flex space-x-2 bg-white rounded-lg p-1 shadow-md">
            <button class="period-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="week">本週</button>
            <button class="period-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200 bg-primary text-white" data-period="month">本月</button>
            <button class="period-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="year">今年</button>
            <button class="period-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="custom">自訂</button>
          </div>

          <!-- 自訂時間範圍 Modal -->
          <div id="recordsDateRangeModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 hidden">
            <div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4">
              <h3 class="text-xl font-semibold mb-4">選擇自訂時間範圍</h3>
              
              <!-- 快速設定按鍵 -->
              <div class="mb-6">
                <h4 class="text-sm font-medium text-gray-700 mb-3">快速設定</h4>
                <div class="grid grid-cols-3 gap-2">
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="today">今日</button>
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="week">本週</button>
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="last7days">近七日</button>
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="month">本月</button>
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="lastmonth">上月</button>
                  <button class="records-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="year">今年</button>
                </div>
              </div>
              
              <div class="mb-4">
                <label for="recordsStartDate" class="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
                <input type="date" id="recordsStartDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
              </div>
              <div class="mb-4">
                <label for="recordsEndDate" class="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
                <input type="date" id="recordsEndDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
              </div>
              <div class="flex justify-end space-x-3">
                <button id="cancelRecordsDateRange" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">取消</button>
                <button id="applyRecordsDateRange" class="px-4 py-2 bg-primary text-white rounded-md hover:bg-blue-600">確定</button>
              </div>
            </div>
          </div>

          <!-- 類型篩選 -->
          <div class="flex space-x-2 bg-white rounded-lg p-1 shadow-md">
            <button class="type-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200 bg-gray-200 text-gray-800" data-type="all">全部</button>
            <button class="type-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-type="income">收入</button>
            <button class="type-filter flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-type="expense">支出</button>
          </div>

        </div>

        <!-- 搜尋框和類別篩選 -->
        <div class="mb-6">
          <div class="flex space-x-2">
            <div class="relative flex-1">
              <input type="text" id="search-input" placeholder="搜尋記錄..." 
                     class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
              <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            </div>
            <button id="category-filter-btn" class="px-4 py-3 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg transition-colors flex items-center space-x-2">
              <i class="fas fa-filter text-gray-600"></i>
              <span class="text-gray-700">類別</span>
              <span id="category-filter-count" class="hidden bg-primary text-white text-xs px-2 py-1 rounded-full"></span>
            </button>
          </div>
        </div>

        <!-- 統計摘要 -->
        <div class="grid grid-cols-3 gap-3 mb-6">
          <div class="bg-white p-3 rounded-lg shadow-md text-center">
            <div class="text-sm text-gray-600">筆數</div>
            <div id="record-count" class="text-lg font-bold text-gray-800">0</div>
          </div>
          <div class="bg-green-50 p-3 rounded-lg shadow-md text-center">
            <div class="text-sm text-green-600">收入</div>
            <div id="total-income" class="text-lg font-bold text-green-600">$0</div>
          </div>
          <div class="bg-red-50 p-3 rounded-lg shadow-md text-center">
            <div class="text-sm text-red-600">支出</div>
            <div id="total-expense" class="text-lg font-bold text-red-600">$0</div>
          </div>
        </div>

        <!-- 記錄列表 -->
        <div id="records-container" class="space-y-3 mb-20">
        </div>

        <!-- 類別篩選 Modal -->
        <div id="categoryFilterModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 hidden">
          <div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-xl font-semibold text-gray-800">選擇類別篩選</h3>
              <button id="closeCategoryModal" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div class="mb-4">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm text-gray-600">已選擇 <span id="selected-count">0</span> 個類別</span>
                <button id="clearAllCategories" class="text-sm text-primary hover:text-blue-600">清除全部</button>
              </div>
            </div>
            
            <div id="category-list" class="space-y-2 mb-6">
              <!-- 類別選項將由 JavaScript 動態生成 -->
            </div>
            
            <div class="flex justify-end space-x-3">
              <button id="cancelCategoryFilter" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">取消</button>
              <button id="applyCategoryFilter" class="px-4 py-2 bg-primary text-white rounded-md hover:bg-blue-600">確定</button>
            </div>
          </div>
        </div>
          <!-- 記錄項目將在這裡顯示 -->
        </div>

        <!-- 載入更多按鈕 -->
        <div class="text-center mb-6">
          <button id="load-more-btn" class="hidden bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg transition-colors">
            載入更多
          </button>
        </div>

        <!-- 空狀態 -->
        <div id="empty-state" class="hidden text-center py-12">
          <div class="text-6xl mb-4">📝</div>
          <h3 class="text-lg font-semibold text-gray-700 mb-2">暫無記錄</h3>
          <p class="text-gray-500 mb-6">開始記帳來追蹤您的收支吧！</p>
          <button id="start-recording-btn" class="bg-primary hover:bg-blue-600 text-white px-6 py-3 rounded-lg transition-colors">
            開始記帳
          </button>
        </div>

        <!-- 底部導航 -->
        <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2">
          <div class="flex justify-around max-w-md mx-auto">
            <button id="nav-list" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-home"></i></span>
              <span class="text-xs">首頁</span>
            </button>
            <button id="nav-add" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-plus"></i></span>
              <span class="text-xs">記帳</span>
            </button>
            <button id="nav-records" class="flex flex-col items-center py-2 text-primary">
              <span class="text-2xl"><i class="fas fa-list"></i></span>
              <span class="text-xs">明細</span>
            </button>
          </div>
        </nav>
      </div>

      <!-- 編輯記錄彈窗 -->
      <div id="edit-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
          <h3 class="text-lg font-semibold mb-4">編輯記錄</h3>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">類型</label>
              <div class="flex space-x-2">
                <button id="edit-type-expense" class="flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 bg-red-500 text-white">
                  支出
                </button>
                <button id="edit-type-income" class="flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100">
                  收入
                </button>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">分類</label>
              <div id="edit-category-container" class="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                <!-- 分類按鈕將動態生成 -->
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">金額</label>
              <input type="number" id="edit-amount" step="0.01" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">說明</label>
              <input type="text" id="edit-description" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">日期</label>
              <input type="date" id="edit-date" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>
          </div>
          
          <div class="flex space-x-3 mt-6">
            <button id="save-edit-btn" class="flex-1 bg-primary hover:bg-blue-600 text-white py-3 rounded-lg transition-colors">
              儲存
            </button>
            <button id="delete-record-btn" class="px-6 bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg transition-colors">
              刪除
            </button>
            <button id="cancel-edit-btn" class="px-6 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg transition-colors">
              取消
            </button>
          </div>
        </div>
      </div>
    `

    this.setupRecordsListEventListeners()
    await this.loadRecords()
  }

  setupRecordsListEventListeners() {
    // 時間範圍篩選
    document.querySelectorAll('.period-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.target.dataset.period
        if (period === 'custom') {
          this.showRecordsDateRangeModal()
        } else {
          this.switchPeriodFilter(period)
          this.currentPeriod = period
          this.loadRecords()
        }
      })
    })

    // 自訂時間範圍 Modal 事件
    const dateRangeModal = document.getElementById('recordsDateRangeModal')
    const startDateInput = document.getElementById('recordsStartDate')
    const endDateInput = document.getElementById('recordsEndDate')
    const applyDateRangeBtn = document.getElementById('applyRecordsDateRange')
    const cancelDateRangeBtn = document.getElementById('cancelRecordsDateRange')

    if (applyDateRangeBtn) {
      applyDateRangeBtn.addEventListener('click', () => {
        const startDate = startDateInput.value
        const endDate = endDateInput.value
        if (startDate && endDate) {
          this.currentPeriod = 'custom'
          this.loadRecords('custom', startDate, endDate)
          this.switchPeriodFilter('custom')
          dateRangeModal.classList.add('hidden')
        } else {
          showToast('請選擇開始和結束日期', 'error')
        }
      })
    }

    if (cancelDateRangeBtn) {
      cancelDateRangeBtn.addEventListener('click', () => {
        dateRangeModal.classList.add('hidden')
      })
    }

    // 明細頁面快速日期設定按鍵
    document.querySelectorAll('.records-quick-date-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const range = e.target.dataset.range
        const dateRange = getDateRange(range)
        
        const recordsStartDateInput = document.getElementById('recordsStartDate')
        const recordsEndDateInput = document.getElementById('recordsEndDate')
        
        if (recordsStartDateInput && recordsEndDateInput) {
          recordsStartDateInput.value = dateRange.startDate
          recordsEndDateInput.value = dateRange.endDate
        }
        
        // 高亮選中的快速設定按鈕
        document.querySelectorAll('.records-quick-date-btn').forEach(b => {
          b.classList.remove('bg-primary', 'text-white')
          b.classList.add('bg-gray-100', 'hover:bg-gray-200')
        })
        e.target.classList.remove('bg-gray-100', 'hover:bg-gray-200')
        e.target.classList.add('bg-primary', 'text-white')
      })
    })

    // 類別篩選按鈕
    const categoryFilterBtn = document.getElementById('category-filter-btn')
    if (categoryFilterBtn) {
      categoryFilterBtn.addEventListener('click', () => {
        this.showCategoryFilterModal()
      })
    }

    // 類別篩選 Modal 事件
    const closeCategoryModalBtn = document.getElementById('closeCategoryModal')
    const cancelCategoryFilterBtn = document.getElementById('cancelCategoryFilter')
    const applyCategoryFilterBtn = document.getElementById('applyCategoryFilter')
    const clearAllCategoriesBtn = document.getElementById('clearAllCategories')

    if (closeCategoryModalBtn) {
      closeCategoryModalBtn.addEventListener('click', () => {
        this.hideCategoryFilterModal()
      })
    }

    if (cancelCategoryFilterBtn) {
      cancelCategoryFilterBtn.addEventListener('click', () => {
        this.hideCategoryFilterModal()
      })
    }

    if (applyCategoryFilterBtn) {
      applyCategoryFilterBtn.addEventListener('click', () => {
        this.applyCategoryFilter()
      })
    }

    if (clearAllCategoriesBtn) {
      clearAllCategoriesBtn.addEventListener('click', () => {
        this.clearAllCategories()
      })
    }

    // 類型篩選
    document.querySelectorAll('.type-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type
        this.switchTypeFilter(type)
        this.currentFilter = type
        this.loadRecords()
      })
    })

    // 搜尋
    const searchInput = document.getElementById('search-input')
    let searchTimeout
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => {
        this.searchRecords(e.target.value)
      }, 300)
    })

    // 開始記帳按鈕
    document.getElementById('start-recording-btn')?.addEventListener('click', () => {
      // 切換到記帳頁面
      window.app.showAddPage()
    })

    // 底部導航
    const navList = document.getElementById('nav-list')
    const navAdd = document.getElementById('nav-add')
    const navRecords = document.getElementById('nav-records')
    
    if (navList) {
      navList.addEventListener('click', () => {
        if (window.app) window.app.showListPage()
      })
    }
    
    if (navAdd) {
      navAdd.addEventListener('click', () => {
        if (window.app) window.app.showAddPage()
      })
    }
    
    if (navRecords) {
      navRecords.addEventListener('click', () => {
        if (window.app) window.app.showRecordsPage()
      })
    }

    // 編輯彈窗事件
    this.setupEditModalEvents()
  }

  setupEditModalEvents() {
    const modal = document.getElementById('edit-modal')
    const saveBtn = document.getElementById('save-edit-btn')
    const deleteBtn = document.getElementById('delete-record-btn')
    const cancelBtn = document.getElementById('cancel-edit-btn')
    const expenseBtn = document.getElementById('edit-type-expense')
    const incomeBtn = document.getElementById('edit-type-income')

    saveBtn.addEventListener('click', () => this.saveEditedRecord())
    deleteBtn.addEventListener('click', () => this.deleteRecord())
    cancelBtn.addEventListener('click', () => this.closeEditModal())

    // 類型切換
    expenseBtn.addEventListener('click', () => this.switchEditType('expense', true))
    incomeBtn.addEventListener('click', () => this.switchEditType('income', true))

    // 點擊背景關閉彈窗
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeEditModal()
      }
    })
  }

  showRecordsDateRangeModal() {
    const modal = document.getElementById('recordsDateRangeModal')
    const startDateInput = document.getElementById('recordsStartDate')
    const endDateInput = document.getElementById('recordsEndDate')

    // Set default dates (e.g., last month)
    const today = new Date()
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    startDateInput.value = firstDayOfMonth.toISOString().split('T')[0]
    endDateInput.value = lastDayOfMonth.toISOString().split('T')[0]

    modal.classList.remove('hidden')
  }

  switchPeriodFilter(period) {
    document.querySelectorAll('.period-filter').forEach(btn => {
      btn.classList.remove('bg-primary', 'text-white')
      btn.classList.add('text-gray-600', 'hover:bg-gray-100')
    })
    
    const selectedBtn = document.querySelector(`[data-period="${period}"]`)
    if (selectedBtn) {
      selectedBtn.classList.add('bg-primary', 'text-white')
      selectedBtn.classList.remove('text-gray-600', 'hover:bg-gray-100')
    }
  }

  switchTypeFilter(type) {
    document.querySelectorAll('.type-filter').forEach(btn => {
      btn.classList.remove('bg-gray-200', 'text-gray-800', 'bg-green-500', 'text-white', 'bg-red-500')
      btn.classList.add('text-gray-600', 'hover:bg-gray-100')
    })
    
    const targetBtn = document.querySelector(`[data-type="${type}"]`)
    if (type === 'all') {
      targetBtn.classList.add('bg-gray-200', 'text-gray-800')
    } else if (type === 'income') {
      targetBtn.classList.add('bg-green-500', 'text-white')
    } else {
      targetBtn.classList.add('bg-red-500', 'text-white')
    }
    targetBtn.classList.remove('text-gray-600', 'hover:bg-gray-100')
  }

  async loadRecords(period = this.currentPeriod, startDate = null, endDate = null) {
    try {
      let dateRange
      if (period === 'custom') {
        if (startDate && endDate) {
          this.customStartDate = startDate
          this.customEndDate = endDate
        }
        dateRange = { startDate: this.customStartDate, endDate: this.customEndDate }
      } else {
        dateRange = getDateRange(period)
      }

      const filters = {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      }

      if (this.currentFilter !== 'all') {
        filters.type = this.currentFilter
      }

      this.records = await this.dataService.getRecords(filters)
      this.renderRecords(this.records)
      this.updateSummary(this.records)
    } catch (error) {
      console.error('載入記錄失敗:', error)
      showToast('載入記錄失敗', 'error')
    }
  }

  async renderRecords(records) {
    const container = document.getElementById('records-container')
    const emptyState = document.getElementById('empty-state')

    if (records.length === 0) {
      container.innerHTML = ''
      emptyState.classList.remove('hidden')
      return
    }

    emptyState.classList.add('hidden')
    container.innerHTML = ''

    // 按日期分組
    const groupedRecords = this.groupRecordsByDate(records)

    for (const date of Object.keys(groupedRecords).sort((a, b) => new Date(b) - new Date(a))) {
      const dateGroup = document.createElement('div')
      dateGroup.className = 'mb-4'

      // 日期標題
      const dateHeader = document.createElement('div')
      dateHeader.className = 'flex items-center justify-between mb-2 px-2'
      
      const dayTotal = groupedRecords[date].reduce((sum, record) => {
        return sum + (record.type === 'income' ? record.amount : -record.amount)
      }, 0)

      dateHeader.innerHTML = `
        <h3 class="font-semibold text-gray-700">${formatDate(date, 'long')}</h3>
        <span class="text-sm font-medium ${dayTotal >= 0 ? 'text-green-600' : 'text-red-600'}">
          ${dayTotal >= 0 ? '+' : ''}${formatCurrency(dayTotal)}
        </span>
      `

      dateGroup.appendChild(dateHeader)

      // 該日期的記錄
      for (const [index, record] of groupedRecords[date].entries()) {
        const recordItem = await this.createRecordItem(record)
        if (index > 0) {
          recordItem.classList.add('mt-2') // 添加上邊距
        }
        dateGroup.appendChild(recordItem)
      }

      container.appendChild(dateGroup)
    }
  }

  async createRecordItem(record) {
    const item = document.createElement('div')
    item.className = 'bg-white p-4 rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-shadow'
    item.dataset.recordId = record.id

    const categoriesModule = await import('./categories.js')
    const categoryConfig = categoriesModule.getCategoryById(record.type, record.category)
    
    const categoryName = categoryConfig ? categoryConfig.name : '未知分類'
    const categoryIcon = categoryConfig ? categoryConfig.icon : 'fas fa-question'
    const categoryColor = categoryConfig ? categoryConfig.color : 'bg-gray-500' // 預設顏色
    const isIncome = record.type === 'income'

    item.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full flex items-center justify-center ${categoryColor} text-white text-xl">
            <i class="${categoryIcon}"></i>
          </div>
          <div>
            <div class="font-medium text-gray-800">${categoryName}</div>
            <div class="text-sm text-gray-500">${record.description || '無說明'}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold ${isIncome ? 'text-green-600' : 'text-red-600'}">
            ${isIncome ? '+' : '-'}${formatCurrency(record.amount)}
          </div>
          <div class="text-xs text-gray-400">${formatDate(record.date, 'short')}</div>
        </div>
      </div>
    `

    item.addEventListener('click', () => {
      this.openEditModal(record)
    })

    return item
  }

  groupRecordsByDate(records) {
    return records.reduce((groups, record) => {
      const date = record.date
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(record)
      return groups
    }, {})
  }

  updateSummary(records) {
    const totalIncome = records
      .filter(r => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0)

    const totalExpense = records
      .filter(r => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0)

    document.getElementById('record-count').textContent = records.length
    document.getElementById('total-income').textContent = formatCurrency(totalIncome)
    document.getElementById('total-expense').textContent = formatCurrency(totalExpense)
  }

  searchRecords(query) {
    console.log('搜尋記錄，選中的類別:', this.selectedCategories) // 調試用
    
    let filteredRecords = this.records
    
    // 應用類別篩選
    if (this.selectedCategories && this.selectedCategories.size > 0) {
      console.log('應用類別篩選，篩選前記錄數:', filteredRecords.length)
      filteredRecords = filteredRecords.filter(record => {
        const hasCategory = this.selectedCategories.has(record.category)
        console.log(`記錄 ${record.description} 類別 ${record.category}:`, hasCategory)
        return hasCategory
      })
      console.log('篩選後記錄數:', filteredRecords.length)
    }

    // 應用搜尋篩選
    if (query.trim()) {
      filteredRecords = filteredRecords.filter(record => {
        const categoryName = getCategoryName(record.type, record.category)
        return (
          categoryName.toLowerCase().includes(query.toLowerCase()) ||
          (record.description && record.description.toLowerCase().includes(query.toLowerCase()))
        )
      })
    }

    this.renderRecords(filteredRecords)
    this.updateSummary(filteredRecords)
  }

  openEditModal(record) {
    this.currentEditingRecord = record
    this.editType = record.type
    this.editSelectedCategory = record.category
    
    document.getElementById('edit-amount').value = record.amount
    document.getElementById('edit-description').value = record.description || ''
    document.getElementById('edit-date').value = record.date
    
    // 設置類型按鈕狀態（不重置分類選擇）
    this.switchEditType(record.type, false)
    
    // 渲染分類選項
    this.renderEditCategories()
    
    document.getElementById('edit-modal').classList.remove('hidden')
  }

  closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden')
    this.currentEditingRecord = null
    this.editType = null
    this.editSelectedCategory = null
  }

  switchEditType(type, resetCategory = true) {
    this.editType = type
    
    // 只有在用戶主動切換類型時才重置分類選擇
    if (resetCategory) {
      this.editSelectedCategory = null
    }
    
    const expenseBtn = document.getElementById('edit-type-expense')
    const incomeBtn = document.getElementById('edit-type-income')
    
    if (type === 'expense') {
      expenseBtn.className = 'flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 bg-red-500 text-white'
      incomeBtn.className = 'flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100'
    } else {
      expenseBtn.className = 'flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100'
      incomeBtn.className = 'flex-1 py-2 px-4 rounded-md font-medium transition-all duration-200 bg-green-500 text-white'
    }
    
    this.renderEditCategories()
  }

  renderEditCategories() {
    const container = document.getElementById('edit-category-container')
    if (!container) return
    
    container.innerHTML = ''
    
    // 獲取分類管理器
    const categoryManager = window.app?.categoryManager
    if (!categoryManager) return
    
    // 獲取所有分類（包含自定義分類）
    const allCategories = categoryManager.getAllCategories(this.editType)
    
    allCategories.forEach(category => {
      const button = document.createElement('button')
      button.className = 'category-btn p-2 border border-gray-300 rounded-lg text-sm transition-all duration-200 hover:border-primary'
      button.dataset.categoryId = category.id
      
      // 添加分類顏色作為背景色
      if (category.color) {
        button.classList.add(category.color)
        button.classList.add('text-white')
      }
      
      button.innerHTML = `
        <div class="flex flex-col items-center space-y-1">
          <span class="text-lg"><i class="${category.icon}"></i></span>
          <span class="text-xs">${category.name}</span>
        </div>
      `
      
      // 如果是當前選中的分類，添加選中樣式
      if (category.id === this.editSelectedCategory) {
        button.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
      }
      
      button.addEventListener('click', () => {
        this.selectEditCategory(category.id)
      })
      
      container.appendChild(button)
    })
  }

  selectEditCategory(categoryId) {
    this.editSelectedCategory = categoryId
    
    // 更新按鈕樣式
    document.querySelectorAll('#edit-category-container .category-btn').forEach(btn => {
      btn.classList.remove('ring-2', 'ring-primary', 'ring-offset-2')
    })
    
    const selectedBtn = document.querySelector(`#edit-category-container [data-category-id="${categoryId}"]`)
    if (selectedBtn) {
      selectedBtn.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
    }
  }

  async saveEditedRecord() {
    if (!this.currentEditingRecord) return

    const amount = parseFloat(document.getElementById('edit-amount').value)
    const description = document.getElementById('edit-description').value
    const date = document.getElementById('edit-date').value

    if (amount <= 0) {
      showToast('請輸入有效金額', 'error')
      return
    }

    if (!this.editSelectedCategory) {
      showToast('請選擇分類', 'error')
      return
    }

    if (!date) {
      showToast('請選擇日期', 'error')
      return
    }

    try {
      await this.dataService.updateRecord(this.currentEditingRecord.id, {
        type: this.editType,
        category: this.editSelectedCategory,
        amount,
        description,
        date
      })

      showToast('記錄更新成功', 'success')
      this.closeEditModal()
      await this.loadRecords()
    } catch (error) {
      console.error('更新記錄失敗:', error)
      showToast('更新記錄失敗', 'error')
    }
  }

  async deleteRecord() {
    if (!this.currentEditingRecord) return

    if (!confirm('確定要刪除這筆記錄嗎？')) return

    try {
      await this.dataService.deleteRecord(this.currentEditingRecord.id)
      showToast('記錄已刪除', 'success')
      this.closeEditModal()
      await this.loadRecords()
    } catch (error) {
      console.error('刪除記錄失敗:', error)
      showToast('刪除記錄失敗', 'error')
    }
  }

  // 顯示類別篩選 Modal
  async showCategoryFilterModal() {
    const modal = document.getElementById('categoryFilterModal')
    if (!modal) return
    
    await this.loadCategoryOptions()
    modal.classList.remove('hidden')
  }

  // 隱藏類別篩選 Modal
  hideCategoryFilterModal() {
    const modal = document.getElementById('categoryFilterModal')
    if (modal) {
      modal.classList.add('hidden')
    }
  }

  // 載入類別選項
  async loadCategoryOptions() {
    // 獲取當前時間範圍的記錄
    let dateRange
    if (this.currentPeriod === 'custom') {
      dateRange = { startDate: this.customStartDate, endDate: this.customEndDate }
    } else {
      dateRange = getDateRange(this.currentPeriod)
    }

    const recordsInPeriod = await this.dataService.getRecords({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    })
    
    // 根據當前類型篩選獲取相關記錄
    let relevantRecords = recordsInPeriod
    if (this.currentFilter !== 'all') {
      relevantRecords = recordsInPeriod.filter(record => record.type === this.currentFilter)
    }
    
    // 獲取所有唯一的類別
    const categories = [...new Set(relevantRecords.map(record => record.category).filter(Boolean))]
    
    // 從分類配置中獲取中文名稱和類型
    const categoriesModule = await import('./categories.js')
    
    // 計算每個類別的統計資訊
    const categoryStats = categories.map(categoryKey => {
      // 找到對應的分類配置
      let categoryConfig = categoriesModule.getCategoryById('expense', categoryKey)
      let type = 'expense'
      if (!categoryConfig) {
        categoryConfig = categoriesModule.getCategoryById('income', categoryKey)
        type = 'income'
      }
      
      const displayName = categoryConfig ? categoryConfig.name : categoryKey
      const categoryColor = categoryConfig ? categoryConfig.color : 'bg-gray-500' // 預設顏色
      
      const categoryRecords = relevantRecords.filter(record => record.category === categoryKey)
      const totalAmount = categoryRecords.reduce((sum, record) => sum + parseFloat(record.amount), 0)
      const count = categoryRecords.length
      
      return {
        id: categoryKey,
        name: displayName,
        totalAmount,
        count,
        type, // 添加類型
        color: categoryColor // 添加顏色
      }
    }).sort((a, b) => b.totalAmount - a.totalAmount) // 按金額排序
    
    this.renderCategoryOptions(categoryStats)
  }

  // 渲染類別選項
  renderCategoryOptions(categoryStats) {
    const container = document.getElementById('category-list')
    if (!container) return
    
    if (categoryStats.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">暫無類別資料</p>'
      return
    }
    
    container.innerHTML = categoryStats.map(stat => {
      const isSelected = this.selectedCategories.has(stat.id)
      const amountColorClass = stat.type === 'income' ? 'text-green-600' : 'text-red-600'
      
      return `
        <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <div class="flex items-center space-x-3">
            <input type="checkbox" id="category-${stat.id}" class="category-checkbox" 
                   data-category="${stat.id}" ${isSelected ? 'checked' : ''}>
            <label for="category-${stat.id}" class="flex-1 cursor-pointer">
              <div class="font-medium text-gray-800">${stat.name}</div>
              <div class="text-sm ${amountColorClass}">${stat.type === 'income' ? '+' : '-'}${formatCurrency(stat.totalAmount)} • ${stat.count}筆記錄</div>
            </label>
          </div>
        </div>
      `
    }).join('')
    
    // 添加事件監聽器
    container.querySelectorAll('.category-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const category = e.target.dataset.category
        if (e.target.checked) {
          this.selectedCategories.add(category)
        } else {
          this.selectedCategories.delete(category)
        }
        this.updateSelectedCount()
      })
    })
    
    this.updateSelectedCount()
  }

  // 更新選中數量顯示
  updateSelectedCount() {
    const countElement = document.getElementById('selected-count')
    const filterCountBadge = document.getElementById('category-filter-count')
    
    if (countElement) {
      countElement.textContent = this.selectedCategories.size
    }
    
    if (filterCountBadge) {
      if (this.selectedCategories.size > 0) {
        filterCountBadge.textContent = this.selectedCategories.size
        filterCountBadge.classList.remove('hidden')
      } else {
        filterCountBadge.classList.add('hidden')
      }
    }
  }

  // 清除所有類別選擇
  clearAllCategories() {
    this.selectedCategories.clear()
    
    // 更新 checkbox 狀態
    document.querySelectorAll('.category-checkbox').forEach(checkbox => {
      checkbox.checked = false
    })
    
    this.updateSelectedCount()
  }

  // 應用類別篩選
  applyCategoryFilter() {
    console.log('應用類別篩選，選中的類別:', this.selectedCategories)
    this.hideCategoryFilterModal()
    
    // 重新應用篩選
    const searchInput = document.getElementById('search-input')
    const currentQuery = searchInput ? searchInput.value : ''
    this.searchRecords(currentQuery)
  }
}

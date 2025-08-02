// 主應用程式入口
import DataService from './dataService.js'
import { CATEGORIES, getCategoryName, getCategoryIcon } from './categories.js'
import { formatCurrency, formatDate, showToast, getDateRange, formatDateToString } from './utils.js'
import { StatisticsManager } from './statistics.js'
import { RecordsListManager } from './recordsList.js'
import { BudgetManager } from './budgetManager.js'
import { CategoryManager } from './categoryManager.js'
import { ChangelogManager } from './changelog.js'

class EasyAccountingApp {
  constructor() {
    this.dataService = new DataService()
    this.statisticsManager = null
    this.recordsListManager = null
    this.currentPage = 'add'
    this.currentType = 'expense' // 'expense' or 'income'
    this.selectedCategory = null
    this.currentAmount = '0'
    this.homeChart = null // 首頁圖表實例
    
    this.init()
  }

  async init() {
    // 等待資料服務初始化完成
    await this.dataService.init()
    
    // 初始化管理器
    this.statisticsManager = new StatisticsManager(this.dataService)
    this.recordsListManager = new RecordsListManager(this.dataService)
    this.budgetManager = new BudgetManager(this.dataService)
    this.categoryManager = new CategoryManager()
    this.changelogManager = new ChangelogManager()
    this.setupHistoryManagement()
    this.setupGlobalSettingsListener()
    
    // 設置全域應用程式引用
    window.app = this
    
    // 預設顯示首頁
    this.showListPage()
    
    // 註冊 Service Worker
    this.registerServiceWorker()
  }

  setupEventListeners() {
    // 收支切換按鈕
    document.getElementById('expense-btn').addEventListener('click', () => {
      this.switchType('expense')
    })
    
    document.getElementById('income-btn').addEventListener('click', () => {
      this.switchType('income')
    })

    // 數字鍵盤
    document.querySelectorAll('.number-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const number = e.target.dataset.number
        this.inputNumber(number)
      })
    })

    // 清除按鈕
    document.getElementById('clear-btn').addEventListener('click', () => {
      this.clearAmount()
    })

    // 記帳按鈕
    document.getElementById('save-btn').addEventListener('click', () => {
      this.saveRecord()
    })

    // 日期變更
    document.getElementById('date-input').addEventListener('change', (e) => {
      this.onDateChange(e.target.value)
    })

    // 新增分類按鈕
    const addCategoryBtn = document.getElementById('add-category-btn')
    if (addCategoryBtn) {
      addCategoryBtn.addEventListener('click', () => {
        this.categoryManager.showAddCategoryModal(this.currentType)
      })
    }

    // 監聽自定義分類的變更事件
    document.addEventListener('customCategoryChanged', () => {
      this.renderCategories()
    })

    // 小鍵盤最小化按鈕
    const minimizePanelBtn = document.getElementById('minimize-panel-btn')
    if (minimizePanelBtn) {
      minimizePanelBtn.addEventListener('click', (e) => {
        e.stopPropagation() // 防止事件冒泡到標題列
        this.toggleInputPanel()
      })
    }

    // 面板標題列點擊
    const panelTitleBar = document.getElementById('panel-title-bar')
    if (panelTitleBar) {
      panelTitleBar.addEventListener('click', () => {
        this.toggleInputPanel()
      })
    }

    // 底部導航
    const navAdd = document.getElementById('nav-add')
    const navList = document.getElementById('nav-list')
    const navRecords = document.getElementById('nav-records')
    
    if (navAdd) {
      navAdd.addEventListener('click', () => {
        this.showAddPage()
      })
    }
    
    if (navList) {
      navList.addEventListener('click', () => {
        this.showListPage()
      })
    }
    
    if (navRecords) {
      navRecords.addEventListener('click', () => {
        this.showRecordsPage()
      })
    }
  }

  switchType(type) {
    this.currentType = type
    this.selectedCategory = null
    
    // 更新按鈕樣式
    const expenseBtn = document.getElementById('expense-btn')
    const incomeBtn = document.getElementById('income-btn')
    
    if (type === 'expense') {
      expenseBtn.className = 'flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 bg-red-500 text-white'
      incomeBtn.className = 'flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100'
    } else {
      expenseBtn.className = 'flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100'
      incomeBtn.className = 'flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 bg-green-500 text-white'
    }
    
    this.renderCategories()
  }

  renderCategories() {
    const container = document.getElementById('category-container')
    const title = document.getElementById('category-title')
    
    title.textContent = this.currentType === 'expense' ? '支出類別' : '收入類別'
    
    container.innerHTML = ''
    
    // 獲取所有分類（包含自定義分類）
    const allCategories = this.categoryManager.getAllCategories(this.currentType)
    
    allCategories.forEach(category => {
      const button = document.createElement('button')
      button.className = 'category-btn'
      button.dataset.categoryId = category.id
      
      // 添加分類顏色作為背景色
      if (category.color) {
        button.classList.add(category.color)
        button.classList.add('text-white') // 確保文字可見
      }
      
      button.innerHTML = `
        <div class="flex items-center justify-center space-x-2">
          <span class="text-lg"><i class="${category.icon}"></i></span>
          <span>${category.name}</span>
        </div>
      `
      
      button.addEventListener('click', () => {
        this.selectCategory(category.id)
      })
      
      container.appendChild(button)
    })
    
    // 新增分類管理按鈕
    const manageButton = document.createElement('button')
    manageButton.className = 'category-btn border-2 border-dashed border-gray-300 hover:border-primary hover:text-primary'
    manageButton.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <span class="text-lg"><i class="fas fa-cog"></i></span>
        <span>管理分類</span>
      </div>
    `
    
    manageButton.addEventListener('click', () => {
      this.categoryManager.showManageCategoriesModal(this.currentType)
    })
    
    container.appendChild(manageButton)
  }

  selectCategory(categoryId) {
    this.selectedCategory = categoryId
    
    // 更新按鈕樣式
    document.querySelectorAll('.category-btn').forEach(btn => {
      btn.classList.remove('active')
      // 清除內聯樣式
      btn.style.background = ''
      btn.style.color = ''
      btn.style.borderColor = ''
      btn.style.transform = ''
      btn.style.boxShadow = ''
    })
    
    const selectedBtn = document.querySelector(`[data-category-id="${categoryId}"]`)
    if (selectedBtn) {
      selectedBtn.classList.add('active')
      
      // 使用與記帳成功相同的綠色漸變效果，添加黑邊
      selectedBtn.style.background = 'linear-gradient(to right, #10B981, #059669)'
      selectedBtn.style.color = 'white'
      selectedBtn.style.border = '2px solid #000000'
      selectedBtn.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      selectedBtn.style.transition = 'all 0.2s ease-in-out'
    }
  }

  inputNumber(number) {
    if (number === '.') {
      if (this.currentAmount.includes('.')) return
      if (this.currentAmount === '0') {
        this.currentAmount = '0.'
      } else {
        this.currentAmount += '.'
      }
    } else {
      if (this.currentAmount === '0') {
        this.currentAmount = number
      } else {
        this.currentAmount += number
      }
    }
    
    this.updateAmountDisplay()
  }

  clearAmount() {
    this.currentAmount = '0'
    this.updateAmountDisplay()
  }

  updateAmountDisplay() {
    const display = document.getElementById('amount-display')
    display.textContent = formatCurrency(parseFloat(this.currentAmount))
  }

  setCurrentDate() {
    // 使用本地時間避免時區問題
    const today = new Date()
    const todayStr = formatDateToString(today)
    
    document.getElementById('date-input').value = todayStr
  }

  onDateChange(date) {
    // 可以在這裡加載該日期的記錄
    console.log('日期變更:', date)
  }

  async saveRecord() {
    const amount = parseFloat(this.currentAmount)
    const description = document.getElementById('description-input').value
    const date = document.getElementById('date-input').value
    
    // 驗證輸入
    if (amount <= 0) {
      showToast('請輸入有效金額', 'error')
      return
    }
    
    if (!this.selectedCategory) {
      showToast('請選擇分類', 'error')
      return
    }
    
    if (!date) {
      showToast('請選擇日期', 'error')
      return
    }

    try {
      const record = {
        type: this.currentType,
        category: this.selectedCategory,
        amount: amount,
        description: description,
        date: date
      }
      
      await this.dataService.addRecord(record)
      
      // 重置表單
      this.clearAmount()
      document.getElementById('description-input').value = ''
      this.selectedCategory = null
      document.querySelectorAll('.category-btn').forEach(btn => {
        btn.classList.remove('active')
      })
      
      showToast('記帳成功！', 'success')
      
    } catch (error) {
      console.error('記帳失敗:', error)
      showToast('記帳失敗，請重試', 'error')
    }
  }

  showAddPage() {
    this.navigateToPage('add')
  }

  // 統一的頁面導航方法
  navigateToPage(page, addToHistory = true) {
    const previousPage = this.currentPage
    this.currentPage = page
    
    // 添加到瀏覽器歷史記錄
    if (addToHistory && page !== previousPage) {
      const state = { page: page, timestamp: Date.now() }
      const url = `#${page}`
      history.pushState(state, '', url)
    }
    
    // 根據頁面類型渲染
    switch(page) {
      case 'add':
        this.renderAddPage()
        this.updateNavigation('add')
        break
      case 'records':
        this.renderRecordsPage()
        this.updateNavigation('records')
        break
      case 'statistics':
        this.renderStatisticsPage()
        this.updateNavigation('statistics')
        break
      case 'home':
      default:
        this.renderHomePage()
        this.updateNavigation('home')
        break
    }
  }

  showListPage() {
    this.navigateToPage('list')
  }

  showStatsPage() {
    this.navigateToPage('stats')
  }

  showRecordsPage() {
    this.navigateToPage('records')
  }

  // 統一的頁面導航方法
  navigateToPage(page, addToHistory = true) {
    const previousPage = this.currentPage
    this.currentPage = page
    
    // 添加到瀏覽器歷史記錄
    if (addToHistory && page !== previousPage) {
      const state = { page: page, timestamp: Date.now() }
      const url = `#${page}`
      history.pushState(state, '', url)
    }
    
    // 根據頁面類型渲染
    switch(page) {
      case 'add':
        this.renderAddPage()
        this.updateNavigation('add')
        break
      case 'records':
        this.recordsListManager.renderRecordsListPage()
        this.updateNavigation('records')
        break
      case 'stats':
        this.statisticsManager.renderStatisticsPage()
        this.updateNavigation('stats')
        break
      case 'list':
      default:
        this.renderHomePage()
        this.updateNavigation('list')
        break
    }
  }

  renderAddPage() {
    const container = document.getElementById('app')
    
    container.innerHTML = `
      <div class="container mx-auto px-4 py-4 max-w-md" style="padding-bottom: 45vh;">
        
        <!-- 收支切換按鈕 -->
        <div class="flex mb-6 bg-white rounded-lg p-1 shadow-md">
          <button id="expense-btn" class="flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 bg-red-500 text-white">
            支出
          </button>
          <button id="income-btn" class="flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100">
            收入
          </button>
        </div>

        <!-- 分類選擇 -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-800" id="category-title">支出類別</h3>
            <button id="add-category-btn" class="text-primary hover:text-blue-600 text-sm">
              + 新增分類
            </button>
          </div>
          <div id="category-container" class="grid grid-cols-2 gap-2 overflow-y-auto max-h-[calc(55vh-180px)] pb-2">
            <!-- 分類按鈕將由 JavaScript 動態生成 -->
          </div>
        </div>

        <!-- 底部固定區域 -->
        <div id="input-panel" class="fixed bottom-[80px] left-0 right-0 bg-white shadow-lg z-40 transition-transform duration-300">
          <!-- 面板標題列 -->
          <div id="panel-title-bar" class="flex items-center justify-between p-2 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
            <h4 class="font-medium text-gray-800 text-sm">記帳輸入</h4>
            <button id="minimize-panel-btn" class="p-1 text-gray-500 hover:text-gray-700 transition-colors">
              <i class="fas fa-chevron-down text-sm"></i>
            </button>
          </div>
          
          <!-- 面板內容 -->
          <div id="input-panel-content" class="p-2 overflow-y-auto">
            <!-- 日期選擇 -->
            <div class="mb-2 flex items-center space-x-2">
              <label class="text-xs font-medium text-gray-700 whitespace-nowrap">日期</label>
              <input type="date" id="date-input" class="flex-1 p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>

            <div class="flex space-x-2 mb-2 items-center">
              <!-- 金額顯示 -->
              <div id="amount-display" class="w-2/4 text-lg font-bold text-center py-2 bg-gray-100 rounded-md text-gray-800 flex items-center justify-center">
                $0
              </div>
              <!-- 說明輸入 -->
              <input type="text" id="description-input" placeholder="輸入說明..." class="flex-1 p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-transparent">
            </div>

            <!-- 數字鍵盤 -->
            <div id="number-keypad" class="grid grid-cols-3 gap-1.5 mb-2">
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="1">1</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="2">2</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="3">3</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="4">4</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="5">5</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="6">6</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="7">7</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="8">8</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="9">9</button>
              <button id="clear-btn" class="number-btn bg-red-400 hover:bg-red-500 text-white text-base font-semibold rounded-md transition-colors h-10">AC</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number="0">0</button>
              <button class="number-btn bg-gray-100 hover:bg-gray-200 text-base font-semibold rounded-md transition-colors h-10" data-number=".">.</button>
            </div>

            <!-- 記帳按鈕 -->
            <button id="save-btn" class="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-2.5 rounded-md shadow-lg transition-all duration-200 text-sm">
              記帳！
            </button>
          </div>
        </div>

        <!-- 底部導航 -->
        <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 z-50">
          <div class="flex justify-around max-w-md mx-auto">
            <button id="nav-list" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-home"></i></span>
              <span class="text-xs">首頁</span>
            </button>
            <button id="nav-add" class="flex flex-col items-center py-2 text-primary">
              <span class="text-2xl"><i class="fas fa-plus"></i></span>
              <span class="text-xs">記帳</span>
            </button>
            <button id="nav-records" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-list"></i></span>
              <span class="text-xs">明細</span>
            </button>
          </div>
        </nav>
      </div>

      <!-- 成功提示 -->
      <div id="success-toast" class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg opacity-0 transition-opacity duration-300 z-50">
        記帳成功！
      </div>
    `

    this.setupEventListeners()
    this.renderCategories()
    this.setCurrentDate()
  }

  async renderHomePage() {
    const container = document.getElementById('app')
    
    container.innerHTML = `
      <div class="container mx-auto px-4 py-6 max-w-md">

        <!-- 標題和功能按鈕 -->
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-gray-800">輕鬆記帳</h1>
          <div class="flex space-x-2">
            <button id="stats-btn" class="p-2 text-gray-600 hover:text-primary transition-colors" title="統計分析">
              <i class="fas fa-chart-bar text-xl"></i>
            </button>
            <button id="settings-btn" class="p-2 text-gray-600 hover:text-primary transition-colors" title="設定">
              <i class="fas fa-cog text-xl"></i>
            </button>
          </div>
        </div>

        <!-- 快速統計 -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 rounded-lg shadow-md">
            <div class="text-sm opacity-90">本月收入</div>
            <div id="month-income" class="text-xl font-bold">$0</div>
          </div>
          <div class="bg-gradient-to-r from-red-500 to-red-600 text-white p-4 rounded-lg shadow-md">
            <div class="text-sm opacity-90">本月支出</div>
            <div id="month-expense" class="text-xl font-bold">$0</div>
          </div>
        </div>

        <!-- 設定選單 Modal -->
        <div id="settingsModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 hidden">
          <div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h3 class="text-xl font-semibold mb-4 text-center">設定</h3>
            
            <!-- 版本資訊與更新內容 -->
            <div class="mb-6 p-4 bg-gray-50 rounded-lg">
              <div class="flex items-center justify-between mb-3">
                <div class="text-sm text-gray-600">應用程式版本</div>
                <button id="view-changelog-btn" class="text-xs text-primary hover:text-blue-600 underline">
                  查看完整日誌
                </button>
              </div>
              
              <!-- 版本號和發布日期 -->
              <div class="flex items-center justify-between mb-3">
                <div class="font-mono text-xl font-bold text-gray-800" id="app-version">v2.0.7.4</div>
                <div class="text-xs text-gray-500" id="last-updated">載入中...</div>
              </div>
              
              <!-- 當前版本更新內容 -->
              <div id="current-version-summary">
                <!-- 將由 JavaScript 動態填入 -->
              </div>
            </div>

            <!-- 功能按鈕 -->
            <div class="space-y-3">
              <button id="check-update-btn" class="w-full flex items-center justify-center space-x-2 p-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors">
                <i class="fas fa-sync-alt"></i>
                <span>檢查更新</span>
              </button>
              <button id="export-data-btn" class="w-full flex items-center justify-center space-x-2 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                <i class="fas fa-download"></i>
                <span>匯出資料</span>
              </button>
              <button id="import-data-btn" class="w-full flex items-center justify-center space-x-2 p-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                <i class="fas fa-upload"></i>
                <span>匯入資料</span>
              </button>
              <input type="file" id="import-file-input" accept=".json" class="hidden">
            </div>
            
            <div class="flex justify-end mt-6">
              <button id="closeSettingsModal" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">關閉</button>
            </div>
          </div>
        </div>

        <!-- 時間範圍選擇 -->
        <div class="mb-6">
          <div class="flex space-x-2 bg-white rounded-lg p-1 shadow-md">
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="week">本週</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200 bg-primary text-white" data-period="month">本月</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="custom">自訂</button>
          </div>
        </div>

        <!-- 自訂時間範圍 Modal -->
        <div id="dateRangeModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 hidden">
          <div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4">
            <h3 class="text-xl font-semibold mb-4">選擇自訂時間範圍</h3>
            
            <!-- 快速設定按鍵 -->
            <div class="mb-6">
              <h4 class="text-sm font-medium text-gray-700 mb-3">快速設定</h4>
              <div class="grid grid-cols-3 gap-2">
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="today">今日</button>
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="week">本週</button>
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="last7days">近七日</button>
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="month">本月</button>
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="lastmonth">上月</button>
                <button class="quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="year">今年</button>
              </div>
            </div>
            
            <div class="mb-4">
              <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
              <input type="date" id="startDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-4">
              <label for="endDate" class="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
              <input type="date" id="endDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
            </div>
            <div class="flex justify-end space-x-3">
              <button id="cancelDateRange" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">取消</button>
              <button id="applyDateRange" class="px-4 py-2 bg-primary text-white rounded-md hover:bg-blue-600">確定</button>
            </div>
          </div>
        </div>

        <!-- Slider 容器 -->
        <div class="bg-white rounded-lg shadow-md mb-6 overflow-hidden">
          <!-- Slider 標題和指示器 -->
          <div class="flex items-center justify-between p-4 border-b border-gray-200">
            <div class="flex space-x-4">
              <button id="slider-tab-1" class="slider-tab text-lg font-semibold text-primary border-b-2 border-primary pb-1">支出分類</button>
              <button id="slider-tab-2" class="slider-tab text-lg font-semibold text-gray-500 pb-1">預算管理</button>
            </div>
            <div class="flex space-x-1">
              <div id="indicator-1" class="w-2 h-2 rounded-full bg-primary"></div>
              <div id="indicator-2" class="w-2 h-2 rounded-full bg-gray-300"></div>
            </div>
          </div>
          
          <!-- Slider 內容 -->
          <div class="relative overflow-hidden" id="slider-wrapper">
            <div id="slider-container" class="flex transition-transform duration-300 ease-in-out" style="transform: translateX(0%)">
              <!-- 第一頁：支出分類圓餅圖 -->
              <div class="w-full flex-shrink-0 p-4">
                <div class="flex items-center justify-between mb-3">
                  <h4 class="font-medium text-gray-700">支出分析</h4>
                  <button id="view-stats-btn" class="text-sm text-primary hover:text-blue-600 transition-colors">
                    <i class="fas fa-chart-line mr-1"></i>詳細統計
                  </button>
                </div>
                <div class="relative h-64">
                  <canvas id="home-expense-chart"></canvas>
                </div>
              </div>
              
              <!-- 第二頁：預算管理 -->
              <div class="w-full flex-shrink-0 p-4">
                <div id="budget-widget-container">
                  <!-- 預算小工具將在這裡顯示 -->
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 最近記錄 -->
        <div class="bg-white p-4 rounded-lg shadow-md mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-800">最近記錄</h3>
            <button id="view-all-records" class="text-primary hover:text-blue-600 text-sm">
              查看全部
            </button>
          </div>
          <div id="recent-records" class="space-y-3">
            <!-- 最近記錄將在這裡顯示 -->
          </div>
        </div>

        <!-- 底部空間 -->
        <div class="h-20"></div>

        <!-- 底部導航 -->
        <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2">
          <div class="flex justify-around max-w-md mx-auto">
            <button id="nav-list" class="flex flex-col items-center py-2 text-primary">
              <span class="text-2xl"><i class="fas fa-home"></i></span>
              <span class="text-xs">首頁</span>
            </button>
            <button id="nav-add" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-plus"></i></span>
              <span class="text-xs">記帳</span>
            </button>
            <button id="nav-records" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-list"></i></span>
              <span class="text-xs">明細</span>
            </button>
          </div>
        </nav>
      </div>
    `

    this.setupHomePageEventListeners()
    await this.loadHomePageData('month')
    await this.loadBudgetWidget()
  }

  setupHomePageEventListeners() {
    // 時間範圍切換
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.target.dataset.period
        if (period === 'custom') {
          this.showDateRangeModal()
        } else {
          this.switchHomePeriod(period)
          this.loadHomePageData(period)
        }
      })
    })

    // 自訂時間範圍 Modal 事件
    const dateRangeModal = document.getElementById('dateRangeModal')
    const startDateInput = document.getElementById('startDate')
    const endDateInput = document.getElementById('endDate')
    const applyDateRangeBtn = document.getElementById('applyDateRange')
    const cancelDateRangeBtn = document.getElementById('cancelDateRange')

    if (applyDateRangeBtn) {
      applyDateRangeBtn.addEventListener('click', () => {
        const startDate = startDateInput.value
        const endDate = endDateInput.value
        if (startDate && endDate) {
          this.loadHomePageData('custom', startDate, endDate)
          this.switchHomePeriod('custom')
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

    // 快速日期設定按鍵
    document.querySelectorAll('.quick-date-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const range = e.target.dataset.range
        const dateRange = getDateRange(range)
        
        if (startDateInput && endDateInput) {
          startDateInput.value = dateRange.startDate
          endDateInput.value = dateRange.endDate
        }
        
        // 高亮選中的快速設定按鈕
        document.querySelectorAll('.quick-date-btn').forEach(b => {
          b.classList.remove('bg-primary', 'text-white')
          b.classList.add('bg-gray-100', 'hover:bg-gray-200')
        })
        e.target.classList.remove('bg-gray-100', 'hover:bg-gray-200')
        e.target.classList.add('bg-primary', 'text-white')
      })
    })

    // Slider 標籤切換
    document.getElementById('slider-tab-1').addEventListener('click', () => {
      this.switchSlider(1)
    })
    
    document.getElementById('slider-tab-2').addEventListener('click', () => {
      this.switchSlider(2)
    })

    // 添加滑動手勢支持
    this.setupSliderGestures()

    // 預算設定按鈕（延遲綁定，因為預算小工具是動態載入的）
    setTimeout(() => {
      const editBudgetBtn = document.getElementById('edit-budget-btn')
      const setBudgetBtn = document.getElementById('set-budget-btn')
      
      if (editBudgetBtn) {
        editBudgetBtn.addEventListener('click', () => {
          this.budgetManager.showBudgetModal()
        })
      }
      
      if (setBudgetBtn) {
        setBudgetBtn.addEventListener('click', () => {
          this.budgetManager.showBudgetModal()
        })
      }
    }, 100)

    // 查看全部記錄
    const viewAllBtn = document.getElementById('view-all-records')
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', () => {
        this.recordsListManager.renderRecordsListPage()
        this.updateNavigation('records')
      })
    }

    // 統計按鈕
    const statsBtn = document.getElementById('stats-btn')
    if (statsBtn) {
      statsBtn.addEventListener('click', () => {
        this.showStatsPage()
      })
    }

    // 詳細統計按鈕
    const viewStatsBtn = document.getElementById('view-stats-btn')
    if (viewStatsBtn) {
      viewStatsBtn.addEventListener('click', () => {
        this.showStatsPage()
      })
    }

    // 設定按鈕
    const settingsBtn = document.getElementById('settings-btn')
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.showSettingsModal()
      })
    }

    // 設定 Modal 相關事件
    const closeSettingsBtn = document.getElementById('closeSettingsModal')
    const exportDataBtn = document.getElementById('export-data-btn')
    const importDataBtn = document.getElementById('import-data-btn')
    const importFileInput = document.getElementById('import-file-input')
    const checkUpdateBtn = document.getElementById('check-update-btn')
    const viewChangelogBtn = document.getElementById('view-changelog-btn')

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        this.hideSettingsModal()
      })
    }

    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', () => {
        this.exportData()
      })
    }

    if (importDataBtn) {
      importDataBtn.addEventListener('click', () => {
        importFileInput.click()
      })
    }

    if (importFileInput) {
      importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.importData(e.target.files[0])
        }
      })
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => {
        this.checkForUpdates()
      })
    }

    if (viewChangelogBtn) {
      viewChangelogBtn.addEventListener('click', () => {
        this.changelogManager.showChangelogModal()
      })
    }

    // 底部導航 - 添加存在性檢查
    const homeNavAdd = document.getElementById('nav-add')
    const homeNavList = document.getElementById('nav-list')
    const homeNavRecords = document.getElementById('nav-records')
    
    if (homeNavAdd) {
      homeNavAdd.addEventListener('click', () => {
        this.showAddPage()
      })
    }
    
    if (homeNavList) {
      homeNavList.addEventListener('click', () => {
        this.showListPage()
      })
    }
    
    if (homeNavRecords) {
      homeNavRecords.addEventListener('click', () => {
        this.showRecordsPage()
      })
    }
  }

  showDateRangeModal() {
    const modal = document.getElementById('dateRangeModal')
    const startDateInput = document.getElementById('startDate')
    const endDateInput = document.getElementById('endDate')

    // Set default dates (e.g., last month)
    const today = new Date()
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    startDateInput.value = firstDayOfMonth.toISOString().split('T')[0]
    endDateInput.value = lastDayOfMonth.toISOString().split('T')[0]

    modal.classList.remove('hidden')
  }

  async loadHomePageData(period = 'month', startDate = null, endDate = null) {
    try {
      let dateRange
      if (period === 'custom' && startDate && endDate) {
        dateRange = { startDate, endDate }
      } else {
        dateRange = getDateRange(period)
      }
      
      // 載入統計資料
      const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate)
      
      // 更新統計數字
      let periodText = ''
      if (period === 'week') {
        periodText = '本週'
      } else if (period === 'month') {
        periodText = '本月'
      } else if (period === 'custom') {
        periodText = `${startDate} 至 ${endDate}`
      }
      
      document.querySelector('#month-income').parentElement.querySelector('.text-sm').textContent = `${periodText}收入`
      document.querySelector('#month-expense').parentElement.querySelector('.text-sm').textContent = `${periodText}支出`
      
      document.getElementById('month-income').textContent = formatCurrency(stats.totalIncome)
      document.getElementById('month-expense').textContent = formatCurrency(stats.totalExpense)
      
      // 渲染支出圓餅圖
      this.renderHomeExpenseChart(stats.expenseByCategory)
      
      // 載入最近記錄
      await this.loadRecentRecords(dateRange.startDate, dateRange.endDate)
      
    } catch (error) {
      console.error('載入首頁資料失敗:', error)
    }
  }

  switchHomePeriod(period) {
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.remove('bg-primary', 'text-white')
      btn.classList.add('text-gray-600', 'hover:bg-gray-100')
    })
    
    const selectedBtn = document.querySelector(`[data-period="${period}"]`)
    if (selectedBtn) {
      selectedBtn.classList.add('bg-primary', 'text-white')
      selectedBtn.classList.remove('text-gray-600', 'hover:bg-gray-100')
    }
  }

  switchSlider(page) {
    const container = document.getElementById('slider-container')
    const tab1 = document.getElementById('slider-tab-1')
    const tab2 = document.getElementById('slider-tab-2')
    const indicator1 = document.getElementById('indicator-1')
    const indicator2 = document.getElementById('indicator-2')
    
    if (page === 1) {
      container.style.transform = 'translateX(0%)'
      tab1.classList.add('text-primary', 'border-b-2', 'border-primary')
      tab1.classList.remove('text-gray-500')
      tab2.classList.add('text-gray-500')
      tab2.classList.remove('text-primary', 'border-b-2', 'border-primary')
      indicator1.classList.add('bg-primary')
      indicator1.classList.remove('bg-gray-300')
      indicator2.classList.add('bg-gray-300')
      indicator2.classList.remove('bg-primary')
    } else {
      container.style.transform = 'translateX(-100%)'
      tab2.classList.add('text-primary', 'border-b-2', 'border-primary')
      tab2.classList.remove('text-gray-500')
      tab1.classList.add('text-gray-500')
      tab1.classList.remove('text-primary', 'border-b-2', 'border-primary')
      indicator2.classList.add('bg-primary')
      indicator2.classList.remove('bg-gray-300')
      indicator1.classList.add('bg-gray-300')
      indicator1.classList.remove('bg-primary')
    }
  }

  async loadBudgetWidget() {
    try {
      const budgetWidgetHTML = await this.budgetManager.renderBudgetWidget()
      const container = document.getElementById('budget-widget-container')
      if (container) {
        container.innerHTML = budgetWidgetHTML
        
        // 重新綁定預算按鈕事件
        setTimeout(() => {
          const editBudgetBtn = document.getElementById('edit-budget-btn')
          const setBudgetBtn = document.getElementById('set-budget-btn')
          
          if (editBudgetBtn) {
            editBudgetBtn.addEventListener('click', () => {
              this.budgetManager.showBudgetModal()
            })
          }
          
          if (setBudgetBtn) {
            setBudgetBtn.addEventListener('click', () => {
              this.budgetManager.showBudgetModal()
            })
          }
        }, 100)
      }
    } catch (error) {
      console.error('載入預算小工具失敗:', error)
    }
  }

  setupSliderGestures() {
    const sliderWrapper = document.getElementById('slider-wrapper')
    const sliderContainer = document.getElementById('slider-container')
    if (!sliderWrapper || !sliderContainer) return

    let startX = 0
    let startY = 0
    let currentX = 0
    let isDragging = false
    let isHorizontalSwipe = false
    let currentSlide = 1
    let initialTransform = 0

    // 獲取容器寬度
    const getContainerWidth = () => sliderWrapper.offsetWidth

    // 更新滑動位置
    const updateSliderPosition = (deltaX) => {
      const containerWidth = getContainerWidth()
      let newTransform = initialTransform + deltaX
      
      // 限制滑動範圍
      const maxTransform = 0
      const minTransform = -containerWidth
      newTransform = Math.max(minTransform, Math.min(maxTransform, newTransform))
      
      sliderContainer.style.transform = `translateX(${newTransform}px)`
      sliderContainer.style.transition = 'none' // 移除動畫以實現實時跟隨
      
      return newTransform
    }

    // 完成滑動並決定最終位置
    const finishSlide = (deltaX) => {
      const containerWidth = getContainerWidth()
      const threshold = containerWidth * 0.3 // 30% 的寬度作為切換閾值
      
      let targetSlide = currentSlide
      
      if (deltaX < -threshold && currentSlide === 1) {
        // 向左滑動超過閾值，切換到第二頁
        targetSlide = 2
      } else if (deltaX > threshold && currentSlide === 2) {
        // 向右滑動超過閾值，切換到第一頁
        targetSlide = 1
      }
      
      // 恢復動畫並切換到目標頁面
      sliderContainer.style.transition = 'transform 0.3s ease-in-out'
      this.switchSlider(targetSlide)
      currentSlide = targetSlide
      
      // 更新初始變換值
      initialTransform = targetSlide === 1 ? 0 : -containerWidth
    }

    // 觸控事件
    sliderWrapper.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      currentX = startX
      isDragging = false
      isHorizontalSwipe = false
      
      // 記錄當前的變換值
      const containerWidth = getContainerWidth()
      initialTransform = currentSlide === 1 ? 0 : -containerWidth
    })

    sliderWrapper.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY
      currentX = e.touches[0].clientX
      const deltaX = currentX - startX
      const deltaY = currentY - startY
      
      // 如果還沒確定滑動方向，判斷是水平還是垂直滑動
      if (!isDragging && !isHorizontalSwipe) {
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)
        
        // 如果水平移動距離大於垂直移動距離，且超過閾值，認為是水平滑動
        if (absX > absY && absX > 10) {
          isHorizontalSwipe = true
          isDragging = true
          sliderWrapper.style.cursor = 'grabbing'
        } else if (absY > 10) {
          // 如果垂直移動距離較大，不處理，讓頁面正常滾動
          return
        }
      }
      
      // 只有在確定是水平滑動時才阻止預設行為和更新位置
      if (isDragging && isHorizontalSwipe) {
        e.preventDefault()
        updateSliderPosition(deltaX)
      }
    })

    sliderWrapper.addEventListener('touchend', () => {
      if (!isDragging || !isHorizontalSwipe) {
        isDragging = false
        isHorizontalSwipe = false
        return
      }
      
      isDragging = false
      isHorizontalSwipe = false
      sliderWrapper.style.cursor = 'grab'
      
      const deltaX = currentX - startX
      finishSlide(deltaX)
    })

    // 滑鼠事件（桌面支援）
    sliderWrapper.addEventListener('mousedown', (e) => {
      startX = e.clientX
      currentX = startX
      isDragging = true
      sliderWrapper.style.cursor = 'grabbing'
      e.preventDefault()
      
      // 記錄當前的變換值
      const containerWidth = getContainerWidth()
      initialTransform = currentSlide === 1 ? 0 : -containerWidth
    })

    sliderWrapper.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      
      currentX = e.clientX
      const deltaX = currentX - startX
      updateSliderPosition(deltaX)
    })

    sliderWrapper.addEventListener('mouseup', () => {
      if (!isDragging) return
      isDragging = false
      sliderWrapper.style.cursor = 'grab'
      
      const deltaX = currentX - startX
      finishSlide(deltaX)
    })

    sliderWrapper.addEventListener('mouseleave', () => {
      if (!isDragging) return
      isDragging = false
      sliderWrapper.style.cursor = 'grab'
      
      const deltaX = currentX - startX
      finishSlide(deltaX)
    })

    // 設置初始游標樣式
    sliderWrapper.style.cursor = 'grab'
    
    // 確保初始狀態正確
    sliderContainer.style.transition = 'transform 0.3s ease-in-out'
  }

  renderHomeExpenseChart(expenseData) {
    const ctx = document.getElementById('home-expense-chart').getContext('2d')
    
    const categories = Object.keys(expenseData)
    if (categories.length === 0) {
      ctx.fillStyle = '#9CA3AF'
      ctx.font = '16px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('本月暫無支出記錄', ctx.canvas.width / 2, ctx.canvas.height / 2)
      return
    }

    const data = {
      labels: categories.map(cat => getCategoryName('expense', cat)),
      datasets: [{
        data: categories.map(cat => expenseData[cat]),
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
          '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
        ],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    }

    // 銷毀現有圖表（如果存在）
    if (this.homeChart) {
      this.homeChart.destroy()
    }

    const total = categories.reduce((sum, cat) => sum + expenseData[cat], 0)

    this.homeChart = new Chart(ctx, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%', // 增加中間空洞大小以顯示總額
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 15,
              usePointStyle: true,
              font: {
                size: 12
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = formatCurrency(context.parsed)
                const total = context.dataset.data.reduce((a, b) => a + b, 0)
                const percentage = ((context.parsed / total) * 100).toFixed(1)
                return `${context.label}: ${value} (${percentage}%)`
              }
            }
          }
        },
        animation: {
          onComplete: (animation) => {
            // 在動畫完成後繪製中央文字
            this.drawCenterText(animation.chart.ctx, total)
          }
        },
        onHover: (event, activeElements) => {
          // 當滑鼠懸停時重新繪製中央文字，確保不會消失
          this.drawCenterText(event.chart.ctx, this.currentExpenseTotal || 0)
        }
      }
    })

    // 儲存總額供後續使用
    this.currentExpenseTotal = total
    
    // 立即繪製中心文字
    this.drawCenterText(ctx, total)
    
    // 延遲繪製確保顯示
    setTimeout(() => {
      this.drawCenterText(ctx, total)
    }, 100)
    
    setTimeout(() => {
      this.drawCenterText(ctx, total)
    }, 500)
  }

  drawCenterText(ctx, total) {
    if (!ctx || !ctx.canvas) return
    
    const centerX = ctx.canvas.width / 2
    const centerY = ctx.canvas.height / 2
    
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    // 響應式字體大小
    const isMobile = ctx.canvas.width < 400
    const titleFontSize = isMobile ? 12 : 14
    const amountFontSize = isMobile ? 16 : 18
    
    // 繪製白色背景圓形
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(centerX, centerY, 50, 0, 2 * Math.PI)
    ctx.fill()
    
    // 繪製標題
    ctx.fillStyle = '#6B7280'
    ctx.font = `bold ${titleFontSize}px Arial`
    ctx.fillText('總支出', centerX, centerY - 12)
    
    // 繪製金額
    ctx.fillStyle = '#EF4444'
    ctx.font = `bold ${amountFontSize}px Arial`
    ctx.fillText(formatCurrency(total), centerX, centerY + 12)
    
    ctx.restore()
  }

  async loadRecentRecords() {
    try {
      const records = await this.dataService.getRecords()
      const recentRecords = records.slice(0, 5) // 取最近5筆記錄
      
      const container = document.getElementById('recent-records')
      
      if (recentRecords.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-4">暫無記錄</div>'
        return
      }
      
      container.innerHTML = recentRecords.map(record => {
        const categoryName = getCategoryName(record.type, record.category)
        const categoryIcon = getCategoryIcon(record.type, record.category)
        const isIncome = record.type === 'income'
        
        return `
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div class="flex items-center space-x-3">
              <span class="text-xl"><i class="${categoryIcon}"></i></span>
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
      }).join('')
      
    } catch (error) {
      console.error('載入最近記錄失敗:', error)
    }
  }

  updateNavigation(activePage) {
    const navButtons = {
      'nav-add': 'add',
      'nav-list': 'list', 
      'nav-records': 'records'
    }
    
    Object.keys(navButtons).forEach(buttonId => {
      const button = document.getElementById(buttonId)
      if (button) { // 檢查按鈕是否存在
        if (navButtons[buttonId] === activePage) {
          button.classList.remove('text-gray-400')
          button.classList.add('text-primary')
        } else {
          button.classList.remove('text-primary')
          button.classList.add('text-gray-400')
        }
      }
    })
  }

  async renderRecordsList() {
    // 這裡會實現記錄列表的渲染
    console.log('顯示記錄列表')
  }

  async renderStatistics() {
    // 這裡會實現統計圖表的渲染
    console.log('顯示統計資料')
  }

  // 顯示設定 Modal
  showSettingsModal() {
    const modal = document.getElementById('settingsModal')
    if (modal) {
      modal.classList.remove('hidden')
      this.loadVersionInfo()
      this.loadCurrentVersionSummary()
      // 不需要重複設置事件監聽器，因為已經在 setupHomePageEventListeners 中設置了
    }
  }

  // 設置全域設定按鈕監聽器
  setupGlobalSettingsListener() {
    // 移除調試代碼，簡化監聽器
    document.addEventListener('click', (e) => {
      if (e.target.id === 'settings-btn' || e.target.closest('#settings-btn')) {
        e.preventDefault()
        this.showSettingsModal()
      }
    })
  }

  // 設置設定 Modal 的事件監聽器
  setupSettingsModalEventListeners() {
    // 設定 Modal 相關事件
    const closeSettingsBtn = document.getElementById('closeSettingsModal')
    const exportDataBtn = document.getElementById('export-data-btn')
    const importDataBtn = document.getElementById('import-data-btn')
    const importFileInput = document.getElementById('import-file-input')
    const checkUpdateBtn = document.getElementById('check-update-btn')
    const viewChangelogBtn = document.getElementById('view-changelog-btn')

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        this.hideSettingsModal()
      })
    }

    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', () => {
        this.exportData()
      })
    }

    if (importDataBtn) {
      importDataBtn.addEventListener('click', () => {
        importFileInput.click()
      })
    }

    if (importFileInput) {
      importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.importData(e.target.files[0])
        }
      })
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => {
        this.checkForUpdates()
      })
    }

    if (viewChangelogBtn) {
      viewChangelogBtn.addEventListener('click', () => {
        this.changelogManager.showChangelogModal()
      })
    }
  }

  // 載入版本資訊
  async loadVersionInfo() {
    const versionElement = document.getElementById('app-version')
    const lastUpdatedElement = document.getElementById('last-updated')
    
    if (versionElement) {
      // 使用 changelog 管理器的版本號
      const currentVersion = this.changelogManager.currentVersion
      versionElement.textContent = `v${currentVersion}`
      
      // 更新 localStorage 中的版本號
      // localStorage.setItem('app-current-version', currentVersion)
    }
    
    if (lastUpdatedElement) {
      // 從 changelog 獲取當前版本的發布日期
      const currentVersionInfo = this.changelogManager.getCurrentVersionInfo()
      if (currentVersionInfo && currentVersionInfo.date) {
        const updateDate = new Date(currentVersionInfo.date)
        lastUpdatedElement.textContent = `發布日期：${updateDate.toLocaleDateString('zh-TW')}`
      } else {
        // 備用方案：從 localStorage 獲取最後更新時間
        const lastUpdated = localStorage.getItem('app-last-updated') || new Date().toISOString()
        const updateDate = new Date(lastUpdated)
        lastUpdatedElement.textContent = `最後更新：${updateDate.toLocaleDateString('zh-TW')} ${updateDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
      }
    }
  }

  // 載入當前版本更新摘要
  loadCurrentVersionSummary() {
    const summaryContainer = document.getElementById('current-version-summary')
    if (summaryContainer) {
      const summaryHTML = this.changelogManager.renderCurrentVersionSummary()
      summaryContainer.innerHTML = summaryHTML
    }
  }

  // 檢查更新
  async checkForUpdates() {
    const checkUpdateBtn = document.getElementById('check-update-btn')
    const originalText = checkUpdateBtn.innerHTML
    
    // 顯示檢查中狀態
    checkUpdateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>檢查中...</span>'
    checkUpdateBtn.disabled = true
    
    try {
      // 檢查 Service Worker 更新
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        if (registration) {
          await registration.update()
          
          // 檢查是否有等待中的 Service Worker
          if (registration.waiting) {
            showToast('發現新版本！請點擊立即更新', 'info', 5000)
            this.showUpdateAvailable(registration)
          } else if (registration.installing) {
            showToast('正在下載新版本...', 'info', 3000)
          } else {
            showToast('已是最新版本！', 'success', 3000)
          }
        } else {
          showToast('無法檢查更新', 'error', 3000)
        }
      } else {
        showToast('瀏覽器不支援自動更新', 'warning', 3000)
      }
    } catch (error) {
      console.error('檢查更新失敗:', error)
      showToast('檢查更新失敗，請稍後再試', 'error', 3000)
    } finally {
      // 恢復按鈕狀態
      setTimeout(() => {
        checkUpdateBtn.innerHTML = originalText
        checkUpdateBtn.disabled = false
      }, 1000)
    }
  }

  // 隱藏設定 Modal
  hideSettingsModal() {
    const modal = document.getElementById('settingsModal')
    if (modal) {
      modal.classList.add('hidden')
    }
  }

  // 匯出資料
  async exportData() {
    try {
      showToast('正在匯出資料...', 'info')
      await this.dataService.exportData()
      showToast('資料匯出成功！', 'success')
      this.hideSettingsModal()
    } catch (error) {
      console.error('匯出資料失敗:', error)
      showToast('匯出資料失敗，請重試', 'error')
    }
  }

  // 匯入資料
  async importData(file) {
    try {
      showToast('正在匯入資料...', 'info')
      const result = await this.dataService.importData(file)
      
      if (result.success) {
        showToast(result.message, 'success')
        // 重新載入頁面資料
        await this.loadHomePageData('month')
        await this.loadRecentRecords()
      } else {
        showToast(result.message, 'warning')
      }
      
      this.hideSettingsModal()
      
      // 清除檔案輸入
      const fileInput = document.getElementById('import-file-input')
      if (fileInput) {
        fileInput.value = ''
      }
      
    } catch (error) {
      console.error('匯入資料失敗:', error)
      showToast('匯入資料失敗：' + error.message, 'error')
      
      // 清除檔案輸入
      const fileInput = document.getElementById('import-file-input')
      if (fileInput) {
        fileInput.value = ''
      }
    }
  }

  // 切換輸入面板顯示/隱藏
  toggleInputPanel() {
    const inputPanel = document.getElementById('input-panel')
    const inputPanelContent = document.getElementById('input-panel-content')
    const minimizeBtn = document.getElementById('minimize-panel-btn')
    
    if (!inputPanel || !inputPanelContent || !minimizeBtn) return
    
    const isMinimized = inputPanelContent.style.display === 'none'
    
    if (isMinimized) {
      // 展開面板
      inputPanelContent.style.display = 'block'
      minimizeBtn.innerHTML = '<i class="fas fa-chevron-down"></i>'
      inputPanel.style.transform = 'translateY(0)'
    } else {
      // 最小化面板
      inputPanelContent.style.display = 'none'
      minimizeBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'
      // 只顯示標題列
      const titleHeight = minimizeBtn.closest('.flex').offsetHeight
      inputPanel.style.transform = `translateY(calc(100% - ${titleHeight + 16}px))`
    }
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/serviceWorker.js')
        console.log('Service Worker 註冊成功:', registration)
        
        // 檢查更新
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          console.log('發現新版本的 Service Worker')
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 新版本已安裝，顯示更新提示
              this.showUpdateAvailable(registration)
            }
          })
        })
        
        // 監聽 Service Worker 控制權變更
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('Service Worker 已更新，重新載入頁面')
          window.location.reload()
        })

        // 監聽 Service Worker 消息
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SW_UPDATED') {
            console.log(`應用程式已更新到版本 ${event.data.version}`)
            showToast(`應用程式已更新到版本 ${event.data.version}`, 'success', 5000)
            // 更新最後更新時間和版本號
            localStorage.setItem('app-last-updated', new Date().toISOString())
            localStorage.setItem('app-current-version', event.data.version)
          }
          
          if (event.data && event.data.type === 'VERSION_INFO') {
            // 儲存當前版本號
            localStorage.setItem('app-current-version', event.data.version)
            console.log(`當前應用程式版本：${event.data.version}`)
          }
        })

        // 請求當前版本資訊
        if (registration.active) {
          registration.active.postMessage({ type: 'GET_VERSION' })
        }
        
      } catch (error) {
        console.log('Service Worker 註冊失敗:', error)
      }
    }
  }

  // 顯示更新可用提示
  showUpdateAvailable(registration) {
    // 創建更新提示 UI
    const updateBanner = document.createElement('div')
    updateBanner.id = 'update-banner'
    updateBanner.className = 'fixed top-0 left-0 right-0 bg-blue-600 text-white p-3 z-50 flex items-center justify-between'
    updateBanner.innerHTML = `
      <div class="flex items-center space-x-2">
        <i class="fas fa-sync-alt"></i>
        <span>發現新版本！</span>
      </div>
      <div class="flex space-x-2">
        <button id="update-now-btn" class="bg-white text-blue-600 px-3 py-1 rounded text-sm font-medium hover:bg-gray-100">
          立即更新
        </button>
        <button id="update-later-btn" class="text-white hover:text-gray-200">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `
    
    document.body.appendChild(updateBanner)
    
    // 立即更新按鈕
    document.getElementById('update-now-btn').addEventListener('click', () => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
      updateBanner.remove()
    })
    
    // 稍後更新按鈕
    document.getElementById('update-later-btn').addEventListener('click', () => {
      updateBanner.remove()
    })
  }

  // 設置歷史記錄管理
  setupHistoryManagement() {
    // 監聽瀏覽器返回/前進按鈕
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.page) {
        // 從歷史記錄恢復頁面，不添加新的歷史記錄
        this.navigateToPage(event.state.page, false)
      } else {
        // 如果沒有狀態，回到首頁
        this.navigateToPage('list', false)
      }
    })
  }

  // 從 URL 初始化頁面
  initializeFromUrl() {
    const hash = window.location.hash.slice(1) // 移除 # 符號
    if (hash && ['add', 'list', 'records', 'stats'].includes(hash)) {
      this.navigateToPage(hash, false) // 初始化時不添加歷史記錄
    } else {
      // 設置初始狀態
      const state = { page: 'list', timestamp: Date.now() }
      history.replaceState(state, '', '#list')
    }
  }
}

// 啟動應用程式
document.addEventListener('DOMContentLoaded', () => {
  new EasyAccountingApp()
})

// 主應用程式入口
import DataService from './dataService.js'
import { CATEGORIES, getCategoryName, getCategoryIcon } from './categories.js'
import { formatCurrency, formatDate, showToast, getDateRange } from './utils.js'
import { StatisticsManager } from './statistics.js'
import { RecordsListManager } from './recordsList.js'
import { BudgetManager } from './budgetManager.js'
import { CategoryManager } from './categoryManager.js'

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

    // 底部導航
    document.getElementById('nav-add').addEventListener('click', () => {
      this.showAddPage()
    })
    
    document.getElementById('nav-list').addEventListener('click', () => {
      this.showListPage()
    })
    
    document.getElementById('nav-stats').addEventListener('click', () => {
      this.showStatsPage()
    })
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
      btn.style.backgroundColor = ''
      btn.style.color = ''
      btn.style.borderColor = ''
      btn.style.transform = ''
      btn.style.boxShadow = ''
    })
    
    const selectedBtn = document.querySelector(`[data-category-id="${categoryId}"]`)
    if (selectedBtn) {
      selectedBtn.classList.add('active')
      
      // 如果按鈕有背景色，使用更深的顏色作為選中狀態
      const hasBackgroundColor = selectedBtn.classList.toString().includes('bg-')
      if (!hasBackgroundColor) {
        // 沒有背景色的按鈕使用藍色
        selectedBtn.style.backgroundColor = '#3B82F6'
        selectedBtn.style.color = 'white'
        selectedBtn.style.borderColor = '#3B82F6'
      } else {
        // 有背景色的按鈕增加邊框和陰影
        selectedBtn.style.borderColor = '#1F2937'
        selectedBtn.style.borderWidth = '3px'
      }
      
      selectedBtn.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
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
    const today = new Date().toISOString().split('T')[0]
    document.getElementById('date-input').value = today
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
    this.currentPage = 'add'
    this.renderAddPage()
    this.updateNavigation('add')
  }

  showListPage() {
    this.currentPage = 'list'
    this.renderHomePage()
    this.updateNavigation('list')
  }

  showStatsPage() {
    this.currentPage = 'stats'
    this.statisticsManager.renderStatisticsPage()
    this.updateNavigation('stats')
  }

  renderAddPage() {
    const container = document.getElementById('app')
    
    container.innerHTML = `
      <div class="container mx-auto px-4 py-6 max-w-md">
        
        <!-- 標題區域 -->
        <header class="text-center mb-6">
          <h1 class="text-3xl font-bold text-gray-800 mb-2">輕鬆記帳</h1>
          <p class="text-gray-600">簡單實用的記帳工具</p>
        </header>

        <!-- 收支切換按鈕 -->
        <div class="flex mb-6 bg-white rounded-lg p-1 shadow-md">
          <button id="expense-btn" class="flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 bg-red-500 text-white">
            支出
          </button>
          <button id="income-btn" class="flex-1 py-3 px-4 rounded-md font-medium transition-all duration-200 text-gray-600 hover:bg-gray-100">
            收入
          </button>
        </div>

        <!-- 日期選擇 -->
        <div class="mb-6">
          <input type="date" id="date-input" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
        </div>

        <!-- 分類選擇 -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-800" id="category-title">支出類別</h3>
            <button id="add-category-btn" class="text-primary hover:text-blue-600 text-sm">
              + 新增分類
            </button>
          </div>
          <div id="category-container" class="grid grid-cols-2 gap-3">
            <!-- 分類按鈕將由 JavaScript 動態生成 -->
          </div>
        </div>

        <!-- 說明輸入 -->
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">說明</label>
          <input type="text" id="description-input" placeholder="輸入說明..." class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
        </div>

        <!-- 金額顯示 -->
        <div class="mb-6">
          <div id="amount-display" class="text-4xl font-bold text-center py-6 bg-white rounded-lg shadow-md text-gray-800">
            0
          </div>
        </div>

        <!-- 數字鍵盤 -->
        <div class="grid grid-cols-3 gap-3 mb-6">
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="1">1</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="2">2</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="3">3</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="4">4</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="5">5</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="6">6</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="7">7</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="8">8</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="9">9</button>
          <button id="clear-btn" class="bg-gray-200 hover:bg-gray-300 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors">AC</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number="0">0</button>
          <button class="number-btn bg-white hover:bg-gray-50 text-xl font-semibold py-4 rounded-lg shadow-md transition-colors" data-number=".">.</button>
        </div>

        <!-- 記帳按鈕 -->
        <button id="save-btn" class="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105">
          記帳！
        </button>

        <!-- 底部導航 -->
        <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2">
          <div class="flex justify-around max-w-md mx-auto">
            <button id="nav-list" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-home"></i></span>
              <span class="text-xs">首頁</span>
            </button>
            <button id="nav-add" class="flex flex-col items-center py-2 text-primary">
              <span class="text-2xl"><i class="fas fa-plus"></i></span>
              <span class="text-xs">記帳</span>
            </button>
            <button id="nav-stats" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-chart-bar"></i></span>
              <span class="text-xs">統計</span>
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
        <!-- 標題區域 -->
        <header class="text-center mb-6">
          <h1 class="text-3xl font-bold text-gray-800 mb-2">輕鬆記帳</h1>
          <p class="text-gray-600">您的財務管理助手</p>
        </header>

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

        <!-- 時間範圍選擇 -->
        <div class="mb-6">
          <div class="flex space-x-2 bg-white rounded-lg p-1 shadow-md">
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="week">本週</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200 bg-primary text-white" data-period="month">本月</button>
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
            <button id="nav-stats" class="flex flex-col items-center py-2 text-gray-400">
              <span class="text-2xl"><i class="fas fa-chart-bar"></i></span>
              <span class="text-xs">統計</span>
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
        this.switchHomePeriod(period)
        this.loadHomePageData(period)
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

    // 底部導航 - 添加存在性檢查
    const homeNavAdd = document.getElementById('nav-add')
    const homeNavList = document.getElementById('nav-list')
    const homeNavStats = document.getElementById('nav-stats')
    
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
    
    if (homeNavStats) {
      homeNavStats.addEventListener('click', () => {
        this.showStatsPage()
      })
    }
  }

  async loadHomePageData(period = 'month') {
    try {
      // 載入統計資料
      const dateRange = getDateRange(period)
      const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate)
      
      // 更新統計數字
      const periodText = period === 'week' ? '本週' : '本月'
      document.querySelector('#month-income').parentElement.querySelector('.text-sm').textContent = `${periodText}收入`
      document.querySelector('#month-expense').parentElement.querySelector('.text-sm').textContent = `${periodText}支出`
      
      document.getElementById('month-income').textContent = formatCurrency(stats.totalIncome)
      document.getElementById('month-expense').textContent = formatCurrency(stats.totalExpense)
      
      // 渲染支出圓餅圖
      this.renderHomeExpenseChart(stats.expenseByCategory)
      
      // 載入最近記錄
      await this.loadRecentRecords()
      
    } catch (error) {
      console.error('載入首頁資料失敗:', error)
    }
  }

  switchHomePeriod(period) {
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.remove('bg-primary', 'text-white')
      btn.classList.add('text-gray-600', 'hover:bg-gray-100')
    })
    
    document.querySelector(`[data-period="${period}"]`).classList.add('bg-primary', 'text-white')
    document.querySelector(`[data-period="${period}"]`).classList.remove('text-gray-600', 'hover:bg-gray-100')
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
    if (!sliderWrapper) return

    let startX = 0
    let currentX = 0
    let isDragging = false
    let currentSlide = 1

    // 觸控事件
    sliderWrapper.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX
      isDragging = true
      sliderWrapper.style.cursor = 'grabbing'
    })

    sliderWrapper.addEventListener('touchmove', (e) => {
      if (!isDragging) return
      e.preventDefault()
      currentX = e.touches[0].clientX
    })

    sliderWrapper.addEventListener('touchend', () => {
      if (!isDragging) return
      isDragging = false
      sliderWrapper.style.cursor = 'grab'
      
      const deltaX = startX - currentX
      const threshold = 50 // 最小滑動距離

      if (Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && currentSlide === 1) {
          // 向左滑動，切換到第二頁
          this.switchSlider(2)
          currentSlide = 2
        } else if (deltaX < 0 && currentSlide === 2) {
          // 向右滑動，切換到第一頁
          this.switchSlider(1)
          currentSlide = 1
        }
      }
    })

    // 滑鼠事件（桌面支援）
    sliderWrapper.addEventListener('mousedown', (e) => {
      startX = e.clientX
      isDragging = true
      sliderWrapper.style.cursor = 'grabbing'
      e.preventDefault()
    })

    sliderWrapper.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      currentX = e.clientX
    })

    sliderWrapper.addEventListener('mouseup', () => {
      if (!isDragging) return
      isDragging = false
      sliderWrapper.style.cursor = 'grab'
      
      const deltaX = startX - currentX
      const threshold = 50

      if (Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && currentSlide === 1) {
          this.switchSlider(2)
          currentSlide = 2
        } else if (deltaX < 0 && currentSlide === 2) {
          this.switchSlider(1)
          currentSlide = 1
        }
      }
    })

    sliderWrapper.addEventListener('mouseleave', () => {
      isDragging = false
      sliderWrapper.style.cursor = 'grab'
    })

    // 設置初始游標樣式
    sliderWrapper.style.cursor = 'grab'
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

    this.homeChart = new Chart(ctx, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
        }
      }
    })
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
      'nav-stats': 'stats'
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

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/serviceWorker.js')
        console.log('Service Worker 註冊成功:', registration)
      } catch (error) {
        console.log('Service Worker 註冊失敗:', error)
      }
    }
  }
}

// 啟動應用程式
document.addEventListener('DOMContentLoaded', () => {
  new EasyAccountingApp()
})
// 統計圖表模組
import { Chart, registerables } from 'chart.js'
import { formatCurrency, getDateRange } from './utils.js'
import { getCategoryName, getCategoryIcon, CATEGORIES } from './categories.js'

// 註冊 Chart.js 組件
Chart.register(...registerables)

export class StatisticsManager {
  constructor(dataService) {
    this.dataService = dataService
    this.charts = {}
  }

  /**
   * 渲染統計頁面
   */
  async renderStatisticsPage() {
    const container = document.getElementById('app')
    
    container.innerHTML = `
      <div class="container mx-auto px-4 py-6 max-w-md">

        <!-- 時間範圍選擇 -->
        <div class="mb-6">
          <div class="flex space-x-2 bg-white rounded-lg p-1 shadow-md">
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="week">本週</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200 bg-primary text-white" data-period="month">本月</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="year">今年</button>
            <button class="period-btn flex-1 py-2 px-3 rounded-md font-medium transition-all duration-200" data-period="custom">自訂</button>
          </div>
        </div>

        <!-- 自訂時間範圍 Modal -->
        <div id="statisticsDateRangeModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 hidden">
          <div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4">
            <h3 class="text-xl font-semibold mb-4">選擇自訂時間範圍</h3>
            
            <!-- 快速設定按鍵 -->
            <div class="mb-6">
              <h4 class="text-sm font-medium text-gray-700 mb-3">快速設定</h4>
              <div class="grid grid-cols-3 gap-2">
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="today">今日</button>
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="week">本週</button>
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="last7days">近七日</button>
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="month">本月</button>
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="lastmonth">上月</button>
                <button class="stats-quick-date-btn px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" data-range="year">今年</button>
              </div>
            </div>
            
            <div class="mb-4">
              <label for="statisticsStartDate" class="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
              <input type="date" id="statisticsStartDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-4">
              <label for="statisticsEndDate" class="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
              <input type="date" id="statisticsEndDate" class="w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
            </div>
            <div class="flex justify-end space-x-3">
              <button id="cancelStatisticsDateRange" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">取消</button>
              <button id="applyStatisticsDateRange" class="px-4 py-2 bg-primary text-white rounded-md hover:bg-blue-600">確定</button>
            </div>
          </div>
        </div>

        <!-- 總覽卡片 -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 rounded-lg shadow-md">
            <div class="text-sm opacity-90">總收入</div>
            <div id="total-income" class="text-2xl font-bold">$0</div>
          </div>
          <div class="bg-gradient-to-r from-red-500 to-red-600 text-white p-4 rounded-lg shadow-md">
            <div class="text-sm opacity-90">總支出</div>
            <div id="total-expense" class="text-2xl font-bold">$0</div>
          </div>
        </div>

        <!-- 淨收入 -->
        <div class="bg-white p-4 rounded-lg shadow-md mb-6">
          <div class="text-center">
            <div class="text-sm text-gray-600">淨收入</div>
            <div id="net-income" class="text-3xl font-bold text-gray-800">$0</div>
          </div>
        </div>

        <!-- 圖表區域 -->
        <div class="space-y-6">
          <!-- 支出分類圓餅圖 -->
          <div class="bg-white p-4 rounded-lg shadow-md">
            <h3 class="text-lg font-semibold mb-4 text-gray-800">支出分類</h3>
            <div class="relative h-64">
              <canvas id="expense-pie-chart"></canvas>
            </div>
          </div>

          <!-- 收入分類圓餅圖 -->
          <div class="bg-white p-4 rounded-lg shadow-md">
            <h3 class="text-lg font-semibold mb-4 text-gray-800">收入分類</h3>
            <div class="relative h-64">
              <canvas id="income-pie-chart"></canvas>
            </div>
          </div>

          <!-- 趨勢圖 -->
          <div class="bg-white p-4 rounded-lg shadow-md">
            <h3 class="text-lg font-semibold mb-4 text-gray-800">收支趨勢</h3>
            <div class="relative h-64">
              <canvas id="trend-chart"></canvas>
            </div>
          </div>

          <!-- 分類詳細列表 -->
          <div class="bg-white p-4 rounded-lg shadow-md">
            <h3 class="text-lg font-semibold mb-4 text-gray-800">分類明細</h3>
            <div id="category-details" class="space-y-3">
              <!-- 分類詳細資料將在這裡顯示 -->
            </div>
          </div>
        </div>

        <!-- 底部空間 -->
        <div class="h-20"></div>

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
            <button id="nav-stats" class="flex flex-col items-center py-2 text-primary">
              <span class="text-2xl"><i class="fas fa-chart-bar"></i></span>
              <span class="text-xs">統計</span>
            </button>
          </div>
        </nav>
      </div>
    `

    this.setupStatisticsEventListeners()
    await this.loadStatistics('month')
  }

  setupStatisticsEventListeners() {
    // 時間範圍切換
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.target.dataset.period
        if (period === 'custom') {
          this.showStatisticsDateRangeModal()
        } else {
          this.switchPeriod(period)
          this.loadStatistics(period)
        }
      })
    })

    // 自訂時間範圍 Modal 事件
    const dateRangeModal = document.getElementById('statisticsDateRangeModal')
    const startDateInput = document.getElementById('statisticsStartDate')
    const endDateInput = document.getElementById('statisticsEndDate')
    const applyDateRangeBtn = document.getElementById('applyStatisticsDateRange')
    const cancelDateRangeBtn = document.getElementById('cancelStatisticsDateRange')

    if (applyDateRangeBtn) {
      applyDateRangeBtn.addEventListener('click', () => {
        const startDate = startDateInput.value
        const endDate = endDateInput.value
        if (startDate && endDate) {
          this.loadStatistics('custom', startDate, endDate)
          this.switchPeriod('custom')
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

    // 統計頁面快速日期設定按鍵
    document.querySelectorAll('.stats-quick-date-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const range = e.target.dataset.range
        const dateRange = getDateRange(range)
        
        const statsStartDateInput = document.getElementById('statisticsStartDate')
        const statsEndDateInput = document.getElementById('statisticsEndDate')
        
        if (statsStartDateInput && statsEndDateInput) {
          statsStartDateInput.value = dateRange.startDate
          statsEndDateInput.value = dateRange.endDate
        }
        
        // 高亮選中的快速設定按鈕
        document.querySelectorAll('.stats-quick-date-btn').forEach(b => {
          b.classList.remove('bg-primary', 'text-white')
          b.classList.add('bg-gray-100', 'hover:bg-gray-200')
        })
        e.target.classList.remove('bg-gray-100', 'hover:bg-gray-200')
        e.target.classList.add('bg-primary', 'text-white')
      })
    })

    // 底部導航
    const navList = document.getElementById('nav-list')
    const navAdd = document.getElementById('nav-add')
    const navStats = document.getElementById('nav-stats')
    
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
    
    if (navStats) {
      navStats.addEventListener('click', () => {
        if (window.app) window.app.showStatsPage()
      })
    }
  }

  showStatisticsDateRangeModal() {
    const modal = document.getElementById('statisticsDateRangeModal')
    const startDateInput = document.getElementById('statisticsStartDate')
    const endDateInput = document.getElementById('statisticsEndDate')

    // Set default dates (e.g., last month)
    const today = new Date()
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    startDateInput.value = firstDayOfMonth.toISOString().split('T')[0]
    endDateInput.value = lastDayOfMonth.toISOString().split('T')[0]

    modal.classList.remove('hidden')
  }

  switchPeriod(period) {
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

  async loadStatistics(period, startDate = null, endDate = null) {
    let dateRange
    if (period === 'custom' && startDate && endDate) {
      dateRange = { startDate, endDate }
    } else {
      dateRange = getDateRange(period)
    }

    const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate)
    
    this.updateSummaryCards(stats)
    this.renderExpensePieChart(stats.expenseByCategory)
    this.renderIncomePieChart(stats.incomeByCategory)
    this.renderTrendChart(stats.dailyTotals, dateRange)
    this.renderCategoryDetails(stats)
  }

  updateSummaryCards(stats) {
    document.getElementById('total-income').textContent = formatCurrency(stats.totalIncome)
    document.getElementById('total-expense').textContent = formatCurrency(stats.totalExpense)
    
    const netIncome = stats.totalIncome - stats.totalExpense
    const netIncomeElement = document.getElementById('net-income')
    netIncomeElement.textContent = formatCurrency(Math.abs(netIncome))
    
    if (netIncome >= 0) {
      netIncomeElement.className = 'text-3xl font-bold text-green-600'
    } else {
      netIncomeElement.className = 'text-3xl font-bold text-red-600'
    }
  }

  renderExpensePieChart(expenseData) {
    const ctx = document.getElementById('expense-pie-chart').getContext('2d')
    
    // 銷毀現有圖表
    if (this.charts.expensePie) {
      this.charts.expensePie.destroy()
    }

    const categories = Object.keys(expenseData)
    if (categories.length === 0) {
      ctx.fillStyle = '#gray'
      ctx.font = '16px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('暫無支出資料', ctx.canvas.width / 2, ctx.canvas.height / 2)
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

    this.charts.expensePie = new Chart(ctx, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 20,
              usePointStyle: true
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

  renderIncomePieChart(incomeData) {
    const ctx = document.getElementById('income-pie-chart').getContext('2d')
    
    // 銷毀現有圖表
    if (this.charts.incomePie) {
      this.charts.incomePie.destroy()
    }

    const categories = Object.keys(incomeData)
    if (categories.length === 0) {
      ctx.fillStyle = '#gray'
      ctx.font = '16px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('暫無收入資料', ctx.canvas.width / 2, ctx.canvas.height / 2)
      return
    }

    const data = {
      labels: categories.map(cat => getCategoryName('income', cat)),
      datasets: [{
        data: categories.map(cat => incomeData[cat]),
        backgroundColor: [
          '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
          '#00BCD4', '#795548', '#607D8B', '#E91E63'
        ],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    }

    this.charts.incomePie = new Chart(ctx, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 20,
              usePointStyle: true
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

  renderTrendChart(dailyData, dateRange) {
    const ctx = document.getElementById('trend-chart').getContext('2d')
    
    // 銷毀現有圖表
    if (this.charts.trend) {
      this.charts.trend.destroy()
    }

    // 生成日期範圍內的所有日期
    const dates = this.generateDateRange(dateRange.startDate, dateRange.endDate)
    const incomeData = dates.map(date => dailyData[date]?.income || 0)
    const expenseData = dates.map(date => dailyData[date]?.expense || 0)

    const data = {
      labels: dates.map(date => {
        const d = new Date(date)
        return `${d.getMonth() + 1}/${d.getDate()}`
      }),
      datasets: [
        {
          label: '收入',
          data: incomeData,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          tension: 0.4
        },
        {
          label: '支出',
          data: expenseData,
          borderColor: '#F44336',
          backgroundColor: 'rgba(244, 67, 54, 0.1)',
          tension: 0.4
        }
      ]
    }

    this.charts.trend = new Chart(ctx, {
      type: 'line',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top'
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`
              }
            }
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: '日期'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: '金額'
            },
            ticks: {
              callback: (value) => formatCurrency(value)
            }
          }
        }
      }
    })
  }

  renderCategoryDetails(stats) {
    const container = document.getElementById('category-details')
    container.innerHTML = ''

    // 合併收入和支出分類
    const allCategories = []
    
    // 添加支出分類
    Object.entries(stats.expenseByCategory).forEach(([categoryId, amount]) => {
      allCategories.push({
        type: 'expense',
        categoryId,
        amount,
        name: getCategoryName('expense', categoryId),
        icon: getCategoryIcon('expense', categoryId)
      })
    })

    // 添加收入分類
    Object.entries(stats.incomeByCategory).forEach(([categoryId, amount]) => {
      allCategories.push({
        type: 'income',
        categoryId,
        amount,
        name: getCategoryName('income', categoryId),
        icon: getCategoryIcon('income', categoryId)
      })
    })

    // 按金額排序
    allCategories.sort((a, b) => b.amount - a.amount)

    allCategories.forEach(category => {
      const item = document.createElement('div')
      item.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg'
      
      const typeColor = category.type === 'income' ? 'text-green-600' : 'text-red-600'
      const typeText = category.type === 'income' ? '收入' : '支出'
      
      item.innerHTML = `
        <div class="flex items-center space-x-3">
          <span class="text-2xl"><i class="${category.icon}"></i></span>
          <div>
            <div class="font-medium">${category.name}</div>
            <div class="text-sm text-gray-500">${typeText}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold ${typeColor}">${formatCurrency(category.amount)}</div>
        </div>
      `
      
      container.appendChild(item)
    })

    if (allCategories.length === 0) {
      container.innerHTML = '<div class="text-center text-gray-500 py-8">暫無資料</div>'
    }
  }

  generateDateRange(startDate, endDate) {
    const dates = []
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      dates.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }

    return dates
  }

  // 清理圖表資源
  destroy() {
    Object.values(this.charts).forEach(chart => {
      if (chart) chart.destroy()
    })
    this.charts = {}
  }
}
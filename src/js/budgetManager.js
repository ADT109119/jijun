// 預算管理模組
import { formatCurrency, getDateRange } from './utils.js'

export class BudgetManager {
  constructor(dataService) {
    this.dataService = dataService
    this.currentBudget = 0
    this.loadBudget()
  }

  async loadBudget() {
    try {
      const budget = localStorage.getItem('monthlyBudget')
      this.currentBudget = budget ? parseFloat(budget) : 0
    } catch (error) {
      console.error('載入預算失敗:', error)
      this.currentBudget = 0
    }
  }

  async saveBudget(amount) {
    try {
      this.currentBudget = amount
      localStorage.setItem('monthlyBudget', amount.toString())
      return true
    } catch (error) {
      console.error('儲存預算失敗:', error)
      return false
    }
  }

  async getBudgetStatus() {
    const dateRange = getDateRange('month')
    const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate)
    
    const spent = stats.totalExpense
    const remaining = Math.max(0, this.currentBudget - spent)
    const percentage = this.currentBudget > 0 ? (spent / this.currentBudget) * 100 : 0
    
    return {
      budget: this.currentBudget,
      spent: spent,
      remaining: remaining,
      percentage: Math.min(100, percentage),
      isOverBudget: spent > this.currentBudget
    }
  }

  renderBudgetWidget() {
    return this.getBudgetStatus().then(status => {
      const isOverBudget = status.isOverBudget
      const waterLevel = Math.min(100, status.percentage)
      
      return `
        <div class="bg-white p-4 rounded-lg shadow-md mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-800">本月預算</h3>
            <button id="edit-budget-btn" class="text-primary hover:text-blue-600 text-sm">
              ${status.budget > 0 ? '編輯' : '設定'}
            </button>
          </div>
          
          ${status.budget > 0 ? `
            <!-- 水位圖 -->
            <div class="relative mb-4">
              <div class="w-full h-32 bg-gray-100 rounded-lg overflow-hidden relative">
                <!-- 水位背景 -->
                <div class="absolute bottom-0 left-0 right-0 transition-all duration-1000 ease-out ${
                  isOverBudget ? 'bg-red-400' : 'bg-blue-400'
                }" style="height: ${waterLevel}%">
                  <!-- 水波動畫 -->
                  <div class="absolute top-0 left-0 right-0 h-2 ${
                    isOverBudget ? 'bg-red-300' : 'bg-blue-300'
                  } opacity-60 animate-pulse"></div>
                </div>
                
                <!-- 預算資訊覆蓋層 -->
                <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-700">
                  <div class="text-sm font-medium">已使用</div>
                  <div class="text-xl font-bold ${isOverBudget ? 'text-red-600' : 'text-gray-800'}">
                    ${waterLevel.toFixed(1)}%
                  </div>
                  <div class="text-xs text-gray-600 mt-1">
                    ${formatCurrency(status.spent)} / ${formatCurrency(status.budget)}
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 預算詳情 -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div class="text-center">
                <div class="text-gray-600">剩餘預算</div>
                <div class="font-bold ${isOverBudget ? 'text-red-600' : 'text-green-600'}">
                  ${isOverBudget ? '-' : ''}${formatCurrency(Math.abs(status.remaining))}
                </div>
              </div>
              <div class="text-center">
                <div class="text-gray-600">本月支出</div>
                <div class="font-bold text-gray-800">${formatCurrency(status.spent)}</div>
              </div>
            </div>
            
            ${isOverBudget ? `
              <div class="mt-3 p-2 bg-red-50 border border-red-200 rounded text-center">
                <span class="text-red-600 text-sm">⚠️ 已超出預算 ${formatCurrency(status.spent - status.budget)}</span>
              </div>
            ` : ''}
          ` : `
            <div class="text-center py-8">
              <div class="text-4xl mb-3">💰</div>
              <p class="text-gray-600 mb-4">設定每月預算來追蹤支出</p>
              <button id="set-budget-btn" class="bg-primary hover:bg-blue-600 text-white px-6 py-2 rounded-lg transition-colors">
                設定預算
              </button>
            </div>
          `}
        </div>
      `
    })
  }

  showBudgetModal() {
    const modal = document.createElement('div')
    modal.id = 'budget-modal'
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4">設定每月預算</h3>
        
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">預算金額</label>
          <input type="number" id="budget-input" step="100" min="0" 
                 value="${this.currentBudget}" 
                 placeholder="輸入每月預算..."
                 class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
        </div>
        
        <div class="text-sm text-gray-600 mb-6">
          <p>💡 建議設定合理的月支出預算，幫助您控制開銷</p>
        </div>
        
        <div class="flex space-x-3">
          <button id="save-budget-btn" class="flex-1 bg-primary hover:bg-blue-600 text-white py-3 rounded-lg transition-colors">
            儲存
          </button>
          <button id="cancel-budget-btn" class="px-6 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(modal)
    
    // 事件監聽
    document.getElementById('save-budget-btn').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('budget-input').value)
      if (amount >= 0) {
        await this.saveBudget(amount)
        this.closeBudgetModal()
        // 重新渲染首頁
        if (window.app && window.app.currentPage === 'list') {
          window.app.renderHomePage()
        }
      }
    })
    
    document.getElementById('cancel-budget-btn').addEventListener('click', () => {
      this.closeBudgetModal()
    })
    
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeBudgetModal()
      }
    })
    
    // 自動聚焦輸入框
    setTimeout(() => {
      document.getElementById('budget-input').focus()
    }, 100)
  }

  closeBudgetModal() {
    const modal = document.getElementById('budget-modal')
    if (modal) {
      modal.remove()
    }
  }
}
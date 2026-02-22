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
    // Budget should not include transfers, so offset them
    const stats = await this.dataService.getStatistics(
      dateRange.startDate,
      dateRange.endDate,
      null,
      true
    )

    const spent = stats.totalExpense
    const remaining = Math.max(0, this.currentBudget - spent)
    const percentage =
      this.currentBudget > 0 ? (spent / this.currentBudget) * 100 : 0

    return {
      budget: this.currentBudget,
      spent: spent,
      remaining: remaining,
      percentage: Math.min(100, percentage),
      isOverBudget: spent > this.currentBudget,
    }
  }

  renderBudgetWidget() {
    return this.getBudgetStatus().then(status => {
      const isOverBudget = status.isOverBudget
      const percentage = Math.min(100, status.percentage)
      const waterLevel = 100 - percentage

      return `
        <div class="bg-wabi-surface p-4 rounded-lg shadow-sm border border-wabi-border mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-wabi-primary">本月預算</h3>
            <button id="edit-budget-btn" class="text-wabi-accent hover:underline text-sm">
              ${status.budget > 0 ? '編輯' : '設定'}
            </button>
          </div>
          
          ${
            status.budget > 0
              ? `
            <div class="budget-wave-container">
              <div class="budget-wave" style="top: ${waterLevel}%;"></div>
              <div class="budget-info">
                  <div class="text-wabi-text-secondary text-sm">${isOverBudget ? '超出預算' : '剩餘預算'}</div>
                  <div class="font-bold text-3xl ${isOverBudget ? 'text-wabi-expense' : 'text-wabi-primary'}">
                    ${isOverBudget ? '-' : ''}${formatCurrency(Math.abs(status.remaining))}
                  </div>
                  <div class="text-xs text-wabi mt-1">${formatCurrency(status.spent)} / ${formatCurrency(status.budget)}</div>
              </div>
            </div>
            ${
              isOverBudget
                ? `
              <div class="mt-3 p-2 bg-wabi-expense/10 border border-wabi-expense/20 rounded text-center">
                <span class="text-wabi-expense text-sm">⚠️ 已超出預算 ${formatCurrency(status.spent - status.budget)}</span>
              </div>
            `
                : ''
            }
          `
              : `
            <div class="text-center py-8">
              <div class="text-4xl mb-3">💰</div>
              <p class="text-wabi-text-secondary mb-4">設定每月預算來追蹤支出</p>
              <button id="set-budget-btn" class="bg-wabi-accent hover:bg-wabi-accent/90 text-wabi-primary font-bold px-6 py-2 rounded-lg transition-colors">
                設定預算
              </button>
            </div>
          `
          }
        </div>
      `
    })
  }

  showBudgetModal() {
    // 確保每次只存在一個預算設定彈窗
    this.closeBudgetModal()

    const modal = document.createElement('div')
    modal.id = 'budget-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">設定每月預算</h3>
        
        <div class="mb-4">
          <label class="block text-sm font-medium text-wabi-text-primary mb-2">預算金額</label>
          <input type="number" id="budget-input" step="100" min="0" 
                 value="${this.currentBudget}" 
                 placeholder="輸入每月預算..."
                 class="w-full p-3 bg-transparent border border-wabi-border rounded-lg focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
        </div>
        
        <div class="text-sm text-wabi-text-secondary mb-6">
          <p>💡 建議設定合理的月支出預算，幫助您控制開銷</p>
        </div>
        
        <div class="flex space-x-3">
          <button id="save-budget-btn" class="flex-1 bg-wabi-accent hover:bg-wabi-accent/90 text-wabi-primary font-bold py-3 rounded-lg transition-colors">
            儲存
          </button>
          <button id="cancel-budget-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    // 事件監聽
    document
      .getElementById('save-budget-btn')
      .addEventListener('click', async () => {
        const amount = parseFloat(document.getElementById('budget-input').value)
        if (amount >= 0) {
          await this.saveBudget(amount)
          this.closeBudgetModal()
          if (window.app) {
            window.app.loadBudgetWidget()
          }
        }
      })

    document
      .getElementById('cancel-budget-btn')
      .addEventListener('click', () => {
        this.closeBudgetModal()
      })

    // 點擊背景關閉
    modal.addEventListener('click', e => {
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

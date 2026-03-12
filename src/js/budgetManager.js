// 預算管理模組
import { formatCurrency, getDateRange, showToast } from './utils.js'

export class BudgetManager {
  constructor(dataService) {
    this.dataService = dataService
    this.currentBudget = 0
    this.categoryBudgets = {}
  }

  async loadBudget() {
    try {
      if (this.dataService) {
        const budgetSettings = await this.dataService.getSetting('budget_settings');
        if (budgetSettings && budgetSettings.value) {
          const { monthlyBudget, categoryBudgets } = budgetSettings.value;
          this.currentBudget = monthlyBudget ? parseFloat(monthlyBudget) : 0;
          this.categoryBudgets = categoryBudgets || {};
          return;
        }
      }
      
      // Fallback to local storage
      const budget = localStorage.getItem('monthlyBudget')
      this.currentBudget = budget ? parseFloat(budget) : 0
      
      const categoryBudgetsRaw = localStorage.getItem('categoryBudgets')
      this.categoryBudgets = categoryBudgetsRaw ? JSON.parse(categoryBudgetsRaw) : {}
      
      // Migrate from local storage to IndexedDB
      if (this.dataService && (this.currentBudget > 0 || Object.keys(this.categoryBudgets).length > 0)) {
        await this.saveBudget(this.currentBudget, this.categoryBudgets);
      }
      
    } catch (error) {
      console.error('載入預算失敗:', error)
      this.currentBudget = 0
      this.categoryBudgets = {}
    }
  }

  async saveBudget(amount, categoryBudgets = null, skipLog = false) {
    try {
      this.currentBudget = amount
      if (categoryBudgets !== null) {
        this.categoryBudgets = categoryBudgets
      }
      
      // Update local storage as a quick backup
      localStorage.setItem('monthlyBudget', this.currentBudget.toString())
      localStorage.setItem('categoryBudgets', JSON.stringify(this.categoryBudgets))

      if (this.dataService) {
        const payload = { monthlyBudget: this.currentBudget, categoryBudgets: this.categoryBudgets };
        await this.dataService.saveSetting({ key: 'budget_settings', value: payload });
        
        if (!skipLog) {
          this.dataService.logChange('update', 'budget_settings', 'all', payload);
        }
      }
      return true
    } catch (error) {
      console.error('儲存預算失敗:', error)
      return false
    }
  }

  async getBudgetStatus() {
    const dateRange = getDateRange('month')
    // Budget should not include transfers, so offset them
    const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate, null, true);
    
    const spent = stats.totalExpense
    const remaining = Math.max(0, this.currentBudget - spent)
    const percentage = this.currentBudget > 0 ? (spent / this.currentBudget) * 100 : 0
    
    const categoryStatuses = [];
    for (const [categoryId, budgetAmount] of Object.entries(this.categoryBudgets)) {
      if (budgetAmount <= 0) continue;
      const catSpent = stats.expenseByCategory[categoryId] || 0;
      const catRemaining = Math.max(0, budgetAmount - catSpent);
      const catPercentage = budgetAmount > 0 ? (catSpent / budgetAmount) * 100 : 0;
      categoryStatuses.push({
        categoryId,
        name: window.app && window.app.categoryManager ? window.app.categoryManager.getCategoryById('expense', categoryId)?.name || categoryId : categoryId,
        icon: window.app && window.app.categoryManager ? window.app.categoryManager.getCategoryById('expense', categoryId)?.icon || '' : '',
        budget: budgetAmount,
        spent: catSpent,
        remaining: catRemaining,
        percentage: Math.min(100, catPercentage),
        isOverBudget: catSpent > budgetAmount
      });
    }

    // Sort category statuses by percentage descending (highest usage first)
    categoryStatuses.sort((a, b) => b.percentage - a.percentage);

    return {
      budget: this.currentBudget,
      spent: spent,
      remaining: remaining,
      percentage: Math.min(100, percentage),
      isOverBudget: spent > this.currentBudget,
      categoryStatuses: categoryStatuses
    }
  }

  renderBudgetWidget() {
    return this.getBudgetStatus().then(status => {
      const isOverBudget = status.isOverBudget;
      const percentage = Math.min(100, status.percentage);
      const waterLevel = 100 - percentage;

      return `
        <div class="bg-wabi-surface p-4 rounded-lg shadow-sm border border-wabi-border mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-wabi-primary">本月預算</h3>
            <button id="edit-budget-btn" class="text-wabi-accent hover:underline text-sm">
              ${status.budget > 0 ? '編輯' : '設定'}
            </button>
          </div>
          
          ${status.budget > 0 ? `
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
            ${isOverBudget ? `
              <div class="mt-3 p-2 bg-wabi-expense/10 border border-wabi-expense/20 rounded text-center">
                <span class="text-wabi-expense text-sm">⚠️ 已超出全局預算 ${formatCurrency(status.spent - status.budget)}</span>
              </div>
            ` : ''}
            
            ${status.categoryStatuses && status.categoryStatuses.length > 0 ? `
              <div class="mt-4 pt-3 border-t border-wabi-border/50">
                <div class="text-sm font-medium text-wabi-text-secondary mb-2">分類預算</div>
                <div class="space-y-3">
                  ${status.categoryStatuses.map(catStat => `
                    <div class="category-budget-item">
                      <div class="flex justify-between items-end mb-1">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <i class="${catStat.icon} text-wabi-text-secondary"></i>
                          <span class="text-sm text-wabi-text-primary truncate">${catStat.name}</span>
                        </div>
                        <div class="text-right flex-shrink-0">
                          <div class="text-sm font-medium ${catStat.isOverBudget ? 'text-wabi-expense' : 'text-wabi-text-primary'}">
                            ${formatCurrency(catStat.spent)} <span class="text-[0.65rem] text-wabi-text-secondary font-normal">/ ${formatCurrency(catStat.budget)}</span>
                          </div>
                        </div>
                      </div>
                      <div class="h-1.5 w-full bg-wabi-border/50 rounded-full overflow-hidden flex">
                        <div class="h-full rounded-full transition-all duration-500 ease-out ${catStat.isOverBudget ? 'bg-wabi-expense' : (catStat.percentage > 80 ? 'bg-wabi-expense/80' : 'bg-wabi-primary')}" style="width: ${catStat.percentage}%"></div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          ` : `
            <div class="text-center py-8">
              <div class="text-4xl mb-3">💰</div>
              <p class="text-wabi-text-secondary mb-4">設定每月預算來追蹤支出</p>
              <button id="set-budget-btn" class="bg-wabi-accent hover:bg-wabi-accent/90 text-wabi-primary font-bold px-6 py-2 rounded-lg transition-colors">
                設定預算
              </button>
            </div>
          `}
        </div>
      `
    })
  }

  showBudgetModal() {
    // 確保每次只存在一個預算設定彈窗
    this.closeBudgetModal()

    const modal = document.createElement('div')
    modal.id = 'budget-modal'
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    
    let categoryOptions = '<option value="" disabled selected>選擇分類...</option>';
    if (window.app && window.app.categoryManager) {
      const expenseCategories = window.app.categoryManager.getAllCategories('expense');
      categoryOptions += expenseCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto wabi-scrollbar">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">設定每月預算</h3>
        
        <div class="mb-5">
          <label class="block text-sm font-medium text-wabi-text-primary mb-2">全局預算金額</label>
          <input type="number" id="budget-input" step="100" min="0" 
                 value="${this.currentBudget}" 
                 placeholder="輸入每月預算..."
                 class="w-full p-3 bg-transparent border border-wabi-border rounded-lg focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
          <p class="text-xs text-wabi-text-secondary mt-1">💡 建議設定合理的月支出預算，幫助您控制開銷</p>
          <p id="budget-warning-msg" class="text-xs text-wabi-expense mt-2 hidden">⚠️ 分類預算總和已超過全局預算！</p>
        </div>

        <div class="mb-6 pt-4 border-t border-wabi-border">
          <div class="flex justify-between items-center mb-2">
            <label class="block text-sm font-medium text-wabi-text-primary">分類預算 (選填)</label>
            <button id="add-category-budget-btn" class="text-xs text-wabi-accent hover:underline flex items-center gap-1">
              <i class="fas fa-plus"></i> 新增分類預算
            </button>
          </div>
          
          <div id="category-budgets-list" class="space-y-3 mb-3">
            <!-- 分類預算列表會動態生成於此 -->
          </div>
        </div>
        
        <div class="flex space-x-3 mt-6">
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

    const categoryBudgetsList = modal.querySelector('#category-budgets-list');
    let workingCategoryBudgets = { ...this.categoryBudgets };

    const renderCategoryBudgetList = () => {
      categoryBudgetsList.innerHTML = '';
      const entries = Object.entries(workingCategoryBudgets);
      
      if (entries.length === 0) {
        categoryBudgetsList.innerHTML = '<div class="text-center text-sm text-wabi-text-secondary py-2">無設定分類預算</div>';
        return;
      }

      entries.forEach(([catId, amount]) => {
        let catName = catId;
        let catIcon = '';
        if (window.app && window.app.categoryManager) {
          const cat = window.app.categoryManager.getCategoryById('expense', catId);
          if (cat) {
            catName = cat.name;
            catIcon = cat.icon;
          }
        }

        const item = document.createElement('div');
        item.className = 'flex items-center gap-2 bg-wabi-surface p-2 rounded border border-wabi-border';
        item.innerHTML = `
          <div class="flex-shrink-0 w-6 text-center"><i class="${catIcon} text-wabi-text-secondary"></i></div>
          <div class="flex-1 text-sm truncate w-16 text-wabi-text-primary">${catName}</div>
          <div class="flex-col w-28">
            <input type="number" data-id="${catId}" value="${amount}" min="0" step="100" class="cat-budget-amt w-full bg-transparent border-b border-wabi-border focus:border-wabi-accent outline-none text-right px-1 py-1 text-sm text-wabi-text-primary">
          </div>
          <button class="remove-cat-budget text-wabi-border hover:text-wabi-expense p-1 rounded transition-colors" data-id="${catId}">
            <i class="fas fa-times"></i>
          </button>
        `;
        categoryBudgetsList.appendChild(item);
      });

      // Bind events for dynamically added elements
      categoryBudgetsList.querySelectorAll('.cat-budget-amt').forEach(el => {
        el.addEventListener('change', (e) => {
          const id = e.target.getAttribute('data-id');
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && val >= 0) {
            workingCategoryBudgets[id] = val;
            checkBudgetWarning();
          }
        });
      });

      categoryBudgetsList.querySelectorAll('.remove-cat-budget').forEach(el => {
        el.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          delete workingCategoryBudgets[id];
          renderCategoryBudgetList();
          checkBudgetWarning();
        });
      });
    };

    const checkBudgetWarning = () => {
        const budgetInput = document.getElementById('budget-input');
        const warningEl = document.getElementById('budget-warning-msg');
        if (!budgetInput || !warningEl) return;
        const budget = parseFloat(budgetInput.value) || 0;
        let totalCategoryBudget = 0;
        for (const amount of Object.values(workingCategoryBudgets)) {
            totalCategoryBudget += amount;
        }

        if (totalCategoryBudget > budget && budget > 0) {
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
    };

    // Add event listener to the main budget input to also trigger checking the warning
    modal.querySelector('#budget-input').addEventListener('input', checkBudgetWarning);

    renderCategoryBudgetList();

    // 新增分類預算邏輯
    modal.querySelector('#add-category-budget-btn').addEventListener('click', () => {
      const addRow = document.createElement('div');
      addRow.className = 'flex items-center gap-2 bg-wabi-surface p-2 rounded border border-wabi-border border-dashed';
      addRow.innerHTML = `
        <select class="flex-1 bg-transparent text-sm p-1 border-b border-wabi-border focus:border-wabi-accent outline-none text-wabi-text-primary cursor-pointer wabi-scrollbar">
          ${categoryOptions}
        </select>
        <button class="confirm-add-cat text-wabi-primary hover:text-wabi-accent p-1 transition-colors">
          <i class="fas fa-check"></i>
        </button>
        <button class="cancel-add-cat text-wabi-border hover:text-wabi-expense p-1 transition-colors">
          <i class="fas fa-times"></i>
        </button>
      `;
      categoryBudgetsList.appendChild(addRow);
      
      const selectEl = addRow.querySelector('select');
      
      addRow.querySelector('.confirm-add-cat').addEventListener('click', () => {
        const selectedId = selectEl.value;
        if (selectedId && !workingCategoryBudgets[selectedId] && workingCategoryBudgets[selectedId] !== 0) {
          workingCategoryBudgets[selectedId] = 0; // Default to 0, user will edit
          renderCategoryBudgetList();
        } else if (workingCategoryBudgets[selectedId] !== undefined) {
          renderCategoryBudgetList(); // Just re-render to discard
        }
      });
      
      addRow.querySelector('.cancel-add-cat').addEventListener('click', () => {
        renderCategoryBudgetList();
      });
    });
    
    // 事件監聽
    document.getElementById('save-budget-btn').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('budget-input').value)
      if (!isNaN(amount) && amount >= 0) {
        // Update any changed amounts that didn't trigger 'change' event yet
        let totalCategoryBudget = 0;
        categoryBudgetsList.querySelectorAll('.cat-budget-amt').forEach(el => {
          const id = el.getAttribute('data-id');
          const val = parseFloat(el.value);
          if (!isNaN(val) && val >= 0) {
            workingCategoryBudgets[id] = val;
          }
        });

        for (const amnt of Object.values(workingCategoryBudgets)) {
          totalCategoryBudget += amnt;
        }

        if (totalCategoryBudget > amount && amount > 0) {
          showToast('注意：分類預算總和已超過全局預算！', 'warning')
        } else {
          showToast('預算設定已儲存', 'success')
        }

        await this.saveBudget(amount, workingCategoryBudgets)
        this.closeBudgetModal()
        if (window.app) {
            window.app.loadBudgetWidget();
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
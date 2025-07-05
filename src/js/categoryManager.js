// 自定義分類管理模組
import { CATEGORIES } from './categories.js'

export class CategoryManager {
  constructor() {
    this.customCategories = this.loadCustomCategories()
  }

  loadCustomCategories() {
    try {
      const saved = localStorage.getItem('customCategories')
      return saved ? JSON.parse(saved) : { expense: [], income: [] }
    } catch (error) {
      console.error('載入自定義分類失敗:', error)
      return { expense: [], income: [] }
    }
  }

  saveCustomCategories() {
    try {
      localStorage.setItem('customCategories', JSON.stringify(this.customCategories))
      return true
    } catch (error) {
      console.error('儲存自定義分類失敗:', error)
      return false
    }
  }

  getAllCategories(type) {
    const defaultCategories = CATEGORIES[type] || []
    const customCategories = this.customCategories[type] || []
    return [...defaultCategories, ...customCategories]
  }

  addCustomCategory(type, category) {
    if (!this.customCategories[type]) {
      this.customCategories[type] = []
    }
    
    // 檢查是否已存在
    const exists = this.customCategories[type].some(cat => cat.id === category.id)
    if (exists) {
      return false
    }
    
    this.customCategories[type].push(category)
    return this.saveCustomCategories()
  }

  removeCustomCategory(type, categoryId) {
    if (!this.customCategories[type]) {
      return false
    }
    
    const index = this.customCategories[type].findIndex(cat => cat.id === categoryId)
    if (index === -1) {
      return false
    }
    
    this.customCategories[type].splice(index, 1)
    return this.saveCustomCategories()
  }

  isCustomCategory(type, categoryId) {
    return this.customCategories[type]?.some(cat => cat.id === categoryId) || false
  }

  showAddCategoryModal(type) {
    const modal = document.createElement('div')
    modal.id = 'add-category-modal'
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    
    const typeText = type === 'expense' ? '支出' : '收入'
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4">新增${typeText}分類</h3>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">分類名稱</label>
            <input type="text" id="category-name" maxlength="10" 
                   placeholder="輸入分類名稱..."
                   class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">選擇圖示</label>
            <div class="grid grid-cols-6 gap-3" id="icon-selector">
              ${this.getAvailableIcons().map(icon => `
                <button type="button" class="icon-option p-3 border border-gray-300 rounded-lg hover:border-primary hover:bg-blue-50 transition-colors text-xl" data-icon="${icon}">
                  <i class="${icon}"></i>
                </button>
              `).join('')}
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">選擇顏色</label>
            <div class="grid grid-cols-4 gap-3" id="color-selector">
              ${this.getAvailableColors().map(color => `
                <button type="button" class="color-option w-12 h-12 rounded-lg border-2 border-gray-300 hover:border-gray-500 transition-colors ${color}" data-color="${color}">
                </button>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="flex space-x-3 mt-6">
          <button id="save-category-btn" class="flex-1 bg-primary hover:bg-blue-600 text-white py-3 rounded-lg transition-colors">
            新增分類
          </button>
          <button id="cancel-category-btn" class="px-6 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(modal)
    
    let selectedIcon = ''
    let selectedColor = ''
    
    // 圖示選擇
    document.querySelectorAll('.icon-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.icon-option').forEach(b => {
          b.classList.remove('border-primary', 'bg-blue-50')
          b.classList.add('border-gray-300')
        })
        btn.classList.remove('border-gray-300')
        btn.classList.add('border-primary', 'bg-blue-50')
        selectedIcon = btn.dataset.icon
      })
    })
    
    // 顏色選擇
    document.querySelectorAll('.color-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-option').forEach(b => {
          b.classList.remove('border-gray-500')
          b.classList.add('border-gray-300')
        })
        btn.classList.remove('border-gray-300')
        btn.classList.add('border-gray-500')
        selectedColor = btn.dataset.color
      })
    })
    
    // 儲存分類
    document.getElementById('save-category-btn').addEventListener('click', () => {
      const name = document.getElementById('category-name').value.trim()
      
      if (!name) {
        alert('請輸入分類名稱')
        return
      }
      
      if (!selectedIcon) {
        alert('請選擇圖示')
        return
      }
      
      if (!selectedColor) {
        alert('請選擇顏色')
        return
      }
      
      const categoryId = 'custom_' + Date.now()
      const category = {
        id: categoryId,
        name: name,
        icon: selectedIcon,
        color: selectedColor,
        isCustom: true
      }
      
      if (this.addCustomCategory(type, category)) {
        this.closeAddCategoryModal()
        // 重新渲染分類
        if (window.app && window.app.renderCategories) {
          window.app.renderCategories()
        }
      } else {
        alert('新增分類失敗')
      }
    })
    
    // 取消按鈕
    document.getElementById('cancel-category-btn').addEventListener('click', () => {
      this.closeAddCategoryModal()
    })
    
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeAddCategoryModal()
      }
    })
    
    // 自動聚焦
    setTimeout(() => {
      document.getElementById('category-name').focus()
    }, 100)
  }

  closeAddCategoryModal() {
    const modal = document.getElementById('add-category-modal')
    if (modal) {
      modal.remove()
    }
  }

  getAvailableIcons() {
    return [
      'fas fa-pizza-slice', 'fas fa-coffee', 'fas fa-shopping-cart', 'fas fa-car',
      'fas fa-gas-pump', 'fas fa-film', 'fas fa-gamepad', 'fas fa-mobile-alt',
      'fas fa-pills', 'fas fa-hospital', 'fas fa-book', 'fas fa-pen',
      'fas fa-tshirt', 'fas fa-shoe-prints', 'fas fa-home', 'fas fa-lightbulb',
      'fas fa-tools', 'fas fa-bullseye', 'fas fa-palette', 'fas fa-music',
      'fas fa-camera', 'fas fa-plane', 'fas fa-umbrella-beach', 'fas fa-gift',
      'fas fa-money-bill-wave', 'fas fa-chart-line', 'fas fa-trophy', 'fas fa-star',
      'fas fa-heart', 'fas fa-fire', 'fas fa-bolt', 'fas fa-gem'
    ]
  }

  getAvailableColors() {
    return [
      'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
      'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500',
      'bg-teal-500', 'bg-cyan-500', 'bg-lime-500', 'bg-amber-500',
      'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-gray-500'
    ]
  }

  showManageCategoriesModal(type) {
    const modal = document.createElement('div')
    modal.id = 'manage-categories-modal'
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    
    const typeText = type === 'expense' ? '支出' : '收入'
    const customCategories = this.customCategories[type] || []
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-full p-6 max-h-96 overflow-y-auto">
        <h3 class="text-lg font-semibold mb-4">管理${typeText}分類</h3>
        
        ${customCategories.length > 0 ? `
          <div class="space-y-3 mb-6">
            ${customCategories.map(category => `
              <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div class="flex items-center space-x-3">
                  <span class="text-xl"><i class="${category.icon}"></i></span>
                  <span class="font-medium">${category.name}</span>
                </div>
                <button class="delete-category-btn text-red-500 hover:text-red-700 text-sm" data-category-id="${category.id}">
                  刪除
                </button>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="text-center py-8 text-gray-500">
            <div class="text-4xl mb-2">📝</div>
            <p>尚未新增自定義分類</p>
          </div>
        `}
        
        <div class="flex space-x-3">
          <button id="add-new-category-btn" class="flex-1 bg-primary hover:bg-blue-600 text-white py-3 rounded-lg transition-colors">
            新增分類
          </button>
          <button id="close-manage-btn" class="px-6 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg transition-colors">
            關閉
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(modal)
    
    // 刪除分類
    document.querySelectorAll('.delete-category-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const categoryId = btn.dataset.categoryId
        if (confirm('確定要刪除這個分類嗎？')) {
          if (this.removeCustomCategory(type, categoryId)) {
            this.closeManageCategoriesModal()
            this.showManageCategoriesModal(type) // 重新顯示
            // 重新渲染分類
            if (window.app && window.app.renderCategories) {
              window.app.renderCategories()
            }
          }
        }
      })
    })
    
    // 新增分類
    document.getElementById('add-new-category-btn').addEventListener('click', () => {
      this.closeManageCategoriesModal()
      this.showAddCategoryModal(type)
    })
    
    // 關閉按鈕
    document.getElementById('close-manage-btn').addEventListener('click', () => {
      this.closeManageCategoriesModal()
    })
    
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeManageCategoriesModal()
      }
    })
  }

  closeManageCategoriesModal() {
    const modal = document.getElementById('manage-categories-modal')
    if (modal) {
      modal.remove()
    }
  }
}
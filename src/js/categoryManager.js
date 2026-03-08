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
      localStorage.setItem(
        'customCategories',
        JSON.stringify(this.customCategories)
      )
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
    const exists = this.customCategories[type].some(
      cat => cat.id === category.id
    )
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

    const index = this.customCategories[type].findIndex(
      cat => cat.id === categoryId
    )
    if (index === -1) {
      return false
    }

    this.customCategories[type].splice(index, 1)
    return this.saveCustomCategories()
  }

  updateCustomCategory(type, updatedCategory) {
    if (!this.customCategories[type]) {
      return false
    }
    const index = this.customCategories[type].findIndex(
      cat => cat.id === updatedCategory.id
    )
    if (index === -1) {
      return false
    }
    this.customCategories[type][index] = updatedCategory
    return this.saveCustomCategories()
  }

  getCustomCategoryById(type, categoryId) {
    return (
      this.customCategories[type]?.find(cat => cat.id === categoryId) || null
    )
  }

  getCategoryById(type, categoryId) {
    const defaultCategory = CATEGORIES[type]?.find(cat => cat.id === categoryId)
    if (defaultCategory) return defaultCategory

    const customCategory = this.getCustomCategoryById(type, categoryId)
    if (customCategory) return customCategory

    // If not found in the specified type, check the other type as a fallback
    const otherType = type === 'expense' ? 'income' : 'expense'
    const fallbackDefault = CATEGORIES[otherType]?.find(
      cat => cat.id === categoryId
    )
    if (fallbackDefault) return fallbackDefault

    const fallbackCustom = this.getCustomCategoryById(otherType, categoryId)
    if (fallbackCustom) return fallbackCustom

    return null
  }

  isCustomCategory(type, categoryId) {
    return (
      this.customCategories[type]?.some(cat => cat.id === categoryId) || false
    )
  }

  showAddCategoryModal(type, categoryToEdit = null, onUpdateCallback = null) {
    const modal = document.createElement('div')
    modal.id = 'add-category-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    const typeText = type === 'expense' ? '支出' : '收入'

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full max-h-[90vh] flex flex-col">
        <div class="p-6 border-b border-wabi-border">
          <h3 class="text-lg font-semibold text-wabi-primary">${categoryToEdit ? '編輯' : '新增'}${typeText}分類</h3>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-wabi-text-primary mb-2">分類名稱</label>
            <input type="text" id="category-name" maxlength="10" 
                   placeholder="輸入分類名稱..."
                   value="${categoryToEdit ? categoryToEdit.name : ''}"
                   class="w-full p-3 bg-transparent border border-wabi-border rounded-lg focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
          </div>
          
          <div>
            <label class="block text-sm font-medium text-wabi-text-primary mb-2">選擇圖示</label>
            <div class="mb-3">
              <div class="flex items-center space-x-2 mb-2">
                <input type="text" id="custom-icon-input" 
                       placeholder="輸入 Font Awesome class (如: fas fa-heart)"
                       value="${categoryToEdit ? categoryToEdit.icon : ''}"
                       class="flex-1 p-2 text-sm bg-transparent border border-wabi-border rounded-lg focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
                <button type="button" id="preview-icon-btn" class="px-3 py-2 bg-gray-200/80 border border-wabi-border rounded-lg hover:bg-gray-300/80 transition-colors">
                  <span id="icon-preview" class="text-lg text-wabi-primary">
                    <i class="${categoryToEdit ? categoryToEdit.icon : 'fas fa-eye'}"></i>
                  </span>
                </button>
              </div>
            </div>
            <div class="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto border border-wabi-border rounded-lg p-3" id="icon-selector">
              ${this.getAvailableIcons()
                .map(
                  icon => `
                <button type="button" class="icon-option p-2 border border-wabi-border rounded-lg hover:border-wabi-primary hover:bg-wabi-primary/10 transition-colors text-lg text-wabi-text-secondary" data-icon="${icon}">
                  <i class="${icon}"></i>
                </button>
              `
                )
                .join('')}
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-wabi-text-primary mb-2">選擇顏色</label>
            <div class="grid grid-cols-6 gap-3" id="color-selector">
              ${this.getAvailableColors()
                .map(
                  color => `
                <button type="button" class="color-option w-10 h-10 rounded-lg border-2 border-transparent hover:border-wabi-primary transition-colors ${color}" data-color="${color}">
                </button>
              `
                )
                .join('')}
              <label for="custom-color-picker-input" id="custom-color-picker-label" class="w-10 h-10 rounded-lg border-2 border-dashed border-wabi-border flex items-center justify-center cursor-pointer hover:border-wabi-primary">
                <i class="fas fa-palette text-wabi-text-secondary text-xl"></i>
                <input type="color" id="custom-color-picker-input" class="absolute w-0 h-0 opacity-0" value="#888888">
              </label>
            </div>
          </div>
        </div>
        
        <div class="p-6 border-t border-wabi-border bg-wabi-bg/80 backdrop-blur-sm">
          <div class="flex space-x-3">
            <button id="save-category-btn" class="flex-1 bg-wabi-accent hover:bg-wabi-accent/90 text-wabi-primary font-bold py-3 rounded-lg transition-colors">
              ${categoryToEdit ? '儲存變更' : '新增分類'}
            </button>
            <button id="cancel-category-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
              取消
            </button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    let selectedIcon = categoryToEdit ? categoryToEdit.icon : ''
    let selectedColor = categoryToEdit ? categoryToEdit.color : ''

    // 自訂圖標輸入
    const customIconInput = document.getElementById('custom-icon-input')
    const previewIconBtn = document.getElementById('preview-icon-btn')
    const iconPreview = document.getElementById('icon-preview')

    // 圖標預覽功能
    const updateIconPreview = () => {
      const iconClass = customIconInput.value.trim()
      if (iconClass) {
        iconPreview.innerHTML = `<i class="${iconClass}"></i>`
        selectedIcon = iconClass
        // 清除預設圖標選擇
        document.querySelectorAll('.icon-option').forEach(b => {
          b.classList.remove('border-primary', 'bg-blue-50')
          b.classList.add('border-gray-300')
        })
      } else {
        iconPreview.innerHTML = `<i class="fas fa-eye"></i>`
      }
    }

    // 自訂圖標輸入事件
    customIconInput.addEventListener('input', updateIconPreview)
    customIconInput.addEventListener('keyup', updateIconPreview)

    // 預覽按鈕點擊
    previewIconBtn.addEventListener('click', updateIconPreview)

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
        // 更新自訂輸入框
        customIconInput.value = selectedIcon
        updateIconPreview()
      })
    })

    // 顏色選擇
    const colorOptions = document.querySelectorAll('.color-option')
    const customColorPickerInput = document.getElementById(
      'custom-color-picker-input'
    )
    const customColorPickerLabel = document.getElementById(
      'custom-color-picker-label'
    )

    const clearColorSelection = () => {
      colorOptions.forEach(b => {
        b.classList.remove('border-wabi-primary', 'ring-2', 'ring-wabi-accent')
        b.classList.add('border-transparent')
      })
      customColorPickerLabel.classList.remove(
        'border-wabi-primary',
        'ring-2',
        'ring-wabi-accent',
        'border-solid'
      )
      customColorPickerLabel.classList.add(
        'border-dashed',
        'border-wabi-border'
      )
      customColorPickerLabel.style.backgroundColor = 'transparent'
    }

    colorOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        clearColorSelection()
        btn.classList.add('border-wabi-primary', 'ring-2', 'ring-wabi-accent')
        selectedColor = btn.dataset.color
      })
    })

    customColorPickerInput.addEventListener('input', e => {
      clearColorSelection()
      customColorPickerLabel.classList.add(
        'border-wabi-primary',
        'ring-2',
        'ring-wabi-accent',
        'border-solid'
      )
      customColorPickerLabel.classList.remove(
        'border-dashed',
        'border-wabi-border'
      )
      customColorPickerLabel.style.backgroundColor = e.target.value
      selectedColor = e.target.value
    })

    // 初始狀態
    if (selectedColor) {
      if (selectedColor.startsWith('#')) {
        customColorPickerInput.value = selectedColor
        customColorPickerLabel.classList.add(
          'border-wabi-primary',
          'ring-2',
          'ring-wabi-accent',
          'border-solid'
        )
        customColorPickerLabel.classList.remove(
          'border-dashed',
          'border-wabi-border'
        )
        customColorPickerLabel.style.backgroundColor = selectedColor
      } else {
        const selectedBtn = document.querySelector(
          `.color-option[data-color="${selectedColor}"]`
        )
        if (selectedBtn) {
          selectedBtn.classList.add(
            'border-wabi-primary',
            'ring-2',
            'ring-wabi-accent'
          )
        }
      }
    }

    // 儲存分類
    document
      .getElementById('save-category-btn')
      .addEventListener('click', () => {
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

        const category = {
          id: categoryToEdit ? categoryToEdit.id : 'custom_' + Date.now(),
          name: name,
          icon: selectedIcon,
          color: selectedColor,
          isCustom: true,
        }

        let success = false
        if (categoryToEdit) {
          success = this.updateCustomCategory(type, category)
        } else {
          success = this.addCustomCategory(type, category)
        }

        if (success) {
          this.closeAddCategoryModal()
          if (onUpdateCallback) onUpdateCallback()
        } else {
          alert(categoryToEdit ? '更新分類失敗' : '新增分類失敗')
        }
      })

    // 取消按鈕
    document
      .getElementById('cancel-category-btn')
      .addEventListener('click', () => {
        this.closeAddCategoryModal()
      })

    // 點擊背景關閉
    modal.addEventListener('click', e => {
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
      'fas fa-pizza-slice',
      'fas fa-coffee',
      'fas fa-shopping-cart',
      'fas fa-car',
      'fas fa-gas-pump',
      'fas fa-film',
      'fas fa-gamepad',
      'fas fa-mobile-alt',
      'fas fa-pills',
      'fas fa-hospital',
      'fas fa-book',
      'fas fa-pen',
      'fas fa-tshirt',
      'fas fa-shoe-prints',
      'fas fa-home',
      'fas fa-lightbulb',
      'fas fa-tools',
      'fas fa-bullseye',
      'fas fa-palette',
      'fas fa-music',
      'fas fa-camera',
      'fas fa-plane',
      'fas fa-umbrella-beach',
      'fas fa-gift',
      'fas fa-money-bill-wave',
      'fas fa-chart-line',
      'fas fa-trophy',
      'fas fa-star',
      'fas fa-heart',
      'fas fa-fire',
      'fas fa-bolt',
      'fas fa-gem',
    ]
  }

  getAvailableColors() {
    return [
      'bg-slate-400',
      'bg-stone-400',
      'bg-red-400',
      'bg-orange-400',
      'bg-amber-400',
      'bg-yellow-400',
      'bg-lime-400',
      'bg-green-400',
      'bg-emerald-400',
      'bg-teal-400',
      'bg-cyan-400',
      'bg-sky-400',
      'bg-blue-400',
      'bg-indigo-400',
      'bg-violet-400',
      'bg-purple-400',
    ]
  }

  showManageCategoriesModal(type, onUpdateCallback = null) {
    const modal = document.createElement('div')
    modal.id = 'manage-categories-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    const typeText = type === 'expense' ? '支出' : '收入'
    const customCategories = this.customCategories[type] || []

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6 max-h-[80vh] flex flex-col">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">管理${typeText}分類</h3>
        
        <div class="flex-1 overflow-y-auto space-y-3 mb-6 pr-2">
        ${
          customCategories.length > 0
            ? `
            ${customCategories
              .map(category => {
                const colorStyle = category.color.startsWith('#')
                  ? `style="background-color: ${category.color}"`
                  : ''
                const colorClass = !category.color.startsWith('#')
                  ? category.color
                  : ''
                return `
              <div class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
                <div class="flex items-center space-x-3">
                  <div class="w-4 h-4 rounded-full ${colorClass}" ${colorStyle}></div>
                  <span class="text-xl text-wabi-text-primary"><i class="${category.icon}"></i></span>
                  <span class="font-medium text-wabi-text-primary">${category.name}</span>
                </div>
                <div class="flex space-x-3">
                  <button class="edit-category-btn text-wabi-accent hover:underline text-sm" data-category-id="${category.id}">
                    編輯
                  </button>
                  <button class="delete-category-btn text-wabi-expense hover:underline text-sm" data-category-id="${category.id}">
                    刪除
                  </button>
                </div>
              </div>
            `
              })
              .join('')}
        `
            : `
          <div class="text-center py-8 text-wabi-text-secondary">
            <i class="fa-regular fa-folder-open text-4xl mb-2"></i>
            <p>尚未新增自定義分類</p>
          </div>
        `
        }
        </div>
        
        <div class="flex space-x-3">
          <button id="add-new-category-btn" class="flex-1 bg-wabi-accent hover:bg-wabi-accent/90 text-wabi-primary font-bold py-3 rounded-lg transition-colors">
            新增分類
          </button>
          <button id="close-manage-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
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
            this.showManageCategoriesModal(type, onUpdateCallback) // Pass callback again
            if (onUpdateCallback) onUpdateCallback()
          }
        }
      })
    })

    // 編輯分類
    document.querySelectorAll('.edit-category-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const categoryId = btn.dataset.categoryId
        const categoryToEdit = this.getCustomCategoryById(type, categoryId)
        if (categoryToEdit) {
          this.closeManageCategoriesModal()
          this.showAddCategoryModal(type, categoryToEdit, onUpdateCallback) // Pass callback
        }
      })
    })

    // 新增分類
    document
      .getElementById('add-new-category-btn')
      .addEventListener('click', () => {
        this.closeManageCategoriesModal()
        this.showAddCategoryModal(type, null, onUpdateCallback) // Pass callback
      })

    // 關閉按鈕
    document
      .getElementById('close-manage-btn')
      .addEventListener('click', () => {
        this.closeManageCategoriesModal()
      })

    // 點擊背景關閉
    modal.addEventListener('click', e => {
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

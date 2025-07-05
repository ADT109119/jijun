// 工具函數模組

/**
 * 格式化貨幣顯示
 * @param {number} amount - 金額
 * @returns {string} 格式化後的貨幣字串
 */
export function formatCurrency(amount) {
  if (isNaN(amount)) return '0'
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount).replace('NT$', '$')
}

/**
 * 格式化日期顯示
 * @param {string|Date} date - 日期
 * @param {string} format - 格式類型 ('short', 'long', 'month-day')
 * @returns {string} 格式化後的日期字串
 */
export function formatDate(date, format = 'short') {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  
  switch (format) {
    case 'short':
      return dateObj.toLocaleDateString('zh-TW', {
        month: '2-digit',
        day: '2-digit'
      })
    case 'long':
      return dateObj.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    case 'month-day':
      return dateObj.toLocaleDateString('zh-TW', {
        month: 'short',
        day: 'numeric'
      })
    default:
      return dateObj.toLocaleDateString('zh-TW')
  }
}

/**
 * 顯示提示訊息
 * @param {string} message - 訊息內容
 * @param {string} type - 訊息類型 ('success', 'error', 'info')
 * @param {number} duration - 顯示時間（毫秒）
 */
export function showToast(message, type = 'info', duration = 3000) {
  // 移除現有的 toast
  const existingToast = document.getElementById('success-toast')
  if (existingToast) {
    existingToast.remove()
  }

  // 創建新的 toast
  const toast = document.createElement('div')
  toast.id = 'success-toast'
  toast.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg transition-opacity duration-300 z-50`
  
  // 根據類型設置樣式
  switch (type) {
    case 'success':
      toast.classList.add('bg-green-500', 'text-white')
      break
    case 'error':
      toast.classList.add('bg-red-500', 'text-white')
      break
    case 'info':
    default:
      toast.classList.add('bg-blue-500', 'text-white')
      break
  }
  
  toast.textContent = message
  document.body.appendChild(toast)

  // 顯示動畫
  setTimeout(() => {
    toast.classList.remove('opacity-0')
    toast.classList.add('opacity-100', 'success-show')
  }, 10)

  // 自動隱藏
  setTimeout(() => {
    toast.classList.remove('opacity-100')
    toast.classList.add('opacity-0')
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast)
      }
    }, 300)
  }, duration)
}

/**
 * 防抖函數
 * @param {Function} func - 要防抖的函數
 * @param {number} wait - 等待時間（毫秒）
 * @returns {Function} 防抖後的函數
 */
export function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * 節流函數
 * @param {Function} func - 要節流的函數
 * @param {number} limit - 時間限制（毫秒）
 * @returns {Function} 節流後的函數
 */
export function throttle(func, limit) {
  let inThrottle
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

/**
 * 深拷貝對象
 * @param {any} obj - 要拷貝的對象
 * @returns {any} 拷貝後的對象
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj.getTime())
  if (obj instanceof Array) return obj.map(item => deepClone(item))
  if (typeof obj === 'object') {
    const clonedObj = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
}

/**
 * 生成唯一 ID
 * @returns {string} 唯一 ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

/**
 * 驗證日期格式
 * @param {string} dateString - 日期字串
 * @returns {boolean} 是否為有效日期
 */
export function isValidDate(dateString) {
  const date = new Date(dateString)
  return date instanceof Date && !isNaN(date)
}

/**
 * 獲取日期範圍
 * @param {string} period - 期間類型 ('today', 'week', 'month', 'year')
 * @returns {object} 包含 startDate 和 endDate 的對象
 */
export function getDateRange(period) {
  const today = new Date()
  const startDate = new Date(today)
  const endDate = new Date(today)

  switch (period) {
    case 'today':
      // 今天
      break
    case 'week':
      // 本週
      startDate.setDate(today.getDate() - today.getDay())
      endDate.setDate(startDate.getDate() + 6)
      break
    case 'month':
      // 本月
      startDate.setDate(1)
      endDate.setMonth(endDate.getMonth() + 1, 0)
      break
    case 'year':
      // 今年
      startDate.setMonth(0, 1)
      endDate.setMonth(11, 31)
      break
    default:
      break
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0]
  }
}

/**
 * 計算兩個日期之間的天數
 * @param {string|Date} startDate - 開始日期
 * @param {string|Date} endDate - 結束日期
 * @returns {number} 天數差
 */
export function daysBetween(startDate, endDate) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end - start)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
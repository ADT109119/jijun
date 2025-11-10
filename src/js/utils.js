// 工具函數模組

/**
 * 格式化日期為 YYYY-MM-DD 格式（避免時區問題）
 * @param {Date} date - 日期對象
 * @returns {string} 格式化後的日期字串
 */
export function formatDateToString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    if (!toast || !toastMessage) {
        console.error('Toast elements not found in the DOM.');
        return;
    }

    // Set message
    toastMessage.textContent = message;

    // Reset classes
    toast.classList.remove('bg-wabi-income', 'bg-wabi-expense', 'bg-wabi-primary', 'toast-hide');

    // Apply new classes based on type
    switch (type) {
        case 'success':
            toast.classList.add('bg-wabi-income');
            break;
        case 'error':
            toast.classList.add('bg-wabi-expense');
            break;
        case 'info':
        default:
            toast.classList.add('bg-wabi-primary');
            break;
    }

    // Show toast
    toast.classList.add('toast-show');

    // Hide after duration
    setTimeout(() => {
        toast.classList.replace('toast-show', 'toast-hide');
    }, duration);
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
  
  switch (period) {
    case 'last7days':
      // 近七日
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 6) // 包含今天，所以是 -6
      return {
        startDate: formatDateToString(sevenDaysAgo),
        endDate: formatDateToString(today)
      }
    case 'lastmonth':
      // 上月
      const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
      return {
        startDate: formatDateToString(lastMonthStart),
        endDate: formatDateToString(lastMonthEnd)
      }
    case 'year':
      // 今年
      const yearStart = new Date(today.getFullYear(), 0, 1)
      const yearEnd = new Date(today.getFullYear(), 11, 31)
      return {
        startDate: formatDateToString(yearStart),
        endDate: formatDateToString(yearEnd)
      }
    case 'today':
      const todayStr = formatDateToString(today)
      return {
        startDate: todayStr,
        endDate: todayStr
      }
    case 'week':
      // 本週
      const startOfWeek = new Date(today)
      startOfWeek.setDate(today.getDate() - today.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      return {
        startDate: formatDateToString(startOfWeek),
        endDate: formatDateToString(endOfWeek)
      }
    case 'month':
      // 本月 - 使用年月直接構造，避免時區問題
      const year = today.getFullYear()
      const month = today.getMonth() + 1 // getMonth() 返回 0-11，需要 +1
      const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`
      
      // 計算本月最後一天
      const lastDay = new Date(year, month, 0).getDate() // month 參數這裡不用 +1，因為 Date 構造函數中 month 是 0-based
      const endOfMonth = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`
      
      return {
        startDate: startOfMonth,
        endDate: endOfMonth
      }
    case 'year':
      // 今年
      const currentYear = today.getFullYear()
      return {
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`
      }
    default:
      const defaultStr = formatDateToString(today)
      return {
        startDate: defaultStr,
        endDate: defaultStr
      }
  }
}

/**
 * 獲取指定年月的日期範圍
 * @param {number} year - 年份
 * @param {number} monthIndex - 月份 (0-11)
 * @returns {object} 包含 startDate 和 endDate 的對象
 */
export function getMonthRange(year, monthIndex) {
  const startOfMonth = new Date(year, monthIndex, 1);
  const endOfMonth = new Date(year, monthIndex + 1, 0);
  return {
    startDate: formatDateToString(startOfMonth),
    endDate: formatDateToString(endOfMonth)
  };
}

/**
 * 計算下一個週期性交易日期
 * @param {string} currentDueDate - 當前到期日期 (YYYY-MM-DD)
 * @param {string} frequency - 頻率 ('daily', 'weekly', 'monthly', 'yearly')
 * @param {number} interval - 間隔 (例如：每 2 週)
 * @returns {string} 下一個到期日期 (YYYY-MM-DD)
 */
export function calculateNextDueDate(currentDueDate, frequency, interval) {
  const date = new Date(currentDueDate);
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + interval);
      break;
    case 'weekly':
      date.setDate(date.getDate() + (interval * 7));
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + interval);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + interval);
      break;
    default:
      throw new Error('Invalid frequency');
  }
  return formatDateToString(date);
}

/**
 * 檢查日期是否應根據規則列表跳過
 * @param {Date} date - 要檢查的日期對象
 * @param {Array|null} skipRules - 略過規則對象的陣列
 * @returns {boolean} 如果應跳過則為 true
 */
export function shouldSkipDate(date, skipRules) {
  if (!skipRules || !Array.isArray(skipRules) || skipRules.length === 0) {
    return false;
  }

  for (const rule of skipRules) {
    if (!rule.values || rule.values.length === 0) {
      continue;
    }
    const { type, values } = rule;
    let match = false;
    switch (type) {
      case 'dayOfWeek':
        match = values.includes(date.getDay()); // 0 (Sun) to 6 (Sat)
        break;
      case 'dayOfMonth':
        match = values.includes(date.getDate()); // 1 to 31
        break;
      case 'monthOfYear':
        match = values.includes(date.getMonth()); // 0 (Jan) to 11 (Dec)
        break;
    }
    if (match) {
      return true; // If any rule matches, skip the date
    }
  }

  return false; // If no rules matched, do not skip
}
// 工具函數模組

/** 週期交易/攤提最大迭代次數上限 */
export const MAX_ITERATIONS = 365

// ── 圖示 class 安全白名單（#SEC04：全站渲染面共用的單一真相源）──────────
// 歷史資料（#CAT-SEC 入庫收口前建立）可能帶有 `"><img src=x onerror=...>`
// 之類的髒 icon，直接嵌入 `<i class="${icon}">` 即可逃脫 class 屬性注入 DOM。
// 凡將使用者可控的 icon 欄位嵌入 innerHTML 前，一律先過本白名單。
const SAFE_ICON_RE =
    /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/

/**
 * 判斷字串是否為安全的 FontAwesome 圖示 class（白名單）
 * @param {*} value 待驗證值
 * @returns {boolean}
 */
export function isSafeIconClass(value) {
    return typeof value === 'string' && SAFE_ICON_RE.test(value.trim())
}

/**
 * 取得可安全嵌入 innerHTML class 屬性的圖示字串；
 * 白名單外（含 null/undefined/非字串）一律退回 fallback。
 * @param {*} icon 待驗證圖示 class
 * @param {string} [fallback] 不安全時的替代圖示
 * @returns {string} 已 trim 的安全圖示 class
 */
export function getSafeIconClass(icon, fallback = 'fa-solid fa-question') {
    return isSafeIconClass(icon) ? icon.trim() : fallback
}

// ── 顏色值安全白名單（#SEC05：全站渲染面共用的單一真相源）──────────────
// 與 #SEC04 圖示白名單同根因：歷史分類/帳本資料（#CAT-SEC 入庫收口前建立）
// 可能帶有如 `#fff;background-image:url(evil)` 或 `"><img src=x onerror=...>`
// 之類的髒 color，直接嵌入 `style="background-color: ${color}"` 即可逃脫
// 屬性注入 CSS 規則或 DOM。凡將使用者可控的 color 欄位嵌入 innerHTML 前，
// 一律先過本白名單。
const SAFE_HEX_RE =
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// 非 hex 顏色走 Tailwind 背景 class（內建分類如 bg-blue-400）；同樣要白名單，
// 否則惡意值可從 class 屬性 breakout 注入任意屬性。
const SAFE_BG_CLASS_RE = /^bg-[a-z0-9-]+$/

/**
 * 判斷字串是否為安全的 hex 顏色值（3/4/6/8 位，白名單）
 * @param {*} value 待驗證值
 * @returns {boolean}
 */
export function isSafeHexColor(value) {
    return typeof value === 'string' && SAFE_HEX_RE.test(value)
}

/**
 * 判斷字串是否為安全的 Tailwind 背景 class（bg-* 白名單）
 * @param {*} value 待驗證值
 * @returns {boolean}
 */
export function isSafeBgClass(value) {
    return typeof value === 'string' && SAFE_BG_CLASS_RE.test(value)
}

/**
 * 取得可安全嵌入 innerHTML 的背景顏色描述（渲染面統一入口）。
 * 回傳 { style, className } 二擇一（皆字串，白名單外則皆空字串）：
 *   - 合法 hex（#rgb/#rgba/#rrggbb/#rrggbbaa）→ style = 'background-color: #xxx'
 *   - 合法 bg-* class → className = 'bg-xxx'
 *   - 髒值/null/非字串 → style 與 className 皆空字串（呼叫端不輸出對應屬性）
 * @param {*} color 待驗證顏色值（hex 或 Tailwind bg class）
 * @returns {{ style: string, className: string }}
 */
export function getSafeBgColorStyle(color) {
    if (isSafeHexColor(color)) {
        return { style: `background-color: ${color}`, className: '' }
    }
    if (isSafeBgClass(color)) {
        return { style: '', className: color }
    }
    return { style: '', className: '' }
}

/**
 * 取得可安全嵌入 style 屬性的 hex 顏色；白名單外退回 fallback（hex 字串）。
 * 適用於顏色系統固定為 hex 體系的欄位（如帳本主題色）。
 * @param {*} color 待驗證顏色值
 * @param {string} [fallback] 不安全時的替代 hex
 * @returns {string} 安全 hex 字串
 */
export function getSafeHexColor(color, fallback = '#334A52') {
    return isSafeHexColor(color) ? color : fallback
}

/**
 * 轉義 HTML 特殊字元，防止 XSS 攻擊
 * @param {string} str - 要轉義的字串
 * @returns {string} 轉義後的安全字串
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

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
/**
 * 關閉 Modal 並執行平滑退場動畫（淡出 + 下滑/縮小）
 * 在測試環境 (VITEST/NODE_ENV=test) 中同步移除 DOM 以確保單元測試可靠運作
 * @param {HTMLElement} modalElement - 外部背景 overlay 元素
 * @param {HTMLElement|null} [contentElement] - 內部卡片/面板 container 元素
 * @param {Function} [onComplete] - Modal 移除後的額外 callback
 */
export function closeModalWithAnimation(modalElement, contentElement, onComplete) {
    if (!modalElement || modalElement._isClosing) {
        if (typeof onComplete === 'function') onComplete()
        return
    }
    modalElement._isClosing = true

    const isTest = typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.VITEST)
    if (isTest) {
        if (modalElement.parentNode) modalElement.remove()
        if (typeof onComplete === 'function') onComplete()
        return
    }

    const card = contentElement || modalElement.querySelector('.animate-slide-up, .animate-modal-pop') || modalElement.firstElementChild
    modalElement.classList.remove('animate-fade-in')
    modalElement.classList.add('animate-fade-out')

    if (card) {
        if (card.classList.contains('animate-slide-up')) {
            card.classList.remove('animate-slide-up')
            card.classList.add('animate-slide-down')
        } else if (card.classList.contains('animate-modal-pop')) {
            card.classList.remove('animate-modal-pop')
            card.classList.add('animate-modal-pop-down')
        } else {
            card.classList.add('animate-slide-down')
        }
    }

    let cleanedUp = false
    const doCleanUp = () => {
        if (cleanedUp) return
        cleanedUp = true
        if (modalElement.parentNode) {
            modalElement.remove()
        }
        if (typeof onComplete === 'function') {
            onComplete()
        }
    }

    const timer = setTimeout(doCleanUp, 220)
    modalElement.addEventListener('animationend', e => {
        if (e.target === modalElement || e.target === card) {
            clearTimeout(timer)
            doCleanUp()
        }
    }, { once: true })
}

export function customConfirm(message, title = '提示') {
    return new Promise(resolve => {
        const modal = document.createElement('div')
        modal.className =
            'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in'
        modal.innerHTML = `
            <div class="bg-wabi-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-xl transform transition-all animate-modal-pop">
                <div class="p-6">
                    <h3 class="text-lg font-bold text-wabi-text-primary mb-2">${escapeHTML(title)}</h3>
                    <p class="text-wabi-text-secondary text-sm">${escapeHTML(message)}</p>
                </div>
                <div class="flex border-t border-wabi-border">
                    <button class="custom-confirm-cancel flex-1 py-3 text-wabi-text-secondary font-medium hover:bg-wabi-bg transition-colors border-r border-wabi-border">取消</button>
                    <button class="custom-confirm-ok flex-1 py-3 text-wabi-primary font-bold hover:bg-wabi-bg transition-colors">確定</button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const close = (res) => closeModalWithAnimation(modal, modal.firstElementChild, () => resolve(res))

        modal
            .querySelector('.custom-confirm-cancel')
            .addEventListener('click', () => close(false))

        modal
            .querySelector('.custom-confirm-ok')
            .addEventListener('click', () => close(true))
    })
}

export function customAlert(message, title = '提示') {
    return new Promise(resolve => {
        const modal = document.createElement('div')
        modal.className =
            'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in'
        modal.innerHTML = `
            <div class="bg-wabi-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-xl transform transition-all animate-modal-pop">
                <div class="p-6">
                    <h3 class="text-lg font-bold text-wabi-text-primary mb-2">${escapeHTML(title)}</h3>
                    <p class="text-wabi-text-secondary text-sm">${escapeHTML(message)}</p>
                </div>
                <div class="flex border-t border-wabi-border">
                    <button class="custom-alert-ok flex-1 py-3 text-wabi-primary font-bold hover:bg-wabi-bg transition-colors">確定</button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        modal
            .querySelector('.custom-alert-ok')
            .addEventListener('click', () => {
                closeModalWithAnimation(modal, modal.firstElementChild, resolve)
            })
    })
}

/**
 * 顯示帶有進度條、圖示與狀態說明的進度彈窗 (Progress Modal)
 * @param {string} [title='處理中'] - 彈窗標題
 * @param {string} [initialMessage='正在處理...'] - 初始步驟說明文字
 * @returns {{ update: (percent: number, message?: string) => void, close: (onComplete?: Function) => void }}
 */
export function showProgressModal(title = '處理中', initialMessage = '正在處理...') {
    const modal = document.createElement('div')
    modal.className =
        'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in'
    modal.innerHTML = `
        <div class="bg-wabi-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-xl transform transition-all animate-modal-pop p-6">
            <div class="flex items-center space-x-3 mb-4">
                <div class="w-10 h-10 rounded-full bg-wabi-primary/10 text-wabi-primary flex items-center justify-center flex-shrink-0">
                    <i class="fa-solid fa-spinner fa-spin text-lg"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="text-base font-bold text-wabi-text-primary truncate">${escapeHTML(title)}</h3>
                    <p class="text-xs text-wabi-text-secondary truncate progress-modal-message mt-0.5">${escapeHTML(initialMessage)}</p>
                </div>
                <span class="text-sm font-semibold text-wabi-primary progress-modal-percent flex-shrink-0">0%</span>
            </div>
            <div class="w-full bg-wabi-bg rounded-full h-2.5 overflow-hidden">
                <div class="progress-modal-bar bg-wabi-primary h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
        </div>
    `
    document.body.appendChild(modal)

    const messageEl = modal.querySelector('.progress-modal-message')
    const percentEl = modal.querySelector('.progress-modal-percent')
    const barEl = modal.querySelector('.progress-modal-bar')

    return {
        update(percent, message) {
            const clamped = Math.max(0, Math.min(100, Math.round(percent)))
            if (barEl) barEl.style.width = `${clamped}%`
            if (percentEl) percentEl.textContent = `${clamped}%`
            if (message && messageEl) messageEl.textContent = message
        },
        close(onComplete) {
            closeModalWithAnimation(modal, modal.firstElementChild, onComplete)
        },
    }
}

export function formatCurrency(amount) {
    if (isNaN(amount)) return '0'
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    })
        .format(amount)
        .replace('NT$', '$')
}

/**
 * 格式化日期顯示
 * @param {string|Date} date - 日期
 * @param {string} format - 格式類型 ('short', 'long', 'month-day')
 * @returns {string} 格式化後的日期字串
 */
export function formatDate(date, format = 'short') {
    let dateObj
    if (typeof date === 'string') {
        const parts = date.split('-')
        if (parts.length === 3) {
            dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
        } else {
            dateObj = new Date(date)
        }
    } else {
        dateObj = date
    }

    if (!dateObj || isNaN(dateObj.getTime())) {
        return typeof date === 'string' ? date : ''
    }

    const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
    const weekdayName = weekdays[dateObj.getDay()]

    switch (format) {
        case 'short':
            return dateObj.toLocaleDateString('zh-TW', {
                month: '2-digit',
                day: '2-digit',
            })
        case 'long':
            return dateObj.toLocaleDateString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            })
        case 'long-weekday':
        case 'long-with-weekday': {
            const formattedLong = dateObj.toLocaleDateString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            })
            return `${formattedLong} ${weekdayName}`
        }
        case 'weekday':
            return weekdayName
        case 'month-day':
            return dateObj.toLocaleDateString('zh-TW', {
                month: 'short',
                day: 'numeric',
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
    const toast = document.getElementById('toast')
    const toastMessage = document.getElementById('toast-message')

    if (!toast || !toastMessage) {
        console.error('Toast elements not found in the DOM.')
        return
    }

    // Set message
    toastMessage.textContent = message

    // Reset classes
    toast.classList.remove(
        'bg-wabi-income',
        'bg-wabi-expense',
        'bg-wabi-primary',
        'bg-yellow-500',
        'toast-hide',
        'text-wabi-surface'
    )

    // Apply new classes based on type
    switch (type) {
        case 'success':
            toast.classList.add('bg-wabi-income', 'text-wabi-surface')
            break
        case 'error':
            toast.classList.add('bg-wabi-expense', 'text-wabi-surface')
            break
        case 'warning':
            toast.classList.add('bg-yellow-500', 'text-wabi-surface')
            break
        case 'info':
        default:
            toast.classList.add('bg-wabi-primary', 'text-wabi-surface')
            break
    }

    // Show toast
    toast.classList.add('toast-show')

    // Hide after duration
    if (toast._hideTimeout) {
        clearTimeout(toast._hideTimeout)
    }
    toast._hideTimeout = setTimeout(() => {
        toast.classList.replace('toast-show', 'toast-hide')
        toast._hideTimeout = null
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
            setTimeout(() => (inThrottle = false), limit)
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
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
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
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
    }
    // Fallback：舊瀏覽器
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
 * @param {string} period - 期間類型 ('today', 'week', 'month', 'year', 'quarter', 'lastquarter', 'monthOffset')
 * @param {number} [offsetMonths] - 月份偏移（僅 'monthOffset' 使用，0 = 本月，1 = 下月...）
 * @returns {object} 包含 startDate 和 endDate 的對象
 */
export function getDateRange(period, offsetMonths = 0) {
    const today = new Date()

    switch (period) {
        case 'last7days': {
            // 近七日
            const sevenDaysAgo = new Date(today)
            sevenDaysAgo.setDate(today.getDate() - 6) // 包含今天，所以是 -6
            return {
                startDate: formatDateToString(sevenDaysAgo),
                endDate: formatDateToString(today),
            }
        }
        case 'last30days': {
            // 近三十日
            const thirtyDaysAgo = new Date(today)
            thirtyDaysAgo.setDate(today.getDate() - 29) // 包含今天，所以是 -29
            return {
                startDate: formatDateToString(thirtyDaysAgo),
                endDate: formatDateToString(today),
            }
        }
        case 'lastmonth': {
            // 上月
            const lastMonthStart = new Date(
                today.getFullYear(),
                today.getMonth() - 1,
                1
            )
            const lastMonthEnd = new Date(
                today.getFullYear(),
                today.getMonth(),
                0
            )
            return {
                startDate: formatDateToString(lastMonthStart),
                endDate: formatDateToString(lastMonthEnd),
            }
        }
        case 'year': {
            // 今年
            const yearStart = new Date(today.getFullYear(), 0, 1)
            const yearEnd = new Date(today.getFullYear(), 11, 31)
            return {
                startDate: formatDateToString(yearStart),
                endDate: formatDateToString(yearEnd),
            }
        }
        case 'quarter': {
            // 本季度
            const q = Math.floor(today.getMonth() / 3) // 0-3，對應 Q1-Q4
            const quarterStartMonth = q * 3
            const quarterStart = new Date(today.getFullYear(), quarterStartMonth, 1)
            const quarterEnd = new Date(today.getFullYear(), quarterStartMonth + 3, 0)
            return {
                startDate: formatDateToString(quarterStart),
                endDate: formatDateToString(quarterEnd),
            }
        }
        case 'lastquarter': {
            // 上季度（需正確處理跨年）
            const q = Math.floor(today.getMonth() / 3) // 0-3，對應 Q1-Q4
            let lastQuarterStartMonth = (q - 1) * 3
            let lastQuarterYear = today.getFullYear()
            if (q === 0) {
                // 目前是 Q1，上季度為去年 Q4
                lastQuarterStartMonth = 9 // 去年 10 月
                lastQuarterYear -= 1
            }
            const lastQuarterStart = new Date(
                lastQuarterYear,
                lastQuarterStartMonth,
                1
            )
            const lastQuarterEnd = new Date(
                lastQuarterYear,
                lastQuarterStartMonth + 3,
                0
            )
            return {
                startDate: formatDateToString(lastQuarterStart),
                endDate: formatDateToString(lastQuarterEnd),
            }
        }
        case 'today': {
            const todayStr = formatDateToString(today)
            return {
                startDate: todayStr,
                endDate: todayStr,
            }
        }
        case 'week': {
            // 本週
            const startOfWeek = new Date(today)
            startOfWeek.setDate(today.getDate() - today.getDay())
            const endOfWeek = new Date(startOfWeek)
            endOfWeek.setDate(startOfWeek.getDate() + 6)
            return {
                startDate: formatDateToString(startOfWeek),
                endDate: formatDateToString(endOfWeek),
            }
        }
        case 'month': {
            // 本月 - 使用年月直接構造，避免時區問題
            const year = today.getFullYear()
            const month = today.getMonth() + 1 // getMonth() 返回 0-11，需要 +1
            const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`

            // 計算本月最後一天
            const lastDay = new Date(year, month, 0).getDate() // month 參數這裡不用 +1，因為 Date 構造函數中 month 是 0-based
            const endOfMonth = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`

            return {
                startDate: startOfMonth,
                endDate: endOfMonth,
            }
        }
        case 'monthOffset': {
            // 指定月份偏移的完整月範圍（offset=0 為本月，跨年自動處理）
            const offset = Math.max(0, offsetMonths | 0)
            const offsetStart = new Date(
                today.getFullYear(),
                today.getMonth() + offset,
                1
            )
            const offsetEnd = new Date(
                offsetStart.getFullYear(),
                offsetStart.getMonth() + 1,
                0
            )
            return {
                startDate: formatDateToString(offsetStart),
                endDate: formatDateToString(offsetEnd),
            }
        }
        default: {
            const defaultStr = formatDateToString(today)
            return {
                startDate: defaultStr,
                endDate: defaultStr,
            }
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
    const startOfMonth = new Date(year, monthIndex, 1)
    const endOfMonth = new Date(year, monthIndex + 1, 0)
    return {
        startDate: formatDateToString(startOfMonth),
        endDate: formatDateToString(endOfMonth),
    }
}

/**
 * 將「每月幾日」收斂到指定年月的合法範圍（月底自動收斂）。
 *
 * 信用卡出帳日/繳款日可設 1-31，但並非每月都有 31 天（如 2 月遇 31 日）。
 * 若直接 new Date(year, month, 31) 會溢出到下個月（2026-02-31 → 3 月 3 日），
 * 造成帳單週期與期別錯亂、繳款日整整錯開一個月，自動扣繳隨之錯位。
 * 本函數把日期收斂到該月最後一天（2 月 31 日 → 2 月 28/29 日）。
 *
 * @param {number} year - 西元年
 * @param {number} monthIndex - 月份 (0-11)，與 Date 建構子一致
 * @param {number} day - 欲套用的每月日期 (1-31)
 * @param {number} fallbackDay - day 非 1-31 整數時的退回值（呼叫端傳各自預設）
 * @returns {number} 收斂後的合法日期 (1 ~ 該月天數)
 */
export function clampDayToMonth(year, monthIndex, day, fallbackDay = 1) {
    // 容忍數字字串（舊備份匯入的 statementDay/dueDay 可能為 "15" 字串，
    // 原 new Date() 語意本就會自動轉型，此處保持一致不误退 fallback）
    const numDay = typeof day === 'string' && day.trim() !== '' ? Number(day) : day
    const safeDay =
        Number.isInteger(numDay) && numDay >= 1 && numDay <= 31 ? numDay : fallbackDay
    const lastDay = new Date(year, monthIndex + 1, 0).getDate()
    return Math.min(safeDay, lastDay)
}

/**
 * anchorDay 防呆：僅接受 1-31 的整數（呼叫端可能傳入 undefined/舊資料髒值）
 * @param {*} value
 * @returns {boolean}
 */
function isValidAnchorDay(value) {
    const n =
        typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return Number.isInteger(n) && n >= 1 && n <= 31
}

/**
 * 解析 'YYYY-MM-DD' 為民用日期三段（month 為 1-12）。不合式回傳 null。
 *
 * #TZ-DUE：為什麼要自己解析而不走 `new Date(str)`——ES 規定「純日期字串
 * (YYYY-MM-DD)」一律依 **UTC** 中午前那一刻解析，但 `getFullYear/getMonth/
 * getDate` 讀的是**本地**時區。於 UTC 負時區（美加/歐洲冬令）讀回的是**前一天**：
 * `new Date('2024-01-01').getDate()` 在 America/New_York = 31。週期到期日因此
 * 整期倒退一天，每日頻更會卡在同期無限循環（見 #TZ-DUE 迴歸測試）。
 * 純整數解析完全脫離時區，也與 #EOM-E2 的「字串進、字串出」慣例一致。
 *
 * @param {*} value - 待解析值
 * @returns {{year:number, month:number, day:number}|null}
 */
function parseCivilDate(value) {
    if (typeof value !== 'string') return null
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (!m) return null
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return { year, month, day }
}

/**
 * 民用日期 → 自 1970-01-01 起的天數（Proleptic Gregorian，純整數、無時區）
 * 採 Howard Hinnant days_from_civil 演算法。
 * @param {number} y 西元年
 * @param {number} m 月 (1-12)
 * @param {number} d 日 (1-31)
 * @returns {number}
 */
function daysFromCivil(y, m, d) {
    const yy = y - (m <= 2 ? 1 : 0)
    const era = Math.floor(yy / 400)
    const yoe = yy - era * 400 // [0, 399]
    const doy =
        Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + (d - 1) // [0, 365]
    const doe =
        yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
    return era * 146097 + doe - 719468
}

/**
 * 自 1970-01-01 起的天數 → 民用日期（daysFromCivil 的反向，純整數、無時區）
 * @param {number} z 天數
 * @returns {{year:number, month:number, day:number}}
 */
function civilFromDays(z) {
    const zz = z + 719468
    const era = Math.floor(zz / 146097)
    const doe = zz - era * 146097 // [0, 146096]
    const yoe = Math.floor(
        (doe -
            Math.floor(doe / 1460) +
            Math.floor(doe / 36524) -
            Math.floor(doe / 146096)) /
            365
    ) // [0, 399]
    const y = yoe + era * 400
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
    const mp = Math.floor((5 * doy + 2) / 153) // [0, 11]
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1 // [1, 31]
    const month = mp + (mp < 10 ? 3 : -9) // [1, 12]
    return { year: y + (month <= 2 ? 1 : 0), month, day }
}

/**
 * 固定格式輸出 'YYYY-MM-DD'（不經 Date，避免任何時區正規化）
 * @param {{year:number, month:number, day:number}} c 民用日期
 * @returns {string}
 */
function formatCivilDate(c) {
    return `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`
}

/**
 * 計算下一個週期性交易日期
 *
 * 月底收斂（#EOM-E2，沿用 clampDayToMonth 的全站慣例）：月/年頻直接 setMonth /
 * setFullYear 遇月底溢出——1/31 + 1 月 → JS 正規化成 3/2、2/29 + 1 年 → 3/1。
 * 週期性交易（每月 31 日房租）會把整期紀錄生成在錯日期上且期別逐月漂移
 * （1/31 → 3/2 → 4/2 → ...）；分期計畫首期錯日后逐期迭代全部跟錯。
 * 修法：先記下原始「日」，月/年位移後收斂回該月月底（1/31 + 1 月 → 2/28）。
 * 呼叫端若持有原始起始日（週期交易 startDate / 分期 startDate），務必經
 * anchorDay 傳入：錨定原始日可讓月底收斂「可逆」——31 日房租在 2 月落在
 * 2/28、3 月回到 3/31，而非逐期迭代後永久漂到 28 日。
 * 日/週頻為純天數位移，無月底問題，維持原樣。
 *
 * @param {string} currentDueDate - 當前到期日期 (YYYY-MM-DD)
 * @param {string} frequency - 頻率 ('daily', 'weekly', 'monthly', 'yearly')
 * @param {number} interval - 間隔 (例如：每 2 週)
 * @param {number} [anchorDay=null] - 月/年頻錨定日（原始起始日的「日」）；
 *   省略時退回 currentDueDate 自身的日（單步呼叫語意不變）
 * @returns {string} 下一個到期日期 (YYYY-MM-DD)
 */
export function calculateNextDueDate(
    currentDueDate,
    frequency,
    interval,
    anchorDay = null
) {
    const step = Number(interval)
    // #TZ-DUE 配套防呆：interval 缺失/0/負值一律明確拒絕。舊實作會把 0 變成
    // 「到期日永不前進」，讓 processRecurringTransactions 的 while 迴圈原地打轉到
    // MAX_ITERATIONS、該筆週期交易永久凍結（與時區讀回前一天是同類失效模式）；
    // 間隔 0 無正當語意，fail-fast 讓上層 per-tx try/catch 跳過並留下警訊，
    // 優於 silently 凍結或寫出 NaN 日期污染資料。
    if (!Number.isInteger(step) || step < 1) {
        throw new Error('Invalid interval')
    }
    // #TZ-DUE：改走「字串解析 + 純整數日曆天數」，不再經 `new Date(字串)`。
    // 舊實作 `new Date('2024-01-01')` 依 ES 規格以 UTC 解析，但取得式讀本地時區，
    // UTC 負時區會整天讀回前一天 → 到期日倒退一天、每日頻卡在同期無限循環。
    const civil = parseCivilDate(currentDueDate)
    if (!civil) {
        // null/undefined 不得淪為 epoch 1970（`new Date(null)` 的 JS 語意陷阱會讓
        // 到期日無聲變成 1970 年並在 while 迴圈生成一批 1970 紀錄，屬資料污染）
        if (currentDueDate === null || currentDueDate === undefined) {
            throw new Error('Invalid currentDueDate')
        }
        // 非 'YYYY-MM-DD'（Date 物件、'2024/1/5'、ISO 時間戳等）正規化後遞迴走純整數路徑
        const date = new Date(currentDueDate)
        if (Number.isNaN(date.getTime())) {
            throw new Error('Invalid currentDueDate')
        }
        return calculateNextDueDate(
            formatDateToString(date),
            frequency,
            interval,
            anchorDay
        )
    }
    // 月/年頻錨定日：合法則優先採用呼叫端的原始起始日，否則退回本日期自身的日
    const anchor = isValidAnchorDay(anchorDay) ? anchorDay : civil.day

    switch (frequency) {
        case 'daily':
            return formatCivilDate(
                civilFromDays(
                    daysFromCivil(civil.year, civil.month, civil.day) + step
                )
            )
        case 'weekly':
            return formatCivilDate(
                civilFromDays(
                    daysFromCivil(civil.year, civil.month, civil.day) + step * 7
                )
            )
        case 'monthly': {
            // 月底收斂：以月序算出目標年月後，依錨定日收斂到該月月底
            const totalMonths = civil.year * 12 + (civil.month - 1) + step
            const year = Math.floor(totalMonths / 12)
            const month = (totalMonths % 12) + 1
            return formatCivilDate({
                year,
                month,
                day: clampDayToMonth(year, month - 1, anchor, anchor),
            })
        }
        case 'yearly': {
            const year = civil.year + step
            return formatCivilDate({
                year,
                month: civil.month,
                day: clampDayToMonth(year, civil.month - 1, anchor, anchor),
            })
        }
        default:
            throw new Error('Invalid frequency')
    }
}

/**
 * 依「已完成的期數」推算分期/攤提計畫的進度快照（還原用）
 *
 * 借鏡 MOZE v4.3「起始期數」：使用者中途開始記錄時（例如已還 5 期的分期才開始
 * 用 jijun），填起始已完成期數即可從目前這一期開始記，前面的期數不用補記。
 * 本函數依起始期數推算：下期到期日、每期金額、含息剩餘應還總額。
 *
 * 語意對齊 processAmortizations()：
 * - nextDueDate = 從 startDate 起的第 (completed+1) 期到期日（與逐期
 *   calculateNextDueDate 迭代等價，月頻月末自動收斂）
 * - exactTotalRemaining = 含息總額 − 前 completed 期「四捨五入後每期金額」累計，
 *   下限 0（與末期差額分支的 actualPaidSoFar 算法一致）
 *
 * @param {object} plan - { totalAmount, downPayment, interestRate, periods, frequency, decimalStrategy, startDate, completedPeriods }
 * @returns {object|null} { nextDueDate, amountPerPeriod, exactTotalRemaining }；startDate 缺失回傳 null
 */
export function calculateAmortizationProgress(plan) {
    const startDate = plan.startDate
    if (!startDate) return null

    const periods = parseInt(plan.periods) || 0
    const completed = Math.min(
        Math.max(parseInt(plan.completedPeriods) || 0, 0),
        periods
    )
    const frequency = plan.frequency || 'monthly'
    const principal = Math.max(
        0,
        (parseFloat(plan.totalAmount) || 0) - (parseFloat(plan.downPayment) || 0)
    )

    const { amountPerPeriod, exactTotalToPay } = calculateAmortizationDetails(
        principal,
        periods,
        parseFloat(plan.interestRate) || 0,
        frequency,
        plan.decimalStrategy || 'round'
    )

    // 下期到期日 = 第 completed+1 期。#EOM-E2：錨定起始日的「日」逐期收斂
    // （1/31 起每月一期：2 月落 2/28、3 月回 3/31），與 processAmortizations
    // 的 amortAnchorDay 迭代語意一致。
    const startAnchorDay = parseInt(String(startDate).slice(8, 10), 10)
    let nextDueDate = startDate
    for (let i = 0; i < completed; i++) {
        nextDueDate = calculateNextDueDate(
            nextDueDate,
            frequency,
            1,
            Number.isInteger(startAnchorDay) ? startAnchorDay : null
        )
    }

    // 剩餘含息總額 = 含息總額 − 已還 completed 期（每期為四捨五入後的實際入帳額）
    const exactTotalRemaining = Math.max(
        0,
        exactTotalToPay - amountPerPeriod * completed
    )

    return { nextDueDate, amountPerPeriod, exactTotalRemaining }
}

/**
 * 檢查日期是否應根據規則列表跳過
 * @param {Date} date - 要檢查的日期對象
 * @param {Array|null} skipRules - 略過規則對象的陣列
 * @returns {boolean} 如果應跳過則為 true
 */
export function shouldSkipDate(date, skipRules) {
    if (!skipRules || !Array.isArray(skipRules) || skipRules.length === 0) {
        return false
    }

    let dateObj = date
    if (typeof date === 'string') {
        const parts = date.split('-').map(Number)
        if (parts.length === 3 && !parts.some(isNaN)) {
            dateObj = new Date(parts[0], parts[1] - 1, parts[2])
        } else {
            dateObj = new Date(date)
        }
    } else if (date instanceof Date && isNaN(date.getTime())) {
        return false
    }

    for (const rule of skipRules) {
        if (!rule.values || rule.values.length === 0) {
            continue
        }
        const { type, values } = rule
        let match = false
        switch (type) {
            case 'dayOfWeek':
                match = values.includes(dateObj.getDay()) // 0 (Sun) to 6 (Sat)
                break
            case 'dayOfMonth':
                match = values.includes(dateObj.getDate()) // 1 to 31
                break
            case 'monthOfYear':
                match = values.includes(dateObj.getMonth()) // 0 (Jan) to 11 (Dec)
                break
        }
        if (match) {
            return true // If any rule matches, skip the date
        }
    }

    return false // If no rules matched, do not skip
}

/**
 * 計算攤提/分期/折舊的每期金額與理論總額
 * @param {number} principal - 本金 (總額 - 首付)
 * @param {number} periods - 總期數
 * @param {number} annualRate - 年利率 (百分比，例如 3.5 = 3.5%)
 * @param {string} frequency - 扣款頻率 ('monthly', 'weekly', 'yearly')
 * @param {string} decimalStrategy - 小數點處理 ('round', 'ceil', 'floor', 'keep')
 * @returns {object} { amountPerPeriod, exactTotalToPay }
 */
export function calculateAmortizationDetails(
    principal,
    periods,
    annualRate,
    frequency,
    decimalStrategy = 'round'
) {
    if (principal <= 0 || periods <= 0) {
        return { amountPerPeriod: 0, exactTotalToPay: 0 }
    }

    let exactPMT
    let exactTotalToPay

    if (annualRate > 0) {
        let periodRate = annualRate / 100 / 12
        if (frequency === 'weekly') periodRate = annualRate / 100 / 52
        else if (frequency === 'yearly') periodRate = annualRate / 100

        exactPMT =
            (principal * (periodRate * Math.pow(1 + periodRate, periods))) /
            (Math.pow(1 + periodRate, periods) - 1)
        exactTotalToPay = exactPMT * periods
    } else {
        exactPMT = principal / periods
        exactTotalToPay = principal
    }

    let amountPerPeriod
    if (decimalStrategy === 'ceil') amountPerPeriod = Math.ceil(exactPMT)
    else if (decimalStrategy === 'floor') amountPerPeriod = Math.floor(exactPMT)
    else if (decimalStrategy === 'round') amountPerPeriod = Math.round(exactPMT)
    else amountPerPeriod = Math.round(exactPMT * 100) / 100

    return { amountPerPeriod, exactTotalToPay }
}

/**
 * 取得商店資源的完整 URL (Capacitor App 轉向遠端網址，避免本地端檔案過大)
 * @param {string} path - 商店資源的相對路徑
 * @returns {string} 完整的 URL 路徑
 */
export function getStoreUrl(path) {
    const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    // __WEB_STORE_URL__ is injected by Vite Define
    // @ts-ignore
    const baseUrl = isNative ? __WEB_STORE_URL__ : '';
    const separator = path.startsWith('/') ? '' : '/';
    return `${baseUrl}${separator}${path}`;
}

/**
 * 判斷是否為還款、收回欠款、卡費平帳或群組結清等「資金移轉/平帳性質」之紀錄
 * 此類紀錄非實質日常消費或日常收入，在生活收支統計中應排除或計算為 0。
 * @param {Object} record
 * @returns {boolean}
 */
export function isDebtSettlementRecord(record) {
    if (!record) return false
    const cat = record.category
    return (
        cat === 'debt_collection' ||
        cat === 'debt_repayment' ||
        cat === 'balance_adjustment'
    )
}

/**
 * 建立全向欠款快取表，支援 debt.id、debt.uuid、debt.recordId、debt.recordUuid
 * @param {Array} allDebts
 * @returns {Object} { byId, byUuid, byRecordId, byRecordUuid }
 */
export function buildDebtLookupMaps(allDebts) {
    const byId = Object.create(null)
    const byUuid = Object.create(null)
    const byRecordId = Object.create(null)
    const byRecordUuid = Object.create(null)

    if (!Array.isArray(allDebts)) {
        return { byId, byUuid, byRecordId, byRecordUuid }
    }

    for (const d of allDebts) {
        if (!d) continue
        if (d.id !== undefined && d.id !== null) {
            byId[d.id] = d
            byId[String(d.id)] = d
        }
        if (d.uuid) {
            byUuid[d.uuid] = d
            byId[d.uuid] = d
        }
        if (d.recordId !== undefined && d.recordId !== null) {
            byRecordId[d.recordId] = d
            byRecordId[String(d.recordId)] = d
        }
        if (d.recordUuid) {
            byRecordUuid[d.recordUuid] = d
        }
    }

    return { byId, byUuid, byRecordId, byRecordUuid }
}

/**
 * 智慧匹配紀錄對應的欠款物件 (雙向外鍵 + UUID)
 * @param {Object} record
 * @param {Object} debtMaps
 * @returns {Object|null}
 */
export function findDebtForRecord(record, debtMaps) {
    if (!record || !debtMaps) return null
    const { byId, byUuid, byRecordId, byRecordUuid } = debtMaps
    return (
        (record.debtId && (byId[record.debtId] || byId[String(record.debtId)])) ||
        (record.debtUuid && byUuid[record.debtUuid]) ||
        (record.id && (byRecordId[record.id] || byRecordId[String(record.id)])) ||
        (record.uuid && byRecordUuid[record.uuid]) ||
        null
    )
}

/**
 * 計算一筆紀錄在收支統計 / 報表中的實質生活收支金額 (Effective Amount)
 *
 * 核心會計與統計原則：
 * 1. 還款/收回/平帳紀錄 (isDebtSettlementRecord)：
 *    非實質生活收支，計算為 0。
 * 2. 群組結清 (options.isGroupSettled 或 record.groupStatus === 'settled')：
 *    成員間已結算還款，代墊實質支出歸零 (計算為 0)。
 * 3. 代墊支出 (record.type === 'expense' 且 debt.type === 'receivable'，別人欠我)：
 *    - 未還款：全額計入支出 (代墊時資金已流出)。
 *    - 部分還款：代墊金額扣除已還款部分，實質支出 = 自負消費額 + 剩餘代墊款 (remainingDebt)。
 *    - 全額還清 (settled)：代墊款全額歸零！實質支出 = 自負消費額 (myExpense = Math.max(0, record.amount - originalDebt))。
 * 4. 借款與償還 (debt.type === 'payable'，我欠別人)：
 *    - 借入款項非日常收入，還款非日常生活消費，在生活收支統計中皆計算為 0。
 * 5. 強健相容性：
 *    - 全面辨識 settled、status === 'settled'、isSettled、settledAt、remainingAmount <= 0、amount <= 0 等結清狀態。
 *    - 若缺少 originalAmount 且 debt.amount 已歸零/扣減，智慧依 record.amount 與 payments 推算 originalDebt。
 *
 * @param {Object} record - 記帳紀錄
 * @param {Object|null} debt - 關聯的欠款物件
 * @param {Object} [options] - 選項，例如 { isGroupSettled: boolean }
 * @returns {number} 實質收支金額 (>= 0)
 */
export function calculateEffectiveRecordAmount(record, debt, options = {}) {
    if (!record || typeof record.amount !== 'number') {
        return record?.amount || 0
    }

    // 1. 還款、收款或平帳紀錄在生活收支中直接歸零
    if (isDebtSettlementRecord(record)) {
        return 0
    }

    // 2. 群組已結清項目：群組成員已個別或全部結清還款，若無專屬 debt 則代墊實質支出歸零
    const isGroupSettled =
        record.groupStatus === 'settled' ||
        options.isGroupSettled === true
    if (isGroupSettled && !debt) {
        return 0
    }

    if (!debt) {
        return record.amount
    }

    // 3. 智慧推算已還金額
    const paidFromPayments = Array.isArray(debt.payments)
        ? debt.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
        : 0

    // 4. 智慧推算原始欠款額 originalDebt
    let originalDebt = Number(
        debt.originalAmount ??
        (paidFromPayments > 0 ? (Number(debt.amount || 0) + paidFromPayments) : null) ??
        debt.amount ??
        0
    )
    if (originalDebt <= 0 && record.amount > 0) {
        originalDebt = Number(record.amount)
    }

    // 5. 強化結清狀態判斷
    const isSettled =
        debt.settled === true ||
        debt.status === 'settled' ||
        debt.isSettled === true ||
        Boolean(debt.settledAt) ||
        isGroupSettled ||
        (debt.remainingAmount !== undefined && Number(debt.remainingAmount) <= 0) ||
        (debt.amount !== undefined && Number(debt.amount) <= 0 && (debt.remainingAmount === undefined || Number(debt.remainingAmount) <= 0)) ||
        (originalDebt > 0 && paidFromPayments >= originalDebt)

    // 6. 計算剩餘欠款
    let remainingDebt = isSettled
        ? 0
        : Number(
              debt.remainingAmount ??
              Math.max(0, originalDebt - paidFromPayments)
          )
    if (remainingDebt < 0) remainingDebt = 0

    const isReceivable = debt.type === 'receivable' // 別人欠我 (代墊)

    if (record.type === 'expense') {
        if (isReceivable) {
            // 代墊支出：自負額 + 尚未還清之代墊款
            // 若代墊款已全額還清 (settled)，代墊支出全額歸零；若為合資墊付，精確保留自負額
            const myExpense = Math.max(0, record.amount - originalDebt)
            return myExpense + remainingDebt
        } else {
            // 我欠別人 (借款支出)：已結清時計全額支出；未結清時計已還金額
            const paidDebt = Math.max(0, originalDebt - remainingDebt)
            return isSettled ? record.amount : paidDebt
        }
    } else if (record.type === 'income') {
        if (isReceivable) {
            // 別人欠我而產生的收入紀錄：已回收金額 (已結清時計全額收入，未結清時計已收金額)
            const paidDebt = Math.max(0, originalDebt - remainingDebt)
            return isSettled ? record.amount : paidDebt
        } else {
            // 我欠別人 (先收了別人的錢)：還清後不計入收入，部分還款則扣除已還部分
            const paidDebt = Math.max(0, originalDebt - remainingDebt)
            const effectiveIncome = Math.max(0, record.amount - paidDebt)
            return isSettled ? 0 : effectiveIncome
        }
    }

    return record.amount
}



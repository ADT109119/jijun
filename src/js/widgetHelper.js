import { formatDateToString, formatCurrency } from './utils.js'

/**
 * 重新整理並更新 Android Widget 上的統計資料
 * @param {DataService} dataService
 * @param {BudgetManager} budgetManager
 * @param {Object} [calendarData] - 行事曆 Widget 資料 (可選)
 */
export async function updateAndroidWidget(dataService, budgetManager, calendarData) {
    if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.isNativePlatform()) {
        return
    }

    // 增加安全防護：防範資料庫尚未初始化完成時被呼叫
    if (!dataService || !dataService.db) {
        console.warn('DataService DB is not initialized yet. Skipping widget update.');
        return
    }

    try {
        // 1. 計算今日支出 (使用本地時區日期)
        const today = formatDateToString(new Date())
        const records = await dataService.getRecords() // 預設已過濾 active ledger
        const todayExpense = records
            .filter(r => r.date === today && r.type === 'expense')
            .reduce((sum, r) => sum + r.amount, 0)

        // 2. 計算本月結餘
        const now = new Date()
        const currentYear = now.getFullYear()
        const currentMonth = now.getMonth() // 0-11
        
        // 獲取本月紀錄
        const startOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`
        const lastDay = new Date(currentYear, currentMonth + 1, 0)
        const endOfMonth = formatDateToString(lastDay)
        const monthRecords = records.filter(r => r.date >= startOfMonth && r.date <= endOfMonth)
        
        const income = monthRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0)
        const expense = monthRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0)
        const monthBalance = income - expense

        // 3. 計算本月預算進度與分類預算狀態
        let progressVal = 0
        let progressText = '無預算限制'
        let catBudgetStatusText = ''
        
        await budgetManager.loadBudget()
        const budgetStatus = await budgetManager.getBudgetStatus()
        if (budgetStatus && budgetStatus.budget > 0) {
            progressVal = Math.min(Math.round(budgetStatus.percentage), 100)
            progressText = `預算已使用: ${progressVal}% (${budgetStatus.spent}/${budgetStatus.budget})`
            
            // 尋找分類預算狀態
            if (budgetStatus.categoryStatuses && budgetStatus.categoryStatuses.length > 0) {
                const overBudgets = budgetStatus.categoryStatuses.filter(c => c.isOverBudget && !c.isExcluded)
                if (overBudgets.length > 0) {
                    const topOver = overBudgets.sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget))[0]
                    catBudgetStatusText = `⚠️ ${topOver.name}已超支 ${formatCurrency(Math.round(topOver.spent - topOver.budget))}`
                } else {
                    const activeCats = budgetStatus.categoryStatuses.filter(c => c.percentage > 0 && !c.isExcluded)
                    if (activeCats.length > 0) {
                        const topUsage = activeCats.sort((a, b) => b.percentage - a.percentage)[0]
                        catBudgetStatusText = `📊 ${topUsage.name}已使用 ${Math.round(topUsage.percentage)}%`
                    }
                }
            }
        }

        // 4. 格式化結餘：正數顯示 "+$350"，負數顯示 "-$350"
        const balanceSign = monthBalance >= 0 ? '+' : '-'
        const balanceText = `${balanceSign}${formatCurrency(Math.abs(monthBalance))}`

        // 5. 延遲導入 Capacitor 的 registerPlugin，避免在 Web 平臺 import 時出錯
        const { registerPlugin } = await import('@capacitor/core')
        const WidgetStorage = registerPlugin('WidgetStorage')

        const carrierCode = localStorage.getItem('invoice_carrier_code') || ''

        // 6. 組裝傳入物件 (包含行事曆資料)
        const payload = {
            todayExpense: formatCurrency(todayExpense),
            monthBalance: balanceText,
            budgetProgressText: progressText,
            budgetProgressVal: progressVal,
            categoryBudgetStatus: catBudgetStatusText,
            carrierCode: carrierCode
        }

        // 行事曆 Widget 資料
        if (calendarData) {
            Object.assign(payload, {
                calendarDays: calendarData.days || '',
                calendarMonthLabel: calendarData.monthLabel || '',
                calendarToday: calendarData.today || '',
                calendarWeekdayStart: calendarData.weekdayStart || 1
            })
        }

        // 7. 直接將欄位攤平傳入，避免巢狀 getObject 解析失敗
        await WidgetStorage.updateWidgetData(payload)
        console.log('[Widget] Data synchronized:', { todayExpense, monthBalance, progressVal, catBudgetStatusText, carrierCode, hasCalendar: !!calendarData })
    } catch (e) {
        console.error('[Widget] Failed to update Android Widget data:', e)
    }
}

/**
 * 從 CalendarCashFlow 實例產生 Widget 同步用的行事曆資料
 * @param {CalendarCashFlow} calendarInstance
 * @returns {Object | null}
 */
export function extractCalendarWidgetData(calendarInstance) {
    if (!calendarInstance || !calendarInstance._grouped || !calendarInstance.records) {
        return null
    }

    const grouped = calendarInstance._grouped
    const records = calendarInstance.records
    const currentDate = calendarInstance.currentDate
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    const todayDate = new Date()
    const todayDay = todayDate.getDate()

    // 產生月份標籤
    const monthLabel = `${year} 年 ${month} 月`

    // 計算每筆日期是否有收入/支出
    const dayFlags = {}
    for (const [dateKey, dayRecords] of Object.entries(grouped)) {
        const hasIncome = dayRecords.some(r => r.type === 'income')
        const hasExpense = dayRecords.some(r => r.type === 'expense')
        // 從 YYYY-MM-DD 提取日期
        const dayNum = parseInt(dateKey.split('-')[2], 10)
        dayFlags[dayNum] = {
            hasIncome: hasIncome ? 1 : 0,
            hasExpense: hasExpense ? 1 : 0
        }
    }

    // 產生 days 字符串: "1,0,0|2,1,0|..."
    const lastDayOfMonth = new Date(year, month, 0).getDate()
    const daysEntries = []
    for (let d = 1; d <= lastDayOfMonth; d++) {
        const flag = dayFlags[d] || { hasIncome: 0, hasExpense: 0 }
        daysEntries.push(`${d},${flag.hasIncome},${flag.hasExpense}`)
    }
    const daysStr = daysEntries.join('|')

    // 判斷這個月的第一天是星期幾 (0=Sun, 1=Mon, ..., 6=Sat)
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

    return {
        days: daysStr,
        monthLabel,
        today: String(todayDay),
        weekdayStart: firstDayOfWeek
    }
}

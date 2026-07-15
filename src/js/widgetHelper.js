import { formatDateToString } from './utils.js'

/**
 * 重新整理並更新 Android Widget 上的統計資料
 * @param {DataService} dataService
 * @param {CategoryManager} categoryManager
 * @param {BudgetManager} budgetManager
 */
export async function updateAndroidWidget(dataService, categoryManager, budgetManager) {
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
                    catBudgetStatusText = `⚠️ ${topOver.name}已超支 $${Math.round(topOver.spent - topOver.budget)}`
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
        const balanceText = `${balanceSign}$${Math.abs(monthBalance)}`

        // 5. 延遲導入 Capacitor 的 registerPlugin，避免在 Web 平台 import 時出錯
        const { registerPlugin } = await import('@capacitor/core')
        const WidgetStorage = registerPlugin('WidgetStorage')

        const carrierCode = localStorage.getItem('invoice_carrier_code') || ''

        // 6. 直接將欄位攤平傳入，避免巢狀 getObject 解析失敗
        await WidgetStorage.updateWidgetData({
            todayExpense: `$${todayExpense}`,
            monthBalance: balanceText,
            budgetProgressText: progressText,
            budgetProgressVal: progressVal,
            categoryBudgetStatus: catBudgetStatusText,
            carrierCode: carrierCode
        })
        console.log('[Widget] Data synchronized:', { todayExpense, monthBalance, progressVal, catBudgetStatusText, carrierCode })
    } catch (e) {
        console.error('[Widget] Failed to update Android Widget data:', e)
    }
}

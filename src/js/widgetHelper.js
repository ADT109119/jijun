import { formatDateToString } from './utils.js'

export async function updateAndroidWidget(dataService, categoryManager, budgetManager) {
    if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.isNativePlatform()) {
        return
    }

    if (!dataService || !dataService.db) {
        console.warn('DataService DB is not initialized yet. Skipping widget update.')
        return
    }

    let todayExpense = 0
    let balanceText = '$0'
    let progressVal = 0
    let progressText = '無預算限制'
    let catBudgetStatusText = ''
    let carrierCode = ''

    // Block 1: Today expense & month balance
    try {
        const today = formatDateToString(new Date())
        const records = await dataService.getRecords()
        todayExpense = records
            .filter(r => r.date === today && r.type === 'expense')
            .reduce((sum, r) => sum + r.amount, 0)

        const now = new Date()
        const currentYear = now.getFullYear()
        const currentMonth = now.getMonth()
        const startOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`
        const lastDay = new Date(currentYear, currentMonth + 1, 0)
        const endOfMonth = formatDateToString(lastDay)
        const monthRecords = records.filter(r => r.date >= startOfMonth && r.date <= endOfMonth)

        const income = monthRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0)
        const expense = monthRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0)
        const monthBalance = income - expense
        const balanceSign = monthBalance >= 0 ? '+' : '-'
        balanceText = `${balanceSign}$${Math.abs(monthBalance)}`
    } catch (e) {
        console.warn('[Widget] Failed to calculate today/month stats:', e)
    }

    // Block 2: Budget progress
    try {
        await budgetManager.loadBudget()
        const budgetStatus = await budgetManager.getBudgetStatus()
        if (budgetStatus && budgetStatus.budget > 0) {
            progressVal = Math.min(Math.round(budgetStatus.percentage), 100)
            progressText = `預算已使用: ${progressVal}% (${budgetStatus.spent}/${budgetStatus.budget})`
        }
    } catch (e) {
        console.warn('[Widget] Failed to calculate budget progress:', e)
    }

    // Block 3: Category budget status
    try {
        const budgetStatus = await budgetManager.getBudgetStatus()
        if (budgetStatus && budgetStatus.categoryStatuses && budgetStatus.categoryStatuses.length > 0) {
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
    } catch (e) {
        console.warn('[Widget] Failed to calculate category budget status:', e)
    }

    // Block 4: Send to native (always)
    try {
        const { registerPlugin } = await import('@capacitor/core')
        const WidgetStorage = registerPlugin('WidgetStorage')
        carrierCode = localStorage.getItem('invoice_carrier_code') || ''

        await WidgetStorage.updateWidgetData({
            todayExpense: `$${todayExpense}`,
            monthBalance: balanceText,
            budgetProgressText: progressText,
            budgetProgressVal: progressVal,
            categoryBudgetStatus: catBudgetStatusText,
            carrierCode: carrierCode,
        })
        console.log('[Widget] Data synchronized:', { todayExpense, balanceText, progressVal, catBudgetStatusText, carrierCode })
    } catch (e) {
        console.error('[Widget] Failed to update Android Widget data:', e)
    }
}

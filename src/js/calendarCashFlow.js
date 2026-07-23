import { formatCurrency, escapeHTML } from './utils.js'

export class CalendarCashFlow {
    constructor(dataService, categoryManager, container) {
        this.dataService = dataService
        this.categoryManager = categoryManager
        this.container = container
        this.currentDate = new Date()
        this.records = []
    }

    async render() {
        if (!this.container) return

        const year = this.currentDate.getFullYear()
        const month = this.currentDate.getMonth() + 1

        // Fetch records for the entire month
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`
        const lastDay = this.getDaysInMonth(year, month)
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

        try {
            const rawRecords = await this.dataService.getRecords({ startDate, endDate })
            // Filter out debt collection, debt repayment, balance adjustment if needed (or keep all records per data model)
            // Let's filter out internal transfers / balance adjustments like stats does, or keep them. Task description:
            // "Records have: date (YYYY-MM-DD), type ('income'|'expense'), amount (number), category (string), description (string)"
            // "Use dataService.getRecords({ startDate, endDate }) to fetch data"
            this.records = rawRecords.filter(
                r =>
                    r.category !== 'debt_collection' &&
                    r.category !== 'debt_repayment' &&
                    r.category !== 'balance_adjustment'
            )
        } catch (e) {
            console.error('Failed to fetch records for calendar:', e)
            this.records = []
        }

        const grouped = this.groupByDate(this.records)

        // Calculate daily max for heatmap opacity scaling
        let dailyMax = 0
        for (const dateStr in grouped) {
            const dayRecs = grouped[dateStr]
            const net = dayRecs.reduce((sum, r) => {
                return r.type === 'income' ? sum + r.amount : sum - r.amount
            }, 0)
            const absNet = Math.abs(net)
            if (absNet > dailyMax) dailyMax = absNet
        }
        if (dailyMax === 0) dailyMax = 1

        // Month summary
        let totalIncome = 0
        let totalExpense = 0
        let spendingDaysSet = new Set()
        for (const r of this.records) {
            if (r.type === 'income') {
                totalIncome += r.amount
            } else if (r.type === 'expense') {
                totalExpense += r.amount
                spendingDaysSet.add(r.date)
            }
        }
        const netBalance = totalIncome - totalExpense
        const totalDaysInMonth = lastDay
        const spendingDaysCount = spendingDaysSet.size
        const emptyDaysCount = totalDaysInMonth - spendingDaysCount

        // First day of month and days count
        const firstDayOfWeek = this.getFirstDayOfMonth(year, month) // 0=Sun, 1=Mon...
        const daysCount = lastDay

        const todayStr = new Date().toISOString().split('T')[0]

        // Build calendar grid HTML
        let gridHTML = ''
        // Weekday headers: 日 一 二 三 四 五 六
        const weekdays = ['日', '一', '二', '三', '四', '五', '六']
        for (const wd of weekdays) {
            gridHTML += `<div class="text-center font-bold text-xs text-wabi-text-secondary py-2">${wd}</div>`
        }

        // Empty cells for padding before first day
        for (let i = 0; i < firstDayOfWeek; i++) {
            gridHTML += `<div class="aspect-square bg-wabi-bg/30 rounded-xl opacity-30"></div>`
        }

        // Days of month
        for (let day = 1; day <= daysCount; day++) {
            const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayRecords = grouped[dayStr] || []
            gridHTML += this.renderCell(year, month, day, dayRecords, dailyMax, todayStr)
        }

        this.container.innerHTML = `
            <!-- Month Selector -->
            <div class="flex items-center justify-between bg-wabi-surface rounded-2xl p-4 shadow-sm border border-wabi-border mb-6">
                <button id="cal-prev-btn" class="size-10 flex items-center justify-center rounded-xl bg-wabi-bg hover:bg-wabi-accent/10 text-wabi-text-primary transition-colors">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="text-base font-bold text-wabi-primary">
                    ${year} 年 ${month} 月
                </div>
                <button id="cal-next-btn" class="size-10 flex items-center justify-center rounded-xl bg-wabi-bg hover:bg-wabi-accent/10 text-wabi-text-primary transition-colors">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>

            <!-- Calendar Grid -->
            <div class="bg-wabi-surface rounded-2xl p-4 shadow-sm border border-wabi-border mb-6">
                <div class="grid grid-cols-7 gap-1.5 sm:gap-2">
                    ${gridHTML}
                </div>
            </div>

            <!-- Month Summary Card -->
            <div class="bg-wabi-surface rounded-2xl p-4 sm:p-6 shadow-sm border border-wabi-border mb-6">
                <h3 class="text-sm font-bold text-wabi-primary mb-4 flex items-center gap-2">
                    <i class="fa-solid fa-chart-pie text-wabi-accent"></i> ${year} 年 ${month} 月總結
                </h3>
                <div class="grid grid-cols-3 gap-3 mb-4">
                    <div class="bg-wabi-bg p-3 rounded-xl">
                        <p class="text-xs text-wabi-text-secondary mb-1">總收入</p>
                        <p class="text-sm sm:text-base font-bold text-wabi-income truncate">${formatCurrency(totalIncome)}</p>
                    </div>
                    <div class="bg-wabi-bg p-3 rounded-xl">
                        <p class="text-xs text-wabi-text-secondary mb-1">總支出</p>
                        <p class="text-sm sm:text-base font-bold text-wabi-expense truncate">${formatCurrency(totalExpense)}</p>
                    </div>
                    <div class="bg-wabi-bg p-3 rounded-xl">
                        <p class="text-xs text-wabi-text-secondary mb-1">結餘</p>
                        <p class="text-sm sm:text-base font-bold ${netBalance >= 0 ? 'text-wabi-income' : 'text-wabi-expense'} truncate">${formatCurrency(netBalance)}</p>
                    </div>
                </div>
                <div class="flex items-center justify-between text-xs text-wabi-text-secondary px-1">
                    <span>消費天數：<strong class="text-wabi-primary">${spendingDaysCount} 天</strong></span>
                    <span>空白天數：<strong class="text-wabi-primary">${emptyDaysCount} 天</strong></span>
                </div>
            </div>

            <!-- Day Details Modal Container -->
            <div id="cal-modal-container"></div>
        `

        this.setupEventListeners()
    }

    setupEventListeners() {
        const prevBtn = this.container.querySelector('#cal-prev-btn')
        const nextBtn = this.container.querySelector('#cal-next-btn')

        if (prevBtn) {
            prevBtn.onclick = () => this.changeMonth(-1)
        }
        if (nextBtn) {
            nextBtn.onclick = () => this.changeMonth(1)
        }

        // Cell click events
        this.container.querySelectorAll('.calendar-cell').forEach(cell => {
            cell.onclick = () => {
                const dateStr = cell.dataset.date
                const dayRecords = this.groupByDate(this.records)[dateStr] || []
                this.showDayDetails(dateStr, dayRecords)
            }
        })
    }

    async changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta)
        await this.render()
    }

    getFirstDayOfMonth(year, month) {
        return new Date(year, month - 1, 1).getDay()
    }

    getDaysInMonth(year, month) {
        return new Date(year, month, 0).getDate()
    }

    groupByDate(records) {
        const grouped = {}
        for (const r of records) {
            if (!r.date) continue
            if (!grouped[r.date]) {
                grouped[r.date] = []
            }
            grouped[r.date].push(r)
        }
        return grouped
    }

    renderCell(year, month, day, dayRecords, dailyMax, todayStr) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const isToday = dayStr === todayStr

        let incomeSum = 0
        let expenseSum = 0
        for (const r of dayRecords) {
            if (r.type === 'income') incomeSum += r.amount
            if (r.type === 'expense') expenseSum += r.amount
        }
        const net = incomeSum - expenseSum

        // Background color opacity level (0 to 4)
        let bgClass = 'bg-wabi-surface hover:bg-wabi-bg/60'
        if (dayRecords.length > 0) {
            const absNet = Math.abs(net)
            const ratio = Math.min(absNet / dailyMax, 1)
            let opacity = 'opacity-20'
            if (ratio > 0.75) opacity = 'opacity-60'
            else if (ratio > 0.4) opacity = 'opacity-40'
            else if (ratio > 0.15) opacity = 'opacity-30'

            const isNetExpense = net < 0 || (net === 0 && expenseSum > incomeSum)
            const colorBg = isNetExpense ? 'bg-wabi-expense' : 'bg-wabi-income'
            bgClass = `${colorBg} ${opacity} hover:opacity-90`
        }

        const ringClass = isToday ? 'ring-2 ring-wabi-accent shadow-sm' : 'border border-wabi-border/60'

        let contentHTML = '<span class="text-wabi-text-secondary/40 text-[10px]">—</span>'
        if (dayRecords.length > 0) {
            let inner = ''
            if (incomeSum > 0) {
                inner += `<div class="text-[10px] sm:text-xs font-bold text-wabi-income truncate">+${incomeSum}</div>`
            }
            if (expenseSum > 0) {
                inner += `<div class="text-[10px] sm:text-xs font-bold text-wabi-expense truncate">-${expenseSum}</div>`
            }
            contentHTML = inner
        }

        return `
            <div data-date="${dayStr}" class="calendar-cell aspect-square rounded-xl p-1.5 sm:p-2 flex flex-col justify-between cursor-pointer transition-all ${bgClass} ${ringClass}">
                <div class="flex items-center justify-between">
                    <span class="text-xs sm:text-sm font-bold ${isToday ? 'text-wabi-accent bg-wabi-accent/10 px-1.5 py-0.5 rounded-md' : 'text-wabi-text-primary'}">${day}</span>
                    ${dayRecords.length > 0 ? `<span class="size-1.5 rounded-full ${net >= 0 ? 'bg-wabi-income' : 'bg-wabi-expense'}"></span>` : ''}
                </div>
                <div class="flex flex-col justify-end overflow-hidden">
                    ${contentHTML}
                </div>
            </div>
        `
    }

    showDayDetails(dateStr, records) {
        const modalContainer = this.container.querySelector('#cal-modal-container')
        if (!modalContainer) return

        const [y, m, d] = dateStr.split('-')
        const formattedDateTitle = `${y} 年 ${parseInt(m, 10)} 月 ${parseInt(d, 10)} 日`

        let totalIncome = 0
        let totalExpense = 0

        let recordsHTML = ''
        if (records.length === 0) {
            recordsHTML = `
                <div class="text-center py-8 text-wabi-text-secondary text-sm">
                    <i class="fa-solid fa-receipt text-2xl mb-2 opacity-40"></i>
                    <p>當日無記帳紀錄</p>
                </div>
            `
        } else {
            recordsHTML = records
                .map(r => {
                    if (r.type === 'income') totalIncome += r.amount
                    else totalExpense += r.amount

                    const isInc = r.type === 'income'
                    const sign = isInc ? '+' : '-'
                    const colorClass = isInc ? 'text-wabi-income' : 'text-wabi-expense'

                    // Get category icon if categoryManager available
                    let icon = '💰'
                    if (this.categoryManager && typeof this.categoryManager.getCategoryIcon === 'function') {
                        icon = this.categoryManager.getCategoryIcon(r.category) || (isInc ? '💰' : '🛒')
                    }

                    const desc = r.description ? `(${r.description})` : ''

                    return `
                        <div class="flex items-center justify-between py-3 border-b border-wabi-border/60 last:border-none">
                            <div class="flex items-center gap-3 overflow-hidden">
                                <span class="text-lg size-9 flex items-center justify-center rounded-xl bg-wabi-bg shrink-0">${escapeHTML(icon)}</span>
                                <div class="overflow-hidden">
                                    <p class="text-sm font-bold text-wabi-text-primary truncate">${escapeHTML(r.category)}</p>
                                    ${r.description ? `<p class="text-xs text-wabi-text-secondary truncate">${escapeHTML(r.description)}</p>` : ''}
                                </div>
                            </div>
                            <span class="text-sm font-bold ${colorClass} shrink-0">${sign}${formatCurrency(r.amount).replace('$', '')}</span>
                        </div>
                    `
                })
                .join('')
        }

        const net = totalIncome - totalExpense
        const netSign = net >= 0 ? '+' : '-'
        const netColor = net >= 0 ? 'text-wabi-income' : 'text-wabi-expense'

        modalContainer.innerHTML = `
            <div id="cal-details-modal" class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-xs animate-fade-in">
                <div class="bg-wabi-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up">
                    <div class="flex items-center justify-between p-4 border-b border-wabi-border bg-wabi-bg/50">
                        <h3 class="text-base font-bold text-wabi-primary flex items-center gap-2">
                            <i class="fa-solid fa-calendar-day text-wabi-accent"></i> ${escapeHTML(formattedDateTitle)}
                        </h3>
                        <button id="cal-modal-close" class="size-8 flex items-center justify-center rounded-full hover:bg-wabi-border/40 text-wabi-text-secondary transition-colors">
                            <i class="fa-solid fa-xmark text-lg"></i>
                        </button>
                    </div>
                    <div class="p-4 overflow-y-auto flex-1 divide-y divide-wabi-border/20">
                        ${recordsHTML}
                    </div>
                    ${records.length > 0 ? `
                        <div class="p-4 bg-wabi-bg border-t border-wabi-border flex items-center justify-between">
                            <span class="text-xs font-medium text-wabi-text-secondary">當日淨收支</span>
                            <span class="text-base font-bold ${netColor}">${netSign}${formatCurrency(Math.abs(net))}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `

        const modal = modalContainer.querySelector('#cal-details-modal')
        const closeBtn = modalContainer.querySelector('#cal-modal-close')

        const closeModal = () => {
            if (modal) modal.remove()
        }

        if (closeBtn) closeBtn.onclick = closeModal
        if (modal) {
            modal.onclick = e => {
                if (e.target === modal) closeModal()
            }
        }
    }

    destroy() {
        // Cleanup if necessary
    }
}

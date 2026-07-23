import { formatCurrency, escapeHTML, formatDateToString } from './utils.js'

export class CalendarCashFlow {
    constructor(dataService, categoryManager, container) {
        this.dataService = dataService
        this.categoryManager = categoryManager
        this.container = container
        this.currentDate = new Date()
        this.records = []
        this._grouped = null
        this._prevHandler = null
        this._nextHandler = null
        this._cellHandler = null
        this._todayHandler = null
    }

    async render() {
        if (!this.container) return

        const year = this.currentDate.getFullYear()
        const month = this.currentDate.getMonth() + 1

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`
        const lastDay = this.getDaysInMonth(year, month)
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

        try {
            const rawRecords = await this.dataService.getRecords({ startDate, endDate })
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

        this._grouped = this.groupByDate(this.records)
        const grouped = this._grouped

        let totalIncome = 0
        let totalExpense = 0
        for (const r of this.records) {
            if (r.type === 'income') totalIncome += r.amount
            else if (r.type === 'expense') totalExpense += r.amount
        }
        const netBalance = totalIncome - totalExpense

        const firstDayOfWeek = this.getFirstDayOfMonth(year, month)
        const todayStr = formatDateToString(new Date())

        // Build grid
        let gridHTML = ''
        const weekdays = ['日', '一', '二', '三', '四', '五', '六']
        for (const wd of weekdays) {
            gridHTML += `<div class="text-center text-[11px] font-semibold text-wabi-text-secondary uppercase tracking-wider py-1.5">${wd}</div>`
        }

        for (let i = 0; i < firstDayOfWeek; i++) {
            gridHTML += `<div></div>`
        }

        for (let day = 1; day <= lastDay; day++) {
            const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayRecords = grouped[dayStr] || []
            gridHTML += this.renderCell(year, month, day, dayRecords, todayStr)
        }

        this.container.innerHTML = `
            <div class="bg-wabi-surface rounded-xl border border-wabi-border overflow-hidden">
                <!-- Month Nav -->
                <div class="flex items-center justify-between px-3 py-2 border-b border-wabi-border/50">
                    <button id="cal-prev-btn" class="size-8 flex items-center justify-center rounded-full hover:bg-wabi-accent/10 text-wabi-text-secondary transition-colors">
                        <i class="fa-solid fa-chevron-left text-sm"></i>
                    </button>
                    <button id="cal-today-btn" class="text-sm font-semibold text-wabi-primary hover:text-wabi-accent transition-colors">
                        ${year} 年 ${month} 月
                    </button>
                    <button id="cal-next-btn" class="size-8 flex items-center justify-center rounded-full hover:bg-wabi-accent/10 text-wabi-text-secondary transition-colors">
                        <i class="fa-solid fa-chevron-right text-sm"></i>
                    </button>
                </div>

                <!-- Grid -->
                <div class="grid grid-cols-7 divide-x divide-y divide-wabi-border/30">
                    ${gridHTML}
                </div>

                <!-- Month Summary Bar -->
                <div class="flex items-center gap-3 px-3 py-2 border-t border-wabi-border text-xs text-wabi-text-secondary bg-wabi-bg/50">
                    <span class="flex items-center gap-1">
                        <span class="size-2 rounded-full bg-wabi-income inline-block"></span>
                        收入 <strong class="text-wabi-text-primary">${escapeHTML(formatCurrency(totalIncome))}</strong>
                    </span>
                    <span class="flex items-center gap-1">
                        <span class="size-2 rounded-full bg-wabi-expense inline-block"></span>
                        支出 <strong class="text-wabi-text-primary">${escapeHTML(formatCurrency(totalExpense))}</strong>
                    </span>
                    <span class="ml-auto flex items-center gap-1">
                        結餘 <strong class="${netBalance >= 0 ? 'text-wabi-income' : 'text-wabi-expense'}">${escapeHTML(formatCurrency(netBalance))}</strong>
                    </span>
                </div>
            </div>

            <div id="cal-modal-container"></div>
        `

        this.setupEventListeners()
    }

    setupEventListeners() {
        this._prevHandler = this._prevHandler || this.changeMonth.bind(this, -1)
        this._nextHandler = this._nextHandler || this.changeMonth.bind(this, 1)
        this._cellHandler = this._cellHandler || this._onCellClick.bind(this)
        this._todayHandler = this._todayHandler || (() => {
            this.currentDate = new Date()
            this.render()
        })

        const prevBtn = this.container.querySelector('#cal-prev-btn')
        const nextBtn = this.container.querySelector('#cal-next-btn')
        const todayBtn = this.container.querySelector('#cal-today-btn')

        if (prevBtn) prevBtn.addEventListener('click', this._prevHandler)
        if (nextBtn) nextBtn.addEventListener('click', this._nextHandler)
        if (todayBtn) todayBtn.addEventListener('click', this._todayHandler)

        this.container.querySelectorAll('.calendar-cell').forEach(cell => {
            cell.addEventListener('click', this._cellHandler)
        })
    }

    _onCellClick(e) {
        const cell = e.currentTarget
        const dateStr = cell.dataset.date
        const dayRecords = this._grouped?.[dateStr] || []
        this.showDayDetails(dateStr, dayRecords)
    }

    async changeMonth(delta) {
        const newMonth = this.currentDate.getMonth() + delta
        this.currentDate = new Date(this.currentDate.getFullYear(), newMonth, 1)
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

    renderCell(year, month, day, dayRecords, todayStr) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const isToday = dayStr === todayStr

        let incomeSum = 0
        for (const r of dayRecords) {
            if (r.type === 'income') incomeSum += r.amount
        }

        // Get top 3 expense records (by amount desc)
        const expenseRecords = dayRecords
            .filter(r => r.type === 'expense')
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 3)

        // Get category info for display
        const getCat = (type, catId) => {
            if (this.categoryManager && typeof this.categoryManager.getCategoryById === 'function') {
                return this.categoryManager.getCategoryById(type, catId)
            }
            return null
        }

        let barsHTML = ''
        if (expenseRecords.length > 0) {
            for (const r of expenseRecords) {
                const cat = getCat(r.type, r.category)
                const label = cat
                    ? escapeHTML(cat.name || r.category)
                    : escapeHTML(r.category)
                const shortAmount = this._formatShort(r.amount)
                barsHTML += `<div class="flex items-center justify-between text-[10px] leading-tight">
                    <span class="truncate text-wabi-text-secondary font-medium">${label}</span>
                    <span class="ml-1 text-wabi-expense shrink-0 font-semibold">$${shortAmount}</span>
                </div>`
            }
        }

        // Income indicator (if only income, no expenses)
        if (expenseRecords.length === 0 && incomeSum > 0) {
            const incomeRecords = dayRecords.filter(r => r.type === 'income')
            const label = incomeRecords.length > 1 ? `${incomeRecords.length} 筆收入` : '💰 收入'
            barsHTML = `<div class="flex items-center justify-between text-[10px] leading-tight">
                <span class="text-wabi-income font-medium">${label}</span>
                <span class="ml-1 text-wabi-income shrink-0 font-semibold">+$${this._formatShort(incomeSum)}</span>
            </div>`
        }

        const todayClass = isToday
            ? 'bg-wabi-accent/5 border-l-[3px] border-wabi-accent'
            : 'hover:bg-wabi-bg/60'

        return `
            <div data-date="${dayStr}" class="calendar-cell min-h-[68px] sm:min-h-[80px] px-1.5 py-1 flex flex-col cursor-pointer transition-colors ${todayClass}">
                <div class="flex justify-end">
                    <span class="text-[11px] font-medium ${isToday ? 'text-wabi-accent font-bold' : 'text-wabi-text-secondary'}">${day}</span>
                </div>
                <div class="flex flex-col gap-[2px] mt-auto pb-0.5">
                    ${barsHTML || '<div class="h-[3px]"></div>'}
                </div>
            </div>
        `
    }

    /**
     * Build the icon + label HTML for a record, matching recordsList.js style.
     * Uses CategoryManager.getCategoryById(type, id) for icon, color, and display name.
     */
    _buildRecordHTML(r) {
        const isInc = r.type === 'income'
        const sign = isInc ? '+' : '-'
        const colorClass = isInc ? 'text-wabi-income' : 'text-wabi-expense'

        // Get category info via CategoryManager
        const category = this.categoryManager
            && typeof this.categoryManager.getCategoryById === 'function'
            ? this.categoryManager.getCategoryById(r.type, r.category)
            : null

        const isTransfer = r.category === 'transfer'
        const isBalanceAdj = r.category === 'balance_adjustment'

        let displayName
        let iconHTML

        if (isTransfer) {
            displayName = '帳戶間轉帳'
            iconHTML = `<span class="size-8 flex items-center justify-center rounded-lg shrink-0 bg-yellow-500 bg-opacity-20"><i class="fa-solid fa-right-left text-sm text-yellow-500"></i></span>`
        } else if (isBalanceAdj) {
            displayName = '帳務差額'
            iconHTML = `<span class="size-8 flex items-center justify-center rounded-lg shrink-0 bg-purple-500 bg-opacity-20"><i class="fa-solid fa-scale-balanced text-sm text-purple-500"></i></span>`
        } else if (category) {
            displayName = category.name || r.category
            // Sanitize color and icon to prevent XSS from custom categories
            // Color: allow only safe CSS class patterns (letters, digits, hyphens, underscores)
            const catColor = (category.color || 'bg-gray-400').replace(/[^a-zA-Z0-9_-]/g, '')
            // Icon: allow only safe CSS class patterns
            const catIcon = (category.icon || 'fa-solid fa-question').replace(/[^a-zA-Z0-9_ -]/g, '')
            iconHTML = `<span class="size-8 flex items-center justify-center rounded-lg shrink-0 ${catColor} bg-opacity-20"><i class="${catIcon} text-sm"></i></span>`
        } else {
            // Fallback: no category found
            displayName = r.category
            iconHTML = `<span class="text-base size-8 flex items-center justify-center rounded-lg bg-wabi-bg shrink-0">${isInc ? '💰' : '🛒'}</span>`
        }

        return `
            <div class="flex items-center justify-between py-2.5 border-b border-wabi-border last:border-none">
                <div class="flex items-center gap-2.5 overflow-hidden">
                    ${iconHTML}
                    <div class="overflow-hidden">
                        <p class="text-sm font-medium text-wabi-text-primary truncate">${escapeHTML(displayName)}</p>
                        ${r.description ? `<p class="text-xs text-wabi-text-secondary truncate">${escapeHTML(r.description)}</p>` : ''}
                    </div>
                </div>
                <span class="text-sm font-semibold ${colorClass} shrink-0">${sign}${this._formatAmount(r.amount)}</span>
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
                    return this._buildRecordHTML(r)
                })
                .join('')
        }

        const net = totalIncome - totalExpense
        const netDisplay = net === 0
            ? formatCurrency(0)
            : `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net))}`
        const netColor = net >= 0 ? 'text-wabi-income' : 'text-wabi-expense'

        modalContainer.innerHTML = `
            <div id="cal-details-modal" class="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                <div class="bg-wabi-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col shadow-xl overflow-hidden animate-slide-up">
                    <div class="flex items-center justify-between px-4 py-3 border-b border-wabi-border shrink-0">
                        <h3 class="text-base font-semibold text-wabi-primary">${escapeHTML(formattedDateTitle)}</h3>
                        <button id="cal-modal-close" class="size-7 flex items-center justify-center rounded-full hover:bg-wabi-border/40 text-wabi-text-secondary transition-colors">
                            <i class="fa-solid fa-xmark text-base"></i>
                        </button>
                    </div>
                    <div class="px-4 py-2 overflow-y-auto flex-1">
                        ${recordsHTML}
                    </div>
                    ${records.length > 0 ? `
                        <div class="px-4 py-2.5 border-t border-wabi-border flex items-center justify-between shrink-0 bg-wabi-bg/50">
                            <span class="text-xs font-medium text-wabi-text-secondary">當日淨收支</span>
                            <span class="text-sm font-bold ${netColor}">${netDisplay}</span>
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

        if (closeBtn) closeBtn.addEventListener('click', closeModal)
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal()
            })
        }
    }

    destroy() {
        const prevBtn = this.container?.querySelector('#cal-prev-btn')
        const nextBtn = this.container?.querySelector('#cal-next-btn')
        const todayBtn = this.container?.querySelector('#cal-today-btn')
        if (prevBtn && this._prevHandler) prevBtn.removeEventListener('click', this._prevHandler)
        if (nextBtn && this._nextHandler) nextBtn.removeEventListener('click', this._nextHandler)
        if (todayBtn && this._todayHandler) todayBtn.removeEventListener('click', this._todayHandler)
        if (this._cellHandler && this.container) {
            this.container.querySelectorAll('.calendar-cell').forEach(cell => {
                cell.removeEventListener('click', this._cellHandler)
            })
        }
        const modal = this.container?.querySelector('#cal-details-modal')
        if (modal) modal.remove()
        this._grouped = null
        this._prevHandler = null
        this._nextHandler = null
        this._cellHandler = null
        this._todayHandler = null
    }

    _formatAmount(amount) {
        return formatCurrency(amount).replace(/^[^\d\-.]+/, '')
    }

    /** Short amount for compact cell display: 150→"150", 15000→"15k" */
    _formatShort(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return '0'
        if (amount >= 10000) return `${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k`
        return Math.round(amount).toString()
    }
}
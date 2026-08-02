import { formatCurrency, formatDate, formatDateToString, getDateRange, escapeHTML } from './utils.js'
import { createDateRangeModal } from './datePickerModal.js'

export class RecordsListManager {
    constructor(dataService, categoryManager, container) {
        this.dataService = dataService
        this.categoryManager = categoryManager
        this.container = container
        this.records = []
        this.accounts = [] // Store accounts for display
        this.debtsMap = {} // Store debts for display
        this.advancedModeEnabled = false
        this.filters = {
            period: 'month',
            type: 'all',
            categories: new Set(),
            accounts: new Set(), // Add accounts filter
            customStartDate: null,
            customEndDate: null,
            searchQuery: '',
        }

        this.highlightGroupId = null

        // Bind save method to call on page leave
        this._saveSessionFilters = this._saveSessionFilters.bind(this)
        window.addEventListener('beforeunload', this._saveSessionFilters)
    }

    async init() {
        // Restore session filters before setting up defaults
        const sessionFilters = this._loadSessionFilters()
        if (sessionFilters) {
            this.filters = sessionFilters
        } else {
            // Apply default records period setting
            try {
                const defaultPeriodSetting = await this.dataService.getSetting(
                    'defaultRecordsPeriod'
                )
                const defaultPeriod = defaultPeriodSetting?.value || 'month'

                if (defaultPeriod === 'last') {
                    const lastStateSetting = await this.dataService.getSetting(
                        'lastRecordsPeriodState'
                    )
                    if (lastStateSetting?.value) {
                        this.filters.period =
                            lastStateSetting.value.period || 'month'
                        this.filters.customStartDate =
                            lastStateSetting.value.customStartDate || null
                        this.filters.customEndDate =
                            lastStateSetting.value.customEndDate || null
                    }
                } else {
                    this.filters.period = defaultPeriod
                    const range = getDateRange(defaultPeriod)
                    this.filters.customStartDate = range.startDate
                    this.filters.customEndDate = range.endDate
                }
            } catch (err) {
                console.error(
                    'Failed to load default records period setting:',
                    err
                )
            }
        }

        const advancedMode = await this.dataService.getSetting(
            'advancedAccountModeEnabled'
        )
        this.advancedModeEnabled = !!advancedMode?.value

        if (this.advancedModeEnabled) {
            this.accounts = await this.dataService.getAccounts()
            this.container
                .querySelector('#records-account-filter-btn')
                .classList.remove('hidden')
        }

        this.modalsContainer = this.container.querySelector(
            '#records-modals-container'
        )
        this.setupEventListeners()
        this._restoreFilterUI()
        await this.loadAndRenderRecords()

        // Save initial state so "last" option works on next visit
        await this._saveLastPeriodState()
    }

    /** Save current filters to sessionStorage (persists across navigation within same tab) */
    _saveSessionFilters() {
        try {
            sessionStorage.setItem(
                'jijun_records_filters',
                JSON.stringify({
                    period: this.filters.period,
                    type: this.filters.type,
                    categories: Array.from(this.filters.categories),
                    accounts: Array.from(this.filters.accounts),
                    customStartDate: this.filters.customStartDate,
                    customEndDate: this.filters.customEndDate,
                    searchQuery: this.filters.searchQuery,
                })
            )
        } catch (error) {
            console.error('Failed to save session filters:', error)
        }
    }

    /** Restore filters from sessionStorage, or null if none */
    _loadSessionFilters() {
        try {
            const raw = sessionStorage.getItem('jijun_records_filters')
            if (!raw) return null
            const data = JSON.parse(raw)
            return {
                period: data.period || 'month',
                type: data.type || 'all',
                categories: new Set(data.categories || []),
                accounts: new Set(data.accounts || []),
                customStartDate: data.customStartDate || null,
                customEndDate: data.customEndDate || null,
                searchQuery: data.searchQuery || '',
            }
        } catch (error) {
            console.error('Failed to load session filters:', error)
            return null
        }
    }

    /** Restore UI state from current filters */
    _restoreFilterUI() {
        this.updatePeriodButtons()
        this.updateTypeButtons()
        this.updateHeaderTitle()
        // Restore search input
        const searchInput = this.container.querySelector(
            '#records-search-input'
        )
        if (searchInput && this.filters.searchQuery) {
            searchInput.value = this.filters.searchQuery
        }
    }

    async _saveLastPeriodState() {
        try {
            await this.dataService.saveSetting({
                key: 'lastRecordsPeriodState',
                value: {
                    period: this.filters.period,
                    customStartDate: this.filters.customStartDate,
                    customEndDate: this.filters.customEndDate,
                },
            })
        } catch (error) {
            console.error('Failed to save last records period state:', error)
        }
    }

    setupEventListeners() {
        // Listen for hash changes to save filters when navigating away
        this._hashChangeHandler = () => this._saveSessionFilters()
        window.addEventListener('hashchange', this._hashChangeHandler)

        this.container
            .querySelector('#records-period-filter')
            .addEventListener('click', e => {
                if (e.target.tagName === 'BUTTON') {
                    const period = e.target.dataset.period
                    if (period === 'custom') {
                        this.showDateRangeModal()
                    } else {
                        this.filters.period = period
                        const newRange = getDateRange(period)
                        this.filters.customStartDate = newRange.startDate
                        this.filters.customEndDate = newRange.endDate
                        this._saveLastPeriodState()
                        this.updatePeriodButtons()
                        this._saveSessionFilters()
                        this.loadAndRenderRecords()
                    }
                }
            })

        const prevBtn = this.container.querySelector('#prev-period-btn')
        const nextBtn = this.container.querySelector('#next-period-btn')
        const headerTitle = this.container.querySelector(
            '#records-header-title'
        )

        if (prevBtn)
            prevBtn.addEventListener('click', () => this.shiftDateRange(-1))
        if (nextBtn)
            nextBtn.addEventListener('click', () => this.shiftDateRange(1))
        if (headerTitle)
            headerTitle.addEventListener('click', () =>
                this.showDateRangeModal()
            )

        this.container
            .querySelector('#records-type-filter')
            .addEventListener('click', e => {
                if (e.target.tagName === 'BUTTON') {
                    this.filters.type = e.target.dataset.type
                    this.updateTypeButtons()
                    this._saveSessionFilters()
                    this.applyFiltersAndRender() // Re-apply filters on existing data
                }
            })

        this.container
            .querySelector('#records-category-filter-btn')
            .addEventListener('click', () => {
                this.showCategoryFilterModal()
            })

        if (this.advancedModeEnabled) {
            this.container
                .querySelector('#records-account-filter-btn')
                .addEventListener('click', () => {
                    this.showAccountFilterModal()
                })
        }

        const searchInput = this.container.querySelector(
            '#records-search-input'
        )
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                this.filters.searchQuery = e.target.value.trim().toLowerCase()
                this._saveSessionFilters()
                this.applyFiltersAndRender()
            })
        }
    }

    updatePeriodButtons() {
        this.container.querySelectorAll('.period-btn').forEach(btn => {
            const isMatch =
                btn.dataset.period === this.filters.period ||
                (btn.dataset.period === 'custom' &&
                    !['week', 'month', 'year'].includes(this.filters.period))
            if (isMatch) {
                btn.classList.add(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm'
                )
                btn.classList.remove('text-wabi-text-secondary')
            } else {
                btn.classList.remove(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm'
                )
                btn.classList.add('text-wabi-text-secondary')
            }
        })
    }

    updateTypeButtons() {
        this.container.querySelectorAll('.type-btn').forEach(btn => {
            if (btn.dataset.type === this.filters.type) {
                btn.classList.add(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm'
                )
                btn.classList.remove('text-wabi-text-secondary')
            } else {
                btn.classList.remove(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm'
                )
                btn.classList.add('text-wabi-text-secondary')
            }
        })
    }

    shiftDateRange(direction) {
        // Shift month by direction (-1 or 1)
        if (!this.filters.customStartDate) {
            const range = getDateRange('month')
            this.filters.customStartDate = range.startDate
            this.filters.customEndDate = range.endDate
        }

        const currentStart = new Date(this.filters.customStartDate)

        let newStart, newEnd
        if (this.filters.period === 'year') {
            newStart = new Date(currentStart.getFullYear() + direction, 0, 1)
            newEnd = new Date(currentStart.getFullYear() + direction, 11, 31)
        } else if (this.filters.period === 'week') {
            newStart = new Date(currentStart)
            newStart.setDate(newStart.getDate() + direction * 7)
            newEnd = new Date(newStart)
            newEnd.setDate(newStart.getDate() + 6)
        } else {
            // Default to month shifting for 'month' or 'custom'
            newStart = new Date(
                currentStart.getFullYear(),
                currentStart.getMonth() + direction,
                1
            )
            newEnd = new Date(
                currentStart.getFullYear(),
                currentStart.getMonth() + direction + 1,
                0
            )
        }

        this.filters.customStartDate = formatDateToString(newStart)
        this.filters.customEndDate = formatDateToString(newEnd)

        // When using arrows, if we are in custom mode, we stay in custom mode.
        // If we were in month/year/week, we stay in that mode but the dates are shifted.
        // However, standard getDateRange() is absolute (current month/week).
        // So shifting implies we switch to "custom" conceptually, but visually we can keep the current period highlighted
        // or switch to custom. Let's switch to custom to be accurate.
        this.filters.period = 'custom'
        this._saveLastPeriodState()
        this.updatePeriodButtons()

        this.loadAndRenderRecords()
    }

    updateHeaderTitle() {
        const titleEl = this.container.querySelector('#records-header-title')
        if (!titleEl) return

        const startStr = this.filters.customStartDate
        const endStr = this.filters.customEndDate
        if (!startStr || !endStr) {
            titleEl.textContent = '記帳紀錄'
            return
        }

        const start = new Date(startStr)
        const end = new Date(endStr)
        const today = new Date()
        const startY = start.getFullYear()
        const startM = start.getMonth() + 1
        const startD = start.getDate()
        const endY = end.getFullYear()
        const endM = end.getMonth() + 1
        const endD = end.getDate()

        // 判斷是否為「某個月的月初到月底」或是「某個月的月初到該月今日(如果是當月的話)」
        const isFirstDay = startD === 1
        const isLastDay = endD === new Date(endY, endM, 0).getDate()
        const isToday =
            endY === today.getFullYear() &&
            endM === today.getMonth() + 1 &&
            endD === today.getDate()

        if (
            startY === endY &&
            startM === endM &&
            isFirstDay &&
            (isLastDay || isToday)
        ) {
            // 顯示該月份
            titleEl.textContent = `${startY}年${startM}月`
        } else {
            // 顯示完整範圍
            if (startY === endY && startM === endM) {
                titleEl.textContent = `${startY}年${startM}月${startD}號 ~ ${endD}號`
            } else if (startY === endY) {
                titleEl.textContent = `${startY}年${startM}月${startD}號 ~ ${endM}月${endD}號`
            } else {
                titleEl.textContent = `${startY}年${startM}月${startD}號 ~ ${endY}年${endM}月${endD}號`
            }
        }
    }

    async loadAndRenderRecords() {
        const listContainer = this.container.querySelector(
            '#records-list-container'
        )
        listContainer.innerHTML =
            '<p class="text-center text-wabi-text-secondary py-8">載入中...</p>'

        const dateRange =
            this.filters.period === 'custom' && this.filters.customStartDate
                ? {
                      startDate: this.filters.customStartDate,
                      endDate: this.filters.customEndDate,
                  }
                : getDateRange(this.filters.period)

        // Ensure custom dates are synced back if period isn't custom
        if (this.filters.period !== 'custom') {
            this.filters.customStartDate = dateRange.startDate
            this.filters.customEndDate = dateRange.endDate
        }

        this.updateHeaderTitle()

        const records = await this.dataService.getRecords({
            startDate: this.filters.customStartDate,
            endDate: this.filters.customEndDate,
        })
        this.records = records // Store all records for the period

        // Load debts for records that have debtId
        const debtIds = [
            ...new Set(records.filter(r => r.debtId).map(r => r.debtId)),
        ]
        // Batch load debts instead of N+1 individual queries
        this.debtsMap = {}
        if (debtIds.length > 0) {
            const allDebts = await this.dataService.getDebts()
            const debtSet = new Set(debtIds)
            for (const debt of allDebts) {
                if (debtSet.has(debt.id)) {
                    this.debtsMap[debt.id] = debt
                }
            }
        }

        // Load contacts to display the counterparty name on debt labels
        this.contactsMap = {}
        try {
            if (typeof this.dataService.getContacts === 'function') {
                const contacts = await this.dataService.getContacts({
                    allLedgers: true,
                })
                for (const c of contacts) {
                    this.contactsMap[c.id] = c
                }
            }
        } catch (e) {
            console.warn('Failed to load contacts for records list:', e)
        }

        // Load groupMeta cache for grouped records display
        this.groupMetaCache = {}
        try {
            const groupIds = [...new Set(records.filter(r => r.groupId).map(r => r.groupId))]
            if (groupIds.length > 0 && typeof this.dataService.getAllGroupMeta === 'function') {
                const allGroupMeta = await this.dataService.getAllGroupMeta()
                for (const gm of allGroupMeta) {
                    if (groupIds.includes(gm.id)) {
                        this.groupMetaCache[gm.id] = gm
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load groupMeta for records list:', e)
        }

        this.applyFiltersAndRender()
    }

    applyFiltersAndRender() {
        // 1. Apply all filters EXCEPT type to the master list for the period
        let baseFilteredRecords = this.records

        if (this.filters.categories.size > 0) {
            baseFilteredRecords = baseFilteredRecords.filter(r =>
                this.filters.categories.has(r.category)
            )
        }

        if (this.advancedModeEnabled && this.filters.accounts.size > 0) {
            baseFilteredRecords = baseFilteredRecords.filter(r =>
                this.filters.accounts.has(String(r.accountId))
            )
        }

        if (this.filters.searchQuery) {
            const query = this.filters.searchQuery
            // Check if any group names match the search query
            const matchedGroupIds = new Set()
            if (this.groupMetaCache) {
                for (const meta of Object.values(this.groupMetaCache)) {
                    if (meta.name && meta.name.toLowerCase().includes(query)) {
                        matchedGroupIds.add(meta.id)
                    }
                }
            }
            baseFilteredRecords = baseFilteredRecords.filter(r => {
                const descriptionMatch =
                    r.description && r.description.toLowerCase().includes(query)
                const amountMatch = r.amount.toString().includes(query)
                // Include records if they belong to a matched group
                const groupMatch = r.groupId && matchedGroupIds.has(r.groupId)
                return descriptionMatch || amountMatch || groupMatch
            })
            // If group names matched, also include ALL records from matched groups
            if (matchedGroupIds.size > 0) {
                const matchedRecords = baseFilteredRecords.filter(
                    r => r.groupId && matchedGroupIds.has(r.groupId)
                )
                const matchedIds = new Set(matchedRecords.map(r => r.id))
                // Add any records from matched groups that weren't already included
                this.records.forEach(r => {
                    if (r.groupId && matchedGroupIds.has(r.groupId) && !matchedIds.has(r.id)) {
                        baseFilteredRecords.push(r)
                    }
                })
            }
        }

        // 2. Perform transfer offsetting on this base list to get records for summary calculation
        const transferRecords = baseFilteredRecords.filter(
            r => r.category === 'transfer'
        )
        const normalRecords = baseFilteredRecords.filter(
            r => r.category !== 'transfer'
        )
        const excludedTransferIds = new Set()

        if (transferRecords.length > 1) {
            const expenseTransfers = transferRecords.filter(
                r => r.type === 'expense'
            )
            const incomeTransfers = [
                ...transferRecords.filter(r => r.type === 'income'),
            ] // Mutable copy

            expenseTransfers.forEach(expense => {
                const matchingIncomeIndex = incomeTransfers.findIndex(
                    income =>
                        income.amount === expense.amount &&
                        income.date === expense.date
                )
                if (matchingIncomeIndex !== -1) {
                    excludedTransferIds.add(expense.id)
                    excludedTransferIds.add(
                        incomeTransfers[matchingIncomeIndex].id
                    )
                    incomeTransfers.splice(matchingIncomeIndex, 1)
                }
            })
        }

        const recordsForSummary = normalRecords.concat(
            transferRecords.filter(r => !excludedTransferIds.has(r.id))
        )

        // 3. Calculate summary from the offset list and update UI
        // Need to consider debt status for correct calculation
        const summary = recordsForSummary.reduce(
            (acc, r) => {
                // Exclude debt collection and repayment categories from summary calculation
                if (
                    r.category === 'debt_collection' ||
                    r.category === 'debt_repayment' ||
                    r.category === 'balance_adjustment'
                ) {
                    return acc
                }

                let effectiveAmount = r.amount

                // Check if record has associated debt and adjust amount
                if (r.debtId && this.debtsMap[r.debtId]) {
                    const debt = this.debtsMap[r.debtId]
                    const isSettled = debt.settled === true
                    const isReceivable = debt.type === 'receivable' // 別人欠我

                    // Logic:
                    // - 支出 + 別人欠我 (代墊): 還清後扣除別人欠我的金額 (剩下自己的開銷)
                    // - 收入 + 別人欠我: 初始 $0，還清後原額 (收到錢了)
                    // - 支出 + 我欠別人: 還清後原額 (真的花了)
                    // - 收入 + 我欠別人 (先收): 還清後 $0 (還回去了)

                    if (r.type === 'expense' && isReceivable) {
                        // 代墊：還清後扣除代墊金額，不計入自己支出
                        // 因為 r.amount 是總金額 (包含自己的份 + 別人的份)
                        // debt.originalAmount 則是別人的份
                        const myExpense = Math.max(
                            0,
                            r.amount - (debt.originalAmount || 0)
                        )
                        effectiveAmount = isSettled ? myExpense : r.amount
                    } else if (r.type === 'income' && isReceivable) {
                        // 別人還我：還清後才計入收入
                        effectiveAmount = isSettled ? r.amount : 0
                    } else if (r.type === 'expense' && !isReceivable) {
                        // 還別人錢：還清後計入支出
                        effectiveAmount = isSettled ? r.amount : 0
                    } else if (r.type === 'income' && !isReceivable) {
                        // 先收別人的錢：還清後不計入收入
                        effectiveAmount = isSettled ? 0 : r.amount
                    }
                }

                if (r.type === 'income') acc.income += effectiveAmount
                else acc.expense += effectiveAmount
                return acc
            },
            { income: 0, expense: 0 }
        )

        this.container.querySelector('#total-income').textContent =
            formatCurrency(summary.income)
        this.container.querySelector('#total-expense').textContent =
            formatCurrency(summary.expense)

        // 4. Now, apply the final type filter to the summary list to get the records for DISPLAY
        let displayRecords = recordsForSummary
        if (this.filters.type !== 'all') {
            displayRecords = displayRecords.filter(
                r => r.type === this.filters.type
            )
        }

        // 5. Render the final list of records for display and update the count
        this.renderRecords(displayRecords)
        this.container.querySelector('#record-count').textContent =
            displayRecords.length
    }

    renderRecords(records) {
        const listContainer = this.container.querySelector(
            '#records-list-container'
        )
        if (records.length === 0) {
            listContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center pt-16 text-center">
                    <i class="fa-regular fa-folder-open text-wabi-text-secondary text-5xl"></i>
                    <p class="mt-4 text-base font-medium text-wabi-text-primary">此期間沒有紀錄</p>
                    <p class="mt-1 text-sm text-wabi-text-secondary">試試看選擇其他篩選條件吧！</p>
                </div>
            `
            return
        }

        // Load groupMeta cache for display
        const groupMetaCache = this.groupMetaCache || {}

        // Group records by date, then by groupId within each date
        const groupedByDate = records.reduce((acc, record) => {
            const date = record.date
            if (!acc[date]) acc[date] = []
            acc[date].push(record)
            return acc
        }, {})

        listContainer.innerHTML = Object.keys(groupedByDate)
            .sort((a, b) => new Date(b) - new Date(a))
            .map(date => {
                const recordsOnDate = groupedByDate[date]

                // Separate grouped and non-grouped records
                const groupedRecords = recordsOnDate.filter(r => r.groupId)
                const standaloneRecords = recordsOnDate.filter(r => !r.groupId)

                // Group by groupId
                const byGroupId = groupedRecords.reduce((acc, r) => {
                    if (!acc[r.groupId]) acc[r.groupId] = []
                    acc[r.groupId].push(r)
                    return acc
                }, {})

                const dateHeader = `<h3 class="font-semibold text-wabi-text-primary px-2 pt-4 pb-2">${formatDate(date, 'long')}</h3>`

                // Render group blocks
                let groupsHtml = ''
                for (const [groupId, groupRecs] of Object.entries(byGroupId)) {
                    const meta = groupMetaCache[groupId] || {}
                    const groupName = meta.name || `群組 ${groupId.slice(0, 8)}`
                    // 總額（含所有紀錄）
                    const totalExpense = groupRecs.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0)
                    const totalIncome = groupRecs.filter(r => r.type === 'income').reduce((s, r) => s + (r.amount || 0), 0)
                    const netAmount = totalIncome - totalExpense
                    // 待結清（排除 group_settlement）
                    const nonSettlement = groupRecs.filter(r => r.category !== 'group_settlement')
                    const pendingExpense = nonSettlement.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0)
                    const pendingIncome = nonSettlement.filter(r => r.type === 'income').reduce((s, r) => s + (r.amount || 0), 0)
                    const pendingAmount = pendingIncome - pendingExpense
                    const isSettled = meta.settled === true

                    const hasSettlement = groupRecs.length > nonSettlement.length
                    const netLabel = netAmount >= 0 ? '+' : ''
                    const pendingLabel = pendingAmount >= 0 ? '+' : ''

                    groupsHtml += `
                    <div class="group-block mb-2" data-group-id="${groupId}">
                        <div class="group-header flex items-center justify-between bg-wabi-primary/5 px-3 py-2 rounded-lg border border-wabi-primary/20 cursor-pointer hover:bg-wabi-primary/10 transition-colors">
                            <div class="flex items-center gap-2 min-w-0">
                                <i class="fa-solid fa-layer-group text-wabi-primary text-sm"></i>
                                <span class="font-medium text-wabi-text-primary text-sm truncate">${escapeHTML(groupName)}</span>
                                <span class="text-xs text-wabi-text-secondary">(${groupRecs.length}筆)</span>
                                ${isSettled ? '<span class="text-xs bg-wabi-income/20 text-wabi-income px-1.5 py-0.5 rounded">已結清</span>' : ''}
                            </div>
                            <div class="flex items-center gap-2 shrink-0">
                                <span class="text-xs text-wabi-text-secondary">支 ${formatCurrency(totalExpense)} ｜ 收 ${formatCurrency(totalIncome)}</span>
                                <span class="text-xs font-medium ${netAmount >= 0 ? 'text-wabi-income' : 'text-wabi-expense'}">淨 ${netLabel}${formatCurrency(netAmount)}</span>
                                ${!isSettled && hasSettlement ? `<span class="text-xs text-wabi-text-secondary" title="待結清（扣除退款）">待結清 ${pendingLabel}${formatCurrency(pendingAmount)}</span>` : ''}
                                ${!isSettled && !hasSettlement ? `<span class="text-xs font-medium ${pendingAmount >= 0 ? 'text-wabi-income' : 'text-wabi-expense'}" title="待結清">待結清 ${pendingLabel}${formatCurrency(pendingAmount)}</span>` : ''}
                                <i class="fa-solid fa-chevron-down text-wabi-text-secondary text-xs group-chevron transition-transform" style="transform: rotate(180deg)"></i>
                            </div>
                        </div>
                        <div class="group-body ml-4 mt-1 space-y-1">
                    `
                    // Render each record within the group
                    groupsHtml += groupRecs.map(record => this._renderSingleRecord(record)).join('')
                    groupsHtml += `</div></div>`
                }

                // Render standalone records
                const standaloneHtml = standaloneRecords
                    .map(record => this._renderSingleRecord(record))
                    .join('')

                return dateHeader + groupsHtml + standaloneHtml
            })
            .join('')

        // Group expand/collapse toggle
        listContainer.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener('click', () => {
                const groupBlock = header.closest('.group-block')
                const body = groupBlock.querySelector('.group-body')
                const chevron = header.querySelector('.group-chevron')
                body.classList.toggle('hidden')
                chevron.style.transform = body.classList.contains('hidden') ? '' : 'rotate(180deg)'
            })
        })

        // 分期圖標點擊跳轉
        listContainer.querySelectorAll('.amort-link-icon').forEach(icon => {
            icon.addEventListener('click', e => {
                e.preventDefault()
                e.stopPropagation()
                window.location.hash = '#amortizations'
            })
        })

        // 欠款按鈕點擊跳轉
        listContainer.querySelectorAll('.debt-link-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const debtId = btn.dataset.debtId;
                window.location.hash = `#debts?debtId=${debtId}`;
            });
        });

        // Auto-expand and scroll to highlighted group
        if (this.highlightGroupId) {
            const groupBlock = listContainer.querySelector(`.group-block[data-group-id="${this.highlightGroupId}"]`)
            if (groupBlock) {
                const body = groupBlock.querySelector('.group-body')
                const chevron = groupBlock.querySelector('.group-chevron')
                if (body) {
                    body.classList.remove('hidden')
                    if (chevron) chevron.style.transform = 'rotate(180deg)'
                }
                setTimeout(() => {
                    groupBlock.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300)
            }
            this.highlightGroupId = null
        }
    }

    _renderSingleRecord(record) {
        const isIncome = record.type === 'income'
        const category = this.categoryManager.getCategoryById(
            record.type,
            record.category
        )
        const isTransfer = record.category === 'transfer'
        const isBalanceAdjustment =
            record.category === 'balance_adjustment'
        const isGroupSettlement =
            record.category === 'group_settlement'
        const icon = isBalanceAdjustment
            ? 'fa-solid fa-scale-balanced'
            : isGroupSettlement
              ? 'fa-solid fa-users-gear'
              : category?.icon || 'fa-solid fa-question'
        const name = isTransfer
            ? '帳戶間轉帳'
            : isBalanceAdjustment
              ? '帳務差額'
              : isGroupSettlement
                ? '群組結清'
                : category?.name || '未分類'
        const color = isBalanceAdjustment
            ? 'bg-purple-500'
            : isGroupSettlement
              ? 'bg-emerald-500'
              : category?.color || 'bg-gray-400'
        const hasDebt = !!record.debtId
        const hasAmortization = !!record.amortizationId

        // Check debt status and calculate display
        const debt = hasDebt
            ? this.debtsMap?.[record.debtId]
            : null
        const isDebtSettled = debt?.settled === true
        const isReceivable = debt?.type === 'receivable' // 別人欠我

        // Determine debt-related categories — repayment/collection records
        const isDebtRepayment = record.category === 'debt_repayment'
        const isDebtCollection = record.category === 'debt_collection'
        const isDebtSettlementRecord = isDebtRepayment || isDebtCollection

        // Calculate display amount based on debt type and status
        const displayLogic = {
            showZero: false,
            showArrow: false,
            arrowToZero: false,
        }

        if (hasDebt && debt && !isDebtSettlementRecord) {
            if (isIncome && isReceivable) {
                displayLogic.showZero = !isDebtSettled
                displayLogic.showArrow = isDebtSettled
                displayLogic.arrowToZero = false
            } else if (!isIncome && isReceivable) {
                displayLogic.showZero = isDebtSettled
                displayLogic.showArrow = isDebtSettled
                displayLogic.arrowToZero = true
            } else if (!isIncome && !isReceivable) {
                displayLogic.showZero = !isDebtSettled
                displayLogic.showArrow = isDebtSettled
                displayLogic.arrowToZero = false
            } else if (isIncome && !isReceivable) {
                displayLogic.showZero = isDebtSettled
                displayLogic.showArrow = isDebtSettled
                displayLogic.arrowToZero = true
            }
        }

        const colorStyle = color.startsWith('#')
            ? `style="background-color: ${color}"`
            : ''
        const colorClass = !color.startsWith('#') ? color : ''

        let accountName = ''
        if (this.advancedModeEnabled) {
            if (record.accountId) {
                const account = this.accounts.find(
                    a => a.id === record.accountId
                )
                accountName = account
                    ? account.name
                    : '未指定帳戶'
            } else {
                accountName = '現金'
            }
        }

        let strikethroughAmount = 0
        let arrowAmount = 0
        let arrowColor = 'text-wabi-income'

        if (hasDebt && debt && displayLogic.showArrow) {
            if (displayLogic.arrowToZero) {
                strikethroughAmount = record.amount
                arrowAmount = 0
                arrowColor = 'text-wabi-income'
            } else {
                strikethroughAmount = 0
                arrowAmount = record.amount
                arrowColor = isIncome
                    ? 'text-wabi-income'
                    : 'text-wabi-expense'
            }
        }

        const mainAmount = displayLogic.showZero
            ? 0
            : record.amount
        const contactName =
            hasDebt && debt?.contactId && this.contactsMap
                ? this.contactsMap[debt.contactId]?.name
                : ''
        const statusLabel = hasDebt
            ? isDebtSettled
                ? `已還清${contactName ? '-' + contactName : ''}`
                : `待還款${contactName ? '-' + contactName : ''}`
            : ''
        const statusClass = isDebtSettled
            ? 'bg-wabi-income/20 text-wabi-income'
            : 'bg-orange-100 text-orange-600'

        const shouldDim =
            hasDebt && isDebtSettled && displayLogic.arrowToZero

        // Group badge
        let groupBadgeHtml = ''
        if (record.groupId) {
            const meta = this.groupMetaCache?.[record.groupId] || {}
            const gName = meta.name || `群組`
            groupBadgeHtml = `<span class="text-xs bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded font-medium"><i class="fa-solid fa-layer-group mr-0.5"></i>${escapeHTML(gName)}</span>`
        }

        return `
            <a ${isTransfer || isBalanceAdjustment ? '' : `href="#add?id=${record.id}"`} class="record-item flex items-center gap-4 bg-wabi-surface px-2 min-h-[72px] py-2 justify-between rounded-lg border border-wabi-border ${isTransfer || isBalanceAdjustment ? '' : 'hover:border-wabi-primary transition-colors'} ${shouldDim ? 'opacity-60' : ''}">
            <div class="flex items-center gap-4 flex-1 min-w-0">
                <div class="flex items-center justify-center rounded-lg ${isTransfer ? 'bg-gray-400' : colorClass} text-white shrink-0 size-12" ${isTransfer ? '' : colorStyle}>
                    <i class="${isTransfer ? 'fa-solid fa-money-bill-transfer' : icon} text-2xl"></i>
                </div>
                <div class="flex flex-col justify-center min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <p class="text-wabi-text-primary text-base font-medium line-clamp-1">${escapeHTML(name)}</p>
                        ${hasAmortization ? '<i class="fa-solid fa-credit-card text-blue-500 text-sm cursor-pointer amort-link-icon" title="分期計畫"></i>' : ''}
                        ${hasDebt ? `
                            <button class="debt-link-btn inline-flex items-center gap-1 text-xs ${statusClass} px-1.5 py-0.5 rounded hover:opacity-80 transition-all font-medium cursor-pointer" data-debt-id="${record.debtId}" title="查看關聯欠款">
                                <i class="fa-solid fa-handshake"></i>
                                <span>${escapeHTML(statusLabel || '欠款')}</span>
                            </button>
                        ` : ''}
                        ${groupBadgeHtml}
                    </div>
                    <p class="text-wabi-text-secondary text-sm font-normal line-clamp-2 break-all">${escapeHTML(record.description || '無備註')}</p>
                </div>
            </div>
                <div class="shrink-0 text-right">
                    ${
                        displayLogic.showArrow
                            ? `
                                <p class="text-wabi-text-secondary text-base font-medium line-through">
                                    ${isIncome ? '+' : '-'} ${formatCurrency(strikethroughAmount)}
                                </p>
                                <p class="text-xs font-medium ${arrowColor}">
                                    → ${isIncome ? '+' : '-'}${formatCurrency(arrowAmount)}
                                </p>
                            `
                            : `
                                <p class="${isIncome ? 'text-wabi-income' : 'text-wabi-expense'} text-base font-medium">
                                    ${isIncome ? '+' : '-'} ${formatCurrency(mainAmount)}
                                </p>
                            `
                    }
                    ${this.advancedModeEnabled ? `<p class="text-xs text-wabi-text-secondary">${escapeHTML(accountName)}</p>` : `<p class="text-xs text-wabi-text-secondary">${formatDate(record.date, 'short')}</p>`}
                </div>
            </a>
        `
    }

    showCategoryFilterModal() {
        const categoryNetTotals = this.records.reduce((acc, record) => {
            const { category, type, amount } = record
            if (!acc[category]) {
                acc[category] = 0
            }
            acc[category] += type === 'income' ? amount : -amount
            return acc
        }, {})

        const allCategoryIds = [...new Set(this.records.map(r => r.category))]

        const modalHtml = `
            <div id="category-filter-modal" class="fixed inset-0 bg-black/50 z-50 flex justify-center items-end" role="dialog" aria-modal="true" aria-labelledby="cat-filter-title">
                <div class="bg-wabi-bg w-full max-w-lg rounded-t-2xl p-4 flex flex-col max-h-[80vh]">
                    <h3 id="cat-filter-title" class="text-lg font-bold text-wabi-primary text-center mb-4">篩選類別</h3>
                    <div class="overflow-y-auto space-y-2 mb-4">
                        ${allCategoryIds
                            .map(catId => {
                                const category =
                                    this.categoryManager.getCategoryById(
                                        'expense',
                                        catId
                                    ) ||
                                    this.categoryManager.getCategoryById(
                                        'income',
                                        catId
                                    )
                                if (!category) return ''
                                const isChecked =
                                    this.filters.categories.has(catId)

                                const netTotal = categoryNetTotals[catId] || 0
                                const isIncome = netTotal > 0
                                const isZero = netTotal === 0
                                const amountClass = isZero
                                    ? 'text-wabi-text-secondary'
                                    : isIncome
                                      ? 'text-wabi-income'
                                      : 'text-wabi-expense'
                                const sign = isIncome ? '+' : '-'
                                const formattedAmount = isZero
                                    ? formatCurrency(0)
                                    : `${sign} ${formatCurrency(Math.abs(netTotal))}`

                                return `
                                <label class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
                                    <div class="flex items-center">
                                        <input type="checkbox" data-cat-id="${catId}" class="h-5 w-5 rounded text-wabi-primary focus:ring-wabi-primary/50" ${isChecked ? 'checked' : ''}>
                                        <span class="ml-3 text-wabi-text-primary">${escapeHTML(category.name)}</span>
                                    </div>
                                    <span class="text-sm font-medium ${amountClass}">${formattedAmount}</span>
                                </label>
                            `
                            })
                            .join('')}
                    </div>
                    <div class="flex gap-2 mt-auto pt-2 border-t border-wabi-border">
                        <button id="apply-cat-filter" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">套用</button>
                        <button id="close-cat-modal" class="flex-1 py-3 bg-wabi-border text-wabi-text-primary rounded-lg">關閉</button>
                    </div>
                </div>
            </div>
        `
        this.modalsContainer.innerHTML = modalHtml

        this.modalsContainer
            .querySelector('#apply-cat-filter')
            .addEventListener('click', () => {
                const selected = new Set()
                this.modalsContainer
                    .querySelectorAll('input[type="checkbox"]:checked')
                    .forEach(el => selected.add(el.dataset.catId))
                this.filters.categories = selected
                this._saveSessionFilters()
                this.applyFiltersAndRender()
                this.modalsContainer.innerHTML = ''
            })
        this.modalsContainer
            .querySelector('#close-cat-modal')
            .addEventListener(
                'click',
                () => (this.modalsContainer.innerHTML = '')
            )

        // Close modal when clicking the overlay background
        this.modalsContainer
            .querySelector('#category-filter-modal')
            .addEventListener('click', e => {
                if (e.target.id === 'category-filter-modal') {
                    this.modalsContainer.innerHTML = ''
                }
            })
    }

    showAccountFilterModal() {
        const modalHtml = `
            <div id="account-filter-modal" class="fixed inset-0 bg-black/50 z-50 flex justify-center items-end" role="dialog" aria-modal="true" aria-labelledby="acc-filter-title">
                <div class="bg-wabi-bg w-full max-w-lg rounded-t-2xl p-4 flex flex-col max-h-[80vh]">
                    <h3 id="acc-filter-title" class="text-lg font-bold text-wabi-primary text-center mb-4">篩選帳戶</h3>
                    <div class="overflow-y-auto space-y-2 mb-4">
                        ${this.accounts
                            .map(account => {
                                const isChecked = this.filters.accounts.has(
                                    String(account.id)
                                )
                                return `
                                <label class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
                                    <div class="flex items-center">
                                        <input type="checkbox" data-acc-id="${account.id}" class="h-5 w-5 rounded text-wabi-primary focus:ring-wabi-primary/50" ${isChecked ? 'checked' : ''}>
                                        <span class="ml-3 text-wabi-text-primary">${escapeHTML(account.name)}</span>
                                    </div>
                                </label>
                            `
                            })
                            .join('')}
                    </div>
                    <div class="flex gap-2 mt-auto pt-2 border-t border-wabi-border">
                        <button id="apply-acc-filter" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">套用</button>
                        <button id="close-acc-modal" class="flex-1 py-3 bg-wabi-border text-wabi-text-primary rounded-lg">關閉</button>
                    </div>
                </div>
            </div>
        `
        this.modalsContainer.innerHTML = modalHtml

        this.modalsContainer
            .querySelector('#apply-acc-filter')
            .addEventListener('click', () => {
                const selected = new Set()
                this.modalsContainer
                    .querySelectorAll('input[type="checkbox"]:checked')
                    .forEach(el => selected.add(el.dataset.accId))
                this.filters.accounts = selected
                this._saveSessionFilters()
                this.applyFiltersAndRender()
                this.modalsContainer.innerHTML = ''
            })
        this.modalsContainer
            .querySelector('#close-acc-modal')
            .addEventListener(
                'click',
                () => (this.modalsContainer.innerHTML = '')
            )

        // Close modal when clicking the overlay background
        this.modalsContainer
            .querySelector('#account-filter-modal')
            .addEventListener('click', e => {
                if (e.target.id === 'account-filter-modal') {
                    this.modalsContainer.innerHTML = ''
                }
            })
    }

    showDateRangeModal() {
        const modal = createDateRangeModal({
            initialStartDate: this.filters.customStartDate,
            initialEndDate: this.filters.customEndDate,
            onApply: (start, end) => {
                this.filters.period = 'custom'
                this.filters.customStartDate = start
                this.filters.customEndDate = end
                this._saveLastPeriodState()
                this._saveSessionFilters()
                this.updatePeriodButtons()
                this.loadAndRenderRecords()
            },
        })
        this.modalsContainer.appendChild(modal)
    }

    /** Clean up event listeners to prevent memory leaks when navigating away */
    destroy() {
        window.removeEventListener('beforeunload', this._saveSessionFilters)
        if (this._hashChangeHandler) {
            window.removeEventListener('hashchange', this._hashChangeHandler)
        }
    }
}

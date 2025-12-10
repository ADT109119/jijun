import { formatCurrency, formatDate, getDateRange } from './utils.js';
import { createDateRangeModal } from './datePickerModal.js';

export class RecordsListManager {
    constructor(dataService, categoryManager, container) {
        this.dataService = dataService;
        this.categoryManager = categoryManager;
        this.container = container;
        this.records = [];
        this.accounts = []; // Store accounts for display
        this.debtsMap = {}; // Store debts for display
        this.advancedModeEnabled = false;
        this.filters = {
            period: 'month',
            type: 'all',
            categories: new Set(),
            accounts: new Set(), // Add accounts filter
            customStartDate: null,
            customEndDate: null,
        };
    }

    async init() {
        const advancedMode = await this.dataService.getSetting('advancedAccountModeEnabled');
        this.advancedModeEnabled = !!advancedMode?.value;

        if (this.advancedModeEnabled) {
            this.accounts = await this.dataService.getAccounts();
            this.container.querySelector('#records-account-filter-btn').classList.remove('hidden');
        }

        this.modalsContainer = this.container.querySelector('#records-modals-container');
        this.setupEventListeners();
        await this.loadAndRenderRecords();
    }

    setupEventListeners() {
        this.container.querySelector('#records-period-filter').addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                const period = e.target.dataset.period;
                if (period === 'custom') {
                    this.showDateRangeModal();
                } else {
                    this.filters.period = period;
                    this.updatePeriodButtons();
                    this.loadAndRenderRecords();
                }
            }
        });

        this.container.querySelector('#records-type-filter').addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                this.filters.type = e.target.dataset.type;
                this.updateTypeButtons();
                this.applyFiltersAndRender(); // Re-apply filters on existing data
            }        });

        this.container.querySelector('#records-category-filter-btn').addEventListener('click', () => {
            this.showCategoryFilterModal();
        });

        if (this.advancedModeEnabled) {
            this.container.querySelector('#records-account-filter-btn').addEventListener('click', () => {
                this.showAccountFilterModal();
            });
        }
    }

    updatePeriodButtons() {
        this.container.querySelectorAll('.period-btn').forEach(btn => {
            if (btn.dataset.period === this.filters.period) {
                btn.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.remove('text-wabi-text-secondary');
            } else {
                btn.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.add('text-wabi-text-secondary');
            }
        });
    }

    updateTypeButtons() {
        this.container.querySelectorAll('.type-btn').forEach(btn => {
            if (btn.dataset.type === this.filters.type) {
                btn.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.remove('text-wabi-text-secondary');
            } else {
                btn.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.add('text-wabi-text-secondary');
            }
        });
    }

    async loadAndRenderRecords() {
        const listContainer = this.container.querySelector('#records-list-container');
        listContainer.innerHTML = '<p class="text-center text-wabi-text-secondary py-8">載入中...</p>';

        const dateRange = this.filters.period === 'custom' && this.filters.customStartDate
            ? { startDate: this.filters.customStartDate, endDate: this.filters.customEndDate }
            : getDateRange(this.filters.period);

        let records = await this.dataService.getRecords({ 
            startDate: dateRange.startDate, 
            endDate: dateRange.endDate 
        });
        this.records = records; // Store all records for the period

        // Load debts for records that have debtId
        const debtIds = [...new Set(records.filter(r => r.debtId).map(r => r.debtId))];
        this.debtsMap = {};
        for (const debtId of debtIds) {
            const debt = await this.dataService.getDebt(debtId);
            if (debt) {
                this.debtsMap[debtId] = debt;
            }
        }

        this.applyFiltersAndRender();
    }

    applyFiltersAndRender() {
        // 1. Apply all filters EXCEPT type to the master list for the period
        let baseFilteredRecords = this.records;

        if (this.filters.categories.size > 0) {
            baseFilteredRecords = baseFilteredRecords.filter(r => this.filters.categories.has(r.category));
        }

        if (this.advancedModeEnabled && this.filters.accounts.size > 0) {
            baseFilteredRecords = baseFilteredRecords.filter(r => this.filters.accounts.has(String(r.accountId)));
        }

        // 2. Perform transfer offsetting on this base list to get records for summary calculation
        const transferRecords = baseFilteredRecords.filter(r => r.category === 'transfer');
        const normalRecords = baseFilteredRecords.filter(r => r.category !== 'transfer');
        const excludedTransferIds = new Set();

        if (transferRecords.length > 1) {
            const expenseTransfers = transferRecords.filter(r => r.type === 'expense');
            const incomeTransfers = [...transferRecords.filter(r => r.type === 'income')]; // Mutable copy

            expenseTransfers.forEach(expense => {
                const matchingIncomeIndex = incomeTransfers.findIndex(income => 
                    income.amount === expense.amount && income.date === expense.date
                );
                if (matchingIncomeIndex !== -1) {
                    excludedTransferIds.add(expense.id);
                    excludedTransferIds.add(incomeTransfers[matchingIncomeIndex].id);
                    incomeTransfers.splice(matchingIncomeIndex, 1);
                }
            });
        }
        
        const recordsForSummary = normalRecords.concat(transferRecords.filter(r => !excludedTransferIds.has(r.id)));

        // 3. Calculate summary from the offset list and update UI
        // Need to consider debt status for correct calculation
        const summary = recordsForSummary.reduce((acc, r) => {
            let effectiveAmount = r.amount;
            
            // Check if record has associated debt and adjust amount
            if (r.debtId && this.debtsMap[r.debtId]) {
                const debt = this.debtsMap[r.debtId];
                const isSettled = debt.settled === true;
                const isReceivable = debt.type === 'receivable'; // 別人欠我
                
                // Logic:
                // - 支出 + 別人欠我 (代墊): 還清後 $0 (錢回來了)
                // - 收入 + 別人欠我: 初始 $0，還清後原額 (收到錢了)
                // - 支出 + 我欠別人: 還清後原額 (真的花了)
                // - 收入 + 我欠別人 (先收): 還清後 $0 (還回去了)
                
                if (r.type === 'expense' && isReceivable) {
                    // 代墊：還清後不計入支出
                    effectiveAmount = isSettled ? 0 : r.amount;
                } else if (r.type === 'income' && isReceivable) {
                    // 別人還我：還清後才計入收入
                    effectiveAmount = isSettled ? r.amount : 0;
                } else if (r.type === 'expense' && !isReceivable) {
                    // 還別人錢：還清後計入支出
                    effectiveAmount = isSettled ? r.amount : 0;
                } else if (r.type === 'income' && !isReceivable) {
                    // 先收別人的錢：還清後不計入收入
                    effectiveAmount = isSettled ? 0 : r.amount;
                }
            }
            
            if (r.type === 'income') acc.income += effectiveAmount;
            else acc.expense += effectiveAmount;
            return acc;
        }, { income: 0, expense: 0 });

        this.container.querySelector('#total-income').textContent = formatCurrency(summary.income);
        this.container.querySelector('#total-expense').textContent = formatCurrency(summary.expense);

        // 4. Now, apply the final type filter to the summary list to get the records for DISPLAY
        let displayRecords = recordsForSummary;
        if (this.filters.type !== 'all') {
            displayRecords = displayRecords.filter(r => r.type === this.filters.type);
        }

        // 5. Render the final list of records for display and update the count
        this.renderRecords(displayRecords);
        this.container.querySelector('#record-count').textContent = displayRecords.length;
    }

    renderRecords(records) {
        const listContainer = this.container.querySelector('#records-list-container');
        if (records.length === 0) {
            listContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center pt-16 text-center">
                    <i class="fa-regular fa-folder-open text-wabi-text-secondary text-5xl"></i>
                    <p class="mt-4 text-base font-medium text-wabi-text-primary">此期間沒有紀錄</p>
                    <p class="mt-1 text-sm text-wabi-text-secondary">試試看選擇其他篩選條件吧！</p>
                </div>
            `;
            return;
        }

        const groupedByDate = records.reduce((acc, record) => {
            const date = record.date;
            if (!acc[date]) acc[date] = [];
            acc[date].push(record);
            return acc;
        }, {});

        listContainer.innerHTML = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a)).map(date => {
            const recordsOnDate = groupedByDate[date];
            const dateHeader = `<h3 class="font-semibold text-wabi-text-primary px-2 pt-4 pb-2">${formatDate(date, 'long')}</h3>`;
            const recordsHtml = recordsOnDate.map(record => {
                const isIncome = record.type === 'income';
                const category = this.categoryManager.getCategoryById(record.type, record.category);
                const icon = category?.icon || 'fa-solid fa-question';
                const isTransfer = record.category === 'transfer';
                const name = isTransfer ? '帳戶間轉帳' : (category?.name || '未分類');
                const color = category?.color || 'bg-gray-400';
                const hasDebt = !!record.debtId;
                
                // Check debt status and calculate display
                const debt = hasDebt ? this.debtsMap?.[record.debtId] : null;
                const isDebtSettled = debt?.settled === true;
                const isReceivable = debt?.type === 'receivable'; // 別人欠我
                
                // Calculate display amount based on debt type and status
                // - 支出 + 別人欠我 (代墊): 顯示原額，還清後 → $0
                // - 收入 + 別人欠我: 顯示 $0，還清後 → 原額
                // - 支出 + 我欠別人: 顯示 $0，還清後 → 原額
                // - 收入 + 我欠別人 (先收): 顯示原額，還清後 → $0
                let displayLogic = { showZero: false, showArrow: false, arrowToZero: false };
                
                if (hasDebt && debt) {
                    if (isIncome && isReceivable) {
                        // 收入+別人欠我：初始 $0，還清後顯示原額
                        displayLogic.showZero = !isDebtSettled;
                        displayLogic.showArrow = isDebtSettled;
                        displayLogic.arrowToZero = false;
                    } else if (!isIncome && isReceivable) {
                        // 支出+別人欠我（代墊）：顯示原額，還清後 $0
                        displayLogic.showZero = isDebtSettled;
                        displayLogic.showArrow = isDebtSettled;
                        displayLogic.arrowToZero = true;
                    } else if (!isIncome && !isReceivable) {
                        // 支出+我欠別人：初始 $0，還清後顯示原額
                        displayLogic.showZero = !isDebtSettled;
                        displayLogic.showArrow = isDebtSettled;
                        displayLogic.arrowToZero = false;
                    } else if (isIncome && !isReceivable) {
                        // 收入+我欠別人（先收）：顯示原額，還清後 $0
                        displayLogic.showZero = isDebtSettled;
                        displayLogic.showArrow = isDebtSettled;
                        displayLogic.arrowToZero = true;
                    }
                }

                const colorStyle = color.startsWith('#') ? `style="background-color: ${color}"` : '';
                const colorClass = !color.startsWith('#') ? color : '';

                let accountName = '';
                if (this.advancedModeEnabled) {
                    const account = this.accounts.find(a => a.id === record.accountId);
                    accountName = account ? account.name : '未指定帳戶';
                }
                
                // Build amount display based on displayLogic
                // strikethroughAmount: what gets crossed out
                // arrowAmount: what the arrow points to
                // arrowColor: green for good outcome, red for money spent
                let strikethroughAmount = 0;
                let arrowAmount = 0;
                let arrowColor = 'text-wabi-income'; // default green
                
                if (hasDebt && debt && displayLogic.showArrow) {
                    if (displayLogic.arrowToZero) {
                        // 支出+別人欠我, 收入+我欠別人: 原額刪除 → $0 (綠色)
                        strikethroughAmount = record.amount;
                        arrowAmount = 0;
                        arrowColor = 'text-wabi-income';
                    } else {
                        // 收入+別人欠我, 支出+我欠別人: $0刪除 → 原額
                        strikethroughAmount = 0;
                        arrowAmount = record.amount;
                        // 支出+我欠別人 還清後是紅色 (真的花錢了)
                        // 收入+別人欠我 還清後是綠色 (收到錢了)
                        arrowColor = isIncome ? 'text-wabi-income' : 'text-wabi-expense';
                    }
                }
                
                const mainAmount = displayLogic.showZero ? 0 : record.amount;
                const statusLabel = hasDebt 
                    ? (isDebtSettled ? '已還清' : '待還款')
                    : '';
                const statusClass = isDebtSettled ? 'bg-wabi-income/20 text-wabi-income' : 'bg-orange-100 text-orange-600';
                
                // Determine if record should be dimmed:
                // Only dim if the effective value becomes 0 (money cancelled out)
                const shouldDim = hasDebt && isDebtSettled && displayLogic.arrowToZero;

                return `
                    <a ${isTransfer ? '' : `href="#add?id=${record.id}"`} class="record-item flex items-center gap-4 bg-wabi-surface px-2 min-h-[72px] py-2 justify-between rounded-lg border border-wabi-border ${isTransfer ? '' : 'hover:border-wabi-primary transition-colors'} ${shouldDim ? 'opacity-60' : ''}">
                        <div class="flex items-center gap-4">
                            <div class="flex items-center justify-center rounded-lg ${isTransfer ? 'bg-gray-400' : colorClass} text-white shrink-0 size-12" ${isTransfer ? '' : colorStyle}>
                                <i class="${isTransfer ? 'fa-solid fa-money-bill-transfer' : icon} text-2xl"></i>
                            </div>
                            <div class="flex flex-col justify-center">
                                <div class="flex items-center gap-2">
                                    <p class="text-wabi-text-primary text-base font-medium line-clamp-1">${name}</p>
                                    ${hasDebt ? '<i class="fa-solid fa-handshake text-orange-500 text-sm" title="有關聯欠款"></i>' : ''}
                                    ${hasDebt && statusLabel ? `<span class="text-xs ${statusClass} px-1.5 py-0.5 rounded">${statusLabel}</span>` : ''}
                                </div>
                                <p class="text-wabi-text-secondary text-sm font-normal line-clamp-2">${record.description || '無備註'}</p>
                            </div>
                        </div>
                        <div class="shrink-0 text-right">
                            ${displayLogic.showArrow ? `
                                <p class="text-wabi-text-secondary text-base font-medium line-through">
                                    ${isIncome ? '+' : '-'} ${formatCurrency(strikethroughAmount)}
                                </p>
                                <p class="text-xs font-medium ${arrowColor}">
                                    → ${isIncome ? '+' : '-'}${formatCurrency(arrowAmount)}
                                </p>
                            ` : `
                                <p class="${isIncome ? 'text-wabi-income' : 'text-wabi-expense'} text-base font-medium">
                                    ${isIncome ? '+' : '-'} ${formatCurrency(mainAmount)}
                                </p>
                            `}
                            ${this.advancedModeEnabled ? `<p class="text-xs text-wabi-text-secondary">${accountName}</p>` : `<p class="text-xs text-wabi-text-secondary">${formatDate(record.date, 'short')}</p>`}
                        </div>
                    </a>
                `;
            }).join('');
            return dateHeader + recordsHtml;
        }).join('');
    }

    updateSummary(records) {
        const transferRecords = records.filter(r => r.category === 'transfer');
        const normalRecords = records.filter(r => r.category !== 'transfer');
        const excludedTransferIds = new Set();

        // Only proceed if there are potential pairs of transfers to analyze
        if (transferRecords.length > 1) {
            const expenseTransfers = transferRecords.filter(r => r.type === 'expense');
            // Create a mutable copy to splice from
            const incomeTransfers = [...transferRecords.filter(r => r.type === 'income')]; 

            expenseTransfers.forEach(expense => {
                // Find a matching income record within the currently visible records
                const matchingIncomeIndex = incomeTransfers.findIndex(income => 
                    income.amount === expense.amount && 
                    income.date === expense.date
                );

                if (matchingIncomeIndex !== -1) {
                    // A pair is found within the visible records. Exclude both.
                    const income = incomeTransfers[matchingIncomeIndex];
                    excludedTransferIds.add(expense.id);
                    excludedTransferIds.add(income.id);
                    
                    // Remove the matched income so it can't be paired again
                    incomeTransfers.splice(matchingIncomeIndex, 1);
                }
            });
        }

        // Records for summary are normal ones + any transfers that couldn't be paired
        const recordsForSummary = normalRecords.concat(transferRecords.filter(r => !excludedTransferIds.has(r.id)));
        
        const summary = recordsForSummary.reduce((acc, r) => {
            if (r.type === 'income') acc.income += r.amount;
            else acc.expense += r.amount;
            return acc;
        }, { income: 0, expense: 0 });

        this.container.querySelector('#record-count').textContent = recordsForSummary.length;
        this.container.querySelector('#total-income').textContent = formatCurrency(summary.income);
        this.container.querySelector('#total-expense').textContent = formatCurrency(summary.expense);
    }

    showCategoryFilterModal() {
        const categoryNetTotals = this.records.reduce((acc, record) => {
            const { category, type, amount } = record;
            if (!acc[category]) {
                acc[category] = 0;
            }
            acc[category] += (type === 'income' ? amount : -amount);
            return acc;
        }, {});

        const allCategoryIds = [...new Set(this.records.map(r => r.category))];

        const modalHtml = `
            <div id="category-filter-modal" class="fixed inset-0 bg-black/50 z-50 flex justify-center items-end">
                <div class="bg-wabi-bg w-full max-w-lg rounded-t-2xl p-4 flex flex-col max-h-[80vh]">
                    <h3 class="text-lg font-bold text-wabi-primary text-center mb-4">篩選類別</h3>
                    <div class="overflow-y-auto space-y-2 mb-4">
                        ${allCategoryIds.map(catId => {
                            const category = this.categoryManager.getCategoryById('expense', catId) || this.categoryManager.getCategoryById('income', catId);
                            if (!category) return '';
                            const isChecked = this.filters.categories.has(catId);
                            
                            const netTotal = categoryNetTotals[catId] || 0;
                            const isIncome = netTotal > 0;
                            const isZero = netTotal === 0;
                            const amountClass = isZero ? 'text-wabi-text-secondary' : (isIncome ? 'text-wabi-income' : 'text-wabi-expense');
                            const sign = isIncome ? '+' : '-';
                            const formattedAmount = isZero ? formatCurrency(0) : `${sign} ${formatCurrency(Math.abs(netTotal))}`;

                            return `
                                <label class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
                                    <div class="flex items-center">
                                        <input type="checkbox" data-cat-id="${catId}" class="h-5 w-5 rounded text-wabi-primary focus:ring-wabi-primary/50" ${isChecked ? 'checked' : ''}>
                                        <span class="ml-3 text-wabi-text-primary">${category.name}</span>
                                    </div>
                                    <span class="text-sm font-medium ${amountClass}">${formattedAmount}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div class="flex gap-2 mt-auto pt-2 border-t border-wabi-border">
                        <button id="apply-cat-filter" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">套用</button>
                        <button id="close-cat-modal" class="flex-1 py-3 bg-wabi-border text-wabi-text-primary rounded-lg">關閉</button>
                    </div>
                </div>
            </div>
        `;
        this.modalsContainer.innerHTML = modalHtml;

        this.modalsContainer.querySelector('#apply-cat-filter').addEventListener('click', () => {
            const selected = new Set();
            this.modalsContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(el => selected.add(el.dataset.catId));
            this.filters.categories = selected;
            this.applyFiltersAndRender();
            this.modalsContainer.innerHTML = '';
        });
        this.modalsContainer.querySelector('#close-cat-modal').addEventListener('click', () => this.modalsContainer.innerHTML = '');
    }

    showAccountFilterModal() {
        const modalHtml = `
            <div id="account-filter-modal" class="fixed inset-0 bg-black/50 z-50 flex justify-center items-end">
                <div class="bg-wabi-bg w-full max-w-lg rounded-t-2xl p-4 flex flex-col max-h-[80vh]">
                    <h3 class="text-lg font-bold text-wabi-primary text-center mb-4">篩選帳戶</h3>
                    <div class="overflow-y-auto space-y-2 mb-4">
                        ${this.accounts.map(account => {
                            const isChecked = this.filters.accounts.has(String(account.id));
                            return `
                                <label class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
                                    <div class="flex items-center">
                                        <input type="checkbox" data-acc-id="${account.id}" class="h-5 w-5 rounded text-wabi-primary focus:ring-wabi-primary/50" ${isChecked ? 'checked' : ''}>
                                        <span class="ml-3 text-wabi-text-primary">${account.name}</span>
                                    </div>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div class="flex gap-2 mt-auto pt-2 border-t border-wabi-border">
                        <button id="apply-acc-filter" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">套用</button>
                        <button id="close-acc-modal" class="flex-1 py-3 bg-wabi-border text-wabi-text-primary rounded-lg">關閉</button>
                    </div>
                </div>
            </div>
        `;
        this.modalsContainer.innerHTML = modalHtml;

        this.modalsContainer.querySelector('#apply-acc-filter').addEventListener('click', () => {
            const selected = new Set();
            this.modalsContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(el => selected.add(el.dataset.accId));
            this.filters.accounts = selected;
            this.applyFiltersAndRender();
            this.modalsContainer.innerHTML = '';
        });
        this.modalsContainer.querySelector('#close-acc-modal').addEventListener('click', () => this.modalsContainer.innerHTML = '');
    }

    showDateRangeModal() {
        const modal = createDateRangeModal({
            initialStartDate: this.filters.customStartDate,
            initialEndDate: this.filters.customEndDate,
            onApply: (start, end) => {
                this.filters.period = 'custom';
                this.filters.customStartDate = start;
                this.filters.customEndDate = end;
                this.updatePeriodButtons();
                this.loadAndRenderRecords();
            }
        });
        this.modalsContainer.appendChild(modal);
    }
}

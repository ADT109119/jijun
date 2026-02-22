import { formatCurrency, formatDate, showToast, getDateRange, formatDateToString, getMonthRange } from '../utils.js';

export class HomePage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <button id="home-month-selector-btn" class="text-2xl font-bold text-wabi-primary bg-transparent border-0 focus:ring-0 flex items-center gap-2">
                        <span id="home-month-display"></span>
                        <i class="fa-solid fa-chevron-down text-base"></i>
                    </button>
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-gear text-xl"></i>
                    </a>
                </div>

                <!-- Balance Card -->
                <div class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8">
                    <p class="text-center text-wabi-text-secondary text-base font-medium">本月結餘</p>
                    <p id="home-balance" class="text-center text-wabi-primary text-4xl font-bold tracking-tight mt-1">$0</p>
                    <div class="flex justify-around pt-6 mt-4 border-t border-wabi-border">
                        <div class="text-center">
                            <p class="text-sm text-wabi-text-secondary">總收入</p>
                            <p id="home-income" class="text-lg font-bold text-wabi-income">$0</p>
                        </div>
                        <div class="text-center">
                            <p class="text-sm text-wabi-text-secondary">總支出</p>
                            <p id="home-expense" class="text-lg font-bold text-wabi-expense">$0</p>
                        </div>
                    </div>
                </div>

                <!-- Budget Widget -->
                <div id="budget-widget-container"></div>

                <!-- Plugin Widgets -->
                <div class="flex items-center justify-between mb-2 mt-6">
                     <h3 class="text-sm font-bold text-wabi-text-secondary">小工具</h3>
                     <button id="manage-widgets-btn" class="text-xs text-wabi-primary hover:underline bg-wabi-primary/10 px-2 py-1 rounded">
                        <i class="fa-solid fa-sort mr-1"></i>調整順序
                     </button>
                </div>
                <div id="plugin-home-widgets" class="mb-6"></div>

                <!-- Recent Transactions -->
                <div>
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-wabi-primary">最近紀錄</h3>
                        <a href="#records" class="text-sm font-medium text-wabi-accent hover:underline">查看全部</a>
                    </div>
                    <div id="recent-records-container" class="space-y-2"></div>
                </div>
            </div>
        `;
        this.setupEventListeners();
        await this.populateHomeMonthFilter();
        this.app.pluginManager.renderHomeWidgets(document.getElementById('plugin-home-widgets'));

        // Manage Widgets Handler
        const manageWidgetsBtn = document.getElementById('manage-widgets-btn');
        if (manageWidgetsBtn) {
            manageWidgetsBtn.addEventListener('click', () => this.showWidgetOrderModal());
        }

        await this.loadHomePageData();
    }

    setupEventListeners() {
        const monthSelectorBtn = document.getElementById('home-month-selector-btn');
        if (monthSelectorBtn) {
            monthSelectorBtn.addEventListener('click', () => {
                const currentMonthDisplay = document.getElementById('home-month-display').textContent;
                const [year, month] = currentMonthDisplay.split(' / ').map(Number);
                this.showMonthYearPickerModal(year, month - 1, (newMonthString) => {
                    this.loadHomePageData(newMonthString);
                });
            });
        }
    }

    async populateHomeMonthFilter() {
        const allRecords = await this.app.dataService.getRecords();
        const months = [...new Set(allRecords.map(r => r.date.slice(0, 7)))].sort().reverse();

        const currentMonth = formatDateToString(new Date()).slice(0, 7);
        if (!months.includes(currentMonth)) {
            months.unshift(currentMonth);
        }

        // Update the display for the new button
        const monthDisplay = document.getElementById('home-month-display');
        if (monthDisplay) {
            monthDisplay.textContent = currentMonth.replace('-', ' / ');
        }
    }

    async loadHomePageData(selectedMonthString = null) {
        const selectedMonth = selectedMonthString || document.getElementById('home-month-display').textContent.replace(' / ', '-');

        const year = parseInt(selectedMonth.split('-')[0]);
        const month = parseInt(selectedMonth.split('-')[1]) - 1;
        const { startDate, endDate } = getMonthRange(year, month);

        const stats = await this.app.dataService.getStatistics(startDate, endDate, null, true); // Exclude transfers from totals

        let allRecords = await this.app.dataService.getRecords();
        const recentRecords = allRecords.slice(0, 5);

        const balanceCardTitle = document.querySelector('.page.active .bg-wabi-surface p:first-child');
        if (balanceCardTitle) {
            balanceCardTitle.textContent = `${selectedMonth.replace('-', ' / ')} 結餘`;
        }

        document.getElementById('home-balance').textContent = formatCurrency(stats.totalIncome - stats.totalExpense);
        document.getElementById('home-income').textContent = formatCurrency(stats.totalIncome);
        document.getElementById('home-expense').textContent = formatCurrency(stats.totalExpense);

        const container = document.getElementById('recent-records-container');
        if (recentRecords.length === 0) {
            container.innerHTML = `<p class="text-center text-wabi-text-secondary py-4">還沒有任何紀錄喔！</p>`;
        } else {
            container.innerHTML = recentRecords.map(record => {
                const isIncome = record.type === 'income';
                let icon, name, color;

                if (record.category === 'transfer') {
                    icon = 'fa-solid fa-money-bill-transfer';
                    name = '帳戶間轉帳';
                    color = 'bg-gray-400';
                } else {
                    const category = this.app.categoryManager.getCategoryById(record.type, record.category);
                    icon = category?.icon || 'fa-solid fa-question';
                    name = category?.name || '未分類';
                    color = category?.color || 'bg-gray-400';
                }

                const colorStyle = color.startsWith('#') ? `style="background-color: ${color}"` : '';
                const colorClass = !color.startsWith('#') ? color : '';

                return `
                    <div class="flex items-center gap-4 bg-wabi-surface px-4 py-3 rounded-lg border border-wabi-border">
                        <div class="flex items-center justify-center rounded-lg ${colorClass} text-white shrink-0 size-12" ${colorStyle}>
                            <i class="${icon} text-2xl"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-wabi-text-primary truncate">${name}</p>
                            <p class="text-sm text-wabi-text-secondary line-clamp-2 break-all">${record.description || formatDate(record.date, 'short')}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-medium ${isIncome ? 'text-wabi-income' : 'text-wabi-expense'}">${isIncome ? '+' : '-'} ${formatCurrency(record.amount)}</p>
                            <p class="text-xs text-wabi-text-secondary">${formatDate(record.date, 'short')}</p>
                        </div>
                    </div>
                `;
            }).join('');
        }

        this.loadBudgetWidget();
    }

    async loadBudgetWidget() {
        const container = document.getElementById('budget-widget-container');
        if (!container) return;
        container.innerHTML = await this.app.budgetManager.renderBudgetWidget();
        // Re-bind events for the new widget content
        const editBudgetBtn = document.getElementById('edit-budget-btn');
        if (editBudgetBtn) {
            editBudgetBtn.addEventListener('click', () => this.app.budgetManager.showBudgetModal());
        }
        const setBudgetBtn = document.getElementById('set-budget-btn');
        if (setBudgetBtn) {
            setBudgetBtn.addEventListener('click', () => this.app.budgetManager.showBudgetModal());
        }
    }

    showMonthYearPickerModal(initialYear, initialMonthIndex, onApply) {
        const modal = document.createElement('div');
        modal.id = 'month-year-picker-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

        let selectedYear = initialYear;
        let selectedMonth = initialMonthIndex + 1; // 1-indexed month

        const renderModalContent = () => {
            modal.innerHTML = `
                <div class="bg-wabi-bg rounded-lg max-w-xs w-full p-6">
                    <h3 class="text-lg font-semibold mb-4 text-wabi-primary text-center">選擇月份</h3>
                    <!-- Year Navigation -->
                    <div class="flex items-center justify-between mb-6">
                        <button id="prev-year" class="p-2 rounded-full hover:bg-gray-200/50 text-wabi-primary">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span id="current-year" class="text-xl font-bold text-wabi-primary">${selectedYear}年</span>
                        <button id="next-year" class="p-2 rounded-full hover:bg-gray-200/50 text-wabi-primary">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    <!-- Month Grid -->
                    <div id="month-grid" class="grid grid-cols-3 gap-3 mb-6">
                        ${Array.from({ length: 12 }, (_, i) => {
                            const monthNum = i + 1;
                            const isActive = monthNum === selectedMonth ? 'bg-wabi-accent text-wabi-primary' : 'bg-wabi-surface text-wabi-text-primary';
                            return `<button data-month="${monthNum}" class="month-btn p-3 rounded-lg font-medium ${isActive}">${monthNum}月</button>`;
                        }).join('')}
                    </div>
                    <div class="flex justify-end">
                        <button id="cancel-month-year" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
                    </div>
                </div>
            `;

            // Attach event listeners after rendering content
            modal.querySelector('#prev-year').addEventListener('click', () => {
                selectedYear--;
                renderModalContent();
            });
            modal.querySelector('#next-year').addEventListener('click', () => {
                selectedYear++;
                renderModalContent();
            });
            modal.querySelectorAll('.month-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    selectedMonth = parseInt(e.target.dataset.month);
                    const newMonthString = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

                    // Update the display and call the callback
                    document.getElementById('home-month-display').textContent = newMonthString.replace('-', ' / ');
                    if (onApply) {
                        onApply(newMonthString);
                    }
                    modal.remove();
                });
            });
            modal.querySelector('#cancel-month-year').addEventListener('click', () => {
                modal.remove();
            });
        };

        renderModalContent(); // Initial render
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    showWidgetOrderModal() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 animation-fade-in';

        const renderList = () => {
            const order = this.app.pluginManager.widgetOrder;
            const activeWidgets = order.filter(id => this.app.pluginManager.homeWidgets.has(id));

            if (activeWidgets.length === 0) return '<p class="text-center text-gray-400 py-4">無可用的小工具</p>';

            return activeWidgets.map((id, index) => {
                const name = this.app.pluginManager.getPluginName(id) || '未知小工具';
                return `
                   <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2 transition-all">
                       <span class="font-medium text-gray-700">${name}</span>
                       <div class="flex gap-1">
                           <button class="p-2 text-gray-400 hover:text-wabi-primary move-widget-btn hover:bg-white rounded-md transition-colors" data-id="${id}" data-dir="-1" ${index === 0 ? 'disabled class="p-2 text-gray-200 cursor-not-allowed"' : ''}>
                                <i class="fa-solid fa-arrow-up"></i>
                           </button>
                           <button class="p-2 text-gray-400 hover:text-wabi-primary move-widget-btn hover:bg-white rounded-md transition-colors" data-id="${id}" data-dir="1" ${index === activeWidgets.length - 1 ? 'disabled class="p-2 text-gray-200 cursor-not-allowed"' : ''}>
                                <i class="fa-solid fa-arrow-down"></i>
                           </button>
                       </div>
                   </div>
                `;
            }).join('');
        };

        const updateContent = () => {
            const listContainer = modal.querySelector('#widget-order-list');
            if(listContainer) {
                listContainer.innerHTML = renderList();
                bindEvents();
            }
        }

        modal.innerHTML = `
            <div class="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl transform transition-all scale-100 flex flex-col max-h-[80vh]">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold text-gray-800">調整顯示順序</h3>
                    <button id="close-widget-modal" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times text-xl"></i>
                    </button>
                </div>
                <div id="widget-order-list" class="overflow-y-auto flex-1 mb-4">
                    ${renderList()}
                </div>
                <div class="mt-auto pt-2 border-t border-gray-100">
                     <p class="text-xs text-center text-gray-400">點擊箭頭調整順序</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => {
            modal.remove();
            // Re-render home widgets to reflect changes immediately
            this.app.pluginManager.renderHomeWidgets(document.getElementById('plugin-home-widgets'));
        };

        modal.querySelector('#close-widget-modal').addEventListener('click', close);

        const bindEvents = () => {
            modal.querySelectorAll('.move-widget-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = btn.dataset.id;
                    const dir = parseInt(btn.dataset.dir);
                    await this.app.pluginManager.moveWidget(id, dir);
                    updateContent();
                });
            });
        };
        bindEvents();
    }
}

import DataService from './dataService.js';
import { getCategoryName, getCategoryIcon } from './categories.js';
import { formatCurrency, formatDate, showToast, getDateRange, formatDateToString, getMonthRange } from './utils.js';
import { StatisticsManager } from './statistics.js';
import { RecordsListManager } from './recordsList.js';
import { BudgetManager } from './budgetManager.js';
import { CategoryManager } from './categoryManager.js';
import { ChangelogManager } from './changelog.js';

class EasyAccountingApp {
    constructor() {
        this.dataService = new DataService();
        this.categoryManager = new CategoryManager();
        this.changelogManager = new ChangelogManager();
        this.budgetManager = new BudgetManager(this.dataService, this.categoryManager);

        this.appContainer = document.getElementById('app-container');
        this.navItems = document.querySelectorAll('.nav-item');
        this.bottomNav = document.getElementById('bottom-nav');

        this.currentHash = null;
        this.currentChart = null;
        this.deferredInstallPrompt = null;

        this.init();
    }

    async init() {
        await this.dataService.init();
        this.setupEventListeners();
        this.handleRouteChange();
        this.registerServiceWorker();

        window.addEventListener('beforeinstallprompt', (e) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            this.deferredInstallPrompt = e;
            // Update UI to notify the user they can install the PWA
            const installBtnContainer = document.getElementById('install-pwa-btn-container');
            if (installBtnContainer) {
                installBtnContainer.classList.remove('hidden');
            }
        });

        // Hide install button if already in standalone mode
        if (window.matchMedia('(display-mode: standalone)').matches) {
            const installBtnContainer = document.getElementById('install-pwa-btn-container');
            if (installBtnContainer) {
                installBtnContainer.classList.add('hidden');
            }
        }
    }

    setupEventListeners() {
        window.addEventListener('hashchange', () => this.handleRouteChange());
    }

    handleRouteChange() {
        const hash = window.location.hash || '#home';
        if (hash === this.currentHash) return;
        this.currentHash = hash;

        const [page, query] = hash.substring(1).split('?');
        const params = new URLSearchParams(query);
        const recordId = params.get('id');

        this.updateActiveNavItem(page);

        switch (page) {
            case 'home':
                this.renderHomePage();
                break;
            case 'records':
                this.renderRecordsPage();
                break;
            case 'add':
                this.renderAddPage(recordId);
                break;
            case 'stats':
                this.renderStatsPage();
                break;
            case 'settings':
                this.renderSettingsPage();
                break;
            default:
                window.location.hash = 'home';
                break;
        }
    }

    updateActiveNavItem(activePage) {
        this.navItems.forEach(item => {
            if (item.dataset.page === activePage) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    // --- Page Renderers ---

    async renderHomePage() {
        this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24">
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
        this.setupHomePageEventListeners();
        await this.populateHomeMonthFilter();
        await this.loadHomePageData();
    }

    async renderRecordsPage() {
        this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24">
                <!-- Header -->
                <div class="flex items-center pb-2 justify-between">
                    <h1 class="text-wabi-primary text-xl font-bold text-center flex-1">記帳紀錄</h1>
                </div>

                <!-- Period Filter (Date Filter) - New Row -->
                <div id="records-period-filter" class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mb-4">
                    <button data-period="week" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">週</button>
                    <button data-period="month" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">月</button>
                    <button data-period="year" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">年</button>
                    <button data-period="custom" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">自訂</button>
                </div>

                <!-- Type & Category Filters -->
                <div class="flex gap-2 py-2 overflow-x-auto">
                    <div id="records-type-filter" class="flex items-center justify-center rounded-lg bg-gray-200/50 p-1">
                        <button data-type="all" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">全部</button>
                        <button data-type="expense" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">支出</button>
                        <button data-type="income" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">收入</button>
                    </div>
                    <button id="records-category-filter-btn" class="h-9 shrink-0 flex items-center justify-center gap-x-1.5 rounded-full bg-white px-4 border border-gray-200">
                        <p class="text-wabi-text-primary text-sm font-medium leading-normal">類別</p>
                        <i class="fa-solid fa-chevron-down text-xs text-wabi-text-secondary"></i>
                    </button>
                </div>

                <!-- Summary Cards -->
                <div class="grid grid-cols-3 gap-3 my-4">
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-text-secondary">筆數</div>
                        <div id="record-count" class="text-lg font-bold text-wabi-primary">0</div>
                    </div>
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-income">收入</div>
                        <div id="total-income" class="text-lg font-bold text-wabi-income">$0</div>
                    </div>
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-expense">支出</div>
                        <div id="total-expense" class="text-lg font-bold text-wabi-expense">$0</div>
                    </div>
                </div>

                <!-- Transaction List -->
                <div id="records-list-container" class="flex flex-col space-y-1"></div>

                <!-- Modals -->
                <div id="records-modals-container"></div>
            </div>
        `;
        const pageElement = this.appContainer.querySelector('.page');
        this.recordsListManager = new RecordsListManager(this.dataService, this.categoryManager, pageElement);
        this.recordsListManager.init();
    }

    async renderAddPage(recordId) {
        const isEditMode = !!recordId;
        this.appContainer.innerHTML = `
            <div class="page active p-4 pb-48"> <!-- Add padding-bottom to avoid overlap with fixed keypad -->
                <!-- Header -->
                <div class="flex items-center pb-2 justify-between">
                    <a href="#home" class="flex size-12 shrink-0 items-center justify-center">
                        <i class="fa-solid fa-xmark text-2xl text-wabi-text-primary"></i>
                    </a>
                    <h2 class="text-lg font-bold flex-1 text-center pr-12">${isEditMode ? '編輯紀錄' : '新增紀錄'}</h2>
                    ${isEditMode ? '<button id="delete-record-btn" class="text-wabi-expense"><i class="fa-solid fa-trash-can"></i></button>' : ''}
                </div>

                <!-- Type Switcher & Amount -->
                <div class="px-4">
                    <div class="flex h-11 w-full items-center justify-center rounded-lg bg-gray-200/80 p-1 mb-4">
                        <button id="add-type-expense" class="flex-1 h-full rounded-md text-sm font-medium">支出</button>
                        <button id="add-type-income" class="flex-1 h-full rounded-md text-sm font-medium">收入</button>
                    </div>
                    <div class="flex items-center justify-between py-4">
                        <div id="add-selected-category" class="flex items-center gap-4">
                            <div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12">
                                <i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i>
                            </div>
                            <p class="text-lg font-medium">選擇分類</p>
                        </div>
                        <div id="add-amount-display" class="text-wabi-expense tracking-light text-5xl font-bold">$0</div>
                    </div>
                </div>

                <!-- Categories -->
                <div id="add-category-grid" class="px-4 mt-2 grid grid-cols-4 gap-4"></div>

            </div>
            <!-- Note, Date, and Keypad -->
            <div id="keypad-container" class="fixed bottom-20 left-0 right-0 bg-gray-200/80 text-wabi-primary z-20 transform translate-y-full transition-transform duration-300 ease-in-out">
                <div class="flex items-center px-4 py-2 gap-2">
                    <label class="relative flex items-center gap-2 p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-calendar-days text-wabi-text-secondary"></i>
                        <span id="add-date-display" class="text-sm font-medium">${formatDate(formatDateToString(new Date()), 'short')}</span>
                        <input type="date" id="add-date-input" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                    </label>
                    <input id="add-note-input" class="w-full rounded-lg border-gray-300 bg-white/80 placeholder:text-wabi-text-secondary focus:border-wabi-primary focus:ring-wabi-primary" placeholder="新增備註" type="text"/>
                    <button id="keypad-toggle-btn" class="p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-keyboard"></i>
                    </button>
                </div>
                <div id="keypad-grid" class="grid grid-cols-4 gap-px bg-gray-200/80">
                    ${['1', '2', '3', 'backspace', '4', '5', '6', 'save', '7', '8', '9', 'done', '.', '0', '00', ''].map(k => this.createKeypadButton(k, isEditMode)).join('')}
                </div>
            </div>
        `;
        this.setupAddPageListeners(recordId);
    }

    async renderStatsPage() {
        this.appContainer.innerHTML = `
            <div class="page active">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">收支分析</h1>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <div id="stats-container"></div>
                </main>
            </div>
        `;
        this.statisticsManager = new StatisticsManager(this.dataService, this.categoryManager);
        this.statisticsManager.renderStatisticsPage(document.getElementById('stats-container'));
    }

    async renderSettingsPage() {
        this.appContainer.innerHTML = `
            <div class="page active">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">設定</h2>
                </div>
                <div class="p-4 space-y-6">
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">應用程式</h3>
                        ${this.createSettingItem('fa-solid fa-cloud-arrow-down', '強制更新', 'force-update-btn')}
                        ${this.createSettingItem('fa-solid fa-share-nodes', '分享此 App', 'share-app-btn')}
                        <div id="install-pwa-btn-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-mobile-screen-button', '安裝為應用程式', 'install-pwa-btn')}
                        </div>
                    </div>

                    <!-- Data Management -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">資料管理</h3>
                        ${this.createSettingItem('fa-solid fa-download', '匯出資料', 'export-data-btn')}
                        ${this.createSettingItem('fa-solid fa-upload', '匯入資料', 'import-data-btn')}
                        <input type="file" id="import-file-input" accept=".json" class="hidden">
                    </div>
                    <!-- App Info -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">關於</h3>
                        ${this.createSettingItem('fa-solid fa-arrows-rotate', '檢查更新', 'check-update-btn')}
                        ${this.createSettingItem('fa-solid fa-file-lines', '更新日誌', 'changelog-btn')}
                        <a href="https://github.com/ADT109119/jijun" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-gray-100/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-brands fa-github"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">GitHub 儲存庫</p>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-chevron-right"></i>
                            </div>
                        </a>
                        <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
                        <div id="version-info" class="px-4 py-3 text-xs text-center text-wabi-text-secondary"></div>
                    </div>
                </div>
            </div>
        `;
        this.setupSettingsPageListeners();
    }

    // --- Page Loaders & Setup ---

    async populateHomeMonthFilter() {
        const allRecords = await this.dataService.getRecords();
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

        const stats = await this.dataService.getStatistics(startDate, endDate);
        const allRecords = await this.dataService.getRecords();
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
                const category = this.categoryManager.getCategoryById(record.type, record.category);
                const icon = category?.icon || 'fa-solid fa-question';
                const name = category?.name || '未分類';
                const color = category?.color || 'bg-gray-400';

                return `
                    <div class="flex items-center gap-4 bg-wabi-surface px-4 py-3 rounded-lg border border-wabi-border">
                        <div class="flex items-center justify-center rounded-lg ${color} text-white shrink-0 size-12">
                            <i class="${icon} text-2xl"></i>
                        </div>
                        <div class="flex-1">
                            <p class="font-medium text-wabi-text-primary">${name}</p>
                            <p class="text-sm text-wabi-text-secondary">${record.description || formatDate(record.date, 'short')}</p>
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
        container.innerHTML = await this.budgetManager.renderBudgetWidget();
        // Re-bind events for the new widget content
        const editBudgetBtn = document.getElementById('edit-budget-btn');
        if (editBudgetBtn) {
            editBudgetBtn.addEventListener('click', () => this.budgetManager.showBudgetModal());
        }
        const setBudgetBtn = document.getElementById('set-budget-btn');
        if (setBudgetBtn) {
            setBudgetBtn.addEventListener('click', () => this.budgetManager.showBudgetModal());
        }
    }

    setupHomePageEventListeners() {
        const monthSelectorBtn = document.getElementById('home-month-selector-btn');
        if (monthSelectorBtn) {
            monthSelectorBtn.addEventListener('click', () => {
                const currentMonthDisplay = document.getElementById('home-month-display').textContent;
                const [year, month] = currentMonthDisplay.split(' / ').map(Number);
                this.showMonthYearPickerModal(year, month - 1); // monthIndex is 0-indexed
            });
        }
    }

    showMonthYearPickerModal(initialYear, initialMonthIndex) {
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
                    
                    // Update the display and reload data
                    document.getElementById('home-month-display').textContent = newMonthString.replace('-', ' / ');
                    this.loadHomePageData(newMonthString); // Pass the selected month string
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

    setupSettingsPageListeners() {
        document.getElementById('export-data-btn').addEventListener('click', async () => {
            try {
                await this.dataService.exportData();
                showToast('資料已成功匯出！', 'success');
            } catch (error) {
                console.error('匯出失敗:', error);
                showToast('資料匯出失敗', 'error');
            }
        });

        const importFileInput = document.getElementById('import-file-input');
        document.getElementById('import-data-btn').addEventListener('click', () => {
            importFileInput.click();
        });

        importFileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            if (confirm('匯入資料將會覆蓋所有現有紀錄，確定要繼續嗎？')) {
                try {
                    await this.dataService.importData(file);
                    showToast('資料已成功匯入！正在重整...', 'success');
                    setTimeout(() => window.location.reload(), 2000);
                } catch (error) {
                    console.error('匯入失敗:', error);
                    showToast('資料匯入失敗', 'error');
                }
            }
        });

        document.getElementById('check-update-btn').addEventListener('click', () => this.checkForUpdates());
        document.getElementById('changelog-btn').addEventListener('click', () => this.changelogManager.showChangelogModal());

        // New Listeners
        document.getElementById('force-update-btn').addEventListener('click', () => this.forceUpdate());

        const installBtn = document.getElementById('install-pwa-btn');
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (this.deferredInstallPrompt) {
                    this.deferredInstallPrompt.prompt();
                    const { outcome } = await this.deferredInstallPrompt.userChoice;
                    console.log(`User response to the install prompt: ${outcome}`);
                    this.deferredInstallPrompt = null;
                    document.getElementById('install-pwa-btn-container').classList.add('hidden');
                }
            });
        }

        const shareBtn = document.getElementById('share-app-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                if (navigator.share) {
                    navigator.share({
                        title: '輕鬆記帳',
                        text: '快來試試這款簡單好用的記帳 App！',
                        url: window.location.origin,
                    })
                    .then(() => console.log('Successful share'))
                    .catch((error) => console.log('Error sharing', error));
                } else {
                    showToast('您的瀏覽器不支援分享功能', 'warning');
                }
            });
        }

        const versionInfo = document.getElementById('version-info');
        if (versionInfo) {
            const latestVersion = this.changelogManager.getAllVersions()[0];
            versionInfo.textContent = `版本 v${latestVersion.version}`;
        }
    }

    async setupAddPageListeners(recordId) {
        const isEditMode = !!recordId;
        let recordToEdit = null;

        let currentType = 'expense';
        let currentAmount = '0';
        let selectedCategory = null;
        let currentDate = formatDateToString(new Date());
        let keypadGridOpen = true; // Keypad grid is open by default

        const amountDisplay = document.getElementById('add-amount-display');
        const categoryGrid = document.getElementById('add-category-grid');
        const selectedCategoryUI = document.getElementById('add-selected-category');
        const noteInput = document.getElementById('add-note-input');
        const dateInput = document.getElementById('add-date-input');
        const dateDisplay = document.getElementById('add-date-display');
        const keypadContainer = document.getElementById('keypad-container');
        const keypadGrid = document.getElementById('keypad-grid');
        const keypadToggleBtn = document.getElementById('keypad-toggle-btn');
        const expenseBtn = document.getElementById('add-type-expense');
        const incomeBtn = document.getElementById('add-type-income');

        const toggleKeypadGrid = (force) => {
            const shouldOpen = force === undefined ? !keypadGridOpen : force;
            if (shouldOpen) {
                keypadGrid.style.display = 'grid';
                keypadToggleBtn.classList.add('bg-wabi-accent', 'text-wabi-primary');
            } else {
                keypadGrid.style.display = 'none';
                keypadToggleBtn.classList.remove('bg-wabi-accent', 'text-wabi-primary');
            }
            keypadGridOpen = shouldOpen;
        };

        // Show the whole keypad container bar
        keypadContainer.classList.remove('translate-y-full');

        const updateTypeUI = () => {
            if (currentType === 'expense') {
                expenseBtn.classList.add('bg-wabi-expense', 'text-white', 'shadow-sm');
                incomeBtn.classList.remove('bg-wabi-income', 'text-white', 'shadow-sm');
                amountDisplay.classList.remove('text-wabi-income');
                amountDisplay.classList.add('text-wabi-expense');
            } else {
                incomeBtn.classList.add('bg-wabi-income', 'text-white', 'shadow-sm');
                expenseBtn.classList.remove('bg-wabi-expense', 'text-white', 'shadow-sm');
                amountDisplay.classList.remove('text-wabi-expense');
                amountDisplay.classList.add('text-wabi-income');
            }
            renderCategories();
            const category = this.categoryManager.getCategoryById(currentType, selectedCategory);
            updateSelectedCategoryUI(category);
        };

        const renderCategories = () => {
            categoryGrid.innerHTML = '';
            const categories = this.categoryManager.getAllCategories(currentType);
            categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'category-button flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-transparent';
                btn.dataset.categoryId = cat.id;
                if (cat.id === selectedCategory) {
                    btn.classList.add(currentType === 'income' ? 'active-income' : 'active');
                }
                btn.innerHTML = `
                    <div class="flex size-14 items-center justify-center rounded-full ${cat.color} text-white">
                        <i class="${cat.icon} text-3xl"></i>
                    </div>
                    <p class="text-xs text-center text-wabi-text-secondary">${cat.name}</p>
                `;
                btn.addEventListener('click', () => {
                    selectedCategory = cat.id;
                    updateSelectedCategoryUI(cat);
                    document.querySelectorAll('.category-button').forEach(b => b.classList.remove('active', 'active-income'));
                    btn.classList.add(currentType === 'income' ? 'active-income' : 'active');
                });
                categoryGrid.appendChild(btn);
            });
            const manageBtn = document.createElement('button');
            manageBtn.className = 'flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-dashed border-wabi-border hover:border-wabi-primary';
            manageBtn.innerHTML = `<div class="flex size-14 items-center justify-center rounded-full bg-wabi-bg"><i class="fa-solid fa-gear text-3xl text-wabi-text-secondary"></i></div><p class="text-xs text-center text-wabi-text-secondary">管理</p>`;
            manageBtn.addEventListener('click', () => this.categoryManager.showManageCategoriesModal(currentType, renderCategories));
            categoryGrid.appendChild(manageBtn);
        };

        const updateSelectedCategoryUI = (category) => {
            if (category) {
                selectedCategoryUI.innerHTML = `
                    <div class="flex items-center justify-center rounded-full ${category.color} text-white shrink-0 size-12">
                        <i class="${category.icon} text-3xl"></i>
                    </div>
                    <p class="text-lg font-medium flex-1 truncate">${category.name}</p>
                `;
            } else {
                selectedCategoryUI.innerHTML = `<div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12"><i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i></div><p class="text-lg font-medium">選擇分類</p>`;
            }
        };

        const handleKeypad = async (key) => {
            if (key >= '0' && key <= '9' || key === '00') {
                if (currentAmount === '0') currentAmount = '';
                if (currentAmount.replace('.', '').length < 9) currentAmount += key;
            } else if (key === '.') {
                if (!currentAmount.includes('.')) currentAmount += '.';
            } else if (key === 'backspace') {
                currentAmount = currentAmount.slice(0, -1) || '0';
            } else if (key === 'done') {
                toggleKeypadGrid(false);
            } else if (key === 'save') {
                const amount = parseFloat(currentAmount);
                if (amount > 0 && selectedCategory) {
                    const recordData = {
                        type: currentType,
                        category: selectedCategory,
                        amount: amount,
                        description: noteInput.value,
                        date: currentDate
                    };
                    if (isEditMode) {
                        await this.dataService.updateRecord(parseInt(recordId, 10), recordData);
                        showToast('更新成功！');
                    } else {
                        await this.dataService.addRecord(recordData);
                        showToast('儲存成功！');
                    }
                    window.location.hash = 'records'; // Go to records page after save/update
                } else {
                    showToast('請輸入金額並選擇分類', 'error');
                }
            }
            amountDisplay.textContent = formatCurrency(currentAmount);
        };

        if (isEditMode) {
            const numericRecordId = parseInt(recordId, 10);
            const records = await this.dataService.getRecords();
            recordToEdit = records.find(r => r.id === numericRecordId);
            if (recordToEdit) {
                currentType = recordToEdit.type;
                currentAmount = String(recordToEdit.amount);
                selectedCategory = recordToEdit.category;
                currentDate = recordToEdit.date;
                noteInput.value = recordToEdit.description;

                amountDisplay.textContent = formatCurrency(currentAmount);
                dateDisplay.textContent = formatDate(currentDate, 'short');
                dateInput.value = currentDate;
            }
        }

        // --- Event Listeners ---
        keypadToggleBtn.addEventListener('click', () => toggleKeypadGrid());

        dateInput.addEventListener('change', (e) => {
            currentDate = e.target.value;
            dateDisplay.textContent = formatDate(currentDate, 'short');
        });

        document.querySelectorAll('.keypad-btn').forEach(btn => {
            btn.addEventListener('click', () => handleKeypad(btn.dataset.key));
        });

        expenseBtn.addEventListener('click', () => { if (!isEditMode) { currentType = 'expense'; updateTypeUI(); } });
        incomeBtn.addEventListener('click', () => { if (!isEditMode) { currentType = 'income'; updateTypeUI(); } });

        if (isEditMode) {
            document.getElementById('delete-record-btn').addEventListener('click', async () => {
                if (confirm('確定要刪除這筆紀錄嗎？')) {
                    await this.dataService.deleteRecord(parseInt(recordId, 10));
                    showToast('紀錄已刪除');
                    window.location.hash = 'records';
                }
            });
        }

        // Initial State
        updateTypeUI();
        toggleKeypadGrid(true); // Open by default
    }

    createKeypadButton(key, isEditMode = false) {
        let content = key;
        if (key === 'backspace') content = '<i class="fa-solid fa-delete-left"></i>';
        if (key === 'done') content = '<i class="fa-solid fa-check"></i>';
        if (key === 'save') content = isEditMode ? '<span class="font-bold">更新</span>' : '<span class="font-bold">儲存</span>';

        const specialClasses = {
            'save': 'row-span-2 bg-wabi-accent text-wabi-primary',
            'done': 'bg-gray-300/80',
            '': 'bg-transparent'
        }[key] || '';

        if (key === '') return `<div class="${specialClasses}"></div>`;

        return `
            <button data-key="${key}" class="keypad-btn text-2xl py-4 text-center rounded-none transition-colors duration-200 ease-in-out ${specialClasses} hover:bg-gray-300/80">
                ${content}
            </button>
        `;
    }

    createSettingItem(icon, text, id) {
        return `
            <button id="${id}" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-gray-100/50">
                <div class="flex items-center gap-4">
                    <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                        <i class="${icon}"></i>
                    </div>
                    <p class="text-wabi-text-primary text-base font-normal">${text}</p>
                </div>
                <div class="shrink-0 text-wabi-text-secondary">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
            <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
        `.trim();
    }

    async checkForUpdates() {
        if (!('serviceWorker' in navigator)) {
            showToast('瀏覽器不支援自動更新', 'warning');
            return;
        }
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
            showToast('Service Worker 未註冊', 'error');
            return;
        }

        showToast('正在檢查更新...');
        await registration.update();

        if (registration.waiting) {
            this.showUpdateAvailable(registration);
        } else {
            showToast('已是最新版本！', 'success');
        }
    }

    async forceUpdate() {
        if (confirm('確定要強制更新嗎？這將會清除所有快取資料並重新載入 App。')) {
            showToast('強制更新中...');
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
                window.location.reload(true);
            } catch (error) {
                console.error('強制更新失敗:', error);
                showToast('強制更新失敗', 'error');
            }
        }
    }

    showUpdateAvailable(registration) {
        const toast = document.getElementById('toast');
        toast.innerHTML = `
            <span>發現新版本！</span>
            <button id="update-now-btn" class="ml-4 font-bold underline">立即更新</button>
        `;
        toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg toast-show z-50';

        document.getElementById('update-now-btn').addEventListener('click', () => {
            if (registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            toast.classList.replace('toast-show', 'toast-hide');
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/serviceWorker.js');
                console.log('Service Worker registered');

                // Listen for controller change to reload the page
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (refreshing) return;
                    refreshing = true;
                    window.location.reload();
                });

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateAvailable(registration);
                        }
                    });
                });
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new EasyAccountingApp();
});
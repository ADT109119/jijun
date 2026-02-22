import { RecordsListManager } from '../recordsList.js';

export class RecordsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
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
                    <button id="records-account-filter-btn" class="h-9 shrink-0 flex items-center justify-center gap-x-1.5 rounded-full bg-white px-4 border border-gray-200 hidden">
                        <p class="text-wabi-text-primary text-sm font-medium leading-normal">帳戶</p>
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
        const pageElement = this.app.appContainer.querySelector('.page');
        const recordsListManager = new RecordsListManager(this.app.dataService, this.app.categoryManager, pageElement);
        recordsListManager.init();
    }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordsListManager } from '../../src/js/recordsList.js';
import { getDateRange } from '../../src/js/utils.js';

// Mock utils.js for predictable dates
vi.mock('../../src/js/utils.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getDateRange: vi.fn((period) => {
            if (period === 'month') {
                return { startDate: '2026-06-01', endDate: '2026-06-30' };
            }
            if (period === 'week') {
                return { startDate: '2026-06-28', endDate: '2026-07-04' };
            }
            if (period === 'today') {
                return { startDate: '2026-06-30', endDate: '2026-06-30' };
            }
            if (period === 'last7days') {
                return { startDate: '2026-06-24', endDate: '2026-06-30' };
            }
            return { startDate: '2026-06-01', endDate: '2026-06-30' };
        }),
    };
});

function createDOMContainer() {
    const div = document.createElement('div');
    div.innerHTML = `
        <div class="page">
            <button id="prev-period-btn"></button>
            <h1 id="records-header-title"></h1>
            <button id="next-period-btn"></button>
            <input type="text" id="records-search-input">
            <div id="records-period-filter">
                <button class="period-btn" data-period="week">週</button>
                <button class="period-btn" data-period="month">月</button>
                <button class="period-btn" data-period="year">年</button>
                <button class="period-btn" data-period="custom">自訂</button>
            </div>
            <div id="records-type-filter">
                <button class="type-btn" data-type="all"></button>
                <button class="type-btn" data-type="expense"></button>
                <button class="type-btn" data-type="income"></button>
            </div>
            <button id="records-category-filter-btn"></button>
            <button id="records-account-filter-btn" class="hidden"></button>
            <div id="record-count">0</div>
            <div id="total-income">$0</div>
            <div id="total-expense">$0</div>
            <div id="records-list-container"></div>
            <div id="records-modals-container"></div>
        </div>
    `;
    return div.querySelector('.page');
}

function createMockDataService() {
    const settings = {};
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async (key) => {
            return settings[key] ? { key, value: settings[key] } : null;
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value;
            return true;
        }),
        getAccounts: vi.fn().mockResolvedValue([]),
        getRecords: vi.fn().mockResolvedValue([]),
    };
}

describe('RecordsListManager - 明細預設時間範圍', () => {
    let container;
    let dataService;
    let categoryManager;
    let manager;

    beforeEach(() => {
        sessionStorage.clear();
        container = createDOMContainer();
        dataService = createMockDataService();
        categoryManager = {
            getCategories: vi.fn().mockReturnValue([]),
        };
        manager = new RecordsListManager(dataService, categoryManager, container);
    });

    it('預設無任何設定與 Session 快取時，預設為本月', async () => {
        await manager.init();

        expect(manager.filters.period).toBe('month');
        expect(manager.filters.customStartDate).toBe('2026-06-01');
        expect(manager.filters.customEndDate).toBe('2026-06-30');

        const activeBtn = container.querySelector('.period-btn[data-period="month"]');
        expect(activeBtn.classList.contains('bg-wabi-surface')).toBe(true);
    });

    it('設定預設時間為「本週」時，載入本週時間區間並高亮週按鈕', async () => {
        await dataService.saveSetting({ key: 'defaultRecordsPeriod', value: 'week' });
        await manager.init();

        expect(manager.filters.period).toBe('week');
        expect(manager.filters.customStartDate).toBe('2026-06-28');
        expect(manager.filters.customEndDate).toBe('2026-07-04');

        const weekBtn = container.querySelector('.period-btn[data-period="week"]');
        const monthBtn = container.querySelector('.period-btn[data-period="month"]');
        expect(weekBtn.classList.contains('bg-wabi-surface')).toBe(true);
        expect(monthBtn.classList.contains('bg-wabi-surface')).toBe(false);
    });

    it('設定預設時間為「今天」時，載入今天時間並高亮自訂按鈕', async () => {
        await dataService.saveSetting({ key: 'defaultRecordsPeriod', value: 'today' });
        await manager.init();

        expect(manager.filters.period).toBe('today');
        expect(manager.filters.customStartDate).toBe('2026-06-30');
        expect(manager.filters.customEndDate).toBe('2026-06-30');

        const customBtn = container.querySelector('.period-btn[data-period="custom"]');
        expect(customBtn.classList.contains('bg-wabi-surface')).toBe(true);
    });

    it('設定預設時間為「近 7 天」時，載入近 7 天時間並高亮自訂按鈕', async () => {
        await dataService.saveSetting({ key: 'defaultRecordsPeriod', value: 'last7days' });
        await manager.init();

        expect(manager.filters.period).toBe('last7days');
        expect(manager.filters.customStartDate).toBe('2026-06-24');
        expect(manager.filters.customEndDate).toBe('2026-06-30');

        const customBtn = container.querySelector('.period-btn[data-period="custom"]');
        expect(customBtn.classList.contains('bg-wabi-surface')).toBe(true);
    });

    it('設定預設時間為「上次時間範圍」時，載入上次時間範圍紀錄', async () => {
        await dataService.saveSetting({ key: 'defaultRecordsPeriod', value: 'last' });
        await dataService.saveSetting({
            key: 'lastRecordsPeriodState',
            value: {
                period: 'custom',
                customStartDate: '2026-06-10',
                customEndDate: '2026-06-20',
            },
        });

        await manager.init();

        expect(manager.filters.period).toBe('custom');
        expect(manager.filters.customStartDate).toBe('2026-06-10');
        expect(manager.filters.customEndDate).toBe('2026-06-20');

        const customBtn = container.querySelector('.period-btn[data-period="custom"]');
        expect(customBtn.classList.contains('bg-wabi-surface')).toBe(true);
    });

    it('優先讀取 session 暫存的過濾條件，而非預設設定', async () => {
        sessionStorage.setItem('jijun_records_filters', JSON.stringify({
            period: 'week',
            type: 'expense',
            categories: [],
            accounts: [],
            customStartDate: '2026-06-28',
            customEndDate: '2026-07-04',
            searchQuery: '測試搜尋',
        }));

        await dataService.saveSetting({ key: 'defaultRecordsPeriod', value: 'month' });
        await manager.init();

        expect(manager.filters.period).toBe('week');
        expect(manager.filters.customStartDate).toBe('2026-06-28');
        expect(manager.filters.customEndDate).toBe('2026-07-04');
        expect(manager.filters.searchQuery).toBe('測試搜尋');
    });
});

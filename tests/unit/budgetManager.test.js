// ==================== BudgetManager 單元測試 ====================
// 測試重點：預算加載、儲存、預算狀態計算、分類預算排序
// BudgetManager 的 UI 方法 (renderBudgetWidget, showBudgetModal) 不在此測試
// 因為它們依賴完整的 DOM 與 window.app，適合 E2E 測試

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SortableJS (BudgetManager 依賴)
vi.mock('sortablejs', () => ({
    default: class SortableMock {
        constructor(el, opts) { this.el = el; this.opts = opts; }
        destroy() {}
    },
}));

// Mock utils.js 的函數
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn((v) => `NT$${Math.round(v)}`),
    getDateRange: vi.fn((period) => {
        if (period === 'month') {
            return { startDate: '2024-01-01', endDate: '2024-01-31' };
        }
        return { startDate: '2024-01-01', endDate: '2024-01-31' };
    }),
    showToast: vi.fn(),
    escapeHTML: vi.fn((s) => s),
}));

import { BudgetManager } from '../../src/js/budgetManager.js';


// 建立最小化的 DataService mock
function createMockDataService() {
    const settings = {};
    const changes = [];
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async (key) => {
            const s = settings[key];
            return s ? { key: s, value: s } : null;
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value;
            return true;
        }),
        logChange: vi.fn((type, key, val, payload) => {
            changes.push({ type, key, val, payload });
        }),
        getStatistics: vi.fn(async () => ({
            totalExpense: 0,
            totalIncome: 0,
            expenseByCategory: {},
        })),
    };
}


describe('BudgetManager', () => {
    let bm, ds;

    beforeEach(() => {
        localStorage.clear();
        ds = createMockDataService();
        bm = new BudgetManager(ds);
    });

    afterEach(() => {
        bm.closeBudgetModal();
    });


// ==================== Constructor ====================

    describe('constructor', () => {
        it('初始值正確', () => {
            expect(bm.currentBudget).toBe(0);
            expect(bm.categoryBudgets).toEqual({});
            expect(bm.categoryBudgetOrder).toEqual([]);
        });

        it('持有 dataService 引用', () => {
            expect(bm.dataService).toBe(ds);
        });
    });


// ==================== loadBudget ====================

    describe('loadBudget', () => {
        it('無資料時預設為 0', async () => {
            await bm.loadBudget();
            expect(bm.currentBudget).toBe(0);
            expect(bm.categoryBudgets).toEqual({});
        });

        it('從 IndexedDB 讀取預算', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: { monthlyBudget: 10000, categoryBudgets: { 'food': 3000 }, categoryBudgetOrder: ['food'] },
            });

            await bm.loadBudget();

            expect(bm.currentBudget).toBe(10000);
            expect(bm.categoryBudgets).toEqual({ 'food': 3000 });
            expect(bm.categoryBudgetOrder).toEqual(['food']);
        });

        it('從 localStorage fallback 讀取', async () => {
            ds.getSetting.mockResolvedValueOnce(null);
            localStorage.setItem('monthlyBudget_1', '5000');
            localStorage.setItem('categoryBudgets_1', JSON.stringify({ 'transport': 2000 }));
            localStorage.setItem('categoryBudgetOrder_1', JSON.stringify(['transport']));

            await bm.loadBudget();

            expect(bm.currentBudget).toBe(5000);
            expect(bm.categoryBudgets).toEqual({ 'transport': 2000 });
        });

        it('IndexedDB 失敗時不崩潰', async () => {
            ds.getSetting.mockRejectedValueOnce(new Error('DB error'));
            localStorage.clear();

            await bm.loadBudget();

            expect(bm.currentBudget).toBe(0);
            expect(bm.categoryBudgets).toEqual({});
        });

        it('預算值非數字時設為 NaN → 視為 0 以下', async () => {
            ds.getSetting.mockResolvedValueOnce({
                key: 'budget_settings_1',
                value: { monthlyBudget: 'not_a_number', categoryBudgets: {}, categoryBudgetOrder: [] },
            });

            await bm.loadBudget();
            expect(Number.isNaN(bm.currentBudget)).toBe(true); // parseFloat('not_a_number') → NaN
        });
    });


// ==================== saveBudget ====================

    describe('saveBudget', () => {
        it('儲存成功回傳 true', async () => {
            const result = await bm.saveBudget(8000);
            expect(result).toBe(true);
            expect(bm.currentBudget).toBe(8000);
        });

        it('同時儲存分類預算', async () => {
            const cats = { 'food': 3000, 'transport': 2000 };
            const order = ['food', 'transport'];
            const result = await bm.saveBudget(10000, cats, order);

            expect(result).toBe(true);
            expect(bm.categoryBudgets).toEqual(cats);
            expect(bm.categoryBudgetOrder).toEqual(order);
        });

        it('呼叫 dataService.saveSetting 與 logChange', async () => {
            await bm.saveBudget(10000, { 'food': 3000 }, ['food']);

            expect(ds.saveSetting).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: 'budget_settings_1',
                    value: expect.objectContaining({
                        monthlyBudget: 10000,
                        categoryBudgets: { 'food': 3000 },
                    }),
                })
            );
            expect(ds.logChange).toHaveBeenCalled();
        });

        it('skipLog=true 時不呼叫 logChange', async () => {
            await bm.saveBudget(5000, {}, [], true);
            expect(ds.logChange).not.toHaveBeenCalled();
        });

        it('dataService 出錯時回傳 false', async () => {
            ds.saveSetting.mockRejectedValueOnce(new Error('save failed'));
            const result = await bm.saveBudget(10000);
            expect(result).toBe(false);
        });

        it('寫入 localStorage 備份', async () => {
            await bm.saveBudget(7000, { 'food': 2000 }, ['food']);

            expect(localStorage.getItem('monthlyBudget_1')).toBe('7000');
            expect(JSON.parse(localStorage.getItem('categoryBudgets_1'))).toEqual({ 'food': 2000 });
        });
    });


// ==================== getBudgetStatus ====================

    describe('getBudgetStatus', () => {
        it('零預算回傳正確狀態', async () => {
            const status = await bm.getBudgetStatus();
            expect(status.budget).toBe(0);
            expect(status.remaining).toBe(0);
            expect(status.percentage).toBe(0);
            expect(status.isOverBudget).toBe(false);
        });

        it('預算 > 0 且無支出', async () => {
            bm.currentBudget = 10000;
            const status = await bm.getBudgetStatus();

            expect(status.budget).toBe(10000);
            expect(status.spent).toBe(0);
            expect(status.remaining).toBe(10000);
            expect(status.percentage).toBe(0);
        });

        it('支出 < 預算', async () => {
            bm.currentBudget = 10000;
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 6000,
                totalIncome: 15000,
                expenseByCategory: { 'food': 3000 },
            });

            const status = await bm.getBudgetStatus();

            expect(status.spent).toBe(6000);
            expect(status.remaining).toBe(4000);
            expect(status.percentage).toBe(60);
            expect(status.isOverBudget).toBe(false);
        });

        it('支出 > 預算', async () => {
            bm.currentBudget = 5000;
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 7000,
                totalIncome: 0,
                expenseByCategory: {},
            });

            const status = await bm.getBudgetStatus();

            expect(status.isOverBudget).toBe(true);
            expect(status.remaining).toBe(0);
            expect(status.percentage).toBe(100);
        });

        it('分類預算狀態正確計算', async () => {
            bm.currentBudget = 10000;
            bm.categoryBudgets = { 'food': 3000, 'transport': 2000 };
            bm.categoryBudgetOrder = ['food', 'transport'];

            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 5000,
                totalIncome: 0,
                expenseByCategory: { 'food': 2500, 'transport': 1800 },
            });

            // Mock window.app.categoryManager
            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn((type, id) => {
                        const map = { food: { name: '餐飲', icon: 'fa-utensils' }, transport: { name: '交通', icon: 'fa-car' } };
                        return map[id] || null;
                    }),
                },
            };

            const status = await bm.getBudgetStatus();

            expect(status.categoryStatuses).toHaveLength(2);
            expect(status.categoryStatuses[0].categoryId).toBe('food');
            expect(status.categoryStatuses[0].spent).toBe(2500);
            expect(status.categoryStatuses[0].percentage).toBeCloseTo(83.33, 1);
            expect(status.categoryStatuses[1].categoryId).toBe('transport');
            expect(status.categoryStatuses[1].isOverBudget).toBe(false);
        });

        it('分類超預算時 isOverBudget=true', async () => {
            bm.currentBudget = 10000;
            bm.categoryBudgets = { 'food': 2000 };
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 3000,
                expenseByCategory: { 'food': 2500 },
            });

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn(() => ({ name: 'food', icon: '' })),
                },
            };

            const status = await bm.getBudgetStatus();
            expect(status.categoryStatuses[0].isOverBudget).toBe(true);
        });

        it('分類預算排序：依 custom order', async () => {
            bm.currentBudget = 10000;
            bm.categoryBudgets = { 'a': 1000, 'b': 2000, 'c': 3000 };
            bm.categoryBudgetOrder = ['c', 'a', 'b'];

            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 0,
                expenseByCategory: { 'a': 500, 'b': 500, 'c': 500 },
            });

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn((_, id) => ({ name: id, icon: '' })),
                },
            };

            const status = await bm.getBudgetStatus();
            const ids = status.categoryStatuses.map(s => s.categoryId);
            expect(ids).toEqual(['c', 'a', 'b']);
        });

        it('分類預算 = 0 時跳過', async () => {
            bm.currentBudget = 10000;
            bm.categoryBudgets = { 'food': 3000, 'skip': 0 };
            ds.getStatistics.mockResolvedValueOnce({
                totalExpense: 1000,
                expenseByCategory: { 'food': 1000 },
            });

            window.app = {
                categoryManager: {
                    getCategoryById: vi.fn(() => ({ name: 'x', icon: '' })),
                },
            };

            const status = await bm.getBudgetStatus();
            expect(status.categoryStatuses).toHaveLength(1);
            expect(status.categoryStatuses[0].categoryId).toBe('food');
        });
    });


// ==================== closeBudgetModal ====================

    describe('closeBudgetModal', () => {
        it('移除 DOM 中的彈窗', () => {
            const modal = document.createElement('div');
            modal.id = 'budget-modal';
            document.body.appendChild(modal);

            bm.closeBudgetModal();
            expect(document.getElementById('budget-modal')).toBeNull();
        });

        it('無彈窗時不報錯', () => {
            expect(() => bm.closeBudgetModal()).not.toThrow();
        });
    });
});

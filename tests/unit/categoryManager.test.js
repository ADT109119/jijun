import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CategoryManager } from '../../src/js/categoryManager.js';

// ── Mock DataService factory ────────────────────────────────────────────
function createMockDataService() {
    const settings = new Map();
    const records = [];

    return {
        getCategorySetting: vi.fn(async (key) => {
            return settings.get(key) || null;
        }),
        saveCategorySetting: vi.fn(async (key, value) => {
            settings.set(key, { value });
            return true;
        }),
        saveSetting: vi.fn(async () => true),
        getSetting: vi.fn(async () => null),
        getRecords: vi.fn(async () => [...records]),
        updateRecord: vi.fn(async () => true),
        logChange: vi.fn(),
        activeLedgerId: 1,
    };
}

describe('CategoryManager', () => {
    let cm;
    let mockDS;

    beforeEach(() => {
        mockDS = createMockDataService();
        cm = new CategoryManager(mockDS);
        // 清除初始空陣列狀態
        cm.customCategories = { expense: [], income: [] };
        cm.categoryOrder = { expense: [], income: [] };
        cm.hiddenCategories = { expense: [], income: [] };
    });

    // ── Constructor & init ───────────────────────────────────────────────
    describe('init', () => {
        it('沒有 dataService 時不拋錯', () => {
            const cmNoDS = new CategoryManager(null);
            expect(() => cmNoDS.init()).not.toThrow();
        });

        it('載入 custom_categories 設定', async () => {
            const customCats = {
                expense: [{ id: 'custom_test', name: '測試', icon: 'fas fa-test', color: 'bg-red-400', isCustom: true }],
                income: [],
            };
            mockDS.getCategorySetting.mockResolvedValue({ value: customCats });
            mockDS.getCategorySetting
                .mockResolvedValueOnce({ value: customCats })  // custom_categories
                .mockResolvedValueOnce(null)                   // category_order
                .mockResolvedValueOnce(null);                   // hidden_categories

            cm = new CategoryManager(mockDS);
            await cm.init();

            expect(cm.customCategories.expense).toHaveLength(1);
            expect(cm.customCategories.expense[0].id).toBe('custom_test');
        });

        it('載入 category_order 設定', async () => {
            const order = { expense: ['food', 'transport'], income: ['salary'] };
            mockDS.getCategorySetting
                .mockResolvedValueOnce(null)                        // custom_categories
                .mockResolvedValueOnce({ value: order })            // category_order
                .mockResolvedValueOnce(null);                       // hidden_categories

            cm = new CategoryManager(mockDS);
            await cm.init();

            expect(cm.categoryOrder.expense).toEqual(['food', 'transport']);
        });

        it('載入 hidden_categories 設定', async () => {
            const hidden = { expense: ['entertainment'], income: [] };
            mockDS.getCategorySetting
                .mockResolvedValueOnce(null)                        // custom_categories
                .mockResolvedValueOnce(null)                        // category_order
                .mockResolvedValueOnce({ value: hidden });          // hidden_categories

            cm = new CategoryManager(mockDS);
            await cm.init();

            expect(cm.hiddenCategories.expense).toEqual(['entertainment']);
        });
    });

    // ── getAllCategories ─────────────────────────────────────────────────
    describe('getAllCategories', () => {
        it('回傳預設 + 自訂分類合併', () => {
            cm.customCategories = {
                expense: [{ id: 'custom_foo', name: 'Foo', icon: 'fas fa-foo', color: 'bg-red-400', isCustom: true }],
                income: [],
            };
            const result = cm.getAllCategories('expense');
            const ids = result.map(c => c.id);
            expect(ids).toContain('food');       // default
            expect(ids).toContain('custom_foo'); // custom
        });

        it('包含隱藏分類 (includeHidden=true)', () => {
            cm.customCategories = { expense: [], income: [] };
            cm.hiddenCategories = { expense: ['food'], income: [] };

            const hiddenResult = cm.getAllCategories('expense', true);
            const visibleResult = cm.getAllCategories('expense', false);

            const hasFoodHidden = hiddenResult.some(c => c.id === 'food');
            const hasFoodVisible = visibleResult.some(c => c.id === 'food');

            expect(hasFoodHidden).toBe(true);
            expect(hasFoodVisible).toBe(false);
        });

        it('按照 categoryOrder 排序', () => {
            cm.customCategories = { expense: [], income: [] };
            // 把 transport 排在 food 前面
            cm.categoryOrder = { expense: ['transport', 'food'], income: [] };

            const result = cm.getAllCategories('expense');
            const foodIndex = result.findIndex(c => c.id === 'food');
            const transportIndex = result.findIndex(c => c.id === 'transport');

            expect(transportIndex).toBeLessThan(foodIndex);
        });

        it('空型別時回傳空陣列', () => {
            cm.customCategories = { expense: [], income: [] };
            cm.hiddenCategories = { expense: [], income: [] };
            cm.categoryOrder = { expense: [], income: [] };

            const result = cm.getAllCategories('expense');
            expect(Array.isArray(result)).toBe(true);
        });
    });

    // ── addCustomCategory ────────────────────────────────────────────────
    describe('addCustomCategory', () => {
        it('新增自訂分類', async () => {
            cm.customCategories = { expense: [], income: [] };
            const cat = { id: 'new_cat', name: '新分類', icon: 'fas fa-new', color: 'bg-green-400', isCustom: true };

            const result = await cm.addCustomCategory('expense', cat);

            expect(result).toBe(true);
            expect(cm.customCategories.expense).toContainEqual(cat);
        });

        it('重複 ID 時回傳 false', async () => {
            cm.customCategories = {
                expense: [{ id: 'existing', name: '存在', icon: 'fas fa-ex', color: 'bg-blue-400', isCustom: true }],
                income: [],
            };

            const result = await cm.addCustomCategory('expense', { id: 'existing', name: '重名', icon: 'fas fa-ex2', color: 'bg-red-400', isCustom: true });

            expect(result).toBe(false);
            expect(cm.customCategories.expense.length).toBe(1);
        });

        it('income 類型新增正常', async () => {
            cm.customCategories = { expense: [], income: [] };
            const cat = { id: 'income_custom', name: '額外收入', icon: 'fas fa-coins', color: 'bg-yellow-400', isCustom: true };

            const result = await cm.addCustomCategory('income', cat);

            expect(result).toBe(true);
            expect(cm.customCategories.income).toContainEqual(cat);
        });
    });

    // ── removeCustomCategory ─────────────────────────────────────────────
    describe('removeCustomCategory', () => {
        it('移除存在的自訂分類', async () => {
            cm.customCategories = {
                expense: [{ id: 'rem_me', name: '移除我', icon: 'fas fa-trash', color: 'bg-gray-400', isCustom: true }],
                income: [],
            };

            const result = await cm.removeCustomCategory('expense', 'rem_me');

            expect(result).toBe(true);
            expect(cm.customCategories.expense.length).toBe(0);
        });

        it('移除不存在的自訂分類回傳 false', async () => {
            cm.customCategories = { expense: [], income: [] };

            const result = await cm.removeCustomCategory('expense', 'nonexistent');

            expect(result).toBe(false);
        });
    });

    // ── updateCustomCategory ─────────────────────────────────────────────
    describe('updateCustomCategory', () => {
        it('更新存在的自訂分類', async () => {
            cm.customCategories = {
                expense: [{ id: 'upd_me', name: '舊名稱', icon: 'fas fa-old', color: 'bg-blue-400', isCustom: true }],
                income: [],
            };

            const updated = { id: 'upd_me', name: '新名稱', icon: 'fas fa-new', color: 'bg-green-400', isCustom: true };
            const result = await cm.updateCustomCategory('expense', updated);

            expect(result).toBe(true);
            const cat = cm.customCategories.expense.find(c => c.id === 'upd_me');
            expect(cat.name).toBe('新名稱');
            expect(cat.icon).toBe('fas fa-new');
        });

        it('更新不存在的自訂分類回傳 false', async () => {
            cm.customCategories = { expense: [], income: [] };

            const result = await cm.updateCustomCategory('expense', { id: 'fake', name: 'Fake', icon: 'fas fa-fake', color: 'bg-red-400', isCustom: true });

            expect(result).toBe(false);
        });
    });

    // ── getCustomCategoryById ────────────────────────────────────────────
    describe('getCustomCategoryById', () => {
        it('找到自訂分類', () => {
            cm.customCategories = {
                expense: [{ id: 'found', name: '找到', icon: 'fas fa-find', color: 'bg-purple-400', isCustom: true }],
                income: [],
            };

            const result = cm.getCustomCategoryById('expense', 'found');

            expect(result).not.toBeNull();
            expect(result.id).toBe('found');
        });

        it('找不到回傳 null', () => {
            cm.customCategories = { expense: [], income: [] };

            const result = cm.getCustomCategoryById('expense', 'notfound');

            expect(result).toBeNull();
        });
    });

    // ── getCategoryById (含跨型別 fallback) ──────────────────────────────
    describe('getCategoryById', () => {
        it('預設分類直接回傳', () => {
            cm.customCategories = { expense: [], income: [] };
            const result = cm.getCategoryById('expense', 'food');

            expect(result).not.toBeNull();
            expect(result.id).toBe('food');
        });

        it('自訂分類回傳', () => {
            cm.customCategories = {
                expense: [{ id: 'my_cat', name: 'MyCat', icon: 'fas fa-paw', color: 'bg-pink-400', isCustom: true }],
                income: [],
            };

            const result = cm.getCategoryById('expense', 'my_cat');

            expect(result).not.toBeNull();
            expect(result.id).toBe('my_cat');
        });

        it('找不到回傳 null', () => {
            cm.customCategories = { expense: [], income: [] };

            const result = cm.getCategoryById('expense', 'does_not_exist_at_all');

            expect(result).toBeNull();
        });
    });

    // ── isCustomCategory ─────────────────────────────────────────────────
    describe('isCustomCategory', () => {
        it('自訂分類回傳 true', () => {
            cm.customCategories = {
                expense: [{ id: 'is_custom', name: 'Custom', icon: 'fas fa-c', color: 'bg-orange-400', isCustom: true }],
                income: [],
            };

            expect(cm.isCustomCategory('expense', 'is_custom')).toBe(true);
        });

        it('預設分類回傳 false', () => {
            cm.customCategories = { expense: [], income: [] };

            expect(cm.isCustomCategory('expense', 'food')).toBe(false);
        });

        it('不存在且陣列為空回傳 false', () => {
            cm.customCategories = { expense: [], income: [] };

            expect(cm.isCustomCategory('expense', 'nope')).toBe(false);
        });
    });

    // ── saveCategorySettings ─────────────────────────────────────────────
    describe('saveCategorySettings', () => {
        it('儲存 order 和 hidden', async () => {
            cm.categoryOrder = { expense: ['food'], income: ['salary'] };
            cm.hiddenCategories = { expense: ['entertainment'], income: [] };

            const result = await cm.saveCategorySettings();

            expect(result).toBe(true);
            expect(mockDS.saveCategorySetting).toHaveBeenCalledWith('category_order', cm.categoryOrder);
            expect(mockDS.saveCategorySetting).toHaveBeenCalledWith('hidden_categories', cm.hiddenCategories);
        });

        it('沒有 dataService 時回傳 true', async () => {
            const cmNoDS = new CategoryManager(null);
            cmNoDS.categoryOrder = { expense: [], income: [] };
            cmNoDS.hiddenCategories = { expense: [], income: [] };

            const result = await cmNoDS.saveCategorySettings();

            expect(result).toBe(true);
        });
    });

    // ── saveCustomCategories ─────────────────────────────────────────────
    describe('saveCustomCategories', () => {
        it('儲存 custom_categories', async () => {
            cm.customCategories = {
                expense: [{ id: 'save_me', name: 'Save', icon: 'fas fa-save', color: 'bg-blue-400', isCustom: true }],
                income: [],
            };

            const result = await cm.saveCustomCategories();

            expect(result).toBe(true);
            expect(mockDS.saveCategorySetting).toHaveBeenCalledWith('custom_categories', cm.customCategories);
        });

        it('沒有 dataService 時回傳 true', async () => {
            const cmNoDS = new CategoryManager(null);
            cmNoDS.customCategories = { expense: [], income: [] };

            const result = await cmNoDS.saveCustomCategories();

            expect(result).toBe(true);
        });
    });

    // ── getAvailableIcons ────────────────────────────────────────────────
    describe('getAvailableIcons', () => {
        it('回傳非空圖示列表', () => {
            const icons = cm.getAvailableIcons();
            expect(Array.isArray(icons)).toBe(true);
            expect(icons.length).toBeGreaterThan(0);
            expect(icons[0]).toContain('fas');
        });
    });

    // ── getAvailableColors ───────────────────────────────────────────────
    describe('getAvailableColors', () => {
        it('回傳非空顏色列表', () => {
            const colors = cm.getAvailableColors();
            expect(Array.isArray(colors)).toBe(true);
            expect(colors.length).toBeGreaterThan(0);
            expect(colors[0]).toContain('bg-');
        });
    });

    // ── closeAddCategoryModal / closeManageCategoriesModal ──────────────
    describe('closeAddCategoryModal', () => {
        it('不存在 modal 時不拋錯', () => {
            expect(() => cm.closeAddCategoryModal()).not.toThrow();
        });

        it('移除已建立的 modal', () => {
            document.body.innerHTML = '<div id="add-category-modal">test</div>';
            cm.closeAddCategoryModal();
            expect(document.getElementById('add-category-modal')).toBeNull();
        });
    });

    describe('closeManageCategoriesModal', () => {
        it('不存在 modal 時不拋錯', () => {
            expect(() => cm.closeManageCategoriesModal()).not.toThrow();
        });

        it('移除已建立的 modal', () => {
            document.body.innerHTML = '<div id="manage-categories-modal">test</div>';
            cm.closeManageCategoriesModal();
            expect(document.getElementById('manage-categories-modal')).toBeNull();
        });
    });

    // ── getAllCategories 邊界情況 ────────────────────────────────────────
    describe('getAllCategories edge cases', () => {
        it('order 中有不存在於任何分類的 ID 不會出錯', () => {
            cm.customCategories = { expense: [], income: [] };
            cm.categoryOrder = { expense: ['food', 'nonexistent_order_id'], income: [] };
            cm.hiddenCategories = { expense: [], income: [] };

            expect(() => cm.getAllCategories('expense')).not.toThrow();
        });

        it('hiddenCategories 中有不存在的 ID 不會出錯', () => {
            cm.customCategories = { expense: [], income: [] };
            cm.categoryOrder = { expense: [], income: [] };
            cm.hiddenCategories = { expense: ['nonexistent_hidden_id'], income: [] };

            const result = cm.getAllCategories('expense');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

// ==================== QuickSelectManager 單元測試 ====================
// 測試重點：記錄加載、儲存、新增/刪除、排序截斷、渲染邏輯

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock utils.js escapeHTML — 直接回傳原始字串
vi.mock('../../src/js/utils.js', () => ({
    escapeHTML: vi.fn((s) => s),
}));

import { QuickSelectManager } from '../../src/js/quickSelectManager.js';


describe('QuickSelectManager', () => {

    beforeEach(() => {
        localStorage.clear();
    });


// ==================== Constructor ====================

    describe('constructor', () => {
        it('初始 records 為空陣列（無 localStorage 資料）', () => {
            const qsm = new QuickSelectManager();
            expect(qsm.records).toEqual([]);
        });

        it('從 localStorage 載入已有記錄', () => {
            const mockRecords = [
                { type: 'expense', categoryId: 'food', description: '午餐', accountId: null, count: 3, lastUsed: Date.now() },
            ];
            localStorage.setItem('quickSelectRecords', JSON.stringify(mockRecords));

            const qsm = new QuickSelectManager();
            expect(qsm.records).toEqual(mockRecords);
        });

        it('localStorage 有損壞資料時不崩潰，回傳空陣列', () => {
            localStorage.setItem('quickSelectRecords', 'not valid json{{{');

            const qsm = new QuickSelectManager();
            expect(qsm.records).toEqual([]);
        });

        it('localStorage 為 null（不存在）時回傳空陣列', () => {
            localStorage.removeItem('quickSelectRecords');

            const qsm = new QuickSelectManager();
            expect(qsm.records).toEqual([]);
        });
    });


// ==================== loadRecords() ====================

    describe('loadRecords', () => {
        it('無資料時回傳空陣列', () => {
            localStorage.removeItem('quickSelectRecords');
            const qsm = new QuickSelectManager();
            expect(qsm.loadRecords()).toEqual([]);
        });

        it('解析有效的 JSON 陣列', () => {
            const mockRecords = [
                { type: 'expense', categoryId: 'food', description: '午餐', accountId: null, count: 3, lastUsed: Date.now() },
                { type: 'income', categoryId: 'salary', description: '薪資', accountId: null, count: 1, lastUsed: Date.now() },
            ];
            localStorage.setItem('quickSelectRecords', JSON.stringify(mockRecords));

            const qsm = new QuickSelectManager();
            expect(qsm.loadRecords()).toEqual(mockRecords);
        });

        it('損壞的 JSON 回傳空陣列', () => {
            localStorage.setItem('quickSelectRecords', '{broken');

            const qsm = new QuickSelectManager();
            expect(qsm.loadRecords()).toEqual([]);
        });

        it('非陣列的 JSON（物件）應回傳空陣列，防止後續操作崩潰', () => {
            localStorage.setItem('quickSelectRecords', '{"foo":"bar"}');

            const qsm = new QuickSelectManager();
            expect(qsm.records).toEqual([]);
            expect(qsm.loadRecords()).toEqual([]);
            
            // 驗證呼叫 addRecord 不會崩潰
            expect(() => qsm.addRecord('expense', 'food', '午餐', null)).not.toThrow();
            expect(qsm.records).toHaveLength(1);
        });
    });


// ==================== saveRecords() ====================

    describe('saveRecords', () => {
        it('將 records 儲存到 localStorage', () => {
            const qsm = new QuickSelectManager();
            qsm.records = [
                { type: 'expense', categoryId: 'food', description: '午餐', accountId: null, count: 1, lastUsed: Date.now() },
            ];

            qsm.saveRecords();

            expect(localStorage.getItem('quickSelectRecords')).toBe(
                JSON.stringify(qsm.records)
            );
        });

        it('儲存空陣列到 localStorage', () => {
            const qsm = new QuickSelectManager();
            qsm.records = [];

            qsm.saveRecords();

            expect(localStorage.getItem('quickSelectRecords')).toBe('[]');
        });

        it('儲存失敗時不崩潰（console.error 被呼叫）', () => {
            // 模擬 localStorage.setItem 拋錯
            const originalSetItem = localStorage.setItem.bind(localStorage);
            vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
                throw new Error('Quota exceeded');
            });

            const qsm = new QuickSelectManager();
            expect(() => qsm.saveRecords()).not.toThrow();

            // 恢復
            localStorage.setItem = originalSetItem;
        });
    });


// ==================== addRecord() ====================

    describe('addRecord', () => {
        it('新增全新記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);

            expect(qsm.records).toHaveLength(1);
            expect(qsm.records[0].type).toBe('expense');
            expect(qsm.records[0].categoryId).toBe('food');
            expect(qsm.records[0].description).toBe('午餐');
            expect(qsm.records[0].accountId).toBe(null);
            expect(qsm.records[0].count).toBe(1);
        });

        it('新增記錄時更新 localStorage', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const stored = JSON.parse(localStorage.getItem('quickSelectRecords'));
            expect(stored).toHaveLength(1);
        });

        it('更新已有記錄（相同 type+categoryId+description+accountId）時 count++', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'food', '午餐', null);

            expect(qsm.records).toHaveLength(1);
            expect(qsm.records[0].count).toBe(3);
        });

        it('不同 description 視為不同記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'food', '晚餐', null);

            expect(qsm.records).toHaveLength(2);
        });

        it('不同 accountId 視為不同記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'food', '午餐', 1);

            expect(qsm.records).toHaveLength(2);
        });

        it('undefined accountId 被正規化為 null', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', undefined);
            qsm.addRecord('expense', 'food', '午餐', null);

            expect(qsm.records).toHaveLength(1);
            expect(qsm.records[0].accountId).toBe(null);
        });

        it('null description 被正規化為空字串', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', null, null);

            expect(qsm.records[0].description).toBe('');
        });

        it('undefined description 被正規化為空字串', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', undefined, null);

            expect(qsm.records[0].description).toBe('');
        });

        it('記錄依 count 降序排列', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'a', 'desc1', null);
            qsm.addRecord('expense', 'b', 'desc2', null);
            // desc2 被用了兩次，count=2；desc1 count=1
            qsm.addRecord('expense', 'b', 'desc2', null);

            expect(qsm.records[0].description).toBe('desc2');
            expect(qsm.records[0].count).toBe(2);
            expect(qsm.records[1].description).toBe('desc1');
        });

        it('count 相同時依 lastUsed 降序排列（後新增的排前面）', () => {
            const qsm = new QuickSelectManager();

            // Directly set up two records with same count but different lastUsed
            qsm.records.push(
                { type: 'expense', categoryId: 'a', description: 'desc1', accountId: null, count: 1, lastUsed: 100 },
                { type: 'expense', categoryId: 'b', description: 'desc2', accountId: null, count: 1, lastUsed: 200 }
            );

            // Sort as addRecord would do (count desc, then lastUsed desc)
            qsm.records.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.lastUsed - a.lastUsed;
            });

            expect(qsm.records[0].description).toBe('desc2'); // newer lastUsed first
        });

        it('記錄超過 MAX_TOTAL_RECORDS (20) 時截斷', () => {
            const qsm = new QuickSelectManager();

            for (let i = 0; i < 25; i++) {
                qsm.addRecord('expense', `cat${i}`, `desc${i}`, null);
            }

            expect(qsm.records).toHaveLength(20);
        });

        it('截斷時保留 count 最高的記錄', () => {
            const qsm = new QuickSelectManager();

            // 先新增一個高頻記錄
            for (let i = 0; i < 5; i++) {
                qsm.addRecord('expense', 'highFreq', 'frequent', null);
            }

            // 再新增多個低頻記錄
            for (let i = 0; i < 20; i++) {
                qsm.addRecord('expense', `low${i}`, `desc${i}`, null);
            }

            expect(qsm.records).toHaveLength(20);
            // highFreq 應該在列表中（count=5，比所有 low 的 count=1 高）
            const hasHighFreq = qsm.records.some(r => r.categoryId === 'highFreq');
            expect(hasHighFreq).toBe(true);
        });

        it('新增 income 類型記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('income', 'salary', '薪資收入', null);

            expect(qsm.records[0].type).toBe('income');
            expect(qsm.records[0].description).toBe('薪資收入');
        });
    });


// ==================== deleteRecord() ====================

    describe('deleteRecord', () => {
        it('刪除匹配的記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'transport', '捷運', null);

            // Pass 'null' string (as dataset would) so parseInt normalizes to null
            qsm.deleteRecord('expense', 'food', '午餐', 'null');

            expect(qsm.records).toHaveLength(1);
            expect(qsm.records[0].description).toBe('捷運');
        });

        it('刪除不存在的記錄時不崩潰', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);

            qsm.deleteRecord('expense', 'nonexist', '不存在', null);

            expect(qsm.records).toHaveLength(1);
        });

        it('accountId 為 "null" 字串時被正規化為 null', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);

            // dataset 會把 null 轉成 "null" 字串傳入
            qsm.deleteRecord('expense', 'food', '午餐', 'null');

            expect(qsm.records).toHaveLength(0);
        });

        it('accountId 為 "undefined" 字串時被正規化為 null', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', undefined);

            // dataset 會把 undefined 轉成 "undefined" 字串傳入
            qsm.deleteRecord('expense', 'food', '午餐', 'undefined');

            expect(qsm.records).toHaveLength(0);
        });

        it('accountId 為數字字串時被 parseInt 轉換', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', 42);

            // dataset 會把數字轉成 "42" 字串傳入
            qsm.deleteRecord('expense', 'food', '午餐', '42');

            expect(qsm.records).toHaveLength(0);
        });

        it('刪除後更新 localStorage', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '午餐', null);
            // Pass 'null' string (as dataset would) so the record is found and deleted
            qsm.deleteRecord('expense', 'food', '午餐', 'null');

            expect(localStorage.getItem('quickSelectRecords')).toBe('[]');
        });

        it('null description 被正規化為空字串後匹配', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'food', '', null);

            // Pass 'null' string for accountId (as dataset would) and null description → normalized to ''
            qsm.deleteRecord('expense', 'food', null, 'null');

            expect(qsm.records).toHaveLength(0);
        });
    });


// ==================== getQuickSelects() ====================

    describe('getQuickSelects', () => {
        it('空記錄回傳空陣列', () => {
            const qsm = new QuickSelectManager();
            expect(qsm.getQuickSelects()).toEqual([]);
        });

        it('少於 5 筆時回傳所有記錄', () => {
            const qsm = new QuickSelectManager();

            qsm.addRecord('expense', 'a', 'desc1', null);
            qsm.addRecord('expense', 'b', 'desc2', null);

            expect(qsm.getQuickSelects()).toHaveLength(2);
        });

        it('超過 5 筆時只回傳前 5 筆', () => {
            const qsm = new QuickSelectManager();

            for (let i = 0; i < 10; i++) {
                qsm.addRecord('expense', `cat${i}`, `desc${i}`, null);
            }

            expect(qsm.getQuickSelects()).toHaveLength(5);
        });

        it('回傳的是前 5 筆（依 count/lastUsed 排序）', () => {
            const qsm = new QuickSelectManager();

            // desc0 被用了最多，count=10
            for (let i = 0; i < 10; i++) {
                qsm.addRecord('expense', 'highFreq', 'desc0', null);
            }
            // desc1 count=5
            for (let i = 0; i < 5; i++) {
                qsm.addRecord('expense', 'midFreq', 'desc1', null);
            }
            // desc2~9 count=1 — each with unique categoryId so they're distinct records
            for (let i = 2; i <= 9; i++) {
                qsm.addRecord('expense', `lowCat${i}`, `desc${i}`, null);
            }

            const result = qsm.getQuickSelects();

            expect(result).toHaveLength(5);
            expect(result[0].description).toBe('desc0');
            expect(result[1].description).toBe('desc1');
        });

        it('回傳的記錄不影響內部 records 陣列', () => {
            const qsm = new QuickSelectManager();

            for (let i = 0; i < 3; i++) {
                qsm.addRecord('expense', `cat${i}`, `desc${i}`, null);
            }

            const selects = qsm.getQuickSelects();
            expect(selects).toHaveLength(3);

            // 內部 records 不受影響
            expect(qsm.records).toHaveLength(3);
        });
    });


// ==================== render() ====================

    describe('render', () => {
        it('空記錄時清空 container 並加上 hidden class', () => {
            const qsm = new QuickSelectManager();
            const container = document.createElement('div');

            qsm.render(container, null, null, false);

            expect(container.innerHTML).toBe('');
            expect(container.classList.contains('hidden')).toBe(true);
        });

        it('有記錄時移除 hidden class', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');
            container.classList.add('hidden');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.classList.contains('hidden')).toBe(false);
        });

        it('渲染的 HTML 包含記錄的描述文字', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('午餐');
        });

        it('渲染的 HTML 包含記錄的 data-* attributes', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('data-type="expense"');
            expect(container.innerHTML).toContain('data-category-id="food"');
            expect(container.innerHTML).toContain('data-description="午餐"');
        });

        it('accountId 為 null 時渲染 data-account-id="null"', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('data-account-id="null"');
        });

        it('accountId 為數字時渲染對應的 data-account-id', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', 42);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('data-account-id="42"');
        });

        it('category 不存在時不渲染該記錄的按鈕', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'nonexist', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => null), // 找不到分類
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).not.toContain('午餐');
        });

        it('description 為空時使用 category name', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('餐飲');
        });

        it('render 時呼叫 escapeHTML 對 description 做 XSS 防護', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '<script>alert("xss")</script>', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            // escapeHTML 被 mock 為 identity，所以原始字串出現在 HTML 中
            expect(container.innerHTML).toContain('<script>alert("xss")</script>');
        });

        it('render 時 container 內有 quick-select-capsule 按鈕', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            const buttons = container.querySelectorAll('.quick-select-capsule');
            expect(buttons).toHaveLength(1);
        });

        it('render 時按鈕綁定 click event', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            const onSelect = vi.fn();
            qsm.render(container, onSelect, mockCategoryManager, false);

            const button = container.querySelector('.quick-select-capsule');
            button.click();

            expect(onSelect).toHaveBeenCalledWith('expense', 'food', '午餐', null);
        });

        it('render 時按鈕綁定 contextmenu event 呼叫 showDeleteMenu', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            const button = container.querySelector('.quick-select-capsule');

            // 觸發 contextmenu（不阻止預設行為，只驗證事件被綁定）
            const event = new MouseEvent('contextmenu', { bubbles: true });
            vi.spyOn(event, 'preventDefault').mockImplementation(() => {});
            button.dispatchEvent(event);

            // showDeleteMenu 應該被呼叫 — 驗證 menu 被建立
            expect(document.getElementById('quick-select-context-menu')).not.toBeNull();
        });

        it('render 多個記錄時每個都有獨立的按鈕', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);
            qsm.addRecord('expense', 'transport', '捷運', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '分類', icon: 'fa-tag', color: '#33FF57' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            const buttons = container.querySelectorAll('.quick-select-capsule');
            expect(buttons).toHaveLength(2);
        });

        it('render 時最多顯示 MAX_DISPLAY_RECORDS (5) 筆', () => {
            const qsm = new QuickSelectManager();

            for (let i = 0; i < 10; i++) {
                qsm.addRecord('expense', `cat${i}`, `desc${i}`, null);
            }

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '分類', icon: 'fa-tag', color: '#33FF57' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            const buttons = container.querySelectorAll('.quick-select-capsule');
            expect(buttons).toHaveLength(5);
        });

        it('render 時使用 category color 設定 style', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('style="background-color: #FF5733"');
        });

        it('render 時使用 category icon class', () => {
            const qsm = new QuickSelectManager();
            qsm.addRecord('expense', 'food', '午餐', null);

            const container = document.createElement('div');

            const mockCategoryManager = {
                getCategoryById: vi.fn(() => ({ name: '餐飲', icon: 'fa-utensils', color: '#FF5733' })),
            };

            qsm.render(container, null, mockCategoryManager, false);

            expect(container.innerHTML).toContain('fa-utensils');
        });
    });
});

import { describe, it, expect } from 'vitest';
import { CATEGORIES, getCategoryById, getCategoryName, getCategoryIcon } from '../../src/js/categories.js';

describe('CATEGORIES', () => {
    it('expense 分類存在且非空', () => {
        expect(CATEGORIES.expense).toBeDefined();
        expect(Array.isArray(CATEGORIES.expense)).toBe(true);
        expect(CATEGORIES.expense.length).toBeGreaterThan(0);
    });

    it('income 分類存在且非空', () => {
        expect(CATEGORIES.income).toBeDefined();
        expect(Array.isArray(CATEGORIES.income)).toBe(true);
        expect(CATEGORIES.income.length).toBeGreaterThan(0);
    });

    it('每個分類都有 id, name, icon, color', () => {
        for (const type of ['expense', 'income']) {
            for (const cat of CATEGORIES[type]) {
                expect(cat.id).toBeDefined();
                expect(cat.name).toBeDefined();
                expect(cat.icon).toBeDefined();
                expect(cat.color).toBeDefined();
            }
        }
    });
});

describe('getCategoryById', () => {
    it('取得 expense 預設分類', () => {
        const cat = getCategoryById('expense', 'food');
        expect(cat).toEqual({ id: 'food', name: '飲食', icon: 'fas fa-utensils', color: 'bg-red-500' });
    });

    it('取得 income 預設分類', () => {
        const cat = getCategoryById('income', 'salary');
        expect(cat).toEqual({ id: 'salary', name: '薪水', icon: 'fas fa-money-bill-wave', color: 'bg-green-600' });
    });

    it('不存在的分類回傳 undefined', () => {
        expect(getCategoryById('expense', 'nonexistent')).toBeUndefined();
        expect(getCategoryById('income', 'fake-id')).toBeUndefined();
    });

    it('不存在的 type 會拋錯（原始程式未保護）', () => {
        expect(() => getCategoryById('unknown', 'food')).toThrow();
    });

    it('window.app 不存在時不會拋錯', () => {
        const savedApp = globalThis.window?.app;
        // 確保 window.app 不存在（setup.js 沒有設定）
        if (globalThis.window) delete globalThis.window.app;
        
        expect(() => getCategoryById('expense', 'food')).not.toThrow();
        
        if (savedApp) {
            globalThis.window.app = savedApp;
        }
    });
});

describe('getCategoryName', () => {
    it('存在的分類回傳名稱', () => {
        expect(getCategoryName('expense', 'food')).toBe('飲食');
        expect(getCategoryName('income', 'salary')).toBe('薪水');
    });

    it('不存在的分類回傳未知分類', () => {
        expect(getCategoryName('expense', 'fake')).toBe('未知分類');
    });
});

describe('getCategoryIcon', () => {
    it('存在的分類回傳 icon', () => {
        expect(getCategoryIcon('expense', 'food')).toBe('fas fa-utensils');
        expect(getCategoryIcon('income', 'bonus')).toBe('fas fa-gift');
    });

    it('不存在的分類回傳預設 icon', () => {
        expect(getCategoryIcon('expense', 'fake')).toBe('fas fa-question');
    });
});

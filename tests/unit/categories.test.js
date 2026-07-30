import { describe, it, expect } from 'vitest'
import {
    CATEGORIES,
    getCategoryById,
    getCategoryName,
    getCategoryIcon,
} from '../../src/js/categories.js'

describe('CATEGORIES', () => {
    it('expense 分類存在且非空', () => {
        expect(CATEGORIES.expense).toBeDefined()
        expect(Array.isArray(CATEGORIES.expense)).toBe(true)
        expect(CATEGORIES.expense.length).toBeGreaterThan(0)
    })

    it('income 分類存在且非空', () => {
        expect(CATEGORIES.income).toBeDefined()
        expect(Array.isArray(CATEGORIES.income)).toBe(true)
        expect(CATEGORIES.income.length).toBeGreaterThan(0)
    })

    it('expense 有恰好 9 個分類', () => {
        expect(CATEGORIES.expense).toHaveLength(9)
    })

    it('income 有恰好 9 個分類', () => {
        expect(CATEGORIES.income).toHaveLength(9)
    })

    it('expense 所有分類 ID 不重複', () => {
        const ids = CATEGORIES.expense.map(c => c.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('income 所有分類 ID 不重複', () => {
        const ids = CATEGORIES.income.map(c => c.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('所有 color 是合法的 Tailwind 類別 (bg-xxx-nnn)', () => {
        const all = [...CATEGORIES.expense, ...CATEGORIES.income]
        for (const cat of all) {
            expect(cat.color).toMatch(/^bg-[a-z]+-\d{3}$/)
        }
    })

    it('所有 icon 是合法的 FontAwesome 類別 (fas fa-xxx)', () => {
        const all = [...CATEGORIES.expense, ...CATEGORIES.income]
        for (const cat of all) {
            expect(cat.icon).toMatch(/^fas\sfa-/)
        }
    })

    it('每個分類都有 id, name, icon, color', () => {
        for (const type of ['expense', 'income']) {
            for (const cat of CATEGORIES[type]) {
                expect(cat.id).toBeDefined()
                expect(cat.name).toBeDefined()
                expect(cat.icon).toBeDefined()
                expect(cat.color).toBeDefined()
            }
        }
    })
})

describe('getCategoryById', () => {
    it('取得 expense 預設分類', () => {
        const cat = getCategoryById('expense', 'food')
        expect(cat).toEqual({
            id: 'food',
            name: '飲食',
            icon: 'fas fa-utensils',
            color: 'bg-red-500',
        })
    })

    it('取得 income 預設分類', () => {
        const cat = getCategoryById('income', 'salary')
        expect(cat).toEqual({
            id: 'salary',
            name: '薪水',
            icon: 'fas fa-money-bill-wave',
            color: 'bg-green-600',
        })
    })

    it('不存在的分類回傳 undefined', () => {
        expect(getCategoryById('expense', 'nonexistent')).toBeUndefined()
        expect(getCategoryById('income', 'fake-id')).toBeUndefined()
    })

    it('不存在的 type 會拋錯（原始程式未保護）', () => {
        expect(() => getCategoryById('unknown', 'food')).toThrow()
    })

    it('window.app 不存在時不會拋錯', () => {
        const savedApp = globalThis.window?.app
        if (globalThis.window) delete globalThis.window.app

        expect(() => getCategoryById('expense', 'food')).not.toThrow()

        if (savedApp) {
            globalThis.window.app = savedApp
        }
    })

    it('空字串 id 回傳 undefined', () => {
        expect(getCategoryById('expense', '')).toBeUndefined()
        expect(getCategoryById('income', '')).toBeUndefined()
    })

    it('null id 回傳 undefined', () => {
        expect(getCategoryById('expense', null)).toBeUndefined()
        expect(getCategoryById('income', null)).toBeUndefined()
    })
})

describe('getCategoryName', () => {
    it('存在的分類回傳名稱', () => {
        expect(getCategoryName('expense', 'food')).toBe('飲食')
        expect(getCategoryName('income', 'salary')).toBe('薪水')
    })

    it('不存在的分類回傳未知分類', () => {
        expect(getCategoryName('expense', 'fake')).toBe('未知分類')
    })

    it('空字串 id 回傳未知分類', () => {
        expect(getCategoryName('expense', '')).toBe('未知分類')
    })

    it('null id 回傳未知分類', () => {
        expect(getCategoryName('expense', null)).toBe('未知分類')
    })

    it('returns string for valid category', () => {
        expect(typeof getCategoryName('expense', 'food')).toBe('string')
    })

    it('returns fallback string for undefined type', () => {
        expect(getCategoryName(undefined, 'food')).toBe('未知分類')
    })
})

describe('getCategoryIcon', () => {
    it('存在的分類回傳 icon', () => {
        expect(getCategoryIcon('expense', 'food')).toBe('fas fa-utensils')
        expect(getCategoryIcon('income', 'bonus')).toBe('fas fa-gift')
    })

    it('不存在的分類回傳預設 icon', () => {
        expect(getCategoryIcon('expense', 'fake')).toBe('fas fa-question')
    })

    it('空字串 id 回傳預設 icon', () => {
        expect(getCategoryIcon('expense', '')).toBe('fas fa-question')
    })

    it('null id 回傳預設 icon', () => {
        expect(getCategoryIcon('expense', null)).toBe('fas fa-question')
    })

    it('returns string for valid category', () => {
        expect(typeof getCategoryIcon('expense', 'food')).toBe('string')
    })

    it('returns fallback for undefined type', () => {
        expect(getCategoryIcon(undefined, 'food')).toBe('fas fa-question')
    })
})

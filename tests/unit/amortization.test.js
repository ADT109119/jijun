import { describe, it, expect } from 'vitest';
import {
    calculateAmortizationDetails,
    calculateNextDueDate,
    shouldSkipDate,
} from '../../src/js/utils.js';

// ==================== calculateAmortizationDetails ====================

describe('calculateAmortizationDetails', () => {
    it('本金為 0 回傳零值', () => {
        expect(calculateAmortizationDetails(0, 12, 3.5, 'monthly')).toEqual({ amountPerPeriod: 0, exactTotalToPay: 0 });
    });

    it('期數為 0 回傳零值', () => {
        expect(calculateAmortizationDetails(10000, 0, 3.5, 'monthly')).toEqual({ amountPerPeriod: 0, exactTotalToPay: 0 });
    });

    it('無利率：每期金額 = 本金 / 期數', () => {
        const result = calculateAmortizationDetails(3600, 12, 0, 'monthly');
        expect(result.amountPerPeriod).toBe(300);
        expect(result.exactTotalToPay).toBe(3600);
    });

    it('無利率 + 非整除：round 策略四捨五入', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly');
        expect(result.amountPerPeriod).toBe(333); // Math.round(333.33)
    });

    it('有利率（月付）：正確計算年金', () => {
        const result = calculateAmortizationDetails(100000, 12, 3.5, 'monthly');
        expect(result.amountPerPeriod).toBeGreaterThan(8400);
        expect(result.amountPerPeriod).toBeLessThan(8500);
        expect(result.exactTotalToPay).toBeGreaterThan(100000); // 總額 > 本金
    });

    it('有利率（週付）：periodRate = annualRate / 100 / 52', () => {
        const result = calculateAmortizationDetails(10000, 52, 5, 'weekly');
        expect(result.amountPerPeriod).toBeGreaterThan(180);
        expect(result.amountPerPeriod).toBeLessThan(200);
    });

    it('有利率（年付）：periodRate = annualRate / 100', () => {
        const result = calculateAmortizationDetails(50000, 3, 4, 'yearly');
        expect(result.amountPerPeriod).toBeGreaterThan(17000);
        expect(result.amountPerPeriod).toBeLessThan(19000);
    });

    it('decimalStrategy: round', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly', 'round');
        expect(result.amountPerPeriod).toBe(Math.round(1000 / 3)); // 333
    });

    it('decimalStrategy: ceil', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly', 'ceil');
        expect(result.amountPerPeriod).toBe(Math.ceil(1000 / 3)); // 334
    });

    it('decimalStrategy: floor', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly', 'floor');
        expect(result.amountPerPeriod).toBe(Math.floor(1000 / 3)); // 333
    });

    it('decimalStrategy: keep（保留兩位小數）', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly', 'keep');
        expect(result.amountPerPeriod).toBe(Math.round((1000 / 3) * 100) / 100); // 333.33
    });
});

// ==================== calculateNextDueDate ====================

describe('calculateNextDueDate', () => {
    it('daily + interval=1：加一天', () => {
        expect(calculateNextDueDate('2024-01-15', 'daily', 1)).toBe('2024-01-16');
    });

    it('weekly + interval=1：加七天', () => {
        expect(calculateNextDueDate('2024-01-15', 'weekly', 1)).toBe('2024-01-22');
    });

    it('weekly + interval=2：加十四天', () => {
        expect(calculateNextDueDate('2024-01-01', 'weekly', 2)).toBe('2024-01-15');
    });

    it('monthly + interval=1：加一個月（跨月，月末自動調整）', () => {
        // JavaScript setMonth: Jan 31 + 1 month → Feb doesn't have 31, rolls to Mar 2/3
        const result = calculateNextDueDate('2024-01-31', 'monthly', 1);
        expect(result).toMatch(/^2024-0[23]-\d{2}$/); // Feb or Mar (leap year handling)
    });

    it('yearly + interval=1：加一年（閏年→非閏年自動調整）', () => {
        // JavaScript setFullYear: 2024-02-29 + 1 year → 2025-03-01 (non-leap year rolls forward)
        const result = calculateNextDueDate('2024-02-29', 'yearly', 1);
        expect(result).toBe('2025-03-01');
    });

    it('monthly + interval=3：加三個月', () => {
        expect(calculateNextDueDate('2024-01-15', 'monthly', 3)).toBe('2024-04-15');
    });

    it('yearly + interval=1：加一年（閏年→非閏年自動調整）', () => {
        // JavaScript setFullYear: 2024-02-29 + 1 year → 2025-03-01 (non-leap year rolls forward)
        expect(calculateNextDueDate('2024-02-29', 'yearly', 1)).toBe('2025-03-01');
    });

    it('monthly 跨年', () => {
        expect(calculateNextDueDate('2024-12-15', 'monthly', 3)).toBe('2025-03-15');
    });

    it('invalid frequency 拋出錯誤', () => {
        expect(() => calculateNextDueDate('2024-01-15', 'biweekly', 1)).toThrow('Invalid frequency');
    });
});

// ==================== shouldSkipDate ====================

describe('shouldSkipDate', () => {
    it('無 skipRules 回傳 false', () => {
        expect(shouldSkipDate(new Date('2024-01-15'), null)).toBe(false);
        expect(shouldSkipDate(new Date('2024-01-15'), undefined)).toBe(false);
        expect(shouldSkipDate(new Date('2024-01-15'), [])).toBe(false);
    });

    it('dayOfWeek 規則：週日（0）跳過', () => {
        const rules = [{ type: 'dayOfWeek', values: [0] }]; // Sunday
        const sunday = new Date('2024-01-14'); // Jan 14, 2024 is Sunday
        expect(shouldSkipDate(sunday, rules)).toBe(true);

        const monday = new Date('2024-01-15'); // Monday
        expect(shouldSkipDate(monday, rules)).toBe(false);
    });

    it('dayOfMonth 規則：每月 1 號跳過', () => {
        const rules = [{ type: 'dayOfMonth', values: [1] }];
        expect(shouldSkipDate(new Date('2024-03-01'), rules)).toBe(true);
        expect(shouldSkipDate(new Date('2024-03-15'), rules)).toBe(false);
    });

    it('monthOfYear 規則：三月（index=2）跳過', () => {
        const rules = [{ type: 'monthOfYear', values: [2] }]; // March
        expect(shouldSkipDate(new Date('2024-03-15'), rules)).toBe(true);
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false);
    });

    it('多個 skipRules：OR 邏輯（任一匹配就跳過）', () => {
        const rules = [
            { type: 'dayOfWeek', values: [0, 6] }, // Sat & Sun
            { type: 'monthOfYear', values: [5, 6, 7] } // Jun, Jul, Aug
        ];

        // Saturday
        expect(shouldSkipDate(new Date('2024-01-13'), rules)).toBe(true);
        // Sunday
        expect(shouldSkipDate(new Date('2024-01-14'), rules)).toBe(true);
        // July (summer) - not a weekend
        expect(shouldSkipDate(new Date('2024-07-15'), rules)).toBe(true);
        // January weekday
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false);
    });

    it('rule 無 values 跳過該 rule', () => {
        const rules = [{ type: 'dayOfWeek', values: [] }];
        expect(shouldSkipDate(new Date('2024-01-14'), rules)).toBe(false); // Sunday but empty values
    });

    it('unknown type 不匹配', () => {
        const rules = [{ type: 'unknownType', values: [1] }];
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false);
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHTML,
  formatDateToString,
  formatCurrency,
  formatDate,
  showToast,
  debounce,
  throttle,
  deepClone,
  generateId,
  isValidDate,
  getDateRange,
  getMonthRange,
  calculateNextDueDate,
  shouldSkipDate
} from '../src/js/utils.js';

describe('utils.js', () => {
  describe('escapeHTML', () => {
    it('should escape HTML characters to prevent XSS', () => {
      expect(escapeHTML('<div>Test</div>')).toBe('&lt;div&gt;Test&lt;/div&gt;');
      expect(escapeHTML('User & Name')).toBe('User &amp; Name');
      expect(escapeHTML('"Quotes"')).toBe('&quot;Quotes&quot;');
      expect(escapeHTML("'Single Quotes'")).toBe('&#39;Single Quotes&#39;');
    });

    it('should handle null or undefined input', () => {
      expect(escapeHTML(null)).toBe('');
      expect(escapeHTML(undefined)).toBe('');
    });
  });

  describe('formatDateToString', () => {
    it('should format Date object to YYYY-MM-DD', () => {
      const date = new Date('2023-05-15T10:00:00Z');
      expect(formatDateToString(date)).toBe('2023-05-15');
    });
  });

  describe('formatCurrency', () => {
    it('should format number to TWD currency format', () => {
      expect(formatCurrency(1234)).toBe('$1,234');
      expect(formatCurrency(1234.5)).toBe('$1,234.5');
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('should handle invalid number gracefully', () => {
      expect(formatCurrency(NaN)).toBe('0');
    });
  });

  describe('formatDate', () => {
    it('should format string to short date', () => {
      expect(formatDate('2023-05-15')).toMatch(/05\/15|5\/15/);
    });
  });

  describe('deepClone', () => {
    it('should deep clone an object', () => {
      const obj = { a: 1, b: { c: 2 }, d: new Date('2023-01-01') };
      const cloned = deepClone(obj);

      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
      expect(cloned.d).not.toBe(obj.d);
    });

    it('should return primitive values as is', () => {
      expect(deepClone(null)).toBeNull();
      expect(deepClone(undefined)).toBeUndefined();
      expect(deepClone(123)).toBe(123);
      expect(deepClone('string')).toBe('string');
    });

    it('should clone an array', () => {
      const arr = [1, { a: 2 }];
      const clonedArr = deepClone(arr);
      expect(clonedArr).toEqual(arr);
      expect(clonedArr).not.toBe(arr);
      expect(clonedArr[1]).not.toBe(arr[1]);
    });
  });

  describe('generateId', () => {
    it('should generate a unique string', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
      expect(id1).not.toBe(id2);
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date strings', () => {
      expect(isValidDate('2023-05-15')).toBe(true);
      expect(isValidDate('2023/05/15')).toBe(true);
    });

    it('should return false for invalid date strings', () => {
      expect(isValidDate('invalid-date')).toBe(false);
      expect(isValidDate('')).toBe(false);
    });
  });

  describe('getDateRange', () => {
    // Note: To test this reliably, we'd ideally mock new Date()
    // For now, just test the structure of the returned object
    it('should return startDate and endDate for today', () => {
      const range = getDateRange('today');
      expect(range).toHaveProperty('startDate');
      expect(range).toHaveProperty('endDate');
      expect(range.startDate).toBe(range.endDate);
    });

    it('should handle last7days', () => {
      const range = getDateRange('last7days');
      expect(range).toHaveProperty('startDate');
      expect(range).toHaveProperty('endDate');
      expect(new Date(range.startDate) < new Date(range.endDate)).toBe(true);
    });
  });

  describe('getMonthRange', () => {
    it('should return start and end date of a given month', () => {
      const range = getMonthRange(2023, 1); // February (0-indexed)
      expect(range.startDate).toBe('2023-02-01');
      expect(range.endDate).toBe('2023-02-28'); // Non-leap year
    });

    it('should handle leap years correctly', () => {
      const range = getMonthRange(2024, 1); // February 2024
      expect(range.startDate).toBe('2024-02-01');
      expect(range.endDate).toBe('2024-02-29'); // Leap year
    });
  });

  describe('calculateNextDueDate', () => {
    it('should calculate next daily due date', () => {
      expect(calculateNextDueDate('2023-05-15', 'daily', 1)).toBe('2023-05-16');
      expect(calculateNextDueDate('2023-05-15', 'daily', 3)).toBe('2023-05-18');
    });

    it('should calculate next weekly due date', () => {
      expect(calculateNextDueDate('2023-05-15', 'weekly', 1)).toBe('2023-05-22');
    });

    it('should calculate next monthly due date', () => {
      expect(calculateNextDueDate('2023-05-15', 'monthly', 1)).toBe('2023-06-15');
    });

    it('should calculate next yearly due date', () => {
      expect(calculateNextDueDate('2023-05-15', 'yearly', 1)).toBe('2024-05-15');
    });
  });

  describe('shouldSkipDate', () => {
    const testDate = new Date('2023-05-15'); // Monday, May 15, 2023

    it('should return false if skipRules is empty', () => {
      expect(shouldSkipDate(testDate, [])).toBe(false);
      expect(shouldSkipDate(testDate, null)).toBe(false);
    });

    it('should skip if dayOfWeek matches', () => {
      expect(shouldSkipDate(testDate, [{ type: 'dayOfWeek', values: [1] }])).toBe(true); // 1 = Monday
      expect(shouldSkipDate(testDate, [{ type: 'dayOfWeek', values: [0, 6] }])).toBe(false); // Weekend
    });

    it('should skip if dayOfMonth matches', () => {
      expect(shouldSkipDate(testDate, [{ type: 'dayOfMonth', values: [15] }])).toBe(true);
      expect(shouldSkipDate(testDate, [{ type: 'dayOfMonth', values: [1, 14, 16] }])).toBe(false);
    });

    it('should skip if monthOfYear matches', () => {
      expect(shouldSkipDate(testDate, [{ type: 'monthOfYear', values: [4] }])).toBe(true); // 4 = May (0-indexed)
      expect(shouldSkipDate(testDate, [{ type: 'monthOfYear', values: [0, 11] }])).toBe(false);
    });
  });

  describe('debounce & throttle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should debounce a function call', () => {
      const func = vi.fn();
      const debouncedFunc = debounce(func, 100);

      debouncedFunc();
      debouncedFunc();
      debouncedFunc();

      expect(func).not.toBeCalled();

      vi.advanceTimersByTime(50);
      expect(func).not.toBeCalled();

      vi.advanceTimersByTime(50);
      expect(func).toBeCalledTimes(1);
    });

    it('should throttle a function call', () => {
      const func = vi.fn();
      const throttledFunc = throttle(func, 100);

      throttledFunc();
      expect(func).toBeCalledTimes(1);

      throttledFunc();
      throttledFunc();
      expect(func).toBeCalledTimes(1);

      vi.advanceTimersByTime(100);
      throttledFunc();
      expect(func).toBeCalledTimes(2);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { escapeHTML, formatDateToString, formatCurrency, isValidDate } from '../../src/js/utils.js';

describe('escapeHTML', () => {
    it('null / undefined 回傳空字串', () => {
        expect(escapeHTML(null)).toBe('');
        expect(escapeHTML(undefined)).toBe('');
    });

    it('一般字串原樣回傳', () => {
        expect(escapeHTML('hello world')).toBe('hello world');
        expect(escapeHTML('12345')).toBe('12345');
    });

    it('轉義 & 為 &amp;', () => {
        expect(escapeHTML('a&b')).toBe('a&amp;b');
    });

    it('轉義 < 為 &lt;', () => {
        expect(escapeHTML('<div>')).toBe('&lt;div&gt;');
    });

    it('轉義 > 為 &gt;', () => {
        expect(escapeHTML('>')).toBe('&gt;');
    });

    it('轉義 " 為 &quot;', () => {
        expect(escapeHTML('"hello"')).toBe('&quot;hello&quot;');
    });

    it('轉義 \' 為 &#39;', () => {
        expect(escapeHTML("'test'")).toBe('&#39;test&#39;');
    });

    it('XSS payload 完整轉義', () => {
        const input = '<script>alert("xss")</script>';
        const output = escapeHTML(input);
        expect(output).toContain('&lt;script&gt;');
        expect(output).not.toContain('<script>');
    });

    it('多重特殊字元同時轉義', () => {
        const input = '<a href="&test\'">';
        const output = escapeHTML(input);
        expect(output).toBe('&lt;a href=&quot;&amp;test&#39;&quot;&gt;');
    });
});

describe('formatDateToString', () => {
    it('正確格式化 YYYY-MM-DD', () => {
        const date = new Date(2024, 0, 15); // Jan 15, 2024
        expect(formatDateToString(date)).toBe('2024-01-15');
    });

    it('個位數月份補零', () => {
        const date = new Date(2024, 2, 5); // Mar 5, 2024
        expect(formatDateToString(date)).toBe('2024-03-05');
    });

    it('個位數日期補零', () => {
        const date = new Date(2024, 9, 1); // Oct 1, 2024
        expect(formatDateToString(date)).toBe('2024-10-01');
    });

    it('跨年邊界正確', () => {
        const date = new Date(2023, 11, 31); // Dec 31, 2023
        expect(formatDateToString(date)).toBe('2023-12-31');
    });

    it('閏年正確', () => {
        const date = new Date(2024, 1, 29); // Feb 29, 2024 (leap year)
        expect(formatDateToString(date)).toBe('2024-02-29');
    });

    it('非閏年二月', () => {
        const date = new Date(2023, 1, 28); // Feb 28, 2023
        expect(formatDateToString(date)).toBe('2023-02-28');
    });
});

describe('formatCurrency', () => {
    it('一般金額格式化（最多兩位小數）', () => {
        expect(formatCurrency(1234.5)).toBe('$1,234.5');
    });

    it('整數無小數點', () => {
        expect(formatCurrency(1000)).toBe('$1,000');
    });

    it('負數正確顯示', () => {
        expect(formatCurrency(-500)).toBe('-$500');
    });

    it('NaN 回傳 0', () => {
        expect(formatCurrency(NaN)).toBe('0');
    });

    it('大數字千分位格式化', () => {
        expect(formatCurrency(1000000)).toBe('$1,000,000');
    });

    it('小數保留到兩位', () => {
        expect(formatCurrency(9.4)).toBe('$9.4');
        expect(formatCurrency(9.567)).toBe('$9.57');
    });

    it('兩位小數正確處理', () => {
        expect(formatCurrency(1234.567)).toBe('$1,234.57');
        expect(formatCurrency(1234.564)).toBe('$1,234.56');
    });

    it('零值', () => {
        expect(formatCurrency(0)).toBe('$0');
    });
});

describe('isValidDate', () => {
    it('有效日期字串回傳 true', () => {
        expect(isValidDate('2024-01-15')).toBe(true);
        expect(isValidDate('2024/01/15')).toBe(true);
    });

    it('無效日期字串回傳 false', () => {
        expect(isValidDate('invalid')).toBe(false);
        expect(isValidDate('')).toBe(false);
        // new Date(null) → valid date (Jan 1, 1970)，所以 null/undefined 不會是 false
        expect(isValidDate('2024-13-01')).toBe(false); // 月份不存在
    });

    it('Date object 驗證', () => {
        const valid = new Date(2024, 0, 15);
        const invalid = new Date('invalid');
        expect(isValidDate(valid)).toBe(true);
        expect(isValidDate(invalid)).toBe(false);
    });
});

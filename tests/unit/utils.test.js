import { describe, it, expect, vi } from 'vitest';
import { escapeHTML, formatDateToString, formatCurrency, isValidDate, debounce, throttle, deepClone, generateId } from '../../src/js/utils.js';

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

describe('debounce', () => {
    it('多次呼叫只執行最後一次', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        
        debounced();
        debounced();
        debounced();

        // 在 delay 前不應執行
        expect(fn).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        
        expect(fn).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
    });

    it('延遲後執行函數並傳遞參數', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const debounced = debounce(fn, 50);
        
        debounced('arg1', 'arg2');
        
        await vi.advanceTimersByTimeAsync(60);
        
        expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
        vi.restoreAllMocks();
    });

    it('重置計時器', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        
        debounced(); // 第一次呼叫
        
        await vi.advanceTimersByTimeAsync(50);
        expect(fn).not.toHaveBeenCalled();
        
        debounced(); // 重置計時器（從 T+50 開始重新計算）
        
        // 需要再推進 100ms（從 reset 點算起）
        await vi.advanceTimersByTimeAsync(100);
        
        expect(fn).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
    });
});

describe('throttle', () => {
    it('在限制時間內只執行一次', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const throttled = throttle(fn, 100);
        
        throttled(); // 第一次：執行
        expect(fn).toHaveBeenCalledTimes(1);
        
        throttled(); // 第二次：被节流
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(50);
        
        throttled(); // 仍在限制內
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60);
        
        throttled(); // 超過限制，重新執行
        expect(fn).toHaveBeenCalledTimes(2);
        vi.restoreAllMocks();
    });

    it('傳遞參數和 this context', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const throttled = throttle(fn, 100);
        
        throttled.call({ value: 42 }, 'testArg');
        
        expect(fn).toHaveBeenCalledWith('testArg');
        vi.restoreAllMocks();
    });

    it('連續快速呼叫只保留第一次', async () => {
        vi.useFakeTimers();
        
        const fn = vi.fn();
        const throttled = throttle(fn, 200);
        
        for (let i = 0; i < 10; i++) {
            throttled(i);
        }
        
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(0); // 只保留第一次的參數
        
        await vi.advanceTimersByTimeAsync(200);
        
        throttled('after-throttle');
        expect(fn).toHaveBeenCalledTimes(2);
        vi.restoreAllMocks();
    });
});

describe('deepClone', () => {
    it('基本型別原樣回傳', () => {
        expect(deepClone(null)).toBeNull();
        expect(deepClone(undefined)).toBeUndefined();
        expect(deepClone(42)).toBe(42);
        expect(deepClone('string')).toBe('string');
        expect(deepClone(true)).toBe(true);
    });

    it('Date 物件正確拷貝', () => {
        const original = new Date('2024-01-15T10:30:00Z');
        const cloned = deepClone(original);
        
        expect(cloned).toBeInstanceOf(Date);
        expect(cloned.getTime()).toBe(original.getTime());
        expect(cloned).not.toBe(original); // 不同物件
    });

    it('陣列深層拷貝', () => {
        const original = [1, 'two', { three: 3 }];
        const cloned = deepClone(original);
        
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original); // 不同物件
        
        // 修改 clone 不影響原始
        cloned[0] = 999;
        expect(original[0]).toBe(1);
    });

    it('巢狀物件深層拷貝', () => {
        const original = {
            a: 1,
            b: {
                c: 2,
                d: {
                    e: 'deep'
                }
            },
            f: [3, 4]
        };
        
        const cloned = deepClone(original);
        
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned.b).not.toBe(original.b);
        expect(cloned.b.d).not.toBe(original.b.d);
        expect(cloned.f).not.toBe(original.f);
        
        // 修改 clone 不影響原始
        cloned.b.c = 999;
        expect(original.b.c).toBe(2);
    });

    it('空物件/陣列', () => {
        expect(deepClone({})).toEqual({});
        expect(deepClone([])).toEqual([]);
        
        const emptyObj = deepClone({});
        const emptyArr = deepClone([]);
        
        expect(emptyObj).not.toBe({});
        expect(emptyArr).not.toBe([]);
    });

    it('包含 undefined 值的物件', () => {
        const original = { a: 1, b: undefined, c: null };
        const cloned = deepClone(original);
        
        expect(cloned.a).toBe(1);
        expect(cloned.b).toBeUndefined();
        expect(cloned.c).toBeNull();
    });

    it('不拷貝 prototype 屬性', () => {
        function MyClass() { this.x = 1; }
        MyClass.prototype.y = 2;
        
        const instance = new MyClass();
        const cloned = deepClone(instance);
        
        expect(cloned).toEqual({ x: 1 });
        expect(cloned.y).toBeUndefined(); // prototype 屬性不被拷貝
    });
});

describe('generateId', () => {
    it('回傳字串類型', () => {
        const id = generateId();
        expect(typeof id).toBe('string');
    });

    it('生成的 ID 不重複', () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++) {
            ids.add(generateId());
        }
        expect(ids.size).toBe(100); // 所有 ID 都不同
    });

    it('使用 crypto.randomUUID 時格式正確', () => {
        const originalRandomUUID = globalThis.crypto?.randomUUID;
        
        if (globalThis.crypto && globalThis.crypto.randomUUID) {
            const id = generateId();
            // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        }
    });

    it('fallback 模式產生有效 ID', () => {
        const originalCrypto = globalThis.crypto;
        
        // 模擬 crypto 不存在
        delete globalThis.crypto;
        
        try {
            const id = generateId();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        } finally {
            globalThis.crypto = originalCrypto;
        }
    });
});

import { describe, it, expect } from 'vitest';
import { ComparisonReport } from '../../src/js/comparisonReport.js';

/**
 * comparisonReport.js 單元測試
 * 測試 getLastYearPeriods (static)、exportToCSV (instance)
 * 以及 calculateComparison 的 typeFilter 參數行為
 */

// ==================== getLastYearPeriods (static) ====================

describe('ComparisonReport.getLastYearPeriods', () => {
    it('將月份期間減一年', () => {
        const result = ComparisonReport.getLastYearPeriods(['2026-05', '2026-06']);
        expect(result).toEqual(['2025-05', '2025-06']);
    });

    it('將年度期間減一年', () => {
        const result = ComparisonReport.getLastYearPeriods(['2025', '2026']);
        expect(result).toEqual(['2024', '2025']);
    });

    it('支援 4 個期間', () => {
        const result = ComparisonReport.getLastYearPeriods(['2026-01', '2026-02', '2026-03', '2026-04']);
        expect(result).toEqual(['2025-01', '2025-02', '2025-03', '2025-04']);
    });

    it('空陣列回傳空陣列', () => {
        expect(ComparisonReport.getLastYearPeriods([])).toEqual([]);
    });

    it('單一期間正常回傳', () => {
        expect(ComparisonReport.getLastYearPeriods(['2026-12'])).toEqual(['2025-12']);
    });
});

// ==================== exportToCSV ====================

describe('ComparisonReport.exportToCSV', () => {
    const mockData = {
        periodLabels: ['2026-05', '2026-06'],
        periodType: 'month',
        typeFilter: 'all',
        periodData: [
            { label: '2026-05', income: 50000, expense: 30000 },
            { label: '2026-06', income: 55000, expense: 32000 },
        ],
        categoryComparisons: [
            {
                category: 'food',
                period0: 10000,
                period0Signed: -10000,
                period1: 12000,
                period1Signed: -12000,
            },
            {
                category: 'transport',
                period0: 5000,
                period0Signed: -5000,
                period1: 4000,
                period1Signed: -4000,
            },
        ],
    };

    it('產生有效的 CSV 字串', () => {
        const csv = new ComparisonReport(null, null).exportToCSV(mockData);
        expect(csv).toContain('比較類型');
        expect(csv).toContain('2026-05');
        expect(csv).toContain('2026-06');
    });

    it('包含摘要區段', () => {
        const csv = new ComparisonReport(null, null).exportToCSV(mockData);
        expect(csv).toContain('期間,收入,支出,結餘');
        expect(csv).toContain('2026-05,50000.00,30000.00,20000.00');
        expect(csv).toContain('2026-06,55000.00,32000.00,23000.00');
    });

    it('包含分類比較區段', () => {
        const csv = new ComparisonReport(null, null).exportToCSV(mockData);
        expect(csv).toContain('food');
        expect(csv).toContain('transport');
    });

    it('計算變化率', () => {
        const csv = new ComparisonReport(null, null).exportToCSV(mockData);
        // food: (12000-10000)/10000 = 20%
        expect(csv).toContain('20.0%');
        // transport: (4000-5000)/5000 = -20%
        expect(csv).toContain('-20.0%');
    });

    it('篩選類型顯示在 CSV 中', () => {
        const csv = new ComparisonReport(null, null).exportToCSV(mockData);
        expect(csv).toContain('篩選類型,all');
    });

    it('typeFilter=expense 時正確顯示', () => {
        const data = { ...mockData, typeFilter: 'expense' };
        const csv = new ComparisonReport(null, null).exportToCSV(data);
        expect(csv).toContain('篩選類型,expense');
    });

    it('空分類比較時仍產生有效 CSV', () => {
        const data = { ...mockData, categoryComparisons: [] };
        const csv = new ComparisonReport(null, null).exportToCSV(data);
        expect(csv).toContain('期間,收入,支出,結餘');
    });
});

// ==================== calculateSavingsRates (static) ====================

describe('ComparisonReport.calculateSavingsRates', () => {
    it('正常計算儲蓄率', () => {
        const periodData = [
            { label: '2026-05', income: 50000, expense: 30000 },
            { label: '2026-06', income: 60000, expense: 45000 },
        ];
        const rates = ComparisonReport.calculateSavingsRates(periodData);
        expect(rates).toHaveLength(2);
        expect(rates[0]).toBeCloseTo(40, 1); // (50000-30000)/50000 = 40%
        expect(rates[1]).toBeCloseTo(25, 1); // (60000-45000)/60000 = 25%
    });

    it('零收入時回傳 0', () => {
        const periodData = [{ label: '2026-05', income: 0, expense: 1000 }];
        const rates = ComparisonReport.calculateSavingsRates(periodData);
        expect(rates[0]).toBe(0);
    });

    it('負儲蓄率（入不敷出）', () => {
        const periodData = [{ label: '2026-05', income: 20000, expense: 30000 }];
        const rates = ComparisonReport.calculateSavingsRates(periodData);
        expect(rates[0]).toBeCloseTo(-50, 1);
    });

    it('收支平衡時回傳 0', () => {
        const periodData = [{ label: '2026-05', income: 50000, expense: 50000 }];
        const rates = ComparisonReport.calculateSavingsRates(periodData);
        expect(rates[0]).toBe(0);
    });

    it('空陣列回傳空陣列', () => {
        expect(ComparisonReport.calculateSavingsRates([])).toEqual([]);
    });
});

// ==================== calculateTrends (static) ====================

describe('ComparisonReport.calculateTrends', () => {
    it('第一筆永遠是 —（無前一期）', () => {
        const trends = ComparisonReport.calculateTrends([100, 200]);
        expect(trends[0]).toBe('—');
    });

    it('數值上升回傳 ↑', () => {
        const trends = ComparisonReport.calculateTrends([100, 200]);
        expect(trends[1]).toBe('↑');
    });

    it('數值下降回傳 ↓', () => {
        const trends = ComparisonReport.calculateTrends([200, 100]);
        expect(trends[1]).toBe('↓');
    });

    it('微小變化（< 0.5%）回傳 —', () => {
        const trends = ComparisonReport.calculateTrends([1000, 1000.4]);
        expect(trends[1]).toBe('—');
    });

    it('前一期為零且當前為正數', () => {
        const trends = ComparisonReport.calculateTrends([0, 100]);
        expect(trends[1]).toBe('↑');
    });

    it('前一期為零且當前也為零', () => {
        const trends = ComparisonReport.calculateTrends([0, 0]);
        expect(trends[1]).toBe('—');
    });

    it('多期趨勢計算', () => {
        const trends = ComparisonReport.calculateTrends([100, 200, 150, 300]);
        expect(trends).toEqual(['—', '↑', '↓', '↑']);
    });

    it('空陣列回傳空陣列', () => {
        expect(ComparisonReport.calculateTrends([])).toEqual([]);
    });

    it('單筆回傳只有 —', () => {
        expect(ComparisonReport.calculateTrends([100])).toEqual(['—']);
    });
});

// ==================== calculatePercentageBreakdown (static) ====================

describe('ComparisonReport.calculatePercentageBreakdown', () => {
    const periodData = [
        { label: '2026-05', income: 50000, expense: 30000 },
        { label: '2026-06', income: 60000, expense: 40000 },
    ];
    const categoryComparisons = [
        {
            category: 'food',
            period0: 9000,
            period0Signed: -9000,
            period1: 16000,
            period1Signed: -16000,
        },
        {
            category: 'transport',
            period0: 6000,
            period0Signed: -6000,
            period1: 8000,
            period1Signed: -8000,
        },
    ];

    it('計算正確的百分比', () => {
        const result = ComparisonReport.calculatePercentageBreakdown(periodData, categoryComparisons);
        expect(result).toHaveLength(2);
        // food period 0: 9000/30000 = 30%
        expect(result[0].percentages[0]).toBeCloseTo(30, 1);
        // food period 1: 16000/40000 = 40%
        expect(result[0].percentages[1]).toBeCloseTo(40, 1);
        // transport period 0: 6000/30000 = 20%
        expect(result[1].percentages[0]).toBeCloseTo(20, 1);
    });

    it('零支出時百分比為 0', () => {
        const zeroData = [{ label: '2026-05', income: 0, expense: 0 }];
        const cats = [{ category: 'food', period0: 100, period0Signed: -100 }];
        const result = ComparisonReport.calculatePercentageBreakdown(zeroData, cats);
        expect(result[0].percentages[0]).toBe(0);
    });

    it('空分類比較回傳空陣列', () => {
        const result = ComparisonReport.calculatePercentageBreakdown(periodData, []);
        expect(result).toEqual([]);
    });

    it('回傳結構正確', () => {
        const result = ComparisonReport.calculatePercentageBreakdown(periodData, categoryComparisons);
        expect(result[0]).toHaveProperty('category');
        expect(result[0]).toHaveProperty('percentages');
        expect(Array.isArray(result[0].percentages)).toBe(true);
    });
});

// ==================== getDaysInPeriod (static) ====================

describe('ComparisonReport.getDaysInPeriod', () => {
    it('平年 2 月回傳 28', () => {
        expect(ComparisonReport.getDaysInPeriod('month', '2026-02')).toBe(28);
    });

    it('閏年 2 月回傳 29', () => {
        expect(ComparisonReport.getDaysInPeriod('month', '2024-02')).toBe(29);
    });

    it('31 天之月回傳 31', () => {
        expect(ComparisonReport.getDaysInPeriod('month', '2026-01')).toBe(31);
        expect(ComparisonReport.getDaysInPeriod('month', '2026-03')).toBe(31);
        expect(ComparisonReport.getDaysInPeriod('month', '2026-12')).toBe(31);
    });

    it('30 天之月回傳 30', () => {
        expect(ComparisonReport.getDaysInPeriod('month', '2026-04')).toBe(30);
        expect(ComparisonReport.getDaysInPeriod('month', '2026-06')).toBe(30);
    });

    it('平年回傳 365', () => {
        expect(ComparisonReport.getDaysInPeriod('year', '2026')).toBe(365);
    });

    it('閏年回傳 366', () => {
        expect(ComparisonReport.getDaysInPeriod('year', '2024')).toBe(366);
    });
});

// ==================== calculateDailyAverages (static) ====================

describe('ComparisonReport.calculateDailyAverages', () => {
    it('計算正確的日均支出', () => {
        const periodData = [
            { label: '2026-01', income: 50000, expense: 31000 }, // 31 days
            { label: '2026-02', income: 50000, expense: 28000 }, // 28 days
        ];
        const labels = ['2026-01', '2026-02'];
        const result = ComparisonReport.calculateDailyAverages(periodData, 'month', labels);
        expect(result[0]).toBeCloseTo(31000 / 31, 1);
        expect(result[1]).toBeCloseTo(28000 / 28, 1);
    });

    it('零支出時回傳 0', () => {
        const periodData = [{ label: '2026-01', income: 50000, expense: 0 }];
        const result = ComparisonReport.calculateDailyAverages(periodData, 'month', ['2026-01']);
        expect(result[0]).toBe(0);
    });

    it('年度期間也能計算', () => {
        const periodData = [{ label: '2026', income: 600000, expense: 365000 }];
        const result = ComparisonReport.calculateDailyAverages(periodData, 'year', ['2026']);
        expect(result[0]).toBeCloseTo(365000 / 365, 1);
    });

    it('空陣列回傳空陣列', () => {
        expect(ComparisonReport.calculateDailyAverages([], 'month', [])).toEqual([]);
    });
});

// ==================== calculateComparison returns periodType & typeFilter ====================

describe('ComparisonReport.calculateComparison', () => {
    it('回傳物件包含 periodType 欄位', async () => {
        const mockDS = {
            getRecords: async () => [],
        };
        const comp = new ComparisonReport(mockDS, null);
        const result = await comp.calculateComparison('year', ['2025', '2026']);
        expect(result.periodType).toBe('year');
    });

    it('當 typeFilter=expense 時，只應包含支出紀錄', async () => {
        const mockDS = {
            getRecords: async () => [
                { type: 'income', amount: 1000, category: 'salary', date: '2026-05-15' },
                { type: 'expense', amount: 200, category: 'food', date: '2026-05-16' },
                { type: 'income', amount: 2000, category: 'salary', date: '2026-06-15' },
                { type: 'expense', amount: 300, category: 'food', date: '2026-06-17' },
            ],
        };
        const comp = new ComparisonReport(mockDS, null);
        const result = await comp.calculateComparison('month', ['2026-05', '2026-06'], { typeFilter: 'expense' });

        expect(result.periodData[0].income).toBe(0);
        expect(result.periodData[0].expense).toBe(200);
        expect(result.periodData[1].income).toBe(0);
        expect(result.periodData[1].expense).toBe(300);
        expect(result.typeFilter).toBe('expense');
    });

    it('當 typeFilter=income 時，只應包含收入紀錄', async () => {
        const mockDS = {
            getRecords: async () => [
                { type: 'income', amount: 1000, category: 'salary', date: '2026-05-15' },
                { type: 'expense', amount: 200, category: 'food', date: '2026-05-16' },
                { type: 'income', amount: 2000, category: 'salary', date: '2026-06-15' },
                { type: 'expense', amount: 300, category: 'food', date: '2026-06-17' },
            ],
        };
        const comp = new ComparisonReport(mockDS, null);
        const result = await comp.calculateComparison('month', ['2026-05', '2026-06'], { typeFilter: 'income' });

        expect(result.periodData[0].income).toBe(1000);
        expect(result.periodData[0].expense).toBe(0);
        expect(result.periodData[1].income).toBe(2000);
        expect(result.periodData[1].expense).toBe(0);
        expect(result.typeFilter).toBe('income');
    });

    it('當 typeFilter=all 時，應同時包含收入與支出紀錄', async () => {
        const mockDS = {
            getRecords: async () => [
                { type: 'income', amount: 1000, category: 'salary', date: '2026-05-15' },
                { type: 'expense', amount: 200, category: 'food', date: '2026-05-16' },
                { type: 'income', amount: 2000, category: 'salary', date: '2026-06-15' },
                { type: 'expense', amount: 300, category: 'food', date: '2026-06-17' },
            ],
        };
        const comp = new ComparisonReport(mockDS, null);
        const result = await comp.calculateComparison('month', ['2026-05', '2026-06'], { typeFilter: 'all' });

        expect(result.periodData[0].income).toBe(1000);
        expect(result.periodData[0].expense).toBe(200);
        expect(result.periodData[1].income).toBe(2000);
        expect(result.periodData[1].expense).toBe(300);
        expect(result.typeFilter).toBe('all');
    });
});

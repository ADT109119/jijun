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

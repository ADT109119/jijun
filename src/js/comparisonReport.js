/**
 * comparisonReport.js — Cross-month/year comparison report module
 *
 * Provides data aggregation for comparing income/expense across multiple
 * months or years.  Supports per-ledger filtering and MoZE 4.0-style
 * comparison with summary cards, bar charts, and category tables.
 *
 * Public API:
 *   ComparisonReport.calculateComparison(periodType, periods)
 *     periodType: 'month' | 'year'
 *     periods:    2-4 period labels (e.g. ['2026-05', '2026-06'])
 *   Returns: { periodLabels, periodData, categoryComparisons }
 */

import { formatCurrency, escapeHTML } from './utils.js';

export class ComparisonReport {
    /** @param {DataService} dataService */
    constructor(dataService, categoryManager) {
        this.dataService = dataService;
        this.categoryManager = categoryManager;
    }

    /* ------------------------------------------------------------------ */
    /*  Public helpers                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Get a list of available months or years the user can compare.
     * @param {'month'|'year'} periodType
     * @returns {string[]}  e.g. ['2026-05','2026-06','2026-07']
     */
    async getAvailablePeriods(periodType) {
        const records = await this.dataService.getRecords();
        const set = new Set();

        for (const r of records) {
            if (!r.date) continue;
            const parts = r.date.split('-');
            if (parts.length < 2) continue;
            if (periodType === 'month') {
                set.add(`${parts[0]}-${parts[1]}`);
            } else {
                set.add(parts[0]);
            }
        }
        return Array.from(set).sort();
    }

    /**
     * Core comparison computation.
     * @param {'month'|'year'} periodType
     * @param {string[]} periods  e.g. ['2026-05','2026-06']  (2-4 items)
     * @returns {Promise<Object>} comparison data
     */
    async calculateComparison(periodType, periods) {
        if (periods.length < 2) {
            throw new Error('Comparison requires at least 2 periods');
        }
        if (periods.length > 4) {
            periods = periods.slice(0, 4);
        }

        // Fetch records (auto-filtered by activeLedgerId via DataService)
        const records = await this.dataService.getRecords();

        // Pre-filter debt-collection / debt-repayment (same as getStatistics)
        const filtered = records.filter(
            r => r.category !== 'debt_collection' && r.category !== 'debt_repayment'
        );

        const periodData = periods.map(label => ({
            label,
            income: 0,
            expense: 0,
            categories: {},  // categoryKey -> amount (signed: +income, -expense)
        }));

        for (const r of filtered) {
            if (!r.date) continue;
            let matchIndex = -1;

            if (periodType === 'month') {
                // period label = 'YYYY-MM'
                const prefix = r.date.substring(0, 7);
                matchIndex = periods.indexOf(prefix);
            } else {
                // periodType === 'year'
                const prefix = r.date.substring(0, 4);
                matchIndex = periods.indexOf(prefix);
            }

            if (matchIndex < 0) continue;

            const amount = r.amount;
            const cat = r.category;

            if (r.type === 'income') {
                periodData[matchIndex].income += amount;
                periodData[matchIndex].categories[cat] =
                    (periodData[matchIndex].categories[cat] || 0) + amount;
            } else {
                periodData[matchIndex].expense += amount;
                periodData[matchIndex].categories[cat] =
                    (periodData[matchIndex].categories[cat] || 0) - amount;
            }
        }

        /* Build a unified category set — only categories that appear in ≥2 periods */
        const allCats = new Set();
        for (const pd of periodData) {
            for (const c of Object.keys(pd.categories)) {
                allCats.add(c);
            }
        }

        const categoryComparisons = [];
        for (const cat of allCats) {
            const row = { category: cat };
            let visiblePeriods = 0;
            for (let i = 0; i < periods.length; i++) {
                const val = periodData[i].categories[cat] || 0;
                row[`period${i}`] = Math.abs(val);
                row[`period${i}Signed`] = val;
                if (Math.abs(val) > 0) visiblePeriods++;
            }
            if (visiblePeriods >= 2) {
                categoryComparisons.push(row);
            }
        }
        categoryComparisons.sort((a, b) => {
            // Sort by total absolute value across all periods (descending)
            const sumA = periods.reduce((s, _, i) => s + Math.abs(a[`period${i}`] || 0), 0);
            const sumB = periods.reduce((s, _, i) => s + Math.abs(b[`period${i}`] || 0), 0);
            return sumB - sumA;
        });

        return {
            periodLabels: periods,
            periodType,
            periodData: periodData.map(pd => ({
                label: pd.label,
                income: pd.income,
                expense: pd.expense,
            })),
            categoryComparisons,
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Render helpers  (called from comparisonPage.js)                   */
    /* ------------------------------------------------------------------ */

    /**
     * Render the summary cards for each period.
     */
    renderSummaryCards(container, periodData) {
        let html = '<div class="grid gap-4 mb-6">';
        for (const pd of periodData) {
            const net = pd.income - pd.expense;
            // Calculate change vs previous period
            const currentIndex = periodData.indexOf(pd);
            const prevData = currentIndex > 0 ? periodData[currentIndex - 1] : null;
            let changeBadge = '';
            if (prevData) {
                const prevNet = prevData.income - prevData.expense;
                if (prevNet !== 0) {
                    const change = ((net - prevNet) / Math.abs(prevNet) * 100).toFixed(1);
                    const sign = change >= 0 ? '+' : '';
                    const cls = change >= 0 ? 'text-wabi-income' : 'text-wabi-expense';
                    const arrow = change >= 0 ? '↑' : '↓';
                    changeBadge = `<span class="text-xs ${cls} ml-2">${arrow} ${sign}${change}% vs 上一期間</span>`;
                }
            }
            html += `
                <div class="rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border">
                    <p class="text-sm font-bold text-wabi-primary mb-2">${pd.label} ${changeBadge}</p>
                    <div class="flex justify-between text-sm">
                        <span class="text-wabi-income">收入 ${formatCurrency(pd.income)}</span>
                        <span class="text-wabi-expense">支出 ${formatCurrency(pd.expense)}</span>
                    </div>
                    <div class="mt-2 text-center">
                        <span class="text-sm font-bold ${net >= 0 ? 'text-wabi-income' : 'text-wabi-expense'}">
                            結餘 ${formatCurrency(net)}
                        </span>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * Render category comparison table.
     */
    renderCategoryTable(container, periodLabels, categoryComparisons) {
        if (categoryComparisons.length === 0) {
            container.innerHTML =
                '<p class="text-center text-wabi-text-secondary py-6">無可比對的分類資料</p>';
            return;
        }

        let html = `<div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-wabi-border">
                        <th class="text-left py-2 px-1 text-wabi-text-secondary">分類</th>`;

        for (const lbl of periodLabels) {
            html += `<th class="text-right py-2 px-1 text-wabi-text-secondary">${escapeHTML(lbl)}</th>`;
        }
        html += `<th class="text-right py-2 px-1 text-wabi-text-secondary">變化</th></tr></thead><tbody>`;

        for (const row of categoryComparisons) {
            html += `<tr class="border-b border-wabi-border/50">`;
            // Category name
            const catObj = this.categoryManager.getCategoryById('expense', row.category) ||
                           this.categoryManager.getCategoryById('income', row.category);
            const catName = catObj ? catObj.name : row.category;
            html += `<td class="py-2 px-1 font-medium">${escapeHTML(catName)}</td>`;

            // Period values
            for (let i = 0; i < periodLabels.length; i++) {
                const val = row[`period${i}`] || 0;
                html += `<td class="text-right py-2 px-1">${formatCurrency(val)}</td>`;
            }

            // Change percentage (last vs first)
            const first = row[`period0`] || 0;
            const last = row[`period${periodLabels.length - 1}`] || 0;
            if (first > 0) {
                const pct = ((last - first) / first * 100).toFixed(1);
                const sign = pct >= 0 ? '+' : '';
                html += `<td class="text-right py-2 px-1 ${pct >= 0 ? 'text-wabi-expense' : 'text-wabi-income'}">${sign}${pct}%</td>`;
            } else {
                html += `<td class="text-right py-2 px-1 text-wabi-text-secondary">—</td>`;
            }

            html += '</tr>';
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }
}


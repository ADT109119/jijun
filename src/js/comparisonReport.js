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

// Trend indicator threshold: percentage change must exceed this to show ↑/↓
const TREND_THRESHOLD = 0.5;

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
     * @param {Object} [options]  optional filters
     * @param {'all'|'income'|'expense'} [options.typeFilter='all']  filter by record type
     * @returns {Promise<Object>} comparison data
     */
    async calculateComparison(periodType, periods, options = {}) {
        if (periods.length < 2) {
            throw new Error('Comparison requires at least 2 periods');
        }
        if (periods.length > 4) {
            periods = periods.slice(0, 4);
        }

        const typeFilter = options.typeFilter || 'all';

        const sortedPeriods = [...periods].sort();
        const minPeriod = sortedPeriods[0];
        const maxPeriod = sortedPeriods[sortedPeriods.length - 1];

        let startDate = null;
        let endDate = null;

        if (periodType === 'month') {
            startDate = `${minPeriod}-01`;
            const [year, month] = maxPeriod.split('-').map(Number);
            const lastDay = new Date(year, month, 0).getDate();
            const formattedMonth = String(month).padStart(2, '0');
            endDate = `${year}-${formattedMonth}-${String(lastDay).padStart(2, '0')}`;
        } else {
            startDate = `${minPeriod}-01-01`;
            endDate = `${maxPeriod}-12-31`;
        }

        // Fetch records (auto-filtered by activeLedgerId via DataService, optimized range query)
        const records = await this.dataService.getRecords({ startDate, endDate });

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

            // Apply type filter
            if (typeFilter === 'income' && r.type !== 'income') continue;
            if (typeFilter === 'expense' && r.type !== 'expense') continue;

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
            typeFilter,
        };
    }

    /**
     * Generate periods for same-month-last-year comparison.
     * Given the user's selected periods, return parallel periods from one year ago.
     * @param {string[]} periods  e.g. ['2026-05', '2026-06']
     * @returns {string[]}  e.g. ['2025-05', '2025-06']
     */
    static getLastYearPeriods(periods) {
        return periods.map(p => {
            const year = parseInt(p.substring(0, 4), 10);
            return String(year - 1) + p.substring(4);
        });
    }

    /**
     * Calculate percentage breakdown per period for a given category set.
     * Useful for rendering stacked-bar or percentage-comparison charts.
     * @param {Object[]} periodData — from calculateComparison result
     * @param {Object[]} categoryComparisons — from calculateComparison result
     * @returns {Object[]}  each item: { category, percentages: number[] }
     *   percentages[i] = category amount / total expense for period i (as 0-100)
     */
    static calculatePercentageBreakdown(periodData, categoryComparisons) {
        // Group by category, using absolute values (expense)
        const result = categoryComparisons.map(row => {
            const percentages = [];
            for (let i = 0; i < periodData.length; i++) {
                const val = Math.abs(row[`period${i}Signed`] || 0);
                const total = periodData[i].expense;
                percentages.push(total > 0 ? (val / total * 100) : 0);
            }
            return {
                category: row.category,
                percentages,
            };
        });
        return result;
    }

    /**
     * Calculate savings rate for each period.
     * @param {Object[]} periodData — from calculateComparison result
     * @returns {number[]}  savings rates as percentages (0-100)
     */
    static calculateSavingsRates(periodData) {
        return periodData.map(pd => {
            if (pd.income <= 0) return 0;
            return ((pd.income - pd.expense) / pd.income * 100);
        });
    }

    /**
     * Generate trend indicators between adjacent periods.
     * @param {number[]} values — numeric values per period
     * @returns {string[]}  trend symbols: '↑' (increase), '↓' (decrease), '—' (flat/no prev), 'N/A' (prev is zero)
     *   index 0 is always '—' (no previous period to compare)
     */
    static calculateTrends(values) {
        if (values.length === 0) return [];
        const trends = ['—']; // first period has no predecessor
        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1];
            const curr = values[i];
            if (prev === 0) {
                trends.push(curr > 0 ? '↑' : (curr < 0 ? '↓' : '—'));
            } else {
                const change = ((curr - prev) / Math.abs(prev) * 100);
                if (change > TREND_THRESHOLD) trends.push('↑');
                else if (change < -TREND_THRESHOLD) trends.push('↓');
                else trends.push('—');
            }
        }
        return trends;
    }

    /**
     * Export comparison data as CSV.
     * @param {Object} data  — result from calculateComparison
     * @returns {string} CSV text
     */
    exportToCSV(data) {
        const { periodLabels, periodType, periodData, categoryComparisons, typeFilter } = data;

        const lines = [];

        // Header metadata
        lines.push(`期間類型,${periodType === 'month' ? '月' : '年'}`);
        lines.push(`比較類型,${periodLabels.join(', ')}`);
        lines.push(`篩選類型,${typeFilter}`);
        lines.push('');

        // Summary section
        lines.push('期間,收入,支出,結餘');
        for (const pd of periodData) {
            const net = pd.income - pd.expense;
            lines.push(`${pd.label},${pd.income.toFixed(2)},${pd.expense.toFixed(2)},${net.toFixed(2)}`);
        }
        lines.push('');

        // Category comparison section
        lines.push('分類');
        for (const lbl of periodLabels) {
            lines[lines.length - 1] += `,${lbl}`;
        }
        lines[lines.length - 1] += ',變化率';
        for (const row of categoryComparisons) {
            const escapedCategory = String(row.category).replace(/"/g, '""');
            let csvLine = `"${escapedCategory}"`;
            for (let i = 0; i < periodLabels.length; i++) {
                csvLine += `,${(row[`period${i}`] || 0).toFixed(2)}`;
            }
            // Change rate (last vs first)
            const first = row.period0 || 0;
            const last = row[`period${periodLabels.length - 1}`] || 0;
            if (first > 0) {
                const pct = ((last - first) / first * 100).toFixed(1);
                csvLine += `,${pct}%`;
            } else {
                csvLine += ',—';
            }
            lines.push(csvLine);
        }

        return lines.join('\n');
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

    /**
     * Render savings rate cards with trend indicators.
     * Shows savings rate per period with period-over-period trend arrows.
     */
    renderSavingsRates(container, periodData, periodLabels) {
        const rates = ComparisonReport.calculateSavingsRates(periodData);
        const trends = ComparisonReport.calculateTrends(rates.map(Math.abs));

        let html = '<div class="grid gap-3 mb-4">';
        for (let i = 0; i < periodData.length; i++) {
            const rate = rates[i];
            const trend = trends[i];
            const net = periodData[i].income - periodData[i].expense;
            const isPositive = rate >= 0;
            const trendColor = trend === '↑' ? 'text-wabi-income' :
                               trend === '↓' ? 'text-wabi-expense' : 'text-wabi-text-secondary';
            html += `
                <div class="rounded-xl bg-wabi-surface p-3 shadow-sm border border-wabi-border flex items-center justify-between">
                    <div>
                        <p class="text-sm font-bold text-wabi-primary">${periodLabels[i]}</p>
                        <p class="text-xs text-wabi-text-secondary mt-1">結餘 ${formatCurrency(net)}</p>
                    </div>
                    <div class="text-right">
                        <span class="text-lg font-bold ${isPositive ? 'text-wabi-income' : 'text-wabi-expense'}">
                            ${isPositive ? '+' : ''}${rate.toFixed(1)}%
                        </span>
                        <p class="text-xs ${trendColor} mt-1">儲蓄率 ${trend}</p>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * Render percentage breakdown comparison table.
     * Shows what percentage each category represents of total expenses per period.
     */
    renderPercentageTable(container, periodLabels, periodData, categoryComparisons) {
        const breakdown = ComparisonReport.calculatePercentageBreakdown(
            periodData,
            categoryComparisons
        );

        if (breakdown.length === 0) {
            container.innerHTML =
                '<p class="text-center text-wabi-text-secondary py-6">無百分比資料</p>';
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
        html += '</tr></thead><tbody>';

        for (const row of breakdown) {
            const catObj = this.categoryManager.getCategoryById('expense', row.category) ||
                           this.categoryManager.getCategoryById('income', row.category);
            const catName = catObj ? catObj.name : row.category;
            html += `<tr class="border-b border-wabi-border/50">`;
            html += `<td class="py-2 px-1 font-medium">${escapeHTML(catName)}</td>`;
            for (let i = 0; i < row.percentages.length; i++) {
                const pct = row.percentages[i].toFixed(1);
                // Visual bar proportional to percentage
                html += `<td class="text-right py-2 px-1">
                    <span class="text-xs">${pct}%</span>
                    <div class="w-full h-1.5 bg-gray-200 rounded-full mt-1">
                        <div class="h-1.5 bg-wabi-accent rounded-full" style="width:${Math.min(row.percentages[i], 100)}%"></div>
                    </div>
                </td>`;
            }
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    /**
     * Get the number of days in a given period.
     * @param {'month'|'year'} periodType
     * @param {string} period  e.g. '2026-02' or '2026'
     * @returns {number}  number of days
     */
    static getDaysInPeriod(periodType, period) {
        if (periodType === 'month') {
            const [year, month] = period.split('-').map(Number);
            return new Date(year, month, 0).getDate(); // days in month
        }
        // year
        const year = parseInt(period, 10);
        const feb29 = new Date(year, 1, 29).getDate() === 29 ? 1 : 0;
        return 365 + feb29;
    }

    /**
     * Calculate daily average expense for each period (accounts for month-length differences).
     * @param {Object[]} periodData — from calculateComparison result
     * @param {'month'|'year'} periodType
     * @param {string[]} periodLabels
     * @returns {number[]}  daily average expenses per period
     */
    static calculateDailyAverages(periodData, periodType, periodLabels) {
        return periodData.map((pd, i) => {
            const days = ComparisonReport.getDaysInPeriod(periodType, periodLabels[i]);
            return days > 0 ? pd.expense / days : 0;
        });
    }

    /**
     * Render daily average expense cards.
     */
    renderDailyAverages(container, periodData, periodType, periodLabels) {
        const dailyAvgs = ComparisonReport.calculateDailyAverages(periodData, periodType, periodLabels);
        const trends = ComparisonReport.calculateTrends(dailyAvgs);

        let html = '<div class="grid gap-3 mb-4">';
        for (let i = 0; i < periodData.length; i++) {
            const avg = dailyAvgs[i];
            const days = ComparisonReport.getDaysInPeriod(periodType, periodLabels[i]);
            const trend = trends[i];
            const trendColor = trend === '↑' ? 'text-wabi-expense' :
                               trend === '↓' ? 'text-wabi-income' : 'text-wabi-text-secondary';
            html += `
                <div class="rounded-xl bg-wabi-surface p-3 shadow-sm border border-wabi-border flex items-center justify-between">
                    <div>
                        <p class="text-sm font-bold text-wabi-primary">${periodLabels[i]}</p>
                        <p class="text-xs text-wabi-text-secondary mt-1">${days} 天</p>
                    </div>
                    <div class="text-right">
                        <span class="text-lg font-bold text-wabi-expense">
                            ${formatCurrency(avg)}
                        </span>
                        <p class="text-xs ${trendColor} mt-1">日均支出 ${trend}</p>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * Render category ranking comparison — shows top spending categories per period with rank change indicators.
     * @param {HTMLElement} container
     * @param {string[]} periodLabels
     * @param {Object[]} categoryComparisons
     * @param {number} [topN=5]  number of top categories to show per period
     */
    renderCategoryRankings(container, periodLabels, categoryComparisons, topN = 5) {
        if (categoryComparisons.length === 0) {
            container.innerHTML =
                '<p class="text-center text-wabi-text-secondary py-6">無可比對的分類資料</p>';
            return;
        }

        // Build ranked lists per period (expense categories only, sorted by absolute value desc)
        const rankings = periodLabels.map((_, i) => {
            const periodCats = categoryComparisons
                .filter(row => (row[`period${i}Signed`] || 0) < 0) // expense only (negative)
                .map(row => ({
                    category: row.category,
                    amount: Math.abs(row[`period${i}`] || 0),
                }))
                .sort((a, b) => b.amount - a.amount)
                .slice(0, topN);
            return periodCats;
        });

        // Build rank lookup: period -> category -> rank (1-based)
        const rankLookup = rankings.map(periodCats => {
            const lookup = {};
            periodCats.forEach((cat, idx) => {
                lookup[cat.category] = idx + 1;
            });
            return lookup;
        });

        let html = '<div class="space-y-4">';

        // Render each period's ranking
        for (let i = 0; i < periodLabels.length; i++) {
            html += `<div class="rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border">
                <h3 class="text-sm font-bold text-wabi-primary mb-3">${periodLabels[i]} Top ${Math.min(topN, rankings[i].length)} 支出分類</h3>`;

            if (rankings[i].length === 0) {
                html += '<p class="text-xs text-wabi-text-secondary py-2">無支出分類</p>';
            } else {
                html += '<div class="space-y-2">';
                for (let r = 0; r < rankings[i].length; r++) {
                    const cat = rankings[i][r];
                    const rank = r + 1;
                    const catObj = this.categoryManager.getCategoryById('expense', cat.category) ||
                                   this.categoryManager.getCategoryById('income', cat.category);
                    const catName = catObj ? catObj.name : cat.category;

                    // Rank change indicator (compare with previous period)
                    let rankChange = '';
                    if (i > 0 && rankLookup[i - 1][cat.category]) {
                        const prevRank = rankLookup[i - 1][cat.category];
                        const diff = prevRank - rank; // positive = improved (lower rank number)
                        if (diff > 0) {
                            rankChange = `<span class="text-xs text-wabi-income ml-1">↑${diff}</span>`;
                        } else if (diff < 0) {
                            rankChange = `<span class="text-xs text-wabi-expense ml-1">↓${Math.abs(diff)}</span>`;
                        } else {
                            rankChange = `<span class="text-xs text-wabi-text-secondary ml-1">—</span>`;
                        }
                    } else if (i > 0 && !rankLookup[i - 1][cat.category]) {
                        rankChange = `<span class="text-xs text-wabi-accent ml-1">新</span>`;
                    }

                    // Medal/number for top 3
                    const rankDisplay = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

                    html += `
                        <div class="flex items-center justify-between py-1">
                            <div class="flex items-center gap-2">
                                <span class="text-sm w-8 text-center">${rankDisplay}</span>
                                <span class="text-sm font-medium">${escapeHTML(catName)}</span>
                                ${rankChange}
                            </div>
                            <span class="text-sm text-wabi-expense">${formatCurrency(cat.amount)}</span>
                        </div>
                    `;
                }
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }
}


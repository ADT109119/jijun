/**
 * comparisonPage.js — Cross-month/year comparison report page
 * Entry point for the #U07 comparison report feature.
 */

import { ComparisonReport } from '../comparisonReport.js';
import { formatCurrency } from '../utils.js';

export class ComparisonPage {
    constructor(app) {
        this.app = app;
        this.charts = {};
    }

    async render() {
        // Destroy old charts before re-rendering to prevent memory leaks
        this.destroy();
        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <a href="#stats" class="flex items-center gap-1 text-wabi-text-secondary hover:text-wabi-primary transition-colors">
                        <i class="fa-solid fa-arrow-left"></i>
                        <span class="text-sm">返回</span>
                    </a>
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">跨月比較報表</h1>
                    <div class="w-8"></div>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <div id="comparison-container"></div>
                </main>
            </div>
        `;

        const comp = new ComparisonReport(this.app.dataService, this.app.categoryManager);
        const container = this.app.appContainer.querySelector('#comparison-container');
        await this.renderComparisonUI(comp, container);
    }

    async renderComparisonUI(comp, container) {
        const months = await comp.getAvailablePeriods('month');
        const years = await comp.getAvailablePeriods('year');

        // Default: last 2 available months
        const defaultMonths = months.length >= 2 ? months.slice(-2) : months;

        container.innerHTML = `
            <!-- 使用說明 -->
            <div class="p-4 rounded-xl bg-wabi-accent/10 border border-wabi-accent/30 mb-6">
                <p class="text-sm text-wabi-text-primary font-bold mb-1"><i class="fa-solid fa-lightbulb text-yellow-500 mr-1"></i>使用說明</p>
                <p class="text-xs text-wabi-text-secondary">選擇 2-4 個月或年度，系統會自動計算各期間的收支、分類對比以及同比/環比變化。</p>
            </div>

            <!-- Period type selector -->
            <div class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mb-4">
                <button id="comp-period-month" class="period-type-btn flex-1 h-full rounded-md px-2 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">按月</button>
                <button id="comp-period-year" class="period-type-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">按年</button>
            </div>

            <!-- Period selection (checkboxes) -->
            <div id="comp-period-selection" class="mb-6">
                <p class="text-sm text-wabi-text-secondary mb-2">選擇 2-4 個期間（已選 <span id="comp-selected-count">0</span>/4）</p>
                <div id="comp-checkboxes" class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                </div>
            </div>

            <!-- 快捷按鈕：與去年同月比較 -->
            <button id="comp-lastyear-btn" class="w-full py-2 rounded-xl bg-wabi-surface border border-wabi-border text-sm font-medium mb-3 hover:bg-wabi-accent/10 transition-colors">
                <i class="fa-solid fa-calendar-days mr-1"></i> 一鍵比較去年同月（今年 + 去年）
            </button>

            <!-- Type filter toggle -->
            <div class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mb-4">
                <button id="comp-filter-all" class="type-filter-btn flex-1 h-full rounded-md px-2 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">全部</button>
                <button id="comp-filter-income" class="type-filter-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">僅收入</button>
                <button id="comp-filter-expense" class="type-filter-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">僅支出</button>
            </div>

            <!-- Compare button -->
            <button id="comp-run-btn" class="w-full py-3 rounded-xl bg-wabi-accent text-white font-bold mb-6 disabled:opacity-50 disabled:cursor-not-allowed">
                <i class="fa-solid fa-code-compare mr-1"></i> 開始比較
            </button>

            <!-- Results -->
            <div id="comp-results"></div>
        `;

        const periodTypeBtns = container.querySelectorAll('.period-type-btn');
        const typeFilterBtns = container.querySelectorAll('.type-filter-btn');
        let currentPeriodType = 'month';
        let currentTypeFilter = 'all';
        let selectedPeriods = new Set(defaultMonths);

        const updateSelectedCount = () => {
            const countEl = container.querySelector('#comp-selected-count');
            if (countEl) countEl.textContent = selectedPeriods.size;
        };

        const renderCheckboxes = () => {
            const periods = currentPeriodType === 'month' ? months : years;
            const checkboxesEl = container.querySelector('#comp-checkboxes');
            if (periods.length === 0) {
                checkboxesEl.innerHTML = `<div class="col-span-2 sm:col-span-3 text-center py-6 text-wabi-text-secondary">
                    <i class="fa-solid fa-inbox mr-2"></i>暫無歷史數據可比較
                </div>`;
                return;
            }
            checkboxesEl.innerHTML = periods.map(p => {
                const checked = selectedPeriods.has(p) ? 'checked' : '';
                return `<label class="flex items-center gap-2 p-2 rounded-lg bg-wabi-surface border border-wabi-border cursor-pointer hover:border-wabi-accent/50 transition-colors">
                    <input type="checkbox" value="${p}" ${checked} class="comp-checkbox rounded" disabled>
                    <span class="text-sm">${p}</span>
                </label>`;
            }).join('');

            // Re-enable checkboxes after render
            checkboxesEl.querySelectorAll('.comp-checkbox').forEach(cb => {
                cb.disabled = false;
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        if (selectedPeriods.size >= 4) {
                            cb.checked = false;
                            return;
                        }
                        selectedPeriods.add(cb.value);
                    } else {
                        selectedPeriods.delete(cb.value);
                    }
                    updateSelectedCount();
                });
            });
            updateSelectedCount();
        };

        // Period type toggle
        periodTypeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                currentPeriodType = btn.id === 'comp-period-month' ? 'month' : 'year';
                selectedPeriods = new Set();
                const periods = currentPeriodType === 'month' ? months : years;
                if (periods.length >= 2) {
                    selectedPeriods = new Set(periods.slice(-2));
                } else {
                    selectedPeriods = new Set(periods);
                }
                periodTypeBtns.forEach(b => {
                    if (b === btn) {
                        b.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                        b.classList.remove('text-wabi-text-secondary');
                    } else {
                        b.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                        b.classList.add('text-wabi-text-secondary');
                    }
                });
                renderCheckboxes();
            });
        });

        // Type filter toggle
        typeFilterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                currentTypeFilter = btn.id === 'comp-filter-all' ? 'all' :
                                     btn.id === 'comp-filter-income' ? 'income' : 'expense';
                typeFilterBtns.forEach(b => {
                    if (b === btn) {
                        b.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                        b.classList.remove('text-wabi-text-secondary');
                    } else {
                        b.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                        b.classList.add('text-wabi-text-secondary');
                    }
                });
            });
        });

        // Last year comparison shortcut — merge current selection with last-year equivalents
        container.querySelector('#comp-lastyear-btn').addEventListener('click', () => {
            const selectedArr = Array.from(selectedPeriods).sort();
            if (selectedArr.length < 1) {
                return; // No periods selected
            }
            if (currentPeriodType === 'month') {
                const lastYearPeriods = ComparisonReport.getLastYearPeriods(selectedArr);
                // Merge current + last-year, respecting the 4-period limit
                const merged = new Set([...selectedArr, ...lastYearPeriods]);
                // If still exceeds 4, keep oldest periods
                if (merged.size > 4) {
                    const sorted = Array.from(merged).sort();
                    selectedPeriods = new Set(sorted.slice(0, 4));
                } else {
                    selectedPeriods = merged;
                }
                renderCheckboxes();
            }
        });

        renderCheckboxes();

        container.querySelector('#comp-run-btn').addEventListener('click', async () => {
            const selectedArr = Array.from(selectedPeriods).sort();
            if (selectedArr.length < 2) {
                container.querySelector('#comp-results').innerHTML =
                    '<p class="text-center text-wabi-expense py-4"><i class="fa-solid fa-exclamation-circle mr-1"></i>請至少選擇 2 個期間</p>';
                return;
            }

            // Show loading state
            const runBtn = container.querySelector('#comp-run-btn');
            const originalBtnText = runBtn.innerHTML;
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 計算中...';

            try {
                const data = await comp.calculateComparison(currentPeriodType, selectedArr, {
                    typeFilter: currentTypeFilter,
                });
                this.renderResults(container, comp, data);
            } catch (err) {
                container.querySelector('#comp-results').innerHTML =
                    `<p class="text-center text-wabi-expense py-4"><i class="fa-solid fa-exclamation-triangle mr-1"></i>計算失敗: ${err.message}</p>`;
            } finally {
                // Restore button state
                runBtn.disabled = false;
                runBtn.innerHTML = originalBtnText;
            }
        });
    }

    renderResults(container, comp, data) {
        const resultsEl = container.querySelector('#comp-results');

        // Summary cards
        const summaryDiv = document.createElement('div');
        summaryDiv.id = 'comp-summary';
        comp.renderSummaryCards(summaryDiv, data.periodData);
        resultsEl.innerHTML = '';
        resultsEl.appendChild(summaryDiv);

        // Savings rate cards (new phase 3)
        const savingsDiv = document.createElement('div');
        savingsDiv.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
        savingsDiv.innerHTML = '<h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-piggy-bank mr-2"></i>儲蓄率比較</h2>';
        const savingsInner = document.createElement('div');
        comp.renderSavingsRates(savingsInner, data.periodData, data.periodLabels);
        savingsDiv.appendChild(savingsInner);
        resultsEl.appendChild(savingsDiv);

        // Chart (bar chart for income/expense comparison)
        this.renderComparisonChart(container, data);

        // Percentage breakdown table (new phase 3)
        if (data.typeFilter !== 'income') {
            const pctDiv = document.createElement('div');
            pctDiv.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
            pctDiv.innerHTML = '<h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-chart-pie mr-2"></i>支出比例比較</h2>';
            const pctInner = document.createElement('div');
            comp.renderPercentageTable(pctInner, data.periodLabels, data.periodData, data.categoryComparisons);
            pctDiv.appendChild(pctInner);
            resultsEl.appendChild(pctDiv);
        }

        // Daily average expense cards (new phase 4)
        if (data.typeFilter !== 'income') {
            const dailyDiv = document.createElement('div');
            dailyDiv.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
            dailyDiv.innerHTML = '<h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-calendar-day mr-2"></i>日均支出比較</h2>';
            const dailyInner = document.createElement('div');
            comp.renderDailyAverages(dailyInner, data.periodData, data.periodType, data.periodLabels);
            dailyDiv.appendChild(dailyInner);
            resultsEl.appendChild(dailyDiv);
        }

        // Category ranking comparison (new phase 4)
        if (data.typeFilter !== 'income') {
            const rankingDiv = document.createElement('div');
            rankingDiv.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
            rankingDiv.innerHTML = '<h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-trophy mr-2"></i>分類排名比較</h2>';
            const rankingInner = document.createElement('div');
            comp.renderCategoryRankings(rankingInner, data.periodLabels, data.categoryComparisons);
            rankingDiv.appendChild(rankingInner);
            resultsEl.appendChild(rankingDiv);
        }

        // Category table
        const tableDiv = document.createElement('div');
        tableDiv.id = 'comp-category-table';
        tableDiv.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
        // Update title based on type filter
        const filterLabel = data.typeFilter === 'income' ? '收入' :
                           data.typeFilter === 'expense' ? '支出' : '收支';
        tableDiv.innerHTML = `<h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-table-list mr-2"></i>分類${filterLabel}比較</h2>`;
        const tableInner = document.createElement('div');
        comp.renderCategoryTable(tableInner, data.periodLabels, data.categoryComparisons);
        tableDiv.appendChild(tableInner);
        resultsEl.appendChild(tableDiv);

        // Export CSV button
        const exportDiv = document.createElement('div');
        exportDiv.className = 'mt-6';
        exportDiv.innerHTML = `
            <button id="comp-export-csv" class="w-full py-3 rounded-xl bg-wabi-surface border border-wabi-border font-medium hover:bg-wabi-accent/10 transition-colors">
                <i class="fa-solid fa-file-export mr-1"></i> 匯出 CSV
            </button>
        `;
        exportDiv.querySelector('#comp-export-csv').addEventListener('click', () => {
            this.downloadCSV(comp, data);
        });
        resultsEl.appendChild(exportDiv);
    }

    /**
     * Download comparison data as CSV file.
     */
    downloadCSV(comp, data) {
        const csv = comp.exportToCSV(data);
        const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = `比較報表_${data.periodLabels.join('vs')}.csv`;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    renderComparisonChart(container, data) {
        const Chart = window.Chart;
        if (!Chart) return;

        // Remove old chart container if exists
        const oldCanvas = document.getElementById('comp-bar-chart');
        if (oldCanvas) oldCanvas.remove();
        if (this.charts.comparison) this.charts.comparison.destroy();

        const resultsEl = container.querySelector('#comp-results');
        if (!resultsEl) return;

        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'mt-6 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border';
        chartWrapper.innerHTML = `
            <h2 class="text-base font-bold mb-4 text-wabi-primary"><i class="fa-solid fa-chart-bar mr-2"></i>收支對比圖</h2>
            <div class="relative h-48 w-full">
                <canvas id="comp-bar-chart"></canvas>
            </div>
        `;
        resultsEl.appendChild(chartWrapper);

        const ctx = document.getElementById('comp-bar-chart').getContext('2d');
        this.charts.comparison = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.periodLabels,
                datasets: [
                    {
                        label: '收入',
                        data: data.periodData.map(d => d.income),
                        backgroundColor: '#6A9C89',
                        borderRadius: 4,
                    },
                    {
                        label: '支出',
                        data: data.periodData.map(d => d.expense),
                        backgroundColor: '#B95A5A',
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#718096' },
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: $${formatCurrency(ctx.parsed.y, 0)}`,
                        },
                    },
                },
                scales: {
                    x: { ticks: { color: '#718096' }, grid: { display: false } },
                    y: {
                        ticks: {
                            color: '#718096',
                            callback: value => formatCurrency(value, 0),
                        },
                        grid: { color: '#E2E8F0' },
                        beginAtZero: true,
                    },
                },
            },
        });
    }

    destroy() {
        Object.values(this.charts).forEach(chart => chart?.destroy());
        this.charts = {};
    }
}

import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { zhTW } from 'date-fns/locale';
import { formatCurrency, getDateRange } from './utils.js';
import { createDateRangeModal } from './datePickerModal.js';

Chart.register(...registerables);

export class StatisticsManager {
    constructor(dataService, categoryManager) {
        this.dataService = dataService;
        this.categoryManager = categoryManager;
        this.container = null;
        this.modalsContainer = null;
        this.charts = {};
        this.filters = {
            period: 'month',
            customStartDate: null,
            customEndDate: null,
        };
    }

    async renderStatisticsPage(container) {
        this.container = container;
        this.container.innerHTML = `
            <!-- Time Range Selector -->
            <div class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mb-6">
                <button data-period="week" class="period-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">週</button>
                <button data-period="month" class="period-btn flex-1 h-full rounded-md px-2 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">月</button>
                <button data-period="year" class="period-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">年</button>
                <button data-period="custom" class="period-btn flex-1 h-full rounded-md px-2 text-sm font-medium text-wabi-text-secondary">自訂</button>
            </div>

            <!-- Key Metric Cards -->
            <div class="grid grid-cols-2 gap-4 mb-8">
                <div class="flex flex-col gap-1 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border">
                    <p class="text-sm font-medium text-wabi-text-secondary">總收入</p>
                    <p id="stats-total-income" class="text-xl font-bold tracking-tight text-wabi-income">$0</p>
                </div>
                <div class="flex flex-col gap-1 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border">
                    <p class="text-sm font-medium text-wabi-text-secondary">總支出</p>
                    <p id="stats-total-expense" class="text-xl font-bold tracking-tight text-wabi-expense">$0</p>
                </div>
                <div class="col-span-2 flex flex-col gap-1 rounded-xl bg-wabi-surface p-4 shadow-sm border border-wabi-border">
                    <p class="text-sm font-medium text-wabi-text-secondary">結餘</p>
                    <p id="stats-net-balance" class="text-2xl font-bold tracking-tight text-wabi-primary">$0</p>
                </div>
            </div>

            <!-- Donut Chart: Expense Distribution -->
            <div class="rounded-xl bg-wabi-surface p-4 sm:p-6 shadow-sm border border-wabi-border mb-8">
                <h2 class="text-base font-bold mb-4 text-wabi-primary">支出分佈</h2>
                <div id="stats-expense-donut-container" class="flex flex-col items-center gap-6 sm:flex-row">
                    <!-- Chart will be rendered here -->
                </div>
            </div>

            <!-- Donut Chart: Income Distribution -->
            <div class="mb-8 rounded-xl bg-wabi-surface p-4 sm:p-6 shadow-sm border border-wabi-border">
                <h2 class="text-base font-bold mb-4 text-wabi-primary">收入分佈</h2>
                <div id="stats-income-donut-container" class="flex flex-col items-center gap-6 sm:flex-row">
                    <!-- Chart will be rendered here -->
                </div>
            </div>

            <!-- Line Chart: Income/Expense Trend -->
            <div class="rounded-xl bg-wabi-surface p-4 sm:p-6 shadow-sm border border-wabi-border">
                <h2 class="text-base font-bold mb-4 text-wabi-primary">收支趨勢</h2>
                <div class="relative h-48 w-full">
                    <canvas id="stats-trend-chart"></canvas>
                </div>
            </div>
            <!-- Modals container -->
            <div id="stats-modals-container"></div>
        `;
        this.modalsContainer = this.container.querySelector('#stats-modals-container');
        this.setupEventListeners();
        await this.loadStatisticsData();
    }

    setupEventListeners() {
        this.container.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const period = e.target.dataset.period;
                if (period === 'custom') {
                    this.showDateRangeModal();
                } else {
                    this.filters.period = period;
                    this.updatePeriodButtons();
                    this.loadStatisticsData();
                }
            });
        });
    }

    updatePeriodButtons() {
        this.container.querySelectorAll('.period-btn').forEach(btn => {
            if (btn.dataset.period === this.filters.period) {
                btn.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.remove('text-wabi-text-secondary');
            } else {
                btn.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
                btn.classList.add('text-wabi-text-secondary');
            }
        });
    }

    async loadStatisticsData() {
        const dateRange = this.filters.period === 'custom' && this.filters.customStartDate
            ? { startDate: this.filters.customStartDate, endDate: this.filters.customEndDate }
            : getDateRange(this.filters.period);

        const stats = await this.dataService.getStatistics(dateRange.startDate, dateRange.endDate);

        this.updateSummaryCards(stats);
        this.renderTrendChart(stats.dailyTotals, dateRange);
        this.renderExpenseDonutChart(stats.expenseByCategory);
        this.renderIncomeDonutChart(stats.incomeByCategory);
    }

    updateSummaryCards(stats) {
        const netBalance = stats.totalIncome - stats.totalExpense;
        this.container.querySelector('#stats-total-income').textContent = formatCurrency(stats.totalIncome);
        this.container.querySelector('#stats-total-expense').textContent = formatCurrency(stats.totalExpense);
        this.container.querySelector('#stats-net-balance').textContent = formatCurrency(netBalance);
        this.container.querySelector('#stats-net-balance').className = `text-2xl font-bold tracking-tight ${netBalance >= 0 ? 'text-wabi-income' : 'text-wabi-expense'}`;
    }

    renderTrendChart(dailyData, dateRange) {
        const ctx = this.container.querySelector('#stats-trend-chart').getContext('2d');
        if (this.charts.trend) this.charts.trend.destroy();

        const labels = Object.keys(dailyData).sort();
        const incomeValues = labels.map(label => dailyData[label].income);
        const expenseValues = labels.map(label => dailyData[label].expense);

        this.charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '收入',
                        data: incomeValues,
                        borderColor: '#6A9C89', // wabi-income
                        backgroundColor: '#6A9C8933',
                        fill: true,
                        tension: 0.3,
                    },
                    {
                        label: '支出',
                        data: expenseValues,
                        borderColor: '#B95A5A', // wabi-expense
                        backgroundColor: '#B95A5A33',
                        fill: true,
                        tension: 0.3,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: this.getChartTimeUnit(dateRange),
                            tooltipFormat: 'yyyy-MM-dd',
                            displayFormats: { day: 'MM-dd', week: 'MM-dd', month: 'yyyy-MM' }
                        },
                        adapters: { date: { locale: zhTW } },
                        grid: { display: false },
                        ticks: { color: '#718096' }
                    },
                    y: {
                        grid: { color: '#E2E8F0' },
                        ticks: { 
                            color: '#718096',
                            callback: value => formatCurrency(value, 0)
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`
                        }
                    }
                }
            }
        });
    }

    renderExpenseDonutChart(expenseData) {
        const container = this.container.querySelector('#stats-expense-donut-container');
        if (this.charts.expenseDonut) this.charts.expenseDonut.destroy();

        const totalExpense = Object.values(expenseData).reduce((a, b) => a + b, 0);
        if (totalExpense === 0) {
            container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">此期間無支出紀錄</p>`;
            return;
        }

        container.innerHTML = `
            <div class="relative flex size-40 items-center justify-center sm:size-48">
                <canvas id="stats-expense-donut-chart"></canvas>
                <div class="absolute text-center">
                    <p class="text-xs text-wabi-text-secondary">總支出</p>
                    <p class="text-lg font-bold text-wabi-primary">${formatCurrency(totalExpense)}</p>
                </div>
            </div>
            <div id="stats-expense-legend" class="w-full flex-1 space-y-3"></div>
        `;

        const categoryData = Object.keys(expenseData).map(id => {
            const category = this.categoryManager.getCategoryById('expense', id);
            return {
                id: id,
                name: category?.name || '其他',
                value: expenseData[id],
                color: category?.color || 'bg-gray-400'
            };
        }).sort((a, b) => b.value - a.value);

        const labels = categoryData.map(c => c.name);
        const values = categoryData.map(c => c.value);
        // The color is a tailwind class like `bg-red-500`. We need the hex code for Chart.js.
        // This is a temporary solution. A better solution would be to have a mapping from tailwind classes to hex codes.
        const colors = categoryData.map(c => {
            const colorClass = c.color;
            const match = colorClass.match(/bg-(.*)-(\d+)/);
            if (match) {
                const colorName = match[1];
                const colorValue = match[2];
                // This is a very simplified mapping and will not work for all tailwind colors.
                const colorMap = {
                    slate: '#64748b',
                    stone: '#78716c',
                    red: '#ef4444',
                    orange: '#f97316',
                    amber: '#f59e0b',
                    yellow: '#eab308',
                    lime: '#84cc16',
                    green: '#22c55e',
                    emerald: '#10b981',
                    teal: '#14b8a6',
                    cyan: '#06b6d4',
                    sky: '#0ea5e9',
                    blue: '#3b82f6',
                    indigo: '#6366f1',
                    violet: '#8b5cf6',
                    purple: '#a855f7',
                };
                return colorMap[colorName] || '#9ca3af';
            }
            return '#9ca3af'; // default gray
        });

        const ctx = this.container.querySelector('#stats-expense-donut-chart').getContext('2d');
        this.charts.expenseDonut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
        });

        // Custom Legend
        const legendContainer = this.container.querySelector('#stats-expense-legend');
        legendContainer.innerHTML = categoryData.map((cat, i) => `
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="size-3 rounded-full" style="background-color: ${colors[i]};"></span>
                    <span>${cat.name}</span>
                </div>
                <div class="font-medium">
                    <span>${formatCurrency(cat.value)}</span>
                    <span class="ml-2 text-xs text-wabi-text-secondary">${((cat.value / totalExpense) * 100).toFixed(0)}%</span>
                </div>
            </div>
        `).join('');
    }

    renderIncomeDonutChart(incomeData) {
        const container = this.container.querySelector('#stats-income-donut-container');
        if (this.charts.incomeDonut) this.charts.incomeDonut.destroy();

        const totalIncome = Object.values(incomeData).reduce((a, b) => a + b, 0);
        if (totalIncome === 0) {
            container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">此期間無收入紀錄</p>`;
            return;
        }

        container.innerHTML = `
            <div class="relative flex size-40 items-center justify-center sm:size-48">
                <canvas id="stats-income-donut-chart"></canvas>
                <div class="absolute text-center">
                    <p class="text-xs text-wabi-text-secondary">總收入</p>
                    <p class="text-lg font-bold text-wabi-primary">${formatCurrency(totalIncome)}</p>
                </div>
            </div>
            <div id="stats-income-legend" class="w-full flex-1 space-y-3"></div>
        `;

        const categoryData = Object.keys(incomeData).map(id => {
            const category = this.categoryManager.getCategoryById('income', id);
            return {
                id: id,
                name: category?.name || '其他',
                value: incomeData[id],
                color: category?.color || 'bg-gray-400'
            };
        }).sort((a, b) => b.value - a.value);

        const labels = categoryData.map(c => c.name);
        const values = categoryData.map(c => c.value);
        const colors = categoryData.map(c => {
            const colorClass = c.color;
            const match = colorClass.match(/bg-(.*)-(\d+)/);
            if (match) {
                const colorName = match[1];
                const colorMap = {
                    slate: '#64748b', stone: '#78716c', red: '#ef4444', orange: '#f97316',
                    amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16', green: '#22c55e',
                    emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
                    blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7',
                };
                return colorMap[colorName] || '#9ca3af';
            }
            return '#9ca3af';
        });

        const ctx = this.container.querySelector('#stats-income-donut-chart').getContext('2d');
        this.charts.incomeDonut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
        });

        const legendContainer = this.container.querySelector('#stats-income-legend');
        legendContainer.innerHTML = categoryData.map((cat, i) => `
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="size-3 rounded-full" style="background-color: ${colors[i]};"></span>
                    <span>${cat.name}</span>
                </div>
                <div class="font-medium">
                    <span>${formatCurrency(cat.value)}</span>
                    <span class="ml-2 text-xs text-wabi-text-secondary">${((cat.value / totalIncome) * 100).toFixed(0)}%</span>
                </div>
            </div>
        `).join('');
    }

    getChartTimeUnit(dateRange) {
        const days = (new Date(dateRange.endDate) - new Date(dateRange.startDate)) / (1000 * 60 * 60 * 24);
        if (days <= 14) return 'day';
        if (days <= 90) return 'week';
        return 'month';
    }

    showDateRangeModal() {
        const modal = createDateRangeModal({
            initialStartDate: this.filters.customStartDate,
            initialEndDate: this.filters.customEndDate,
            onApply: (start, end) => {
                this.filters.period = 'custom';
                this.filters.customStartDate = start;
                this.filters.customEndDate = end;
                this.updatePeriodButtons();
                this.loadStatisticsData();
            }
        });
        this.modalsContainer.appendChild(modal);
    }

    destroy() {
        Object.values(this.charts).forEach(chart => chart?.destroy());
        this.charts = {};
    }
}

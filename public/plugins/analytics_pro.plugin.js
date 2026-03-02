export default {
    meta: {
        id: 'com.walkingfish.analytics_pro',
        name: '進階圖表分析',
        version: '1.1',
        description: '新增資產趨勢與分類比較圖表。',
        author: 'The walking fish 步行魚',
        icon: 'fa-chart-line'
    },
    
    init(context) {
        this.ctx = context;
        this.ctx.ui.registerPage('analytics-pro', '進階分析', (container) => this.render(container));
        
        // Add home widget entry
        this.ctx.ui.registerHomeWidget('com.walkingfish.analytics_pro', (container) => {
            container.innerHTML = `
                <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-100 flex items-center justify-between cursor-pointer hover:bg-emerald-100 transition-colors" id="open-analytics-widget">
                    <div class="flex items-center gap-3">
                        <div class="bg-emerald-500 text-white rounded-lg size-10 flex items-center justify-center">
                             <i class="fa-solid fa-chart-pie"></i>
                        </div>
                        <div>
                            <p class="font-bold text-emerald-900">進階分析</p>
                            <p class="text-xs text-emerald-700">熱力圖與資產分析</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-emerald-300"></i>
                </div>
            `;
            container.querySelector('#open-analytics-widget').addEventListener('click', () => {
                this.ctx.ui.navigateTo('#analytics-pro');
            });
        });
    },

    async render(container) {
        container.innerHTML = `
            <div class="px-4 pb-24 pt-4 space-y-6">
                <!-- Year Summary Card -->
                <div class="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-6 text-white shadow-lg">
                    <h3 class="text-emerald-100 text-sm font-medium mb-1">年度總支出</h3>
                    <div class="flex items-end gap-2">
                         <span class="text-3xl font-bold" id="year-total-expense">$0</span>
                    </div>
                    <p class="text-xs text-emerald-100 mt-2 opacity-80">統計範圍：今年 1 月 1 日至今</p>
                </div>

                <!-- Asset Trend Chart (New) -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-chart-line text-blue-600"></i> 資產累積趨勢
                    </h4>
                    <div class="relative h-[200px]">
                        <canvas id="asset-trend-chart"></canvas>
                    </div>
                    <p class="text-xs text-gray-400 mt-2 text-center">顯示每月月底的資產總額變化</p>
                </div>

                <!-- Heatmap Section -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-fire text-orange-500"></i> 消費熱力圖
                    </h4>
                    <div class="overflow-x-auto pb-2">
                        <div id="heatmap-container" class="min-w-[600px]">
                            <!-- Grid will be injected here -->
                        </div>
                    </div>
                    <div class="flex justify-end items-center gap-2 mt-2 text-xs text-gray-400">
                        <span>少</span>
                        <div class="flex gap-1">
                            <div class="size-3 bg-emerald-100 rounded-sm"></div>
                            <div class="size-3 bg-emerald-300 rounded-sm"></div>
                            <div class="size-3 bg-emerald-500 rounded-sm"></div>
                            <div class="size-3 bg-emerald-700 rounded-sm"></div>
                        </div>
                        <span>多</span>
                    </div>
                </div>

                <!-- Category Monthly Comparison (New) -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-chart-column text-indigo-500"></i> 分類月度比較 (前5名)
                    </h4>
                    <div class="relative h-[250px]">
                        <canvas id="category-comparison-chart"></canvas>
                    </div>
                </div>

                <!-- Category Sankey-ish Bar Chart -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-layer-group text-blue-500"></i> 支出佔比分析
                    </h4>
                    <div class="relative h-[250px]">
                        <canvas id="category-chart"></canvas>
                    </div>
                </div>

                 <!-- Monthly Trend -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-arrow-trend-up text-purple-500"></i> 月度收支趨勢
                    </h4>
                    <div class="relative h-[200px]">
                        <canvas id="trend-chart"></canvas>
                    </div>
                </div>

                 <!-- Day of Week Analysis -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h4 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <i class="fa-regular fa-calendar-days text-pink-500"></i> 週間消費習慣
                    </h4>
                    <div class="relative h-[200px]">
                        <canvas id="dow-chart"></canvas>
                    </div>
                    <p class="text-xs text-gray-400 mt-2 text-center">分析您在每週各天的消費總額分佈</p>
                </div>
            </div>
        `;

        await this.loadData();
    },

    async loadData() {
        const records = await this.ctx.data.getRecords();
        const currentYear = new Date().getFullYear();
        
        // Filter for this year
        const thisYearRecords = records.filter(r => {
             const d = new Date(r.date);
             return d.getFullYear() === currentYear && r.type === 'expense';
        });

        const totalExpense = thisYearRecords.reduce((sum, r) => sum + r.amount, 0);
        document.getElementById('year-total-expense').textContent = `$${totalExpense.toLocaleString()}`;

        // 1. Asset Trend (Needs all records to calculate cumulative balance)
        await this.renderAssetTrendChart(records);

        // 2. Heatmap
        this.renderHeatmap(thisYearRecords);
        
        // 3. Category Comparison (Needs last 6 months, across years)
        const allExpenses = records.filter(r => r.type === 'expense');
        await this.renderCategoryComparisonChart(allExpenses);

        // 4. Category Pie Chart
        await this.renderCategoryChart(thisYearRecords);

        // 5. Monthly Trend
        this.renderTrendChart(records); 

        // 6. Day of Week Chart
        this.renderDoWChart(thisYearRecords);
    },

    renderHeatmap(records) {
        const container = document.getElementById('heatmap-container');
        if (!container) return;

        // Group by date
        const dailyCounts = {};
        let maxAmount = 0;
        records.forEach(r => {
            const date = r.date; // YYYY-MM-DD
            dailyCounts[date] = (dailyCounts[date] || 0) + r.amount;
            if (dailyCounts[date] > maxAmount) maxAmount = dailyCounts[date];
        });

        // Generate grid (53 weeks * 7 days)
        const year = new Date().getFullYear();
        const startDate = new Date(year, 0, 1);
        
        // CSS Grid
        container.style.display = 'grid';
        container.style.gridTemplateRows = 'repeat(7, 1fr)';
        container.style.gridAutoFlow = 'column';
        container.style.gap = '3px';

        const dayMilliseconds = 24 * 60 * 60 * 1000;
        
        for (let i = 0; i < 371; i++) { // Slightly more than 366 to fill grid
            const currentDate = new Date(startDate.getTime() + i * dayMilliseconds);
            if (currentDate.getFullYear() > year) {
                 // Fill remaining cells with empty to keep grid shape if needed, or break?
                 // Breaking is fine, but grid might look incomplete.
                 // Let's just break for now.
                 break;
            }

            const dateStr = currentDate.toISOString().split('T')[0];
            const amount = dailyCounts[dateStr] || 0;
            
            const cell = document.createElement('div');
            cell.className = 'size-3 rounded-sm bg-gray-100 transition-all hover:ring-2 hover:ring-indigo-300 cursor-pointer';
            cell.title = `${dateStr}: $${amount}`;
            
            if (amount > 0) {
                const intensity = amount / maxAmount;
                if (intensity > 0.75) cell.className = 'size-3 rounded-sm bg-emerald-700';
                else if (intensity > 0.5) cell.className = 'size-3 rounded-sm bg-emerald-500';
                else if (intensity > 0.25) cell.className = 'size-3 rounded-sm bg-emerald-300';
                else cell.className = 'size-3 rounded-sm bg-emerald-100';
            }
            
            container.appendChild(cell);
        }
    },

    async renderCategoryChart(records) {
        const categories = {};
        records.forEach(r => {
            categories[r.category] = (categories[r.category] || 0) + r.amount;
        });

        // Get Category Names/Colors
        const allCategories = await this.ctx.data.getCategories('expense');
        const labels = [];
        const data = [];
        const backgroundColors = [];
        
        // Fallback colors
        const defaultColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#E7E9ED'];

        Object.entries(categories)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 6) // Top 6
            .forEach(([catId, amount], index) => {
                const catDef = allCategories.find(c => c.id === catId);
                labels.push(catDef ? catDef.name : (catId === 'others' ? '其他' : catId));
                data.push(amount);
                
                let color = defaultColors[index % defaultColors.length];
                if (catDef && catDef.color) {
                    color = this.tailwindToHex(catDef.color) || catDef.color; 
                }
                backgroundColors.push(color);
            });

        const ctx = document.getElementById('category-chart');
        
        // Destroy existing chart if any (to avoid overlay)
        if (this.categoryChart) this.categoryChart.destroy();

        this.categoryChart = new this.ctx.lib.Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }
                }
            }
        });
    },

    tailwindToHex(className) {
        if (className.startsWith('#')) return className;
        
        const match = className.match(/bg-(.*)-(\d+)/);
        if (!match) return '#9ca3af'; // Default Gray

        const name = match[1];
        const shade = match[2]; // Currently unused, but could be used for shade mapping

        const colors = {
            slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
            red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
            green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
            blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
            pink: '#ec4899', rose: '#f43f5e'
        };

        return colors[name] || '#9ca3af';
    },

    async renderAssetTrendChart(records) {
        // Calculate cumulative balance for last 6 months
        // Logic: Get initial balance (accounts sum) -> replay all history?
        // Simplified: Get current balance -> reverse iterate records to get past balances?
        // Or: Iterate from start?
        // Let's assume accounts current balance is "Now".
        
        const accounts = await this.ctx.data.getAccounts();
        const currentTotalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);

        // Date points: End of last 6 months + today
        const months = [];
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // Last day of month
            months.unshift(d); // Push to front (oldest first)
        }
        
        // Map records to date
        // Sort records descending (newest first)
        const sortedRecords = [...records].sort((a, b) => new Date(b.date) - new Date(a.date));

        const dataPoints = [];
        let recordIndex = 0;
        
        // We start from "Now" (currentTotalBalance is the balance as of NOW, after all records)
        // Correct approach:
        // We want balance at end of Month X.
        // If today is Month X, balance is currentTotalBalance.
        // If simple linear history:
        // Balance(T-1) = Balance(T) - Income(T) + Expense(T)
        
        // Let's iterate backwards from today
        let runningBalance = currentTotalBalance;
        const cutoffDate = new Date(months[0]); // Oldest month end
        
        // Filter records that are AFTER the cutoff date (we don't need older ones for this specific chart if we start from now)
        // Actually we need to walk back from NOW to each Month End.
        
        const balanceHistory = {}; // 'YYYY-MM': balance
        
        // Current month (partial)
        // balanceHistory[now.toISOString().slice(0, 7)] = runningBalance;
        
        // Function to get Month Key
        const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        // Walk backwards through records
        // Check if record date is AFTER the target month end.
        // If record date > target_month_end, we reverse its effect on runningBalance.
        
        // Reverse months to go from newest to oldest
        const reversedMonths = [...months].reverse();
        
        const monthBalances = [];

        // Note: sortedRecords is Newest to Oldest
        for (const targetDate of reversedMonths) {
            // Find records that happened AFTER targetDate but <= NOW (already processed implicitly if we just continue from last recordIndex)
            // Wait, we just keep processing records until we hit a record OLDER than targetDate.
            
            while (recordIndex < sortedRecords.length) {
                const r = sortedRecords[recordIndex];
                const rDate = new Date(r.date);
                
                if (rDate > targetDate) {
                    // This record happened AFTER the target date.
                    // To get the balance BEFORE this record (i.e. at targetDate), we must reverse it.
                    // If Income, Balance was lower. (Balance - Amount)
                    // If Expense, Balance was higher. (Balance + Amount)
                    // If Transfer, Balance unchanged (Account sum unchanged).
                    
                    if (r.type === 'income') {
                        runningBalance -= r.amount;
                    } else if (r.type === 'expense') {
                        runningBalance += r.amount;
                    }
                    // Transfer: Net change 0
                    
                    recordIndex++;
                } else {
                    // Record date is <= targetDate. Stop.
                    break;
                }
            }
            
            monthBalances.unshift(runningBalance); // Store result, unshift to put back in chronological order
        }
        
        // Render Chart
        const ctx = document.getElementById('asset-trend-chart');
        if (this.assetChart) this.assetChart.destroy();

        this.assetChart = new this.ctx.lib.Chart(ctx, {
            type: 'line',
            data: {
                labels: months.map(d => `${d.getMonth() + 1}月`),
                datasets: [{
                    label: '淨資產',
                    data: monthBalances,
                    borderColor: '#2563eb', // blue-600
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#2563eb',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                     y: { 
                         beginAtZero: false, 
                         grid: { color: '#f3f4f6' },
                         ticks: { callback: v => '$' + v.toLocaleString() } 
                     },
                     x: { grid: { display: false } }
                }
            }
        });
    },

    async renderCategoryComparisonChart(records) {
        // Prepare data: Group by Month -> Category -> Sum
        // Get last 6 months
        const months = {};
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months[key] = {}; // { catId: amount }
        }

        // Aggregate
        records.forEach(r => {
            const key = r.date.substring(0, 7); // YYYY-MM
            if (months[key]) {
                 months[key][r.category] = (months[key][r.category] || 0) + r.amount;
            }
        });
        
        // Find Top 5 Categories overall in this period? Or just top 5 distinct categories?
        // Let's sum up all categories in this 6 months to find top 5.
        const categoryTotals = {};
        Object.values(months).forEach(monthData => {
            Object.entries(monthData).forEach(([cat, amt]) => {
                categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
            });
        });
        
        const topCategories = Object.entries(categoryTotals)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([cat]) => cat);
            
        // Get Category Details
        const allCategories = await this.ctx.data.getCategories('expense');
        const datasets = [];
        
        // Fallback colors for mapping
        const defaultColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];

        topCategories.forEach((catId, index) => {
            const catDef = allCategories.find(c => c.id === catId);
            const name = catDef?.name || (catId === 'others' ? '其他' : catId);
            // Use tailwindToHex or fallback
            let color = defaultColors[index % defaultColors.length];
            if (catDef && catDef.color) {
               color = this.tailwindToHex(catDef.color) || color;
            }

            const data = Object.keys(months).map(mKey => months[mKey][catId] || 0);
            
            datasets.push({
                label: name,
                data: data,
                backgroundColor: color,
                borderRadius: 4, // floating bars effect if stacked
                stack: 'Stack 0'
            });
        });

        const ctx = document.getElementById('category-comparison-chart');
        if (this.comparisonChart) this.comparisonChart.destroy();

        this.comparisonChart = new this.ctx.lib.Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(months).map(m => m.substring(5) + '月'),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }
                },
                scales: {
                     y: { stacked: true, grid: { display: false }, ticks: { display: false } },
                     x: { stacked: true, grid: { display: false } }
                }
            }
        });
    },

    renderTrendChart(records) {
        // Last 6 months trend
        const monthly = {};
        const months = [];
        const now = new Date();
        
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthly[key] = 0;
            months.push(key);
        }

        records.forEach(r => {
            if (r.type === 'expense') {
                const key = r.date.substring(0, 7);
                if (monthly[key] !== undefined) {
                    monthly[key] += r.amount;
                }
            }
        });

        const ctx = document.getElementById('trend-chart');
        new this.ctx.lib.Chart(ctx, {
            type: 'line',
            data: {
                labels: months.map(m => m.substring(5)), // MM
                datasets: [{
                    label: '支出趨勢',
                    data: months.map(m => monthly[m]),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { display: true, color: '#f3f4f6' }, ticks: { font: { size: 10 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    },

    renderDoWChart(records) {
        // Day of Week (0-6)
        const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
        const dayTotals = [0, 0, 0, 0, 0, 0, 0];
        
        records.forEach(r => {
            const date = new Date(r.date);
            const day = date.getDay();
            dayTotals[day] += r.amount;
        });

        const ctx = document.getElementById('dow-chart');
        new this.ctx.lib.Chart(ctx, {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: '總支出',
                    data: dayTotals,
                    backgroundColor: '#ec4899',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                 scales: {
                    y: { beginAtZero: true, grid: { display: true, color: '#f3f4f6' }, ticks: { display: false } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    }
}

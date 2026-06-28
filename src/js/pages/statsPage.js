import { StatisticsManager } from '../statistics.js';

export class StatsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">收支分析</h1>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <!-- 跨月比較入口 -->
                    <a href="#comparison" class="flex items-center gap-3 p-4 rounded-xl bg-wabi-accent/10 border border-wabi-accent/30 mb-6 hover:bg-wabi-accent/20 transition-colors">
                        <i class="fa-solid fa-chart-column text-wabi-accent text-lg"></i>
                        <div class="flex-1">
                            <p class="text-sm font-bold text-wabi-accent">跨月比較報表</p>
                            <p class="text-xs text-wabi-text-secondary">選擇 2-4 個月/年度，對比收支與分類支出變化</p>
                        </div>
                        <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
                    </a>
                    <div id="stats-container"></div>
                </main>
            </div>
        `;
        const statisticsManager = new StatisticsManager(this.app.dataService, this.app.categoryManager);
        statisticsManager.renderStatisticsPage(document.getElementById('stats-container'));
    }
}

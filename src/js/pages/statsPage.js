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
                    <div id="stats-container"></div>
                </main>
            </div>
        `;
        const statisticsManager = new StatisticsManager(this.app.dataService, this.app.categoryManager);
        statisticsManager.renderStatisticsPage(document.getElementById('stats-container'));
    }
}

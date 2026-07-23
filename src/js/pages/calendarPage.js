import { CalendarCashFlow } from '../calendarCashFlow.js'

export class CalendarPage {
    constructor(app) {
        this.app = app
        this.calendarInstance = null
    }

    async render() {
        this.destroy()

        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <a href="#stats" class="flex items-center gap-1 text-wabi-text-secondary hover:text-wabi-primary transition-colors">
                        <i class="fa-solid fa-arrow-left"></i>
                        <span class="text-sm">返回</span>
                    </a>
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">行事曆金流檢視</h1>
                    <div class="w-8"></div>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <div id="calendar-container"></div>
                </main>
            </div>
        `

        const container = this.app.appContainer.querySelector('#calendar-container')
        this.calendarInstance = new CalendarCashFlow(
            this.app.dataService,
            this.app.categoryManager,
            container
        )
        await this.calendarInstance.render()
    }

    destroy() {
        if (this.calendarInstance && typeof this.calendarInstance.destroy === 'function') {
            this.calendarInstance.destroy()
            this.calendarInstance = null
        }
    }
}

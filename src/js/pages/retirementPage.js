/**
 * retirementPage.js — #AB1 Monte Carlo 退休分析報告（實驗性）
 * Entry point for the #retirement route.
 *
 * 借鏡 Actual Budget 26.9.0 實驗性 retirement report。實驗性定位：
 * 結果為統計估算，非投資建議；純讀取資料，不寫入任何紀錄。
 */

import { RetirementReport } from '../retirementReport.js'
import { formatCurrency, escapeHTML, showToast } from '../utils.js'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

// 表單預設值（TWD 語意，與 formatCurrency 一致）
const DEFAULT_YEARS = 30
const DEFAULT_RETURN_PCT = 4 // 年化報酬率 4%
const DEFAULT_VOLATILITY_PCT = 10 // 波動度 10%
const DEFAULT_SIM_COUNT = 1000
const DEFAULT_SEED = 20260928

export class RetirementPage {
    constructor(app) {
        this.app = app
        this.chart = null
        this.snapshot = null
    }

    async render() {
        // Destroy old chart before re-rendering to prevent memory leaks
        this.destroy()

        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <a href="#stats" class="flex items-center gap-1 text-wabi-text-secondary hover:text-wabi-primary transition-colors">
                        <i class="fa-solid fa-arrow-left"></i>
                        <span class="text-sm">返回</span>
                    </a>
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">退休分析</h1>
                    <div class="w-8"></div>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <div class="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <p class="text-xs text-amber-600 dark:text-amber-500">
                            <i class="fa-solid fa-flask mr-1"></i>實驗性功能：結果為統計估算，非投資建議。採用可重現亂數種子，同參數必得同結果。
                        </p>
                    </div>

                    <!-- 參數表單 -->
                    <div class="p-4 rounded-xl bg-wabi-surface border border-wabi-border mb-4">
                        <div class="flex items-center justify-between mb-3">
                            <h2 class="text-sm font-bold text-wabi-text-primary">模擬參數</h2>
                            <button type="button" id="retirement-prefill"
                                class="text-xs px-3 py-1.5 rounded-lg bg-wabi-accent/10 text-wabi-accent border border-wabi-accent/30 hover:bg-wabi-accent/20 transition-colors">
                                <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>以目前資料預填
                            </button>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label for="ret-start-balance" class="text-xs text-wabi-text-secondary">起始資產</label>
                                <input type="number" id="ret-start-balance" min="0" step="10000" value="1000000"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-monthly-net" class="text-xs text-wabi-text-secondary">每月淨儲蓄</label>
                                <input type="number" id="ret-monthly-net" step="1000" value="15000"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-withdrawal" class="text-xs text-wabi-text-secondary">每月提領（退休後）</label>
                                <input type="number" id="ret-withdrawal" min="0" step="1000" value="0"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-years" class="text-xs text-wabi-text-secondary">推估年數（1-80）</label>
                                <input type="number" id="ret-years" min="1" max="80" step="1" value="${DEFAULT_YEARS}"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-return" class="text-xs text-wabi-text-secondary">年化報酬率 %（-90~100）</label>
                                <input type="number" id="ret-return" min="-90" max="100" step="0.5" value="${DEFAULT_RETURN_PCT}"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-volatility" class="text-xs text-wabi-text-secondary">波動度 %（0-200）</label>
                                <input type="number" id="ret-volatility" min="0" max="200" step="1" value="${DEFAULT_VOLATILITY_PCT}"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-sim-count" class="text-xs text-wabi-text-secondary">模擬次數（50-10000）</label>
                                <input type="number" id="ret-sim-count" min="50" max="10000" step="100" value="${DEFAULT_SIM_COUNT}"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                            <div>
                                <label for="ret-seed" class="text-xs text-wabi-text-secondary">亂數種子（重現用）</label>
                                <input type="number" id="ret-seed" step="1" value="${DEFAULT_SEED}"
                                    class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                            </div>
                        </div>
                        <button type="button" id="ret-run"
                            class="w-full mt-4 py-3 rounded-xl bg-wabi-accent text-wabi-primary font-bold text-sm hover:opacity-90 transition-opacity">
                            執行模擬
                        </button>
                    </div>

                    <!-- 結果區 -->
                    <div id="retirement-results" class="hidden">
                        <div id="ret-summary-cards" class="grid grid-cols-2 gap-3 mb-4"></div>
                        <div class="p-4 rounded-xl bg-wabi-surface border border-wabi-border mb-4">
                            <h2 class="text-sm font-bold text-wabi-text-primary mb-2">期末資產分佈（%分位）</h2>
                            <canvas id="ret-chart" height="220"></canvas>
                        </div>
                        <div id="ret-depletion" class="p-4 rounded-xl bg-wabi-surface border border-wabi-border text-sm text-wabi-text-secondary"></div>
                    </div>
                </main>
            </div>
        `

        this.setupListeners()
    }

    setupListeners() {
        const prefillBtn = this.app.appContainer.querySelector(
            '#retirement-prefill'
        )
        if (prefillBtn) {
            prefillBtn.addEventListener('click', async () => {
                await this.prefillFromSnapshot()
            })
        }

        const runBtn = this.app.appContainer.querySelector('#ret-run')
        if (runBtn) {
            runBtn.addEventListener('click', async () => {
                await this.runSimulation(runBtn)
            })
        }
    }

    /**
     * 以本機資料預填表單：起始資產 = 非信用卡帳戶目前餘額總和，
     * 每月淨儲蓄 = 近 6 個月平均（收入 − 支出）。失敗降級 toast。
     */
    async prefillFromSnapshot() {
        const report = new RetirementReport(this.app.dataService)
        let snapshot
        try {
            snapshot = await report.collectFinancialSnapshot()
        } catch (e) {
            console.error('[Retirement] snapshot failed:', e)
            showToast('讀取資料失敗，請手動輸入參數', 'error')
            return
        }
        this.snapshot = snapshot

        const setVal = (id, value) => {
            const el = this.app.appContainer.querySelector(id)
            if (el) el.value = value
        }
        if (snapshot.accountCount > 0 || snapshot.netWorth > 0) {
            setVal('#ret-start-balance', snapshot.netWorth)
        }
        setVal('#ret-monthly-net', snapshot.monthlyNet)
        showToast(
            `已預填：淨資產 ${formatCurrency(snapshot.netWorth)}、每月淨儲蓄 ${formatCurrency(snapshot.monthlyNet)}（近 ${snapshot.monthsSampled} 個月平均）`,
            'success',
            4000
        )
    }

    /** 讀取表單數值；非法回傳 null 並 toast。 */
    _readForm() {
        const getNum = id => {
            const el = this.app.appContainer.querySelector(id)
            if (!el) return NaN
            const v = parseFloat(el.value)
            return isFinite(v) ? v : NaN
        }
        const startBalance = getNum('#ret-start-balance')
        const monthlyNet = getNum('#ret-monthly-net')
        const monthlyWithdrawal = getNum('#ret-withdrawal')
        const years = getNum('#ret-years')
        const returnPct = getNum('#ret-return')
        const volatilityPct = getNum('#ret-volatility')
        const simCount = getNum('#ret-sim-count')
        const seed = getNum('#ret-seed')

        if (isNaN(startBalance) || isNaN(monthlyNet) || isNaN(years) ||
            isNaN(returnPct) || isNaN(volatilityPct)) {
            showToast('請完整填寫模擬參數', 'error')
            return null
        }
        return {
            startBalance: Math.max(0, startBalance),
            monthlyNet,
            monthlyWithdrawal: isNaN(monthlyWithdrawal)
                ? 0
                : Math.max(0, monthlyWithdrawal),
            years: Math.round(years),
            annualReturn: returnPct / 100,
            volatility: volatilityPct / 100,
            simCount: isNaN(simCount) ? DEFAULT_SIM_COUNT : Math.round(simCount),
            seed: isNaN(seed) ? DEFAULT_SEED : Math.round(seed)
        }
    }

    async runSimulation(runBtn) {
        if (runBtn.disabled) return
        const options = this._readForm()
        if (!options) return

        const originalText = runBtn.textContent.trim()
        runBtn.disabled = true
        runBtn.textContent = '模擬中...'
        runBtn.style.opacity = '0.6'

        try {
            // 讓按鈕狀態先更新到畫面，再進行同步行數千次的模擬
            await new Promise(r => setTimeout(r, 0))
            // simulate 目前是同步純函數；await 為透傳，同時兼容未來改 async
            const result = await RetirementReport.simulate(options)
            this.renderResults(result)
        } catch (e) {
            console.error('[Retirement] simulate failed:', e)
            showToast(e?.message || '模擬失敗，請檢查參數', 'error', 4000)
        } finally {
            // 成功與失敗都要恢復按鈕（防「模擬中...」永久卡死）
            runBtn.disabled = false
            runBtn.textContent = originalText
            runBtn.style.opacity = '1'
        }
    }

    renderResults(result) {
        const resultsEl = this.app.appContainer.querySelector(
            '#retirement-results'
        )
        if (!resultsEl) return
        resultsEl.classList.remove('hidden')

        // 摘要卡片：成功率 / 期末中位數 / 悲觀情境 / 破產比例
        const successPct = (result.successRate * 100).toFixed(1)
        const depletedPct = (
            (result.depletedCount / result.simCount) *
            100
        ).toFixed(1)
        const cardsEl = this.app.appContainer.querySelector(
            '#ret-summary-cards'
        )
        if (cardsEl) {
            const successColor =
                result.successRate >= 0.8
                    ? 'text-wabi-income'
                    : result.successRate >= 0.5
                      ? 'text-amber-500'
                      : 'text-wabi-expense'
            cardsEl.innerHTML = `
                <div class="p-3 rounded-xl bg-wabi-surface border border-wabi-border text-center">
                    <p class="text-xs text-wabi-text-secondary">${result.years} 年資金不斷鏈機率</p>
                    <p class="text-xl font-bold mt-1 ${successColor}">${successPct}%</p>
                    <p class="text-[10px] text-wabi-text-secondary mt-1">${result.successCount}/${result.simCount} 次模擬</p>
                </div>
                <div class="p-3 rounded-xl bg-wabi-surface border border-wabi-border text-center">
                    <p class="text-xs text-wabi-text-secondary">期末資產中位數</p>
                    <p class="text-lg font-bold mt-1 text-wabi-text-primary">${escapeHTML(formatCurrency(result.median))}</p>
                </div>
                <div class="p-3 rounded-xl bg-wabi-surface border border-wabi-border text-center">
                    <p class="text-xs text-wabi-text-secondary">悲觀情境（P10）</p>
                    <p class="text-lg font-bold mt-1 text-wabi-text-primary">${escapeHTML(formatCurrency(result.p10))}</p>
                </div>
                <div class="p-3 rounded-xl bg-wabi-surface border border-wabi-border text-center">
                    <p class="text-xs text-wabi-text-secondary">中途破產比例</p>
                    <p class="text-lg font-bold mt-1 ${result.depletedCount > 0 ? 'text-wabi-expense' : 'text-wabi-income'}">${depletedPct}%</p>
                    <p class="text-[10px] text-wabi-text-secondary mt-1">${result.depletedCount} 次模擬</p>
                </div>
            `
        }

        // 分位數長條圖
        const canvas = this.app.appContainer.querySelector('#ret-chart')
        if (canvas && typeof Chart !== 'undefined') {
            if (this.chart) {
                this.chart.destroy()
                this.chart = null
            }
            this.chart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: ['P10 悲觀', 'P25', 'P50 中位', 'P75', 'P90 樂觀'],
                    datasets: [
                        {
                            label: '期末資產',
                            data: [
                                result.p10,
                                result.p25,
                                result.median,
                                result.p75,
                                result.p90
                            ],
                            backgroundColor: '#6A9C89'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => formatCurrency(ctx.parsed.y)
                            }
                        }
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: v => formatCurrency(v)
                            }
                        }
                    }
                }
            })
        }

        // 破產說明
        const depletionEl = this.app.appContainer.querySelector(
            '#ret-depletion'
        )
        if (depletionEl) {
            if (result.depletedCount === 0) {
                depletionEl.innerHTML = `
                    <p class="text-wabi-text-primary font-bold mb-1">
                        <i class="fa-solid fa-circle-check text-wabi-income mr-1"></i>所有模擬情境均未破產
                    </p>
                    <p>${result.years} 年後最悲觀情境（P10）仍有 ${escapeHTML(formatCurrency(result.p10))}。</p>
                `
            } else {
                depletionEl.innerHTML = `
                    <p class="text-wabi-text-primary font-bold mb-1">
                        <i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i>部分模擬情境中途破產
                    </p>
                    <p>${depletedPct}% 的情境在第 ${result.medianDepletionYear} 年（中位數）資金歸零。建議提高每月淨儲蓄或縮短推估年數後重新模擬。</p>
                `
            }
        }
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy()
            this.chart = null
        }
        this.snapshot = null
    }
}

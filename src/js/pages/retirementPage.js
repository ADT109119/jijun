/**
 * retirementPage.js — #AB1 Monte Carlo 退休分析報告（實驗性）
 * Entry point for the #retirement route.
 *
 * 借鏡 Actual Budget 26.9.0 實驗性 retirement report。實驗性定位：
 * 結果為統計估算，非投資建議；純讀取資料，不寫入任何紀錄。
 */

import { RetirementReport } from '../retirementReport.js'
import {
    DEFAULT_HISTORICAL_DATASET_ID,
    HISTORICAL_DATASET_LIST,
    HISTORICAL_RETURN_META,
    getHistoricalDataset,
    getHistoricalReturnStats,
} from '../historicalReturns.js'
import { formatCurrency, escapeHTML, showToast } from '../utils.js'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

// 表單預設值（TWD 語意，與 formatCurrency 一致）
const DEFAULT_YEARS = 30
const DEFAULT_RETURN_PCT = 4 // 年化報酬率 4%
const DEFAULT_VOLATILITY_PCT = 10 // 波動度 10%
const DEFAULT_SIM_COUNT = 1000
const DEFAULT_SEED = 20260928
const DEFAULT_BLOCK_SIZE = HISTORICAL_RETURN_META.defaultBlockSize // 5 年

export class RetirementPage {
    constructor(app) {
        this.app = app
        this.chart = null
        this.snapshot = null
        this.returnModel = 'normal'
        this.historicalDataset = DEFAULT_HISTORICAL_DATASET_ID
    }

    async render() {
        // Destroy old chart before re-rendering to prevent memory leaks
        this.destroy()
        this.returnModel = 'normal'
        this.historicalDataset = DEFAULT_HISTORICAL_DATASET_ID

        const datasetOptions = HISTORICAL_DATASET_LIST.map(ds => {
            const selected =
                ds.id === this.historicalDataset ? 'selected' : ''
            return `<option value="${escapeHTML(ds.id)}" ${selected}>${escapeHTML(ds.shortName)}（${ds.startYear}–${ds.endYear}，${ds.count} 年）</option>`
        }).join('')

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

                        <!-- 報酬模型切換（#AB1-HIST：常態抽樣 vs 歷史重演） -->
                        <div class="mb-3">
                            <span class="text-xs text-wabi-text-secondary block mb-1.5">報酬模型</span>
                            <div id="ret-model-toggle" class="grid grid-cols-2 gap-1 p-1 rounded-lg bg-wabi-bg border border-wabi-border" role="group" aria-label="報酬模型">
                                <button type="button" id="ret-model-normal" data-return-model="normal" aria-pressed="true"
                                    class="ret-model-btn py-2 px-3 rounded-md text-xs font-bold bg-wabi-surface text-wabi-primary shadow-sm transition-all">
                                    常態抽樣（i.i.d.）
                                </button>
                                <button type="button" id="ret-model-historical" data-return-model="historical" aria-pressed="false"
                                    class="ret-model-btn py-2 px-3 rounded-md text-xs font-medium text-wabi-text-secondary hover:text-wabi-primary transition-all">
                                    歷史重演（區塊抽樣）
                                </button>
                            </div>
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
                            <div id="ret-normal-fields" class="col-span-2 grid grid-cols-2 gap-3">
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
                            </div>
                            <div id="ret-historical-fields" class="col-span-2 hidden space-y-2.5">
                                <div>
                                    <label for="ret-historical-dataset" class="text-xs text-wabi-text-secondary">歷史市場基準</label>
                                    <select id="ret-historical-dataset"
                                        class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                                        ${datasetOptions}
                                    </select>
                                </div>
                                <div>
                                    <label for="ret-block-size" class="text-xs text-wabi-text-secondary">連續區塊長度（年，${HISTORICAL_RETURN_META.minBlockSize}-${HISTORICAL_RETURN_META.maxBlockSize}，預設 ${DEFAULT_BLOCK_SIZE}）</label>
                                    <input type="number" id="ret-block-size" min="${HISTORICAL_RETURN_META.minBlockSize}" max="${HISTORICAL_RETURN_META.maxBlockSize}" step="1" value="${DEFAULT_BLOCK_SIZE}"
                                        class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-bg text-wabi-text-primary text-sm">
                                    <p class="text-[11px] text-wabi-text-secondary mt-1">每次抽取連續 N 年真實歷史報酬拼接重演，保留市場多頭／熊市群聚與報酬自相關。</p>
                                </div>
                                <div id="ret-historical-info" class="p-3 rounded-lg bg-wabi-bg/70 border border-wabi-border/70 text-[11px] text-wabi-text-secondary space-y-1"></div>
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
                        <div id="ret-model-badge" class="mb-3 text-xs text-wabi-text-secondary flex items-center gap-1.5"></div>
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

        this._renderHistoricalInfo(this.historicalDataset)
        this.setupListeners()
    }

    /** 依選中的歷史資料集更新 #ret-historical-info 統計摘要。 */
    _renderHistoricalInfo(datasetId = this.historicalDataset) {
        const infoEl = this.app.appContainer.querySelector('#ret-historical-info')
        if (!infoEl) return
        const histStats = getHistoricalReturnStats(datasetId)
        const fmtPct = v => `${(v * 100).toFixed(1)}%`
        const shortSampleHint =
            histStats.count < 30
                ? `<p class="text-[10px] text-wabi-text-secondary/80 pt-0.5"><i class="fa-solid fa-circle-info mr-1"></i>樣本共 ${histStats.count} 年，長天期模擬將由連續區塊拼接；若需近百年極端情境壓力測試，可切換至美股 S&amp;P 500。</p>`
                : ''
        infoEl.innerHTML = `
            <p class="font-bold text-wabi-text-primary">
                <i class="fa-solid fa-clock-rotate-left mr-1 text-wabi-accent"></i>${escapeHTML(histStats.name)}（${histStats.startYear}–${histStats.endYear}，共 ${histStats.count} 年）
            </p>
            <p class="text-[11px] text-wabi-text-secondary">${escapeHTML(histStats.description)}</p>
            <p>
                算術均值 ${fmtPct(histStats.mean)} · 幾何年化 ${fmtPct(histStats.geometricMean)} · 波動度 ${fmtPct(histStats.stdDev)}
            </p>
            <p>
                歷史最差 ${fmtPct(histStats.min)}（${histStats.minYear}）· 歷史最佳 +${fmtPct(histStats.max)}（${histStats.maxYear}）
            </p>
            ${shortSampleHint}
        `
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

        const modelBtns =
            this.app.appContainer.querySelectorAll('.ret-model-btn')
        modelBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const nextModel = btn.dataset.returnModel
                if (nextModel === 'normal' || nextModel === 'historical') {
                    this.setReturnModel(nextModel)
                }
            })
        })

        const datasetSelect = this.app.appContainer.querySelector(
            '#ret-historical-dataset'
        )
        if (datasetSelect) {
            datasetSelect.addEventListener('change', () => {
                this.historicalDataset =
                    datasetSelect.value || DEFAULT_HISTORICAL_DATASET_ID
                this._renderHistoricalInfo(this.historicalDataset)
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
     * 切換報酬模型（'normal' | 'historical'），聯動顯示對應參數區塊與按鈕狀態。
     * @param {'normal'|'historical'} model
     */
    setReturnModel(model) {
        this.returnModel = model === 'historical' ? 'historical' : 'normal'
        const normalFields =
            this.app.appContainer.querySelector('#ret-normal-fields')
        const histFields = this.app.appContainer.querySelector(
            '#ret-historical-fields'
        )
        if (normalFields) {
            normalFields.classList.toggle(
                'hidden',
                this.returnModel !== 'normal'
            )
        }
        if (histFields) {
            histFields.classList.toggle(
                'hidden',
                this.returnModel !== 'historical'
            )
        }

        const modelBtns =
            this.app.appContainer.querySelectorAll('.ret-model-btn')
        modelBtns.forEach(btn => {
            const isActive = btn.dataset.returnModel === this.returnModel
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
            if (isActive) {
                btn.classList.add(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm',
                    'font-bold'
                )
                btn.classList.remove(
                    'text-wabi-text-secondary',
                    'font-medium'
                )
            } else {
                btn.classList.remove(
                    'bg-wabi-surface',
                    'text-wabi-primary',
                    'shadow-sm',
                    'font-bold'
                )
                btn.classList.add('text-wabi-text-secondary', 'font-medium')
            }
        })
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
        const simCount = getNum('#ret-sim-count')
        const seed = getNum('#ret-seed')

        if (isNaN(startBalance) || isNaN(monthlyNet) || isNaN(years)) {
            showToast('請完整填寫模擬參數', 'error')
            return null
        }

        const common = {
            startBalance: Math.max(0, startBalance),
            monthlyNet,
            monthlyWithdrawal: isNaN(monthlyWithdrawal)
                ? 0
                : Math.max(0, monthlyWithdrawal),
            years: Math.round(years),
            returnModel: this.returnModel,
            simCount: isNaN(simCount) ? DEFAULT_SIM_COUNT : Math.round(simCount),
            seed: isNaN(seed) ? DEFAULT_SEED : Math.round(seed),
        }

        if (this.returnModel === 'historical') {
            const blockSize = getNum('#ret-block-size')
            if (isNaN(blockSize)) {
                showToast('請完整填寫模擬參數', 'error')
                return null
            }
            const datasetSelect = this.app.appContainer.querySelector(
                '#ret-historical-dataset'
            )
            const historicalDataset =
                datasetSelect?.value ||
                this.historicalDataset ||
                DEFAULT_HISTORICAL_DATASET_ID
            return {
                ...common,
                historicalDataset,
                blockSize: Math.round(blockSize),
            }
        }

        const returnPct = getNum('#ret-return')
        const volatilityPct = getNum('#ret-volatility')
        if (isNaN(returnPct) || isNaN(volatilityPct)) {
            showToast('請完整填寫模擬參數', 'error')
            return null
        }
        return {
            ...common,
            annualReturn: returnPct / 100,
            volatility: volatilityPct / 100,
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

        // 報酬模型標示徽章（#AB1-HIST）
        const modelBadgeEl = this.app.appContainer.querySelector(
            '#ret-model-badge'
        )
        if (modelBadgeEl) {
            const isHistorical =
                (result.returnModel || result.params?.returnModel) ===
                'historical'
            if (isHistorical) {
                const bSize =
                    result.blockSize ??
                    result.params?.blockSize ??
                    DEFAULT_BLOCK_SIZE
                const fallbackMeta = getHistoricalDataset(
                    result.historicalDataset ||
                        result.params?.historicalDataset ||
                        this.historicalDataset ||
                        DEFAULT_HISTORICAL_DATASET_ID
                ).meta
                const shortName =
                    result.historicalMeta?.shortName ?? fallbackMeta.shortName
                const startYear =
                    result.historicalMeta?.startYear ?? fallbackMeta.startYear
                const endYear =
                    result.historicalMeta?.endYear ?? fallbackMeta.endYear
                modelBadgeEl.innerHTML = `
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-wabi-accent/15 text-wabi-accent font-medium">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                        歷史重演 · ${escapeHTML(shortName)}（連續 ${escapeHTML(bSize)} 年區塊 · ${escapeHTML(startYear)}–${escapeHTML(endYear)}）
                    </span>
                `
            } else {
                const retPct =
                    typeof result.params?.annualReturn === 'number'
                        ? (result.params.annualReturn * 100).toFixed(1)
                        : null
                const volPct =
                    typeof result.params?.volatility === 'number'
                        ? (result.params.volatility * 100).toFixed(1)
                        : null
                const detail =
                    retPct !== null && volPct !== null
                        ? `（報酬 ${retPct}% · 波動 ${volPct}%）`
                        : ''
                modelBadgeEl.innerHTML = `
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-wabi-surface border border-wabi-border text-wabi-text-secondary font-medium">
                        <i class="fa-solid fa-chart-line"></i>
                        常態抽樣${escapeHTML(detail)}
                    </span>
                `
            }
        }

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

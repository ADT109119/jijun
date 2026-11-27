/**
 * retirementReport.js — #AB1 / #AB1-HIST Monte Carlo 退休分析報告（實驗性）
 *
 * 借鏡 Actual Budget 26.9.0 實驗性 retirement report 與 v26.11.0 #9101 歷史重演模型：
 * 支援兩種報酬模型：
 *   1. 'normal'（常態抽樣）：i.i.d. r ~ Normal(annualReturn, volatility)
 *   2. 'historical'（歷史重演）：自真實歷史年度報酬抽取連續年份區塊（Moving Block Bootstrap），
 *      預設區塊長度 5 年（可調 1–10 年），保留報酬自相關與多空群聚風險。
 *
 * 實驗性定位說明：
 *   - 純前端模擬，結果為統計估算而非投資建議
 *   - 不寫入任何資料（只讀 records/accounts），無 Schema/同步影響
 *   - 使用可設定亂數種子（mulberry32 + Box-Muller / Block Bootstrap），同輸入必得同結果，
 *     便於單元測試與使用者重現
 *
 * Public API:
 *   new RetirementReport(dataService)
 *   await collectFinancialSnapshot()   彙總目前淨資產與近 6 個月平均月收支
 *   static simulate(options)           純函數，Monte Carlo 模擬（常態抽樣／歷史重演）
 *   pickHistoricalBlocks(years, blockSize, rand, series) 連續年份區塊抽樣純函數
 */

import {
    DEFAULT_HISTORICAL_DATASET_ID,
    HISTORICAL_RETURN_DATASETS,
    HISTORICAL_DATASET_LIST,
    HISTORICAL_RETURN_META,
    getHistoricalDataset,
    getHistoricalReturnValues,
    getHistoricalReturnStats,
} from './historicalReturns.js'

export {
    DEFAULT_HISTORICAL_DATASET_ID,
    HISTORICAL_RETURN_DATASETS,
    HISTORICAL_DATASET_LIST,
    HISTORICAL_RETURN_META,
    getHistoricalDataset,
    getHistoricalReturnValues,
    getHistoricalReturnStats,
}

// 模擬參數的安全邊界（防呆：越界一律 clamp 或 throw，避免 UI 誤輸入拖垮瀏覽器）
const SIM_COUNT_MIN = 50
const SIM_COUNT_MAX = 10000
const SIM_COUNT_DEFAULT = 1000
const YEARS_MIN = 1
const YEARS_MAX = 80
const RETURN_MIN = -0.9 // 年化報酬率下限（-90%）
const RETURN_MAX = 1.0 // 年化報酬率上限（+100%）
const VOLATILITY_MAX = 2.0 // 波動度上限（200%）

export const RETURN_MODELS = Object.freeze({
    NORMAL: 'normal',
    HISTORICAL: 'historical',
})
export const BLOCK_SIZE_MIN = HISTORICAL_RETURN_META.minBlockSize // 1
export const BLOCK_SIZE_MAX = HISTORICAL_RETURN_META.maxBlockSize // 10
export const BLOCK_SIZE_DEFAULT = HISTORICAL_RETURN_META.defaultBlockSize // 5

/**
 * 歷史重演區塊抽樣（Moving Block Bootstrap，#AB1-HIST）。
 *
 * 從真實歷史年度報酬序列中，每次隨機抽取一段「連續 blockSize 年」的真實歷史視窗，
 * 依序拼接直到湊滿 years 年。絕不跨首尾拼接（不將 2024 年直接接回 1928 年），
 * 確保每個區塊皆為真實歷史片段，完整保留報酬自相關與波動率群聚。
 *
 * @param {number} years - 需要產生的模擬年數（正整數）
 * @param {number} [blockSize=5] - 連續年份區塊長度（1–10 的整數）
 * @param {() => number} [rand=Math.random] - [0, 1) 均勻亂數產生器
 * @param {number[]|null} [series=null] - 歷史年度報酬率陣列（預設使用內建 S&P 500 序列）
 * @returns {number[]} 長度恰好為 years 的年報酬率陣列
 */
export function pickHistoricalBlocks(
    years,
    blockSize = BLOCK_SIZE_DEFAULT,
    rand = Math.random,
    series = null
) {
    if (
        typeof years !== 'number' ||
        !Number.isInteger(years) ||
        years < YEARS_MIN ||
        years > YEARS_MAX
    ) {
        throw new Error(`推估年數必須為 ${YEARS_MIN}-${YEARS_MAX} 的整數`)
    }
    if (
        typeof blockSize !== 'number' ||
        !Number.isInteger(blockSize) ||
        blockSize < BLOCK_SIZE_MIN ||
        blockSize > BLOCK_SIZE_MAX
    ) {
        throw new Error(
            `區塊長度必須為 ${BLOCK_SIZE_MIN}-${BLOCK_SIZE_MAX} 的整數`
        )
    }

    const pool = series === null || series === undefined
        ? getHistoricalReturnValues()
        : series
    if (
        !Array.isArray(pool) ||
        pool.length === 0 ||
        pool.some(v => typeof v !== 'number' || !Number.isFinite(v))
    ) {
        throw new Error('歷史報酬序列必須為非空有限數值陣列')
    }

    const rng = typeof rand === 'function' ? rand : Math.random
    const effectiveBlock = Math.min(blockSize, pool.length)
    const picked = new Array(years)
    let cursor = 0

    while (cursor < years) {
        const take = Math.min(effectiveBlock, years - cursor)
        // 僅在合法起點 [0, pool.length - take] 抽樣，確保區塊連續且不跨首尾折返
        const maxStart = pool.length - take
        const rawRand = rng()
        const safeRand =
            typeof rawRand === 'number' && Number.isFinite(rawRand)
                ? Math.min(0.9999999999999999, Math.max(0, rawRand))
                : 0
        const start = Math.floor(safeRand * (maxStart + 1))
        for (let i = 0; i < take; i++) {
            picked[cursor++] = pool[start + i]
        }
    }

    return picked
}

/**
 * mulberry32：小型可決定性 PRNG，產生 [0,1) 均勻亂數。
 * 同 seed 必產同序列 → 模擬結果可重現（測試鎖定）。
 */
function mulberry32(seed) {
    let a = seed >>> 0
    return function () {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Box-Muller：將均勻亂數轉為標準常態亂數（均值 0、標準差 1）。
 */
function normalRandom(rand) {
    let u = 0
    // u 取 (0,1] 避免 log(0) = -Infinity
    while (u === 0) u = rand()
    const v = rand()
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

/**
 * 將任意數值 clamp 到 [min, max]。非有限值回傳 fallback。
 */
function clampNumber(value, min, max, fallback) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback
    return Math.min(max, Math.max(min, value))
}

export class RetirementReport {
    /** @param {DataService} dataService */
    constructor(dataService) {
        this.dataService = dataService
    }

    /* ------------------------------------------------------------------ */
    /*  資料彙總（供 UI 預填表單）                                          */
    /* ------------------------------------------------------------------ */

    /**
     * 彙總退休模擬的起點資料：
     *   1. 淨資產 = 所有非信用卡帳戶「目前餘額」的正值總和
     *      （信用卡欠款屬消費負債，不列入退休資產）
     *   2. 近 6 個月平均月收入/支出（經 getStatistics，沿用其
     *      排除轉帳/欠款回收/帳務差額的統計語意）
     * 任何一步失敗都降級為 0（不拋錯，UI 讓使用者手動輸入）。
     * @returns {Promise<{netWorth:number, monthlyIncome:number, monthlyExpense:number, monthlyNet:number, monthsSampled:number, accountCount:number}>}
     */
    async collectFinancialSnapshot() {
        const MONTHS_SAMPLED = 6
        let netWorth = 0
        let accountCount = 0

        let accounts
        try {
            accounts = (await this.dataService.getAccounts()) || []
        } catch (e) {
            console.warn('[Retirement] Failed to load accounts:', e)
            accounts = []
        }

        for (const a of accounts) {
            if (!a || a.type === 'credit_card') continue
            accountCount++
            let balance
            if (
                typeof this.dataService
                    .calculateAccountCurrentBalance === 'function'
            ) {
                try {
                    balance =
                        (await this.dataService.calculateAccountCurrentBalance(
                            a.id
                        )) || 0
                } catch (e) {
                    console.warn(
                        '[Retirement] Balance calc failed for account',
                        a.id,
                        e
                    )
                    balance =
                        typeof a.balance === 'number' && isFinite(a.balance)
                            ? a.balance
                            : 0
                }
            } else {
                balance =
                    typeof a.balance === 'number' && isFinite(a.balance)
                        ? a.balance
                        : 0
            }
            if (balance > 0) netWorth += balance
        }

        let monthlyIncome
        let monthlyExpense
        try {
            const end = new Date()
            // 從 5 個月前的月初起算 → 完整涵蓋近 6 個日曆月
            const start = new Date(
                end.getFullYear(),
                end.getMonth() - (MONTHS_SAMPLED - 1),
                1
            )
            const fmt = d =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            // offsetTransfers=true：轉帳只是錢換位置，不該灌大收入/支出
            const stats = await this.dataService.getStatistics(
                fmt(start),
                fmt(end),
                null,
                true
            )
            monthlyIncome = (stats?.totalIncome || 0) / MONTHS_SAMPLED
            monthlyExpense = (stats?.totalExpense || 0) / MONTHS_SAMPLED
        } catch (e) {
            console.warn('[Retirement] Failed to compute monthly averages:', e)
            monthlyIncome = 0
            monthlyExpense = 0
        }

        return {
            netWorth: Math.round(netWorth),
            monthlyIncome: Math.round(monthlyIncome),
            monthlyExpense: Math.round(monthlyExpense),
            monthlyNet: Math.round(monthlyIncome - monthlyExpense),
            monthsSampled: MONTHS_SAMPLED,
            accountCount
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Monte Carlo 模擬（純函數，可決定性重現）                             */
    /* ------------------------------------------------------------------ */

    /**
     * 執行 Monte Carlo 退休模擬（支援常態抽樣 'normal' 與歷史重演 'historical'）。
     *
     * 模型（年度粒度，語意明確可測）：
     *   每年結算一次：balance = balance × (1 + r) + 年度淨儲蓄
     *   - returnModel === 'normal'（預設）：r ~ Normal(annualReturn, volatility)
     *   - returnModel === 'historical'：以 pickHistoricalBlocks(years, blockSize, rand)
     *     抽取真實連續歷史年份區塊重演，保留報酬自相關
     *   年度淨儲蓄 = (monthlyNet − monthlyWithdrawal) × 12
     *   balance < 0 該年即視為破產（該 sim 剩餘年餘額停於 0）。
     *
     * @param {Object} options
     * @param {number} options.startBalance        起始資產（負數視為 0）
     * @param {number} options.monthlyNet          每月淨儲蓄（可為負）
     * @param {number} options.years               推估年數（1-80）
     * @param {'normal'|'historical'} [options.returnModel='normal'] 報酬模型
     * @param {number} [options.annualReturn]      年化報酬率（normal 模式必填，小數 0.04=4%）
     * @param {number} [options.volatility]        年化波動度（normal 模式必填，小數 0.10=10%）
     * @param {number} [options.blockSize=5]       歷史區塊長度（historical 模式使用，1-10 整數）
     * @param {string} [options.historicalDataset='taiex_tr'] 歷史報酬資料集 ID
     * @param {number[]} [options.historicalReturns] 自訂歷史年度報酬序列（測試或擴充用）
     * @param {number} [options.monthlyWithdrawal=0] 每月提領（退休後支出）
     * @param {number} [options.simCount=1000]     模擬次數（50-10000）
     * @param {number} [options.seed=20260928]     亂數種子（同種子同結果）
     * @returns {{simCount:number, years:number, returnModel:string, successCount:number, depletedCount:number,
     *            successRate:number, median:number, p10:number, p25:number, p75:number, p90:number,
     *            medianDepletionYear:number|null, historicalMeta:Object|null, params:Object}}
     * @throws {Error} 核心參數越界或非法時明確拒絕
     */
    static simulate(options) {
        const opts = options || {}

        // 報酬模型驗證（未傳預設 'normal' 維持完全向後相容）
        const returnModel =
            opts.returnModel === undefined
                ? RETURN_MODELS.NORMAL
                : opts.returnModel
        if (
            returnModel !== RETURN_MODELS.NORMAL &&
            returnModel !== RETURN_MODELS.HISTORICAL
        ) {
            throw new Error(
                `不支援的報酬模型：${String(returnModel)}（僅支援 normal 或 historical）`
            )
        }

        // 邊界驗證（語意同 partialSettleGroup 輸入驗證模式）：
        // 核心假設參數非法 → 直接 throw，避免 UI 誤輸入產出誤導性報告
        if (
            typeof opts.years !== 'number' ||
            !isFinite(opts.years) ||
            !Number.isInteger(opts.years) ||
            opts.years < YEARS_MIN ||
            opts.years > YEARS_MAX
        ) {
            throw new Error(`推估年數必須為 ${YEARS_MIN}-${YEARS_MAX} 的整數`)
        }

        let annualReturn = null
        let volatility = null
        let blockSize = null
        let historicalSeries = null
        let selectedHistoricalMeta = null

        if (returnModel === RETURN_MODELS.NORMAL) {
            if (
                typeof opts.annualReturn !== 'number' ||
                !isFinite(opts.annualReturn) ||
                opts.annualReturn < RETURN_MIN ||
                opts.annualReturn > RETURN_MAX
            ) {
                throw new Error('年化報酬率必須介於 -90% 到 100% 之間')
            }
            if (
                typeof opts.volatility !== 'number' ||
                !isFinite(opts.volatility) ||
                opts.volatility < 0 ||
                opts.volatility > VOLATILITY_MAX
            ) {
                throw new Error('波動度必須介於 0% 到 200% 之間')
            }
            annualReturn = opts.annualReturn
            volatility = opts.volatility
        } else {
            blockSize =
                opts.blockSize === undefined
                    ? BLOCK_SIZE_DEFAULT
                    : opts.blockSize
            if (
                typeof blockSize !== 'number' ||
                !isFinite(blockSize) ||
                !Number.isInteger(blockSize) ||
                blockSize < BLOCK_SIZE_MIN ||
                blockSize > BLOCK_SIZE_MAX
            ) {
                throw new Error(
                    `區塊長度必須為 ${BLOCK_SIZE_MIN}-${BLOCK_SIZE_MAX} 的整數`
                )
            }
            if (
                opts.historicalReturns !== undefined &&
                opts.historicalReturns !== null
            ) {
                historicalSeries = opts.historicalReturns
                selectedHistoricalMeta = opts.historicalDataset
                    ? getHistoricalDataset(opts.historicalDataset).meta
                    : HISTORICAL_RETURN_META
            } else {
                const ds = getHistoricalDataset(opts.historicalDataset)
                selectedHistoricalMeta = ds.meta
                historicalSeries = ds.returns.map(entry => entry.returnRate)
            }
            if (
                !Array.isArray(historicalSeries) ||
                historicalSeries.length === 0 ||
                historicalSeries.some(
                    v => typeof v !== 'number' || !Number.isFinite(v)
                )
            ) {
                throw new Error('歷史報酬序列必須為非空有限數值陣列')
            }
        }

        const startBalance =
            typeof opts.startBalance === 'number' && isFinite(opts.startBalance)
                ? Math.max(0, opts.startBalance)
                : 0
        const monthlyNet =
            typeof opts.monthlyNet === 'number' && isFinite(opts.monthlyNet)
                ? opts.monthlyNet
                : 0
        const monthlyWithdrawal =
            typeof opts.monthlyWithdrawal === 'number' &&
            isFinite(opts.monthlyWithdrawal)
                ? Math.max(0, opts.monthlyWithdrawal)
                : 0
        const years = opts.years
        const simCount = Math.round(
            clampNumber(
                opts.simCount,
                SIM_COUNT_MIN,
                SIM_COUNT_MAX,
                SIM_COUNT_DEFAULT
            )
        )
        const seed =
            typeof opts.seed === 'number' && isFinite(opts.seed)
                ? Math.round(opts.seed)
                : 20260928

        const rand = mulberry32(seed)
        const annualNet = (monthlyNet - monthlyWithdrawal) * 12

        let successCount = 0
        let depletedCount = 0
        const depletionYears = []
        const finalBalances = new Array(simCount)

        for (let s = 0; s < simCount; s++) {
            let balance = startBalance
            let depleted = false
            let depletionYear = null
            const yearlyReturns =
                returnModel === RETURN_MODELS.HISTORICAL
                    ? pickHistoricalBlocks(
                          years,
                          blockSize,
                          rand,
                          historicalSeries
                      )
                    : null
            for (let y = 1; y <= years; y++) {
                const rawR =
                    returnModel === RETURN_MODELS.HISTORICAL
                        ? yearlyReturns[y - 1]
                        : annualReturn + normalRandom(rand) * volatility
                const r = Math.max(-1, rawR)
                balance = balance * (1 + r) + annualNet
                if (balance < 0) {
                    depleted = true
                    depletionYear = y
                    balance = 0
                    break // 破產後餘額停於 0，其餘年不必再算
                }
            }
            if (depleted) {
                depletedCount++
                depletionYears.push(depletionYear)
            } else {
                successCount++
            }
            finalBalances[s] = balance
        }

        // 分位數：期末資產由小到大排序後取索引（最近秩法，樣本量 1000 足夠穩定）
        const sorted = finalBalances.slice().sort((a, b) => a - b)
        const percentile = p => {
            if (simCount === 0) return 0
            const idx = Math.min(
                simCount - 1,
                Math.max(0, Math.round((p / 100) * (simCount - 1)))
            )
            return sorted[idx]
        }

        let medianDepletionYear = null
        if (depletionYears.length > 0) {
            const ds = depletionYears.slice().sort((a, b) => a - b)
            medianDepletionYear = ds[Math.floor(ds.length / 2)]
        }

        const params = {
            startBalance,
            monthlyNet,
            monthlyWithdrawal,
            years,
            returnModel,
            annualReturn,
            volatility,
            seed,
        }
        if (returnModel === RETURN_MODELS.HISTORICAL) {
            params.blockSize = blockSize
            params.historicalDataset = selectedHistoricalMeta.id
        }

        return {
            simCount,
            years,
            returnModel,
            ...(returnModel === RETURN_MODELS.HISTORICAL
                ? { blockSize, historicalDataset: selectedHistoricalMeta.id }
                : {}),
            successCount,
            depletedCount,
            successRate: simCount > 0 ? successCount / simCount : 0,
            p10: Math.round(percentile(10)),
            p25: Math.round(percentile(25)),
            median: Math.round(percentile(50)),
            p75: Math.round(percentile(75)),
            p90: Math.round(percentile(90)),
            medianDepletionYear,
            historicalMeta:
                returnModel === RETURN_MODELS.HISTORICAL
                    ? {
                          ...selectedHistoricalMeta,
                          sampleCount: historicalSeries.length,
                      }
                    : null,
            params,
        }
    }
}

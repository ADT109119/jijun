/**
 * retirementReport.js — #AB1 Monte Carlo 退休分析報告（實驗性）
 *
 * 借鏡 Actual Budget 26.9.0 實驗性 retirement report：以 Monte Carlo 模擬
 * 估算「現有储蓄 + 每月淨儲蓄」在假設報酬率/波動度下，能撐到目標年數的
 * 成功率，以及期末資產的分佈區間。
 *
 * 實驗性定位說明：
 *   - 純前端模擬，結果為統計估算而非投資建議
 *   - 不寫入任何資料（只讀 records/accounts），無 Schema/同步影響
 *   - 使用可設定亂數種子（mulberry32 + Box-Muller），同輸入必得同結果，
 *     便於單元測試與使用者重現
 *
 * Public API:
 *   new RetirementReport(dataService)
 *   await collectFinancialSnapshot()   彙總目前淨資產與近 6 個月平均月收支
 *   static simulate(options)           純函數，Monte Carlo 模擬
 */

// 模擬參數的安全邊界（防呆：越界一律 clamp 或throw，避免 UI 誤輸入拖垮瀏覽器）
const SIM_COUNT_MIN = 50
const SIM_COUNT_MAX = 10000
const SIM_COUNT_DEFAULT = 1000
const YEARS_MIN = 1
const YEARS_MAX = 80
const RETURN_MIN = -0.9 // 年化報酬率下限（-90%）
const RETURN_MAX = 1.0 // 年化報酬率上限（+100%）
const VOLATILITY_MAX = 2.0 // 波動度上限（200%）

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
     * 執行 Monte Carlo 退休模擬。
     *
     * 模型（年度粒度，語意明確可測）：
     *   每年結算一次：balance = balance × (1 + r) + 年度淨儲蓄
     *   其中 r ~ Normal(annualReturn, volatility)，
     *   年度淨儲蓄 = (monthlyNet − monthlyWithdrawal) × 12
     *   （淨儲蓄以年底入帳近似；monthlyWithdrawal 用於模擬退休後提領）
     *   balance < 0 該年即視為破產（該 sim 剩餘年餘額停於 0）。
     *
     * @param {Object} options
     * @param {number} options.startBalance        起始資產（负數視為 0）
     * @param {number} options.monthlyNet          每月淨儲蓄（可為负）
     * @param {number} options.years               推估年數（1-80）
     * @param {number} [options.annualReturn=0.04] 年化報酬率（小數，0.04=4%）
     * @param {number} [options.volatility=0.10]   年化波動度（小數，0.10=10%）
     * @param {number} [options.monthlyWithdrawal=0] 每月提領（退休後支出）
     * @param {number} [options.simCount=1000]     模擬次數（50-10000）
     * @param {number} [options.seed=20260928]     亂數種子（同種子同結果）
     * @returns {{simCount:number, years:number, successCount:number, depletedCount:number,
     *            successRate:number, median:number, p10:number, p25:number, p75:number, p90:number,
     *            medianDepletionYear:number|null, params:Object}}
     * @throws {Error} years/annualReturn/volatility 越界或非數時明確拒絕
     */
    static simulate(options) {
        const opts = options || {}

        // 邊界驗證（語意同 partialSettleGroup 輸入驗證模式）：
        // 核心假設參數非法 → 直接 throw，避免 UI 誤輸入產出誤導性報告
        if (typeof opts.years !== 'number' || !isFinite(opts.years) ||
            !Number.isInteger(opts.years) ||
            opts.years < YEARS_MIN || opts.years > YEARS_MAX) {
            throw new Error(`推估年數必須為 ${YEARS_MIN}-${YEARS_MAX} 的整數`)
        }
        if (typeof opts.annualReturn !== 'number' || !isFinite(opts.annualReturn) ||
            opts.annualReturn < RETURN_MIN || opts.annualReturn > RETURN_MAX) {
            throw new Error('年化報酬率必須介於 -90% 到 100% 之間')
        }
        if (typeof opts.volatility !== 'number' || !isFinite(opts.volatility) ||
            opts.volatility < 0 || opts.volatility > VOLATILITY_MAX) {
            throw new Error('波動度必須介於 0% 到 200% 之間')
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
        const annualReturn = opts.annualReturn
        const volatility = opts.volatility
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
            for (let y = 1; y <= years; y++) {
                const r = Math.max(-1, annualReturn + normalRandom(rand) * volatility)
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

        // 分位數：期末資產由小到大排序後取索引（最近秩法，樣本量 1000 足够穩定）
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

        return {
            simCount,
            years,
            successCount,
            depletedCount,
            successRate: simCount > 0 ? successCount / simCount : 0,
            p10: Math.round(percentile(10)),
            p25: Math.round(percentile(25)),
            median: Math.round(percentile(50)),
            p75: Math.round(percentile(75)),
            p90: Math.round(percentile(90)),
            medianDepletionYear,
            params: {
                startBalance,
                monthlyNet,
                monthlyWithdrawal,
                years,
                annualReturn,
                volatility,
                seed
            }
        }
    }
}

/**
 * retirementReport.test.js — #AB1 Monte Carlo 退休分析報告核心模組測試
 *
 * 覆蓋：simulate() 純函數（邊界驗證/決定性/統計語意/分位數單調性/破產語意）
 *       collectFinancialSnapshot()（帳戶過濾/降級/月平均語意）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetirementReport } from '../../src/js/retirementReport.js'

/* ------------------------------------------------------------------ */
/*  simulate() — 邊界驗證（非法參數必須明確拒絕）                        */
/* ------------------------------------------------------------------ */

describe('RetirementReport.simulate 參數驗證', () => {
    const valid = {
        startBalance: 1000000,
        monthlyNet: 15000,
        years: 30,
        annualReturn: 0.04,
        volatility: 0.1
    }

    it('正常參數回傳完整結果結構', () => {
        const r = RetirementReport.simulate(valid)
        expect(r.simCount).toBe(1000) // 預設模擬次數
        expect(r.years).toBe(30)
        expect(typeof r.successRate).toBe('number')
        expect(r.successCount + r.depletedCount).toBe(r.simCount)
        expect(typeof r.median).toBe('number')
        expect(r.params.startBalance).toBe(1000000)
    })

    it('years 非整數 throw', () => {
        expect(() =>
            RetirementReport.simulate({ ...valid, years: 10.5 })
        ).toThrow('推估年數')
    })

    it('years 越界（0 或 81）throw', () => {
        expect(() =>
            RetirementReport.simulate({ ...valid, years: 0 })
        ).toThrow('推估年數')
        expect(() =>
            RetirementReport.simulate({ ...valid, years: 81 })
        ).toThrow('推估年數')
    })

    it('years 非數（null/字串/NaN）throw', () => {
        for (const bad of [null, undefined, '30', NaN]) {
            expect(() =>
                RetirementReport.simulate({ ...valid, years: bad })
            ).toThrow()
        }
    })

    it('annualReturn 越界（1.5 或 -1.5）throw', () => {
        expect(() =>
            RetirementReport.simulate({ ...valid, annualReturn: 1.5 })
        ).toThrow('報酬率')
        expect(() =>
            RetirementReport.simulate({ ...valid, annualReturn: -1.5 })
        ).toThrow('報酬率')
    })

    it('volatility 負數 throw', () => {
        expect(() =>
            RetirementReport.simulate({ ...valid, volatility: -0.1 })
        ).toThrow('波動度')
    })

    it('完全未傳參數（空物件）throw 而非崩潰', () => {
        expect(() => RetirementReport.simulate({})).toThrow()
        expect(() => RetirementReport.simulate()).toThrow()
    })
})

/* ------------------------------------------------------------------ */
/*  simulate() — 決定性（同種子必得同結果）                              */
/* ------------------------------------------------------------------ */

describe('RetirementReport.simulate 決定性', () => {
    const base = {
        startBalance: 500000,
        monthlyNet: 10000,
        years: 20,
        annualReturn: 0.05,
        volatility: 0.15,
        seed: 42
    }

    it('同 seed 兩次執行結果完全相同', () => {
        const a = RetirementReport.simulate(base)
        const b = RetirementReport.simulate(base)
        expect(a).toEqual(b)
    })

    it('不同 seed 產生不同期末分佈（亂數確實生效）', () => {
        const a = RetirementReport.simulate({ ...base, seed: 1 })
        const b = RetirementReport.simulate({ ...base, seed: 2 })
        expect(a.median).not.toBe(b.median)
    })
})

/* ------------------------------------------------------------------ */
/*  simulate() — 統計語意                                               */
/* ------------------------------------------------------------------ */

describe('RetirementReport.simulate 統計語意', () => {
    it('零報酬零波動 + 正儲蓄 → 100% 成功，期末 = 本金+儲蓄×12×年數（精確值）', () => {
        const r = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 10000,
            years: 10,
            annualReturn: 0,
            volatility: 0,
            simCount: 100
        })
        expect(r.successRate).toBe(1)
        expect(r.depletedCount).toBe(0)
        // balance = 100000 + 10000×12×10 = 1300000（零報酬無複利）
        expect(r.median).toBe(1300000)
        expect(r.p10).toBe(1300000)
        expect(r.p90).toBe(1300000)
    })

    it('負淨儲蓄提領 → 必然破產，中位破產年為正整數', () => {
        // 模型語意：餘額採乘法衰減永不自發穿越 0，破產只來自負年度淨流入
        const r = RetirementReport.simulate({
            startBalance: 500000,
            monthlyNet: -10000, // 每年 -120000 提領
            years: 20,
            annualReturn: 0,
            volatility: 0,
            simCount: 100
        })
        expect(r.successRate).toBe(0)
        expect(r.depletedCount).toBe(100)
        expect(Number.isInteger(r.medianDepletionYear)).toBe(true)
        expect(r.medianDepletionYear).toBe(5) // 500000 - 120000×5 < 0 → 第 5 年
        expect(r.median).toBe(0) // 破產後餘額停於 0
    })

    it('零儲蓄 + 負報酬 → 餘額漸近 0 但不觸發破產（乘法衰減模型語意鎖定）', () => {
        const r = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 0,
            years: 20,
            annualReturn: -0.5,
            volatility: 0,
            simCount: 100
        })
        expect(r.successRate).toBe(1) // 技術上未穿越 0
        expect(r.median).toBeLessThan(1) // 但已衰減到趨近 0
    })

    it('高波動度 + 零提領 → 單年報酬率下限鎖在 -100%，無槓桿組合不會因單年虧損超過 100% 變成負債破產', () => {
        const r = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 0,
            monthlyWithdrawal: 0,
            years: 30,
            annualReturn: -0.5,
            volatility: 2.0,
            simCount: 200,
            seed: 42
        })
        expect(r.depletedCount).toBe(0)
        expect(r.successRate).toBe(1)
    })

    it('每月提領完全吃掉儲蓄 → 等同零儲蓄情境', () => {
        const r = RetirementReport.simulate({
            startBalance: 0,
            monthlyNet: 20000,
            monthlyWithdrawal: 20000,
            years: 5,
            annualReturn: 0,
            volatility: 0,
            simCount: 50
        })
        // 起始 0、淨儲蓄 0 → 第一年後餘額 0，不為負 → 未破產但歸零
        expect(r.successRate).toBe(1) // 0 不小於 0，技術上不破產
        expect(r.median).toBe(0)
    })

    it('提領超過儲蓄 → 負年度淨流入，有儲蓄本金者終將破產', () => {
        const r = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 5000,
            monthlyWithdrawal: 15000, // 每年 -120000
            years: 10,
            annualReturn: 0,
            volatility: 0,
            simCount: 60
        })
        expect(r.successRate).toBe(0)
        // 100000 / 120000 → 第 1 年就破產
        expect(r.medianDepletionYear).toBe(1)
    })

    it('分位數單調性：p10 ≤ p25 ≤ median ≤ p75 ≤ p90', () => {
        const r = RetirementReport.simulate({
            startBalance: 300000,
            monthlyNet: 8000,
            years: 25,
            annualReturn: 0.05,
            volatility: 0.18,
            simCount: 500,
            seed: 7
        })
        expect(r.p10).toBeLessThanOrEqual(r.p25)
        expect(r.p25).toBeLessThanOrEqual(r.median)
        expect(r.median).toBeLessThanOrEqual(r.p75)
        expect(r.p75).toBeLessThanOrEqual(r.p90)
    })

    it('simCount 越界被 clamp（過低 → 50，過高 → 10000）', () => {
        const low = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 5000,
            years: 10,
            annualReturn: 0.03,
            volatility: 0.1,
            simCount: 5
        })
        expect(low.simCount).toBe(50)
        const high = RetirementReport.simulate({
            startBalance: 100000,
            monthlyNet: 5000,
            years: 10,
            annualReturn: 0.03,
            volatility: 0.1,
            simCount: 999999
        })
        expect(high.simCount).toBe(10000)
    })

    it('負起始資產視為 0（不产生負本金）', () => {
        const r = RetirementReport.simulate({
            startBalance: -500000,
            monthlyNet: 10000,
            years: 3,
            annualReturn: 0,
            volatility: 0,
            simCount: 50
        })
        expect(r.params.startBalance).toBe(0)
        expect(r.median).toBe(360000) // 10000×12×3
    })

    it('負每月提領被歸零（提領不可為負 = 變相儲蓄）', () => {
        const r = RetirementReport.simulate({
            startBalance: 0,
            monthlyNet: 10000,
            monthlyWithdrawal: -99999,
            years: 2,
            annualReturn: 0,
            volatility: 0,
            simCount: 50
        })
        expect(r.params.monthlyWithdrawal).toBe(0)
        expect(r.median).toBe(240000) // 10000×12×2，提領未變成額外儲蓄
    })

    it('startBalance 為 NaN/Infinity 降級為 0（非數防呆）', () => {
        const r = RetirementReport.simulate({
            startBalance: NaN,
            monthlyNet: 10000,
            years: 2,
            annualReturn: 0,
            volatility: 0,
            simCount: 50
        })
        expect(r.params.startBalance).toBe(0)
        expect(r.median).toBe(240000)
    })
})

/* ------------------------------------------------------------------ */
/*  collectFinancialSnapshot() — 資料彙總                                */
/* ------------------------------------------------------------------ */

function makeMockDataService(overrides = {}) {
    return {
        getAccounts: vi.fn(async () => [
            { id: 1, name: '現金', type: 'wallet', balance: 50000 },
            { id: 2, name: '台新', type: 'credit_card', balance: -20000 },
            { id: 3, name: '郵儲', type: 'wallet', balance: 150000 }
        ]),
        calculateAccountCurrentBalance: vi.fn(async id => {
            if (id === 1) return 60000
            if (id === 3) return -10000 // 負餘額帳戶不列入淨資產
            return 0
        }),
        getStatistics: vi.fn(async () => ({
            totalIncome: 600000,
            totalExpense: 300000
        })),
        ...overrides
    }
}

describe('RetirementReport.collectFinancialSnapshot', () => {
    let ds

    beforeEach(() => {
        ds = makeMockDataService()
    })

    it('淨資產只計非信用卡帳戶的正值餘額', async () => {
        const report = new RetirementReport(ds)
        const snap = await report.collectFinancialSnapshot()
        // 60000(現金) + 0(郵儲負餘額不計) = 60000；信用卡 -20000 排除
        expect(snap.netWorth).toBe(60000)
        expect(snap.accountCount).toBe(2) // 現金+郵儲（信用卡不計）
    })

    it('getAccounts 拋錯降級 netWorth=0 不崩潰', async () => {
        const report = new RetirementReport(
            makeMockDataService({
                getAccounts: vi.fn(async () => {
                    throw new Error('db fail')
                })
            })
        )
        const snap = await report.collectFinancialSnapshot()
        expect(snap.netWorth).toBe(0)
        expect(snap.accountCount).toBe(0)
    })

    it('calculateAccountCurrentBalance 失敗回退帳戶 balance 欄位', async () => {
        const report = new RetirementReport(
            makeMockDataService({
                calculateAccountCurrentBalance: vi.fn(async () => {
                    throw new Error('calc fail')
                })
            })
        )
        const snap = await report.collectFinancialSnapshot()
        // 回退：50000(現金 balance) + 150000(郵儲 balance) = 200000
        expect(snap.netWorth).toBe(200000)
    })

    it('無 calculateAccountCurrentBalance 方法時用帳戶 balance 欄位', async () => {
        const report = new RetirementReport(
            makeMockDataService({
                calculateAccountCurrentBalance: undefined
            })
        )
        const snap = await report.collectFinancialSnapshot()
        expect(snap.netWorth).toBe(200000)
    })

    it('月收入/支出 = 近 6 個月統計平均，且 offsetTransfers=true', async () => {
        const report = new RetirementReport(ds)
        const snap = await report.collectFinancialSnapshot()
        expect(snap.monthlyIncome).toBe(100000) // 600000/6
        expect(snap.monthlyExpense).toBe(50000) // 300000/6
        expect(snap.monthlyNet).toBe(50000)
        expect(snap.monthsSampled).toBe(6)
        // 第 4 參數必須是 true（排除轉帳，否則轉帳灌大收支）
        expect(ds.getStatistics).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            null,
            true
        )
    })

    it('getStatistics 拋錯 → 月收入/支出降級 0', async () => {
        const report = new RetirementReport(
            makeMockDataService({
                getStatistics: vi.fn(async () => {
                    throw new Error('stats fail')
                })
            })
        )
        const snap = await report.collectFinancialSnapshot()
        expect(snap.monthlyIncome).toBe(0)
        expect(snap.monthlyExpense).toBe(0)
        expect(snap.monthlyNet).toBe(0)
    })

    it('日期參數為 YYYY-MM-DD 字串且期間約 6 個月', async () => {
        const report = new RetirementReport(ds)
        await report.collectFinancialSnapshot()
        const [start, end] = ds.getStatistics.mock.calls[0]
        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const months =
            (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24 * 30)
        expect(months).toBeGreaterThanOrEqual(5)
        expect(months).toBeLessThanOrEqual(6.5)
    })

    it('非有限 balance（NaN/undefined）不污染淨資產', async () => {
        const report = new RetirementReport(
            makeMockDataService({
                calculateAccountCurrentBalance: undefined,
                getAccounts: vi.fn(async () => [
                    { id: 1, type: 'wallet', balance: NaN },
                    { id: 2, type: 'wallet', balance: undefined },
                    { id: 3, type: 'wallet', balance: 12345 }
                ])
            })
        )
        const snap = await report.collectFinancialSnapshot()
        expect(snap.netWorth).toBe(12345)
    })
})

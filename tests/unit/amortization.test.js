import { describe, it, expect } from 'vitest'
import {
    calculateAmortizationDetails,
    calculateAmortizationProgress,
    calculateNextDueDate,
    shouldSkipDate,
} from '../../src/js/utils.js'

// ==================== calculateAmortizationDetails ====================

describe('calculateAmortizationDetails', () => {
    it('本金為 0 回傳零值', () => {
        expect(calculateAmortizationDetails(0, 12, 3.5, 'monthly')).toEqual({
            amountPerPeriod: 0,
            exactTotalToPay: 0,
        })
    })

    it('期數為 0 回傳零值', () => {
        expect(calculateAmortizationDetails(10000, 0, 3.5, 'monthly')).toEqual({
            amountPerPeriod: 0,
            exactTotalToPay: 0,
        })
    })

    it('無利率：每期金額 = 本金 / 期數', () => {
        const result = calculateAmortizationDetails(3600, 12, 0, 'monthly')
        expect(result.amountPerPeriod).toBe(300)
        expect(result.exactTotalToPay).toBe(3600)
    })

    it('無利率 + 非整除：round 策略四捨五入', () => {
        const result = calculateAmortizationDetails(1000, 3, 0, 'monthly')
        expect(result.amountPerPeriod).toBe(333) // Math.round(333.33)
    })

    it('有利率（月付）：正確計算年金', () => {
        const result = calculateAmortizationDetails(100000, 12, 3.5, 'monthly')
        expect(result.amountPerPeriod).toBeGreaterThan(8400)
        expect(result.amountPerPeriod).toBeLessThan(8500)
        expect(result.exactTotalToPay).toBeGreaterThan(100000) // 總額 > 本金
    })

    it('有利率（週付）：periodRate = annualRate / 100 / 52', () => {
        const result = calculateAmortizationDetails(10000, 52, 5, 'weekly')
        expect(result.amountPerPeriod).toBeGreaterThan(180)
        expect(result.amountPerPeriod).toBeLessThan(200)
    })

    it('有利率（年付）：periodRate = annualRate / 100', () => {
        const result = calculateAmortizationDetails(50000, 3, 4, 'yearly')
        expect(result.amountPerPeriod).toBeGreaterThan(17000)
        expect(result.amountPerPeriod).toBeLessThan(19000)
    })

    it('decimalStrategy: round', () => {
        const result = calculateAmortizationDetails(
            1000,
            3,
            0,
            'monthly',
            'round'
        )
        expect(result.amountPerPeriod).toBe(Math.round(1000 / 3)) // 333
    })

    it('decimalStrategy: ceil', () => {
        const result = calculateAmortizationDetails(
            1000,
            3,
            0,
            'monthly',
            'ceil'
        )
        expect(result.amountPerPeriod).toBe(Math.ceil(1000 / 3)) // 334
    })

    it('decimalStrategy: floor', () => {
        const result = calculateAmortizationDetails(
            1000,
            3,
            0,
            'monthly',
            'floor'
        )
        expect(result.amountPerPeriod).toBe(Math.floor(1000 / 3)) // 333
    })

    it('decimalStrategy: keep（保留兩位小數）', () => {
        const result = calculateAmortizationDetails(
            1000,
            3,
            0,
            'monthly',
            'keep'
        )
        expect(result.amountPerPeriod).toBe(Math.round((1000 / 3) * 100) / 100) // 333.33
    })
})

// ==================== calculateNextDueDate ====================

describe('calculateNextDueDate', () => {
    it('daily + interval=1：加一天', () => {
        expect(calculateNextDueDate('2024-01-15', 'daily', 1)).toBe(
            '2024-01-16'
        )
    })

    it('weekly + interval=1：加七天', () => {
        expect(calculateNextDueDate('2024-01-15', 'weekly', 1)).toBe(
            '2024-01-22'
        )
    })

    it('weekly + interval=2：加十四天', () => {
        expect(calculateNextDueDate('2024-01-01', 'weekly', 2)).toBe(
            '2024-01-15'
        )
    })

    it('monthly + interval=1：加一個月（跨月，#EOM-E2 月末自動收斂）', () => {
        // 1/31 + 1 月 → 2024 閏年 2/29（不再溢出到 3/2）
        const result = calculateNextDueDate('2024-01-31', 'monthly', 1)
        expect(result).toBe('2024-02-29')
    })

    it('yearly + interval=1：加一年（#EOM-E2 閏年→非閏年月底收斂）', () => {
        // 2024-02-29 + 1 年 → 2025-02-28（收斂到月底，不再溢出 3/1）
        const result = calculateNextDueDate('2024-02-29', 'yearly', 1)
        expect(result).toBe('2025-02-28')
    })

    it('monthly + interval=3：加三個月', () => {
        expect(calculateNextDueDate('2024-01-15', 'monthly', 3)).toBe(
            '2024-04-15'
        )
    })

    it('monthly 跨年', () => {
        expect(calculateNextDueDate('2024-12-15', 'monthly', 3)).toBe(
            '2025-03-15'
        )
    })

    it('invalid frequency 拋出錯誤', () => {
        expect(() => calculateNextDueDate('2024-01-15', 'biweekly', 1)).toThrow(
            'Invalid frequency'
        )
    })
})

// ==================== shouldSkipDate ====================

describe('shouldSkipDate', () => {
    it('無 skipRules 回傳 false', () => {
        expect(shouldSkipDate(new Date('2024-01-15'), null)).toBe(false)
        expect(shouldSkipDate(new Date('2024-01-15'), undefined)).toBe(false)
        expect(shouldSkipDate(new Date('2024-01-15'), [])).toBe(false)
    })

    it('dayOfWeek 規則：週日（0）跳過', () => {
        const rules = [{ type: 'dayOfWeek', values: [0] }] // Sunday
        const sunday = new Date('2024-01-14') // Jan 14, 2024 is Sunday
        expect(shouldSkipDate(sunday, rules)).toBe(true)

        const monday = new Date('2024-01-15') // Monday
        expect(shouldSkipDate(monday, rules)).toBe(false)
    })

    it('dayOfMonth 規則：每月 1 號跳過', () => {
        const rules = [{ type: 'dayOfMonth', values: [1] }]
        expect(shouldSkipDate(new Date('2024-03-01'), rules)).toBe(true)
        expect(shouldSkipDate(new Date('2024-03-15'), rules)).toBe(false)
    })

    it('monthOfYear 規則：三月（index=2）跳過', () => {
        const rules = [{ type: 'monthOfYear', values: [2] }] // March
        expect(shouldSkipDate(new Date('2024-03-15'), rules)).toBe(true)
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false)
    })

    it('多個 skipRules：OR 邏輯（任一匹配就跳過）', () => {
        const rules = [
            { type: 'dayOfWeek', values: [0, 6] }, // Sat & Sun
            { type: 'monthOfYear', values: [5, 6, 7] }, // Jun, Jul, Aug
        ]

        // Saturday
        expect(shouldSkipDate(new Date('2024-01-13'), rules)).toBe(true)
        // Sunday
        expect(shouldSkipDate(new Date('2024-01-14'), rules)).toBe(true)
        // July (summer) - not a weekend
        expect(shouldSkipDate(new Date('2024-07-15'), rules)).toBe(true)
        // January weekday
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false)
    })

    it('rule 無 values 跳過該 rule', () => {
        const rules = [{ type: 'dayOfWeek', values: [] }]
        expect(shouldSkipDate(new Date('2024-01-14'), rules)).toBe(false) // Sunday but empty values
    })

    it('unknown type 不匹配', () => {
        const rules = [{ type: 'unknownType', values: [1] }]
        expect(shouldSkipDate(new Date('2024-01-15'), rules)).toBe(false)
    })
})

// ==================== calculateAmortizationProgress (#MOZE-START) ====================

describe('calculateAmortizationProgress', () => {
    // 無利率 12000/12 期：每期 1000、exactTotalToPay = 12000
    const plan = over => ({
        totalAmount: 12000,
        downPayment: 0,
        interestRate: 0,
        periods: 12,
        frequency: 'monthly',
        decimalStrategy: 'round',
        startDate: '2026-01-15',
        completedPeriods: 0,
        ...over,
    })

    it('startDate 缺失回傳 null', () => {
        expect(
            calculateAmortizationProgress({ ...plan(), startDate: '' })
        ).toBeNull()
        expect(
            calculateAmortizationProgress({ ...plan(), startDate: undefined })
        ).toBeNull()
    })

    it('completedPeriods=0：nextDueDate = startDate，剩餘 = 全部', () => {
        const p = calculateAmortizationProgress(plan())
        expect(p.nextDueDate).toBe('2026-01-15')
        expect(p.amountPerPeriod).toBe(1000)
        expect(p.exactTotalRemaining).toBe(12000)
    })

    it('completedPeriods=5：nextDueDate 向後推 5 個月，剩餘扣 5 期', () => {
        const p = calculateAmortizationProgress(plan({ completedPeriods: 5 }))
        expect(p.nextDueDate).toBe('2026-06-15')
        expect(p.exactTotalRemaining).toBe(7000)
    })

    it('月頻月末收斂 #EOM-E2：錨定起始日，月底可逆不漂移', () => {
        // 1/31 起每月一期，錨定起始日 31：2 月落 2/28、3 月回 3/31、4 月落 4/30
        const p = calculateAmortizationProgress(
            plan({ startDate: '2026-01-31', completedPeriods: 3 })
        )
        expect(p.nextDueDate).toBe('2026-04-30')
        // 逐期錨定迭代等價（與 processAmortizations 的 amortAnchorDay 同款語意）
        let iterated = '2026-01-31'
        for (let i = 0; i < 3; i++)
            iterated = calculateNextDueDate(iterated, 'monthly', 1, 31)
        expect(p.nextDueDate).toBe(iterated)
        // 第 2 期（completed=1）落在收斂後的 2/28
        expect(
            calculateAmortizationProgress(
                plan({ startDate: '2026-01-31', completedPeriods: 1 })
            ).nextDueDate
        ).toBe('2026-02-28')
    })

    it('completedPeriods 超過 periods：clamp 至 periods，剩餘下限 0', () => {
        const p = calculateAmortizationProgress(plan({ completedPeriods: 20 }))
        // clamp 到 12：nextDueDate = 第 13 期（1/15 + 12 個月）
        expect(p.nextDueDate).toBe('2027-01-15')
        expect(p.exactTotalRemaining).toBe(0)
    })

    it('completedPeriods 負值/非法：視同 0', () => {
        const p = calculateAmortizationProgress(
            plan({ completedPeriods: -3 })
        )
        expect(p.nextDueDate).toBe('2026-01-15')
        expect(p.exactTotalRemaining).toBe(12000)
        const p2 = calculateAmortizationProgress(
            plan({ completedPeriods: 'abc' })
        )
        expect(p2.nextDueDate).toBe('2026-01-15')
    })

    it('首付從本金扣除：每期與剩餘按 (total - downPayment) 計算', () => {
        // 12000 總額、首付 2000 → 本金 10000 / 10 期 = 每期 1000
        const p = calculateAmortizationProgress(
            plan({
                totalAmount: 12000,
                downPayment: 2000,
                periods: 10,
                completedPeriods: 2,
            })
        )
        expect(p.amountPerPeriod).toBe(1000)
        expect(p.exactTotalRemaining).toBe(8000)
        expect(p.nextDueDate).toBe('2026-03-15')
    })

    it('有利率：剩餘 = 含息總額 - 已還期數×每期金額', () => {
        const p = calculateAmortizationProgress(
            plan({ interestRate: 5, completedPeriods: 4 })
        )
        const { amountPerPeriod, exactTotalToPay } =
            calculateAmortizationDetails(12000, 12, 5, 'monthly', 'round')
        expect(p.amountPerPeriod).toBe(amountPerPeriod)
        expect(p.exactTotalRemaining).toBe(
            Math.max(0, exactTotalToPay - amountPerPeriod * 4)
        )
        // 有息時剩餘 > 本金剩餘（利息已攤入）
        expect(p.exactTotalRemaining).toBeGreaterThan(12000 - amountPerPeriod * 4)
    })

    it('週頻：nextDueDate 向後推 completed 週', () => {
        const p = calculateAmortizationProgress(
            plan({ frequency: 'weekly', completedPeriods: 10 })
        )
        expect(p.nextDueDate).toBe('2026-03-26')
    })

    it('年頻：nextDueDate 向後推 completed 年', () => {
        const p = calculateAmortizationProgress(
            plan({ frequency: 'yearly', completedPeriods: 2 })
        )
        expect(p.nextDueDate).toBe('2028-01-15')
    })
})

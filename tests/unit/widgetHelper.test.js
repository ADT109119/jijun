import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockUpdateWidgetData } = vi.hoisted(() => ({
    mockUpdateWidgetData: vi.fn().mockResolvedValue({})
}))

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => ({
        updateWidgetData: mockUpdateWidgetData
    }))
}))

import { updateAndroidWidget } from '../../src/js/widgetHelper.js'

describe('updateAndroidWidget', () => {
    let mockDataService, mockCategoryManager, mockBudgetManager

    beforeEach(() => {
        vi.setSystemTime(new Date(2024, 0, 15))
        localStorage.clear()
        mockUpdateWidgetData.mockResolvedValue({})

        window.Capacitor = { isNativePlatform: () => true }

        mockDataService = {
            db: {},
            getRecords: vi.fn().mockResolvedValue([])
        }
        mockCategoryManager = {}
        mockBudgetManager = {
            loadBudget: vi.fn().mockResolvedValue(undefined),
            getBudgetStatus: vi.fn().mockResolvedValue({
                budget: 0,
                spent: 0,
                remaining: 0,
                percentage: 0,
                isOverBudget: false,
                categoryStatuses: []
            })
        }
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── 早期回傳 ──────────────────────────────────────

    describe('early return', () => {
        it('should return early when window.Capacitor does not exist', async () => {
            delete window.Capacitor
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)
            expect(mockDataService.getRecords).not.toHaveBeenCalled()
            expect(mockUpdateWidgetData).not.toHaveBeenCalled()
        })

        it('should return early when isNativePlatform() returns false', async () => {
            window.Capacitor = { isNativePlatform: () => false }
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)
            expect(mockDataService.getRecords).not.toHaveBeenCalled()
            expect(mockUpdateWidgetData).not.toHaveBeenCalled()
        })

        it('should return early when dataService is null', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            await updateAndroidWidget(null, mockCategoryManager, mockBudgetManager)
            expect(warnSpy).toHaveBeenCalled()
            expect(mockUpdateWidgetData).not.toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it('should return early when dataService.db is not initialized', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            mockDataService.db = null
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)
            expect(warnSpy).toHaveBeenCalledWith('DataService DB is not initialized yet. Skipping widget update.')
            expect(mockUpdateWidgetData).not.toHaveBeenCalled()
            warnSpy.mockRestore()
        })
    })

    // ── 今日支出計算 ──────────────────────────────────

    describe('today expense calculation', () => {
        it('should sum today expense records correctly', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-15', type: 'expense', amount: 100 },
                { date: '2024-01-15', type: 'expense', amount: 50 },
                { date: '2024-01-15', type: 'income', amount: 200 },
                { date: '2024-01-14', type: 'expense', amount: 30 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ todayExpense: '$150' })
            )
        })

        it('should return $0 when no records for today', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-14', type: 'expense', amount: 100 },
                { date: '2024-01-16', type: 'expense', amount: 50 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ todayExpense: '$0' })
            )
        })
    })

    // ── 本月結餘計算 ──────────────────────────────────

    describe('month balance calculation', () => {
        it('should show positive balance with + prefix', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-05', type: 'income', amount: 5000 },
                { date: '2024-01-10', type: 'expense', amount: 2000 },
                { date: '2024-02-01', type: 'income', amount: 3000 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ monthBalance: '+$3,000' })
            )
        })

        it('should show negative balance with - prefix', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-05', type: 'income', amount: 1000 },
                { date: '2024-01-10', type: 'expense', amount: 3000 },
                { date: '2024-01-20', type: 'expense', amount: 500 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ monthBalance: '-$2,500' })
            )
        })

        it('should show +$0 when income equals expense', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-05', type: 'income', amount: 2000 },
                { date: '2024-01-10', type: 'expense', amount: 2000 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ monthBalance: '+$0' })
            )
        })
    })

    // ── 預算進度 ──────────────────────────────────────

    describe('budget progress', () => {
        it('should calculate progressVal and progressText when budget > 0', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 5000,
                remaining: 5000,
                percentage: 50,
                isOverBudget: false,
                categoryStatuses: []
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({
                    budgetProgressVal: 50,
                    budgetProgressText: '預算已使用: 50% (5000/10000)'
                })
            )
        })

        it('should cap progressVal at 100 when percentage exceeds 100', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 5000,
                spent: 8000,
                remaining: 0,
                percentage: 160,
                isOverBudget: true,
                categoryStatuses: []
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({
                    budgetProgressVal: 100,
                    budgetProgressText: '預算已使用: 100% (8000/5000)'
                })
            )
        })

        it('should round percentage to integer', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 3333,
                remaining: 6667,
                percentage: 33.33,
                isOverBudget: false,
                categoryStatuses: []
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ budgetProgressVal: 33 })
            )
        })
    })

    // ── 分類預算狀態 ──────────────────────────────────

    describe('category budget status', () => {
        it('should show warning when a category is over budget', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 8000,
                remaining: 2000,
                percentage: 80,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '餐飲', budget: 3000, spent: 3500, isOverBudget: true, percentage: 116.67, isExcluded: false },
                    { name: '交通', budget: 2000, spent: 1800, isOverBudget: false, percentage: 90, isExcluded: false }
                ]
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ categoryBudgetStatus: '⚠️ 餐飲已超支 $500' })
            )
        })

        it('should show top usage when no category is over budget', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 4000,
                remaining: 6000,
                percentage: 40,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '餐飲', budget: 3000, spent: 2500, isOverBudget: false, percentage: 83.33, isExcluded: false },
                    { name: '交通', budget: 2000, spent: 100, isOverBudget: false, percentage: 5, isExcluded: false }
                ]
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ categoryBudgetStatus: '📊 餐飲已使用 83%' })
            )
        })

        it('should pick the most overspent category among multiple over-budget', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 9000,
                remaining: 1000,
                percentage: 90,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '交通', budget: 2000, spent: 3000, isOverBudget: true, percentage: 150, isExcluded: false },
                    { name: '餐飲', budget: 3000, spent: 3200, isOverBudget: true, percentage: 106.67, isExcluded: false }
                ]
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ categoryBudgetStatus: '⚠️ 交通已超支 $1,000' })
            )
        })

        it('should ignore excluded categories when determining over-budget warning', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 5000,
                remaining: 5000,
                percentage: 50,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '餐飲', budget: 3000, spent: 3500, isOverBudget: true, percentage: 116.67, isExcluded: true },
                    { name: '交通', budget: 2000, spent: 100, isOverBudget: false, percentage: 5, isExcluded: false }
                ]
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ categoryBudgetStatus: '📊 交通已使用 5%' })
            )
        })

        it('should set empty string when no active categories', async () => {
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 10000,
                spent: 0,
                remaining: 10000,
                percentage: 0,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '餐飲', budget: 3000, spent: 0, isOverBudget: false, percentage: 0, isExcluded: false }
                ]
            })

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ categoryBudgetStatus: '' })
            )
        })
    })

    // ── 無預算狀態 ────────────────────────────────────

    describe('no budget', () => {
        it('should show 無預算限制 when budget is 0', async () => {
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({
                    budgetProgressVal: 0,
                    budgetProgressText: '無預算限制',
                    categoryBudgetStatus: ''
                })
            )
        })
    })

    // ── WidgetStorage 呼叫 ────────────────────────────

    describe('WidgetStorage call', () => {
        it('should call updateWidgetData with correct flat parameters', async () => {
            const records = [
                { date: '2024-01-15', type: 'expense', amount: 150 },
                { date: '2024-01-01', type: 'income', amount: 10000 },
                { date: '2024-01-10', type: 'expense', amount: 3000 }
            ]
            mockDataService.getRecords.mockResolvedValue(records)
            mockBudgetManager.getBudgetStatus.mockResolvedValue({
                budget: 20000,
                spent: 3150,
                remaining: 16850,
                percentage: 15.75,
                isOverBudget: false,
                categoryStatuses: [
                    { name: '餐飲', budget: 5000, spent: 2000, isOverBudget: false, percentage: 40, isExcluded: false }
                ]
            })
            localStorage.setItem('invoice_carrier_code', '/ABC123456')

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith({
                todayExpense: '$150',
                monthBalance: '+$6,850',
                budgetProgressText: '預算已使用: 16% (3150/20000)',
                budgetProgressVal: 16,
                categoryBudgetStatus: '📊 餐飲已使用 40%',
                carrierCode: '/ABC123456'
            })
        })

        it('should call loadBudget and getBudgetStatus', async () => {
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockBudgetManager.loadBudget).toHaveBeenCalledTimes(1)
            expect(mockBudgetManager.getBudgetStatus).toHaveBeenCalledTimes(1)
        })
    })

    // ── 錯誤處理 ──────────────────────────────────────

    describe('error handling', () => {
        it('should catch and log error when WidgetStorage fails', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const testError = new Error('Widget update failed')
            mockUpdateWidgetData.mockRejectedValueOnce(testError)

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(errorSpy).toHaveBeenCalledWith(
                '[Widget] Failed to update Android Widget data:',
                testError
            )
            errorSpy.mockRestore()
        })

        it('should not throw when WidgetStorage fails', async () => {
            mockUpdateWidgetData.mockRejectedValueOnce(new Error('Widget error'))

            await expect(
                updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)
            ).resolves.not.toThrow()
        })
    })

    // ── invoice_carrier_code ──────────────────────────

    describe('invoice_carrier_code', () => {
        it('should read carrier code from localStorage', async () => {
            localStorage.setItem('invoice_carrier_code', '/ABC123456')

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ carrierCode: '/ABC123456' })
            )
        })

        it('should default to empty string when carrier code not set', async () => {
            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ carrierCode: '' })
            )
        })
    })

    // ── 邊界條件 ──────────────────────────────────────

    describe('edge cases', () => {
        it('should handle empty records array', async () => {
            mockDataService.getRecords.mockResolvedValue([])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({
                    todayExpense: '$0',
                    monthBalance: '+$0'
                })
            )
        })

        it('should handle records with zero amounts', async () => {
            mockDataService.getRecords.mockResolvedValue([
                { date: '2024-01-15', type: 'expense', amount: 0 },
                { date: '2024-01-15', type: 'expense', amount: 0 }
            ])

            await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

            expect(mockUpdateWidgetData).toHaveBeenCalledWith(
                expect.objectContaining({ todayExpense: '$0' })
            )
        })

        it('should not throw when budgetManager methods fail', async () => {
            mockBudgetManager.loadBudget.mockRejectedValueOnce(new Error('Budget load failed'))

            await expect(
                updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)
            ).resolves.not.toThrow()
        })
    })
})

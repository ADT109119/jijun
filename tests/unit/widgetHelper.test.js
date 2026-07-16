import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/js/utils.js', () => ({
    formatDateToString: vi.fn(() => '2026-07-16'),
}))

const mockUpdateWidgetData = vi.fn(async () => {})

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => ({
        updateWidgetData: mockUpdateWidgetData,
    })),
}))

describe('widgetHelper - budget resilience', () => {
    beforeEach(() => {
        globalThis.Capacitor = { isNativePlatform: () => true }
        mockUpdateWidgetData.mockClear()
    })

    afterEach(() => {
        globalThis.Capacitor = { isNativePlatform: () => false }
    })

    it('should still call updateWidgetData when getBudgetStatus throws', async () => {
        const { updateAndroidWidget } = await import('../../src/js/widgetHelper.js')

        const mockDataService = {
            db: {},
            activeLedgerId: 1,
            getRecords: vi.fn(async () => [
                { date: '2026-07-16', type: 'expense', amount: 150 },
                { date: '2026-07-16', type: 'income', amount: 500 },
            ]),
            getStatistics: vi.fn(),
        }
        const mockCategoryManager = {}
        const mockBudgetManager = {
            loadBudget: vi.fn(async () => {}),
            getBudgetStatus: vi.fn(async () => { throw new Error('Budget error') }),
        }

        await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

        // Even though budget threw, updateWidgetData should still have been called
        // with default budget values
        expect(mockUpdateWidgetData).toHaveBeenCalledTimes(1)
        const callArg = mockUpdateWidgetData.mock.calls[0][0]
        expect(callArg.budgetProgressText).toBe('無預算限制')
        expect(callArg.budgetProgressVal).toBe(0)
    })

    it('should include budget data when getBudgetStatus succeeds', async () => {
        const { updateAndroidWidget } = await import('../../src/js/widgetHelper.js')

        const mockDataService = {
            db: {},
            activeLedgerId: 1,
            getRecords: vi.fn(async () => [
                { date: '2026-07-16', type: 'expense', amount: 300 },
            ]),
            getStatistics: vi.fn(),
        }
        const mockCategoryManager = {}
        const mockBudgetManager = {
            loadBudget: vi.fn(async () => {}),
            getBudgetStatus: vi.fn(async () => ({
                budget: 10000,
                spent: 3000,
                percentage: 30,
                categoryStatuses: [],
            })),
        }

        await updateAndroidWidget(mockDataService, mockCategoryManager, mockBudgetManager)

        expect(mockUpdateWidgetData).toHaveBeenCalledTimes(1)
        const callArg = mockUpdateWidgetData.mock.calls[0][0]
        expect(callArg.budgetProgressText).toContain('30%')
        expect(callArg.budgetProgressVal).toBe(30)
    })
})

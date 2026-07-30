// ==================== processRecurringTransactions 單元測試 ====================
// 測試重點：跨裝置去重（P01 修復）、recurringTransactionUuid 標記、日期推進

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────

vi.mock('../../src/js/utils.js', () => {
    const formatDateToStringFn = vi.fn(d => {
        if (typeof d === 'string') return d
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
    })

    return {
        formatDateToString: formatDateToStringFn,
        showToast: vi.fn(),
        customConfirm: vi.fn(() => Promise.resolve(true)),
        customAlert: vi.fn(),
        calculateNextDueDate: vi.fn((currentDate, frequency, interval) => {
            const d = new Date(currentDate)
            if (frequency === 'daily') d.setDate(d.getDate() + interval)
            else if (frequency === 'weekly') d.setDate(d.getDate() + interval * 7)
            else if (frequency === 'monthly') d.setMonth(d.getMonth() + interval)
            else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + interval)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            return `${y}-${m}-${day}`
        }),
        shouldSkipDate: vi.fn(() => false),
        formatCurrency: vi.fn(n => `$${n}`),
    }
})

vi.mock('idb', () => ({
    openDB: vi.fn(),
    deleteDB: vi.fn(),
}))

// Mock main.js imports
const { calculateNextDueDate, shouldSkipDate, formatDateToString } =
    await import('../../src/js/utils.js')

// ── Helpers ──────────────────────────────────────────

/** 建立 mock DataService */
function createMockDataService(overrides = {}) {
    return {
        db: {
            getAll: vi.fn(async store => {
                if (store === 'records') return overrides.records || []
                if (store === 'ledgers') return overrides.ledgers || []
                return []
            }),
        },
        getRecurringTransactions: vi.fn(async () => overrides.recurringTxs || []),
        addRecord: vi.fn(async () => overrides.addRecordResult ?? 1),
        updateRecurringTransaction: vi.fn(async () => true),
        ...overrides,
    }
}

/** 建立 mock App 實例（只含 processRecurringTransactions） */
function createMockApp(ds) {
    return {
        dataService: ds,
        processRecurringTransactions: async function () {
            // Inline the logic from main.js for testing
            const today = formatDateToString(new Date())
            const recurringTxs =
                await this.dataService.getRecurringTransactions({
                    allLedgers: true,
                })

            const MAX_ITERATIONS = 24

            for (const tx of recurringTxs) {
                try {
                    let { nextDueDate } = tx

                    let iterations = 0

                    while (
                        nextDueDate &&
                        nextDueDate <= today &&
                        iterations < MAX_ITERATIONS
                    ) {
                        iterations++
                        const dateToCheck = new Date(nextDueDate)

                        if (shouldSkipDate(dateToCheck, tx.skipRules)) {
                            nextDueDate = calculateNextDueDate(
                                nextDueDate,
                                tx.frequency,
                                tx.interval
                            )
                            continue
                        }

                        // P01 修復：跨裝置去重
                        let alreadyFired = false
                        if (tx.uuid) {
                            try {
                                const allRecords = await this.dataService.db.getAll(
                                    'records'
                                )
                                alreadyFired = allRecords.some(
                                    r =>
                                        r.recurringTransactionUuid ===
                                            tx.uuid &&
                                        r.date === nextDueDate
                                )
                            } catch (_) {
                                nextDueDate = calculateNextDueDate(
                                    nextDueDate,
                                    tx.frequency,
                                    tx.interval
                                )
                                continue
                            }
                        }

                        if (alreadyFired) {
                            nextDueDate = calculateNextDueDate(
                                nextDueDate,
                                tx.frequency,
                                tx.interval
                            )
                            continue
                        }

                        const newRecord = {
                            type: tx.type,
                            amount: tx.amount,
                            category: tx.category,
                            description: tx.description,
                            date: nextDueDate,
                            accountId: tx.accountId,
                            ledgerId: tx.ledgerId,
                            recurringTransactionUuid: tx.uuid || null,
                        }
                        await this.dataService.addRecord(newRecord)

                        nextDueDate = calculateNextDueDate(
                            nextDueDate,
                            tx.frequency,
                            tx.interval
                        )
                    }

                    if (nextDueDate !== tx.nextDueDate) {
                        await this.dataService.updateRecurringTransaction(
                            tx.id,
                            { nextDueDate }
                        )
                    }
                } catch (error) {
                    // silently skip
                }
            }
        },
    }
}

// ── 測試 ─────────────────────────────────────────────

describe('processRecurringTransactions', () => {
    let app, ds

    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ── P01: Cross-device dedup ────────────────────
    describe('P01: 跨裝置去重', () => {
        it('已存在相同 recurringTransactionUuid + date 的紀錄時，不重複建立', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [
                    {
                        id: 10,
                        date: '2026-08-01',
                        recurringTransactionUuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                    },
                ],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // 不應再建立新紀錄
            expect(ds.addRecord).not.toHaveBeenCalled()
            // 但仍推進 nextDueDate
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-09-01',
            })
        })

        it('紀錄存在但 recurringTransactionUuid 不匹配時，正常建立', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [
                    {
                        id: 10,
                        date: '2026-08-01',
                        recurringTransactionUuid: 'rt-uuid-999', // 不同 UUID
                        type: 'expense',
                        amount: 100,
                    },
                ],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // 應該建立新紀錄
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    recurringTransactionUuid: 'rt-uuid-001',
                    date: '2026-08-01',
                })
            )
        })

        it('沒有既有紀錄時，正常建立新紀錄', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [], // 空
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    recurringTransactionUuid: 'rt-uuid-001',
                    date: '2026-08-01',
                    amount: 100,
                })
            )
        })
    })

    // ── recurringTransactionUuid 標記 ───────────────
    describe('recurringTransactionUuid 標記', () => {
        it('新紀錄帶有 recurringTransactionUuid', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            const recordArg = ds.addRecord.mock.calls[0][0]
            expect(recordArg.recurringTransactionUuid).toBe('rt-uuid-001')
        })

        it('沒有 UUID 的舊交易標記為 null', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        // 沒有 uuid — 舊資料
                        type: 'expense',
                        amount: 50,
                        category: 'Transport',
                        description: 'Bus Pass',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 2,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            const recordArg = ds.addRecord.mock.calls[0][0]
            expect(recordArg.recurringTransactionUuid).toBe(null)
        })
    })

    // ── 多期補發去重 ────────────────────────────────
    describe('多期補發去重', () => {
        it('3 期中有 2 期已被其他裝置產生，只補發 1 期', async () => {
            const today = '2026-08-15'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Weekly Meal',
                        nextDueDate: '2026-08-01',
                        frequency: 'weekly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [
                    {
                        // Device A 已產生 08/01
                        date: '2026-08-01',
                        recurringTransactionUuid: 'rt-uuid-001',
                    },
                    {
                        // Device A 已產生 08/08
                        date: '2026-08-08',
                        recurringTransactionUuid: 'rt-uuid-001',
                    },
                    // 08/15 尚未被任何裝置產生
                ],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // 應該只建立 1 筆紀錄（08/15）
            expect(ds.addRecord).toHaveBeenCalledTimes(1)
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    date: '2026-08-15',
                    recurringTransactionUuid: 'rt-uuid-001',
                })
            )
            // nextDueDate 推進到 08/22
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-08-22',
            })
        })
    })

    // ── nextDueDate 推進 ────────────────────────────
    describe('nextDueDate 推進', () => {
        it('跳過的期間仍推進 nextDueDate', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [
                    // 已被產生
                    {
                        date: '2026-08-01',
                        recurringTransactionUuid: 'rt-uuid-001',
                    },
                ],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // nextDueDate 仍被推進
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-09-01',
            })
        })

        it('沒有需要處理的交易時不更新', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Future',
                        nextDueDate: '2027-01-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            expect(ds.addRecord).not.toHaveBeenCalled()
            expect(ds.updateRecurringTransaction).not.toHaveBeenCalled()
        })
    })

    // ── db 訪問失敗 fallback ───────────────────────
    describe('db 訪問失敗 fallback', () => {
        it('當 db.getAll("records") 拋錯時，應跳過該期並推進 nextDueDate（而非崩潰）', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Monthly',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
            })
            // Make getAll throw for 'records'
            ds.db.getAll = vi.fn(async (store) => {
                if (store === 'records') throw new Error('DB failure')
                return []
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Should not create a record since it couldn't verify dedup
            expect(ds.addRecord).not.toHaveBeenCalled()
            // Should still advance nextDueDate
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-09-01',
            })
        })
    })
})
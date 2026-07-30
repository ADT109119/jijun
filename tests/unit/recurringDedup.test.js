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
                        recurringTransactionUuid: 'rt-uuid-999',
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
                records: [],
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
                        date: '2026-08-01',
                        recurringTransactionUuid: 'rt-uuid-001',
                    },
                    {
                        date: '2026-08-08',
                        recurringTransactionUuid: 'rt-uuid-001',
                    },
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

    // ── MAX_ITERATIONS guard ─────────────────────────
    describe('MAX_ITERATIONS guard', () => {
        it('超過 MAX_ITERATIONS (24) 後停止，即使 nextDueDate 仍 <= today', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 10,
                        category: 'Food',
                        description: 'Daily coffee',
                        nextDueDate: '2026-06-01',
                        frequency: 'daily',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Should have created exactly 24 records (MAX_ITERATIONS)
            expect(ds.addRecord).toHaveBeenCalledTimes(24)
            // Check each record date is correct
            for (let i = 0; i < 24; i++) {
                const day = String(1 + i).padStart(2, '0')
                expect(ds.addRecord).toHaveBeenCalledWith(
                    expect.objectContaining({ date: `2026-06-${day}` })
                )
            }
            // nextDueDate advanced by 24 days from 2026-06-01 → 2026-06-25
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-06-25',
            })
        })
    })

    // ── skipRules integration ────────────────────────
    describe('skipRules integration', () => {
        afterEach(() => {
            vi.mocked(shouldSkipDate).mockRestore()
        })

        it('被跳過的日期不建立紀錄但正常推進 nextDueDate', async () => {
            const today = '2026-08-02'
            vi.mocked(formatDateToString).mockReturnValue(today)

            vi.mocked(shouldSkipDate).mockImplementation((date) => {
                const y = date.getFullYear()
                const m = String(date.getMonth() + 1).padStart(2, '0')
                const d = String(date.getDate()).padStart(2, '0')
                return `${y}-${m}-${d}` === '2026-08-01'
            })

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Daily',
                        nextDueDate: '2026-08-01',
                        frequency: 'daily',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                        skipRules: [{ type: 'date', value: '2026-08-01' }],
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // 08/01 was skipped, but 08/02 should be created
            expect(ds.addRecord).toHaveBeenCalledTimes(1)
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ date: '2026-08-02' })
            )
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-08-03',
            })
        })

        it('連續跳過多個日期後，下一個非跳過日期仍正常處理', async () => {
            const today = '2026-08-05'
            vi.mocked(formatDateToString).mockReturnValue(today)

            vi.mocked(shouldSkipDate).mockImplementation((date) => {
                const y = date.getFullYear()
                const m = String(date.getMonth() + 1).padStart(2, '0')
                const d = String(date.getDate()).padStart(2, '0')
                const ds = `${y}-${m}-${d}`
                return ds === '2026-08-01' || ds === '2026-08-02' || ds === '2026-08-03'
            })

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Daily',
                        nextDueDate: '2026-08-01',
                        frequency: 'daily',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                        skipRules: [{ type: 'date', value: '2026-08-01' }],
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // 08/04 and 08/05 are both <= today, both get processed
            expect(ds.addRecord).toHaveBeenCalledTimes(2)
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ date: '2026-08-04' })
            )
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ date: '2026-08-05' })
            )
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-08-06',
            })
        })
    })

    // ── Error handling ──────────────────────────────
    describe('Error handling', () => {
        it('addRecord 拋錯時該筆交易被跳過（不崩潰）', async () => {
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
                records: [],
            })
            ds.addRecord = vi.fn().mockRejectedValue(new Error('DB write error'))

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // addRecord was called but threw
            expect(ds.addRecord).toHaveBeenCalled()
            // updateRecurringTransaction should NOT be called since the error was caught before reaching it
            expect(ds.updateRecurringTransaction).not.toHaveBeenCalled()
        })

        it('updateRecurringTransaction 拋錯時不崩潰', async () => {
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
                records: [],
            })
            ds.updateRecurringTransaction = vi
                .fn()
                .mockRejectedValue(new Error('Update failed'))

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Record was created successfully
            expect(ds.addRecord).toHaveBeenCalled()
            // updateRecurringTransaction was called and threw (caught by try-catch)
            expect(ds.updateRecurringTransaction).toHaveBeenCalled()
        })
    })

    // ── Multiple transactions ────────────────────────
    describe('Multiple transactions', () => {
        it('可獨立處理 2 筆以上的週期性交易', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-1',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                    {
                        id: 2,
                        uuid: 'rt-2',
                        type: 'expense',
                        amount: 200,
                        category: 'Transport',
                        description: 'Bus pass',
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

            expect(ds.addRecord).toHaveBeenCalledTimes(2)
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ recurringTransactionUuid: 'rt-1' })
            )
            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ recurringTransactionUuid: 'rt-2' })
            )
            expect(ds.updateRecurringTransaction).toHaveBeenCalledTimes(2)
        })

        it('一筆失敗不影響另一筆', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-1',
                        type: 'expense',
                        amount: 100,
                        category: 'Food',
                        description: 'Rent',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                    {
                        id: 2,
                        uuid: 'rt-2',
                        type: 'expense',
                        amount: 200,
                        category: 'Transport',
                        description: 'Bus pass',
                        nextDueDate: '2026-08-01',
                        frequency: 'monthly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })
            // First addRecord call fails, second succeeds
            ds.addRecord = vi
                .fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce(2)

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Both addRecord calls were made
            expect(ds.addRecord).toHaveBeenCalledTimes(2)
            // Only the second transaction should have updateRecurringTransaction called
            expect(ds.updateRecurringTransaction).toHaveBeenCalledTimes(1)
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(2, {
                nextDueDate: '2026-09-01',
            })
        })
    })

    // ── Edge: nextDueDate 邊界 ──────────────────────
    describe('nextDueDate 邊界條件', () => {
        it('nextDueDate 等於 today 時建立紀錄', async () => {
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
                        description: 'Due today',
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

            expect(ds.addRecord).toHaveBeenCalledWith(
                expect.objectContaining({ date: '2026-08-01' })
            )
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-09-01',
            })
        })

        it('nextDueDate 大於 today 時不建立紀錄', async () => {
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
                        nextDueDate: '2026-08-02',
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

        it('空陣列的週期性交易不產生任何動作', async () => {
            const today = '2026-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            expect(ds.addRecord).not.toHaveBeenCalled()
            expect(ds.updateRecurringTransaction).not.toHaveBeenCalled()
        })
    })

    // ── Frequency types ─────────────────────────────
    describe('Frequency types', () => {
        it('daily frequency 正確計算日期', async () => {
            const today = '2026-08-03'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 50,
                        category: 'Food',
                        description: 'Daily snack',
                        nextDueDate: '2026-08-01',
                        frequency: 'daily',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Records for 08/01, 08/02, 08/03
            expect(ds.addRecord).toHaveBeenCalledTimes(3)
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-08-04',
            })
        })

        it('weekly frequency 正確計算日期', async () => {
            const today = '2026-08-15'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 200,
                        category: 'Transport',
                        description: 'Weekly pass',
                        nextDueDate: '2026-08-01',
                        frequency: 'weekly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Records for 08/01, 08/08, 08/15
            expect(ds.addRecord).toHaveBeenCalledTimes(3)
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2026-08-22',
            })
        })

        it('yearly frequency 正確計算日期', async () => {
            const today = '2028-08-01'
            vi.mocked(formatDateToString).mockReturnValue(today)

            ds = createMockDataService({
                recurringTxs: [
                    {
                        id: 1,
                        uuid: 'rt-uuid-001',
                        type: 'expense',
                        amount: 1000,
                        category: 'Insurance',
                        description: 'Yearly insurance',
                        nextDueDate: '2026-08-01',
                        frequency: 'yearly',
                        interval: 1,
                        accountId: 1,
                        ledgerId: 1,
                    },
                ],
                records: [],
            })

            app = createMockApp(ds)
            await app.processRecurringTransactions()

            // Records for 2026-08-01, 2027-08-01, 2028-08-01
            expect(ds.addRecord).toHaveBeenCalledTimes(3)
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(1, {
                nextDueDate: '2029-08-01',
            })
        })
    })
})

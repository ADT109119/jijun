import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddPage } from '../../src/js/pages/addPage.js'

/**
 * 餘額不足提醒 (Low Balance Warning)
 * 覆蓋：getLowBalanceWarning 純邏輯（一般帳戶透支 / 信用卡超額 / 邊界）
 *      + _checkLowBalanceWarning 整合（記帳前計算預計餘額、開關/型別/邊界 guard）
 */

const makeWallet = (balance) => ({
    id: 1,
    name: '現金',
    type: 'wallet',
    balance,
})
const makeCreditCard = (creditLimit) => ({
    id: 3,
    name: '信用卡',
    type: 'credit_card',
    balance: 0,
    creditLimit,
})

describe('AddPage - 餘額不足提醒 (Low Balance Warning)', () => {
    let app
    let addPage
    let getSetting
    let getAccount
    let calcBalance
    let getDebt

    beforeEach(() => {
        document.body.innerHTML = ''
        getSetting = vi.fn().mockResolvedValue({ value: true })
        getAccount = vi.fn().mockResolvedValue(null)
        calcBalance = vi.fn().mockResolvedValue(0)
        getDebt = vi.fn().mockResolvedValue(null)
        app = {
            aiService: {},
            dataService: {
                activeLedgerId: 1,
                getSetting,
                getAccount,
                getDebt,
                calculateAccountCurrentBalance: calcBalance,
            },
        }
        addPage = new AddPage(app)
    })

    describe('getLowBalanceWarning (純邏輯)', () => {
        describe('一般帳戶 (wallet)', () => {
            it('餘額為正時不警示', () => {
                expect(addPage.getLowBalanceWarning(makeWallet(5000), 5000)).toBeNull()
            })

            it('餘額剛好為 0 時不警示（未透支）', () => {
                expect(addPage.getLowBalanceWarning(makeWallet(0), 0)).toBeNull()
            })

            it('餘額轉為負值（透支）時警示，訊息含帳戶名與「餘額不足」', () => {
                const msg = addPage.getLowBalanceWarning(makeWallet(-100), -100)
                expect(msg).toContain('現金')
                expect(msg).toContain('餘額不足')
            })
        })

        describe('信用卡 (credit_card)', () => {
            it('欠款未超額（額度內）時不警示（餘額為負屬正常刷卡）', () => {
                // 額度 10000，欠款 3000（餘額 -3000）→ 未超額
                expect(
                    addPage.getLowBalanceWarning(makeCreditCard(10000), -3000)
                ).toBeNull()
            })

            it('欠款等於額度時不警示（未超出）', () => {
                // 額度 10000，欠款 10000（餘額 -10000）→ 等於未超出
                expect(
                    addPage.getLowBalanceWarning(makeCreditCard(10000), -10000)
                ).toBeNull()
            })

            it('欠款超出額度時警示，訊息含帳戶名與「超出信用卡額度」', () => {
                const msg = addPage.getLowBalanceWarning(makeCreditCard(10000), -12000)
                expect(msg).toContain('信用卡')
                expect(msg).toContain('超出信用卡額度')
            })

            it('未設定額度（creditLimit 0）時不警示（無法判斷）', () => {
                expect(
                    addPage.getLowBalanceWarning(makeCreditCard(0), -50000)
                ).toBeNull()
            })

            it('餘額為正（超繳）時不警示', () => {
                expect(
                    addPage.getLowBalanceWarning(makeCreditCard(10000), 2000)
                ).toBeNull()
            })
        })

        describe('邊界與防護', () => {
            it('account 為 null 時回傳 null', () => {
                expect(addPage.getLowBalanceWarning(null, -100)).toBeNull()
            })

            it('balance 為 NaN 時回傳 null', () => {
                expect(addPage.getLowBalanceWarning(makeWallet(-100), NaN)).toBeNull()
            })

            it('balance 為 Infinity 時回傳 null', () => {
                expect(
                    addPage.getLowBalanceWarning(makeWallet(-100), -Infinity)
                ).toBeNull()
            })
        })
    })

    describe('_checkLowBalanceWarning (整合)', () => {
        it('recordType 非 expense 時直接回傳 null（不查設定/帳戶/餘額）', async () => {
            const msg = await addPage._checkLowBalanceWarning('income', 1, 100)
            expect(msg).toBeNull()
            expect(getSetting).not.toHaveBeenCalled()
            expect(getAccount).not.toHaveBeenCalled()
            expect(calcBalance).not.toHaveBeenCalled()
        })

        it('accountId 為 null 時回傳 null（非多帳戶模式）', async () => {
            const msg = await addPage._checkLowBalanceWarning('expense', null, 100)
            expect(msg).toBeNull()
            expect(getSetting).not.toHaveBeenCalled()
        })

        it('accountId 為 0 時回傳 null（無效 id）', async () => {
            const msg = await addPage._checkLowBalanceWarning('expense', 0, 100)
            expect(msg).toBeNull()
            expect(getSetting).not.toHaveBeenCalled()
        })

        it('amount 為 NaN 時回傳 null', async () => {
            const msg = await addPage._checkLowBalanceWarning('expense', 1, NaN)
            expect(msg).toBeNull()
            expect(getSetting).not.toHaveBeenCalled()
        })

        it('開關未啟用時回傳 null（不查帳戶/餘額）', async () => {
            getSetting.mockResolvedValue({ value: false })
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 100)
            expect(msg).toBeNull()
            expect(getAccount).not.toHaveBeenCalled()
            expect(calcBalance).not.toHaveBeenCalled()
        })

        it('設定不存在（null）時回傳 null', async () => {
            getSetting.mockResolvedValue(null)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 100)
            expect(msg).toBeNull()
        })

        it('帳戶不存在時回傳 null（不查餘額）', async () => {
            getAccount.mockResolvedValue(null)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 100)
            expect(msg).toBeNull()
            expect(calcBalance).not.toHaveBeenCalled()
        })

        it('一般帳戶：記帳前餘額扣本筆支出後轉負 → 警示（驗證記帳前計算，非雙重計入）', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500) // 記帳前餘額
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800)
            // projected = 500 - 800 = -300 → 透支
            expect(msg).toContain('現金')
            expect(msg).toContain('餘額不足')
        })

        it('一般帳戶：記帳前餘額扣本筆支出後仍為正 → 不警示', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(1000) // 記帳前餘額
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800)
            // projected = 1000 - 800 = 200 → 未透支
            expect(msg).toBeNull()
        })

        it('信用卡：記帳後欠款超出額度 → 警示', async () => {
            getAccount.mockResolvedValue(makeCreditCard(10000))
            calcBalance.mockResolvedValue(-9500) // 記帳前欠款 9500
            const msg = await addPage._checkLowBalanceWarning('expense', 3, 2000)
            // projected = -9500 - 2000 = -11500 → 欠款 11500 > 額度 10000
            expect(msg).toContain('信用卡')
            expect(msg).toContain('超出信用卡額度')
        })

        it('dataService 呼叫拋錯時靜默回傳 null（不影響記帳）', async () => {
            getSetting.mockRejectedValue(new Error('DB error'))
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 100)
            expect(msg).toBeNull()
        })

        it('他人代墊（payable 欠款啟用）時跳過餘額不足檢查', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(100)
            addPage.debtEnabled = true
            addPage.debtContactId = 2
            addPage.debtType = 'payable'
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800)
            expect(msg).toBeNull()
            expect(getSetting).not.toHaveBeenCalled()
            expect(calcBalance).not.toHaveBeenCalled()
        })
    })

    describe('編輯模式接線（editContext 排除舊紀錄雙重計入）', () => {
        const oldExpense = (amount, opts = {}) => ({
            id: 7,
            type: 'expense',
            amount,
            accountId: 1,
            category: 'food',
            debtId: null,
            ...opts,
        })

        it('同帳戶改小金額：餘額已含舊紀錄 → 排除後不誤警示', async () => {
            // 情境：餘額 500（已含舊支出 800），編輯把 800 改成 300
            // 未排除時 projected = 500 - 300 = 200（不警示，湊巧正確）
            // 用會誤警示的數字：餘額 -200（已含舊 800），改成 500
            // 正確：projected = -200 - (-800) - 500 = 100 → 不警示
            getAccount.mockResolvedValue(makeWallet(1000))
            calcBalance.mockResolvedValue(-200)
            const msg = await addPage._checkLowBalanceWarning(
                'expense',
                1,
                500,
                { record: oldExpense(800) }
            )
            expect(msg).toBeNull()
        })

        it('同帳戶改小金額仍透支 → 仍正確警示（排除後仍為負）', async () => {
            // 餘額 -200（含舊支出 800），改成 700：
            // projected = -200 + 800 - 700 = -100 → 透支警示
            getAccount.mockResolvedValue(makeWallet(1000))
            calcBalance.mockResolvedValue(-200)
            const msg = await addPage._checkLowBalanceWarning(
                'expense',
                1,
                700,
                { record: oldExpense(800) }
            )
            expect(msg).toContain('餘額不足')
        })

        it('不傳 editContext（新增模式）：行為與舊版一致（不减舊紀錄）', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(1000)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800)
            // projected = 1000 - 800 = 200 → 不警示
            expect(msg).toBeNull()
            expect(getDebt).not.toHaveBeenCalled()
        })

        it('editContext.record 為 null（新增模式）：不補回', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800, {
                record: null,
            })
            // projected = 500 - 0 - 800 = -300 → 警示
            expect(msg).toContain('餘額不足')
        })

        it('換帳戶編輯（舊紀錄在別帳戶）：不補回舊紀錄影響', async () => {
            // 舊紀錄在帳戶 2，本筆寫入帳戶 1 → oldNet=0
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500)
            const old = oldExpense(800, { accountId: 2 })
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800, {
                record: old,
            })
            // projected = 500 - 0 - 800 = -300 → 警示（帳戶 1 未含舊紀錄）
            expect(msg).toContain('餘額不足')
        })

        it('舊紀錄 accountId 為 null（非多帳戶模式資料）：不補回', async () => {
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800, {
                record: oldExpense(800, { accountId: null }),
            })
            expect(msg).toContain('餘額不足')
        })

        it('編輯收入紀錄改支出：income 舊紀錄補回為正值影響', async () => {
            // 舊紀錄 income 300（計入餘額 +300），現改成 expense 200
            // 餘額 100（含 +300）→ projected = 100 - 300 - 200 = -400 → 警示
            getAccount.mockResolvedValue(makeWallet(1000))
            calcBalance.mockResolvedValue(100)
            const msg = await addPage._checkLowBalanceWarning(
                'expense',
                1,
                200,
                { record: { ...oldExpense(300), type: 'income' } }
            )
            expect(msg).toContain('餘額不足')
        })

        it('舊紀錄是 payable 欠款原始紀錄：餘額未含它 → 不補回', async () => {
            getDebt.mockResolvedValue({ id: 9, type: 'payable' })
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800, {
                record: oldExpense(800, { debtId: 9 }),
            })
            // projected = 500 - 0 - 800 = -300 → 警示（payable 原始紀錄影響視同 0）
            expect(msg).toContain('餘額不足')
            expect(getDebt).toHaveBeenCalledWith(9)
        })

        it('舊紀錄是 receivable 欠款原始紀錄：有計入餘額 → 正常補回', async () => {
            // receivable 支出紀錄計入餘額 -800，改成 300：
            // projected = -200 + 800 - 300 = 300 → 不警示
            getDebt.mockResolvedValue({ id: 9, type: 'receivable' })
            getAccount.mockResolvedValue(makeWallet(1000))
            calcBalance.mockResolvedValue(-200)
            const msg = await addPage._checkLowBalanceWarning(
                'expense',
                1,
                300,
                { record: oldExpense(800, { debtId: 9 }) }
            )
            expect(msg).toBeNull()
        })

        it('payable 判定查詢失敗：保守不補回（靜默 0）', async () => {
            getDebt.mockRejectedValue(new Error('DB error'))
            getAccount.mockResolvedValue(makeWallet(5000))
            calcBalance.mockResolvedValue(500)
            const msg = await addPage._checkLowBalanceWarning('expense', 1, 800, {
                record: oldExpense(800, { debtId: 9 }),
            })
            // 保守：不補回 → projected = 500 - 0 - 800 = -300 → 警示
            expect(msg).toContain('餘額不足')
        })

        it('信用卡編輯改小金額：排除舊紀錄後不再超額則不警示', async () => {
            // 額度 10000，目前欠款 11000（含舊刷卡 5000），改成 3000：
            // projected = -11000 + 5000 - 3000 = -9000 → 欠款 9000 未超額
            getAccount.mockResolvedValue(makeCreditCard(10000))
            calcBalance.mockResolvedValue(-11000)
            const msg = await addPage._checkLowBalanceWarning(
                'expense',
                3,
                3000,
                { record: oldExpense(5000, { accountId: 3 }) }
            )
            expect(msg).toBeNull()
        })
    })
})

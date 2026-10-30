import { describe, it, expect, beforeEach } from 'vitest'
import DataService from '../../src/js/dataService.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('信用卡「即時消費」與「出帳明細」功能測試', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
    })

    describe('getCreditCardBillingInfo', () => {
        it('非信用卡帳戶回傳 null', async () => {
            const accId = await ds.addAccount({
                name: '現金皮夾',
                type: 'wallet',
                balance: 1000,
            })
            const info = await ds.getCreditCardBillingInfo(accId)
            expect(info).toBeNull()
        })

        it('未達出帳日時，正確劃分即時未出帳週期與統計金額', async () => {
            // 結帳日 25 日，參考日期 2026-10-05 (5 <= 25)
            // 未出帳週期應為 2026-09-26 ~ 2026-10-25
            const cardId = await ds.addAccount({
                name: '國泰CUBE卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 15,
                creditLimit: 50000,
                balance: 0,
            })

            // 建立歷史已結帳交易 (2026-09-20)
            await ds.addRecord({
                type: 'expense',
                amount: 3000,
                date: '2026-09-20',
                accountId: cardId,
                description: '前期消費',
            })

            // 建立本期未出帳交易 (2026-09-28, 2026-10-02)
            await ds.addRecord({
                type: 'expense',
                amount: 1200,
                date: '2026-09-28',
                accountId: cardId,
                description: '未出帳消費A',
            })
            await ds.addRecord({
                type: 'expense',
                amount: 800,
                date: '2026-10-02',
                accountId: cardId,
                description: '未出帳消費B',
            })
            // 建立一筆退款 (收入)
            await ds.addRecord({
                type: 'income',
                amount: 200,
                date: '2026-10-03',
                accountId: cardId,
                description: '未出帳刷退',
            })

            // 建立一筆未繳帳單 (前期 2026-09 期)
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-08',
                statementDate: new Date(2026, 8, 25).getTime(),
                dueDate: new Date(2026, 9, 15).getTime(),
                amount: 3000,
                status: 'unpaid',
                ledgerId: 1,
            })

            const refDate = new Date(2026, 9, 5) // 2026-10-05
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)

            expect(info).not.toBeNull()
            expect(info.unbilledPeriod.startStr).toBe('2026-09-26')
            expect(info.unbilledPeriod.endStr).toBe('2026-10-25')
            expect(info.unbilledRecords).toHaveLength(3) // 2 expense + 1 income
            expect(info.unbilledExpense).toBe(2000) // 1200 + 800
            expect(info.unbilledRepayment).toBe(200)
            expect(info.unbilledTotal).toBe(1800) // 2000 - 200

            // 準備繳納帳單驗證
            expect(info.billedDueTotal).toBe(3000)
            expect(info.unpaidStatements).toHaveLength(1)
            expect(info.nextDueDate).toBe(new Date(2026, 9, 15).getTime())

            // 總欠款與可用額度
            // 總支出 3000 + 1200 + 800 = 5000，收入 200，總欠款 = 4800
            expect(info.totalDebt).toBe(4800)
            expect(info.availableCredit).toBe(50000 - 4800)
        })

        it('已過出帳日時，正確推進到下個未出帳週期', async () => {
            // 結帳日 25 日，參考日期 2026-10-28 (28 > 25)
            // 未出帳週期應為 2026-10-26 ~ 2026-11-25
            const cardId = await ds.addAccount({
                name: '富邦J卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 10,
                creditLimit: 30000,
            })

            await ds.addRecord({
                type: 'expense',
                amount: 500,
                date: '2026-10-27',
                accountId: cardId,
                description: '過結帳日後的新消費',
            })

            const refDate = new Date(2026, 9, 28) // 2026-10-28
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)

            expect(info.unbilledPeriod.startStr).toBe('2026-10-26')
            expect(info.unbilledPeriod.endStr).toBe('2026-11-25')
            expect(info.unbilledTotal).toBe(500)
            expect(info.unbilledRecords).toHaveLength(1)
        })
    })

    describe('getStatementRecords', () => {
        it('精確回傳該期帳單起訖日內的明細紀錄', async () => {
            const cardId = await ds.addAccount({
                name: '玉山Ubear',
                type: 'credit_card',
                statementDay: 20,
            })

            // 假設 period = '2026-05' (依 getStatementPeriod 算法: 2026-05-21 ~ 2026-06-20)
            await ds.addRecord({
                type: 'expense',
                amount: 100,
                date: '2026-05-20', // 前期，不應包含
                accountId: cardId,
            })
            await ds.addRecord({
                type: 'expense',
                amount: 250,
                date: '2026-05-25', // 本期包含
                accountId: cardId,
                description: '晚餐',
            })
            await ds.addRecord({
                type: 'expense',
                amount: 450,
                date: '2026-06-15', // 本期包含
                accountId: cardId,
                description: '加油',
            })
            await ds.addRecord({
                type: 'expense',
                amount: 800,
                date: '2026-06-22', // 次期，不應包含
                accountId: cardId,
            })

            const records = await ds.getStatementRecords(cardId, '2026-05')
            expect(records).toHaveLength(2)
            expect(records[0].amount).toBe(450) // 新到舊排序
            expect(records[1].amount).toBe(250)
        })
    })

    describe('getStatementPeriod 月底溢位保護', () => {
        it('遇短月如2月時，不溢位到3月', () => {
            const card = { statementDay: 31 }
            // period '2026-01' 的計費區間為 1月到2月，結束於 2 月
            // 2026 年 2 月只有 28 天
            const { startDate, endDate } = ds.getStatementPeriod(card, '2026-01')
            // endDate 應為 2 月最後一天 (2026-02-28)，不應溢位到 3 月
            expect(endDate.getFullYear()).toBe(2026)
            expect(endDate.getMonth()).toBe(1) // 2月 (0-indexed 為 1)
            expect(endDate.getDate()).toBe(28)
        })
    })

    describe('getCreditCardBillingInfo 結帳日邊界與月底收斂 (#CREDIT-UNBILLED)', () => {
        it('statementDay=31 遇 2 月：未出帳週期收斂到月底，不溢位到 3 月', async () => {
            // 31 日出帳卡，2026-02-15 尚未結帳（2 月有效結帳日 = 2/28）
            // 未出帳週期應為 2026-02-01 ~ 2026-02-28（舊版 endStr 會溢出成 2026-03-03，
            // 與 getStatementPeriod 已收斂的帳單週期錯開，造成消費重複列示）
            const cardId = await ds.addAccount({
                name: '31日出帳卡',
                type: 'credit_card',
                statementDay: 31,
                dueDay: 15,
                balance: 0,
            })
            const refDate = new Date(2026, 1, 15) // 2026-02-15
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)
            expect(info.unbilledPeriod.startStr).toBe('2026-02-01')
            expect(info.unbilledPeriod.endStr).toBe('2026-02-28')
            expect(info.unbilledPeriod.lastStatementEndStr).toBe('2026-01-31')
            // 距結帳天數以收斂後的 2/28 為基準（2/15 → 13 天）
            expect(info.daysUntilStatement).toBe(13)
        })

        it('statementDay=31 已過月底結帳日：未出帳從 3/1 起算到下月 3/31 收斂', async () => {
            // 2026-03-05，31 日出帳卡：本月有效結帳日 3/31 未到，
            // 上期已於 2/28（月底收斂）結帳 → 未出帳 2026-03-01 ~ 2026-03-31
            const cardId = await ds.addAccount({
                name: '31日出帳卡B',
                type: 'credit_card',
                statementDay: 31,
                dueDay: 15,
                balance: 0,
            })
            const refDate = new Date(2026, 2, 5) // 2026-03-05
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)
            expect(info.unbilledPeriod.startStr).toBe('2026-03-01')
            expect(info.unbilledPeriod.endStr).toBe('2026-03-31')
            expect(info.unbilledPeriod.lastStatementEndStr).toBe('2026-02-28')
        })

        it('結帳日當天消費歸屬已結帳帳單，不重複列於即時未出帳', async () => {
            // 25 日出帳卡，2026-10-25 當天：autoGenerateCreditStatements 以
            // now.getDate() >= statementDay 判斷已結帳（當日消費已入該期帳單），
            // 故未出帳週期應從 10/26 起算，當日消費不得同時出現在未出帳清單
            const cardId = await ds.addAccount({
                name: '25日出帳卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 10,
                balance: 0,
            })
            await ds.addRecord({
                type: 'expense',
                amount: 600,
                date: '2026-10-25', // 結帳日當天消費 → 屬 2026-09 期帳單
                accountId: cardId,
                description: '結帳日當天刷卡',
            })
            await ds.addRecord({
                type: 'expense',
                amount: 900,
                date: '2026-10-26', // 隔天消費 → 屬下期未出帳
                accountId: cardId,
                description: '結帳日隔天刷卡',
            })
            const refDate = new Date(2026, 9, 25) // 2026-10-25
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)
            expect(info.unbilledPeriod.startStr).toBe('2026-10-26')
            expect(info.unbilledPeriod.endStr).toBe('2026-11-25')
            expect(info.unbilledRecords).toHaveLength(1)
            expect(info.unbilledTotal).toBe(900)
        })

        it('結帳日 31 日跨年底界：12/31 已結帳，未出帳正確進位到隔年 1 月', async () => {
            const cardId = await ds.addAccount({
                name: '跨年31日卡',
                type: 'credit_card',
                statementDay: 31,
                dueDay: 15,
                balance: 0,
            })
            const refDate = new Date(2026, 11, 31) // 2026-12-31
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)
            expect(info.unbilledPeriod.lastStatementEndStr).toBe('2026-12-31')
            expect(info.unbilledPeriod.startStr).toBe('2027-01-01')
            expect(info.unbilledPeriod.endStr).toBe('2027-01-31')
        })
    })

    describe('autoGenerateCreditStatements 與繳款日計算', () => {
        it('當今日日期小於結帳日 (now.getDate() < statementDay)，仍能正確產生前一期已過結帳日的帳單', async () => {
            const cardId = await ds.addAccount({
                name: '台新黑狗卡',
                type: 'credit_card',
                statementDay: 25,
                dueDay: 10,
                creditLimit: 50000,
            })

            // 建立 2026-08-28 消費 2500 (屬於 2026-08 期，結帳日為 2026-09-25)
            await ds.addRecord({
                type: 'expense',
                amount: 2500,
                date: '2026-08-28',
                accountId: cardId,
                description: '網購消費',
            })

            // 模擬今日為 2026-10-06 (6 < 25)
            const originalDate = globalThis.Date
            class MockDate extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-10-06T10:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-10-06T10:00:00').getTime()
                }
            }

            try {
                globalThis.Date = MockDate
                await ds.autoGenerateCreditStatements()

                const statements = await ds.getCreditStatements({
                    accountId: cardId,
                })
                // 應包含 2026-08 期 (結帳日 2026-09-25，小於今日 2026-10-06)
                const stmt08 = statements.find(s => s.period === '2026-08')
                expect(stmt08).toBeDefined()
                expect(stmt08.amount).toBe(2500)
                expect(stmt08.status).toBe('unpaid')
                // 繳款日應為 2026-10-10
                const due = new Date(stmt08.dueDate)
                expect(due.getFullYear()).toBe(2026)
                expect(due.getMonth()).toBe(9) // 10月
                expect(due.getDate()).toBe(10)
            } finally {
                globalThis.Date = originalDate
            }
        })

        it('當 dueDay > statementDay (同月繳款) vs dueDay <= statementDay (次月繳款) 正確計算繳款日', async () => {
            // 卡片 A: 結帳日 5 日、繳款日 25 日 (同一月)
            const cardAId = await ds.addAccount({
                name: '星展饗樂卡',
                type: 'credit_card',
                statementDay: 5,
                dueDay: 25,
            })
            // 卡片 B: 結帳日 20 日、繳款日 5 日 (次月)
            const cardBId = await ds.addAccount({
                name: '聯邦賴點卡',
                type: 'credit_card',
                statementDay: 20,
                dueDay: 5,
            })

            await ds.addRecord({
                type: 'expense',
                amount: 1500,
                date: '2026-05-30', // 屬於 2026-05 期 (5/6 ~ 6/5)
                accountId: cardAId,
            })
            await ds.addRecord({
                type: 'expense',
                amount: 2000,
                date: '2026-05-30', // 屬於 2026-05 期 (5/21 ~ 6/20)
                accountId: cardBId,
            })

            const originalDate = globalThis.Date
            class MockDate extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-06-28T10:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-06-28T10:00:00').getTime()
                }
            }

            try {
                globalThis.Date = MockDate
                await ds.autoGenerateCreditStatements()

                const stmtA = (
                    await ds.getCreditStatements({ accountId: cardAId })
                ).find(s => s.period === '2026-05')
                const stmtB = (
                    await ds.getCreditStatements({ accountId: cardBId })
                ).find(s => s.period === '2026-05')

                expect(stmtA).toBeDefined()
                expect(stmtB).toBeDefined()

                // 卡片 A: 結帳日為 6月5日，dueDay=25 > 5，繳款日應為 6月25日 (同月份)
                const dueA = new Date(stmtA.dueDate)
                expect(dueA.getFullYear()).toBe(2026)
                expect(dueA.getMonth()).toBe(5) // 6月
                expect(dueA.getDate()).toBe(25)

                // 卡片 B: 結帳日為 6月20日，dueDay=5 <= 20，繳款日應為 7月5日 (次月份)
                const dueB = new Date(stmtB.dueDate)
                expect(dueB.getFullYear()).toBe(2026)
                expect(dueB.getMonth()).toBe(6) // 7月
                expect(dueB.getDate()).toBe(5)
            } finally {
                globalThis.Date = originalDate
            }
        })
    })

    describe('autoPayCreditStatements 與平帳機制', () => {
        it('繳款日當天或過後自動扣繳卡費，生成 transfer 記帳記錄並平帳，不計入日常支出', async () => {
            // 扣款活存帳戶 (餘額 20000)
            const bankId = await ds.addAccount({
                name: '國泰活存',
                type: 'bank',
                balance: 20000,
                ledgerId: 1,
            })

            // 信用卡帳戶 (開啟自動扣款，綁定國泰活存)
            const cardId = await ds.addAccount({
                name: '國泰CUBE',
                type: 'credit_card',
                balance: 0,
                statementDay: 20,
                dueDay: 5,
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            // 建立一筆刷卡消費 (前期消費)
            await ds.addRecord({
                type: 'expense',
                category: 'food',
                amount: 3500,
                date: '2026-09-10',
                accountId: cardId,
                description: '餐廳刷卡',
            })

            // 帳單：繳款日為 2026-10-05，金額 3500，未繳
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-08',
                statementDate: new Date('2026-09-20').getTime(),
                dueDate: new Date('2026-10-05T00:00:00').getTime(),
                amount: 3500,
                status: 'unpaid',
                ledgerId: 1,
            })

            // 模擬今日為 2026-10-06 (繳款日 10-05 已過)
            const originalDate = globalThis.Date
            class MockDate extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        return new originalDate('2026-10-06T12:00:00')
                    }
                    return new originalDate(...args)
                }
                static now() {
                    return new originalDate('2026-10-06T12:00:00').getTime()
                }
            }

            try {
                globalThis.Date = MockDate
                const processed = await ds.autoPayCreditStatements()

                expect(processed).toHaveLength(1)
                expect(processed[0].amount).toBe(3500)

                // 驗證產生的扣繳記錄
                const bankRecords = await ds.db.getAllFromIndex(
                    'records',
                    'accountId',
                    bankId
                )
                const cardRecords = await ds.db.getAllFromIndex(
                    'records',
                    'accountId',
                    cardId
                )

                // 銀行扣款支出
                const debitExpense = bankRecords.find(
                    r => r.type === 'expense' && r.category === 'debt_repayment'
                )
                expect(debitExpense).toBeDefined()
                expect(debitExpense.amount).toBe(3500)
                expect(debitExpense.description).toContain('[卡費扣繳]')

                // 信用卡入帳收入
                const cardIncome = cardRecords.find(
                    r => r.type === 'income' && r.category === 'debt_repayment'
                )
                expect(cardIncome).toBeDefined()
                expect(cardIncome.amount).toBe(3500)
                expect(cardIncome.description).toContain('[卡費扣繳]')

                // 帳單狀態已標記為 paid
                const updatedStmt = await ds.getCreditStatement(stmtId)
                expect(updatedStmt.status).toBe('paid')

                // 驗證帳戶餘額平帳：
                // 銀行餘額從 20000 扣除 3500 變為 16500
                const allBankRecs = await ds.getRecords({ accountId: bankId })
                const bankBal = allBankRecs.reduce(
                    (b, r) => b + (r.type === 'income' ? r.amount : -r.amount),
                    20000
                )
                expect(bankBal).toBe(16500)

                // 信用卡欠款從 3500 (刷卡) 扣繳 3500 後歸零 (balance = 0)
                const allCardRecs = await ds.getRecords({ accountId: cardId })
                const cardBal = allCardRecs.reduce(
                    (b, r) => b + (r.type === 'income' ? r.amount : -r.amount),
                    0
                )
                expect(cardBal).toBe(0)

                // 驗證生活支出統計：transfer 類別不被計入支出總計 (不重複計算)
                const stats = await ds.getStatistics(
                    '2026-10-01',
                    '2026-10-31',
                    null,
                    true
                )
                expect(stats.totalExpense).toBe(0) // 10月份沒有新的生活支出
            } finally {
                globalThis.Date = originalDate
            }
        })
    })

    describe('payCreditStatement 單筆扣繳平帳 Helper', () => {
        it('支援指定扣款帳戶與金額繳清帳單，立即平帳', async () => {
            const bankId = await ds.addAccount({
                name: '台新活儲',
                type: 'bank',
                balance: 50000,
            })
            const cardId = await ds.addAccount({
                name: '台新FlyGo',
                type: 'credit_card',
                balance: 0,
            })

            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-09',
                statementDate: new Date('2026-10-01').getTime(),
                dueDate: new Date('2026-10-20').getTime(),
                amount: 8800,
                status: 'unpaid',
            })

            const result = await ds.payCreditStatement(stmtId, bankId, 8800)
            expect(result.amount).toBe(8800)

            const stmt = await ds.getCreditStatement(stmtId)
            expect(stmt.status).toBe('paid')

            const bankRecs = await ds.getRecords({ accountId: bankId })
            expect(
                bankRecs.some(
                    r =>
                        r.type === 'expense' &&
                        r.category === 'debt_repayment' &&
                        r.amount === 8800
                )
            ).toBe(true)
        })

        it('當信用卡欠款已為 0 時，支援 deductOnly 僅扣款帳戶平帳，不重複增加信用卡餘額', async () => {
            const bankId = await ds.addAccount({
                name: '玉山薪轉戶',
                type: 'bank',
                balance: 60000,
            })
            const cardId = await ds.addAccount({
                name: '玉山Pi卡',
                type: 'credit_card',
                balance: 0,
            })

            // 信用卡欠款已歸零 (balance = 0，無任何未還欠款)
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-09',
                statementDate: new Date('2026-10-01').getTime(),
                dueDate: new Date('2026-10-15').getTime(),
                amount: 5200,
                status: 'unpaid',
            })

            // 使用 deductOnly 扣繳平帳
            const result = await ds.payCreditStatement(stmtId, bankId, 5200, null, {
                deductOnly: true,
            })
            expect(result.deductOnly).toBe(true)
            expect(result.amount).toBe(5200)

            // 1. 驗證銀行帳戶成功扣款 5200 (類別為 debt_repayment)
            const bankRecs = await ds.getRecords({ accountId: bankId })
            expect(bankRecs).toHaveLength(1)
            expect(bankRecs[0].type).toBe('expense')
            expect(bankRecs[0].amount).toBe(5200)
            expect(bankRecs[0].category).toBe('debt_repayment')
            expect(bankRecs[0].description).toContain('[卡費扣繳平帳]')

            // 計算銀行餘額：從 60000 扣除 5200 變為 54800
            const bankBal = bankRecs.reduce(
                (b, r) => b + (r.type === 'income' ? r.amount : -r.amount),
                60000
            )
            expect(bankBal).toBe(54800)

            // 2. 驗證信用卡沒有被寫入多餘的收入紀錄，保持為 0，避免產生溢繳款
            const cardRecs = await ds.getRecords({ accountId: cardId })
            expect(cardRecs).toHaveLength(0)

            // 3. 驗證帳單標記為 paid
            const stmt = await ds.getCreditStatement(stmtId)
            expect(stmt.status).toBe('paid')

            // 4. 驗證生活支出統計：平帳專用紀錄不被計入日常支出
            const stats = await ds.getStatistics(
                '2026-10-01',
                '2026-10-31',
                null,
                true
            )
            expect(stats.totalExpense).toBe(0)
        })
    })

    describe('信用卡消費遞延至下一期與還款隔離機制', () => {
        it('支援將未繳帳單的消費明細遞延至下一期，並自動重算帳單金額', async () => {
            const cardId = await ds.addAccount({
                name: '國泰CUBE卡',
                type: 'credit_card',
                statementDay: 8,
                dueDay: 23,
                balance: 0,
            })

            // 在 09/09 ~ 10/08 週期內加入兩筆消費
            const rec1Id = await ds.addRecord({
                type: 'expense',
                category: 'food',
                amount: 1000,
                date: '2026-09-15',
                accountId: cardId,
                description: '晚餐',
            })
            const rec2Id = await ds.addRecord({
                type: 'expense',
                category: 'fun',
                amount: 2500,
                date: '2026-09-20',
                accountId: cardId,
                description: '飯店預約 (商家延遲請款)',
            })

            // 建立 2026-09 期帳單 (金額 3500)
            const stmtId = await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-09',
                statementDate: new Date('2026-10-08').getTime(),
                dueDate: new Date('2026-10-23').getTime(),
                amount: 3500,
                status: 'unpaid',
            })

            // 執行遞延：將飯店預約遞延至下一期 (2026-10)
            const deferResult = await ds.deferRecordToNextStatement(rec2Id, stmtId)
            expect(deferResult.fromPeriod).toBe('2026-09')
            expect(deferResult.toPeriod).toBe('2026-10')

            // 1. 驗證 2026-09 期帳單金額從 3500 自動減少至 1000
            const updatedStmt = await ds.getCreditStatement(stmtId)
            expect(updatedStmt.amount).toBe(1000)

            // 2. 驗證 2026-09 期帳單明細中只剩晚餐 (1000)
            const stmtRecords = await ds.getStatementRecords(
                await ds.getAccount(cardId),
                '2026-09'
            )
            expect(stmtRecords).toHaveLength(1)
            expect(stmtRecords[0].id).toBe(rec1Id)

            // 3. 驗證在未出帳即時消費中能查到該筆由 2026-09 遞延過來的 2500 消費
            const card = await ds.getAccount(cardId)
            const billingInfo = await ds.getCreditCardBillingInfo(cardId)
            const unbilledDeferred = billingInfo.unbilledRecords.find(r => r.id === rec2Id)
            expect(unbilledDeferred).toBeDefined()
            expect(unbilledDeferred.deferredFromPeriod).toBe('2026-09')
            expect(unbilledDeferred.amount).toBe(2500)

            // 4. 取消遞延：移回原期
            await ds.undeferRecord(rec2Id, stmtId)
            const restoredStmt = await ds.getCreditStatement(stmtId)
            expect(restoredStmt.amount).toBe(3500)

            const restoredStmtRecords = await ds.getStatementRecords(card, '2026-09')
            expect(restoredStmtRecords).toHaveLength(2)
        })

        it('前期卡費還款與自動扣繳紀錄絕不會污染當期消費明細與扣減帳單金額', async () => {
            const cardId = await ds.addAccount({
                name: '富邦J卡',
                type: 'credit_card',
                statementDay: 8,
                dueDay: 23,
                balance: 0,
            })

            // 消費 15,000 (落在 2026-09 期：09/09 ~ 10/08)
            await ds.addRecord({
                type: 'expense',
                category: 'life',
                amount: 15000,
                date: '2026-09-12',
                accountId: cardId,
                description: '買家電',
            })

            // 10/03 有一筆繳納上一期卡費的入帳 (日期落在 09/09 ~ 10/08 區間內)
            await ds.addRecord({
                type: 'income',
                category: 'debt_repayment',
                amount: 1352,
                date: '2026-10-03',
                accountId: cardId,
                description: '[自動扣款] 自動扣繳卡費 (富邦J卡 2026-08 期)',
            })

            const card = await ds.getAccount(cardId)

            // 1. 取得 2026-09 期的消費明細：絕不包含 1352 的還款紀錄
            const stmtRecords = await ds.getStatementRecords(card, '2026-09')
            expect(stmtRecords).toHaveLength(1)
            expect(stmtRecords[0].description).toBe('買家電')
            expect(stmtRecords[0].amount).toBe(15000)

            // 2. 計算 2026-09 期帳單消費金額：必須為完整的 15,000，不可被誤減成 13,648
            const periodBalance = await ds.calculateCreditCardBalance(card.id, '2026-09')
            expect(periodBalance.totalExpense).toBe(15000)
            expect(periodBalance.currentBalance).toBe(15000)
            expect(periodBalance.totalRepayment).toBe(0)
        })

        it('當期有多筆即時消費且週期內有前期卡費扣繳時，即時消費未出帳金額與總欠款絕不可為 0 (台新信用卡 21 筆機票案例)', async () => {
            const cardId = await ds.addAccount({
                name: '台新信用卡',
                type: 'credit_card',
                statementDay: 17,
                dueDay: 3,
                creditLimit: 120000,
                balance: 0,
            })

            // 10/03 有前期 (2026-08 期) 卡費扣繳入帳 50,000 元 (日期落在 09/18 ~ 10/17 週期內)
            await ds.addRecord({
                type: 'income',
                category: 'debt_repayment',
                amount: 50000,
                date: '2026-10-03',
                accountId: cardId,
                description: '[卡費扣繳] 從 郵局 扣款繳費 (2026-08 期)',
            })

            // 10/13 新增 21 筆即期消費 (模擬機票消費，總計 49,000)
            for (let i = 1; i <= 21; i++) {
                await ds.addRecord({
                    type: 'expense',
                    category: 'traffic',
                    amount: i === 21 ? 3000 : 2300, // 20 * 2300 + 3000 = 49000
                    date: '2026-10-13',
                    accountId: cardId,
                    description: `機票 ${1000 + i}`,
                })
            }

            const refDate = new Date(2026, 9, 13) // 2026-10-13
            const info = await ds.getCreditCardBillingInfo(cardId, refDate)

            expect(info).not.toBeNull()
            expect(info.unbilledPeriod.startStr).toBe('2026-09-18')
            expect(info.unbilledPeriod.endStr).toBe('2026-10-17')

            // 21 筆消費全部正確納入，前期還款被排除
            expect(info.unbilledRecords).toHaveLength(21)
            expect(info.unbilledExpense).toBe(49000)
            expect(info.unbilledRepayment).toBe(0)
            expect(info.unbilledTotal).toBe(49000) // 絕不可為 0！

            // 總欠款與可用額度正確反映即期消費
            expect(info.totalDebt).toBe(49000) // 絕不可為 0！
            expect(info.availableCredit).toBe(120000 - 49000) // 71,000
        })

        it('自動清理重複的卡費扣繳記錄 (deduplicateCreditCardPayments)', async () => {
            const cardId = await ds.addAccount({
                name: '台新信用卡',
                type: 'credit_card',
            })

            // 模擬歷史 autoPay 產生的重複扣款
            await ds.addRecord({
                type: 'income',
                category: 'debt_repayment',
                amount: 10000,
                date: '2026-10-03',
                accountId: cardId,
                description: '[卡費扣繳] 從 郵局 扣款繳費 (2026-08 期)',
            })
            await ds.addRecord({
                type: 'income',
                category: 'debt_repayment',
                amount: 10000,
                date: '2026-10-03',
                accountId: cardId,
                description: '[卡費扣繳] 從 郵局 扣款繳費 (2026-08 期)',
            })

            const beforeRecords = await ds.getRecords()
            const cardPaysBefore = beforeRecords.filter(
                r => r.accountId === cardId && r.description.startsWith('[卡費扣繳]')
            )
            expect(cardPaysBefore).toHaveLength(2)

            await ds.deduplicateCreditCardPayments()

            const afterRecords = await ds.getRecords()
            const cardPaysAfter = afterRecords.filter(
                r => r.accountId === cardId && r.description.startsWith('[卡費扣繳]')
            )
            expect(cardPaysAfter).toHaveLength(1)
        })
    })
})

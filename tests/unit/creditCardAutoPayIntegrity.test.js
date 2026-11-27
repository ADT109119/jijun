/**
 * #AUTOPAY-INT: 信用卡自動扣款引用完整性四缺口單元測試
 *
 * 覆蓋四個缺口與新增的單一真相源工具函數：
 * - isLedgerCompatible(entityA, entityB)
 * - isValidAutoPayDebitAccount(debitAccount, card)
 * - isCardFeePaymentRecord(record, period)
 *
 * 缺口 1：扣款帳戶不存在／已刪除（addAccount / updateAccount / deleteAccount 連帶清理 / alignCreditCardAutoPay / importData）
 * 缺口 2：跨帳本引用（不同 ledgerId 的扣款帳戶不可被引用、執行自動扣款或手動繳款）
 * 缺口 3：卡片與帳戶不相容（信用卡扣信用卡、自引用、扣款帳戶改型為信用卡連帶清理、信用卡改型為一般帳戶清空設定）
 * 缺口 4：卡費繳款紀錄誤判（退款／回饋／一般收入備註含「YYYY-MM 期」不得誤判為已繳卡費；[卡費扣繳平帳] 須從本期消費與餘額排除）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import DataService, {
    isLedgerCompatible,
    isValidAutoPayDebitAccount,
    isCardFeePaymentRecord,
} from '../../src/js/dataService.js'
import { AccountsPage } from '../../src/js/pages/accountsPage.js'

vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        showToast: vi.fn(),
        customConfirm: vi.fn(async () => true),
    }
})

import { showToast } from '../../src/js/utils.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('#AUTOPAY-INT — 純函數單一真相源', () => {
    describe('isLedgerCompatible', () => {
        it('相同 ledgerId 回傳 true，缺省 ledgerId 視為預設帳本 1', () => {
            expect(isLedgerCompatible({ ledgerId: 1 }, { ledgerId: 1 })).toBe(true)
            expect(isLedgerCompatible({ ledgerId: 2 }, { ledgerId: 2 })).toBe(true)
            expect(isLedgerCompatible({}, { ledgerId: 1 })).toBe(true)
            expect(isLedgerCompatible({ ledgerId: null }, { ledgerId: undefined })).toBe(true)
            expect(isLedgerCompatible({ ledgerId: '2' }, { ledgerId: 2 })).toBe(true)
        })

        it('不同 ledgerId 回傳 false', () => {
            expect(isLedgerCompatible({ ledgerId: 1 }, { ledgerId: 2 })).toBe(false)
            expect(isLedgerCompatible({}, { ledgerId: 2 })).toBe(false)
            expect(isLedgerCompatible(null, { ledgerId: 2 })).toBe(false)
        })
    })

    describe('isValidAutoPayDebitAccount', () => {
        const card = { id: 10, uuid: 'card-u', type: 'credit_card', ledgerId: 1 }

        it('同帳本的非信用卡帳戶（wallet/cash/bank）回傳 true', () => {
            expect(
                isValidAutoPayDebitAccount({ id: 2, uuid: 'bank-u', type: 'bank', ledgerId: 1 }, card)
            ).toBe(true)
            expect(
                isValidAutoPayDebitAccount({ id: 3, uuid: 'wal-u', type: 'wallet', ledgerId: 1 }, card)
            ).toBe(true)
            expect(
                isValidAutoPayDebitAccount({ id: 4, uuid: 'cash-u', type: 'cash', ledgerId: 1 }, card)
            ).toBe(true)
        })

        it('扣款帳戶不存在、為信用卡、自引用（同 id 或同 uuid）或跨帳本一律回傳 false', () => {
            expect(isValidAutoPayDebitAccount(null, card)).toBe(false)
            expect(isValidAutoPayDebitAccount(undefined, card)).toBe(false)
            // 信用卡不可扣信用卡
            expect(
                isValidAutoPayDebitAccount({ id: 11, uuid: 'card2', type: 'credit_card', ledgerId: 1 }, card)
            ).toBe(false)
            // 自引用：同 id
            expect(
                isValidAutoPayDebitAccount({ id: 10, uuid: 'other', type: 'bank', ledgerId: 1 }, card)
            ).toBe(false)
            // 自引用：同 uuid
            expect(
                isValidAutoPayDebitAccount({ id: 99, uuid: 'card-u', type: 'bank', ledgerId: 1 }, card)
            ).toBe(false)
            // 跨帳本
            expect(
                isValidAutoPayDebitAccount({ id: 2, uuid: 'bank-u', type: 'bank', ledgerId: 2 }, card)
            ).toBe(false)
        })

        it('card 缺失或為非信用卡時一律 Fail-Closed 回傳 false', () => {
            const bank = { id: 2, type: 'bank', ledgerId: 1 }
            expect(isValidAutoPayDebitAccount(bank, { id: 1, type: 'wallet', ledgerId: 1 })).toBe(false)
            expect(isValidAutoPayDebitAccount(bank)).toBe(false)
            expect(isValidAutoPayDebitAccount(bank, null)).toBe(false)
            expect(isValidAutoPayDebitAccount({ id: 5, type: 'credit_card', ledgerId: 1 }, card)).toBe(false)
        })
    })

    describe('isCardFeePaymentRecord', () => {
        it('精準辨識系統產生的卡費繳款平帳紀錄（含 [卡費扣繳]、[卡費扣繳平帳]、[自動扣款]）', () => {
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'balance_adjustment', description: '[卡費扣繳平帳] 玉山 2026-10 期卡費' },
                    '2026-10'
                )
            ).toBe(true)
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'debt_repayment', description: '[卡費扣繳] 2026-10 期卡費' },
                    '2026-10'
                )
            ).toBe(true)
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'transfer', description: '[自動扣款] 台新卡 2026-10 期卡費' },
                    '2026-10'
                )
            ).toBe(true)
            // 不指定 period 時（供消費加總過濾用）仍為 true
            expect(
                isCardFeePaymentRecord({
                    type: 'income',
                    category: 'balance_adjustment',
                    description: '[卡費扣繳平帳] 玉山 2026-10 期卡費',
                })
            ).toBe(true)
        })

        it('拒絕將商家退款、現金回饋或一般分類收入（即使備註含「2026-10 期」）誤判為已繳卡費', () => {
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'others', description: '商家退款 2026-10 期商品' },
                    '2026-10'
                )
            ).toBe(false)
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'cashback', description: '2026-10 期刷卡現金回饋' },
                    '2026-10'
                )
            ).toBe(false)
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'transfer', description: '朋友轉帳 2026-10 期旅遊分帳' },
                    '2026-10'
                )
            ).toBe(false)
            // expense 支出紀錄絕非卡費入帳
            expect(
                isCardFeePaymentRecord(
                    { type: 'expense', category: 'transfer', description: '[卡費扣繳] 2026-10 期卡費' },
                    '2026-10'
                )
            ).toBe(false)
            // 期別邊界比對：2026-10 不應誤配 2026-100 或 2026-11
            expect(
                isCardFeePaymentRecord(
                    { type: 'income', category: 'transfer', description: '[卡費扣繳] 2026-11 期卡費' },
                    '2026-10'
                )
            ).toBe(false)
        })
    })
})

describe('#AUTOPAY-INT — DataService 四缺口整合測試', () => {
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        vi.clearAllMocks()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    describe('缺口 1：扣款帳戶不存在或被刪除', () => {
        it('刪除扣款帳戶時自動連帶清除引用該帳戶之信用卡 autoPay 設定', async () => {
            const bankId = await ds.addAccount({ name: '台新活存', type: 'bank', balance: 50000, ledgerId: 1 })
            const cardId = await ds.addAccount({
                name: '台新黑狗卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                statementDay: 15,
                paymentDueDay: 5,
                ledgerId: 1,
            })

            await ds.deleteAccount(bankId)

            const card = await ds.getAccount(cardId)
            expect(card.autoPayEnabled).toBe(false)
            expect(card.autoPayAccountId).toBeNull()
            expect(card.autoPayAccountUuid).toBeNull()
        })

        it('addAccount 指定不存在之 autoPayAccountId（無 uuid）時自動歸零，不留下懸空指標', async () => {
            const cardId = await ds.addAccount({
                name: '幽靈卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: 9999,
                ledgerId: 1,
            })
            const card = await ds.getAccount(cardId)
            expect(card.autoPayAccountId).toBeNull()
            expect(card.autoPayAccountUuid).toBeNull()
        })

        it('updateAccount 切換為不存在之 autoPayAccountId 時清除引用且不保留舊 uuid', async () => {
            const bankId = await ds.addAccount({ name: '活存', type: 'bank', balance: 10000, ledgerId: 1 })
            const cardId = await ds.addAccount({
                name: '卡A',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            await ds.updateAccount(cardId, { autoPayAccountId: 8888 })
            const card = await ds.getAccount(cardId)
            expect(card.autoPayAccountId).toBeNull()
            expect(card.autoPayAccountUuid).toBeNull()
        })
    })

    describe('缺口 2：跨帳本引用防護', () => {
        it('addAccount / updateAccount / alignCreditCardAutoPay 均拒絕跨帳本扣款帳戶', async () => {
            const bankL2 = await ds.addAccount({ name: '帳本2銀行', type: 'bank', balance: 50000, ledgerId: 2 })
            const bankL2Acc = await ds.getAccount(bankL2)

            // 帳本 1 的卡片嘗試綁定帳本 2 的銀行
            const cardL1 = await ds.addAccount({
                name: '帳本1信用卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankL2,
                autoPayAccountUuid: bankL2Acc.uuid,
                ledgerId: 1,
            })
            const added = await ds.getAccount(cardL1)
            expect(added.autoPayAccountId).toBeNull()
            expect(added.autoPayAccountUuid).toBeNull()

            // updateAccount 亦不可跨帳本引用
            await ds.updateAccount(cardL1, { autoPayEnabled: true, autoPayAccountId: bankL2 })
            const updated = await ds.getAccount(cardL1)
            expect(updated.autoPayAccountId).toBeNull()
            expect(updated.autoPayAccountUuid).toBeNull()

            // 模擬舊髒資料強塞跨帳本引用，alignCreditCardAutoPay 應清除
            const rawCard = await ds.getAccount(cardL1)
            const tx1 = ds.db.transaction('accounts', 'readwrite')
            await tx1.store.put({
                ...rawCard,
                autoPayEnabled: true,
                autoPayAccountId: bankL2,
                autoPayAccountUuid: bankL2Acc.uuid,
            })
            await tx1.done

            await ds.alignCreditCardAutoPay()
            const aligned = await ds.getAccount(cardL1)
            expect(aligned.autoPayEnabled).toBe(false)
            expect(aligned.autoPayAccountId).toBeNull()
            expect(aligned.autoPayAccountUuid).toBeNull()
        })

        it('payCreditStatement 拒絕跨帳本扣款帳戶並拋出錯誤', async () => {
            const bankL2 = await ds.addAccount({ name: '帳本2銀行', type: 'bank', balance: 50000, ledgerId: 2 })
            const cardL1 = await ds.addAccount({
                name: '帳本1卡',
                type: 'credit_card',
                statementDay: 15,
                dueDay: 5,
                ledgerId: 1,
            })
            const stmtId = await ds.addCreditStatement({
                accountId: cardL1,
                period: '2026-09',
                amount: 1000,
                status: 'unpaid',
                statementDate: '2026-09-15',
                dueDate: '2026-10-05',
                ledgerId: 1,
            })

            await expect(
                ds.payCreditStatement(stmtId, bankL2, 1000, '2026-10-05')
            ).rejects.toThrow(/同一個帳本/)
        })

        it('autoPayCreditStatements 遇跨帳本扣款設定時略過不扣款', async () => {
            const bankL2 = await ds.addAccount({ name: '帳本2銀行', type: 'bank', balance: 50000, ledgerId: 2 })
            const bankL2Acc = await ds.getAccount(bankL2)
            const cardL1 = await ds.addAccount({
                name: '帳本1卡',
                type: 'credit_card',
                statementDay: 10,
                dueDay: 15,
                ledgerId: 1,
            })
            // 強制植入跨帳本髒引用
            const rawCard = await ds.getAccount(cardL1)
            const tx2 = ds.db.transaction('accounts', 'readwrite')
            await tx2.store.put({
                ...rawCard,
                autoPayEnabled: true,
                autoPayAccountId: bankL2,
                autoPayAccountUuid: bankL2Acc.uuid,
            })
            await tx2.done

            await ds.addCreditStatement({
                accountId: cardL1,
                period: '2020-08',
                amount: 3000,
                status: 'unpaid',
                statementDate: '2020-08-10',
                dueDate: '2020-08-15',
                ledgerId: 1,
            })

            const paid = await ds.autoPayCreditStatements()
            expect(paid).toEqual([])
            // 帳本 2 銀行餘額未受扣減
            const bankRecs = await ds.getRecords({ accountId: bankL2, allLedgers: true })
            expect(bankRecs).toHaveLength(0)
        })
    })

    describe('缺口 3：卡片與帳戶型別不相容', () => {
        it('信用卡不可指定另一張信用卡或自己為扣款帳戶', async () => {
            const card1 = await ds.addAccount({ name: '卡1', type: 'credit_card', ledgerId: 1 })
            const card2 = await ds.addAccount({
                name: '卡2',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: card1,
                ledgerId: 1,
            })
            const acc2 = await ds.getAccount(card2)
            expect(acc2.autoPayAccountId).toBeNull()
            expect(acc2.autoPayAccountUuid).toBeNull()

            // 自引用
            await ds.updateAccount(card1, { autoPayEnabled: true, autoPayAccountId: card1 })
            const acc1 = await ds.getAccount(card1)
            expect(acc1.autoPayAccountId).toBeNull()
        })

        it('被引用為扣款帳戶的銀行改型為 credit_card 時，連帶清除信用卡的 autoPay 引用', async () => {
            const bankId = await ds.addAccount({ name: '帳戶A', type: 'bank', balance: 20000, ledgerId: 1 })
            const cardId = await ds.addAccount({
                name: '卡A',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            await ds.updateAccount(bankId, { type: 'credit_card' })
            const card = await ds.getAccount(cardId)
            expect(card.autoPayEnabled).toBe(false)
            expect(card.autoPayAccountId).toBeNull()
            expect(card.autoPayAccountUuid).toBeNull()
        })

        it('信用卡改型為一般帳戶（wallet）時自動清除其 autoPay 欄位', async () => {
            const bankId = await ds.addAccount({ name: '活存', type: 'bank', balance: 20000, ledgerId: 1 })
            const cardId = await ds.addAccount({
                name: '舊卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            await ds.updateAccount(cardId, { type: 'wallet' })
            const converted = await ds.getAccount(cardId)
            expect(converted.type).toBe('wallet')
            expect(converted.autoPayEnabled).toBe(false)
            expect(converted.autoPayAccountId).toBeNull()
            expect(converted.autoPayAccountUuid).toBeNull()
        })

        it('payCreditStatement 拒絕以信用卡扣款或對非信用卡執行繳款', async () => {
            const bankId = await ds.addAccount({ name: '活存', type: 'bank', balance: 50000, ledgerId: 1 })
            const card1 = await ds.addAccount({ name: '卡1', type: 'credit_card', ledgerId: 1 })
            const card2 = await ds.addAccount({ name: '卡2', type: 'credit_card', ledgerId: 1 })
            const cardStmtId = await ds.addCreditStatement({
                accountId: card1,
                period: '2026-09',
                amount: 500,
                status: 'unpaid',
                statementDate: '2026-09-15',
                dueDate: '2026-10-05',
                ledgerId: 1,
            })
            const bankStmtId = await ds.addCreditStatement({
                accountId: bankId,
                period: '2026-09',
                amount: 500,
                status: 'unpaid',
                statementDate: '2026-09-15',
                dueDate: '2026-10-05',
                ledgerId: 1,
            })

            await expect(ds.payCreditStatement(cardStmtId, card2, 500, '2026-10-05')).rejects.toThrow(/不可為信用卡/)
            await expect(ds.payCreditStatement(bankStmtId, bankId, 500, '2026-10-05')).rejects.toThrow(/非信用卡/)
        })
    })

    describe('缺口 4：卡費繳款紀錄誤判與 [卡費扣繳平帳] 排除', () => {
        it('信用卡上的商家退款／回饋（備註含期別）不得誤判為已繳卡費，autoPayCreditStatements 仍會正常扣繳', async () => {
            const bankId = await ds.addAccount({ name: '玉山活存', type: 'bank', balance: 50000, ledgerId: 1 })
            const cardId = await ds.addAccount({
                name: '玉山 UBear',
                type: 'credit_card',
                statementDay: 10,
                dueDay: 15,
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })

            // 2020-08 期消費 3000 + 同帳期一筆商家退款 200（statementDay=10，故 8/12 與 8/14 屬於 2020-08 期）
            await ds.addRecord({
                type: 'expense',
                amount: 3000,
                category: 'shopping',
                description: '網購外套',
                date: '2020-08-12',
                accountId: cardId,
                ledgerId: 1,
            })
            await ds.addRecord({
                type: 'income',
                amount: 200,
                category: 'others',
                description: '商家退款 2020-08 期運費',
                date: '2020-08-14',
                accountId: cardId,
                ledgerId: 1,
            })
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2020-08',
                amount: 2800,
                status: 'unpaid',
                statementDate: '2020-09-10',
                dueDate: '2020-09-15',
                ledgerId: 1,
            })

            // 到期後執行自動扣款：不應因退款含「2020-08 期」而誤判已繳
            const paid = await ds.autoPayCreditStatements()
            expect(paid).toHaveLength(1)
            expect(paid[0].statement.period).toBe('2020-08')
            expect(paid[0].amount).toBe(2800)

            // 再次執行自動扣款時已存在 [卡費扣繳] 紀錄，冪等不重複扣款
            const paidAgain = await ds.autoPayCreditStatements()
            expect(paidAgain).toHaveLength(0)

            // 模擬一筆 [卡費扣繳平帳] 紀錄，應自帳單消費明細排除
            await ds.addRecord({
                type: 'income',
                amount: 2800,
                category: 'balance_adjustment',
                description: '[卡費扣繳平帳] 玉山 2020-08 期卡費',
                date: '2020-08-16',
                accountId: cardId,
                ledgerId: 1,
            })
            const stmtRecs = await ds.getStatementRecords(cardId, '2020-08')
            expect(stmtRecs.some(r => String(r.description).includes('[卡費扣繳平帳]'))).toBe(false)
            expect(stmtRecs).toHaveLength(2) // 網購外套 + 商家退款

            // 帳單狀態應為 paid
            const stmts = await ds.getCreditStatements({ accountId: cardId, allLedgers: true })
            const augStmt = stmts.find(s => s.period === '2020-08')
            expect(augStmt.status).toBe('paid')
        })
    })
})

describe('#AUTOPAY-INT — AccountsPage UI 選單過濾與儲存驗證', () => {
    it('帳戶設定彈窗僅列出同帳本非信用卡帳戶作為扣款選項，排除信用卡與跨帳本帳戶', async () => {
        document.body.innerHTML = ''
        const ds = {
            activeLedgerId: 1,
            getAccounts: vi.fn(async () => [
                { id: 1, name: '活存A', type: 'bank', ledgerId: 1 },
                { id: 2, name: '別張卡', type: 'credit_card', ledgerId: 1 },
                { id: 3, name: '帳本2銀行', type: 'bank', ledgerId: 2 },
                { id: 4, name: '本卡', type: 'credit_card', ledgerId: 1 },
            ]),
            addAccount: vi.fn(),
            updateAccount: vi.fn(),
        }
        const ap = new AccountsPage({ appContainer: document.body, dataService: ds })
        await ap.showAccountModal({
            id: 4,
            name: '本卡',
            type: 'credit_card',
            ledgerId: 1,
            autoPayEnabled: true,
            autoPayAccountId: 2, // 歷史髒資料指向別張卡
        })

        const select = document.getElementById('auto-pay-account-select')
        expect(select).not.toBeNull()
        const optionVals = [...select.options].map(o => o.value)
        expect(optionVals).toContain('1') // 同帳本活存
        expect(optionVals).not.toContain('2') // 排除信用卡
        expect(optionVals).not.toContain('3') // 排除跨帳本
        expect(optionVals).not.toContain('4') // 排除自己

        // 未選擇合法扣款帳戶直接儲存應顯示錯誤提示且不呼叫 updateAccount
        select.value = ''
        document.getElementById('save-account-btn').click()
        await new Promise(r => setTimeout(r, 0))
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('有效'), 'error')
        expect(ds.updateAccount).not.toHaveBeenCalled()
    })
})

/**
 * #AUTOPAY-XSS: 同步接收路徑遠端整數 autoPayAccountId 洗白缺口單元測試
 *
 * 背景：不同裝置的 IndexedDB auto-increment 主鍵各自獨立。若遠端同步來的信用卡帶
 * `autoPayAccountId: 2`（遠端裝置的某個銀行帳戶 ID），但缺少或無法匹配
 * `autoPayAccountUuid`，若未先洗白為 `null`，落盤後會直接劫持本機 ID=2 的帳戶。
 *
 * 本測試驗證 SyncService._resolveAccountAutoPayAccountId / _applyAdd / _applyUpdateWithId
 * 對所有情境皆採 Fail-Closed 洗白與引用完整性驗證。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import DataService from '../../src/js/dataService.js'
import { SyncService } from '../../src/js/syncService.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('#AUTOPAY-XSS — SyncService 遠端 autoPayAccountId 洗白與跨裝置 UUID 解析', () => {
    let ds
    let syncService

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
        syncService = new SyncService(ds)
    })

    it('遠端信用卡僅帶整數 autoPayAccountId（無 autoPayAccountUuid）時，必須洗白為 null，不得劫持本機同號帳戶', async () => {
        // 本機建立兩筆帳戶，讓 ID=2 存在且為合法銀行帳戶（若沒洗白就會被誤綁定！）
        await ds.addAccount({ name: '現金', type: 'cash', balance: 1000, ledgerId: 1 })
        const innocentBankId = await ds.addAccount({
            name: '本機無辜帳戶',
            type: 'bank',
            balance: 99999,
            ledgerId: 1,
        })
        expect(typeof innocentBankId).toBe('number')

        const remoteCard = {
            uuid: 'remote-card-no-uuid',
            name: '遠端卡',
            type: 'credit_card',
            autoPayEnabled: true,
            autoPayAccountId: innocentBankId, // 遠端裝置的整數 ID，絕不能直接採信
            // 刻意不提供 autoPayAccountUuid
            ledgerId: 1,
        }

        await syncService._applyAdd('accounts', remoteCard)

        const accounts = await ds.getAccounts({ allLedgers: true })
        const savedCard = accounts.find(a => a.uuid === 'remote-card-no-uuid')
        expect(savedCard).toBeDefined()
        expect(savedCard.autoPayAccountId).toBeNull()
    })

    it('遠端信用卡帶有效 autoPayAccountUuid 時，忽略遠端整數 ID 並精準解析為本機扣款帳戶 ID', async () => {
        await ds.addAccount({ name: '占位1', type: 'cash', ledgerId: 1 })
        await ds.addAccount({ name: '占位2', type: 'cash', ledgerId: 1 })
        const localBankId = await ds.addAccount({
            name: '國泰活存',
            type: 'bank',
            balance: 50000,
            uuid: 'cathay-bank-uuid',
            ledgerId: 1,
        })
        expect(typeof localBankId).toBe('number')
        expect(localBankId).not.toBe(99)

        await syncService._applyAdd('accounts', {
            uuid: 'cathay-cube-uuid',
            name: '國泰 CUBE',
            type: 'credit_card',
            autoPayEnabled: true,
            autoPayAccountId: 99, // 遠端舊 ID
            autoPayAccountUuid: 'cathay-bank-uuid',
            ledgerId: 1,
        })

        const accounts = await ds.getAccounts({ allLedgers: true })
        const card = accounts.find(a => a.uuid === 'cathay-cube-uuid')
        expect(card.autoPayAccountId).toBe(localBankId)
        expect(card.autoPayAccountUuid).toBe('cathay-bank-uuid')
    })

    it('遠端 autoPayAccountUuid 本機尚未同步到時：洗白 autoPayAccountId=null 但保留 autoPayAccountUuid 待後續對齊', async () => {
        const innocentBankId = await ds.addAccount({ name: '本機帳戶1', type: 'bank', ledgerId: 1 })

        await syncService._applyAdd('accounts', {
            uuid: 'early-card-uuid',
            name: '先到的卡',
            type: 'credit_card',
            autoPayEnabled: true,
            autoPayAccountId: innocentBankId,
            autoPayAccountUuid: 'future-bank-uuid',
            ledgerId: 1,
        })

        const accounts = await ds.getAccounts({ allLedgers: true })
        const card = accounts.find(a => a.uuid === 'early-card-uuid')
        expect(card.autoPayAccountId).toBeNull()
        expect(card.autoPayAccountUuid).toBe('future-bank-uuid')
    })

    it('遠端 autoPayAccountUuid 指向不合法目標（另一張信用卡或跨帳本帳戶）時，連同 uuid 與 id 一併洗白', async () => {
        await ds.addAccount({
            name: '另一張信用卡',
            type: 'credit_card',
            uuid: 'other-card-uuid',
            ledgerId: 1,
        })
        await ds.addAccount({
            name: '帳本2銀行',
            type: 'bank',
            uuid: 'ledger2-bank-uuid',
            ledgerId: 2,
        })

        const res1 = await syncService._resolveAccountAutoPayAccountId({
            uuid: 'card-a',
            type: 'credit_card',
            ledgerId: 1,
            autoPayEnabled: true,
            autoPayAccountId: 1,
            autoPayAccountUuid: 'other-card-uuid',
        })
        expect(res1.autoPayAccountId).toBeNull()
        expect(res1.autoPayAccountUuid).toBeNull()

        const res2 = await syncService._resolveAccountAutoPayAccountId({
            uuid: 'card-b',
            type: 'credit_card',
            ledgerId: 1,
            autoPayEnabled: true,
            autoPayAccountId: 2,
            autoPayAccountUuid: 'ledger2-bank-uuid',
        })
        expect(res2.autoPayAccountId).toBeNull()
        expect(res2.autoPayAccountUuid).toBeNull()
    })

    it('_applyUpdateWithId 收到不含 type 的部分更新時，依本機既有帳戶型別仍進行 autoPayAccountId 洗白與解析', async () => {
        const bankA = await ds.addAccount({ name: '銀行A', type: 'bank', uuid: 'bank-a-uuid', ledgerId: 1 })
        const bankB = await ds.addAccount({ name: '銀行B', type: 'bank', uuid: 'bank-b-uuid', ledgerId: 1 })
        const cardId = await ds.addAccount({
            name: '信用卡',
            type: 'credit_card',
            uuid: 'card-partial-uuid',
            autoPayEnabled: true,
            autoPayAccountId: bankA,
            ledgerId: 1,
        })

        // 情境 1：部分更新帶合法 autoPayAccountUuid（但整數 ID 是錯的）→ 應解析到 bankB
        await syncService._applyUpdateWithId('accounts', cardId, {
            uuid: 'card-partial-uuid',
            autoPayAccountId: 999,
            autoPayAccountUuid: 'bank-b-uuid',
        })
        let updated = await ds.getAccount(cardId)
        expect(updated.autoPayAccountId).toBe(bankB)
        expect(updated.autoPayAccountUuid).toBe('bank-b-uuid')

        // 情境 2：部分更新僅帶整數 autoPayAccountId 而無 uuid → 必須洗白為 null
        await syncService._applyUpdateWithId('accounts', cardId, {
            uuid: 'card-partial-uuid',
            autoPayAccountId: bankA,
            autoPayAccountUuid: null,
        })
        updated = await ds.getAccount(cardId)
        expect(updated.autoPayAccountId).toBeNull()
    })

    it('非信用卡帳戶若遠端帶有畸形 autoPay 欄位，一律強制洗白並關閉', async () => {
        const res = await syncService._resolveAccountAutoPayAccountId({
            uuid: 'normal-wallet',
            type: 'wallet',
            ledgerId: 1,
            autoPayEnabled: true,
            autoPayAccountId: 1,
            autoPayAccountUuid: 'some-uuid',
        })
        expect(res.autoPayEnabled).toBe(false)
        expect(res.autoPayAccountId).toBeNull()
        expect(res.autoPayAccountUuid).toBeNull()
    })

    it('getAccounts 查詢失敗時 Fail-Closed：一律洗白 autoPayAccountId 為 null', async () => {
        vi.spyOn(ds, 'getAccounts').mockRejectedValueOnce(new Error('IDB read error'))
        const res = await syncService._resolveAccountAutoPayAccountId({
            uuid: 'card-fail-closed',
            type: 'credit_card',
            ledgerId: 1,
            autoPayEnabled: true,
            autoPayAccountId: 2,
            autoPayAccountUuid: 'bank-uuid',
        })
        expect(res.autoPayAccountId).toBeNull()
        expect(res.autoPayAccountUuid).toBe('bank-uuid')
    })
})

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

describe('Credit Card Auto-Pay Across Recovery and Sync Paths', () => {
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

    describe('addAccount and updateAccount autoPayAccountUuid maintenance', () => {
        it('automatically populates autoPayAccountUuid when adding credit card with autoPayAccountId', async () => {
            const bankId = await ds.addAccount({
                name: '國泰活存',
                type: 'wallet',
                balance: 50000,
                ledgerId: 1,
            })
            const bankAcc = await ds.getAccount(bankId)
            expect(bankAcc.uuid).toBeDefined()

            const cardId = await ds.addAccount({
                name: '國泰 CUBE 卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bankId,
                ledgerId: 1,
            })
            const cardAcc = await ds.getAccount(cardId)
            expect(cardAcc.autoPayEnabled).toBe(true)
            expect(cardAcc.autoPayAccountId).toBe(bankId)
            expect(cardAcc.autoPayAccountUuid).toBe(bankAcc.uuid)
        })

        it('automatically updates autoPayAccountUuid when updating autoPayAccountId', async () => {
            const bank1 = await ds.addAccount({ name: '銀行A', type: 'wallet', balance: 1000, ledgerId: 1 })
            const bank2 = await ds.addAccount({ name: '銀行B', type: 'wallet', balance: 2000, ledgerId: 1 })
            const bank1Acc = await ds.getAccount(bank1)
            const bank2Acc = await ds.getAccount(bank2)

            const cardId = await ds.addAccount({
                name: '我的卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: bank1,
                ledgerId: 1,
            })

            // Switch to bank 2
            await ds.updateAccount(cardId, { autoPayAccountId: bank2 })
            const updated = await ds.getAccount(cardId)
            expect(updated.autoPayAccountId).toBe(bank2)
            expect(updated.autoPayAccountUuid).toBe(bank2Acc.uuid)

            // Disable auto pay
            await ds.updateAccount(cardId, { autoPayEnabled: false, autoPayAccountId: null })
            const disabled = await ds.getAccount(cardId)
            expect(disabled.autoPayAccountId).toBeNull()
            expect(disabled.autoPayAccountUuid).toBeNull()
        })
    })

    describe('importData (Cloud Backup Restore) autoPay remapping', () => {
        it('remaps autoPayAccountId when old account IDs are changed during import', async () => {
            // Backup with old debit account id 88 and credit card id 99
            const backupData = {
                version: '2.3.0',
                settings: {
                    advancedAccountModeEnabled: true,
                },
                ledgers: [{ id: 1, name: '預設帳本', uuid: 'ledger-main' }],
                accounts: [
                    {
                        id: 88,
                        name: '玉山戶頭',
                        type: 'wallet',
                        balance: 10000,
                        uuid: 'esun-bank-uuid',
                        ledgerId: 1,
                    },
                    {
                        id: 99,
                        name: '玉山 UBear',
                        type: 'credit_card',
                        autoPayEnabled: true,
                        autoPayAccountId: 88,
                        autoPayAccountUuid: 'esun-bank-uuid',
                        ledgerId: 1,
                    },
                ],
                records: [],
                recurringTransactions: [],
                debts: [],
                amortizations: [],
            }

            const file = { name: 'backup.json' }
            const originalFileReader = globalThis.FileReader
            globalThis.FileReader = class {
                readAsText() {
                    setTimeout(() => {
                        this.onload({ target: { result: JSON.stringify(backupData) } })
                    }, 0)
                }
            }

            try {
                await ds.importData(file, () => {}, true)
                const accounts = await ds.getAccounts({ allLedgers: true })
                const importedBank = accounts.find(a => a.uuid === 'esun-bank-uuid')
                const importedCard = accounts.find(a => a.name === '玉山 UBear')

                expect(importedBank).toBeDefined()
                expect(importedCard).toBeDefined()
                expect(importedCard.autoPayAccountId).toBe(importedBank.id)
                expect(importedCard.autoPayAccountUuid).toBe(importedBank.uuid)
                expect(importedCard.autoPayEnabled).toBe(true)
            } finally {
                globalThis.FileReader = originalFileReader
            }
        })

        it('supports legacy backups without autoPayAccountUuid by remapping via oldAccountIdToNewIdMap', async () => {
            const backupData = {
                version: '2.0.0',
                settings: {
                    advancedAccountModeEnabled: true,
                },
                ledgers: [{ id: 1, name: '預設帳本', uuid: 'ledger-main' }],
                accounts: [
                    {
                        id: 101,
                        name: '舊版台新扣款帳戶',
                        type: 'wallet',
                        balance: 20000,
                        uuid: 'taishin-wallet-uuid',
                        ledgerId: 1,
                    },
                    {
                        id: 202,
                        name: '舊版台新黑狗卡',
                        type: 'credit_card',
                        autoPayEnabled: true,
                        autoPayAccountId: 101, // No autoPayAccountUuid in legacy backup!
                        ledgerId: 1,
                    },
                ],
                records: [],
                recurringTransactions: [],
                debts: [],
                amortizations: [],
            }

            const file = { name: 'backup-legacy.json' }
            const originalFileReader = globalThis.FileReader
            globalThis.FileReader = class {
                readAsText() {
                    setTimeout(() => {
                        this.onload({ target: { result: JSON.stringify(backupData) } })
                    }, 0)
                }
            }

            try {
                await ds.importData(file, () => {}, true)
                const accounts = await ds.getAccounts({ allLedgers: true })
                const importedBank = accounts.find(a => a.name === '舊版台新扣款帳戶')
                const importedCard = accounts.find(a => a.name === '舊版台新黑狗卡')

                expect(importedBank).toBeDefined()
                expect(importedCard).toBeDefined()
                expect(importedCard.autoPayAccountId).toBe(importedBank.id)
                expect(importedCard.autoPayAccountUuid).toBe(importedBank.uuid)
                expect(importedCard.autoPayEnabled).toBe(true)
            } finally {
                globalThis.FileReader = originalFileReader
            }
        })
    })

    describe('deduplicateAccounts alignment and self-healing', () => {
        it('aligns autoPayAccountId and autoPayAccountUuid in deduplicateAccounts', async () => {
            const bankId = await ds.addAccount({
                name: '富邦一般戶',
                type: 'wallet',
                balance: 5000,
                ledgerId: 1,
            })
            const bankAcc = await ds.getAccount(bankId)

            // Directly insert a card with mismatched autoPayAccountId (e.g. 999) but valid autoPayAccountUuid
            const cardId = await ds.addAccount({
                name: '富邦 J 卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: 999, // Broken ID
                autoPayAccountUuid: bankAcc.uuid,
                ledgerId: 1,
            })

            await ds.deduplicateAccounts()

            const repairedCard = await ds.getAccount(cardId)
            expect(repairedCard.autoPayAccountId).toBe(bankId)
            expect(repairedCard.autoPayAccountUuid).toBe(bankAcc.uuid)
        })
    })

    describe('syncService auto-pay resolution', () => {
        it('_applyAdd resolves autoPayAccountUuid to local debit account id', async () => {
            const localDebitId = await ds.addAccount({
                name: '遠端對應本機活存',
                type: 'wallet',
                uuid: 'shared-wallet-uuid-42',
                ledgerId: 1,
            })

            const remoteCardData = {
                name: '遠端新增的卡片',
                type: 'credit_card',
                uuid: 'remote-card-uuid-1',
                autoPayEnabled: true,
                autoPayAccountId: 9999, // Remote device integer ID
                autoPayAccountUuid: 'shared-wallet-uuid-42',
                ledgerId: 1,
            }

            await syncService._applyAdd('accounts', remoteCardData)

            const savedCard = await ds.getByUUID('accounts', 'remote-card-uuid-1')
            expect(savedCard).toBeDefined()
            expect(savedCard.autoPayAccountId).toBe(localDebitId)
            expect(savedCard.autoPayAccountUuid).toBe('shared-wallet-uuid-42')
        })

        it('_applyUpdateWithId resolves autoPayAccountUuid to local debit account id', async () => {
            const localDebitId = await ds.addAccount({
                name: '本機扣款戶',
                type: 'wallet',
                uuid: 'wallet-uuid-88',
                ledgerId: 1,
            })
            const localCardId = await ds.addAccount({
                name: '本機卡',
                type: 'credit_card',
                uuid: 'card-uuid-88',
                autoPayEnabled: false,
                ledgerId: 1,
            })

            const remoteUpdateData = {
                id: localCardId,
                name: '本機卡',
                type: 'credit_card',
                uuid: 'card-uuid-88',
                autoPayEnabled: true,
                autoPayAccountId: 7777, // Remote device integer ID
                autoPayAccountUuid: 'wallet-uuid-88',
                ledgerId: 1,
            }

            await syncService._applyUpdateWithId('accounts', localCardId, remoteUpdateData)

            const updatedCard = await ds.getAccount(localCardId)
            expect(updatedCard.autoPayEnabled).toBe(true)
            expect(updatedCard.autoPayAccountId).toBe(localDebitId)
            expect(updatedCard.autoPayAccountUuid).toBe('wallet-uuid-88')
        })
    })

    describe('autoPayCreditStatements self-healing', () => {
        it('self-heals and executes statement payment when autoPayAccountId was desynced but autoPayAccountUuid is valid', async () => {
            const bankId = await ds.addAccount({
                name: '中信帳戶',
                type: 'wallet',
                balance: 10000,
                ledgerId: 1,
            })
            const bankAcc = await ds.getAccount(bankId)

            const cardId = await ds.addAccount({
                name: '中信 LINE Pay 卡',
                type: 'credit_card',
                autoPayEnabled: true,
                autoPayAccountId: 999, // Mismatched ID!
                autoPayAccountUuid: bankAcc.uuid,
                ledgerId: 1,
            })

            // Add an unpaid credit statement that is due today or in the past
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
            await ds.addCreditStatement({
                accountId: cardId,
                period: '2026-10',
                amount: 3500,
                paidAmount: 0,
                dueDate: yesterday,
                status: 'unpaid',
                ledgerId: 1,
            })

            // Run autoPayCreditStatements
            const processed = await ds.autoPayCreditStatements()
            expect(processed.length).toBe(1)
            expect(processed[0].amount).toBe(3500)

            // Verify the card's autoPayAccountId was self-healed
            const repairedCard = await ds.getAccount(cardId)
            expect(repairedCard.autoPayAccountId).toBe(bankId)

            // Verify debit records were created
            const records = await ds.getRecords({ allLedgers: true })
            const debitRec = records.find(r => r.accountId === bankId && r.category === 'debt_repayment')
            expect(debitRec).toBeDefined()
            expect(debitRec.amount).toBe(3500)

            const cardRec = records.find(r => r.accountId === cardId && r.category === 'debt_repayment')
            expect(cardRec).toBeDefined()
            expect(cardRec.amount).toBe(3500)
        })
    })
})

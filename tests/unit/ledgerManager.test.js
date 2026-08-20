import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LedgerManager } from '../../src/js/ledgerManager.js'

vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
}))

const { showToast } = await import('../../src/js/utils.js')

describe('LedgerManager', () => {
    let mockDataService
    let mockApp
    let ledgerManager

    beforeEach(() => {
        mockDataService = {
            activeLedgerId: 1,
            getLedgers: vi.fn().mockResolvedValue([]),
            getLedger: vi.fn(),
            addLedger: vi.fn(),
            addAccount: vi.fn().mockResolvedValue(1),
            updateLedger: vi.fn(),
            deleteLedger: vi.fn(),
            setActiveLedger: vi.fn(),
            getAccounts: vi.fn().mockResolvedValue([]),
            exportDataForSync: vi.fn().mockResolvedValue({
                ledgers: [],
                accounts: [],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
                credit_statements: [],
                records: [],
            }),
        }

        mockApp = {
            advancedModeEnabled: false,
            accounts: [],
            budgetManager: null,
            categoryManager: null,
            updateSidebarLedger: vi.fn(),
            router: null,
            currentHash: null,
            syncService: null,
        }

        ledgerManager = new LedgerManager(mockDataService, mockApp)
    })

    describe('constructor', () => {
        it('初始化 ledgers 為空陣列', () => {
            expect(ledgerManager.ledgers).toEqual([])
        })

        it('儲存 dataService 和 app 引用', () => {
            expect(ledgerManager.dataService).toBe(mockDataService)
            expect(ledgerManager.app).toBe(mockApp)
        })
    })

    describe('init', () => {
        it('從 dataService 載入帳本清單', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' },
            ]
            mockDataService.getLedgers.mockResolvedValue(mockLedgers)

            await ledgerManager.init()

            expect(ledgerManager.ledgers).toEqual(mockLedgers)
            expect(mockDataService.getLedgers).toHaveBeenCalled()
        })
    })

    describe('getActiveLedger', () => {
        it('回傳 activeLedgerId 對應的帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' },
            ]
            ledgerManager.ledgers = mockLedgers
            mockDataService.activeLedgerId = 2

            const active = ledgerManager.getActiveLedger()

            expect(active).toEqual(mockLedgers[1])
        })

        it('找不到時回傳第一個帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' },
            ]
            ledgerManager.ledgers = mockLedgers
            mockDataService.activeLedgerId = 99

            const active = ledgerManager.getActiveLedger()

            expect(active).toEqual(mockLedgers[0])
        })

        it('沒有帳本時回傳 undefined', async () => {
            ledgerManager.ledgers = []

            const active = ledgerManager.getActiveLedger()

            expect(active).toBeUndefined()
        })
    })

    describe('getAllLedgers', () => {
        it('回傳所有帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' },
            ]
            ledgerManager.ledgers = mockLedgers

            const all = ledgerManager.getAllLedgers()

            expect(all).toEqual(mockLedgers)
        })

        it('回傳的是同一個陣列引用', async () => {
            const mockLedgers = [{ id: 1, name: 'test' }]
            ledgerManager.ledgers = mockLedgers

            const all = ledgerManager.getAllLedgers()
            expect(all).toBe(mockLedgers)
        })
    })

    describe('createLedger', () => {
        it('新增帳本時名稱重複拋出錯誤', async () => {
            const mockLedgers = [{ id: 1, name: '個人帳本' }]
            ledgerManager.ledgers = mockLedgers

            await expect(
                ledgerManager.createLedger({ name: '個人帳本' })
            ).rejects.toThrow('已存在同名帳本')
        })

        it('新增帳本時呼叫 dataService.addLedger 與 addAccount', async () => {
            ledgerManager.ledgers = []
            mockDataService.addLedger.mockResolvedValue(2)

            await ledgerManager.createLedger({ name: '新帳本' })

            expect(mockDataService.addLedger).toHaveBeenCalledWith(
                expect.objectContaining({ name: '新帳本' })
            )
            expect(mockDataService.addAccount).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '現金',
                    type: 'cash',
                    ledgerId: 2,
                })
            )
        })

        it('新增帳本時使用預設圖示', async () => {
            ledgerManager.ledgers = []
            mockDataService.addLedger.mockResolvedValue(2)

            await ledgerManager.createLedger({ name: '新帳本' })

            expect(mockDataService.addLedger).toHaveBeenCalledWith(
                expect.objectContaining({ icon: 'fa-solid fa-book' })
            )
        })
    })

    describe('updateLedger', () => {
        it('更新名稱時呼叫 dataService.updateLedger', async () => {
            await ledgerManager.updateLedger(1, { name: '新名稱' })

            expect(mockDataService.updateLedger).toHaveBeenCalledWith(1, {
                name: '新名稱',
            })
        })

        it('更新圖示時呼叫 dataService.updateLedger', async () => {
            await ledgerManager.updateLedger(1, { icon: 'fa-solid fa-star' })

            expect(mockDataService.updateLedger).toHaveBeenCalledWith(1, {
                icon: 'fa-solid fa-star',
            })
        })

        it('更新顏色時呼叫 dataService.updateLedger', async () => {
            await ledgerManager.updateLedger(1, { color: '#FF0000' })

            expect(mockDataService.updateLedger).toHaveBeenCalledWith(1, {
                color: '#FF0000',
            })
        })

        it('更新後重新載入帳本清單', async () => {
            await ledgerManager.updateLedger(1, { name: '新名稱' })

            expect(mockDataService.getLedgers).toHaveBeenCalled()
        })
    })

    describe('switchLedger', () => {
        it('帳本不存在時顯示錯誤提示並 return', async () => {
            mockDataService.getLedger.mockResolvedValue(null)

            await ledgerManager.switchLedger(99)

            expect(showToast).toHaveBeenCalledWith('帳本不存在', 'error')
            expect(mockDataService.setActiveLedger).not.toHaveBeenCalled()
        })

        it('成功切換時呼叫 setActiveLedger', async () => {
            const mockLedger = { id: 2, name: '公司帳本' }
            mockDataService.getLedger.mockResolvedValue(mockLedger)

            await ledgerManager.switchLedger(2)

            expect(mockDataService.setActiveLedger).toHaveBeenCalledWith(2)
        })

        it('切換時更新 sidebar', async () => {
            const mockLedger = { id: 2, name: '公司帳本' }
            mockDataService.getLedger.mockResolvedValue(mockLedger)

            await ledgerManager.switchLedger(2)

            expect(mockApp.updateSidebarLedger).toHaveBeenCalled()
        })

        it('advancedMode 啟用時載入帳戶清單', async () => {
            const mockLedger = { id: 2, name: '公司帳本', isShared: false }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockApp.advancedModeEnabled = true
            mockDataService.getAccounts.mockResolvedValue([
                { id: 1, name: '現金', balance: 1000 },
            ])

            await ledgerManager.switchLedger(2)

            expect(mockDataService.getAccounts).toHaveBeenCalled()
            expect(mockApp.accounts).toEqual([
                { id: 1, name: '現金', balance: 1000 },
            ])
        })

        it('advancedMode 帳戶為空且非共用時建立預設現金帳戶', async () => {
            const mockLedger = { id: 2, name: '公司帳本', isShared: false }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockApp.advancedModeEnabled = true
            mockDataService.getAccounts
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { id: 10, name: '現金', balance: 0, type: 'cash' },
                ])

            await ledgerManager.switchLedger(2)

            expect(mockDataService.addAccount).toHaveBeenCalledWith(
                expect.objectContaining({ name: '現金', type: 'cash', ledgerId: 2 })
            )
            expect(mockApp.accounts).toEqual([
                { id: 10, name: '現金', balance: 0, type: 'cash' },
            ])
        })

        it('advancedMode 帳戶為空但共用帳本不建立預設帳戶', async () => {
            const mockLedger = { id: 2, name: '共用帳本', isShared: true }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockApp.advancedModeEnabled = true
            mockDataService.getAccounts.mockResolvedValue([])

            await ledgerManager.switchLedger(2)

            expect(mockDataService.addAccount).not.toHaveBeenCalled()
        })

        it('存在 budgetManager 時呼叫 loadBudget', async () => {
            const mockLedger = { id: 2, name: '公司帳本' }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockApp.budgetManager = { loadBudget: vi.fn().mockResolvedValue() }

            await ledgerManager.switchLedger(2)

            expect(mockApp.budgetManager.loadBudget).toHaveBeenCalled()
        })

        it('存在 categoryManager 時呼叫 init', async () => {
            const mockLedger = { id: 2, name: '公司帳本' }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockApp.categoryManager = { init: vi.fn().mockResolvedValue() }

            await ledgerManager.switchLedger(2)

            expect(mockApp.categoryManager.init).toHaveBeenCalled()
        })
    })

    describe('deleteLedger', () => {
        it('刪除帳本時呼叫 dataService.deleteLedger 並重載清單', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' },
            ]
            ledgerManager.ledgers = mockLedgers
            mockDataService.getLedgers.mockResolvedValue([
                { id: 2, name: '公司帳本' },
            ])

            await ledgerManager.deleteLedger(1)

            expect(mockDataService.deleteLedger).toHaveBeenCalledWith(1)
            expect(mockDataService.getLedgers).toHaveBeenCalled()
            expect(ledgerManager.ledgers).toEqual([{ id: 2, name: '公司帳本' }])
        })
    })

    describe('shareLedger', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                isSignedIn: vi.fn().mockReturnValue(true),
                _createSharedFile: vi
                    .fn()
                    .mockResolvedValue({ id: 'file123' }),
                grantFilePermission: vi.fn(),
                _updateFile: vi.fn().mockResolvedValue(),
                ensureSharedSync: vi.fn().mockResolvedValue(),
                deviceId: 'device-001',
            }
            mockApp.syncService = mockSyncService
        })

        it('未登入時拋出錯誤', async () => {
            mockSyncService.isSignedIn.mockReturnValue(false)

            await expect(
                ledgerManager.shareLedger(1, 'user@test.com')
            ).rejects.toThrow('請先在設定中登入 Google 同步功能')
        })

        it('帳本不存在時拋出錯誤', async () => {
            mockDataService.getLedger.mockResolvedValue(null)

            await expect(
                ledgerManager.shareLedger(1, 'user@test.com')
            ).rejects.toThrow('帳本不存在')
        })

        it('已共用的帳本僅新增權限', async () => {
            const mockLedger = {
                id: 1,
                name: '共用帳本',
                uuid: 'ledger-uuid',
                isShared: true,
                sharedFileId: 'existing-file',
            }
            mockDataService.getLedger.mockResolvedValue(mockLedger)

            const result = await ledgerManager.shareLedger(1, 'new@test.com')

            expect(mockSyncService.grantFilePermission).toHaveBeenCalledWith(
                'existing-file',
                'new@test.com'
            )
            expect(mockSyncService._createSharedFile).not.toHaveBeenCalled()
            expect(result).toBe('existing-file')
        })

        it('新共用流程建立雲端檔案並設定權限', async () => {
            const mockLedger = {
                id: 1,
                name: '個人帳本',
                uuid: 'ledger-uuid',
                isShared: false,
            }
            mockDataService.getLedger.mockResolvedValue(mockLedger)

            const result = await ledgerManager.shareLedger(1, 'user@test.com')

            expect(mockSyncService._createSharedFile).toHaveBeenCalledWith(
                'EasyAccounting_Shared_ledger-uuid.json',
                '{}'
            )
            expect(mockSyncService.grantFilePermission).toHaveBeenCalledWith(
                'file123',
                'user@test.com'
            )
            expect(mockDataService.updateLedger).toHaveBeenCalledWith(1, {
                isShared: true,
                sharedFileId: 'file123',
                type: 'shared',
            })
            expect(mockDataService.getLedgers).toHaveBeenCalled()
            expect(mockSyncService.ensureSharedSync).toHaveBeenCalled()
            expect(result).toBe('file123')
        })

        it('新共用流程的初始雲端檔案包含 groupMeta（明細群組）', async () => {
            const mockLedger = {
                id: 1,
                name: '個人帳本',
                uuid: 'ledger-uuid',
                isShared: false,
            }
            mockDataService.getLedger.mockResolvedValue(mockLedger)
            mockDataService.exportDataForSync.mockResolvedValue({
                ledgers: [{ id: 1, name: '個人帳本', uuid: 'ledger-uuid' }],
                groupMeta: [
                    { id: 1, name: '聚餐群組', ledgerId: 1, uuid: 'gm-1' },
                ],
                accounts: [{ id: 1, name: '帳戶', ledgerId: 1, uuid: 'ac-1' }],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
                credit_statements: [],
                records: [{ id: 1, ledgerId: 1, uuid: 'rec-1' }],
            })

            await ledgerManager.shareLedger(1, 'user@test.com')

            // 解析寫入雲端檔案的初始資料
            const updateCall = mockSyncService._updateFile.mock.calls.find(
                c => c[0] === 'file123'
            )
            expect(updateCall).toBeDefined()
            const payload = JSON.parse(updateCall[1])
            const storeNames = payload.changes.map(c => c.storeName)

            // groupMeta 必須被包含（曾遺漏導致共用帳本接收方無群組資料）
            expect(storeNames).toContain('groupMeta')
            const gmChange = payload.changes.find(
                c => c.storeName === 'groupMeta'
            )
            expect(gmChange.data).toEqual({
                id: 1,
                name: '聚餐群組',
                ledgerId: 1,
                uuid: 'gm-1',
            })
            // 其他 store 仍完整
            expect(storeNames).toContain('ledgers')
            expect(storeNames).toContain('accounts')
            expect(storeNames).toContain('records')
        })
    })

    describe('joinSharedLedger', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                isSignedIn: vi.fn().mockReturnValue(true),
                _downloadFile: vi.fn(),
                applyRemoteChanges: vi.fn().mockResolvedValue(),
                ensureSharedSync: vi.fn().mockResolvedValue(),
            }
            mockApp.syncService = mockSyncService
            mockDataService.getSetting = vi.fn().mockResolvedValue(null)
            mockDataService.saveSetting = vi.fn().mockResolvedValue()
        })

        it('未登入時拋出錯誤', async () => {
            mockSyncService.isSignedIn.mockReturnValue(false)

            await expect(
                ledgerManager.joinSharedLedger('file456')
            ).rejects.toThrow('請先在設定中登入 Google 同步功能')
        })

        it('無效的共用檔案拋出錯誤', async () => {
            mockSyncService._downloadFile.mockResolvedValue({ data: null })

            await expect(
                ledgerManager.joinSharedLedger('file456')
            ).rejects.toThrow('無效的共用帳本檔案或無讀取權限')
        })

        it('成功加入共用帳本後呼叫 init', async () => {
            const mockChanges = [
                {
                    storeName: 'ledgers',
                    operation: 'add',
                    data: { uuid: 'shared-uuid', name: '共用帳本' },
                },
            ]
            mockSyncService._downloadFile.mockResolvedValue({
                data: { changes: mockChanges },
            })
            mockDataService.getLedgers.mockResolvedValue([
                { id: 5, uuid: 'shared-uuid', name: '共用帳本' },
            ])

            const result = await ledgerManager.joinSharedLedger('file456')

            expect(mockSyncService.applyRemoteChanges).toHaveBeenCalledWith(
                mockChanges
            )
            expect(mockDataService.updateLedger).toHaveBeenCalledWith(5, {
                isShared: true,
                sharedFileId: 'file456',
                type: 'shared',
            })
            expect(mockDataService.getLedgers).toHaveBeenCalled()
            expect(result).toBe(5)
        })
    })

    describe('getSharedUsers', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                getFilePermissions: vi.fn(),
            }
            mockApp.syncService = mockSyncService
        })

        it('回傳共用使用者清單', async () => {
            const mockUsers = [
                { emailAddress: 'owner@test.com', role: 'owner' },
                { emailAddress: 'user@test.com', role: 'writer' },
            ]
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockResolvedValue(mockUsers)

            const users = await ledgerManager.getSharedUsers(1)

            expect(users).toEqual(mockUsers)
            expect(mockSyncService.getFilePermissions).toHaveBeenCalledWith(
                'file123'
            )
        })

        it('未共用的帳本拋出錯誤', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: null,
            })

            await expect(ledgerManager.getSharedUsers(1)).rejects.toThrow(
                '此帳本尚未共用'
            )
        })
    })

    describe('removeSharedUser', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                removeFilePermission: vi.fn(),
            }
            mockApp.syncService = mockSyncService
        })

        it('呼叫 syncService.removeFilePermission', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })

            await ledgerManager.removeSharedUser(1, 'perm456')

            expect(
                mockSyncService.removeFilePermission
            ).toHaveBeenCalledWith('file123', 'perm456')
        })

        it('未共用的帳本拋出錯誤', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: null,
            })

            await expect(
                ledgerManager.removeSharedUser(1, 'perm456')
            ).rejects.toThrow('此帳本尚未共用')
        })
    })

    describe('isLedgerOwner', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                getFilePermissions: vi.fn(),
                userInfo: { email: 'me@test.com' },
            }
            mockApp.syncService = mockSyncService
        })

        it('自己是擁有者回傳 true', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockResolvedValue([
                { emailAddress: 'me@test.com', role: 'owner' },
            ])

            const result = await ledgerManager.isLedgerOwner(1)

            expect(result).toBe(true)
        })

        it('自己不是擁有者回傳 false', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockResolvedValue([
                { emailAddress: 'other@test.com', role: 'owner' },
            ])

            const result = await ledgerManager.isLedgerOwner(1)

            expect(result).toBe(false)
        })

        it('發生錯誤時回傳 false', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockRejectedValue(
                new Error('API error')
            )

            const result = await ledgerManager.isLedgerOwner(1)

            expect(result).toBe(false)
        })
    })

    describe('unshareLedger', () => {
        let mockSyncService

        beforeEach(() => {
            mockSyncService = {
                getFilePermissions: vi.fn(),
                deleteFile: vi.fn().mockResolvedValue(),
                userInfo: { email: 'me@test.com' },
            }
            mockApp.syncService = mockSyncService
        })

        it('未共用的帳本拋出錯誤', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: null,
            })

            await expect(ledgerManager.unshareLedger(1)).rejects.toThrow(
                '此帳本尚未共用'
            )
        })

        it('非擁有者拋出錯誤', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockResolvedValue([
                { emailAddress: 'other@test.com', role: 'owner' },
            ])

            await expect(ledgerManager.unshareLedger(1)).rejects.toThrow(
                '只有擁有者才能取消共用'
            )
        })

        it('擁有者取消共用時刪除雲端檔案並還原帳本', async () => {
            mockDataService.getLedger.mockResolvedValue({
                id: 1,
                sharedFileId: 'file123',
            })
            mockSyncService.getFilePermissions.mockResolvedValue([
                { emailAddress: 'me@test.com', role: 'owner' },
            ])

            await ledgerManager.unshareLedger(1)

            expect(mockSyncService.deleteFile).toHaveBeenCalledWith('file123')
            expect(mockDataService.updateLedger).toHaveBeenCalledWith(1, {
                isShared: false,
                sharedFileId: null,
                type: 'personal',
            })
            expect(mockDataService.getLedgers).toHaveBeenCalled()
        })
    })

    describe('getColorOptions', () => {
        it('回傳顏色選項陣列', () => {
            const colors = ledgerManager.getColorOptions()
            expect(Array.isArray(colors)).toBe(true)
            expect(colors.length).toBeGreaterThan(0)
            expect(colors[0]).toBe('#334A52')
        })
    })

    describe('getIconOptions', () => {
        it('回傳圖示選項陣列', () => {
            const icons = ledgerManager.getIconOptions()
            expect(Array.isArray(icons)).toBe(true)
            expect(icons.length).toBeGreaterThan(0)
            expect(icons[0]).toBe('fa-solid fa-book')
        })
    })
})

// ==================== SyncService 單元測試 ====================
// 測試重點：isSignedIn、isTokenExpiringSoon、getDeviceId、getServerUrl、setServerUrl
// 涉及網路的 method (signIn, backupToDrive, sync 等) 不在此測試

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────

// 避免實際載入原生 Google Auth 模組
vi.mock('@codetrix-studio/capacitor-google-auth', () => ({
    GoogleAuth: {
        initialize: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
    },
}))

// Mock utils.js
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(() => Promise.resolve(true)),
    customAlert: vi.fn(),
}))

// 模擬 Capacitor — 非原生
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}))

// 在 import SyncService 之前設定 globalThis.Capacitor
globalThis.Capacitor = { isNativePlatform: () => false }

// 注意: vi.stubGlobal('import.meta.env') 對已載入模組無效（import.meta.env 是 Vite
// build 時注入的常量）。此 stub 僅表意，實際 env 值取決於 .env.local 是否存在。
// 若未來加入 .env.local 設定 VITE_SYNC_SERVER_URL，需要改用 vi.stubEnv。
vi.stubGlobal('import.meta.env', {
    VITE_GOOGLE_CLIENT_ID: 'test-client-id',
    VITE_GOOGLE_API_KEY: 'test-api-key',
    VITE_SYNC_SERVER_URL: undefined,
})

import { SyncService } from '../../src/js/syncService.js'

// ── Helpers ──────────────────────────────────────────

/** 建立最小化 DataService mock */
function createMockDataService(overrides = {}) {
    const settings = {}
    const ledgers = []
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async key => {
            const val = settings[key]
            return val !== undefined ? { key, value: val } : null
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value
            return true
        }),
        getCategorySetting: vi.fn(async () => null),
        saveCategorySetting: vi.fn(async () => true),
        logChange: vi.fn(),
        getLedgers: vi.fn(async () => ledgers),
        exportDataForSync: vi.fn(async () => ({ records: [] })),
        importDataFromSync: vi.fn(async () => true),
        ...overrides,
    }
}

/** 建立 SyncService 實例 */
function createSyncService(ds) {
    return new SyncService(ds)
}

// ── 測試 ─────────────────────────────────────────────

describe('SyncService', () => {
    let ss, ds

    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        vi.restoreAllMocks()
        ds = createMockDataService()
        ss = createSyncService(ds)
    })

    afterEach(() => {
        // 清理定時器
        ss.stopAutoSync()
        ss.stopAutoBackup()
    })

    // ── Constructor ──────────────────────────────────

    describe('constructor', () => {
        it('初始狀態正確', () => {
            expect(ss.accessToken).toBeNull()
            expect(ss.refreshToken).toBeNull()
            expect(ss.tokenExpiresAt).toBeNull()
            expect(ss.userInfo).toBeNull()
            expect(ss._syncing).toBe(false)
        })

        it('使用預設伺服器 URL', () => {
            expect(ss.getServerUrl()).toBe(
                'https://jijun-server.the-walking-fish.com'
            )
        })

        it('產生 deviceId 並存入 localStorage', () => {
            const id = ss.deviceId
            expect(id).toBeDefined()
            expect(typeof id).toBe('string')
            expect(id.startsWith('dev_')).toBe(true)
            expect(localStorage.getItem('sync_device_id')).toBe(id)
        })

        it('讀取已有的 deviceId 從 localStorage', () => {
            localStorage.setItem('sync_device_id', 'dev_existing_12345')
            const ss2 = createSyncService(createMockDataService())
            expect(ss2.deviceId).toBe('dev_existing_12345')
            ss2.stopAutoSync()
            ss2.stopAutoBackup()
        })
    })

    // ── isSignedIn ───────────────────────────────────

    describe('isSignedIn', () => {
        it('沒有 token 時回傳 false', () => {
            expect(ss.isSignedIn()).toBe(false)
        })

        it('只有 accessToken 時回傳 false', () => {
            ss.accessToken = 'abc123'
            expect(ss.isSignedIn()).toBe(false)
        })

        it('只有 refreshToken 時回傳 false', () => {
            ss.refreshToken = 'xyz789'
            expect(ss.isSignedIn()).toBe(false)
        })

        it('兩個 token 都有時回傳 true', () => {
            ss.accessToken = 'abc123'
            ss.refreshToken = 'xyz789'
            expect(ss.isSignedIn()).toBe(true)
        })
    })

    // ── isTokenExpiringSoon ──────────────────────────

    describe('isTokenExpiringSoon', () => {
        it('沒有 expiresAt 時回傳 true（視為即將過期）', () => {
            ss.tokenExpiresAt = null
            expect(ss.isTokenExpiringSoon()).toBe(true)
        })

        it('token 遠未過期時回傳 false', () => {
            // 3600 秒後過期
            ss.tokenExpiresAt = Date.now() + 3600 * 1000
            expect(ss.isTokenExpiringSoon()).toBe(false)
        })

        it('token 剛好 5 分鐘後過期時回傳 false（臨界值不算過期）', () => {
            const now = Date.now()
            ss.tokenExpiresAt = now + 5 * 60 * 1000 + 100
            expect(ss.isTokenExpiringSoon()).toBe(false)
        })

        it('token 已過期時回傳 true', () => {
            ss.tokenExpiresAt = Date.now() - 1000
            expect(ss.isTokenExpiringSoon()).toBe(true)
        })

        it('token 4 分鐘 59 秒後過期時回傳 true', () => {
            ss.tokenExpiresAt = Date.now() + 4 * 60 * 1000 + 59 * 1000
            expect(ss.isTokenExpiringSoon()).toBe(true)
        })

        it('token 5 分鐘零 1 秒後過期時回傳 false', () => {
            ss.tokenExpiresAt = Date.now() + 5 * 60 * 1000 + 1 * 1000
            expect(ss.isTokenExpiringSoon()).toBe(false)
        })
    })

    // ── getDeviceId ──────────────────────────────────

    describe('getDeviceId', () => {
        it('第一次呼叫產生新 ID 並存入 localStorage', () => {
            localStorage.removeItem('sync_device_id')
            const ss2 = createSyncService(createMockDataService())
            const id = ss2.getDeviceId()
            expect(id).toBeDefined()
            expect(localStorage.getItem('sync_device_id')).toBe(id)
            ss2.stopAutoSync()
            ss2.stopAutoBackup()
        })

        it('第二次呼叫回傳相同的 ID', () => {
            localStorage.setItem('sync_device_id', 'dev_persistent_id')
            const ss2 = createSyncService(createMockDataService())
            const id1 = ss2.getDeviceId()
            const id2 = ss2.getDeviceId()
            expect(id1).toBe(id2)
            expect(id1).toBe('dev_persistent_id')
            ss2.stopAutoSync()
            ss2.stopAutoBackup()
        })

        it('ID 格式為 dev_ 開頭', () => {
            localStorage.removeItem('sync_device_id')
            const ss2 = createSyncService(createMockDataService())
            const id = ss2.getDeviceId()
            expect(id).toMatch(/^dev_/)
            ss2.stopAutoSync()
            ss2.stopAutoBackup()
        })
    })

    // ── getServerUrl / setServerUrl ──────────────────

    describe('getServerUrl / setServerUrl', () => {
        it('預設回傳 DEFAULT_SERVER_URL', () => {
            expect(ss.getServerUrl()).toBe(
                'https://jijun-server.the-walking-fish.com'
            )
        })

        it('setServerUrl 更新 URL', async () => {
            await ss.setServerUrl('https://custom.server.com')
            expect(ss.getServerUrl()).toBe('https://custom.server.com')
            expect(ds.saveSetting).toHaveBeenCalledWith({
                key: 'sync_server_url',
                value: 'https://custom.server.com',
            })
        })

        it('setServerUrl 移除結尾斜線', async () => {
            await ss.setServerUrl('https://custom.server.com/')
            expect(ss.getServerUrl()).toBe('https://custom.server.com')
        })

        it('setServerUrl 移除多個結尾斜線', async () => {
            await ss.setServerUrl('https://custom.server.com///')
            expect(ss.getServerUrl()).toBe('https://custom.server.com')
        })
    })

    // ── saveTokens ───────────────────────────────────

    describe('saveTokens', () => {
        it('正確呼叫 saveSetting 儲存 token 資料', async () => {
            ss.accessToken = 'access_token_123'
            ss.refreshToken = 'refresh_token_456'
            ss.tokenExpiresAt = Date.now() + 3600000
            ss.userInfo = { email: 'test@example.com' }

            await ss.saveTokens()

            expect(ds.saveSetting).toHaveBeenCalledWith({
                key: 'sync_tokens',
                value: {
                    access_token: 'access_token_123',
                    refresh_token: 'refresh_token_456',
                    expires_at: expect.any(Number),
                    user_info: { email: 'test@example.com' },
                },
            })
        })
    })

    // ── signOut ──────────────────────────────────────

    describe('signOut', () => {
        it('清除所有 token 和狀態', async () => {
            ss.accessToken = 'access_token'
            ss.refreshToken = 'refresh_token'
            ss.tokenExpiresAt = Date.now() + 1000
            ss.userInfo = { email: 'test@test.com' }

            await ss.signOut()

            expect(ss.accessToken).toBeNull()
            expect(ss.refreshToken).toBeNull()
            expect(ss.tokenExpiresAt).toBeNull()
            expect(ss.userInfo).toBeNull()
        })

        it('清除相關設定', async () => {
            ss.accessToken = 'access_token'
            ss.refreshToken = 'refresh_token'

            await ss.signOut()

            // 檢查 sync_tokens 被設為 null
            const saveCalls = ds.saveSetting.mock.calls
            expect(
                saveCalls.some(
                    c => c[0].key === 'sync_tokens' && c[0].value === null
                )
            ).toBe(true)
            expect(
                saveCalls.some(
                    c =>
                        c[0].key === 'sync_auto_enabled' && c[0].value === false
                )
            ).toBe(true)
            expect(
                saveCalls.some(
                    c =>
                        c[0].key === 'sync_auto_backup_enabled' &&
                        c[0].value === false
                )
            ).toBe(true)
            expect(
                saveCalls.some(
                    c =>
                        c[0].key === 'sync_drive_file_authorized' &&
                        c[0].value === false
                )
            ).toBe(true)
        })
    })

    // ── stopAutoSync / stopAutoBackup ────────────────

    describe('stopAutoSync / stopAutoBackup', () => {
        it('stopAutoSync 在非原生平台上安全執行', () => {
            expect(() => ss.stopAutoSync()).not.toThrow()
        })

        it('stopAutoBackup 安全執行', () => {
            expect(() => ss.stopAutoBackup()).not.toThrow()
        })

        it('多次呼叫 stopAutoSync 不丟錯', () => {
            ss.stopAutoSync()
            ss.stopAutoSync()
            ss.stopAutoSync()
        })

        it('多次呼叫 stopAutoBackup 不丟錯', () => {
            ss.stopAutoBackup()
            ss.stopAutoBackup()
        })
    })

    // ── isSharingAuthorized / ensureSharingPermission ─

    describe('isSharingAuthorized', () => {
        it('沒有設定時回傳 false', async () => {
            const result = await ss.isSharingAuthorized()
            expect(result).toBe(false)
        })

        it('設定為 true 時回傳 true', async () => {
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_drive_file_authorized') {
                    return { key, value: true }
                }
                return null
            })
            const result = await ss.isSharingAuthorized()
            expect(result).toBe(true)
        })

        it('設定為 false 時回傳 false', async () => {
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_drive_file_authorized') {
                    return { key, value: false }
                }
                return null
            })
            const result = await ss.isSharingAuthorized()
            expect(result).toBe(false)
        })
    })

    // ── ensureValidToken ─────────────────────────────

    describe('ensureValidToken', () => {
        it('有有效 token 時不拋錯', async () => {
            ss.accessToken = 'valid_token'
            ss.refreshToken = 'refresh_token'
            ss.tokenExpiresAt = Date.now() + 3600000 // 1 小時後過期

            // 需要 mock refreshAccessToken 避免實際呼叫
            ss.refreshAccessToken = vi.fn().mockResolvedValue(undefined)

            await expect(ss.ensureValidToken()).resolves.not.toThrow()
        })

        it('沒有 accessToken 時拋錯', async () => {
            ss.accessToken = null
            ss.refreshToken = null

            await expect(ss.ensureValidToken()).rejects.toThrow('Not signed in')
        })

        it('token 過期但有 refreshToken 時嘗試刷新', async () => {
            ss.accessToken = 'old_token'
            ss.refreshToken = 'refresh_token'
            ss.tokenExpiresAt = Date.now() - 1000 // 已過期

            const refreshSpy = vi.fn().mockResolvedValue(undefined)
            ss.refreshAccessToken = refreshSpy

            await ss.ensureValidToken()
            expect(refreshSpy).toHaveBeenCalled()
        })
    })

    // ── P01: UUID-based update for recurring_transactions ──
    describe('P01: _applyUpdate recurring_transactions uses UUID lookup', () => {
        let ds, ss
        const recurringUuid = 'rt-uuid-001'

        beforeEach(() => {
            vi.clearAllMocks()
            ds = createMockDataService({
                getByUUID: vi.fn(async (storeName, uuid) => {
                    // _applyUpdate 內部會查, 我的 fix 也會查 — 回傳相同的
                    if (storeName === 'recurring_transactions' && uuid === recurringUuid) {
                        return { id: 42, uuid: recurringUuid }
                    }
                    return null
                }),
                updateRecurringTransaction: vi.fn(async () => true),
                addRecurringTransaction: vi.fn(async () => 1),
                getAccounts: vi.fn(async () => []),
                getLedgers: vi.fn(async () => []),
            })
            ss = createSyncService(ds)
        })

        it('當 UUID 存在時，用 getByUUID 找到本地 ID 並更新', async () => {
            await ss._applyUpdate(
                'recurring_transactions',
                999, // 遠端 ID
                { uuid: recurringUuid, amount: 200 }
            )

            // _applyUpdate 內部 getByUUID → _applyUpdateWithId(42) → 我的 fix getByUUID(42)
            expect(ds.updateRecurringTransaction).toHaveBeenCalledWith(
                42,
                expect.any(Object),
                true
            )
            // 不應走 _applyAdd
            expect(ds.addRecurringTransaction).not.toHaveBeenCalled()
        })

        it('沒有 UUID 的資料時，走 legacy fallback（不更新）', async () => {
            await ss._applyUpdate(
                'recurring_transactions',
                55,
                { amount: 300 } // 沒有 uuid
            )

            // Legacy: 沒有 UUID 就只是 console.warn，不執行更新
            expect(ds.updateRecurringTransaction).not.toHaveBeenCalled()
            expect(ds.addRecurringTransaction).not.toHaveBeenCalled()
        })
    })

    // ── P01: _applyAdd for recurring_transactions ──
    describe('P01: _applyAdd recurring_transactions', () => {
        let ds, ss

        beforeEach(() => {
            vi.clearAllMocks()
            ds = createMockDataService({
                addRecurringTransaction: vi.fn(async () => 42),
                getByUUID: vi.fn(async () => null),
                getLedgers: vi.fn(async () => []),
                getAccounts: vi.fn(async () => []),
            })
            ss = createSyncService(ds)
        })

        it('_applyAdd("recurring_transactions", data) 應呼叫 addRecurringTransaction', async () => {
            await ss._applyAdd('recurring_transactions', {
                type: 'expense',
                amount: 100,
                frequency: 'monthly',
                interval: 1,
                nextDueDate: '2026-08-01',
                uuid: 'rt-uuid-add-1',
            })

            expect(ds.addRecurringTransaction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'expense',
                    amount: 100,
                    uuid: 'rt-uuid-add-1',
                })
            )
        })

        it('應先解析 ledgerId 和 accountId（透過 _resolveLedgerId 與 _resolveRecurringAccountId）', async () => {
            ds.getLedgers = vi.fn(async () => [
                { id: 5, uuid: 'ledger-uu-5', name: '工作帳本' },
            ])
            ds.getAccounts = vi.fn(async () => [
                { id: 20, uuid: 'acc-uu-20', name: '銀行' },
            ])

            await ss._applyAdd('recurring_transactions', {
                type: 'expense',
                amount: 200,
                frequency: 'weekly',
                interval: 2,
                nextDueDate: '2026-08-15',
                ledgerUuid: 'ledger-uu-5',
                accountUuid: 'acc-uu-20',
                uuid: 'rt-uuid-add-2',
            })

            expect(ds.addRecurringTransaction).toHaveBeenCalledWith(
                expect.objectContaining({
                    ledgerId: 5,
                    accountId: 20,
                    amount: 200,
                })
            )
        })
    })

    // ── P01: _applyDelete for recurring_transactions ──
    describe('P01: _applyDelete recurring_transactions uses UUID lookup', () => {
        let ds, ss

        beforeEach(() => {
            vi.clearAllMocks()
        })

        it('_applyDelete("recurring_transactions", id, {uuid}) 應透過 UUID 查找後刪除', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async (storeName, uuid) => {
                    if (storeName === 'recurring_transactions' && uuid === 'rt-uuid-del-1') {
                        return { id: 77, uuid: 'rt-uuid-del-1' }
                    }
                    return null
                }),
                deleteRecurringTransaction: vi.fn(async () => true),
            })
            ss = createSyncService(ds)

            await ss._applyDelete('recurring_transactions', 999, {
                uuid: 'rt-uuid-del-1',
            })

            expect(ds.getByUUID).toHaveBeenCalledWith(
                'recurring_transactions',
                'rt-uuid-del-1'
            )
            expect(ds.deleteRecurringTransaction).toHaveBeenCalledWith(77, true)
        })

        it('UUID 不存在時應靜默跳過', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async () => null),
                deleteRecurringTransaction: vi.fn(async () => true),
            })
            ss = createSyncService(ds)

            await ss._applyDelete('recurring_transactions', 999, {
                uuid: 'rt-uuid-nonexistent',
            })

            expect(ds.getByUUID).toHaveBeenCalledWith(
                'recurring_transactions',
                'rt-uuid-nonexistent'
            )
            expect(ds.deleteRecurringTransaction).not.toHaveBeenCalled()
        })
    })

    // ── P03: _applyUpdate upsert（UUID 不存在 → _applyAdd）──
    describe('P03: _applyUpdate upsert branch', () => {
        it('UUID 找不到時應轉為 _applyAdd（upsert）', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async () => null),
            })
            ss = createSyncService(ds)
            const applyAddSpy = vi.spyOn(ss, '_applyAdd').mockResolvedValue()

            await ss._applyUpdate('accounts', 999, {
                uuid: 'acc-uuid-new-1',
                name: '新帳戶',
            })

            expect(applyAddSpy).toHaveBeenCalledWith(
                'accounts',
                expect.objectContaining({ uuid: 'acc-uuid-new-1' })
            )
        })

        it('UUID 存在時走 _applyUpdateWithId 而非 _applyAdd', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async (storeName, uuid) =>
                    uuid === 'acc-uuid-exist' ? { id: 42, uuid: 'acc-uuid-exist' } : null
                ),
            })
            ss = createSyncService(ds)
            const updateWithIdSpy = vi
                .spyOn(ss, '_applyUpdateWithId')
                .mockResolvedValue()
            const applyAddSpy = vi.spyOn(ss, '_applyAdd').mockResolvedValue()

            await ss._applyUpdate('accounts', 999, {
                uuid: 'acc-uuid-exist',
                name: '既有帳戶',
            })

            expect(updateWithIdSpy).toHaveBeenCalledWith(
                'accounts',
                42,
                expect.objectContaining({ uuid: 'acc-uuid-exist' })
            )
            expect(applyAddSpy).not.toHaveBeenCalled()
        })
    })

    // ── P03: refreshAccessToken（401 → signOut）──
    describe('refreshAccessToken', () => {
        const originalFetch = globalThis.fetch

        beforeEach(() => {
            ss.refreshToken = 'refresh_token_123'
        })

        afterEach(() => {
            globalThis.fetch = originalFetch
        })

        it('沒有 refreshToken 時拋錯', async () => {
            ss.refreshToken = null
            await expect(ss.refreshAccessToken()).rejects.toThrow(
                'No refresh token'
            )
        })

        it('401 回應時呼叫 signOut 並拋出 Session expired', async () => {
            globalThis.fetch = vi
                .fn()
                .mockResolvedValue({ ok: false, status: 401 })
            const signOutSpy = vi.spyOn(ss, 'signOut').mockResolvedValue()

            await expect(ss.refreshAccessToken()).rejects.toThrow(
                'Session expired, please sign in again'
            )
            expect(signOutSpy).toHaveBeenCalledTimes(1)
        })

        it('400 回應時也呼叫 signOut', async () => {
            globalThis.fetch = vi
                .fn()
                .mockResolvedValue({ ok: false, status: 400 })
            const signOutSpy = vi.spyOn(ss, 'signOut').mockResolvedValue()

            await expect(ss.refreshAccessToken()).rejects.toThrow(
                'Session expired, please sign in again'
            )
            expect(signOutSpy).toHaveBeenCalledTimes(1)
        })

        it('其他狀態碼拋出 Token refresh failed 且不 signOut', async () => {
            globalThis.fetch = vi
                .fn()
                .mockResolvedValue({ ok: false, status: 500 })
            const signOutSpy = vi.spyOn(ss, 'signOut').mockResolvedValue()

            await expect(ss.refreshAccessToken()).rejects.toThrow(
                'Token refresh failed (500)'
            )
            expect(signOutSpy).not.toHaveBeenCalled()
        })

        it('成功時更新 accessToken 並呼叫 saveTokens', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'new_access_token',
                    expires_in: 7200,
                }),
            })
            ss.saveTokens = vi.fn().mockResolvedValue()

            await ss.refreshAccessToken()

            expect(ss.accessToken).toBe('new_access_token')
            expect(ss.tokenExpiresAt).toBeGreaterThan(Date.now())
            expect(ss.saveTokens).toHaveBeenCalledTimes(1)
        })
    })

    // ── P03: init() 流程 ──
    describe('init()', () => {
        it('從設定還原 token 與 serverUrl', async () => {
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_tokens') {
                    return {
                        key,
                        value: {
                            access_token: 'restored_access',
                            refresh_token: 'restored_refresh',
                            expires_at: Date.now() + 3600000,
                            user_info: { email: 'user@example.com' },
                        },
                    }
                }
                if (key === 'sync_server_url') {
                    return { key, value: 'https://custom.server.com' }
                }
                return null
            })
            ds.getLedgers = vi.fn(async () => [])

            await ss.init()

            expect(ss.accessToken).toBe('restored_access')
            expect(ss.refreshToken).toBe('restored_refresh')
            expect(ss.tokenExpiresAt).toBeTruthy()
            expect(ss.userInfo).toEqual({ email: 'user@example.com' })
            expect(ss.getServerUrl()).toBe('https://custom.server.com')
        })

        it('已登入且 token 即將過期時自動刷新', async () => {
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_tokens') {
                    return {
                        key,
                        value: {
                            access_token: 'expiring_access',
                            refresh_token: 'expiring_refresh',
                            expires_at: Date.now() - 1000, // 已過期
                        },
                    }
                }
                return null
            })
            ds.getLedgers = vi.fn(async () => [])
            const refreshSpy = vi
                .spyOn(ss, 'refreshAccessToken')
                .mockResolvedValue()

            await ss.init()

            expect(refreshSpy).toHaveBeenCalledTimes(1)
        })

        it('自動同步啟用且已登入時啟動 startAutoSync', async () => {
            const startAutoSyncSpy = vi
                .spyOn(ss, 'startAutoSync')
                .mockImplementation(() => {})
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_tokens') {
                    return {
                        key,
                        value: {
                            access_token: 'acc',
                            refresh_token: 'ref',
                            expires_at: Date.now() + 3600000,
                        },
                    }
                }
                if (key === 'sync_auto_enabled') return { key, value: true }
                return null
            })
            ds.getLedgers = vi.fn(async () => [])

            await ss.init()

            expect(startAutoSyncSpy).toHaveBeenCalledTimes(1)
        })

        it('未登入時即使自動同步啟用也不啟動', async () => {
            const startAutoSyncSpy = vi
                .spyOn(ss, 'startAutoSync')
                .mockImplementation(() => {})
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_auto_enabled') return { key, value: true }
                return null
            })
            ds.getLedgers = vi.fn(async () => [])

            await ss.init()

            expect(startAutoSyncSpy).not.toHaveBeenCalled()
        })

        it('自動備份啟用且已登入時啟動 startAutoBackup 並帶間隔', async () => {
            const startAutoBackupSpy = vi
                .spyOn(ss, 'startAutoBackup')
                .mockImplementation(() => {})
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_tokens') {
                    return {
                        key,
                        value: {
                            access_token: 'acc',
                            refresh_token: 'ref',
                            expires_at: Date.now() + 3600000,
                        },
                    }
                }
                if (key === 'sync_auto_backup_enabled')
                    return { key, value: true }
                if (key === 'sync_auto_backup_interval')
                    return { key, value: 'weekly' }
                return null
            })
            ds.getLedgers = vi.fn(async () => [])

            await ss.init()

            expect(startAutoBackupSpy).toHaveBeenCalledWith('weekly')
        })

        it('有共用帳本且未設定 sync_drive_file_authorized 時補設為 true', async () => {
            ds.getSetting = vi.fn(async key => {
                if (key === 'sync_tokens') {
                    return {
                        key,
                        value: {
                            access_token: 'acc',
                            refresh_token: 'ref',
                            expires_at: Date.now() + 3600000,
                        },
                    }
                }
                if (key === 'sync_drive_file_authorized') return null
                return null
            })
            ds.getLedgers = vi.fn(async () => [
                { id: 1, name: '共用帳本', isShared: true },
            ])
            const saveSpy = ds.saveSetting

            await ss.init()

            expect(saveSpy).toHaveBeenCalledWith({
                key: 'sync_drive_file_authorized',
                value: true,
            })
        })
    })

    // ── P03: cleanupOldBackups 保留策略 ──
    describe('cleanupOldBackups', () => {
        const day = 24 * 60 * 60 * 1000

        afterEach(() => {
            vi.useRealTimers()
        })

        it('沒有備份時直接返回', async () => {
            ss.listBackups = vi.fn().mockResolvedValue([])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).not.toHaveBeenCalled()
        })

        it('近 7 天內的備份全部保留', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
            ss.listBackups = vi.fn().mockResolvedValue([
                { id: 'a', name: 'backup_a', createdTime: '2026-06-14T00:00:00Z' },
                { id: 'b', name: 'backup_b', createdTime: '2026-06-10T00:00:00Z' },
            ])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).not.toHaveBeenCalled()
        })

        it('7 天~1 年：同月份僅保留最早一筆', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
            // 5 月兩筆備份（更晚的那筆 05-20 應被刪除，保留 05-05）
            ss.listBackups = vi.fn().mockResolvedValue([
                { id: 'later', createdTime: '2026-05-20T00:00:00Z' },
                { id: 'earlier', createdTime: '2026-05-05T00:00:00Z' },
            ])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).toHaveBeenCalledTimes(1)
            expect(deleteSpy).toHaveBeenCalledWith('later')
        })

        it('7 天~1 年：不同月份各保留一筆', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
            ss.listBackups = vi.fn().mockResolvedValue([
                { id: 'may', createdTime: '2026-05-10T00:00:00Z' },
                { id: 'apr', createdTime: '2026-04-10T00:00:00Z' },
            ])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).not.toHaveBeenCalled()
        })

        it('超過 1 年的備份一律刪除', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
            ss.listBackups = vi.fn().mockResolvedValue([
                { id: 'old', createdTime: '2024-06-10T00:00:00Z' },
            ])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).toHaveBeenCalledTimes(1)
            expect(deleteSpy).toHaveBeenCalledWith('old')
        })

        it('混合情境：近 7 天保留 + 同月刪晚 + 跨月保留 + 逾 1 年刪除', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
            ss.listBackups = vi.fn().mockResolvedValue([
                { id: 'recent', createdTime: '2026-06-12T00:00:00Z' }, // 保留
                { id: 'may-later', createdTime: '2026-05-20T00:00:00Z' }, // 刪除（同月晚）
                { id: 'may-early', createdTime: '2026-05-02T00:00:00Z' }, // 保留（同月早）
                { id: 'apr', createdTime: '2026-04-10T00:00:00Z' }, // 保留（不同月）
                { id: 'year-old', createdTime: '2024-06-01T00:00:00Z' }, // 刪除（逾 1 年）
            ])
            const deleteSpy = vi.spyOn(ss, 'deleteBackup').mockResolvedValue()

            await ss.cleanupOldBackups()

            expect(deleteSpy).toHaveBeenCalledTimes(2)
            const deletedIds = deleteSpy.mock.calls.map(c => c[0]).sort()
            expect(deletedIds).toEqual(['may-later', 'year-old'])
        })
    })

    // ── P03: applyRemoteChanges 排序 ──
    describe('applyRemoteChanges 排序', () => {
        it('空變更列表直接返回', async () => {
            const addSpy = vi.spyOn(ss, '_applyAdd').mockResolvedValue()
            await ss.applyRemoteChanges([])
            expect(addSpy).not.toHaveBeenCalled()
        })

        it('依 timestamp 由舊到新套用', async () => {
            const order = []
            ss._applyAdd = vi.fn(async () => order.push('add'))
            ss._applyUpdate = vi.fn(async () => order.push('update'))
            ss._applyDelete = vi.fn(async () => order.push('delete'))

            await ss.applyRemoteChanges([
                { operation: 'update', storeName: 'records', recordId: 1, data: { id: 1 }, timestamp: 200 },
                { operation: 'add', storeName: 'records', recordId: 2, data: { id: 2 }, timestamp: 100 },
                { operation: 'delete', storeName: 'records', recordId: 3, data: { id: 3 }, timestamp: 300 },
            ])

            expect(order).toEqual(['add', 'update', 'delete'])
        })

        it('相同 timestamp 時依 add > update > delete 排序', async () => {
            const order = []
            ss._applyAdd = vi.fn(async () => order.push('add'))
            ss._applyUpdate = vi.fn(async () => order.push('update'))
            ss._applyDelete = vi.fn(async () => order.push('delete'))

            await ss.applyRemoteChanges([
                { operation: 'delete', storeName: 'records', recordId: 3, data: { id: 3 }, timestamp: 100 },
                { operation: 'update', storeName: 'records', recordId: 2, data: { id: 2 }, timestamp: 100 },
                { operation: 'add', storeName: 'records', recordId: 1, data: { id: 1 }, timestamp: 100 },
            ])

            expect(order).toEqual(['add', 'update', 'delete'])
        })

        it('相同 timestamp 與操作時依 topoOrder（ledgers 先於 accounts 先於 records）', async () => {
            const order = []
            ss._applyAdd = vi.fn(async (storeName) => order.push(storeName))

            await ss.applyRemoteChanges([
                { operation: 'add', storeName: 'records', recordId: 3, data: { id: 3 }, timestamp: 100 },
                { operation: 'add', storeName: 'ledgers', recordId: 1, data: { id: 1 }, timestamp: 100 },
                { operation: 'add', storeName: 'accounts', recordId: 2, data: { id: 2 }, timestamp: 100 },
            ])

            expect(order).toEqual(['ledgers', 'accounts', 'records'])
        })

        it('add 且 UUID 已存在時轉為 _applyUpdateWithId', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async (storeName, uuid) =>
                    uuid === 'existing-uuid' ? { id: 5, uuid: 'existing-uuid' } : null
                ),
            })
            ss = createSyncService(ds)
            const updateWithIdSpy = vi
                .spyOn(ss, '_applyUpdateWithId')
                .mockResolvedValue()
            const addSpy = vi.spyOn(ss, '_applyAdd').mockResolvedValue()

            await ss.applyRemoteChanges([
                {
                    operation: 'add',
                    storeName: 'records',
                    recordId: 999,
                    data: { id: 999, uuid: 'existing-uuid' },
                    timestamp: 100,
                },
            ])

            expect(updateWithIdSpy).toHaveBeenCalledWith(
                'records',
                5,
                expect.objectContaining({ uuid: 'existing-uuid' })
            )
            expect(addSpy).not.toHaveBeenCalled()
        })

        it('支援 groupMeta 的拓撲排序與 _applyAdd / _applyUpdate / _applyDelete 分支呼叫', async () => {
            const saveGMSpy = vi.fn().mockResolvedValue()
            const deleteGMSpy = vi.fn().mockResolvedValue()
            ds = createMockDataService({
                saveGroupMeta: saveGMSpy,
                deleteGroupMeta: deleteGMSpy,
                getByUUID: vi.fn(async (storeName, uuid) =>
                    uuid === 'g-uuid-1' ? { id: 'g1', uuid: 'g-uuid-1' } : null
                ),
            })
            ss = createSyncService(ds)

            await ss._applyAdd('groupMeta', { uuid: 'g-uuid-new', name: '新群組' })
            expect(saveGMSpy).toHaveBeenCalledWith(
                expect.objectContaining({ uuid: 'g-uuid-new', name: '新群組' }),
                true
            )

            await ss._applyUpdateWithId('groupMeta', 'g1', { name: '已修改群組' })
            expect(saveGMSpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'g1', name: '已修改群組' }),
                true
            )

            await ss._applyDeleteWithId('groupMeta', 'g1')
            expect(deleteGMSpy).toHaveBeenCalledWith('g1', true)
        })

        it('_resolveAllForeignKeys 能正確將 record 的 groupUuid 解析為本地 groupId', async () => {
            ds = createMockDataService({
                getByUUID: vi.fn(async (storeName, uuid) =>
                    storeName === 'groupMeta' && uuid === 'g-uuid-100'
                        ? { id: 'local-g-100', uuid: 'g-uuid-100' }
                        : null
                ),
            })
            ss = createSyncService(ds)

            const resolved = await ss._resolveAllForeignKeys('records', {
                description: '群組交易',
                groupUuid: 'g-uuid-100',
            })

            expect(resolved.groupId).toBe('local-g-100')
        })
    })
})

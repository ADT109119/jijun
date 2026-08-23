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

describe('SyncService per-device helpers', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('_changeKey 使用 deviceId|timestamp|operation|storeName 格式', () => {
        const k = ss._changeKey({
            deviceId: 'dev_a',
            timestamp: 123,
            operation: 'add',
            storeName: 'records',
        })
        expect(k).toBe('dev_a|123|add|records')
    })

    it('_changeKey 對缺少 deviceId 的變更改用 unknown', () => {
        const k = ss._changeKey({ timestamp: 5, operation: 'delete', storeName: 'debts' })
        expect(k).toBe('unknown|5|delete|debts')
    })

    it('_manifestFileName 取 uuid 前 8 碼', () => {
        expect(ss._manifestFileName('abcdefghijk-1234')).toBe(
            'EasyAccounting_SharedManifest_abcdefgh.json'
        )
    })

    it('_deviceLogFileName 含 uuid 前 8 碼與 deviceId', () => {
        ss.deviceId = 'dev_x'
        expect(ss._deviceLogFileName('abcdefghijk-1234')).toBe(
            'EasyAccounting_SharedLog_abcdefgh_dev_x.json'
        )
    })

    it('_findFileInDrive 遇 403 授權錯誤時拋出（不誤判為檔案不存在）', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue({ ok: false, status: 403 })

        await expect(
            ss._findFileInDrive('EasyAccounting_SharedManifest_abcdefgh.json')
        ).rejects.toThrow('Drive search failed (403)')
    })
})

describe('SyncService _appendToDeviceLog', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('合併雲端沒有的變更並回傳筆數', async () => {
        const now = Date.now()
        const cloud = {
            ledgerUuid: 'u1',
            deviceId: 'dev_x',
            changes: [{ deviceId: 'dev_x', timestamp: now - 60000, operation: 'add', storeName: 'records', data: {} }],
        }
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') return { ok: true, json: async () => ({}) }
            return { ok: true, json: async () => cloud }
        })
        const n = await ss._appendToDeviceLog('file_1', [
            cloud.changes[0], // 已存在
            { deviceId: 'dev_x', timestamp: now, operation: 'add', storeName: 'records', data: {} }, // 新
        ])
        expect(n).toBe(1)
        const patchCall = globalThis.fetch.mock.calls.find(c => c[1]?.method === 'PATCH')
        const sent = JSON.parse(patchCall[1].body)
        expect(sent.changes).toHaveLength(2)
    })

    it('裁剪 90 天前的變更', async () => {
        const old = Date.now() - 91 * 24 * 60 * 60 * 1000
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') return { ok: true, json: async () => ({}) }
            return {
                ok: true,
                json: async () => ({
                    changes: [{ deviceId: 'a', timestamp: old, operation: 'add', storeName: 'records' }],
                }),
            }
        })
        await ss._appendToDeviceLog('file_1', [
            { deviceId: 'x', timestamp: Date.now(), operation: 'add', storeName: 'records' },
        ])
        const patchCall = globalThis.fetch.mock.calls.find(c => c[1]?.method === 'PATCH')
        const sent = JSON.parse(patchCall[1].body)
        expect(sent.changes).toHaveLength(1) // 舊變更被裁剪，僅剩新附加的
        expect(sent.changes.every(c => c.timestamp >= Date.now() - 90 * 24 * 60 * 60 * 1000)).toBe(true)
    })

    it('下載失敗時拋出且不送出 PATCH', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
        await expect(
            ss._appendToDeviceLog('file_1', [
                { deviceId: 'x', timestamp: Date.now(), operation: 'add', storeName: 'records' },
            ])
        ).rejects.toThrow('Failed to download file (500)')
        expect(globalThis.fetch.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    })

    it('空參數早退', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
        const n = await ss._appendToDeviceLog(null, [
            { deviceId: 'x', timestamp: Date.now(), operation: 'add', storeName: 'records' },
        ])
        expect(n).toBe(0)
        expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('批次內重複鍵只附加一筆', async () => {
        const ts = Date.now()
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') return { ok: true, json: async () => ({}) }
            return { ok: true, json: async () => ({ deviceId: 'dev_x', changes: [] }) }
        })
        const n = await ss._appendToDeviceLog('file_1', [
            { deviceId: 'dev_x', timestamp: ts, operation: 'add', storeName: 'records', data: {} },
            { deviceId: 'dev_x', timestamp: ts, operation: 'add', storeName: 'records', data: {} },
        ])
        expect(n).toBe(1)
        const patchCall = globalThis.fetch.mock.calls.find(c => c[1]?.method === 'PATCH')
        const sent = JSON.parse(patchCall[1].body)
        expect(sent.changes).toHaveLength(1)
    })
})

describe('SyncService manifest 管理', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        ss.userInfo = { email: 'me@test.com' }
        ss.deviceId = 'dev_me'
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('_registerSelfInManifest 加入自己且不重複', async () => {
        let stored = { members: [] }
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') {
                stored = JSON.parse(opts.body)
                return { ok: true, json: async () => ({}) }
            }
            return { ok: true, json: async () => stored }
        })
        const ok = await ss._registerSelfInManifest('mf_1', 'log_1')
        expect(ok).toBe(true)
        expect(stored.members).toEqual([
            { deviceId: 'dev_me', ownerEmail: 'me@test.com', fileId: 'log_1' },
        ])
    })

    it('_removeManifestMember 移除指定 deviceId', async () => {
        let stored = {
            members: [
                { deviceId: 'dev_a', ownerEmail: 'a@t.com', fileId: 'l1' },
                { deviceId: 'dev_b', ownerEmail: 'b@t.com', fileId: 'l2' },
            ],
        }
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') {
                stored = JSON.parse(opts.body)
                return { ok: true, json: async () => ({}) }
            }
            return { ok: true, json: async () => stored }
        })
        const ok = await ss._removeManifestMember('mf_1', 'dev_a')
        expect(ok).toBe(true)
        expect(stored.members.map(m => m.deviceId)).toEqual(['dev_b'])
    })

    it('_registerSelfInManifest 下載失敗時重試且不覆寫成員清單', async () => {
        const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {})
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        globalThis.fetch = vi.fn(async (_url, opts) => {
            if (opts?.method === 'PATCH') {
                return { ok: true, json: async () => ({}) }
            }
            return { ok: false, status: 500 }
        })
        try {
            const ok = await ss._registerSelfInManifest('mf_1', 'log_1')
            expect(ok).toBe(false)
            expect(
                globalThis.fetch.mock.calls.some(
                    c => c[1]?.method === 'PATCH'
                )
            ).toBe(false)
        } finally {
            warnSpy.mockRestore()
            errorSpy.mockRestore()
        }
    })
})

describe('SyncService _ensureSharedInfra', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ds.getLedger = vi.fn()
        ds.updateLedger = vi.fn(async () => true)
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        ss.userInfo = { email: 'me@test.com' }
        ss.deviceId = 'dev_me'
        // _createSharedFile / deleteFile 內部會走共享授權流程，測試中直接放行
        ss.ensureSharingPermission = vi.fn(async () => true)
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('首次呼叫：讀舊檔歷史、建立 manifest 與日誌檔、種入 appliedKeys、寫遷移旗標', async () => {
        const legacyChanges = [
            { deviceId: 'old', timestamp: 111, operation: 'add', storeName: 'records', data: {} },
        ]
        let createdFiles = []
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('/files?q=')) {
                return { ok: true, json: async () => ({ files: [] }) }
            }
            if (url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({ changes: legacyChanges }),
                }
            }
            if (url.includes('uploadType=multipart')) {
                const id = `new_${createdFiles.length++}`
                return { ok: true, json: async () => ({ id }) }
            }
            return { ok: true, json: async () => ({}) }
        })
        ss._updateFile = vi.fn(async () => {})
        ss._appendToDeviceLog = vi.fn(async (_id, changes) => changes.length)
        ss._grantDevLogPermissions = vi.fn(async () => {})

        const ledger = {
            id: 1,
            uuid: 'uuuuuuuu-1',
            isShared: true,
            sharedFileId: 'old_file',
        }
        const infra = await ss._ensureSharedInfra(ledger)

        expect(infra.manifestId).toBe('new_0')
        expect(infra.devLogId).toBe('new_1')
        // 歷史被併入自己的日誌
        expect(ss._appendToDeviceLog).toHaveBeenCalled()
        // appliedKeys 種入舊變更
        const keys = (await ds.getSetting('sync_shared_applied_keys')).value
        expect(keys).toContain('old|111|add|records')
        // 帳本記錄寫入 sharedManifestId
        expect(ds.updateLedger).toHaveBeenCalledWith(
            1,
            { sharedManifestId: 'new_0' },
            true
        )
        // 遷移旗標
        expect((await ds.getSetting('shared_migrated_uuuuuuuu-1')).value).toBe(true)
    })

    it('舊檔已被他機註冊 manifest 時採用贏家的 manifestFileId', async () => {
        let mediaReads = 0
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('alt=media')) {
                mediaReads++
                // 第一次讀：舊檔尚無指標（自己因此先建立了 manifest）；
                // 寫回指標前再讀：發現他機已搶先註冊贏家 manifest
                return {
                    ok: true,
                    json: async () =>
                        mediaReads === 1
                            ? { changes: [] }
                            : { manifestFileId: 'winner_manifest', changes: [] },
                }
            }
            if (url.includes('uploadType=multipart')) {
                return { ok: true, json: async () => ({ id: 'orphan' }) }
            }
            return { ok: true, json: async () => ({ files: [] }) }
        })
        ss._appendToDeviceLog = vi.fn(async () => 0)
        ss._grantDevLogPermissions = vi.fn(async () => {})
        ss.deleteFile = vi.fn(async () => {})

        const ledger = {
            id: 2,
            uuid: 'uuuuuuuu-2',
            isShared: true,
            sharedFileId: 'old_file',
        }
        const infra = await ss._ensureSharedInfra(ledger)
        expect(infra.manifestId).toBe('winner_manifest')
        expect(ss.deleteFile).toHaveBeenCalledWith('orphan')
    })

    it('舊檔已有 manifest 指標時直接採用，不重複建立', async () => {
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        manifestFileId: 'existing_manifest',
                        changes: [],
                    }),
                }
            }
            if (url.includes('uploadType=multipart')) {
                return { ok: true, json: async () => ({ id: 'dev_log_created' }) }
            }
            return { ok: true, json: async () => ({ files: [] }) }
        })
        ss._appendToDeviceLog = vi.fn(async () => 0)
        ss._grantDevLogPermissions = vi.fn(async () => {})

        const ledger = {
            id: 3,
            uuid: 'uuuuuuuu-3',
            isShared: true,
            sharedFileId: 'old_file',
        }
        const infra = await ss._ensureSharedInfra(ledger)
        expect(infra.manifestId).toBe('existing_manifest')
        // 僅建立自己的裝置日誌（一次 multipart），不重複建立 manifest
        const creates = globalThis.fetch.mock.calls.filter(c =>
            c[0].includes('uploadType=multipart')
        )
        expect(creates).toHaveLength(1)
    })
})

describe('SyncService pushSharedLedgerChanges (per-device)', () => {
    let ss, ds

    beforeEach(async () => {
        ds = createMockDataService({
            getLedgers: vi.fn(async () => [
                {
                    id: 1,
                    uuid: 'u-12345678',
                    name: 'S',
                    isShared: true,
                    sharedFileId: 'f1',
                },
            ]),
            getChangesSince: vi.fn(async () => [
                {
                    deviceId: 'other',
                    timestamp: 500,
                    operation: 'add',
                    storeName: 'records',
                    data: {},
                },
            ]),
        })
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        await ds.saveSetting({
            key: 'sync_drive_file_authorized',
            value: true,
        })
        ds.clearSyncLog = vi.fn(async () => true)
    })

    it('推送後回傳最大時間戳，且 deviceId 一律改成自己', async () => {
        ss.ensureValidToken = vi.fn(async () => {})
        ss._ensureSharedInfra = vi.fn(async ledger => ({
            ledger,
            devLogId: 'dl',
            manifestId: 'mf',
        }))
        ss._appendToDeviceLog = vi.fn(async (_id, changes) => changes.length)

        const max = await ss.pushSharedLedgerChanges()
        expect(max).toBe(500)
        expect(ss._appendToDeviceLog.mock.calls[0][1][0].deviceId).toBe(
            ss.deviceId
        )
    })

    it('未授權時回傳 null', async () => {
        await ds.saveSetting({ key: 'sync_drive_file_authorized', value: false })
        ss.ensureValidToken = vi.fn(async () => {})
        expect(await ss.pushSharedLedgerChanges()).toBeNull()
    })

    it('任一帳本推送失敗時回傳 null 以保留本地日誌', async () => {
        ds.getLedgers = vi.fn(async () => [
            {
                id: 1,
                uuid: 'u-1',
                name: 'A',
                isShared: true,
                sharedFileId: 'f1',
            },
            {
                id: 2,
                uuid: 'u-2',
                name: 'B',
                isShared: true,
                sharedFileId: 'f2',
            },
        ])
        ss.ensureValidToken = vi.fn(async () => {})
        ss._ensureSharedInfra = vi.fn(async ledger => {
            if (ledger.id === 2) throw new Error('infra fail')
            return { ledger, devLogId: `dl-${ledger.id}`, manifestId: 'mf' }
        })
        ss._appendToDeviceLog = vi.fn(async (_id, changes) => changes.length)

        const result = await ss.pushSharedLedgerChanges()
        expect(result).toBeNull()
    })

    it('performSync 兩條推送成功後清理本地日誌（取最小 cutoff）', async () => {
        ss.ensureValidToken = vi.fn(async () => {})
        ss.pushChanges = vi.fn(async () => 700)
        ss.pushSharedLedgerChanges = vi.fn(async () => 500)
        ss.pullChanges = vi.fn(async () => {})
        ss.pullSharedLedgerChanges = vi.fn(async () => {})

        await ss.performSync(true)
        expect(ds.clearSyncLog).toHaveBeenCalledWith(500)
    })

    it('個人同步關閉時只跑共用流程，僅以共用 cutoff 清理', async () => {
        ss.ensureValidToken = vi.fn(async () => {})
        ss.pushChanges = vi.fn()
        ss.pullChanges = vi.fn()
        ss.pushSharedLedgerChanges = vi.fn(async () => 300)
        ss.pullSharedLedgerChanges = vi.fn(async () => {})
        await ds.saveSetting({ key: 'sync_auto_enabled', value: false })

        await ss.performSync(false)
        expect(ss.pushChanges).not.toHaveBeenCalled()
        expect(ss.pullChanges).not.toHaveBeenCalled()
        expect(ds.clearSyncLog).toHaveBeenCalledWith(300)
    })
})

describe('SyncService pullSharedLedgerChanges', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        ss.deviceId = 'dev_me'
        ds.saveSetting({
            key: 'sync_drive_file_authorized',
            value: true,
        })
        ds.getLedgers = vi.fn(async () => [
            {
                id: 1,
                uuid: 'u-1',
                name: 'S',
                isShared: true,
                sharedFileId: 'f1',
                sharedManifestId: 'mf1',
            },
        ])
        ss.applyRemoteChanges = vi.fn(async () => {})
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('套用他人變更、略過自己推的、appliedKeys 去重', async () => {
        // 使用新鮮時間戳：appliedKeys 持久化時會裁剪 30 天前的鍵，
        // 過舊的字面值時間戳會導致第二次拉取重複套用
        const now = Date.now()
        const memberChanges = [
            {
                deviceId: 'dev_me',
                timestamp: now - 5000,
                operation: 'add',
                storeName: 'records',
                data: {},
            },
            {
                deviceId: 'dev_b',
                timestamp: now - 1000,
                operation: 'add',
                storeName: 'records',
                data: { uuid: 'r1' },
            },
        ]
        ss._ensureSharedInfra = vi.fn(async ledger => ({
            ledger,
            devLogId: 'my_log',
            manifestId: ledger.sharedManifestId,
        }))
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('mf1') && url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        members: [
                            { deviceId: 'dev_me', ownerEmail: 'me@t', fileId: 'my_log' },
                            { deviceId: 'dev_b', ownerEmail: 'b@t', fileId: 'b_log' },
                        ],
                    }),
                }
            }
            if (url.includes('b_log') && url.includes('alt=media')) {
                return { ok: true, json: async () => ({ changes: memberChanges }) }
            }
            if (url.includes('fields=modifiedTime')) {
                return { ok: true, json: async () => ({ modifiedTime: new Date().toISOString() }) }
            }
            return { ok: true, json: async () => ({}) }
        })

        await ss.pullSharedLedgerChanges()
        expect(ss.applyRemoteChanges).toHaveBeenCalledTimes(1)
        const applied = ss.applyRemoteChanges.mock.calls[0][0]
        // 只剩 dev_b 的那筆
        expect(applied).toHaveLength(1)
        expect(applied[0].deviceId).toBe('dev_b')

        // 第二次拉取：同內容不重複套用（appliedKeys 已持久化）
        await ss.pullSharedLedgerChanges()
        expect(ss.applyRemoteChanges).toHaveBeenCalledTimes(1)
    })

    it('成員檔抓不到時跳過不中斷', async () => {
        ss._ensureSharedInfra = vi.fn(async ledger => ({
            ledger,
            devLogId: 'my_log',
            manifestId: ledger.sharedManifestId,
        }))
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('mf1') && url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        members: [
                            { deviceId: 'dev_me', ownerEmail: 'me@t', fileId: 'my_log' },
                            { deviceId: 'dev_b', ownerEmail: 'b@t', fileId: 'gone_log' },
                        ],
                    }),
                }
            }
            if (url.includes('gone_log') && url.includes('fields=modifiedTime')) {
                return { ok: false, status: 404 }
            }
            return { ok: true, json: async () => ({}) }
        })

        await expect(ss.pullSharedLedgerChanges()).resolves.toBeUndefined()
        expect(ss.applyRemoteChanges).not.toHaveBeenCalled()
    })
})

describe('SyncService pullChanges (appliedKeys 版)', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        ss.deviceId = 'dev_me'
        ss.applyRemoteChanges = vi.fn(async () => {})
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('對方時鐘較慢的舊時間戳變更不再被丟棄', async () => {
        const past = Date.now() - 60 * 60 * 1000 // 1 小時前（模擬慢時鐘裝置）
        globalThis.fetch = vi.fn(async url => {
            if (url.includes("name contains 'sync_log_'")) {
                return {
                    ok: true,
                    json: async () => ({
                        files: [{ id: 'f_other', name: 'sync_log_dev_slow.json' }],
                    }),
                }
            }
            if (url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        changes: [
                            { deviceId: 'dev_slow', timestamp: past, operation: 'add', storeName: 'records', data: {} },
                        ],
                    }),
                }
            }
            return { ok: true, json: async () => ({}) }
        })

        await ss.pullChanges()
        expect(ss.applyRemoteChanges).toHaveBeenCalledTimes(1)
        expect(ss.applyRemoteChanges.mock.calls[0][0]).toHaveLength(1)
    })

    it('同一變更第二次拉取不重複套用', async () => {
        // 使用新鮮時間戳：appliedKeys 持久化時會裁剪 30 天前的鍵，
        // 過舊的字面值時間戳會導致第二次拉取重複套用
        const change = { deviceId: 'dev_s', timestamp: Date.now() - 1000, operation: 'add', storeName: 'records', data: {} }
        globalThis.fetch = vi.fn(async url => {
            if (url.includes("name contains 'sync_log_'")) {
                return {
                    ok: true,
                    json: async () => ({ files: [{ id: 'f1', name: 'sync_log_dev_s.json' }] }),
                }
            }
            if (url.includes('alt=media')) {
                return { ok: true, json: async () => ({ changes: [change] }) }
            }
            return { ok: true, json: async () => ({}) }
        })
        await ss.pullChanges()
        await ss.pullChanges()
        expect(ss.applyRemoteChanges).toHaveBeenCalledTimes(1)
    })
})

describe('SyncService joinViaManifest', () => {
    let ss, ds
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        ds = createMockDataService()
        ss = createSyncService(ds)
        ss.accessToken = 'tok'
        ss.userInfo = { email: 'me@test.com' }
        ss.deviceId = 'dev_me'
        // _createSharedFile 內部會走共享授權流程，測試中直接放行
        ss.ensureSharingPermission = vi.fn(async () => true)
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('加入成功：套用排序後變更、建立自己的日誌檔、種入 appliedKeys、回傳帳本 uuid', async () => {
        const memberLog = {
            changes: [
                { deviceId: 'dev_a', timestamp: 200, operation: 'add', storeName: 'records', data: {} },
                { deviceId: 'dev_a', timestamp: 100, operation: 'add', storeName: 'ledgers', data: { uuid: 'uuuuuuuu-9' } },
            ],
        }
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('files/mf_1') && url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        members: [
                            { deviceId: 'dev_me', ownerEmail: 'me@test.com', fileId: null },
                            { deviceId: 'dev_a', ownerEmail: 'a@t.com', fileId: 'log_a' },
                        ],
                    }),
                }
            }
            if (url.includes('files/log_a') && url.includes('alt=media')) {
                return { ok: true, json: async () => memberLog }
            }
            if (url.includes('/files?q=')) {
                return { ok: true, json: async () => ({ files: [] }) }
            }
            if (url.includes('uploadType=multipart')) {
                return { ok: true, json: async () => ({ id: 'my_new_log' }) }
            }
            return { ok: true, json: async () => ({}) }
        })
        ss.applyRemoteChanges = vi.fn(async () => {})
        ss._grantDevLogPermissions = vi.fn(async () => {})
        ss._registerSelfInManifest = vi.fn(async () => true)

        const uuid = await ss.joinViaManifest('mf_1')

        expect(uuid).toBe('uuuuuuuu-9')
        // 變更按時間戳升冪套用
        const applied = ss.applyRemoteChanges.mock.calls[0][0]
        expect(applied.map(c => c.timestamp)).toEqual([100, 200])
        expect(applied[0].storeName).toBe('ledgers')
        // 自己的日誌檔被建立並持久化（fileId 為 null 的成員被跳過）
        expect(
            (await ds.getSetting('sync_shared_devlog_uuuuuuuu-9')).value
        ).toBe('my_new_log')
        // 授權與註冊以正確參數呼叫
        expect(ss._grantDevLogPermissions).toHaveBeenCalledWith(
            'uuuuuuuu-9',
            'mf_1',
            'my_new_log'
        )
        expect(ss._registerSelfInManifest).toHaveBeenCalledWith(
            'mf_1',
            'my_new_log'
        )
        // appliedKeys 種入所有已見變更，之後 pull 不會重複套用
        const keys = (await ds.getSetting('sync_shared_applied_keys')).value
        expect(keys).toContain('dev_a|100|add|ledgers')
        expect(keys).toContain('dev_a|200|add|records')
    })

    it('無效的 manifest（缺 members）拋出錯誤且不套用任何變更', async () => {
        globalThis.fetch = vi.fn(async _url => ({
            ok: true,
            json: async () => ({ changes: [] }),
        }))
        ss.applyRemoteChanges = vi.fn(async () => {})

        await expect(ss.joinViaManifest('bad_mf')).rejects.toThrow(
            '無效的共用帳本清單檔'
        )
        expect(ss.applyRemoteChanges).not.toHaveBeenCalled()
    })

    it('重複變更改用 key 去重；成員檔抓不到不阻擋加入', async () => {
        const recordChange = {
            deviceId: 'dev_b',
            timestamp: 10,
            operation: 'add',
            storeName: 'records',
            data: { uuid: 'r1' },
        }
        globalThis.fetch = vi.fn(async url => {
            if (url.includes('files/mf_2') && url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        members: [
                            { deviceId: 'dev_b', ownerEmail: 'b@t.com', fileId: 'log_b' },
                            { deviceId: 'dev_c', ownerEmail: 'c@t.com', fileId: null },
                            { deviceId: 'dev_d', ownerEmail: 'd@t.com', fileId: 'log_d' },
                            { deviceId: 'dev_e', ownerEmail: 'e@t.com', fileId: 'log_e' },
                        ],
                    }),
                }
            }
            if (url.includes('files/log_b') && url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({
                        changes: [
                            { deviceId: 'dev_b', timestamp: 5, operation: 'add', storeName: 'ledgers', data: { uuid: 'uuuuuuuu-8' } },
                            recordChange,
                        ],
                    }),
                }
            }
            if (url.includes('files/log_d') && url.includes('alt=media')) {
                // 與 dev_b 完全相同的變更（同 key）→ 應被去重
                return { ok: true, json: async () => ({ changes: [recordChange] }) }
            }
            // log_e：下載失敗 → 不阻擋加入流程
            if (url.includes('files/log_e')) {
                return { ok: false, status: 404, json: async () => ({}) }
            }
            if (url.includes('/files?q=')) {
                return { ok: true, json: async () => ({ files: [] }) }
            }
            if (url.includes('uploadType=multipart')) {
                return { ok: true, json: async () => ({ id: 'my_log_2' }) }
            }
            return { ok: true, json: async () => ({}) }
        })
        ss.applyRemoteChanges = vi.fn(async () => {})
        ss._grantDevLogPermissions = vi.fn(async () => {})
        ss._registerSelfInManifest = vi.fn(async () => true)

        const uuid = await ss.joinViaManifest('mf_2')

        expect(uuid).toBe('uuuuuuuu-8')
        const applied = ss.applyRemoteChanges.mock.calls[0][0]
        expect(applied).toHaveLength(2)
        expect(applied.map(c => c.timestamp)).toEqual([5, 10])
        const keys = (await ds.getSetting('sync_shared_applied_keys')).value
        expect(keys).toHaveLength(2)
        expect(keys).toContain('dev_b|10|add|records')
    })
})

describe('SyncService _applyUpdateWithId ledgers 保護欄位', () => {
    it('遠端更新缺少 sharedManifestId 時保留本地值', async () => {
        const ds = createMockDataService({
            getLedger: vi.fn(async () => ({
                id: 1,
                isShared: true,
                sharedFileId: 'f',
                sharedManifestId: 'mf',
            })),
            updateLedger: vi.fn(async () => true),
        })
        const ss = createSyncService(ds)

        await ss._applyUpdateWithId('ledgers', 1, { uuid: 'x', name: 'n' })

        expect(ds.updateLedger).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ sharedManifestId: 'mf' }),
            true
        )
    })

    it('遠端明確提供 sharedManifestId 時採用遠端值', async () => {
        const ds = createMockDataService({
            getLedger: vi.fn(async () => ({
                id: 1,
                isShared: true,
                sharedFileId: 'f',
                sharedManifestId: 'mf_local',
            })),
            updateLedger: vi.fn(async () => true),
        })
        const ss = createSyncService(ds)

        await ss._applyUpdateWithId('ledgers', 1, {
            uuid: 'x',
            sharedManifestId: 'mf_remote',
        })

        expect(ds.updateLedger).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ sharedManifestId: 'mf_remote' }),
            true
        )
    })
})

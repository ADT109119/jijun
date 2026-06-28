// ==================== SyncService 單元測試 ====================
// 測試重點：isSignedIn、isTokenExpiringSoon、getDeviceId、getServerUrl、setServerUrl
// 涉及網路的 method (signIn, backupToDrive, sync 等) 不在此測試

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────

// 避免實際載入原生 Google Auth 模組
vi.mock('@codetrix-studio/capacitor-google-auth', () => ({
    GoogleAuth: {
        initialize: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
    },
}));

// Mock utils.js
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    customConfirm: vi.fn(() => Promise.resolve(true)),
    customAlert: vi.fn(),
}));

// 模擬 Capacitor — 非原生
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

// 在 import SyncService 之前設定 globalThis.Capacitor
globalThis.Capacitor = { isNativePlatform: () => false };

// 覆寫 import.meta.env
vi.stubGlobal('import.meta.env', {
    VITE_GOOGLE_CLIENT_ID: 'test-client-id',
    VITE_GOOGLE_API_KEY: 'test-api-key',
    VITE_SYNC_SERVER_URL: undefined,
});

import { SyncService } from '../../src/js/syncService.js';

// ── Helpers ──────────────────────────────────────────

/** 建立最小化 DataService mock */
function createMockDataService(overrides = {}) {
    const settings = {};
    const ledgers = [];
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async (key) => {
            const val = settings[key];
            return val !== undefined ? { key, value: val } : null;
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value;
            return true;
        }),
        getCategorySetting: vi.fn(async () => null),
        saveCategorySetting: vi.fn(async () => true),
        logChange: vi.fn(),
        getLedgers: vi.fn(async () => ledgers),
        exportDataForSync: vi.fn(async () => ({ records: [] })),
        importDataFromSync: vi.fn(async () => true),
        ...overrides,
    };
}

/** 建立 SyncService 實例 */
function createSyncService(ds) {
    return new SyncService(ds);
}

// ── 測試 ─────────────────────────────────────────────

describe('SyncService', () => {
    let ss, ds;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        vi.restoreAllMocks();
        ds = createMockDataService();
        ss = createSyncService(ds);
    });

    afterEach(() => {
        // 清理定時器
        ss.stopAutoSync();
        ss.stopAutoBackup();
    });

    // ── Constructor ──────────────────────────────────

    describe('constructor', () => {
        it('初始狀態正確', () => {
            expect(ss.accessToken).toBeNull();
            expect(ss.refreshToken).toBeNull();
            expect(ss.tokenExpiresAt).toBeNull();
            expect(ss.userInfo).toBeNull();
            expect(ss._syncing).toBe(false);
        });

        it('使用預設伺服器 URL', () => {
            expect(ss.getServerUrl()).toBe('https://jijun-server.the-walking-fish.com');
        });

        it('產生 deviceId 並存入 localStorage', () => {
            const id = ss.deviceId;
            expect(id).toBeDefined();
            expect(typeof id).toBe('string');
            expect(id.startsWith('dev_')).toBe(true);
            expect(localStorage.getItem('sync_device_id')).toBe(id);
        });

        it('讀取已有的 deviceId 從 localStorage', () => {
            localStorage.setItem('sync_device_id', 'dev_existing_12345');
            const ss2 = createSyncService(createMockDataService());
            expect(ss2.deviceId).toBe('dev_existing_12345');
            ss2.stopAutoSync();
            ss2.stopAutoBackup();
        });
    });

    // ── isSignedIn ───────────────────────────────────

    describe('isSignedIn', () => {
        it('沒有 token 時回傳 false', () => {
            expect(ss.isSignedIn()).toBe(false);
        });

        it('只有 accessToken 時回傳 false', () => {
            ss.accessToken = 'abc123';
            expect(ss.isSignedIn()).toBe(false);
        });

        it('只有 refreshToken 時回傳 false', () => {
            ss.refreshToken = 'xyz789';
            expect(ss.isSignedIn()).toBe(false);
        });

        it('兩個 token 都有時回傳 true', () => {
            ss.accessToken = 'abc123';
            ss.refreshToken = 'xyz789';
            expect(ss.isSignedIn()).toBe(true);
        });
    });

    // ── isTokenExpiringSoon ──────────────────────────

    describe('isTokenExpiringSoon', () => {
        it('沒有 expiresAt 時回傳 true（視為即將過期）', () => {
            ss.tokenExpiresAt = null;
            expect(ss.isTokenExpiringSoon()).toBe(true);
        });

        it('token 遠未過期時回傳 false', () => {
            // 3600 秒後過期
            ss.tokenExpiresAt = Date.now() + 3600 * 1000;
            expect(ss.isTokenExpiringSoon()).toBe(false);
        });

        it('token 剛好 5 分鐘後過期時回傳 false（臨界值不算過期）', () => {
            ss.tokenExpiresAt = Date.now() + 5 * 60 * 1000;
            expect(ss.isTokenExpiringSoon()).toBe(false);
        });

        it('token 已過期時回傳 true', () => {
            ss.tokenExpiresAt = Date.now() - 1000;
            expect(ss.isTokenExpiringSoon()).toBe(true);
        });

        it('token 4 分鐘 59 秒後過期時回傳 true', () => {
            ss.tokenExpiresAt = Date.now() + 4 * 60 * 1000 + 59 * 1000;
            expect(ss.isTokenExpiringSoon()).toBe(true);
        });

        it('token 5 分鐘零 1 秒後過期時回傳 false', () => {
            ss.tokenExpiresAt = Date.now() + 5 * 60 * 1000 + 1 * 1000;
            expect(ss.isTokenExpiringSoon()).toBe(false);
        });
    });

    // ── getDeviceId ──────────────────────────────────

    describe('getDeviceId', () => {
        it('第一次呼叫產生新 ID 並存入 localStorage', () => {
            localStorage.removeItem('sync_device_id');
            const ss2 = createSyncService(createMockDataService());
            const id = ss2.getDeviceId();
            expect(id).toBeDefined();
            expect(localStorage.getItem('sync_device_id')).toBe(id);
            ss2.stopAutoSync();
            ss2.stopAutoBackup();
        });

        it('第二次呼叫回傳相同的 ID', () => {
            localStorage.setItem('sync_device_id', 'dev_persistent_id');
            const ss2 = createSyncService(createMockDataService());
            const id1 = ss2.getDeviceId();
            const id2 = ss2.getDeviceId();
            expect(id1).toBe(id2);
            expect(id1).toBe('dev_persistent_id');
            ss2.stopAutoSync();
            ss2.stopAutoBackup();
        });

        it('ID 格式為 dev_ 開頭', () => {
            localStorage.removeItem('sync_device_id');
            const ss2 = createSyncService(createMockDataService());
            const id = ss2.getDeviceId();
            expect(id).toMatch(/^dev_/);
            ss2.stopAutoSync();
            ss2.stopAutoBackup();
        });
    });

    // ── getServerUrl / setServerUrl ──────────────────

    describe('getServerUrl / setServerUrl', () => {
        it('預設回傳 DEFAULT_SERVER_URL', () => {
            expect(ss.getServerUrl()).toBe('https://jijun-server.the-walking-fish.com');
        });

        it('setServerUrl 更新 URL', async () => {
            await ss.setServerUrl('https://custom.server.com');
            expect(ss.getServerUrl()).toBe('https://custom.server.com');
            expect(ds.saveSetting).toHaveBeenCalledWith({
                key: 'sync_server_url',
                value: 'https://custom.server.com',
            });
        });

        it('setServerUrl 移除結尾斜線', async () => {
            await ss.setServerUrl('https://custom.server.com/');
            expect(ss.getServerUrl()).toBe('https://custom.server.com');
        });

        it('setServerUrl 移除多個結尾斜線', async () => {
            await ss.setServerUrl('https://custom.server.com///');
            expect(ss.getServerUrl()).toBe('https://custom.server.com');
        });
    });

    // ── saveTokens ───────────────────────────────────

    describe('saveTokens', () => {
        it('正確呼叫 saveSetting 儲存 token 資料', async () => {
            ss.accessToken = 'access_token_123';
            ss.refreshToken = 'refresh_token_456';
            ss.tokenExpiresAt = Date.now() + 3600000;
            ss.userInfo = { email: 'test@example.com' };

            await ss.saveTokens();

            expect(ds.saveSetting).toHaveBeenCalledWith({
                key: 'sync_tokens',
                value: {
                    access_token: 'access_token_123',
                    refresh_token: 'refresh_token_456',
                    expires_at: expect.any(Number),
                    user_info: { email: 'test@example.com' },
                },
            });
        });
    });

    // ── signOut ──────────────────────────────────────

    describe('signOut', () => {
        it('清除所有 token 和狀態', async () => {
            ss.accessToken = 'access_token';
            ss.refreshToken = 'refresh_token';
            ss.tokenExpiresAt = Date.now() + 1000;
            ss.userInfo = { email: 'test@test.com' };

            await ss.signOut();

            expect(ss.accessToken).toBeNull();
            expect(ss.refreshToken).toBeNull();
            expect(ss.tokenExpiresAt).toBeNull();
            expect(ss.userInfo).toBeNull();
        });

        it('清除相關設定', async () => {
            ss.accessToken = 'access_token';
            ss.refreshToken = 'refresh_token';

            await ss.signOut();

            // 檢查 sync_tokens 被設為 null
            const saveCalls = ds.saveSetting.mock.calls;
            expect(saveCalls.some(c => c[0].key === 'sync_tokens' && c[0].value === null)).toBe(true);
            expect(saveCalls.some(c => c[0].key === 'sync_auto_enabled' && c[0].value === false)).toBe(true);
            expect(saveCalls.some(c => c[0].key === 'sync_auto_backup_enabled' && c[0].value === false)).toBe(true);
            expect(saveCalls.some(c => c[0].key === 'sync_drive_file_authorized' && c[0].value === false)).toBe(true);
        });
    });

    // ── stopAutoSync / stopAutoBackup ────────────────

    describe('stopAutoSync / stopAutoBackup', () => {
        it('stopAutoSync 在非原生平台上安全執行', () => {
            expect(() => ss.stopAutoSync()).not.toThrow();
        });

        it('stopAutoBackup 安全執行', () => {
            expect(() => ss.stopAutoBackup()).not.toThrow();
        });

        it('多次呼叫 stopAutoSync 不丟錯', () => {
            ss.stopAutoSync();
            ss.stopAutoSync();
            ss.stopAutoSync();
        });

        it('多次呼叫 stopAutoBackup 不丟錯', () => {
            ss.stopAutoBackup();
            ss.stopAutoBackup();
        });
    });

    // ── isSharingAuthorized / ensureSharingPermission ─

    describe('isSharingAuthorized', () => {
        it('沒有設定時回傳 false', async () => {
            const result = await ss.isSharingAuthorized();
            expect(result).toBe(false);
        });

        it('設定為 true 時回傳 true', async () => {
            ds.getSetting = vi.fn(async (key) => {
                if (key === 'sync_drive_file_authorized') {
                    return { key, value: true };
                }
                return null;
            });
            const result = await ss.isSharingAuthorized();
            expect(result).toBe(true);
        });

        it('設定為 false 時回傳 false', async () => {
            ds.getSetting = vi.fn(async (key) => {
                if (key === 'sync_drive_file_authorized') {
                    return { key, value: false };
                }
                return null;
            });
            const result = await ss.isSharingAuthorized();
            expect(result).toBe(false);
        });
    });

    // ── ensureValidToken ─────────────────────────────

    describe('ensureValidToken', () => {
        it('有有效 token 時不拋錯', async () => {
            ss.accessToken = 'valid_token';
            ss.refreshToken = 'refresh_token';
            ss.tokenExpiresAt = Date.now() + 3600000; // 1 小時後過期

            // 需要 mock refreshAccessToken 避免實際呼叫
            ss.refreshAccessToken = vi.fn().mockResolvedValue(undefined);

            await expect(ss.ensureValidToken()).resolves.not.toThrow();
        });

        it('沒有 accessToken 時拋錯', async () => {
            ss.accessToken = null;
            ss.refreshToken = null;

            await expect(ss.ensureValidToken()).rejects.toThrow('Not signed in');
        });

        it('token 過期但有 refreshToken 時嘗試刷新', async () => {
            ss.accessToken = 'old_token';
            ss.refreshToken = 'refresh_token';
            ss.tokenExpiresAt = Date.now() - 1000; // 已過期

            const refreshSpy = vi.fn().mockResolvedValue(undefined);
            ss.refreshAccessToken = refreshSpy;

            await ss.ensureValidToken();
            expect(refreshSpy).toHaveBeenCalled();
        });
    });
});

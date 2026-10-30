// ==================== SyncSettingsPage 單元測試 ====================
// 測試重點：syncSettingsPage.js（1112 行）是 2026-09-03 (350a59a) 重設計後
// 0 測試覆蓋的重要模組（雲端備份&同步頁：官方雲端／自架伺服器雙通道、
// 管理員帳號管理、Google 代理換證）。
//
// 涵蓋：
//   1. deriveActiveMode 純邏輯
//   2. renderModeSelector / renderOfficialPanel / renderGoogleAccountCard
//   3. renderSelfHostPanel（已登入卡／登入表單／註冊開關／Google 代理卡）
//   4. renderAdminPanel（註冊開關／帳號列表／PIN 重置與刪除按鈕）
//   5. renderSignedInCards（備份/同步卡、頻率按鈕、保留策略文案）
//   6. render() 整合（模式分派、健康檢查 fetch、admin 偵測、seq 重入防護）
//   7. setupSyncSettingsListeners 全按鈕/開關互動（成功/失敗/取消分支）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 保留 utils.js 真實實作（escapeHTML 等），只 mock UI 副作用函數。
// 注意：vi.mock factory 會被提升到檔案最頂端 → 不可參考後才宣告的 top-level 變數，
// 必須用 vi.hoisted 提前建立 mock 函數。
const { DEFAULT_SERVER_URL, mockUtils } = vi.hoisted(() => ({
    DEFAULT_SERVER_URL: 'https://default-server.example.com',
    mockUtils: {
        showToast: vi.fn(),
        // 預設「取消」——避免確認框在 re-render 中被意外消費/通過；
        // 需要「確認」的測試請顯式 mockResolvedValue(true)
        customConfirm: vi.fn(async () => false),
        customAlert: vi.fn(async () => true),
        // 模擬關閉動畫：移除 modal 並呼叫回呼（還原流程依賴 cb 執行 importData）
        closeModalWithAnimation: vi.fn(async (modal, _inner, cb) => {
            modal.remove()
            if (typeof cb === 'function') cb()
        }),
    },
}))

vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        showToast: mockUtils.showToast,
        customConfirm: mockUtils.customConfirm,
        customAlert: mockUtils.customAlert,
        closeModalWithAnimation: mockUtils.closeModalWithAnimation,
    }
})

// syncSettingsPage 僅從 syncService.js 匯出 DEFAULT_SERVER_URL → 整個模組 mock，
// 避免載入 Google Auth / Capacitor 原生依賴
vi.mock('../../src/js/syncService.js', () => ({
    DEFAULT_SERVER_URL,
}))

import { SyncSettingsPage } from '../../src/js/pages/syncSettingsPage.js'
import {
    showToast,
    customConfirm,
    customAlert,
    closeModalWithAnimation,
} from '../../src/js/utils.js'

const SELF_HOST_URL = 'https://my-server.example.com'
const flush = () => new Promise(r => setTimeout(r, 0))
const flushAll = async () => {
    for (let i = 0; i < 5; i++) await flush()
}

// ── App / SyncService mock 工廠 ────────────────────────────
// signedInGoogle: accessToken/refreshToken + userInfo
// selfHost: isSelfHostMode + selfHostUsername（+ admin 狀態由 adminListUsers mock 決定）
// 注意：selfHostFlag 為「可變狀態」——isSelfHostMode 每次呼叫都讀最新旗標，
// 讓測試能模擬 signOut 後模式切換（真實世界 signOut 會清除 selfHostToken）
function makeCtx(overrides = {}) {
    const {
        signedInGoogle = false,
        selfHost = false,
        selfHostUsername = 'alice',
        adminUsers = [{ username: 'admin', isAdmin: true }, { username: 'bob', isAdmin: false }],
        adminListUsersFails = false,
        serverUrl = selfHost ? SELF_HOST_URL : DEFAULT_SERVER_URL,
        userInfo = { name: 'G User', email: 'g@example.com', picture: null },
        settings = {},
    } = overrides
    let selfHostFlag = selfHost

    const syncService = {
        accessToken: signedInGoogle ? 'at' : null,
        refreshToken: signedInGoogle ? 'rt' : null,
        selfHostUsername: selfHost ? selfHostUsername : null,
        userInfo,
        deviceId: 'device-123',
        isSelfHostMode: vi.fn(() => selfHostFlag),
        getServerUrl: vi.fn(() => serverUrl),
        adminListUsers: vi.fn(async () => {
            if (adminListUsersFails) throw new Error('403')
            return { users: adminUsers, registerEnabled: true }
        }),
        setServerUrl: vi.fn(async () => true),
        signOut: vi.fn(async () => {
            selfHostFlag = false
            syncService.selfHostUsername = null
        }),
        selfHostRegister: vi.fn(async () => true),
        selfHostLogin: vi.fn(async () => true),
        selfHostCheckServer: vi.fn(async () => true),
        signIn: vi.fn(async () => true),
        adminSetRegister: vi.fn(async () => true),
        adminCreateUser: vi.fn(async (u, p) => ({ username: u, pin: p })),
        adminResetPin: vi.fn(async (u, p) => ({ username: u, pin: p })),
        adminDeleteUser: vi.fn(async () => true),
        performSync: vi.fn(async () => true),
        backupToDrive: vi.fn(async () => true),
        listBackups: vi.fn(async () => []),
        restoreFromDrive: vi.fn(async () => ({})),
        markAllRemoteChangesAsPulled: vi.fn(async () => true),
        startAutoBackup: vi.fn(),
        stopAutoBackup: vi.fn(),
        startAutoSync: vi.fn(),
        stopAutoSync: vi.fn(),
    }
    const dataService = {
        getSetting: vi.fn(async key =>
            key in settings ? { key, value: settings[key] } : null
        ),
        saveSetting: vi.fn(async () => true),
        importData: vi.fn(async () => ({ message: '匯入成功', success: true })),
    }
    const appContainer = document.createElement('div')
    appContainer.id = 'app-container'
    document.body.innerHTML = ''
    document.body.appendChild(appContainer)
    const app = {
        appContainer,
        syncService,
        dataService,
        currentHash: null,
        // v2.1.8.1：雲端還原成功後 reloadAppData() 熱載入分類/預算/帳本快取
        reloadAppData: vi.fn(async () => {}),
    }
    const page = new SyncSettingsPage(app)
    return {
        app,
        page,
        syncService,
        dataService,
        serverUrl,
        adminUsers,
        // 模擬 signOut / 通道切換（真實世界 signOut 會清除 selfHostToken）
        setSelfHost(flag) {
            selfHostFlag = flag
        },
        async render() {
            await page.render()
            return app.appContainer
        },
    }
}

beforeEach(() => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
            ok: true,
            json: async () => ({ registerEnabled: true }),
        }))
    )
    // 預設取消（與 vi.hoisted 預設一致）；「確認」情境的測試自行 mockResolvedValue(true)
    vi.mocked(customConfirm).mockResolvedValue(false)
    vi.mocked(customAlert).mockResolvedValue(true)
})
afterEach(() => {
    vi.unstubAllGlobals()
    // clearAllMocks：清 call history + once 佇列（防跨測試泄漏），保留實作。
    // 不可用 restoreAllMocks（會把 vi.hoisted factory mock 的實作還原成 undefined）
    vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════
// 1. deriveActiveMode（純函數）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - deriveActiveMode', () => {
    it('selfHostToken 存在 → selfhost', () => {
        const page = new SyncSettingsPage({ syncService: {} })
        expect(page.deriveActiveMode(true)).toBe('selfhost')
    })

    it('Google token / 未登入 → official（預設）', () => {
        const page = new SyncSettingsPage({ syncService: {} })
        expect(page.deriveActiveMode(false)).toBe('official')
    })
})

// ════════════════════════════════════════════════════════════
// 2. renderModeSelector（頂部模式 selector + 綠點）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderModeSelector', () => {
    const page = new SyncSettingsPage({ syncService: {} })

    it('官方模式：官方 tab 活躍樣式', () => {
        const html = page.renderModeSelector('official', false, false)
        expect(html).toContain('id="sync-mode-official"')
        expect(html).toContain('id="sync-mode-selfhost"')
        const officialTab = html.split('id="sync-mode-official"')[1].split('id="sync-mode-selfhost"')[0]
        expect(officialTab).toContain('bg-wabi-primary')
    })

    it('官方已登入且非 selfhost → 官方 tab 亮綠點', () => {
        const html = page.renderModeSelector('official', false, true)
        // 綠點 span 只應出現在官方 tab（官方連線中），selfhost tab 無
        const officialTab = html.split('id="sync-mode-official"')[1].split('id="sync-mode-selfhost"')[0]
        const selfhostTab = html.split('id="sync-mode-selfhost"')[1].split('</div>')[0]
        expect(officialTab).toContain('bg-green-400')
        expect(selfhostTab).not.toContain('bg-green-400')
    })

    it('selfhost 模式 → selfhost tab 亮綠點、官方 tab 不亮（互斥通道）', () => {
        const html = page.renderModeSelector('selfhost', true, false)
        const officialTab = html.split('id="sync-mode-official"')[1].split('id="sync-mode-selfhost"')[0]
        const selfhostTab = html.split('id="sync-mode-selfhost"')[1].split('</div>')[0]
        expect(officialTab).not.toContain('bg-green-400')
        expect(selfhostTab).toContain('bg-green-400')
    })

    it('selfhost 模式 + 同時有 Google token → 官方 tab 仍不亮（isSelfHostMode 優先）', () => {
        const html = page.renderModeSelector('selfhost', true, true)
        const officialTab = html.split('id="sync-mode-official"')[1].split('id="sync-mode-selfhost"')[0]
        expect(officialTab).not.toContain('bg-green-400')
    })
})

// ════════════════════════════════════════════════════════════
// 3. renderOfficialPanel（官方雲端面板）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderOfficialPanel', () => {
    const page = new SyncSettingsPage({ syncService: {} })

    it('未登入：顯示 Google 登入卡（主 CTA）', () => {
        const html = page.renderOfficialPanel({ hasGoogle: false, serverUrl: DEFAULT_SERVER_URL })
        expect(html).toContain('id="sync-sign-in-btn"')
        expect(html).toContain('使用 Google 帳號登入')
    })

    it('已登入：不顯示登入卡', () => {
        const html = page.renderOfficialPanel({ hasGoogle: true, serverUrl: DEFAULT_SERVER_URL })
        expect(html).not.toContain('id="sync-sign-in-btn"')
    })

    it('伺服器 URL 輸入值經 escapeHTML（XSS 防護）', () => {
        const html = page.renderOfficialPanel({ hasGoogle: false, serverUrl: 'https://x.com"><script>alert(1)</script>' })
        expect(html).not.toContain('"><script>alert(1)</script>')
        expect(html).toContain('&lt;script&gt;')
        expect(html).toContain('id="sync-server-save-btn"')
        expect(html).toContain('id="sync-server-reset-btn"')
    })
})

// ════════════════════════════════════════════════════════════
// 4. renderGoogleAccountCard（已登入 Google 帳號卡）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderGoogleAccountCard', () => {
    const page = new SyncSettingsPage({ syncService: {} })

    it('顯示帳號名/Email（經 escapeHTML XSS 防護）', () => {
        const html = page.renderGoogleAccountCard({
            userInfo: { name: 'A <b>Bob</b>', email: 'x&y@example.com' },
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(html).toContain('A &lt;b&gt;Bob&lt;/b&gt;')
        expect(html).toContain('x&amp;y@example.com')
        expect(html).toContain('id="sync-sign-out-btn"')
    })

    it('有 avatar picture → img；無 → 預設圖示', () => {
        const withPic = page.renderGoogleAccountCard({
            userInfo: { name: 'U', email: 'u@x.com', picture: 'https://picsum.test/a.png' },
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(withPic).toContain('<img src="https://picsum.test/a.png"')
        const noPic = page.renderGoogleAccountCard({
            userInfo: { name: 'U', email: 'u@x.com' },
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(noPic).not.toContain('<img')
        expect(noPic).toContain('fa-user')
    })

    it('自架 server URL（非官方預設）→ 附「經自架伺服器代理換證」註記', () => {
        const html = page.renderGoogleAccountCard({
            userInfo: { name: 'U', email: 'u@x.com' },
            isSelfHostMode: false,
            serverUrl: SELF_HOST_URL + '/',
        })
        expect(html).toContain('經自架伺服器代理換證')
    })

    it('官方預設 URL（含結尾斜線）→ 無代理註記', () => {
        const html = page.renderGoogleAccountCard({
            userInfo: { name: 'U', email: 'u@x.com' },
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL + '/',
        })
        expect(html).not.toContain('經自架伺服器代理換證')
    })

    it('userInfo 缺漏 → fallback「Google User」/空 email', () => {
        const html = page.renderGoogleAccountCard({
            userInfo: null,
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(html).toContain('Google User')
    })
})

// ════════════════════════════════════════════════════════════
// 5. renderSelfHostPanel（自架伺服器面板）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderSelfHostPanel', () => {
    const page = new SyncSettingsPage({ syncService: {} })
    const base = {
        selfHostUsername: 'alice',
        adminUsers: [{ username: 'admin', isAdmin: true }],
        registerEnabled: true,
        authMethod: 'pin',
        hasGoogle: false,
        serverUrl: SELF_HOST_URL,
    }

    it('已登入：顯示帳號卡 + 登出按鈕 + 「已連結」badge', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: true })
        expect(html).toContain('alice')
        expect(html).toContain('id="sync-selfhost-signout-btn"')
        expect(html).toContain('已連結')
        expect(html).not.toContain('id="sync-selfhost-login-btn"')
    })

    it('已登入 + admin：顯示「管理員」badge + 管理員面板', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: true, selfHostIsAdmin: true })
        expect(html).toContain('管理員')
        expect(html).toContain('selfhost-register-toggle-btn')
    })

    it('已登入 + 非 admin：無管理員面板', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: true, selfHostIsAdmin: false })
        expect(html).not.toContain('selfhost-register-toggle-btn')
        expect(html).not.toContain('selfhost-admin-create-btn')
    })

    it('已登入 username XSS 防護', () => {
        const html = page.renderSelfHostPanel({
            ...base,
            isSelfHostMode: true,
            selfHostUsername: 'evil"><img src=x onerror=alert(1)>',
        })
        expect(html).not.toContain('"><img src=x onerror=alert(1)>')
        expect(html).toContain('&lt;img')
    })

    it('未登入：PIN 表單（帳號/PIN 輸入框 + 登入/註冊按鈕）', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false })
        expect(html).toContain('id="sync-selfhost-username"')
        expect(html).toContain('id="sync-selfhost-pin"')
        expect(html).toContain('id="sync-selfhost-login-btn"')
        expect(html).toContain('id="sync-selfhost-register-btn"')
        expect(html).not.toContain('id="sync-selfhost-signout-btn"')
    })

    it('未登入 + authMethod=google → Google 代理卡取代 PIN 表單', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, authMethod: 'google' })
        expect(html).toContain('id="sync-selfhost-google-btn"')
        expect(html).toContain('id="sync-auth-pin"')
        expect(html).toContain('id="sync-auth-google"')
        expect(html).not.toContain('id="sync-selfhost-username"')
    })

    it('registerEnabled=false → 註冊按鈕停用樣式 + 關閉註冊提示', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, registerEnabled: false })
        expect(html).toContain('cursor-not-allowed')
        expect(html).toContain('已關閉公開註冊')
        const html2 = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, registerEnabled: true })
        expect(html2).not.toContain('cursor-not-allowed')
        expect(html2).not.toContain('已關閉公開註冊')
    })

    it('未登入 + 已連結 Google 官方雲端 → 顯示登出警告', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, hasGoogle: true })
        expect(html).toContain('登入自架帳號將登出目前 Google 連結')
        const html2 = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, hasGoogle: false })
        expect(html2).not.toContain('登入自架帳號將登出目前 Google 連結')
    })

    it('伺服器 URL 輸入 + 測試連線按鈕（XSS 防護）', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, serverUrl: 'https://x.com"><script>alert(1)</script>' })
        expect(html).not.toContain('"><script>alert(1)</script>')
        expect(html).toContain('id="sync-selfhost-test-btn"')
        expect(html).toContain('id="sync-selfhost-test-result"')
    })

    it('標題列與說明文字皆附 GitHub SELF_HOST.md 直達連結', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false })
        const docsUrl = 'https://github.com/ADT109119/jijun/blob/main/SELF_HOST.md'
        // 應出現兩個連結：標題右側「部署與使用說明」+ 說明文字內「使用說明（SELF_HOST.md）」
        const linkCount = (html.match(/href="https:\/\/github\.com\/ADT109119\/jijun\/blob\/main\/SELF_HOST\.md"/g) || []).length
        expect(linkCount).toBe(2)
        expect(html).toContain('部署與使用說明')
        expect(html).toContain('使用說明（SELF_HOST.md）')
        // 外部連結必須開新視窗且帶 noopener
        expect(html).toContain('rel="noopener noreferrer"')
    })

    it('registerEnabled=false 的關閉註冊提示也附使用說明連結', () => {
        const html = page.renderSelfHostPanel({ ...base, isSelfHostMode: false, registerEnabled: false })
        expect(html).toContain('管理方式詳見')
        expect(html).toContain('https://github.com/ADT109119/jijun/blob/main/SELF_HOST.md')
    })
})

// ════════════════════════════════════════════════════════════
// 6. renderAdminPanel（管理員帳號管理面板）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderAdminPanel', () => {
    const page = new SyncSettingsPage({ syncService: {} })

    it('registerEnabled=true → data-enabled="true" + 「已開啟」', () => {
        const html = page.renderAdminPanel({ registerEnabled: true, adminUsers: [] })
        expect(html).toContain('data-enabled="true"')
        expect(html).toContain('已開啟')
    })

    it('registerEnabled=false → data-enabled="false" + 「已關閉」', () => {
        const html = page.renderAdminPanel({ registerEnabled: false, adminUsers: [] })
        expect(html).toContain('data-enabled="false"')
        expect(html).toContain('已關閉')
    })

    it('帳號列表：admin 有「管理員」badge 且無刪除按鈕；一般帳號有刪除按鈕', () => {
        const html = page.renderAdminPanel({
            registerEnabled: true,
            adminUsers: [
                { username: 'admin', isAdmin: true },
                { username: 'bob', isAdmin: false },
            ],
        })
        expect(html).toContain('data-username="admin"')
        expect(html).toContain('data-username="bob"')
        expect(html).toContain('selfhost-reset-pin-btn')
        const adminRow = html.split('data-username="admin"')[1].split('</div>')[0]
        const bobRow = html.split('data-username="bob"')[1].split('</div>')[0]
        expect(adminRow).not.toContain('selfhost-delete-user-btn')
        expect(bobRow).toContain('selfhost-delete-user-btn')
        expect(html).toContain('管理員</span>')
    })

    it('空帳號列表 → 「（載入中或無帳號）」', () => {
        const html = page.renderAdminPanel({ registerEnabled: true, adminUsers: [] })
        expect(html).toContain('（載入中或無帳號）')
    })

    it('帳號名稱 XSS 防護（username 與 data-username）', () => {
        const html = page.renderAdminPanel({
            registerEnabled: true,
            adminUsers: [{ username: 'bob"><script>alert(1)</script>', isAdmin: false }],
        })
        expect(html).not.toContain('"><script>alert(1)</script>')
        expect(html).toContain('&lt;script&gt;')
    })
})

// ════════════════════════════════════════════════════════════
// 7. renderSignedInCards（備份 + 多裝置同步卡）
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - renderSignedInCards', () => {
    const page = new SyncSettingsPage({
        syncService: { deviceId: 'device-123' },
    })
    const base = {
        lastBackup: null,
        lastSync: null,
        autoSyncEnabled: null,
        autoBackupEnabled: null,
        backupIntervalValue: 'daily',
    }

    it('selfhost 通道：文案「自架伺服器」+ BACKUP_RETENTION_COUNT 保留說明', () => {
        const html = page.renderSignedInCards({ ...base, isSelfHostMode: true })
        expect(html).toContain('自架伺服器')
        expect(html).toContain('BACKUP_RETENTION_COUNT')
    })

    it('Google 通道：文案「Google Drive」+ 保留策略說明', () => {
        const html = page.renderSignedInCards({ ...base, isSelfHostMode: false })
        expect(html).toContain('Google Drive')
        expect(html).toContain('每月僅保留一筆')
    })

    it('有備份時間戳 → 顯示格式化日期；無 → 「尚未備份」', () => {
        // renderSignedInCards 接收 getSetting() 原形（{key, value} 包裹）
        const withTs = page.renderSignedInCards({
            ...base,
            isSelfHostMode: false,
            lastBackup: { value: { timestamp: '2026-09-01T10:00:00.000Z' } },
        })
        expect(withTs).toContain('2026')
        const noTs = page.renderSignedInCards({ ...base, isSelfHostMode: false })
        expect(noTs).toContain('尚未備份')
    })

    it('自動備份開 → toggle checked + 頻率容器顯示 + 選中「每 3 天」', () => {
        const html = page.renderSignedInCards({
            ...base,
            isSelfHostMode: false,
            autoBackupEnabled: { value: true },
            backupIntervalValue: '3days',
        })
        expect(html).toContain('id="sync-auto-backup-toggle"')
        expect(html).toContain('checked')
        expect(html).toContain('id="auto-backup-interval-container" class=""')
        // 「每 3 天」按鈕應為選中樣式
        const btn3 = html.split('data-interval="3days"')[1].split('>')[0]
        expect(btn3).toContain('bg-wabi-primary')
    })

    it('自動備份關 → 頻率容器 hidden', () => {
        const html = page.renderSignedInCards({
            ...base,
            isSelfHostMode: false,
            autoBackupEnabled: { value: false },
        })
        expect(html).toContain('id="auto-backup-interval-container" class="hidden"')
    })

    it('裝置 ID 顯示 + 立即同步/備份/還原按鈕', () => {
        const html = page.renderSignedInCards({ ...base, isSelfHostMode: false })
        expect(html).toContain('device-123')
        expect(html).toContain('id="sync-backup-btn"')
        expect(html).toContain('id="sync-restore-btn"')
        expect(html).toContain('id="sync-now-btn"')
    })
})

// ════════════════════════════════════════════════════════════
// 8. render() 整合
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - render() 整合', () => {
    it('官方 + 未登入：登入卡顯示、無帳號卡、無備份卡', async () => {
        const ctx = makeCtx({})
        const dom = await ctx.render()
        expect(dom.innerHTML).toContain('id="sync-sign-in-btn"')
        expect(dom.innerHTML).not.toContain('id="sync-sign-out-btn"')
        expect(dom.innerHTML).not.toContain('id="sync-backup-btn"')
    })

    it('官方 + 已登入：帳號卡 + 備份卡顯示', async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        const dom = await ctx.render()
        expect(dom.innerHTML).toContain('id="sync-sign-out-btn"')
        expect(dom.innerHTML).toContain('id="sync-backup-btn"')
        expect(dom.innerHTML).toContain('G User')
        expect(dom.innerHTML).not.toContain('id="sync-sign-in-btn"')
    })

    it('官方模式 + 自架 serverUrl → fetch /api/health 偵測註冊開關', async () => {
        const ctx = makeCtx({ signedInGoogle: true, serverUrl: SELF_HOST_URL })
        await ctx.render()
        expect(fetch).toHaveBeenCalledWith(SELF_HOST_URL + '/api/health', { cache: 'no-store' })
    })

    it('selfhost + admin：管理員面板顯示 + adminListUsers 被呼叫', async () => {
        const ctx = makeCtx({ selfHost: true })
        const dom = await ctx.render()
        expect(ctx.syncService.adminListUsers).toHaveBeenCalled()
        expect(dom.innerHTML).toContain('selfhost-register-toggle-btn')
        expect(dom.innerHTML).toContain('data-username="bob"')
    })

    it('selfhost + adminListUsers 失敗（非 admin）→ 無管理員面板', async () => {
        const ctx = makeCtx({ selfHost: true, adminListUsersFails: true })
        const dom = await ctx.render()
        expect(ctx.syncService.adminListUsers).toHaveBeenCalled()
        expect(dom.innerHTML).not.toContain('selfhost-register-toggle-btn')
        expect(dom.innerHTML).toContain('id="sync-selfhost-signout-btn"')
    })

    it('health fetch 失敗 → 不崩潰、registerEnabled 保持 null（顯示註冊按鈕）', async () => {
        const ctx = makeCtx({ signedInGoogle: false, serverUrl: SELF_HOST_URL })
        vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))
        const dom = await ctx.render()
        expect(dom.innerHTML).toContain('id="sync-sign-in-btn"')
    })

    it('selfhost 模式：頂部 selector 預設 selfhost 活躍', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        const btn = document.getElementById('sync-mode-selfhost')
        expect(btn.className).toContain('bg-wabi-primary')
        expect(ctx.page.activeMode).toBe('selfhost')
    })

    it('render 重入防護：較早（慢）的 render 結果被 seq guard 棄寫', async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        // 攔截 getSetting：每次呼叫回傳獨立的 deferred promise
        const pending = []
        ctx.app.dataService.getSetting = vi.fn(
            key =>
                new Promise(res => pending.push({ key, resolve: res }))
        )
        const r1 = ctx.page.render() // seq N
        const r2 = ctx.page.render() // seq N+1
        // 兩筆 render 的 getSetting 交替排隊（d0=r1, d1=r2, d2=r1...）：
        // 偶數 index 屬於 r1（2019 時間戳）、奇數 index 屬於 r2（2020）。
        // 逐一 resolve 讓兩筆各推進到 5 個 getSetting 後再走 fetch（已 stub）。
        for (let i = 0; i < 10; i++) {
            const year = i % 2 === 0 ? 2019 : 2020
            pending[i].resolve({
                key: pending[i].key,
                value: { timestamp: `${year}-01-01T00:00:00.000Z` },
            })
            await flush()
        }
        await r1
        await r2
        await flushAll()
        // r1 結果應被 seq guard 棄寫（2019 不上 DOM）、r2 結果寫入（2020）
        expect(ctx.app.appContainer.innerHTML).toContain('2020')
        expect(ctx.app.appContainer.innerHTML).not.toContain('2019')
    })
})

// ════════════════════════════════════════════════════════════
// 9. setupSyncSettingsListeners — 模式 / 登入方式切換
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 模式/登入方式切換', () => {
    it('點擊「自架伺服器」tab → activeMode 切換並重繪自架面板', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        document.getElementById('sync-mode-selfhost').click()
        await flushAll()
        expect(ctx.page.activeMode).toBe('selfhost')
        expect(document.getElementById('selfhost-section')).toBeTruthy()
    })

    it('點擊已活躍的 tab → 不觸發重繪（render 計數不變）', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        const renderSpy = vi.spyOn(ctx.page, 'render')
        document.getElementById('sync-mode-official').click()
        await flushAll()
        expect(renderSpy).not.toHaveBeenCalled()
    })

    it('自架未登入：PIN ↔ Google 登入方式切換', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        document.getElementById('sync-mode-selfhost').click()
        await flushAll()
        expect(document.getElementById('sync-selfhost-username')).toBeTruthy()
        document.getElementById('sync-auth-google').click()
        await flushAll()
        expect(ctx.page.authMethod).toBe('google')
        expect(document.getElementById('sync-selfhost-google-btn')).toBeTruthy()
        expect(document.getElementById('sync-selfhost-username')).toBeNull()
    })
})

// ════════════════════════════════════════════════════════════
// 10. setupSyncSettingsListeners — 伺服器 URL 儲存/還原
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 伺服器 URL 儲存/還原', () => {
    it('空白 URL → error toast、不呼叫 setServerUrl', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        const input = document.getElementById('sync-server-url-input')
        input.value = '   '
        document.getElementById('sync-server-save-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('請輸入伺服器 URL', 'error')
        expect(ctx.syncService.setServerUrl).not.toHaveBeenCalled()
    })

    it('正常儲存：結尾斜線標準化 + success toast + 重繪', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        const input = document.getElementById('sync-server-url-input')
        input.value = 'https://new.example.com/'
        document.getElementById('sync-server-save-btn').click()
        await flushAll()
        expect(ctx.syncService.setServerUrl).toHaveBeenCalledWith('https://new.example.com')
        expect(showToast).toHaveBeenCalledWith('伺服器 URL 已儲存', 'success')
    })

    it('selfhost 已登入 + 換地址：確認 → 先 signOut 再 setServerUrl + activeMode 重設', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        const input = document.getElementById('sync-server-url-input')
        input.value = 'https://other.example.com'
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.getElementById('sync-server-save-btn').click()
        await flushAll()
        expect(customConfirm).toHaveBeenCalled()
        expect(ctx.syncService.signOut).toHaveBeenCalled()
        expect(ctx.syncService.setServerUrl).toHaveBeenCalledWith('https://other.example.com')
        // 登出後重繪時 deriveActiveMode 重新推導（mock signOut 已切回官方通道）
        expect(ctx.page.activeMode).toBe('official')
    })

    it('selfhost 已登入 + 換地址：取消 → 不 signOut、不 setServerUrl', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        const input = document.getElementById('sync-server-url-input')
        input.value = 'https://other.example.com'
        vi.mocked(customConfirm).mockResolvedValueOnce(false)
        document.getElementById('sync-server-save-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).not.toHaveBeenCalled()
        expect(ctx.syncService.setServerUrl).not.toHaveBeenCalled()
    })

    it('selfhost 已登入 + 結尾斜線 URL 與現值相同 → 不觸發登出確認', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        const input = document.getElementById('sync-server-url-input')
        input.value = SELF_HOST_URL + '/' // 標準化後與現值相同
        document.getElementById('sync-server-save-btn').click()
        await flushAll()
        expect(customConfirm).not.toHaveBeenCalled()
        expect(ctx.syncService.signOut).not.toHaveBeenCalled()
        expect(ctx.syncService.setServerUrl).toHaveBeenCalledWith(SELF_HOST_URL)
    })

    it('還原預設（非 selfhost）→ 直接 setServerUrl(DEFAULT) 不需確認', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        document.getElementById('sync-server-reset-btn').click()
        await flushAll()
        expect(customConfirm).not.toHaveBeenCalled()
        expect(ctx.syncService.setServerUrl).toHaveBeenCalledWith(DEFAULT_SERVER_URL)
        expect(showToast).toHaveBeenCalledWith('已還原預設伺服器 URL', 'success')
    })

    it('還原預設（selfhost 已登入 + 自架地址）→ 確認後 signOut + setServerUrl(DEFAULT) + 重繪切官方', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.getElementById('sync-server-reset-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).toHaveBeenCalled()
        expect(ctx.syncService.setServerUrl).toHaveBeenCalledWith(DEFAULT_SERVER_URL)
        // 登出後重繪時重新推導（mock signOut 已切回官方通道）
        expect(ctx.page.activeMode).toBe('official')
    })
})

// ════════════════════════════════════════════════════════════
// 11. setupSyncSettingsListeners — 自架 PIN 登入/註冊
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 自架 PIN 登入/註冊', () => {
    const gotoSelfHostForm = async () => {
        const ctx = makeCtx({})
        await ctx.render()
        document.getElementById('sync-mode-selfhost').click()
        await flushAll()
        return ctx
    }

    it('帳號/PIN 空白 → error toast、不呼叫 selfHostLogin', async () => {
        const ctx = await gotoSelfHostForm()
        document.getElementById('sync-selfhost-login-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('請輸入帳號與 PIN 碼', 'error')
        expect(ctx.syncService.selfHostLogin).not.toHaveBeenCalled()
    })

    it('登入成功 → toast + 重繪（已登入卡）', async () => {
        const ctx = await gotoSelfHostForm()
        document.getElementById('sync-selfhost-username').value = 'alice'
        document.getElementById('sync-selfhost-pin').value = '1234'
        ctx.syncService.selfHostUsername = 'alice' // 模擬登入成功後狀態
        document.getElementById('sync-selfhost-login-btn').click()
        await flushAll()
        expect(ctx.syncService.selfHostLogin).toHaveBeenCalledWith('alice', '1234')
        expect(showToast).toHaveBeenCalledWith('自架帳號登入成功！', 'success')
    })

    it('登入失敗 → error toast + 按鈕恢復可點', async () => {
        const ctx = await gotoSelfHostForm()
        document.getElementById('sync-selfhost-username').value = 'alice'
        document.getElementById('sync-selfhost-pin').value = 'wrong'
        ctx.syncService.selfHostLogin.mockRejectedValueOnce(new Error('bad pin'))
        document.getElementById('sync-selfhost-login-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('登入失敗：bad pin', 'error')
        const btn = document.getElementById('sync-selfhost-login-btn')
        expect(btn.disabled).toBe(false)
    })

    it('註冊失敗 → error toast（註冊失敗：前綴）', async () => {
        const ctx = await gotoSelfHostForm()
        document.getElementById('sync-selfhost-username').value = 'newbie'
        document.getElementById('sync-selfhost-pin').value = '1234'
        ctx.syncService.selfHostRegister.mockRejectedValueOnce(new Error('403 closed'))
        document.getElementById('sync-selfhost-register-btn').click()
        await flushAll()
        expect(ctx.syncService.selfHostRegister).toHaveBeenCalledWith('newbie', '1234')
        expect(showToast).toHaveBeenCalledWith('註冊失敗：403 closed', 'error')
    })

    it('測試連線：ok=true → 綠色成功文案', async () => {
        const ctx = await gotoSelfHostForm()
        ctx.syncService.selfHostCheckServer.mockResolvedValueOnce(true)
        document.getElementById('sync-selfhost-test-btn').click()
        await flushAll()
        const resultEl = document.getElementById('sync-selfhost-test-result')
        expect(resultEl.textContent).toBe('連線成功（自架同步已啟用）')
        expect(resultEl.className).toContain('text-green-600')
        // 測「輸入框目前的值」而非已存設定（未登入模式預設官方 URL）
        expect(ctx.syncService.selfHostCheckServer).toHaveBeenCalledWith(DEFAULT_SERVER_URL)
    })

    it('測試連線：ok=false → 紅色失敗文案', async () => {
        const ctx = await gotoSelfHostForm()
        ctx.syncService.selfHostCheckServer.mockResolvedValueOnce(false)
        document.getElementById('sync-selfhost-test-btn').click()
        await flushAll()
        const resultEl = document.getElementById('sync-selfhost-test-result')
        expect(resultEl.textContent).toBe('伺服器無回應或自架同步未啟用')
        expect(resultEl.className).toContain('text-red-500')
    })

    it('測試連線：fetch 例外 → 「無法連接到伺服器」', async () => {
        const ctx = await gotoSelfHostForm()
        ctx.syncService.selfHostCheckServer.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        document.getElementById('sync-selfhost-test-btn').click()
        await flushAll()
        const resultEl = document.getElementById('sync-selfhost-test-result')
        expect(resultEl.textContent).toBe('無法連接到伺服器')
    })

    it('登出自架：取消確認 → 不 signOut', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        vi.mocked(customConfirm).mockResolvedValueOnce(false)
        document.getElementById('sync-selfhost-signout-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).not.toHaveBeenCalled()
    })

    it('登出自架：確認 → signOut + success toast + 重繪切官方', async () => {
        const ctx = makeCtx({ selfHost: true })
        await ctx.render()
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.getElementById('sync-selfhost-signout-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('已登出自架帳號', 'success')
        // 登出後重繪時 deriveActiveMode 重新推導（mock signOut 已切回官方通道）
        expect(ctx.page.activeMode).toBe('official')
    })
})

// ════════════════════════════════════════════════════════════
// 12. setupSyncSettingsListeners — 自架 Google 代理登入
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 自架 Google 代理登入', () => {
    const gotoProxyCard = async () => {
        const ctx = makeCtx({})
        await ctx.render()
        document.getElementById('sync-mode-selfhost').click()
        await flushAll()
        document.getElementById('sync-auth-google').click()
        await flushAll()
        return ctx
    }

    it('成功 → toast + 重繪切官方面板（Google 代理通道不綁 selfhost 旗標）', async () => {
        const ctx = await gotoProxyCard()
        // 模擬真實 signIn 結果：Google token 寫入（Drive 通道）
        ctx.syncService.signIn.mockImplementationOnce(async () => {
            ctx.syncService.accessToken = 'at'
            ctx.syncService.refreshToken = 'rt'
        })
        document.getElementById('sync-selfhost-google-btn').click()
        await flushAll()
        expect(ctx.syncService.signIn).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('Google 帳號登入成功！', 'success')
        // activeMode 重設後 deriveActiveMode 重新推導 → 官方面板顯示已登入卡
        expect(ctx.page.activeMode).toBe('official')
        expect(document.getElementById('sync-sign-out-btn')).toBeTruthy()
    })

    it('失敗 → error toast（含 GOOGLE_CLIENT_ID 提示）+ 按鈕恢復', async () => {
        const ctx = await gotoProxyCard()
        ctx.syncService.signIn.mockRejectedValueOnce(new Error('no oauth'))
        const btn = document.getElementById('sync-selfhost-google-btn')
        btn.click()
        await flushAll()
        expect(showToast).toHaveBeenCalled()
        expect(showToast.mock.calls.at(-1)[0]).toContain('Google 登入失敗：no oauth')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('使用 Google 帳號登入')
    })
})

// ════════════════════════════════════════════════════════════
// 13. setupSyncSettingsListeners — 管理員面板操作
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 管理員帳號管理', () => {
    const adminCtx = async () => {
        const ctx = makeCtx({
            selfHost: true,
            adminUsers: [
                { username: 'admin', isAdmin: true },
                { username: 'bob', isAdmin: false },
            ],
        })
        await ctx.render()
        return ctx
    }

    it('註冊開關（已關閉→開啟）：data-enabled=false 解析 → adminSetRegister(true) + 重繪', async () => {
        const ctx = makeCtx({
            selfHost: true,
            adminUsers: [{ username: 'admin', isAdmin: true }],
        })
        // 模擬 registerEnabled=false 的 adminListUsers
        ctx.syncService.adminListUsers.mockResolvedValueOnce({ users: [], registerEnabled: false })
        await ctx.render()
        const toggle = document.getElementById('selfhost-register-toggle-btn')
        expect(toggle.dataset.enabled).toBe('false')
        toggle.click()
        await flushAll()
        expect(ctx.syncService.adminSetRegister).toHaveBeenCalledWith(true)
        expect(showToast).toHaveBeenCalledWith('已開啟公開註冊', 'success')
    })

    it('註冊開關（已開啟→關閉）：adminSetRegister(false)', async () => {
        const ctx = await adminCtx()
        const toggle = document.getElementById('selfhost-register-toggle-btn')
        expect(toggle.dataset.enabled).toBe('true')
        toggle.click()
        await flushAll()
        expect(ctx.syncService.adminSetRegister).toHaveBeenCalledWith(false)
        expect(showToast).toHaveBeenCalledWith('已關閉公開註冊', 'success')
    })

    it('註冊開關失敗 → error toast', async () => {
        const ctx = await adminCtx()
        ctx.syncService.adminSetRegister.mockRejectedValueOnce(new Error('500'))
        document.getElementById('selfhost-register-toggle-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('操作失敗：500', 'error')
    })

    it('建立帳號：非法 username（過短）→ error toast、不呼叫 adminCreateUser', async () => {
        const ctx = await adminCtx()
        document.getElementById('selfhost-admin-new-username').value = 'a'
        document.getElementById('selfhost-admin-new-pin').value = '1234'
        document.getElementById('selfhost-admin-create-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('帳號需 2-32 字元（英數字/_/-）', 'error')
        expect(ctx.syncService.adminCreateUser).not.toHaveBeenCalled()
    })

    it('建立帳號：username 含非法字元 → error toast', async () => {
        const ctx = await adminCtx()
        document.getElementById('selfhost-admin-new-username').value = 'bad name!'
        document.getElementById('selfhost-admin-new-pin').value = '1234'
        document.getElementById('selfhost-admin-create-btn').click()
        await flushAll()
        expect(ctx.syncService.adminCreateUser).not.toHaveBeenCalled()
    })

    it('建立帳號：PIN < 4 碼 → error toast', async () => {
        const ctx = await adminCtx()
        document.getElementById('selfhost-admin-new-username').value = 'carol'
        document.getElementById('selfhost-admin-new-pin').value = '123'
        document.getElementById('selfhost-admin-create-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('PIN 至少 4 碼', 'error')
        expect(ctx.syncService.adminCreateUser).not.toHaveBeenCalled()
    })

    it('建立帳號成功 → customAlert 顯示新 PIN（只回傳一次）+ success toast', async () => {
        const ctx = await adminCtx()
        document.getElementById('selfhost-admin-new-username').value = 'carol'
        document.getElementById('selfhost-admin-new-pin').value = '5678'
        document.getElementById('selfhost-admin-create-btn').click()
        await flushAll()
        expect(ctx.syncService.adminCreateUser).toHaveBeenCalledWith('carol', '5678')
        expect(customAlert).toHaveBeenCalled()
        expect(customAlert.mock.calls[0][0]).toContain('PIN：5678')
        expect(customAlert.mock.calls[0][0]).toContain('carol')
        expect(showToast).toHaveBeenCalledWith('帳號已建立', 'success')
    })

    it('建立帳號失敗 → error toast', async () => {
        const ctx = await adminCtx()
        ctx.syncService.adminCreateUser.mockRejectedValueOnce(new Error('exists'))
        document.getElementById('selfhost-admin-new-username').value = 'bob'
        document.getElementById('selfhost-admin-new-pin').value = '1234'
        document.getElementById('selfhost-admin-create-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('建立失敗：exists', 'error')
    })

    it('重置 PIN：prompt 取消（null）→ 不呼叫 adminResetPin', async () => {
        const ctx = await adminCtx()
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null)
        document.querySelector('.selfhost-reset-pin-btn[data-username="bob"]').click()
        await flushAll()
        expect(promptSpy).toHaveBeenCalled()
        expect(ctx.syncService.adminResetPin).not.toHaveBeenCalled()
    })

    it('重置 PIN：短 PIN → error toast', async () => {
        const ctx = await adminCtx()
        vi.spyOn(window, 'prompt').mockReturnValueOnce('123')
        document.querySelector('.selfhost-reset-pin-btn[data-username="bob"]').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('PIN 至少 4 碼', 'error')
        expect(ctx.syncService.adminResetPin).not.toHaveBeenCalled()
    })

    it('重置 PIN 成功 → customAlert 顯示新 PIN + toast', async () => {
        const ctx = await adminCtx()
        vi.spyOn(window, 'prompt').mockReturnValueOnce('9999')
        document.querySelector('.selfhost-reset-pin-btn[data-username="bob"]').click()
        await flushAll()
        expect(ctx.syncService.adminResetPin).toHaveBeenCalledWith('bob', '9999')
        expect(customAlert).toHaveBeenCalled()
        expect(customAlert.mock.calls[0][0]).toContain('新 PIN：9999')
        expect(showToast).toHaveBeenCalledWith('PIN 已重置', 'success')
    })

    it('刪除帳號：取消確認 → 不呼叫 adminDeleteUser', async () => {
        const ctx = await adminCtx()
        vi.mocked(customConfirm).mockResolvedValueOnce(false)
        document.querySelector('.selfhost-delete-user-btn[data-username="bob"]').click()
        await flushAll()
        expect(ctx.syncService.adminDeleteUser).not.toHaveBeenCalled()
    })

    it('刪除帳號成功 → toast + 重繪', async () => {
        const ctx = await adminCtx()
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.querySelector('.selfhost-delete-user-btn[data-username="bob"]').click()
        await flushAll()
        expect(ctx.syncService.adminDeleteUser).toHaveBeenCalledWith('bob')
        expect(showToast).toHaveBeenCalledWith('帳號已刪除', 'success')
    })

    it('刪除帳號失敗 → error toast', async () => {
        const ctx = await adminCtx()
        ctx.syncService.adminDeleteUser.mockRejectedValueOnce(new Error('in use'))
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.querySelector('.selfhost-delete-user-btn[data-username="bob"]').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('刪除失敗：in use', 'error')
    })
})

// ════════════════════════════════════════════════════════════
// 14. setupSyncSettingsListeners — 官方模式 Google 登入/登出
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 官方 Google 登入/登出', () => {
    it('登入成功 → toast + 重繪顯示帳號卡', async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        await ctx.render()
        // 模擬登入前狀態：移除 token 讓登入卡出現
        ctx.syncService.accessToken = null
        ctx.syncService.refreshToken = null
        await ctx.render()
        document.getElementById('sync-sign-in-btn').click()
        await flushAll()
        expect(ctx.syncService.signIn).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('Google 帳號登入成功！', 'success')
    })

    it('登入失敗 → error toast + 按鈕恢復', async () => {
        const ctx = makeCtx({})
        await ctx.render()
        ctx.syncService.signIn.mockRejectedValueOnce(new Error('denied'))
        const btn = document.getElementById('sync-sign-in-btn')
        btn.click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('登入失敗：denied', 'error')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('使用 Google 帳號登入')
    })

    it('登出：取消確認 → 不 signOut', async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        await ctx.render()
        vi.mocked(customConfirm).mockResolvedValueOnce(false)
        document.getElementById('sync-sign-out-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).not.toHaveBeenCalled()
    })

    it('登出：確認 → signOut + toast + 重繪切回官方推導', async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        await ctx.render()
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        document.getElementById('sync-sign-out-btn').click()
        await flushAll()
        expect(ctx.syncService.signOut).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('已登出 Google 帳號', 'success')
        // 重繪時 deriveActiveMode 重新推導為 official（mock token 未清除，
        // 真實世界 signOut 會清 accessToken/refreshToken）
        expect(ctx.page.activeMode).toBe('official')
    })
})

// ════════════════════════════════════════════════════════════
// 15. setupSyncSettingsListeners — 備份/還原
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 備份/還原', () => {
    const signedIn = async () => {
        const ctx = makeCtx({ signedInGoogle: true })
        await ctx.render()
        return ctx
    }

    it('立即備份成功 → toast + 重繪', async () => {
        const ctx = await signedIn()
        document.getElementById('sync-backup-btn').click()
        await flushAll()
        expect(ctx.syncService.backupToDrive).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('備份成功！', 'success')
    })

    it('立即備份失敗 → error toast + 按鈕恢復', async () => {
        const ctx = await signedIn()
        ctx.syncService.backupToDrive.mockRejectedValueOnce(new Error('quota'))
        document.getElementById('sync-backup-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('備份失敗：quota', 'error')
        const btn = document.getElementById('sync-backup-btn')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('立即備份')
    })

    it('還原：無備份 → info toast、不彈 modal', async () => {
        const ctx = await signedIn()
        document.getElementById('sync-restore-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('沒有找到任何備份', 'info')
        expect(document.querySelector('.restore-backup-item')).toBeNull()
    })

    it('還原：有備份 → modal 顯示備份列表（名稱/日期/大小 KB）', async () => {
        const ctx = await signedIn()
        ctx.syncService.listBackups.mockResolvedValueOnce([
            { id: 'f1', name: 'backup-1.json', createdTime: '2026-09-01T00:00:00.000Z', size: '2048' },
            { id: 'f2', name: 'backup-2.json', createdTime: '2026-08-01T00:00:00.000Z', size: null },
        ])
        document.getElementById('sync-restore-btn').click()
        await flushAll()
        const items = document.querySelectorAll('.restore-backup-item')
        expect(items.length).toBe(2)
        expect(items[0].dataset.fileId).toBe('f1')
        expect(document.body.innerHTML).toContain('backup-1.json')
        expect(document.body.innerHTML).toContain('2.0 KB')
        expect(document.body.innerHTML).toContain('? KB') // size null → ?
    })

    it('還原：取消確認 → 不 restoreFromDrive', async () => {
        const ctx = await signedIn()
        ctx.syncService.listBackups.mockResolvedValueOnce([
            { id: 'f1', name: 'backup-1.json', createdTime: '2026-09-01T00:00:00.000Z', size: '1024' },
        ])
        vi.mocked(customConfirm).mockResolvedValueOnce(false)
        document.getElementById('sync-restore-btn').click()
        await flushAll()
        document.querySelector('.restore-backup-item').click()
        await flushAll()
        expect(ctx.syncService.restoreFromDrive).not.toHaveBeenCalled()
    })

    it('還原：確認 → restoreFromDrive + importData + markAllRemoteChangesAsPulled', async () => {
        const ctx = await signedIn()
        ctx.syncService.listBackups.mockResolvedValueOnce([
            { id: 'f1', name: 'backup-1.json', createdTime: '2026-09-01T00:00:00.000Z', size: '1024' },
        ])
        vi.mocked(customConfirm).mockResolvedValueOnce(true)
        // v2.1.8.0：還原成功後延遲 1.2s 跳回首頁並整頁重載（清除記憶體殘留狀態），
        // stub 掉 reload 避免 jsdom 導航錯誤
        const reloadSpy = vi.fn()
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...window.location, hash: '', reload: reloadSpy },
        })
        document.getElementById('sync-restore-btn').click()
        await flushAll()
        document.querySelector('.restore-backup-item').click()
        await flushAll()
        expect(ctx.syncService.restoreFromDrive).toHaveBeenCalledWith('f1')
        expect(ctx.app.dataService.importData).toHaveBeenCalled()
        expect(ctx.app.reloadAppData).toHaveBeenCalled()
        expect(ctx.syncService.markAllRemoteChangesAsPulled).toHaveBeenCalled()
        // v2.1.8.1：成功流程改經進度彈窗收斂（setTimeout 500ms → close 動畫 cb），
        // 最終 toast/跳轉皆非同步收斂，斷言移入 waitFor。
        // 跳轉前不應已切換 hash
        expect(window.location.hash).toBe('')
        await vi.waitFor(
            () => {
                expect(showToast).toHaveBeenCalledWith(
                    '備份還原成功！正在重新載入...',
                    'success'
                )
                expect(window.location.hash).toBe('#home')
                expect(reloadSpy).toHaveBeenCalled()
            },
            { timeout: 3000, interval: 100 }
        )
    }, 10000)

    it('還原：載入備份列表失敗 → error toast', async () => {
        const ctx = await signedIn()
        ctx.syncService.listBackups.mockRejectedValueOnce(new Error('net'))
        document.getElementById('sync-restore-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('載入備份列表失敗：net', 'error')
    })
})

// ════════════════════════════════════════════════════════════
// 16. setupSyncSettingsListeners — 自動備份/自動同步開關
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 自動備份/自動同步', () => {
    const signedIn = async (settings = {}) => {
        const ctx = makeCtx({ signedInGoogle: true, settings })
        await ctx.render()
        return ctx
    }

    it('自動備份開 → saveSetting + startAutoBackup(存儲間隔) + 頻率容器顯示', async () => {
        // makeCtx 的 getSetting 已包 {key, value} → settings map 放原始值
        const ctx = await signedIn({ sync_auto_backup_interval: 'weekly' })
        const toggle = document.getElementById('sync-auto-backup-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change'))
        await flushAll()
        expect(ctx.app.dataService.saveSetting).toHaveBeenCalledWith({
            key: 'sync_auto_backup_enabled',
            value: true,
        })
        expect(ctx.syncService.startAutoBackup).toHaveBeenCalledWith('weekly')
        const container = document.getElementById('auto-backup-interval-container')
        expect(container.classList.contains('hidden')).toBe(false)
        expect(showToast).toHaveBeenCalledWith('已啟用自動備份', 'success')
    })

    it('自動備份關 → stopAutoBackup + 頻率容器隱藏', async () => {
        const ctx = await signedIn({
            sync_auto_backup_enabled: true,
            sync_auto_backup_interval: 'daily',
        })
        const toggle = document.getElementById('sync-auto-backup-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change'))
        await flushAll()
        expect(ctx.syncService.stopAutoBackup).toHaveBeenCalled()
        const container = document.getElementById('auto-backup-interval-container')
        expect(container.classList.contains('hidden')).toBe(true)
        expect(showToast).toHaveBeenCalledWith('已停用自動備份', 'info')
    })

    it('頻率按鈕 → saveSetting + startAutoBackup（僅在自動備份開啟時）+ toast', async () => {
        const ctx = await signedIn({ sync_auto_backup_enabled: true })
        const btn3 = document.querySelector('.auto-backup-interval-btn[data-interval="3days"]')
        btn3.click()
        await flushAll()
        expect(ctx.app.dataService.saveSetting).toHaveBeenCalledWith({
            key: 'sync_auto_backup_interval',
            value: '3days',
        })
        expect(ctx.syncService.startAutoBackup).toHaveBeenCalledWith('3days')
        expect(showToast).toHaveBeenCalledWith('備份頻率已設定為每 3 天', 'success')
    })

    it('頻率按鈕（自動備份關閉）→ saveSetting 但不起動 startAutoBackup', async () => {
        const ctx = await signedIn({})
        const btnW = document.querySelector('.auto-backup-interval-btn[data-interval="weekly"]')
        btnW.click()
        await flushAll()
        expect(ctx.app.dataService.saveSetting).toHaveBeenCalled()
        expect(ctx.syncService.startAutoBackup).not.toHaveBeenCalled()
    })

    it('自動同步開 → saveSetting + startAutoSync(24h)', async () => {
        const ctx = await signedIn({})
        const toggle = document.getElementById('sync-auto-toggle')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change'))
        await flushAll()
        expect(ctx.app.dataService.saveSetting).toHaveBeenCalledWith({
            key: 'sync_auto_enabled',
            value: true,
        })
        expect(ctx.syncService.startAutoSync).toHaveBeenCalledWith(24 * 60 * 60 * 1000)
        expect(showToast).toHaveBeenCalledWith('已啟用自動同步', 'success')
    })

    it('自動同步關 → stopAutoSync', async () => {
        const ctx = await signedIn({ sync_auto_enabled: true })
        const toggle = document.getElementById('sync-auto-toggle')
        toggle.checked = false
        toggle.dispatchEvent(new Event('change'))
        await flushAll()
        expect(ctx.syncService.stopAutoSync).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('已停用自動同步', 'info')
    })

    it('立即同步成功 → toast + 重繪', async () => {
        const ctx = await signedIn({})
        document.getElementById('sync-now-btn').click()
        await flushAll()
        expect(ctx.syncService.performSync).toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledWith('同步完成！', 'success')
    })

    it('立即同步失敗 → error toast + 按鈕恢復', async () => {
        const ctx = await signedIn({})
        ctx.syncService.performSync.mockRejectedValueOnce(new Error('timeout'))
        document.getElementById('sync-now-btn').click()
        await flushAll()
        expect(showToast).toHaveBeenCalledWith('同步失敗：timeout', 'error')
        const btn = document.getElementById('sync-now-btn')
        expect(btn.disabled).toBe(false)
        expect(btn.innerHTML).toContain('立即同步')
    })
})

// ════════════════════════════════════════════════════════════
// 10. 主題變數回歸（origin v2.1.8.2 深色導覽優化）
// origin 原測試以舊版 render() inline Google 卡 + isSignedIn() mock 斷言；
// 本地雙通道重設計已改由 renderOfficialPanel / renderGoogleAccountCard
// 渲染 → 改為直調方法，語意不變：不得殘留寫死 green/gray，須為 wabi 變數。
// ════════════════════════════════════════════════════════════
describe('SyncSettingsPage - 主題變數（無寫死顏色，v2.1.8.2 回歸）', () => {
    const makePage = () =>
        new SyncSettingsPage({
            appContainer: document.createElement('div'),
            dataService: {
                getSetting: async () => null,
                saveSetting: async () => {},
            },
            syncService: {
                isSelfHostMode: () => false,
                getServerUrl: () => DEFAULT_SERVER_URL,
            },
        })

    it('未登入：官方面板登入卡無寫死 green/gray，文字使用主題變數', () => {
        const html = makePage().renderOfficialPanel({
            hasGoogle: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(html).toContain('id="sync-sign-in-btn"')
        expect(html).not.toContain('bg-green-50')
        expect(html).not.toContain('text-gray-700')
        expect(html).toContain('text-wabi-text-primary')
    })

    it('已登入：Google 帳號卡使用 wabi 主題變數，無寫死 green/red', () => {
        const html = makePage().renderGoogleAccountCard({
            userInfo: {
                name: '測試使用者',
                email: 'test@example.com',
                picture: 'https://example.com/avatar.png',
            },
            isSelfHostMode: false,
            serverUrl: DEFAULT_SERVER_URL,
        })
        expect(html).not.toContain('bg-green-50')
        expect(html).not.toContain('border-green-200')
        expect(html).not.toContain('bg-green-100')
        expect(html).not.toMatch(/\bhover:bg-red-50\b/)
        expect(html).toContain('bg-wabi-bg rounded-lg border border-wabi-border')
        expect(html).toContain('text-wabi-income')
        expect(html).toContain('測試使用者')
        expect(html).toContain('test@example.com')
    })
})

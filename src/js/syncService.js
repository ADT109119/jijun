/**
 * SyncService — Google OAuth + Drive 備份 + 多裝置同步引擎
 *
 * 所有同步資料皆存放於 Google Drive appDataFolder，不使用外部 KV。
 * Worker 僅負責 OAuth token exchange（因 client_secret 不能暴露在前端）。
 */

// showToast 暫存以便未來使用（目前未使用）
// eslint-disable-next-line no-unused-vars
import { showToast } from './utils.js'

/** @type {string} Google OAuth Client ID（透過 .env.local 設定，不硬編碼） */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

/** @type {string} Google API Key（透過 .env.local 設定，不硬編碼） */
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || ''

/** @type {string} 預設同步伺服器 URL（可透過 .env.local 的 VITE_SYNC_SERVER_URL 覆蓋） */
const DEFAULT_SERVER_URL = 'https://jijun-server.the-walking-fish.com'

/** @type {string[]} 基礎登入與個人備份所需 scope */
const BASE_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
]

/** @type {string[]} 共享功能額外所需 scope */
const SHARED_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
]

/**
 * @class SyncService
 * @description 提供 Google OAuth 登入、Drive 備份、多裝置同步功能
 */

const isNative =
    typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true

/**
 * Google SDK 按需載入（批次 3：取代 index.html 的兩個 eager <script>，
 * 讓首屏不載入登入/同步才需要的 Google 基建）。
 * - GSI client → window.google.accounts（OAuth 登入，initCodeClient）
 * - gapi api.js → window.gapi（Drive Picker，共用帳本選檔）
 * 只載入一次：結果快取在 Promise 上；載入成功後兩者在 window 常駐。
 * @returns {Promise<void>} resolve 當兩支 SDK 都載入完成；reject 當載入失敗
 *   （僅影響需要網路的登入/同步操作，本機記帳不受影響）
 */
let googleSdkLoading = null
function ensureGoogleSdk() {
    if (window.google?.accounts?.oauth2 && window.gapi) {
        return Promise.resolve()
    }
    if (googleSdkLoading) return googleSdkLoading
    const inject = src =>
        new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = src
            s.async = true
            s.onload = () => resolve()
            s.onerror = () => reject(new Error(`Google SDK 載入失敗：${src}`))
            document.head.appendChild(s)
        })
    googleSdkLoading = Promise.all([
        inject('https://accounts.google.com/gsi/client'),
        inject('https://apis.google.com/js/api.js'),
    ])
    // 失敗時清掉快取，讓下次操作可重試
    googleSdkLoading.catch(() => {
        googleSdkLoading = null
    })
    return googleSdkLoading
}

export class SyncService {
    /**
     * @param {import('./dataService.js').default} dataService
     */
    constructor(dataService) {
        /** @type {import('./dataService.js').default} */
        this.dataService = dataService

        /** @type {string|null} */
        this.accessToken = null

        /** @type {string|null} */
        this.refreshToken = null

        /** @type {number|null} token 過期時間 (epoch ms) */
        this.tokenExpiresAt = null

        /** @type {object|null} Google user profile */
        this.userInfo = null

        /** @type {string} 同步/驗證伺服器 URL（可透過 .env.local 的 VITE_SYNC_SERVER_URL 覆蓋） */
        this.serverUrl =
            import.meta.env.VITE_SYNC_SERVER_URL || DEFAULT_SERVER_URL

        /** @type {number|null} 自動同步 interval ID */
        this._autoSyncIntervalId = null

        /** @type {number|null} 自動備份 interval ID */
        this._autoBackupIntervalId = null

        /** @type {string} 裝置唯一 ID */
        this.deviceId = this.getDeviceId()

        /** @type {boolean} 是否正在同步中 */
        this._syncing = false
    }

    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    /**
     * 從 IndexedDB 還原已儲存的 token 和設定
     */
    async init() {
        try {
            const tokenData = await this.dataService.getSetting('sync_tokens')
            if (tokenData?.value) {
                this.accessToken = tokenData.value.access_token || null
                this.refreshToken = tokenData.value.refresh_token || null
                this.tokenExpiresAt = tokenData.value.expires_at || null
                this.userInfo = tokenData.value.user_info || null
            }

            const serverSetting =
                await this.dataService.getSetting('sync_server_url')
            if (serverSetting?.value) {
                this.serverUrl = serverSetting.value
            }

            // 如果已登入且 token 快過期，嘗試刷新
            if (this.refreshToken && this.isTokenExpiringSoon()) {
                await this.refreshAccessToken()
            }

            // 檢查是否需要啟動自動同步
            const autoSyncSetting =
                await this.dataService.getSetting('sync_auto_enabled')
            const isAutoSyncEnabled = autoSyncSetting?.value || false
            const ledgers = await this.dataService.getLedgers()
            const hasShared = ledgers.some(l => l.isShared)

            // 如果已經登入且有共用帳本，但尚未設定 sync_drive_file_authorized，預設為已獲得共享授權（相容舊用戶）
            const authorizedSetting = await this.dataService.getSetting(
                'sync_drive_file_authorized'
            )
            if (
                this.isSignedIn() &&
                hasShared &&
                authorizedSetting?.value === undefined
            ) {
                await this.dataService.saveSetting({
                    key: 'sync_drive_file_authorized',
                    value: true,
                })
            }

            if ((isAutoSyncEnabled || hasShared) && this.isSignedIn()) {
                this.startAutoSync()
            }

            // 檢查是否需要啟動自動備份
            const autoBackupSetting = await this.dataService.getSetting(
                'sync_auto_backup_enabled'
            )
            if (autoBackupSetting?.value && this.isSignedIn()) {
                const backupIntervalSetting = await this.dataService.getSetting(
                    'sync_auto_backup_interval'
                )
                const interval = backupIntervalSetting?.value || 'daily'
                this.startAutoBackup(interval)
            }
        } catch (err) {
            console.error('[SyncService] init error:', err)
        }
    }

    // ──────────────────────────────────────────────
    // Google OAuth
    // ──────────────────────────────────────────────

    /**
     * 是否已登入 Google
     * @returns {boolean}
     */
    isSignedIn() {
        return !!(this.accessToken && this.refreshToken)
    }

    /**
     * Token 是否即將過期（5 分鐘內）
     * @returns {boolean}
     */
    isTokenExpiringSoon() {
        if (!this.tokenExpiresAt) return true
        return Date.now() > this.tokenExpiresAt - 5 * 60 * 1000
    }

    /**
     * 確保有有效的 access token
     */
    async ensureValidToken() {
        if (this.isTokenExpiringSoon() && this.refreshToken) {
            await this.refreshAccessToken()
        }
        if (!this.accessToken) {
            throw new Error('Not signed in')
        }
    }

    /**
     * 使用 Google Identity Services (Web) 或 GoogleAuth (Native) 發起 OAuth 登入
     * @param {boolean} [requestSharing=false] 是否要求共享權限
     * @returns {Promise<boolean>} 是否登入成功
     */
    async signIn(requestSharing = false) {
        if (isNative) {
            return this._signInNative(requestSharing)
        }
        return this._signInWeb(requestSharing)
    }

    /**
     * 原生 App 登入：使用 @capgo/capacitor-social-login
     * @param {boolean} [requestSharing=false]
     */
    async _signInNative(requestSharing = false) {
        try {
            const socialLoginPlugin = '@capgo/capacitor-social-login'
            const { SocialLogin } = await import(
                /* @vite-ignore */ socialLoginPlugin
            )

            const GOOGLE_CLIENT_ID = '350965300840-7eutjcl4jq930h5fjvoja4ho77q30cpp.apps.googleusercontent.com'

            const nativeScopes = requestSharing
                ? [
                      'profile',
                      'email',
                      'https://www.googleapis.com/auth/drive.appdata',
                      'https://www.googleapis.com/auth/drive.file',
                  ]
                : [
                      'profile',
                      'email',
                      'https://www.googleapis.com/auth/drive.appdata',
                  ]

            await SocialLogin.initialize({
                google: {
                    webClientId: GOOGLE_CLIENT_ID,
                    mode: 'offline',
                },
            })

            const res = await SocialLogin.login({
                provider: 'google',
                options: { scopes: nativeScopes },
            })

            // res.result.serverAuthCode 在 offline mode
            const serverAuthCode = res.result.serverAuthCode

            if (!serverAuthCode) {
                throw new Error(
                    '未取得 serverAuthCode (請確認 Google Cloud Console 設定了正確的 Web Client ID 且 offline mode 生效)'
                )
            }

            await this.handleAuthCallback(serverAuthCode)
            if (requestSharing) {
                await this.dataService.saveSetting({
                    key: 'sync_drive_file_authorized',
                    value: true,
                })
            }
            return true
        } catch (e) {
            console.error('[SyncService] Native signIn error:', e)
            throw new Error(
                '原生 Google 登入失敗: ' + (e.message || JSON.stringify(e))
            )
        }
    }

    /**
     * Web 登入：使用 Google Identity Services SDK
     * @param {boolean} [requestSharing=false]
     */
    async _signInWeb(requestSharing = false) {
        // 批次 3：Google SDK 改按需載入（原 index.html eager <script>），
        // 登入時才注入 GSI client + gapi
        try {
            await ensureGoogleSdk()
        } catch (e) {
            throw new Error(
                'Google Identity Services SDK 尚未載入 (網路問題或 WebView 中不支援此方式)'
            )
        }
        return new Promise((resolve, reject) => {
            if (!window.google?.accounts?.oauth2) {
                reject(
                    new Error(
                        'Google Identity Services SDK 尚未載入 (WebView 中不支援此方式)'
                    )
                )
                return
            }

            const scopes = requestSharing ? SHARED_SCOPES : BASE_SCOPES

            const client = window.google.accounts.oauth2.initCodeClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: scopes.join(' '),
                ux_mode: 'popup',
                callback: async response => {
                    if (response.error) {
                        reject(new Error(response.error))
                        return
                    }
                    try {
                        await this.handleAuthCallback(response.code)
                        if (requestSharing) {
                            await this.dataService.saveSetting({
                                key: 'sync_drive_file_authorized',
                                value: true,
                            })
                        }
                        resolve(true)
                    } catch (err) {
                        reject(err)
                    }
                },
            })

            client.requestCode()
        })
    }

    /**
     * 用 authorization code 透過 Worker 換取 tokens
     * @param {string} code  Authorization code from Google
     */
    async handleAuthCallback(code) {
        const serverUrl = this.serverUrl.replace(/\/+$/, '')
        const res = await fetch(`${serverUrl}/api/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirect_uri: 'postmessage' }),
        })

        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(
                err.error || `Token exchange failed (${res.status})`
            )
        }

        const data = await res.json()
        this.accessToken = data.access_token
        this.refreshToken = data.refresh_token
        this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000

        // 取得使用者資訊
        await this.fetchUserInfo()

        // 儲存 tokens
        await this.saveTokens()
    }

    /**
     * 透過 Worker 刷新 access token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) throw new Error('No refresh token')

        try {
            const serverUrl = this.serverUrl.replace(/\/+$/, '')
            const res = await fetch(`${serverUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.refreshToken }),
            })

            if (!res.ok) {
                // Refresh token 可能已失效，清除登入狀態
                if (res.status === 400 || res.status === 401) {
                    await this.signOut()
                    throw new Error('Session expired, please sign in again')
                }
                throw new Error(`Token refresh failed (${res.status})`)
            }

            const data = await res.json()
            this.accessToken = data.access_token
            this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
            await this.saveTokens()
        } catch (err) {
            console.error('[SyncService] refreshAccessToken error:', err)
            throw err
        }
    }

    /**
     * 取得 Google 使用者資訊
     */
    async fetchUserInfo() {
        try {
            const res = await fetch(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                {
                    headers: { Authorization: `Bearer ${this.accessToken}` },
                }
            )
            if (res.ok) {
                this.userInfo = await res.json()
            }
        } catch (err) {
            console.warn('[SyncService] fetchUserInfo error:', err)
        }
    }

    /**
     * 登出 — 清除所有 token 和狀態
     */
    async signOut() {
        // 呼叫原生登出
        if (isNative) {
            try {
                const socialLoginPlugin = '@capgo/capacitor-social-login'
                const { SocialLogin } = await import(
                    /* @vite-ignore */ socialLoginPlugin
                )
                await SocialLogin.logout({ provider: 'google' })
            } catch (e) {
                // offline mode 不支援 logout — 靜默忽略
                console.warn(
                    '[SyncService] Native logout not supported in offline mode'
                )
            }
        }

        this.accessToken = null
        this.refreshToken = null
        this.tokenExpiresAt = null
        this.userInfo = null
        this.stopAutoSync()
        this.stopAutoBackup()

        await this.dataService.saveSetting({ key: 'sync_tokens', value: null })
        await this.dataService.saveSetting({
            key: 'sync_auto_enabled',
            value: false,
        })
        await this.dataService.saveSetting({
            key: 'sync_auto_backup_enabled',
            value: false,
        })
        await this.dataService.saveSetting({
            key: 'sync_drive_file_authorized',
            value: false,
        })
    }

    /**
     * 儲存 token 到 IndexedDB
     */
    async saveTokens() {
        await this.dataService.saveSetting({
            key: 'sync_tokens',
            value: {
                access_token: this.accessToken,
                refresh_token: this.refreshToken,
                expires_at: this.tokenExpiresAt,
                user_info: this.userInfo,
            },
        })
    }

    /**
     * 檢查是否已授權共享檔案權限
     * @returns {Promise<boolean>}
     */
    async isSharingAuthorized() {
        const setting = await this.dataService.getSetting(
            'sync_drive_file_authorized'
        )
        return !!setting?.value
    }

    /**
     * 確保已取得共享檔案權限，若無則引導使用者進行二次授權
     * @returns {Promise<boolean>}
     */
    async ensureSharingPermission() {
        await this.ensureValidToken()

        const authorized = await this.isSharingAuthorized()
        if (authorized) {
            return true
        }

        // 彈出確認提示，讓使用者知道為何要進行二次授權
        const confirm = await import('./utils.js').then(m => m.customConfirm)
        const proceeds = await confirm(
            '【共用功能授權提示】\n\n此操作需要額外的 Google Drive 讀寫權限（存取此應用程式建立的共享檔案）。\n\n我們將為您發起二次授權，請在隨後出現的 Google 登入視窗中，勾選並同意「查看及編輯使用此 App 建立的特定檔案」權限。'
        )
        if (!proceeds) {
            throw new Error('使用者取消了權限請求，無法執行此操作。')
        }

        // 發起帶有共享 scopes 的登入
        const success = await this.signIn(true)
        if (!success) {
            throw new Error('共享權限授權失敗')
        }
        return true
    }

    // ──────────────────────────────────────────────
    // Server URL Management
    // ──────────────────────────────────────────────

    /**
     * 取得同步伺服器 URL
     * @returns {string}
     */
    getServerUrl() {
        return this.serverUrl
    }

    /**
     * 設定同步伺服器 URL
     * @param {string} url
     */
    async setServerUrl(url) {
        this.serverUrl = url.replace(/\/+$/, '')
        await this.dataService.saveSetting({
            key: 'sync_server_url',
            value: this.serverUrl,
        })
    }

    // ──────────────────────────────────────────────
    // Google Drive — Backup
    // ──────────────────────────────────────────────

    /**
     * 備份資料到 Google Drive appDataFolder
     * @returns {Promise<object>} 備份檔案的 metadata
     */
    async backupToDrive() {
        await this.ensureValidToken()

        // 備份前先清理舊備份
        await this.cleanupOldBackups()

        const exportData = await this.dataService.exportDataForSync()
        exportData.backup_device = this.deviceId
        exportData.backup_timestamp = Date.now()

        const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        const fileContent = JSON.stringify(exportData)

        // 使用 multipart upload
        const metadata = {
            name: fileName,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
        }

        const boundary = '-------314159265358979323846'
        const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: application/json',
            '',
            fileContent,
            `--${boundary}--`,
        ].join('\r\n')

        const res = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body,
            }
        )

        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(
                err.error?.message || `Backup failed (${res.status})`
            )
        }

        // 記錄最後備份時間
        await this.dataService.saveSetting({
            key: 'sync_last_backup',
            value: { timestamp: Date.now(), fileName },
        })

        return await res.json()
    }

    /**
     * 列出所有備份檔案
     * @returns {Promise<Array>} 備份列表
     */
    async listBackups() {
        await this.ensureValidToken()

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'backup_'&fields=files(id,name,size,createdTime,modifiedTime)&orderBy=createdTime desc`,
            {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )

        if (!res.ok) throw new Error(`Failed to list backups (${res.status})`)
        const data = await res.json()
        return data.files || []
    }

    /**
     * 從 Google Drive 還原指定備份
     * @param {string} fileId  Drive file ID
     * @returns {Promise<object>} 備份資料
     */
    async restoreFromDrive(fileId) {
        await this.ensureValidToken()

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )

        if (!res.ok)
            throw new Error(`Failed to download backup (${res.status})`)
        return await res.json()
    }

    /**
     * 刪除指定備份
     * @param {string} fileId  Drive file ID
     */
    async deleteBackup(fileId) {
        await this.ensureValidToken()

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )

        if (!res.ok && res.status !== 404) {
            throw new Error(`Failed to delete backup (${res.status})`)
        }
    }

    // ──────────────────────────────────────────────
    // Google Drive — Multi-device Sync
    // ──────────────────────────────────────────────

    /**
     * 將本地 change log 推送到 Google Drive
     */
    async pushChanges() {
        await this.ensureValidToken()

        const lastPush = await this.dataService.getSetting(
            'sync_last_push_timestamp'
        )
        const since = lastPush?.value || 0
        const changes = await this.dataService.getChangesSince(since)

        // ============================================
        // 緊急補丁：修復因之前的過濾 bug 而遺失在 personal sync 中的 shared ledger 狀態
        const patchedFlag = await this.dataService.getSetting(
            'repair_shared_sync_done'
        )
        if (!patchedFlag || !patchedFlag.value) {
            const ledgers = await this.dataService.getLedgers()
            const sharedLedgers = ledgers.filter(l => l.isShared)

            if (sharedLedgers.length > 0) {
                for (const l of sharedLedgers) {
                    // 確保目前批次內沒有重複
                    const hasUpdate = changes.some(
                        c =>
                            c.storeName === 'ledgers' &&
                            c.recordId === l.id &&
                            c.operation === 'update'
                    )
                    if (!hasUpdate) {
                        changes.push({
                            deviceId: this.deviceId,
                            operation: 'update',
                            storeName: 'ledgers',
                            recordId: l.id,
                            timestamp: Date.now(),
                            data: l,
                        })
                    }
                }
            }
            await this.dataService.saveSetting({
                key: 'repair_shared_sync_done',
                value: true,
            })
        }
        // ============================================

        if (changes.length === 0) return null

        const syncData = {
            deviceId: this.deviceId,
            timestamp: Date.now(),
            changes,
        }

        const fileName = `sync_log_${this.deviceId}.json`

        // 先找到已存在的 sync log file
        const existingFileId = await this._findFile(fileName)

        if (existingFileId) {
            // 下載現有內容，合併後更新
            const res = await this._downloadFile(existingFileId)
            const existing = res?.data || { changes: [] }
            existing.changes = [...(existing.changes || []), ...changes]
            existing.timestamp = Date.now()
            existing.deviceId = this.deviceId

            await this._updateFile(existingFileId, JSON.stringify(existing))
        } else {
            // 建立新檔案
            await this._createFile(fileName, JSON.stringify(syncData))
        }

        // 記錄推送的最新時間
        const maxTimestamp = Math.max(...changes.map(c => c.timestamp))
        await this.dataService.saveSetting({
            key: 'sync_last_push_timestamp',
            value: maxTimestamp,
        })

        return maxTimestamp
    }

    /**
     * 從其他裝置的 sync log 拉取變更並合併。
     * 使用 appliedKeys 去重（而非時間戳水位），避免時鐘偏移造成静默遺失。
     */
    async pullChanges() {
        await this.ensureValidToken()

        const resList = await fetch(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )

        if (!resList.ok)
            throw new Error(`Failed to list sync logs (${resList.status})`)
        const data = await resList.json()
        const files = data.files || []

        const appliedSetting = await this.dataService.getSetting(
            'sync_personal_applied_keys'
        )
        const appliedKeys = new Set(appliedSetting?.value || [])
        const allRemoteChanges = []

        for (const file of files) {
            if (file.name === `sync_log_${this.deviceId}.json`) continue

            const resFile = await this._downloadFile(file.id)
            const syncLog = resFile?.data
            if (!syncLog?.changes) continue

            for (const change of syncLog.changes) {
                const key = this._changeKey(change)
                if (appliedKeys.has(key)) continue
                allRemoteChanges.push(change)
                appliedKeys.add(key)
            }
        }

        if (allRemoteChanges.length > 0) {
            allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp)
            await this.applyRemoteChanges(allRemoteChanges)
        }

        // 持久化已套用鍵（保留最近 30 天；離線逾 30 天重套用是冪等的）
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        await this.dataService.saveSetting({
            key: 'sync_personal_applied_keys',
            value: [...appliedKeys].filter(k => {
                const ts = parseInt(k.split('|')[1], 10)
                return !isNaN(ts) && ts > thirtyDaysAgo
            }),
        })

        await this.dataService.saveSetting({
            key: 'sync_last_sync',
            value: Date.now(),
        })
    }

    /**
     * 合併遠端變更到本地 IndexedDB
     * @param {Array} changes 變更列表
     */
    async applyRemoteChanges(changes) {
        if (!changes || changes.length === 0) return

        // 定義建立依賴的拓撲順序
        const topoOrder = [
            'custom_categories',
            'category_order',
            'hidden_categories',
            'ledgers',
            'groupMeta',
            'group_meta',
            'accounts',
            'contacts',
            'records',
            'debts',
            'recurring_transactions',
        ]

        // 嚴格排序邏輯：
        // 1. 主要依據 timestamp (由舊到新)
        // 2. 若 timestamp 相同，則依據操作類型 (add > update > delete)
        // 3. 若操作類型也相同，則依據 topoOrder
        const sortedChanges = [...changes].sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp
            }

            const opWeight = { add: 0, update: 1, delete: 2 }
            if (a.operation !== b.operation) {
                return opWeight[a.operation] - opWeight[b.operation]
            }

            const orderA = topoOrder.indexOf(a.storeName)
            const orderB = topoOrder.indexOf(b.storeName)
            return orderA - orderB
        })

        for (const change of sortedChanges) {
            try {
                const { operation, storeName, recordId, data } = change
                console.log(
                    `[SyncService] applyRemoteChange: ${operation} ${storeName}`,
                    data?.uuid || data?.name || recordId
                )

                // 預檢測：如果是 add 且 UUID 已存在，自動轉向 update，避免 Unique Constraint 失敗導致同步中斷
                if (operation === 'add' && data.uuid) {
                    const existing = await this.dataService.getByUUID(
                        storeName,
                        data.uuid
                    )
                    if (existing) {
                        await this._applyUpdateWithId(
                            storeName,
                            existing.id,
                            data
                        )
                        continue
                    }
                }

                switch (operation) {
                    case 'add':
                        await this._applyAdd(storeName, data)
                        break
                    case 'update':
                        await this._applyUpdate(storeName, recordId, data)
                        break
                    case 'delete':
                        await this._applyDelete(storeName, recordId, data)
                        break
                    default:
                        console.warn(
                            '[SyncService] Unknown operation:',
                            operation
                        )
                }
            } catch (err) {
                console.error(
                    '[SyncService] Error applying change:',
                    err,
                    change
                )
            }
        }
    }

    /**
     * 將所有遠端變更標記為已套用（用於 Restore 後避免重複套用舊變更）
     */
    async markAllRemoteChangesAsPulled() {
        await this.ensureValidToken()
        try {
            const resList = await fetch(
                `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
            )
            if (!resList.ok) throw new Error('Failed to list sync logs')
            const data = await resList.json()
            const files = data.files || []

            const appliedSetting = await this.dataService.getSetting(
                'sync_personal_applied_keys'
            )
            const appliedKeys = new Set(appliedSetting?.value || [])

            for (const file of files) {
                if (file.name === `sync_log_${this.deviceId}.json`) continue
                try {
                    const resFile = await this._downloadFile(file.id)
                    for (const c of resFile?.data?.changes || []) {
                        appliedKeys.add(this._changeKey(c))
                    }
                } catch (_) {}
            }

            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
            await this.dataService.saveSetting({
                key: 'sync_personal_applied_keys',
                value: [...appliedKeys].filter(k => {
                    const ts = parseInt(k.split('|')[1], 10)
                    return !isNaN(ts) && ts > thirtyDaysAgo
                }),
            })
            console.log('[SyncService] Marked all remote changes as pulled.')
        } catch (err) {
            console.error(
                '[SyncService] markAllRemoteChangesAsPulled error:',
                err
            )
        }
    }

    /**
     * 將共用帳本的本地變更推送到「自己的」per-device 日誌檔（零競爭）
     * @returns {Promise<number|null>} 成功推送的最大時間戳；無推送時為 null
     */
    async pushSharedLedgerChanges() {
        await this.ensureValidToken()

        if (!(await this.isSharingAuthorized())) {
            console.warn('[SyncService] pushShared: 未授權共用權限，略過')
            return null
        }

        const ledgers = await this.dataService.getLedgers()
        const sharedLedgers = ledgers.filter(l => l.isShared && l.sharedFileId)
        let maxPushed = null
        let allSucceeded = true

        for (const ledger of sharedLedgers) {
            try {
                const infra = await this._ensureSharedInfra(ledger)
                const allLocal = await this.dataService.getChangesSince(0, {
                    sharedLedgerUuid: infra.ledger.uuid,
                })
                if (allLocal.length === 0) continue

                const mine = allLocal.map(log => ({
                    ...log,
                    deviceId: this.deviceId,
                }))
                const appended = await this._appendToDeviceLog(
                    infra.devLogId,
                    mine
                )
                if (appended > 0) {
                    console.log(
                        `[SyncService] pushShared: "${infra.ledger.name}" 推送 ${appended} 筆變更`
                    )
                    const ts = Math.max(...mine.map(c => c.timestamp))
                    maxPushed = maxPushed === null ? ts : Math.max(maxPushed, ts)
                }
            } catch (e) {
                allSucceeded = false
                console.error(
                    `[SyncService] pushSharedLedgerChanges failed for "${ledger.name}":`,
                    e
                )
            }
        }
        // 任一帳本失敗即回傳 null，讓 performSync 跳過本地日誌清理，
        // 避免誤刪未成功上傳的變更（下次同步會自動重試）
        return allSucceeded ? maxPushed : null
    }

    /**
     * 從 manifest 列出的各成員日誌檔拉取遠端變更（appliedKeys 去重 + modifiedTime 快取）
     */
    async pullSharedLedgerChanges() {
        await this.ensureValidToken()

        if (!(await this.isSharingAuthorized())) {
            console.warn('[SyncService] pullShared: 未授權共用權限，略過')
            return
        }

        const ledgers = await this.dataService.getLedgers()
        const sharedLedgers = ledgers.filter(l => l.isShared && l.sharedFileId)

        const appliedSetting = await this.dataService.getSetting(
            'sync_shared_applied_keys'
        )
        const appliedKeys = new Set(appliedSetting?.value || [])
        const allRemoteChanges = []

        for (const ledger of sharedLedgers) {
            try {
                const infra = await this._ensureSharedInfra(ledger)
                const manifest = (await this._downloadFile(infra.manifestId))
                    ?.data
                if (!manifest?.members) continue

                const checkedKey = `sync_shared_member_checked_${infra.ledger.uuid}`
                const checkedMap =
                    (await this.dataService.getSetting(checkedKey))?.value || {}

                for (const member of manifest.members) {
                    if (member.deviceId === this.deviceId) continue
                    if (!member.fileId) continue

                    let modifiedMs = 0
                    try {
                        modifiedMs = await this._getFileModifiedTime(
                            member.fileId
                        )
                    } catch (_) {
                        continue // 檔案不存在（成員刪除帳號等），保守跳過
                    }
                    if ((checkedMap[member.fileId] || 0) >= modifiedMs) {
                        continue // 自上次檢查後沒有修改
                    }

                    const data = (
                        await this._downloadFile(member.fileId)
                    )?.data
                    for (const change of data?.changes || []) {
                        if (change.deviceId === this.deviceId) continue
                        const key = this._changeKey(change)
                        if (appliedKeys.has(key)) continue
                        allRemoteChanges.push(change)
                        appliedKeys.add(key)
                    }
                    checkedMap[member.fileId] = modifiedMs
                }
                await this.dataService.saveSetting({
                    key: checkedKey,
                    value: checkedMap,
                })
            } catch (e) {
                console.warn(
                    `[SyncService] pullShared failed for "${ledger.name}":`,
                    e
                )
            }
        }

        if (allRemoteChanges.length > 0) {
            console.log(
                `[SyncService] pullShared: 套用 ${allRemoteChanges.length} 筆遠端變更`
            )
            allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp)
            await this.applyRemoteChanges(allRemoteChanges)
        }

        // 持久化已套用鍵集合（保留最近 30 天，避免無限增長；
        // 離線逾 30 天可能重套用，但 UUID upsert 使其冪等）
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        const trimmedKeys = [...appliedKeys].filter(key => {
            const ts = parseInt(key.split('|')[1], 10)
            return !isNaN(ts) && ts > thirtyDaysAgo
        })
        await this.dataService.saveSetting({
            key: 'sync_shared_applied_keys',
            value: trimmedKeys,
        })
    }

    /**
     * 執行完整同步（push + pull + shared）
     * @param {boolean} isManual 是否為手動觸發（忽略個人同步的關閉設定）
     */
    async performSync(isManual = false) {
        if (this._syncing) return
        this._syncing = true

        try {
            const autoSyncSetting = await this.dataService.getSetting(
                'sync_auto_enabled'
            )
            const isPersonalEnabled = isManual || !!autoSyncSetting?.value

            console.log('[SyncService] performSync start', {
                isManual,
                isPersonalEnabled,
            })

            let personalMaxTs = null
            let sharedMaxTs = null
            if (isPersonalEnabled) personalMaxTs = await this.pushChanges()
            sharedMaxTs = await this.pushSharedLedgerChanges()

            if (isPersonalEnabled) await this.pullChanges()
            await this.pullSharedLedgerChanges()

            // 兩條推送都完成後，清理已上雲的本地變更日誌
            // （任一推送拋錯會中斷到 catch/finally，不會走到這裡）
            const cutoffs = [personalMaxTs, sharedMaxTs].filter(
                ts => typeof ts === 'number'
            )
            if (cutoffs.length > 0) {
                await this.dataService.clearSyncLog(Math.min(...cutoffs))
            }

            console.log('[SyncService] performSync complete')
        } finally {
            this._syncing = false
        }
    }

    /**
     * 確保共用帳本的自動同步已啟動（在加入/建立共用帳本後呼叫）
     */
    async ensureSharedSync() {
        if (!this.isSignedIn()) return
        this.startAutoSync()
    }

    // ────────────────────────────────────────────────
    // Backup Retention Policy
    // ────────────────────────────────────────────────

    /**
     * 清理舊備份：
     * - 近 7 天的備份全部保留
     * - 7 天以前、一年以內：每月僅保留第一筆
     * - 一年以前的全部刪除
     */
    async cleanupOldBackups() {
        try {
            const backups = await this.listBackups()
            if (backups.length === 0) return

            const now = Date.now()
            const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
            const ONE_YEAR = 365 * 24 * 60 * 60 * 1000

            // 分類備份
            const toKeep = []
            const toDelete = []
            const monthlyBuckets = {} // key: 'YYYY-MM', value: 該月最早的備份

            for (const backup of backups) {
                const createdAt = new Date(backup.createdTime).getTime()
                const age = now - createdAt

                if (age <= SEVEN_DAYS) {
                    // 近 7 天 → 全部保留
                    toKeep.push(backup)
                } else if (age <= ONE_YEAR) {
                    // 7天~1年 → 每月保留第一筆（最早的）
                    const monthKey = new Date(backup.createdTime)
                        .toISOString()
                        .slice(0, 7) // 'YYYY-MM'
                    if (!monthlyBuckets[monthKey]) {
                        monthlyBuckets[monthKey] = { backup, createdAt }
                    } else if (createdAt < monthlyBuckets[monthKey].createdAt) {
                        // 這筆更早，替換為保留的，把舊的加到刪除列表
                        toDelete.push(monthlyBuckets[monthKey].backup)
                        monthlyBuckets[monthKey] = { backup, createdAt }
                    } else {
                        // 這筆更晚，刪除
                        toDelete.push(backup)
                    }
                } else {
                    // 超過 1 年 → 刪除
                    toDelete.push(backup)
                }
            }

            // 執行刪除
            for (const backup of toDelete) {
                try {
                    await this.deleteBackup(backup.id)
                    console.log(
                        `[SyncService] Deleted old backup: ${backup.name}`
                    )
                } catch (err) {
                    console.warn(
                        `[SyncService] Failed to delete backup ${backup.name}:`,
                        err
                    )
                }
            }

            if (toDelete.length > 0) {
                console.log(
                    `[SyncService] Cleanup: deleted ${toDelete.length} old backups, kept ${toKeep.length + Object.keys(monthlyBuckets).length}`
                )
            }
        } catch (err) {
            console.error('[SyncService] cleanupOldBackups error:', err)
            // 清理失敗不應阻擋備份
        }
    }

    /**
     * 啟動自動同步（僅在開啟時和回到前景時觸發，避免持續消耗流量）
     */
    startAutoSync() {
        this.stopAutoSync()

        // 啟動後立即同步一次
        this.performSync(false).catch(err =>
            console.error('[SyncService] Auto sync error:', err)
        )

        // 頁面回到前景時觸發同步（例如切換 APP、鎖螢幕後回來）
        this._visibilityHandler = () => {
            if (document.visibilityState === 'visible' && this.isSignedIn()) {
                this.performSync(false).catch(err =>
                    console.error('[SyncService] Visibility sync error:', err)
                )
            }
        }
        document.addEventListener('visibilitychange', this._visibilityHandler)
    }

    /**
     * 停止自動同步
     */
    stopAutoSync() {
        if (this._autoSyncIntervalId) {
            clearInterval(this._autoSyncIntervalId)
            this._autoSyncIntervalId = null
        }
        if (this._visibilityHandler) {
            document.removeEventListener(
                'visibilitychange',
                this._visibilityHandler
            )
            this._visibilityHandler = null
        }
    }

    // ────────────────────────────────────────────────
    // Auto Backup
    // ────────────────────────────────────────────────

    /**
     * 啟動自動備份
     * @param {'daily'|'3days'|'weekly'} interval 備份間隔
     */
    startAutoBackup(interval = 'daily') {
        this.stopAutoBackup()

        const intervalMap = {
            daily: 24 * 60 * 60 * 1000,
            '3days': 3 * 24 * 60 * 60 * 1000,
            weekly: 7 * 24 * 60 * 60 * 1000,
        }
        const ms = intervalMap[interval] || intervalMap.daily

        // 檢查是否需要立即備份（上次備份已過期）
        this._checkAndRunBackup(ms)

        this._autoBackupIntervalId = setInterval(
            () => {
                this._checkAndRunBackup(ms)
            },
            60 * 60 * 1000
        ) // 每小時檢查一次是否到期
    }

    /**
     * 檢查是否需要執行自動備份
     * @param {number} intervalMs 備份間隔毫秒
     */
    async _checkAndRunBackup(intervalMs) {
        try {
            if (!this.isSignedIn()) return

            const lastBackup =
                await this.dataService.getSetting('sync_last_backup')
            const lastTime = lastBackup?.value?.timestamp || 0
            const elapsed = Date.now() - lastTime

            if (elapsed >= intervalMs) {
                console.log('[SyncService] Auto backup triggered')
                await this.backupToDrive()
                console.log('[SyncService] Auto backup completed')
            }
        } catch (err) {
            console.error('[SyncService] Auto backup error:', err)
        }
    }

    /**
     * 停止自動備份
     */
    stopAutoBackup() {
        if (this._autoBackupIntervalId) {
            clearInterval(this._autoBackupIntervalId)
            this._autoBackupIntervalId = null
        }
    }

    // ──────────────────────────────────────────────
    // Device ID
    // ──────────────────────────────────────────────

    /**
     * 取得或生成裝置唯一 ID
     * @returns {string}
     */
    getDeviceId() {
        let id = localStorage.getItem('sync_device_id')
        if (!id) {
            id =
                'dev_' +
                Date.now().toString(36) +
                '_' +
                Math.random().toString(36).substr(2, 8)
            localStorage.setItem('sync_device_id', id)
        }
        return id
    }

    // ──────────────────────────────────────────────
    // Google Drive Helpers
    // ──────────────────────────────────────────────

    /**
     * 變更日誌的唯一鍵（去重用），格式：deviceId|timestamp|operation|storeName
     * @param {object} change
     * @returns {string}
     */
    _changeKey(change) {
        return `${change.deviceId || 'unknown'}|${change.timestamp}|${change.operation}|${change.storeName}`
    }

    /**
     * 共用帳本 manifest 檔名（uuid 前 8 碼足夠唯一且可讀）
     * @param {string} ledgerUuid
     * @returns {string}
     */
    _manifestFileName(ledgerUuid) {
        return `EasyAccounting_SharedManifest_${String(ledgerUuid).slice(0, 8)}.json`
    }

    /**
     * 自己裝置的共用日誌檔名
     * @param {string} ledgerUuid
     * @returns {string}
     */
    _deviceLogFileName(ledgerUuid) {
        return `EasyAccounting_SharedLog_${String(ledgerUuid).slice(0, 8)}_${this.deviceId}.json`
    }

    /**
     * 在自己的 Drive 根目錄（非 appDataFolder）搜尋指定名稱檔案
     * @param {string} fileName
     * @returns {Promise<string|null>} file ID or null
     */
    async _findFileInDrive(fileName) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${fileName}' and trashed=false`)}&fields=files(id)`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )
        if (!res.ok) {
            // 401/403 屬於授權問題，重試也不會好轉，直接拋出避免誤判為「檔案不存在」
            if (res.status === 401 || res.status === 403) {
                throw new Error(`Drive search failed (${res.status})`)
            }
            console.warn(`[SyncService] _findFileInDrive non-fatal error (${res.status}), treating as not found`)
            return null
        }
        const data = await res.json()
        return data.files?.[0]?.id || null
    }

    /**
     * 取得檔案的 modifiedTime（epoch ms）；檔案不存在或無權限時 throw
     * @param {string} fileId
     * @returns {Promise<number>}
     */
    async _getFileModifiedTime(fileId) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )
        if (!res.ok) throw new Error(`Failed to get file meta (${res.status})`)
        const data = await res.json()
        return new Date(data.modifiedTime).getTime()
    }

    /**
     * 將變更附加到「自己的」裝置日誌檔。
     * 依 _changeKey 去重（雲端既有內容與傳入批次內部皆會去重）；
     * 超過 90 天的變更會被裁剪（完整歷史由每日備份保留）。
     * @param {string} devLogId
     * @param {Array<object>} incomingChanges
     * @returns {Promise<number>} 實際寫入的新增筆數（不含被裁剪者）
     */
    async _appendToDeviceLog(devLogId, incomingChanges) {
        if (!devLogId || !incomingChanges.length) return 0
        // 嚴格下載：任何失敗都拋出，避免把雲端既有內容誤判為空而整份覆寫
        const cloud = await this._downloadFileStrict(devLogId)
        if (!Array.isArray(cloud.changes)) cloud.changes = []
        const existing = Array.isArray(cloud.changes) ? cloud.changes : []
        const cloudKeys = new Set(existing.map(c => this._changeKey(c)))
        const seenIncoming = new Set()
        const missing = incomingChanges.filter(c => {
            const key = this._changeKey(c)
            if (cloudKeys.has(key) || seenIncoming.has(key)) return false
            seenIncoming.add(key)
            return true
        })
        if (missing.length === 0) return 0

        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
        const survivingExisting = existing.filter(
            c => (c.timestamp || 0) >= cutoff
        )
        const persistedNew = missing.filter(c => (c.timestamp || 0) >= cutoff)
        cloud.changes = [...survivingExisting, ...persistedNew]
        cloud.deviceId = this.deviceId
        cloud.timestamp = Date.now()
        await this._updateFile(devLogId, JSON.stringify(cloud))
        return persistedNew.length
    }

    /**
     * 把自己（deviceId + 日誌檔 ID）註冊進 manifest；競爭時重新下載合併重試
     * @param {string} manifestId
     * @param {string} devLogId
     * @param {number} [maxRetries=3]
     * @returns {Promise<boolean>}
     */
    async _registerSelfInManifest(manifestId, devLogId, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 嚴格下載：任何失敗都拋出進入重試，絕不把雲端成員清單誤判為空而整份覆寫
                const current = await this._downloadFileStrict(manifestId)
                if (!Array.isArray(current.members)) {
                    throw new Error('manifest 格式錯誤')
                }
                const me = current.members.find(
                    m => m.deviceId === this.deviceId
                )
                if (me) {
                    if (me.fileId !== devLogId) {
                        me.fileId = devLogId
                        current.timestamp = Date.now()
                        await this._updateFile(
                            manifestId,
                            JSON.stringify(current)
                        )
                    }
                } else {
                    current.members.push({
                        deviceId: this.deviceId,
                        ownerEmail: this.userInfo?.email || '',
                        fileId: devLogId,
                    })
                    current.timestamp = Date.now()
                    await this._updateFile(manifestId, JSON.stringify(current))
                }
                return true
            } catch (e) {
                console.warn(
                    `[SyncService] registerSelfInManifest 重試 ${attempt + 1}/${maxRetries}:`,
                    e.message
                )
            }
        }
        console.error('[SyncService] registerSelfInManifest 重試次數用盡')
        return false
    }

    /**
     * 從 manifest 移除某個成員（取消共用單一成員用）
     * @param {string} manifestId
     * @param {string} deviceId
     * @param {number} [maxRetries=3]
     * @returns {Promise<boolean>}
     */
    async _removeManifestMember(manifestId, deviceId, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 嚴格下載：任何失敗都拋出進入重試，與 _registerSelfInManifest 一致
                const current = await this._downloadFileStrict(manifestId)
                if (!current?.members) return false
                current.members = current.members.filter(
                    m => m.deviceId !== deviceId
                )
                current.timestamp = Date.now()
                await this._updateFile(manifestId, JSON.stringify(current))
                return true
            } catch (e) {
                console.warn(
                    `[SyncService] removeManifestMember 重試 ${attempt + 1}/${maxRetries}:`,
                    e.message
                )
            }
        }
        return false
    }

    /**
     * 把自己的日誌檔授權（writer）給 manifest 中所有其他成員。
     * 以 settings 記錄已授權 email，之後新成員加入時只補授權差額（節省 API 配額）
     * @param {string} ledgerUuid
     * @param {string} manifestId
     * @param {string} devLogId
     */
    async _grantDevLogPermissions(ledgerUuid, manifestId, devLogId) {
        try {
            const grantedKey = `sync_shared_granted_${ledgerUuid}`
            const grantedSetting =
                await this.dataService.getSetting(grantedKey)
            const granted = new Set(grantedSetting?.value || [])
            const m = (await this._downloadFile(manifestId))?.data
            const myEmail = this.userInfo?.email || ''
            const pending = (m?.members || []).filter(
                member =>
                    member.ownerEmail &&
                    member.ownerEmail !== myEmail &&
                    !granted.has(member.ownerEmail)
            )
            if (pending.length === 0) return
            for (const member of pending) {
                try {
                    await this.grantFilePermission(devLogId, member.ownerEmail)
                    granted.add(member.ownerEmail)
                } catch (_) {
                    // 已授權過或暫時性錯誤，靜默忽略（下次同步會再試）
                }
            }
            await this.dataService.saveSetting({
                key: grantedKey,
                value: [...granted],
            })
        } catch (e) {
            console.warn('[SyncService] grantDevLogPermissions failed:', e)
        }
    }

    /**
     * 確保共用帳本的 per-device 基礎設施就緒：
     * 1. 從舊式共用檔解析 manifest 指標與歷史變更
     * 2. 建立/定位 manifest（多台競爭時以寫回舊檔的指標為準，輸家刪除孤兒檔）
     * 3. 建立/定位自己的裝置日誌檔並授權給成員
     * 4. （首次）將舊檔歷史併入自己的日誌並種入 appliedKeys
     * @param {object} ledger 本地帳本記錄（isShared 且有 sharedFileId）
     * @returns {Promise<{ledger: object, devLogId: string, manifestId: string}>}
     */
    async _ensureSharedInfra(ledger) {
        const migratedKey = `shared_migrated_${ledger.uuid}`
        const migrated = await this.dataService.getSetting(migratedKey)
        let manifestId = ledger.sharedManifestId || null
        let legacyChanges = []

        // 1) 讀取舊式共用檔
        if (ledger.sharedFileId) {
            try {
                const res = await this._downloadFile(ledger.sharedFileId)
                const oldData = res?.data || {}
                if (!manifestId && oldData.manifestFileId) {
                    manifestId = oldData.manifestFileId
                }
                if (!migrated?.value && Array.isArray(oldData.changes)) {
                    legacyChanges = oldData.changes
                }
            } catch (_) {
                // 舊檔讀不到不阻擋流程
            }
        }

        // 2) 解析或建立 manifest
        if (!manifestId) {
            const name = this._manifestFileName(ledger.uuid)
            manifestId = await this._findFileInDrive(name)
            if (!manifestId) {
                const created = await this._createSharedFile(
                    name,
                    JSON.stringify({
                        ledgerUuid: ledger.uuid,
                        members: [
                            {
                                deviceId: this.deviceId,
                                ownerEmail: this.userInfo?.email || '',
                                fileId: null,
                            },
                        ],
                    })
                )
                manifestId = created.id
            }
            // 把指標寫回舊檔協調其他裝置（多台同時建立時，最後寫入者為準）
            if (ledger.sharedFileId) {
                try {
                    const res = await this._downloadFile(ledger.sharedFileId)
                    const oldData = res?.data || {}
                    if (!oldData.manifestFileId) {
                        oldData.manifestFileId = manifestId
                        oldData.timestamp = Date.now()
                        await this._updateFile(
                            ledger.sharedFileId,
                            JSON.stringify(oldData)
                        )
                    } else if (oldData.manifestFileId !== manifestId) {
                        // 他機先註冊 → 採用贏家，刪除自己的孤兒 manifest
                        try {
                            await this.deleteFile(manifestId)
                        } catch (_) {}
                        manifestId = oldData.manifestFileId
                    }
                } catch (_) {}
            }
        }

        // 3) 確保自己的裝置日誌檔
        const devLogKey = `sync_shared_devlog_${ledger.uuid}`
        let devLogId =
            (await this.dataService.getSetting(devLogKey))?.value || null
        if (!devLogId) {
            const name = this._deviceLogFileName(ledger.uuid)
            devLogId = await this._findFileInDrive(name)
            if (!devLogId) {
                const created = await this._createSharedFile(
                    name,
                    JSON.stringify({
                        ledgerUuid: ledger.uuid,
                        deviceId: this.deviceId,
                        changes: [],
                    })
                )
                devLogId = created.id
            }
            await this.dataService.saveSetting({
                key: devLogKey,
                value: devLogId,
            })
            await this._grantDevLogPermissions(
                ledger.uuid,
                manifestId,
                devLogId
            )
        }

        // 4) 遷移：舊檔歷史併入自己的日誌 + 種入 appliedKeys
        if (legacyChanges.length > 0) {
            const mine = legacyChanges.map(c => ({
                ...c,
                deviceId: this.deviceId,
            }))
            await this._appendToDeviceLog(devLogId, mine)
            const appliedSetting = await this.dataService.getSetting(
                'sync_shared_applied_keys'
            )
            const appliedKeys = new Set(appliedSetting?.value || [])
            legacyChanges.forEach(c => appliedKeys.add(this._changeKey(c)))
            await this.dataService.saveSetting({
                key: 'sync_shared_applied_keys',
                value: [...appliedKeys],
            })
        }

        // 5) 更新帳本記錄與遷移旗標
        if (manifestId && manifestId !== ledger.sharedManifestId) {
            await this.dataService.updateLedger(
                ledger.id,
                { sharedManifestId: manifestId },
                true
            )
            ledger.sharedManifestId = manifestId
        }
        if (!migrated?.value) {
            await this.dataService.saveSetting({
                key: migratedKey,
                value: true,
            })
        }

        return { ledger, devLogId, manifestId }
    }

    /**
     * 以 manifest 檔加入共用帳本：
     * 套用所有成員日誌的變更 → 建立自己的日誌檔並授權 → 註冊進 manifest → 種入 appliedKeys
     * @param {string} manifestId
     * @returns {Promise<string>} 共用帳本的 uuid
     */
    async joinViaManifest(manifestId) {
        await this.ensureValidToken()
        const manifest = (await this._downloadFile(manifestId))?.data
        if (!manifest?.members) throw new Error('無效的共用帳本清單檔')

        // 1. 收集所有成員日誌的變更（key 去重）
        const seen = new Set()
        const allChanges = []
        const collect = changes => {
            for (const c of changes || []) {
                const key = this._changeKey(c)
                if (!seen.has(key)) {
                    seen.add(key)
                    allChanges.push(c)
                }
            }
        }
        for (const member of manifest.members) {
            if (!member.fileId) continue
            try {
                const d = (await this._downloadFile(member.fileId))?.data
                collect(d?.changes)
            } catch (_) {
                // 某成員檔抓不到不阻擋加入
            }
        }
        if (manifest.legacySharedFileId) {
            try {
                const d = (
                    await this._downloadFile(manifest.legacySharedFileId)
                )?.data
                collect(d?.changes)
            } catch (_) {}
        }
        allChanges.sort((a, b) => a.timestamp - b.timestamp)
        await this.applyRemoteChanges(allChanges)

        const ledgerChange = allChanges.find(
            c => c.storeName === 'ledgers' && c.data?.uuid
        )
        if (!ledgerChange) throw new Error('無法從共用資料解析帳本')
        const ledgerUuid = ledgerChange.data.uuid

        // 2. 建立自己的裝置日誌檔、授權、註冊進 manifest
        const name = this._deviceLogFileName(ledgerUuid)
        let devLogId = await this._findFileInDrive(name)
        if (!devLogId) {
            const created = await this._createSharedFile(
                name,
                JSON.stringify({
                    ledgerUuid,
                    deviceId: this.deviceId,
                    changes: [],
                })
            )
            devLogId = created.id
        }
        await this.dataService.saveSetting({
            key: `sync_shared_devlog_${ledgerUuid}`,
            value: devLogId,
        })
        await this._grantDevLogPermissions(ledgerUuid, manifestId, devLogId)
        await this._registerSelfInManifest(manifestId, devLogId)

        // 3. 種入 appliedKeys，之後 pull 不會重複套用這些變更
        await this.dataService.saveSetting({
            key: 'sync_shared_applied_keys',
            value: [...seen],
        })

        return ledgerUuid
    }

    /**
     * 在 appDataFolder 中搜尋指定名稱的檔案
     * @param {string} fileName
     * @returns {Promise<string|null>} file ID or null
     */
    async _findFile(fileName) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${fileName}'&fields=files(id)`,
            {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )
        if (!res.ok) return null
        const data = await res.json()
        return data.files?.[0]?.id || null
    }

    /**
     * 刪除 Google Drive 上的檔案
     * @param {string} fileId
     */
    async deleteFile(fileId) {
        await this.ensureSharingPermission()
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )
        if (!res.ok && res.status !== 404) {
            throw new Error(`刪除檔案失敗 (${res.status})`)
        }
    }

    /**
     * 下載檔案內容
     * @param {string} fileId
     * @returns {Promise<{data: object, etag: string}|null>}
     */
    async _downloadFile(fileId) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )
        if (!res.ok) return null
        const data = await res.json()
        return { data }
    }

    /**
     * 下載檔案內容；任何非 OK 狀態都拋出（與 _downloadFile 的寬鬆版不同，
     * 用於「絕不能把雲端內容誤判為空」的讀寫路徑）
     * @param {string} fileId
     * @returns {Promise<object>} 解析後的 JSON 內容
     */
    async _downloadFileStrict(fileId) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )
        if (!res.ok) throw new Error(`Failed to download file (${res.status})`)
        return await res.json()
    }

    /**
     * 建立新檔案到 appDataFolder
     * @param {string} fileName
     * @param {string} content
     * @returns {Promise<object>}
     */
    async _createFile(fileName, content) {
        const metadata = {
            name: fileName,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
        }

        const boundary = '-------314159265358979323846'
        const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: application/json',
            '',
            content,
            `--${boundary}--`,
        ].join('\r\n')

        const res = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body,
            }
        )

        if (!res.ok) throw new Error(`Failed to create file (${res.status})`)
        return await res.json()
    }

    /**
     * 建立共用檔案到外部 (Drive Root)
     * @param {string} fileName
     * @param {string} content
     * @returns {Promise<object>}
     */
    async _createSharedFile(fileName, content) {
        await this.ensureSharingPermission()
        const metadata = {
            name: fileName,
            // 不指定 parents，預設放在使用者的根目錄
            mimeType: 'application/json',
        }

        const boundary = '-------314159265358979323846'
        const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: application/json',
            '',
            content,
            `--${boundary}--`,
        ].join('\r\n')

        const res = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body,
            }
        )

        if (!res.ok)
            throw new Error(`Failed to create shared file (${res.status})`)
        return await res.json()
    }

    /**
     * 將指定檔案授權給其他 Email (Writer)
     * @param {string} fileId
     * @param {string} emailAddress
     */
    async grantFilePermission(fileId, emailAddress) {
        await this.ensureSharingPermission()

        const body = {
            role: 'writer',
            type: 'user',
            emailAddress: emailAddress,
        }

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }
        )

        if (!res.ok) {
            let errStr = ''
            try {
                const errJson = await res.json()
                errStr = errJson.error?.message || ''
            } catch (e) {
                console.warn('Failed to parse error response', e)
            }
            throw new Error(
                `Failed to grant permission (${res.status}): ${errStr}`
            )
        }
        return await res.json()
    }

    /**
     * 拿取檔案目前的權限清單
     * @param {string} fileId
     * @returns {Promise<Array>}
     */
    async getFilePermissions(fileId) {
        await this.ensureSharingPermission()
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,type,emailAddress,role,displayName)`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )
        if (!res.ok) throw new Error('Failed to get permissions')
        const data = await res.json()
        return data.permissions
    }

    /**
     * 移除檔案分享權限
     * @param {string} fileId
     * @param {string} permissionId
     */
    async removeFilePermission(fileId, permissionId) {
        await this.ensureSharingPermission()
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permissionId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.accessToken}` },
            }
        )
        if (!res.ok) throw new Error('Failed to remove permission')
    }

    /**
     * 更新既有檔案內容
     * @param {string} fileId
     * @param {string} content
     * @param {string|null} matchTag - 用於樂觀鎖的 ETag
     */
    async _updateFile(fileId, content) {
        const res = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: content,
            }
        )
        if (!res.ok) {
            let errMsg = `Failed to update file (${res.status})`
            try {
                const j = await res.json()
                errMsg += ': ' + (j.error?.message || '')
            } catch (_) {
                console.warn('Failed to parse error', _)
            }
            console.error('[SyncService] _updateFile error:', errMsg)
            throw new Error(errMsg)
        }
    }

    // ──────────────────────────────────────────────
    // Apply Remote Changes — UUID Resolve Helpers
    // ──────────────────────────────────────────────

    /**
     * 將遠端 debt 的 contactUuid 解析為本地 contactId。
     * @param {object} data
     * @returns {object} 已修正 contactId 的 data
     */
    async _resolveDebtContactId(data) {
        if (!data.contactUuid) return data
        try {
            const contacts = await this.dataService.getContacts()
            const matched = contacts.find(c => c.uuid === data.contactUuid)
            return { ...data, contactId: matched ? matched.id : null }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 debt 的 recordUuid 解析為本地 recordId。
     * @param {object} data
     * @returns {object} 已修正 recordId 的 data
     */
    async _resolveDebtRecordId(data) {
        if (!data.recordUuid) return data
        try {
            const rec = await this.dataService.getByUUID(
                'records',
                data.recordUuid
            )
            return { ...data, recordId: rec ? rec.id : null }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 debt 的 payments 陣列內的 recordUuid 解析為本地 recordId。
     * @param {object} data
     * @returns {object} 已修正 payments 內 recordId 的 data
     */
    async _resolveDebtPayments(data) {
        if (!data.payments || !Array.isArray(data.payments)) return data
        try {
            const newPayments = []
            for (const p of data.payments) {
                if (p.recordUuid) {
                    const rec = await this.dataService.getByUUID(
                        'records',
                        p.recordUuid
                    )
                    newPayments.push({ ...p, recordId: rec ? rec.id : null })
                } else {
                    newPayments.push(p)
                }
            }
            return { ...data, payments: newPayments }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 record 的 ledgerUuid 解析為本地 ledgerId。
     * @param {object} data
     * @returns {object} 已修正 ledgerId 的 data
     */
    async _resolveLedgerId(data) {
        if (!data.ledgerUuid) return data
        try {
            const ledgers = await this.dataService.getLedgers()
            let matched = ledgers.find(l => l.uuid === data.ledgerUuid)

            // If no exact UUID match, but the data indicates it belongs to the default ledger
            if (
                !matched &&
                (data.ledgerId === 1 || data.ledgerName === '預設帳本')
            ) {
                matched = ledgers.find(l => l.id === 1)
            }

            console.log(
                `[SyncService] _resolveLedgerId: uuid=${data.ledgerUuid}, matched=${matched?.id} (${matched?.name}), activeLedgerId=${this.dataService.activeLedgerId}`
            )
            return {
                ...data,
                ledgerId: matched
                    ? matched.id
                    : this.dataService.activeLedgerId,
            }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 record 的 accountUuid 解析為本地 accountId。
     * @param {object} data
     * @returns {object} 已修正 accountId 的 data
     */
    async _resolveRecordAccountId(data) {
        if (!data.accountUuid) return data
        try {
            const accounts = await this.dataService.getAccounts({
                allLedgers: true,
            })
            const matched = accounts.find(a => a.uuid === data.accountUuid)
            return { ...data, accountId: matched ? matched.id : null }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 record 的 debtUuid 解析為本地 debtId。
     * @param {object} data
     * @returns {object} 已修正 debtId 的 data
     */
    async _resolveRecordDebtId(data) {
        if (!data.debtUuid) return data
        try {
            const debt = await this.dataService.getByUUID(
                'debts',
                data.debtUuid
            )
            return { ...data, debtId: debt ? debt.id : null }
        } catch (_) {
            return data
        }
    }

    /**
     * 將遠端 recurring_transaction 的 accountUuid 解析為本地 accountId。
     * @param {object} data
     * @returns {object} 已修正 accountId 的 data
     */
    async _resolveRecurringAccountId(data) {
        if (!data.accountUuid) {
            return { ...data, accountId: null }
        }
        try {
            const accounts = await this.dataService.getAccounts({
                allLedgers: true,
            })
            const matched = accounts.find(a => a.uuid === data.accountUuid)
            return { ...data, accountId: matched ? matched.id : null }
        } catch (_) {
            return { ...data, accountId: null }
        }
    }

    /**
     * 將遠端 record 的 groupUuid 解析為本地 groupId。
     * @param {object} data
     * @returns {object} 已修正 groupId 的 data
     */
    async _resolveRecordGroupId(data) {
        if (!data.groupUuid) return data
        try {
            const group = await this.dataService.getByUUID(
                'groupMeta',
                data.groupUuid
            )
            return { ...data, groupId: group ? group.id : data.groupId || null }
        } catch (_) {
            return data
        }
    }

    async _resolveAllForeignKeys(storeName, data) {
        if (!data) return data
        let resolved = await this._resolveLedgerId(data)
        if (storeName === 'records') {
            resolved = await this._resolveRecordAccountId(resolved)
            resolved = await this._resolveRecordDebtId(resolved)
            resolved = await this._resolveRecordGroupId(resolved)
        } else if (storeName === 'debts') {
            resolved = await this._resolveRecordAccountId(resolved)
            resolved = await this._resolveRecordDebtId(resolved)
        }
        if (storeName === 'recurring_transactions') {
            resolved = await this._resolveRecurringAccountId(resolved)
        }
        return resolved
    }

    /**
     * @param {string} storeName
     * @param {object} data
     */
    async _applyAdd(storeName, data) {
        // Per-ledger custom_categories: custom_categories_${ledgerId}
        // Per-ledger custom_categories
        if (
            storeName === 'custom_categories' ||
            storeName?.startsWith('custom_categories_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.customCategories = data
                window.app.categoryManager.saveCustomCategories(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'custom_categories',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger category_order: category_order_${ledgerId}
        if (
            storeName === 'category_order' ||
            storeName?.startsWith('category_order_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.categoryOrder = data
                await window.app.categoryManager.saveCategorySettings(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'category_order',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger hidden_categories: hidden_categories_${ledgerId}
        if (
            storeName === 'hidden_categories' ||
            storeName?.startsWith('hidden_categories_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.hiddenCategories = data
                await window.app.categoryManager.saveCategorySettings(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'hidden_categories',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger budget_settings: budget_settings_${ledgerId}
        if (
            storeName === 'budget_settings' ||
            storeName?.startsWith('budget_settings_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.budgetManager
            ) {
                window.app.budgetManager.currentBudget = data.monthlyBudget || 0
                window.app.budgetManager.categoryBudgets =
                    data.categoryBudgets || {}
                window.app.budgetManager.categoryBudgetOrder =
                    data.categoryBudgetOrder || []
                window.app.budgetManager.excludedBudgetCategories =
                    data.excludedBudgetCategories || []
                await window.app.budgetManager.saveBudget(
                    window.app.budgetManager.currentBudget,
                    window.app.budgetManager.categoryBudgets,
                    window.app.budgetManager.categoryBudgetOrder,
                    window.app.budgetManager.excludedBudgetCategories,
                    true
                )
                if (
                    window.app.router &&
                    window.app.router.routes['home'] &&
                    typeof window.app.router.routes['home'].loadBudgetWidget ===
                        'function'
                ) {
                    window.app.router.routes['home'].loadBudgetWidget() // Auto refresh if available
                }
            } else {
                await this.dataService.saveSetting({
                    key: storeName,
                    value: data,
                })
                const suffix = suffixId ? `_${suffixId}` : ''
                localStorage.setItem(
                    `monthlyBudget${suffix}`,
                    (data.monthlyBudget || 0).toString()
                )
                localStorage.setItem(
                    `categoryBudgets${suffix}`,
                    JSON.stringify(data.categoryBudgets || {})
                )
                localStorage.setItem(
                    `categoryBudgetOrder${suffix}`,
                    JSON.stringify(data.categoryBudgetOrder || [])
                )
                localStorage.setItem(
                    `excludedBudgetCategories${suffix}`,
                    JSON.stringify(data.excludedBudgetCategories || [])
                )
            }
            return
        }

        // 如果 UUID 已存在則當新增處理，避免重複
        if (data.uuid) {
            const existing = await this.dataService.getByUUID(
                storeName,
                data.uuid
            )
            if (existing) {
                await this._applyUpdateWithId(storeName, existing.id, data)
                return
            }
        }

        // 針對預設帳本 (id: 1) 的特殊處理：不同裝置初始化時預設帳本會有不同的 UUID，
        // 若同步時發現來源為預設帳本，且本地也有預設帳本，則應合併（更新）而非新增，避免產生多個預設帳本
        if (
            storeName === 'ledgers' &&
            (data.id === 1 || data.name === '預設帳本')
        ) {
            const localDefaultLedger = await this.dataService.getLedger(1)
            if (localDefaultLedger) {
                await this._applyUpdateWithId(storeName, 1, data)
                return
            }
        }

        switch (storeName) {
            case 'groupMeta':
            case 'group_meta': {
                const resolvedGroupMeta = await this._resolveLedgerId(data)
                await this.dataService.saveGroupMeta(resolvedGroupMeta, true)
                break
            }
            case 'ledgers': {
                await this.dataService.addLedger(data, true)
                break
            }
            case 'records': {
                // 同步時解析全部外鍵 UUID
                let resolvedRecord = await this._resolveLedgerId(data)
                resolvedRecord =
                    await this._resolveRecordAccountId(resolvedRecord)
                resolvedRecord = await this._resolveRecordDebtId(resolvedRecord)
                await this.dataService.addRecord(resolvedRecord, true)
                break
            }
            case 'accounts': {
                const resolvedAccount = await this._resolveLedgerId(data)
                await this.dataService.addAccount(resolvedAccount, true)
                break
            }
            case 'contacts': {
                const resolvedContact = await this._resolveLedgerId(data)
                await this.dataService.addContact(resolvedContact, true)
                break
            }
            case 'debts': {
                // 同步時解析 contactUuid → contactId， recordUuid → recordId
                let resolvedDebt = await this._resolveLedgerId(data)
                resolvedDebt = await this._resolveDebtContactId(resolvedDebt)
                resolvedDebt = await this._resolveDebtRecordId(resolvedDebt)
                resolvedDebt = await this._resolveDebtPayments(resolvedDebt)
                const debtId = await this.dataService.addDebt(
                    resolvedDebt,
                    true
                )

                // 如果該欠款關聯了一個紀錄 (包含初次建立紀錄與還款紀錄)，且該紀錄在本地已存在
                // 則反向更新該紀錄的 debtId，解決 topoOrder 造成的單向綁定問題
                if (resolvedDebt.recordId && debtId) {
                    await this.dataService.updateRecord(
                        resolvedDebt.recordId,
                        { debtId: debtId },
                        true
                    )
                }
                if (
                    resolvedDebt.payments &&
                    Array.isArray(resolvedDebt.payments) &&
                    debtId
                ) {
                    for (const p of resolvedDebt.payments) {
                        if (p.recordId) {
                            await this.dataService.updateRecord(
                                p.recordId,
                                { debtId: debtId },
                                true
                            )
                        }
                    }
                }
                break
            }
            case 'recurring_transactions': {
                let resolvedRecurring = await this._resolveLedgerId(data)
                resolvedRecurring =
                    await this._resolveRecurringAccountId(resolvedRecurring)
                await this.dataService.addRecurringTransaction(
                    resolvedRecurring
                )
                break
            }
            default:
                console.warn('[SyncService] Unknown store for add:', storeName)
        }
    }

    /**
     * @param {string} storeName
     * @param {number|string} recordId
     * @param {object} data
     */
    async _applyUpdate(storeName, recordId, data) {
        // Per-ledger custom_categories
        if (
            storeName === 'custom_categories' ||
            storeName?.startsWith('custom_categories_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.customCategories = data
                window.app.categoryManager.saveCustomCategories(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'custom_categories',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger category_order
        if (
            storeName === 'category_order' ||
            storeName?.startsWith('category_order_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.categoryOrder = data
                await window.app.categoryManager.saveCategorySettings(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'category_order',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger hidden_categories
        if (
            storeName === 'hidden_categories' ||
            storeName?.startsWith('hidden_categories_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.categoryManager
            ) {
                window.app.categoryManager.hiddenCategories = data
                await window.app.categoryManager.saveCategorySettings(true)
            } else {
                const targetLedgerId =
                    suffixId || this.dataService.activeLedgerId
                await this.dataService.saveCategorySetting(
                    'hidden_categories',
                    data,
                    targetLedgerId
                )
            }
            return
        }

        // Per-ledger budget_settings: budget_settings_${ledgerId}
        if (
            storeName === 'budget_settings' ||
            storeName?.startsWith('budget_settings_')
        ) {
            const parts = storeName.split('_')
            const suffixId =
                parts.length > 2 ? parseInt(parts[parts.length - 1]) : null
            const isTargetActiveLedger =
                suffixId === null ||
                suffixId === this.dataService.activeLedgerId

            if (
                isTargetActiveLedger &&
                window.app &&
                window.app.budgetManager
            ) {
                window.app.budgetManager.currentBudget = data.monthlyBudget || 0
                window.app.budgetManager.categoryBudgets =
                    data.categoryBudgets || {}
                window.app.budgetManager.categoryBudgetOrder =
                    data.categoryBudgetOrder || []
                window.app.budgetManager.excludedBudgetCategories =
                    data.excludedBudgetCategories || []
                await window.app.budgetManager.saveBudget(
                    window.app.budgetManager.currentBudget,
                    window.app.budgetManager.categoryBudgets,
                    window.app.budgetManager.categoryBudgetOrder,
                    window.app.budgetManager.excludedBudgetCategories,
                    true
                )
                if (
                    window.app.router &&
                    window.app.router.routes['home'] &&
                    typeof window.app.router.routes['home'].loadBudgetWidget ===
                        'function'
                ) {
                    window.app.router.routes['home'].loadBudgetWidget() // Auto refresh if available
                }
            } else {
                await this.dataService.saveSetting({
                    key: storeName,
                    value: data,
                })
                const suffix = suffixId ? `_${suffixId}` : ''
                localStorage.setItem(
                    `monthlyBudget${suffix}`,
                    (data.monthlyBudget || 0).toString()
                )
                localStorage.setItem(
                    `categoryBudgets${suffix}`,
                    JSON.stringify(data.categoryBudgets || {})
                )
                localStorage.setItem(
                    `categoryBudgetOrder${suffix}`,
                    JSON.stringify(data.categoryBudgetOrder || [])
                )
                localStorage.setItem(
                    `excludedBudgetCategories${suffix}`,
                    JSON.stringify(data.excludedBudgetCategories || [])
                )
            }
            return
        }

        // 如果 UUID 已存在則當新增處理，避免重複
        if (data.uuid) {
            const existing = await this.dataService.getByUUID(
                storeName,
                data.uuid
            )
            if (existing) {
                await this._applyUpdateWithId(storeName, existing.id, data)
                return
            } else {
                // 針對預設帳本 (id: 1) 的特殊處理
                if (
                    storeName === 'ledgers' &&
                    (data.id === 1 || data.name === '預設帳本')
                ) {
                    const localDefaultLedger =
                        await this.dataService.getLedger(1)
                    if (localDefaultLedger) {
                        await this._applyUpdateWithId(storeName, 1, data)
                        return
                    }
                }
                // Not found by UUID, treat as Add (upsert)
                await this._applyAdd(storeName, data)
                return
            }
        }

        // Legacy fallback (might fail or duplicate if ID mismatches, but unavoidable without UUID)
        console.warn(
            '[SyncService] Legacy update without UUID ignored:',
            storeName
        )
    }

    async _applyUpdateWithId(storeName, id, data) {
        switch (storeName) {
            case 'groupMeta':
            case 'group_meta': {
                const resolvedGroupMeta = await this._resolveLedgerId(data)
                await this.dataService.saveGroupMeta(
                    { ...resolvedGroupMeta, id },
                    true
                )
                break
            }
            case 'ledgers': {
                // 保護本地的共用元資料，防止被遠端的舊資料（無此欄位）覆蓋
                // 只有當 remote data 沒有指定這些欄位時，才用 local 的值填補
                const localLedger = await this.dataService.getLedger(id)
                const protectedData = { ...data }
                if (localLedger) {
                    if (protectedData.isShared === undefined)
                        protectedData.isShared = localLedger.isShared
                    if (protectedData.sharedFileId === undefined)
                        protectedData.sharedFileId = localLedger.sharedFileId
                    if (protectedData.sharedManifestId === undefined)
                        protectedData.sharedManifestId =
                            localLedger.sharedManifestId
                    if (protectedData.type === undefined)
                        protectedData.type = localLedger.type
                }
                await this.dataService.updateLedger(id, protectedData, true)
                break
            }
            case 'records': {
                // 同步時解析全部外鍵 UUID
                let resolvedRecord = await this._resolveLedgerId(data)
                resolvedRecord =
                    await this._resolveRecordAccountId(resolvedRecord)
                resolvedRecord = await this._resolveRecordDebtId(resolvedRecord)
                await this.dataService.updateRecord(id, resolvedRecord, true)
                break
            }
            case 'accounts': {
                const resolvedAccount = await this._resolveLedgerId(data)
                await this.dataService.updateAccount(id, resolvedAccount, true)
                break
            }
            case 'contacts': {
                const resolvedContact = await this._resolveLedgerId(data)
                await this.dataService.updateContact(id, resolvedContact, true)
                break
            }
            case 'debts': {
                // 同步時解析 contactUuid → contactId， recordUuid → recordId
                let resolvedDebt = await this._resolveLedgerId(data)
                resolvedDebt = await this._resolveDebtContactId(resolvedDebt)
                resolvedDebt = await this._resolveDebtRecordId(resolvedDebt)
                resolvedDebt = await this._resolveDebtPayments(resolvedDebt)
                await this.dataService.updateDebt(id, resolvedDebt, true)

                // 同步更新關聯紀錄 (包含初次建立紀錄與還款紀錄)
                if (resolvedDebt.recordId) {
                    await this.dataService.updateRecord(
                        resolvedDebt.recordId,
                        { debtId: id },
                        true
                    )
                }
                if (
                    resolvedDebt.payments &&
                    Array.isArray(resolvedDebt.payments)
                ) {
                    for (const p of resolvedDebt.payments) {
                        if (p.recordId) {
                            await this.dataService.updateRecord(
                                p.recordId,
                                { debtId: id },
                                true
                            )
                        }
                    }
                }
                break
            }
            case 'recurring_transactions': {
                // P01 修復：先用 UUID 查找本地 ID，避免遠端整數 ID 不匹配
                let targetId = id
                if (data?.uuid) {
                    const existing = await this.dataService.getByUUID(
                        'recurring_transactions',
                        data.uuid
                    )
                    if (existing) {
                        targetId = existing.id
                    } else {
                        console.log(
                            '[SyncService] recurring_transactions update skipped (not found locally):',
                            data.uuid
                        )
                        break
                    }
                }
                let resolvedRecurring = await this._resolveLedgerId(data)
                resolvedRecurring =
                    await this._resolveRecurringAccountId(resolvedRecurring)
                await this.dataService.updateRecurringTransaction(
                    targetId,
                    resolvedRecurring,
                    true
                )
                break
            }
            default:
                console.warn(
                    '[SyncService] Unknown store for update:',
                    storeName
                )
        }
    }

    /**
     * @param {string} storeName
     * @param {number|string} recordId
     * @param {object} data (Optional, may contain UUID)
     */
    async _applyDelete(storeName, recordId, data) {
        // Try to find by UUID
        if (data && data.uuid) {
            const existing = await this.dataService.getByUUID(
                storeName,
                data.uuid
            )
            if (existing) {
                await this._applyDeleteWithId(storeName, existing.id)
                return
            } else {
                // Not found, maybe already deleted
                return
            }
        }

        // Legacy fallback
        console.warn(
            '[SyncService] Legacy delete without UUID ignored:',
            storeName
        )
    }

    async _applyDeleteWithId(storeName, id) {
        switch (storeName) {
            case 'groupMeta':
            case 'group_meta':
                await this.dataService.deleteGroupMeta(id, true)
                break
            case 'ledgers':
                await this.dataService.deleteLedger(id, true)
                break
            case 'records':
                await this.dataService.deleteRecord(id, true)
                break
            case 'accounts':
                await this.dataService.deleteAccount(id, true)
                break
            case 'contacts':
                await this.dataService.deleteContact(id, true)
                break
            case 'debts':
                await this.dataService.deleteDebt(id, true)
                break
            case 'recurring_transactions':
                await this.dataService.deleteRecurringTransaction(id, true)
                break
            default:
                console.warn(
                    '[SyncService] Unknown store for delete:',
                    storeName
                )
        }
    }

    // ──────────────────────────────────────────────
    // Google Picker API
    // ──────────────────────────────────────────────

    /**
     * 打開 Google Picker 選擇共用帳本檔案
     * 透過這個方式選取的/授權的檔案，會被 Google 自動賦予 drive.file 權限
     * @param {string|string[]} [fileIds=null] - 若已知 File ID，可傳入加速授權流程
     * @returns {Promise<string>} 回傳選擇的檔案 ID
     */
    async openSharedLedgerPicker(fileIds = null) {
        await this.ensureSharingPermission()
        // 批次 3：gapi（Google Picker）改按需載入
        try {
            await ensureGoogleSdk()
        } catch (e) {
            throw new Error('Google API 未載入（網路問題）')
        }
        if (typeof gapi === 'undefined') {
            throw new Error('Google API 未載入')
        }

        return new Promise((resolve, reject) => {
            gapi.load('picker', {
                callback: () => {
                    const view = new google.picker.DocsView(
                        google.picker.ViewId.DOCS
                    ).setMimeTypes('application/json')

                    const builder = new google.picker.PickerBuilder()
                        .addView(view)
                        .setTitle(
                            fileIds
                                ? '請同意授權存取此共用帳本'
                                : '在「與我共用」尋找共用帳本 (EasyAccounting_Shared 開頭)'
                        )
                        .setOAuthToken(this.accessToken)
                        .setCallback(data => {
                            if (data.action === google.picker.Action.PICKED) {
                                const file = data.docs[0]
                                resolve(file.id)
                            } else if (
                                data.action === google.picker.Action.CANCEL
                            ) {
                                reject(new Error('使用者取消選擇'))
                            }
                        })

                    // 如果有 API Key 則設定，沒有也能跑（僅在公開連結或特殊情況下可能會有影響）
                    if (GOOGLE_API_KEY) {
                        builder.setDeveloperKey(GOOGLE_API_KEY)
                    }

                    // 解析 App ID
                    if (GOOGLE_CLIENT_ID) {
                        const appId = GOOGLE_CLIENT_ID.split('-')[0]
                        if (appId) {
                            builder.setAppId(appId)
                        }
                    }

                    // 新版 API 支援傳入已知 File ID（例如從輸入框貼上的代碼）進行無縫授權
                    if (fileIds) {
                        const idsString = Array.isArray(fileIds)
                            ? fileIds.join(',')
                            : fileIds
                        if (typeof view.setFileIds === 'function') {
                            view.setFileIds(idsString)
                        } else {
                            // 退回最傳統的搜尋方式
                            view.setQuery(idsString)
                        }
                    } else {
                        // 沒有提供 File ID 時，傳統的瀏覽模式
                        view.setMode(google.picker.DocsViewMode.LIST)
                    }

                    const picker = builder.build()
                    picker.setVisible(true)
                },
            })
        })
    }
}

export default SyncService

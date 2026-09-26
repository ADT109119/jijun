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
            // 嚴格下載現有內容，合併後更新（任何下載錯誤均拋出，避免暫時性錯誤覆寫為空）
            const res = await this._downloadFileStrict(existingFileId)
            const existing = res || { changes: [] }
            existing.changes = [...(existing.changes || []), ...changes]
            existing.timestamp = Date.now()
            existing.deviceId = this.deviceId

            await this._updateFile(existingFileId, JSON.stringify(existing))
        } else {
            // 建立新檔案
            await this._createFile(fileName, JSON.stringify(syncData))
        }

        // 成功推送至個人雲端日誌後，以 ID 精準清除本地 sync_log
        const pushedIds = changes
            .filter(c => typeof c.id === 'number')
            .map(c => c.id)
        if (pushedIds.length > 0) {
            await this.dataService.deleteSyncLogsByIds(pushedIds)
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
     * 使用 checkedMap (依 modifiedTime 跳過未變更檔) 與 appliedKeys 去重。
     */
    async pullChanges() {
        await this.ensureValidToken()

        let files = []
        let pageToken = null
        do {
            const pageParam = pageToken
                ? `&pageToken=${encodeURIComponent(pageToken)}`
                : ''
            const resList = await fetch(
                `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=nextPageToken,files(id,name,modifiedTime)${pageParam}`,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
            )

            if (!resList.ok)
                throw new Error(`Failed to list sync logs (${resList.status})`)
            const data = await resList.json()
            if (Array.isArray(data.files)) {
                files.push(...data.files)
            }
            pageToken = data.nextPageToken || null
        } while (pageToken)

        const checkedSetting = await this.dataService.getSetting(
            'sync_personal_checked_map'
        )
        const checkedMap = checkedSetting?.value || {}
        const pendingCheckpoints = []

        const appliedSetting = await this.dataService.getSetting(
            'sync_personal_applied_keys'
        )
        const appliedKeys = new Set(appliedSetting?.value || [])
        const pendingKeys = new Set(appliedKeys)
        const allRemoteChanges = []

        for (const file of files) {
            if (file.name === `sync_log_${this.deviceId}.json`) continue

            const modifiedMs = file.modifiedTime
                ? new Date(file.modifiedTime).getTime()
                : 0
            if (
                modifiedMs &&
                checkedMap[file.id] &&
                modifiedMs <= checkedMap[file.id]
            ) {
                continue
            }

            const resFile = await this._downloadFile(file.id)
            const syncLog = resFile?.data
            if (!syncLog?.changes) continue

            const fileKeys = []
            for (const change of syncLog.changes) {
                const key = this._changeKey(change)
                if (pendingKeys.has(key)) continue
                pendingKeys.add(key)
                fileKeys.push(key)
                allRemoteChanges.push(change)
            }
            if (modifiedMs) {
                pendingCheckpoints.push({
                    fileId: file.id,
                    modifiedMs,
                    keys: fileKeys,
                })
            }
        }

        const successfulKeySet = new Set()
        if (allRemoteChanges.length > 0) {
            allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp)
            const appliedNow = await this.applyRemoteChanges(allRemoteChanges)
            const successfulKeys =
                appliedNow instanceof Set || Array.isArray(appliedNow)
                    ? appliedNow
                    : allRemoteChanges.map(c => this._changeKey(c))
            for (const key of successfulKeys) {
                appliedKeys.add(key)
                successfulKeySet.add(key)
            }
        }

        // 僅在該檔案的所有變更均成功套用後，才推進 checkedMap
        let checkedChanged = false
        for (const cp of pendingCheckpoints) {
            const allSucceeded = cp.keys.every(k => successfulKeySet.has(k))
            if (allSucceeded) {
                checkedMap[cp.fileId] = cp.modifiedMs
                checkedChanged = true
            }
        }
        if (checkedChanged) {
            await this.dataService.saveSetting({
                key: 'sync_personal_checked_map',
                value: checkedMap,
            })
        }

        // 持久化已套用鍵（全量保留，杜絕個人日誌重新重播導致已刪除或舊紀錄幽靈復活，與共用側對齊 N1）
        await this.dataService.saveSetting({
            key: 'sync_personal_applied_keys',
            value: [...appliedKeys],
        })

        await this.dataService.saveSetting({
            key: 'sync_last_sync',
            value: Date.now(),
        })
    }

    /**
     * 合併遠端變更到本地 IndexedDB
     * @param {Array} changes 變更列表
     * @param {object} [options={}]
     */
    async applyRemoteChanges(changes, options = {}) {
        if (!changes || changes.length === 0) return new Set()

        // 定義建立依賴的拓撲順序：
        // 類別 -> 帳本 -> 專案群組 -> 帳戶 -> 聯絡人 -> 欠款/借貸 -> 攤提計畫 -> 收支明細 -> 信用卡帳單 -> 定期收支
        const topoOrder = [
            'custom_categories',
            'category_order',
            'hidden_categories',
            'ledgers',
            'groupMeta',
            'group_meta',
            'accounts',
            'contacts',
            'debts',
            'amortizations',
            'records',
            'credit_statements',
            'recurring_transactions',
        ]

        // 嚴格排序邏輯：
        // 1. 主要依據 timestamp (由舊到新)
        // 2. 若 timestamp 相同，則依據操作類型 (add > update > delete)
        // 3. 若操作類型也相同，則依據 topoOrder（未知 store 排在最後，防止 -1 跑到最前）
        const sortedChanges = [...changes].sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp
            }

            const opWeight = { add: 0, update: 1, delete: 2 }
            if (a.operation !== b.operation) {
                return opWeight[a.operation] - opWeight[b.operation]
            }

            const idxA = topoOrder.indexOf(a.storeName)
            const idxB = topoOrder.indexOf(b.storeName)
            const orderA = idxA === -1 ? 999 : idxA
            const orderB = idxB === -1 ? 999 : idxB
            return orderA - orderB
        })

        const appliedKeys = new Set()

        for (const change of sortedChanges) {
            try {
                const { operation, storeName, recordId, data } = change
                console.log(
                    `[SyncService] applyRemoteChange: ${operation} ${storeName}`,
                    data?.uuid || data?.name || recordId
                )

                // 預檢測：如果是 add 且 UUID 已存在，視為冪等成功略過，避免舊建立快照覆蓋本機較新資料
                if (operation === 'add' && data?.uuid) {
                    const existing = await this.dataService.getByUUID(
                        storeName,
                        data.uuid
                    )
                    if (existing) {
                        appliedKeys.add(this._changeKey(change))
                        continue
                    }
                }

                switch (operation) {
                    case 'add':
                        await this._applyAdd(storeName, data, options)
                        break
                    case 'update':
                        await this._applyUpdate(storeName, recordId, data, options)
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
                appliedKeys.add(this._changeKey(change))
            } catch (err) {
                console.error(
                    '[SyncService] Error applying change:',
                    err,
                    change
                )
            }
        }
        return appliedKeys
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

            const hundredDaysAgo = Date.now() - 100 * 24 * 60 * 60 * 1000
            await this.dataService.saveSetting({
                key: 'sync_personal_applied_keys',
                value: [...appliedKeys].filter(k => {
                    const ts = parseInt(k.split('|')[1], 10)
                    return !isNaN(ts) && ts > hundredDaysAgo
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
     * @returns {Promise<{ok: boolean, maxTs: number|null}>} 推送狀態與最大時間戳
     */
    async pushSharedLedgerChanges() {
        await this.ensureValidToken()

        if (!(await this.isSharingAuthorized())) {
            console.warn('[SyncService] pushShared: 未授權共用權限，略過')
            return null
        }

        const ledgers = await this.dataService.getLedgers()
        const sharedLedgers = ledgers.filter(
            l => l.isShared && (l.sharedManifestId || l.sharedFileId)
        )
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
                }
                // 成功附加至共用日誌後，以 ID 精準清除本地已推送的 sync_log（排除仍需由個人同步推送的 ledgers）
                const autoSyncSetting = await this.dataService.getSetting(
                    'sync_auto_enabled'
                )
                const isPersonalEnabled = !!autoSyncSetting?.value
                const pushedIds = allLocal
                    .filter(
                        log =>
                            (isPersonalEnabled
                                ? log.storeName !== 'ledgers'
                                : true) && typeof log.id === 'number'
                    )
                    .map(log => log.id)
                if (pushedIds.length > 0) {
                    await this.dataService.deleteSyncLogsByIds(pushedIds)
                }

                if (mine.length > 0) {
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
        // 任一帳本失敗即回傳 null，讓 performSync 跳過本地日誌清理，避免誤刪未成功上傳的變更
        return allSucceeded ? (maxPushed !== null ? maxPushed : undefined) : null
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
        const sharedLedgers = ledgers.filter(
            l => l.isShared && (l.sharedManifestId || l.sharedFileId)
        )

        const appliedSetting = await this.dataService.getSetting(
            'sync_shared_applied_keys'
        )
        const appliedKeys = new Set(appliedSetting?.value || [])
        const pendingKeys = new Set(appliedKeys)
        const allRemoteChanges = []
        const pendingCheckpoints = []

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

                    const resFile = await this._downloadFile(member.fileId)
                    if (!resFile || !resFile.data) {
                        continue // 下載失敗（網路短暫中斷/500等），不更新 checkedMap 以便下次重試
                    }
                    const data = resFile.data
                    const targetUuid = infra.ledger.uuid
                    const memberKeys = []
                    for (const change of data?.changes || []) {
                        if (change.deviceId === this.deviceId) continue
                        // M2/P2: 嚴格驗證 ledgerUuid 防範跨帳本資料污染
                        const changeLedgerUuid =
                            change.storeName === 'ledgers'
                                ? change.data?.uuid
                                : change.data?.ledgerUuid
                        if (targetUuid && changeLedgerUuid !== targetUuid) {
                            console.warn(
                                `[SyncService] 略過非本帳本變更 (${changeLedgerUuid} !== ${targetUuid})`
                            )
                            continue
                        }
                        const key = this._changeKey(change)
                        if (pendingKeys.has(key)) continue
                        pendingKeys.add(key)
                        memberKeys.push(key)
                        allRemoteChanges.push(change)
                    }
                    pendingCheckpoints.push({
                        checkedKey,
                        checkedMap,
                        fileId: member.fileId,
                        modifiedMs,
                        keys: memberKeys,
                    })
                }
            } catch (e) {
                console.warn(
                    `[SyncService] pullShared failed for "${ledger.name}":`,
                    e
                )
            }
        }

        const successfulKeySet = new Set()
        if (allRemoteChanges.length > 0) {
            console.log(
                `[SyncService] pullShared: 套用 ${allRemoteChanges.length} 筆遠端變更`
            )
            allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp)
            const appliedNow = await this.applyRemoteChanges(allRemoteChanges, {
                isShared: true,
            })
            const successfulKeys =
                appliedNow instanceof Set || Array.isArray(appliedNow)
                    ? appliedNow
                    : allRemoteChanges.map(c => this._changeKey(c))
            for (const key of successfulKeys) {
                appliedKeys.add(key)
                successfulKeySet.add(key)
            }
        }

        // 僅在該成員日誌中所有待套用變更均成功寫入本地後，才推進該成員的 checkedMap checkpoint；
        // 若有任何變更套用失敗，保留舊時間戳使下次能重新下載並重試失敗項目（成功項目由 appliedKeys 去重）
        const updatedCheckedKeys = new Set()
        for (const cp of pendingCheckpoints) {
            const allSucceeded = cp.keys.every(k => successfulKeySet.has(k))
            if (allSucceeded) {
                cp.checkedMap[cp.fileId] = cp.modifiedMs
                updatedCheckedKeys.add(cp.checkedKey)
            }
        }
        for (const cp of pendingCheckpoints) {
            if (updatedCheckedKeys.has(cp.checkedKey)) {
                await this.dataService.saveSetting({
                    key: cp.checkedKey,
                    value: cp.checkedMap,
                })
                updatedCheckedKeys.delete(cp.checkedKey)
            }
        }

        // C2 修復：持久化已套用鍵集合（全量保留，杜絕過期後因成員日誌更新重新下載而重播已套用之變更）
        await this.dataService.saveSetting({
            key: 'sync_shared_applied_keys',
            value: [...appliedKeys],
        })
    }

    /**
     * 執行完整同步（push + pull + shared）
     * @param {boolean} isManual 是否為手動觸發（忽略個人同步的關閉設定）
     */
    async performSync(isManual = false) {
        if (this._syncing) return
        this._syncing = true
        this._syncInfraCache = new Map()

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
            let sharedMaxTs = undefined
            if (isPersonalEnabled) personalMaxTs = await this.pushChanges()
            sharedMaxTs = await this.pushSharedLedgerChanges()

            if (isPersonalEnabled) await this.pullChanges()
            await this.pullSharedLedgerChanges()

            if (sharedMaxTs === null) {
                console.warn(
                    '[SyncService] 部分共用帳本推送未完全成功，未成功之變更將於下次同步重試'
                )
            }

            console.log('[SyncService] performSync complete')
        } finally {
            this._syncInfraCache = null
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
     * 變更日誌的唯一鍵（去重用），格式：deviceId|timestamp|operation|storeName[|recordIdentifier]
     * @param {object} change
     * @returns {string}
     */
    _changeKey(change) {
        const recordIdentifier =
            change.data?.uuid ??
            (change.recordId !== undefined && change.recordId !== null
                ? change.recordId
                : (change.data?.id ?? (change.data?.key ?? (change.id ?? ''))))
        return `${change.deviceId || 'unknown'}|${change.timestamp}|${change.operation}|${change.storeName}${recordIdentifier ? `|${recordIdentifier}` : ''}`
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
            throw new Error(`Drive search failed (${res.status})`)
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
     * 支援 ETag CAS 樂觀鎖與 412 衝突重試。
     * @param {string} devLogId
     * @param {Array<object>} incomingChanges
     * @param {number} [maxRetries=3]
     * @returns {Promise<number>} 實際寫入的新增筆數（不含被裁剪者）
     */
    async _appendToDeviceLog(devLogId, incomingChanges, maxRetries = 3) {
        if (!devLogId || !incomingChanges.length) return 0

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 嚴格下載：任何失敗都拋出，避免把雲端既有內容誤判為空而整份覆寫；附帶 ETag 進行樂觀鎖更新
                const { data: cloud, etag } = await this._downloadFileStrict(
                    devLogId,
                    { withMeta: true }
                )
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

                // 雲端日誌全量保留變更歷史（不進行 90 天裁切），
                // 確保新加入成員或長期離線成員能獲得完整歷史，避免已刪除紀錄復活或早期交易遺失
                cloud.changes = [...existing, ...missing]
                cloud.deviceId = this.deviceId
                cloud.timestamp = Date.now()
                await this._updateFile(devLogId, JSON.stringify(cloud), etag)
                return missing.length
            } catch (e) {
                if (
                    attempt < maxRetries - 1 &&
                    (e.status === 412 || e.message?.includes('412'))
                ) {
                    console.warn(
                        `[SyncService] appendToDeviceLog 併發衝突，進行重試 ${attempt + 1}/${maxRetries}`
                    )
                    continue
                }
                throw e
            }
        }
        return 0
    }

    /**
     * 檢查當前裝置或使用者是否被列入共用清單的 removedMembers 黑名單
     * @param {object} manifest
     * @returns {boolean}
     */
    _isBlockedInManifest(manifest) {
        if (!manifest || !Array.isArray(manifest.removedMembers)) return false
        const myEmail = this.userInfo?.email?.toLowerCase() || ''
        const myDevId = this.deviceId?.toLowerCase() || ''
        return manifest.removedMembers.some(rm => {
            if (typeof rm === 'string') {
                const s = rm.toLowerCase()
                return (myDevId && s === myDevId) || (myEmail && s === myEmail)
            }
            if (rm && typeof rm === 'object') {
                return (
                    (myDevId &&
                        rm.deviceId &&
                        rm.deviceId.toLowerCase() === myDevId) ||
                    (myEmail && rm.email && rm.email.toLowerCase() === myEmail)
                )
            }
            return false
        })
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
                // 嚴格下載：任何失敗都拋出進入重試，絕不把雲端成員清單誤判為空而整份覆寫；獲取 ETag 用於樂觀鎖
                const { data: current, etag } =
                    await this._downloadFileStrict(manifestId, {
                        withMeta: true,
                    })
                if (!Array.isArray(current.members)) {
                    throw new Error('manifest 格式錯誤')
                }
                const myEmail = this.userInfo?.email?.toLowerCase() || ''
                if (this._isBlockedInManifest(current)) {
                    console.warn(
                        `[SyncService] 裝置 ${this.deviceId} (${myEmail || 'unknown'}) 已被移除，拒絕註冊`
                    )
                    return false
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
                            JSON.stringify(current),
                            etag
                        )
                    }
                } else {
                    current.members.push({
                        deviceId: this.deviceId,
                        ownerEmail: this.userInfo?.email || '',
                        fileId: devLogId,
                    })
                    current.timestamp = Date.now()
                    await this._updateFile(
                        manifestId,
                        JSON.stringify(current),
                        etag
                    )
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
     * @param {string|null} [removedEmail=null]
     * @param {number} [maxRetries=3]
     * @returns {Promise<boolean>}
     */
    async _removeManifestMember(
        manifestId,
        deviceId,
        removedEmail = null,
        maxRetries = 3
    ) {
        let finalEmail = removedEmail
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 嚴格下載：獲取 ETag 用於樂觀鎖
                const { data: current, etag } =
                    await this._downloadFileStrict(manifestId, {
                        withMeta: true,
                    })
                if (!current?.members) return false
                const target = current.members.find(
                    m => m.deviceId === deviceId
                )
                if (target?.ownerEmail) {
                    finalEmail = target.ownerEmail
                }
                const originalLength = current.members.length
                current.members = current.members.filter(
                    m => m.deviceId !== deviceId
                )
                if (current.members.length === originalLength && !finalEmail) {
                    return true
                }
                current.removedMembers = Array.isArray(current.removedMembers)
                    ? current.removedMembers
                    : []
                const entry = {
                    deviceId: deviceId.toLowerCase(),
                    email: finalEmail ? finalEmail.toLowerCase() : null,
                }
                const alreadyRecorded = current.removedMembers.some(rm => {
                    if (typeof rm === 'string') {
                        return (
                            rm.toLowerCase() === entry.deviceId ||
                            (entry.email && rm.toLowerCase() === entry.email)
                        )
                    }
                    if (rm && typeof rm === 'object') {
                        return (
                            rm.deviceId === entry.deviceId ||
                            (entry.email && rm.email === entry.email)
                        )
                    }
                    return false
                })
                if (!alreadyRecorded) {
                    current.removedMembers.push(entry)
                }
                current.timestamp = Date.now()
                await this._updateFile(
                    manifestId,
                    JSON.stringify(current),
                    etag
                )
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
     * 從 manifest 移除成員（公開給 ledgerManager 用）
     * @param {string} manifestId
     * @param {string} deviceId
     * @param {string|null} [removedEmail=null]
     * @returns {Promise<boolean>}
     */
    async removeManifestMember(manifestId, deviceId, removedEmail = null) {
        await this.ensureSharingPermission()
        return await this._removeManifestMember(
            manifestId,
            deviceId,
            removedEmail
        )
    }

    /**
     * 從 manifest.removedMembers 解除封鎖（當擁有者重新邀請成員時調用）
     * @param {string} manifestId
     * @param {string} email
     * @param {number} [maxRetries=3]
     * @returns {Promise<boolean>}
     */
    async _unblockManifestMember(manifestId, email, maxRetries = 3) {
        if (!email) return false
        const targetEmail = email.toLowerCase()
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const { data: current, etag } =
                    await this._downloadFileStrict(manifestId, {
                        withMeta: true,
                    })
                if (!current?.removedMembers || !Array.isArray(current.removedMembers)) {
                    return true
                }
                const originalLength = current.removedMembers.length
                current.removedMembers = current.removedMembers.filter(item => {
                    if (typeof item === 'string') {
                        return item.toLowerCase() !== targetEmail
                    }
                    if (item && typeof item === 'object') {
                        return item.email?.toLowerCase() !== targetEmail
                    }
                    return true
                })
                if (current.removedMembers.length === originalLength) {
                    return true
                }
                current.timestamp = Date.now()
                await this._updateFile(
                    manifestId,
                    JSON.stringify(current),
                    etag
                )
                return true
            } catch (e) {
                console.warn(
                    `[SyncService] unblockManifestMember 重試 ${attempt + 1}/${maxRetries}:`,
                    e.message
                )
            }
        }
        return false
    }

    /**
     * 解除成員在 manifest 上的封鎖（公開給 ledgerManager 用）
     * @param {string} manifestId
     * @param {string} email
     * @returns {Promise<boolean>}
     */
    async unblockManifestMember(manifestId, email) {
        await this.ensureSharingPermission()
        return await this._unblockManifestMember(manifestId, email)
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
            const grantedKey = `sync_shared_granted_${ledgerUuid}_${devLogId}`
            const grantedSetting =
                (await this.dataService.getSetting(grantedKey)) ||
                (await this.dataService.getSetting(
                    `sync_shared_granted_${ledgerUuid}`
                ))
            const granted = new Set(grantedSetting?.value || [])
            let m = null
            try {
                const res = await this._downloadFileStrict(manifestId)
                m = res?.data || res
            } catch (e) {
                console.warn(
                    '[SyncService] _grantDevLogPermissions 無法下載 manifest，略過權限對齊:',
                    e.message
                )
                return
            }

            if (!m || !Array.isArray(m.members)) {
                console.warn(
                    '[SyncService] _grantDevLogPermissions manifest 無效或無成員清單，略過權限對齊'
                )
                return
            }

            const myEmail = this.userInfo?.email || ''
            // M3 修復：取得 manifest 在 Google Drive 的真實授權名單，防止惡意成員在 manifest JSON 偽造 ownerEmail 定向外洩讀取權限
            let validDriveEmails = null
            try {
                const manifestDrivePerms =
                    await this.getFilePermissions(manifestId)
                validDriveEmails = new Set(
                    (manifestDrivePerms || [])
                        .map(p => p.emailAddress?.toLowerCase())
                        .filter(Boolean)
                )
            } catch (pErr) {
                console.warn(
                    '[SyncService] _grantDevLogPermissions 無法獲取 manifest Drive 權限名單，暫緩權限對齊:',
                    pErr.message
                )
                return
            }

            const activeMembers = m.members.filter(member => {
                if (!member.ownerEmail) return false
                return validDriveEmails.has(member.ownerEmail.toLowerCase())
            })
            const activeEmails = new Set(
                activeMembers
                    .map(item => item.ownerEmail?.toLowerCase())
                    .filter(Boolean)
            )

            let changed = false

            // 1. 去中心化撤銷對齊：若已授權成員從 manifest 移除，主動撤銷其對自己日誌檔的讀取權限
            const toRevoke = [...granted].filter(
                email => !activeEmails.has(email.toLowerCase())
            )
            if (toRevoke.length > 0) {
                try {
                    const permissions = await this.getFilePermissions(devLogId)
                    for (const email of toRevoke) {
                        const p = (permissions || []).find(
                            item =>
                                item.emailAddress?.toLowerCase() ===
                                email.toLowerCase()
                        )
                        if (p?.id) {
                            try {
                                await this.removeFilePermission(devLogId, p.id)
                                granted.delete(email)
                                granted.delete(email.toLowerCase())
                                changed = true
                            } catch (revErr) {
                                console.warn(
                                    `[SyncService] 撤銷日誌權限失敗 (${email})，保留於快取待下輪重試:`,
                                    revErr
                                )
                            }
                        } else {
                            // 權限在 Google Drive 上已不存在，安全從快取移除
                            granted.delete(email)
                            granted.delete(email.toLowerCase())
                            changed = true
                        }
                    }
                } catch (revErr) {
                    console.warn(
                        '[SyncService] Reconcile revoked permissions failed:',
                        revErr
                    )
                }
            }

            // 2. 差額補授權：每台裝置日誌僅需給其他成員 'reader' 唯讀權限
            const myEmailLower = myEmail.toLowerCase()
            const pending = activeMembers.filter(
                member =>
                    member.ownerEmail &&
                    member.ownerEmail.toLowerCase() !== myEmailLower &&
                    !granted.has(member.ownerEmail.toLowerCase())
            )
            for (const member of pending) {
                try {
                    await this.grantFilePermission(
                        devLogId,
                        member.ownerEmail,
                        'reader'
                    )
                    granted.add(member.ownerEmail.toLowerCase())
                    changed = true
                } catch (_) {
                    // 已授權過或暫時性錯誤，靜默忽略（下次同步會再試）
                }
            }
            if (changed) {
                await this.dataService.saveSetting({
                    key: grantedKey,
                    value: [...granted],
                })
            }
        } catch (e) {
            console.warn('[SyncService] grantDevLogPermissions failed:', e)
        }
    }

    /**
     * 確保共用帳本的 per-device 基礎設施就緒：
     * 1. 從舊式共用檔解析 manifest 指標與歷史變更
     * 2. 建立/定位 manifest（僅在本機尚無指標時建立；每輪依舊檔指標重校準，
     *    多台競爭時輸家採用贏家並刪除孤兒檔）
     * 3. 建立/定位自己的裝置日誌檔、補授權並註冊進 manifest
     * 4. （首次）將舊檔歷史併入自己的日誌並種入 appliedKeys
     * @param {object} ledger 本地帳本記錄（isShared 且有 sharedFileId）
     * @returns {Promise<{ledger: object, devLogId: string, manifestId: string}>}
     */
    async _ensureSharedInfra(ledger) {
        if (this._syncInfraCache?.has(ledger.uuid)) {
            return this._syncInfraCache.get(ledger.uuid)
        }

        const migratedKey = `shared_migrated_${ledger.uuid}`
        const migrated = await this.dataService.getSetting(migratedKey)
        let manifestId = ledger.sharedManifestId || null
        let legacyChanges = []
        let oldData = null

        // 1) 讀取舊式共用檔（每輪至多一次 GET：歷史變更與指標共用這份資料）
        if (ledger.sharedFileId && (!migrated?.value || !manifestId)) {
            try {
                oldData = await this._downloadFileStrict(ledger.sharedFileId)
                if (!manifestId && oldData?.manifestFileId) {
                    manifestId = oldData.manifestFileId
                }
                if (!migrated?.value && Array.isArray(oldData?.changes)) {
                    legacyChanges = oldData.changes
                }
            } catch (err) {
                if (err.message && err.message.includes('404')) {
                    // 舊檔在雲端已被刪除，視為已無歷史資料可遷移
                    oldData = { changes: [] }
                } else {
                    // 暫時性網路錯誤/500 等，拋錯中斷當次同步，絕不可將 migrated 標記為 true
                    throw new Error(
                        `Failed to download legacy shared file for "${ledger.name}": ${err.message}`
                    )
                }
            }
        }

        // M6 / P1 防護：若已知 manifestId，預檢驗證雲端檔案是否存在；若明確為 404（擁有者已取消共用）或被列入黑名單，自動降級本地帳本為個人帳本
        if (manifestId) {
            try {
                const mfRes = await this._downloadFileStrict(manifestId)
                const mfData = mfRes?.data || mfRes
                if (mfData && this._isBlockedInManifest(mfData)) {
                    console.warn(
                        `[SyncService] 裝置已從共用帳本 "${ledger.name}" 移除，自動降級為個人帳本`
                    )
                    await this.dataService.updateLedger(
                        ledger.id,
                        {
                            isShared: false,
                            sharedManifestId: null,
                            sharedFileId: null,
                        },
                        true
                    )
                    ledger.isShared = false
                    ledger.sharedManifestId = null
                    ledger.sharedFileId = null

                    const devLogKey = `sync_shared_devlog_${ledger.uuid}`
                    const devLogId = (
                        await this.dataService.getSetting(devLogKey)
                    )?.value
                    if (devLogId) {
                        try {
                            await this.deleteFile(devLogId)
                        } catch (_) {}
                        await this.dataService.saveSetting({
                            key: devLogKey,
                            value: null,
                        })
                    }
                    throw new Error(`您已被移出共用帳本 "${ledger.name}"`)
                }
            } catch (mfErr) {
                if (mfErr.message && mfErr.message.includes('404')) {
                    console.warn(
                        `[SyncService] 共用帳本 "${ledger.name}" 的雲端 Manifest 已被刪除 (404)，自動降級為個人帳本`
                    )
                    await this.dataService.updateLedger(
                        ledger.id,
                        {
                            isShared: false,
                            sharedManifestId: null,
                            sharedFileId: null,
                        },
                        true
                    )
                    ledger.isShared = false
                    ledger.sharedManifestId = null
                    ledger.sharedFileId = null

                    const devLogKey = `sync_shared_devlog_${ledger.uuid}`
                    const devLogId = (
                        await this.dataService.getSetting(devLogKey)
                    )?.value
                    if (devLogId) {
                        try {
                            await this.deleteFile(devLogId)
                        } catch (_) {}
                        await this.dataService.saveSetting({
                            key: devLogKey,
                            value: null,
                        })
                    }
                    throw new Error(
                        `共用帳本 "${ledger.name}" 已被擁有者取消共用 (404)`
                    )
                }
                throw mfErr
            }
        }

        // 2) 解析或建立 manifest（建立僅發生在本機尚無任何指標時）
        if (!manifestId) {
            const name = this._manifestFileName(ledger.uuid)
            manifestId = await this._findFileInDrive(name)
            if (!manifestId) {
                // 從舊共用檔權限查詢真正擁有者，避免位置判定的擁有者錯亂
                let ownerEmail = this.userInfo?.email || ''
                let legacyPerms = []
                let isLegacyOwner = true
                if (ledger.sharedFileId) {
                    isLegacyOwner = false
                    try {
                        legacyPerms =
                            (await this.getFilePermissions(
                                ledger.sharedFileId
                            )) || []
                        const owner = legacyPerms.find(p => p.role === 'owner')
                        if (owner?.emailAddress) {
                            ownerEmail = owner.emailAddress
                            const myEmail = this.userInfo?.email || ''
                            isLegacyOwner =
                                !!myEmail &&
                                owner.emailAddress.toLowerCase() ===
                                    myEmail.toLowerCase()
                        }
                    } catch (e) {
                        throw new Error(
                            `無法驗證舊共用檔擁有者權限，暫緩建立 manifest: ${e.message}`
                        )
                    }

                    // H1 / N4 防護：若自己不是舊共用檔擁有者，禁止在自己 Drive 搶先建立 manifest，避免架空擁有者
                    if (!isLegacyOwner) {
                        throw new Error(
                            `共用帳本 "${ledger.name}" 尚未由擁有者完成新版遷移，請等待擁有者升級`
                        )
                    }
                }
                const created = await this._createSharedFile(
                    name,
                    JSON.stringify({
                        ledgerUuid: ledger.uuid,
                        ownerEmail,
                        legacySharedFileId: ledger.sharedFileId || null,
                        ledgerMeta: {
                            name: ledger.name,
                            color: ledger.color,
                            icon: ledger.icon,
                            currency: ledger.currency || 'TWD',
                        },
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

                // C4 修復：擁有者建立 manifest 後，批量對舊檔既有協作者授予 writer 權限，避免成員升級時遭遇 403 鎖死
                if (ledger.sharedFileId && legacyPerms.length > 0) {
                    for (const p of legacyPerms) {
                        if (p.role !== 'owner' && p.emailAddress) {
                            try {
                                await this.grantFilePermission(
                                    manifestId,
                                    p.emailAddress,
                                    'writer'
                                )
                            } catch (gErr) {
                                console.warn(
                                    `[SyncService] 遷移授權成員 ${p.emailAddress} 失敗:`,
                                    gErr
                                )
                            }
                        }
                    }
                }
            }
            // 把指標寫回舊檔協調其他裝置（帶 ETag 樂觀鎖；多台同時建立時，412 衝突者自動採用贏家指標並刪除孤兒 manifest）
            if (ledger.sharedFileId) {
                try {
                    const { data: latest, etag } =
                        await this._downloadFileStrict(ledger.sharedFileId, {
                            withMeta: true,
                        })
                    if (!latest.manifestFileId) {
                        latest.manifestFileId = manifestId
                        latest.timestamp = Date.now()
                        await this._updateFile(
                            ledger.sharedFileId,
                            JSON.stringify(latest),
                            etag
                        )
                    } else if (latest.manifestFileId !== manifestId) {
                        try {
                            await this.deleteFile(manifestId)
                        } catch (_) {}
                        manifestId = latest.manifestFileId
                    }
                } catch (confErr) {
                    if (
                        confErr.status === 412 ||
                        confErr.message?.includes('412')
                    ) {
                        try {
                            const fresh = await this._downloadFileStrict(
                                ledger.sharedFileId
                            )
                            if (
                                fresh?.manifestFileId &&
                                fresh.manifestFileId !== manifestId
                            ) {
                                try {
                                    await this.deleteFile(manifestId)
                                } catch (_) {}
                                manifestId = fresh.manifestFileId
                            }
                        } catch (_) {}
                    }
                }
            }
        } else if (oldData) {
            // 指標重校準（舊檔遷移階段執行）：帳本記錄的指標可能已過期，
            // 以本次讀到的舊檔指標為準，確保分裂的 manifest 收斂到同一個
            if (
                oldData.manifestFileId &&
                oldData.manifestFileId !== manifestId
            ) {
                manifestId = oldData.manifestFileId
            } else if (!oldData.manifestFileId) {
                // 舊檔缺指標：補寫回目前已知指標，協調尚未升級的裝置
                try {
                    oldData.manifestFileId = manifestId
                    oldData.timestamp = Date.now()
                    await this._updateFile(
                        ledger.sharedFileId,
                        JSON.stringify(oldData)
                    )
                } catch (_) {}
            }
        }

        // 確保 manifest 記錄了 legacySharedFileId（以 ETag 樂觀鎖更新）
        if (manifestId && ledger.sharedFileId) {
            try {
                const { data: mfData, etag } =
                    await this._downloadFileStrict(manifestId, {
                        withMeta: true,
                    })
                if (mfData && !mfData.legacySharedFileId) {
                    mfData.legacySharedFileId = ledger.sharedFileId
                    mfData.timestamp = Date.now()
                    await this._updateFile(
                        manifestId,
                        JSON.stringify(mfData),
                        etag
                    )
                }
            } catch (_) {}
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
        }
        // 補授權給 manifest 中尚未授權的成員（日誌檔已存在時也要跑，
        // 處理晚加入的成員；內部以 granted-email 快取節省 API 配額）
        await this._grantDevLogPermissions(
            ledger.uuid,
            manifestId,
            devLogId
        )

        // 將自己的日誌檔註冊進 manifest（含首次建立與 fileId 變更的補登）
        const registered = await this._registerSelfInManifest(
            manifestId,
            devLogId
        )
        if (!registered) {
            throw new Error(
                `Failed to register device in manifest for "${ledger.name}"`
            )
        }

        // 4) 遷移：舊檔歷史併入自己的日誌 + 種入 appliedKeys（保留原始 deviceId 消除重播差異）
        if (legacyChanges.length > 0) {
            const mine = legacyChanges.map(c => ({
                ...c,
                deviceId: c.deviceId || this.deviceId,
            }))
            await this._appendToDeviceLog(devLogId, mine)
            const appliedSetting = await this.dataService.getSetting(
                'sync_shared_applied_keys'
            )
            const appliedKeys = new Set(appliedSetting?.value || [])
            mine.forEach(c => appliedKeys.add(this._changeKey(c)))
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
        if (!migrated?.value && (!ledger.sharedFileId || oldData !== null)) {
            await this.dataService.saveSetting({
                key: migratedKey,
                value: true,
            })
        }

        const result = { ledger, devLogId, manifestId }
        this._syncInfraCache?.set(ledger.uuid, result)
        return result
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

        const targetUuid = manifest.ledgerUuid

        if (this._isBlockedInManifest(manifest)) {
            throw new Error('此裝置或使用者已被從共用帳本中移除，無法加入')
        }

        // 1. 收集所有成員日誌的變更（key 去重）
        const seen = new Set()
        const allChanges = []
        const collect = changes => {
            for (const c of changes || []) {
                // M2/N3/P2: 嚴格驗證 ledgerUuid 防範跨帳本資料污染
                const changeLedgerUuid =
                    c.storeName === 'ledgers'
                        ? c.data?.uuid
                        : c.data?.ledgerUuid
                if (targetUuid && changeLedgerUuid !== targetUuid) {
                    console.warn(
                        `[SyncService] joinViaManifest 略過非本帳本變更 (${changeLedgerUuid} !== ${targetUuid})`
                    )
                    continue
                }
                const key = this._changeKey(c)
                if (!seen.has(key)) {
                    seen.add(key)
                    allChanges.push(c)
                }
            }
        }
        let hasIncompleteLogs = false
        for (const member of manifest.members) {
            if (!member.fileId) continue
            try {
                const d = await this._downloadFileStrict(member.fileId)
                collect(d?.changes)
            } catch (err) {
                // 404/403 表示該成員日誌檔已被刪除或權限尚未準備完成
                if (
                    err.message &&
                    (err.message.includes('404') || err.message.includes('403'))
                ) {
                    hasIncompleteLogs = true
                    console.warn(
                        `[SyncService] joinViaManifest 成員日誌 ${member.fileId} 尚不可存取 (403/404)，待後續同步自動補齊:`,
                        err.message
                    )
                } else {
                    // 網路異常或 5xx 錯誤應拋出終止加入，避免造成本地歷史資料缺漏
                    throw err
                }
            }
        }
        if (manifest.legacySharedFileId) {
            try {
                const d = await this._downloadFileStrict(
                    manifest.legacySharedFileId
                )
                collect(d?.changes)
            } catch (err) {
                if (
                    err.message &&
                    (err.message.includes('404') || err.message.includes('403'))
                ) {
                    console.warn(
                        `[SyncService] joinViaManifest legacy file not accessible, skipping:`,
                        err.message
                    )
                } else {
                    throw err
                }
            }
        }
        allChanges.sort((a, b) => a.timestamp - b.timestamp)
        const appliedNow = await this.applyRemoteChanges(allChanges, {
            isShared: true,
        })
        const successfulKeySet =
            appliedNow instanceof Set
                ? appliedNow
                : new Set(
                      Array.isArray(appliedNow)
                          ? appliedNow
                          : allChanges.map(c => this._changeKey(c))
                  )

        let ledgerChange = allChanges.find(
            c =>
                c.storeName === 'ledgers' &&
                c.data?.uuid &&
                (!targetUuid || c.data.uuid === targetUuid)
        )
        const isLedgerChangeApplied =
            ledgerChange && successfulKeySet.has(this._changeKey(ledgerChange))

        const allLedgers = await this.dataService.getLedgers()
        let localLedger = targetUuid
            ? allLedgers.find(l => l.uuid === targetUuid)
            : null

        if (!localLedger && !isLedgerChangeApplied) {
            if (manifest.ledgerMeta && manifest.ledgerUuid) {
                const fallbackLedger = {
                    uuid: manifest.ledgerUuid,
                    name: manifest.ledgerMeta.name || '共用帳本',
                    color: manifest.ledgerMeta.color || '#3b82f6',
                    icon: manifest.ledgerMeta.icon || 'fa-book',
                    type: 'shared',
                    isShared: true,
                    sharedManifestId: manifestId,
                    currency: manifest.ledgerMeta.currency || 'TWD',
                }
                await this.dataService.addLedger(fallbackLedger)
                localLedger = fallbackLedger
                ledgerChange = { data: fallbackLedger }
            } else {
                throw new Error(
                    '帳本建立失敗或未包含有效帳本定義，加入流程已中止'
                )
            }
        }
        if (!localLedger && !ledgerChange) throw new Error('無法從共用資料解析帳本')
        const ledgerUuid =
            targetUuid || localLedger?.uuid || ledgerChange.data.uuid

        if (hasIncompleteLogs) {
            await this.dataService.saveSetting({
                key: `sync_shared_incomplete_${ledgerUuid}`,
                value: true,
            })
        }

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
        const registered = await this._registerSelfInManifest(
            manifestId,
            devLogId
        )
        if (!registered) {
            throw new Error(`Failed to register device in manifest ${manifestId}`)
        }

        // 3. 種入 appliedKeys，之後 pull 不會重複套用這些變更
        // 併入現有 appliedKeys（其他共用帳本的鍵不可清除）
        const appliedSetting = await this.dataService.getSetting(
            'sync_shared_applied_keys'
        )
        const merged = new Set([
            ...(appliedSetting?.value || []),
            ...successfulKeySet,
        ])
        await this.dataService.saveSetting({
            key: 'sync_shared_applied_keys',
            value: [...merged],
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
     * @param {object} [options={}]
     * @param {boolean} [options.withMeta=false] - 是否一併回傳 ETag 等中繼資訊
     * @returns {Promise<object>} 解析後的 JSON 內容（若 withMeta 為 true 則回傳 { data, etag }）
     */
    async _downloadFileStrict(fileId, { withMeta = false } = {}) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        )
        if (!res.ok) throw new Error(`Failed to download file (${res.status})`)
        const data = await res.json()
        if (withMeta) {
            const etag =
                res.headers?.get?.('ETag') ||
                res.headers?.get?.('etag') ||
                res.headers?.etag ||
                (res._etag ?? null)
            return {
                data,
                etag: etag || null,
            }
        }
        return data
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
     * 將指定檔案授權給其他 Email (預設 writer，日誌檔可指定 reader)
     * @param {string} fileId
     * @param {string} emailAddress
     * @param {string} [role='writer']
     */
    async grantFilePermission(fileId, emailAddress, role = 'writer') {
        await this.ensureSharingPermission()

        const body = {
            role,
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
     * @param {string|null} [matchTag=null] - 用於樂觀鎖的 ETag
     */
    async _updateFile(fileId, content, matchTag = null) {
        const headers = {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
        }
        if (matchTag) {
            headers['If-Match'] = matchTag
        }
        const res = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                headers,
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
            const err = new Error(errMsg)
            err.status = res.status
            throw err
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
     * @param {object} data
     * @param {object} [options={}]
     * @returns {object} 已修正 ledgerId 的 data
     */
    async _resolveLedgerId(data, options = {}) {
        if (!data.ledgerUuid) return data
        try {
            const ledgers = await this.dataService.getLedgers()
            let matched = ledgers.find(l => l.uuid === data.ledgerUuid)

            // If no exact UUID match, but the data indicates it belongs to the default ledger
            // （僅在非共用帳本同步時允許回退至本地預設帳本 #1）
            if (
                !matched &&
                !options?.isShared &&
                (data.ledgerId === 1 || data.ledgerName === '預設帳本')
            ) {
                matched = ledgers.find(l => l.id === 1)
            }

            console.log(
                `[SyncService] _resolveLedgerId: uuid=${data.ledgerUuid}, matched=${matched?.id} (${matched?.name}), activeLedgerId=${this.dataService.activeLedgerId}`
            )
            // 共用帳本若未匹配到任何帳本，不回退至本地使用中的個人 activeLedgerId
            if (!matched && options?.isShared) {
                return data
            }
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
     * @param {object} [options={}]
     */
    async _applyAdd(storeName, data, options = {}) {
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

        // 如果 UUID 已存在則視為冪等略過，避免重複且防止舊建立快照覆蓋本機較新資料
        if (data.uuid) {
            const existing = await this.dataService.getByUUID(
                storeName,
                data.uuid
            )
            if (existing) {
                return
            }
        }

        // 針對預設帳本 (id: 1) 的特殊處理：不同裝置初始化時預設帳本會有不同的 UUID，
        // 若個人同步時發現來源為個人預設帳本，且本地也有預設帳本，則應合併（更新）而非新增，避免產生多個預設帳本。
        // 但若為共用帳本 (data.isShared 或 options.isShared)，嚴禁覆寫受邀者的本地預設帳本！
        if (
            storeName === 'ledgers' &&
            !data.isShared &&
            !options?.isShared &&
            (data.id === 1 || data.name === '預設帳本')
        ) {
            const localDefaultLedger = await this.dataService.getLedger(1)
            if (localDefaultLedger && !localDefaultLedger.isShared) {
                await this._applyUpdateWithId(storeName, 1, data)
                return
            }
        }

        switch (storeName) {
            case 'groupMeta':
            case 'group_meta': {
                const resolvedGroupMeta = await this._resolveLedgerId(
                    data,
                    options
                )
                await this.dataService.saveGroupMeta(resolvedGroupMeta, true)
                break
            }
            case 'ledgers': {
                await this.dataService.addLedger(data, true)
                break
            }
            case 'records': {
                // 同步時解析全部外鍵 UUID
                let resolvedRecord = await this._resolveLedgerId(data, options)
                resolvedRecord =
                    await this._resolveRecordAccountId(resolvedRecord)
                resolvedRecord = await this._resolveRecordDebtId(resolvedRecord)
                await this.dataService.addRecord(resolvedRecord, true)
                break
            }
            case 'accounts': {
                const resolvedAccount = await this._resolveLedgerId(
                    data,
                    options
                )
                await this.dataService.addAccount(resolvedAccount, true)
                break
            }
            case 'contacts': {
                const resolvedContact = await this._resolveLedgerId(
                    data,
                    options
                )
                await this.dataService.addContact(resolvedContact, true)
                break
            }
            case 'debts': {
                // 同步時解析 contactUuid → contactId， recordUuid → recordId
                let resolvedDebt = await this._resolveLedgerId(data, options)
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
                let resolvedRecurring = await this._resolveLedgerId(
                    data,
                    options
                )
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
     * @param {object} [options={}]
     */
    async _applyUpdate(storeName, recordId, data, options = {}) {
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
                // 針對預設帳本 (id: 1) 的特殊處理：不同裝置初始化時預設帳本會有不同的 UUID，
                // 若個人同步時發現來源為個人預設帳本，且本地也有預設帳本，則應合併（更新）而非新增。
                // 但若為共用帳本 (data.isShared 或 options.isShared)，嚴禁覆寫受邀者的本地預設帳本！(C3 / N2 防護)
                if (
                    storeName === 'ledgers' &&
                    !data.isShared &&
                    !options?.isShared &&
                    (data.id === 1 || data.name === '預設帳本')
                ) {
                    const localDefaultLedger =
                        await this.dataService.getLedger(1)
                    if (localDefaultLedger && !localDefaultLedger.isShared) {
                        await this._applyUpdateWithId(storeName, 1, data)
                        return
                    }
                }
                // Not found by UUID, treat as Add (upsert)
                await this._applyAdd(storeName, data, options)
                return
            }
        }

        // Legacy fallback (might fail or duplicate if ID mismatches, but unavoidable without UUID)
        console.warn(
            '[SyncService] Legacy update without UUID ignored:',
            storeName
        )
    }

    async _applyUpdateWithId(storeName, id, data, options = {}) {
        switch (storeName) {
            case 'groupMeta':
            case 'group_meta': {
                const resolvedGroupMeta = await this._resolveLedgerId(
                    data,
                    options
                )
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
                let resolvedRecord = await this._resolveLedgerId(data, options)
                resolvedRecord =
                    await this._resolveRecordAccountId(resolvedRecord)
                resolvedRecord = await this._resolveRecordDebtId(resolvedRecord)
                await this.dataService.updateRecord(id, resolvedRecord, true)
                break
            }
            case 'accounts': {
                const resolvedAccount = await this._resolveLedgerId(
                    data,
                    options
                )
                await this.dataService.updateAccount(id, resolvedAccount, true)
                break
            }
            case 'contacts': {
                const resolvedContact = await this._resolveLedgerId(
                    data,
                    options
                )
                await this.dataService.updateContact(id, resolvedContact, true)
                break
            }
            case 'debts': {
                // 同步時解析 contactUuid → contactId， recordUuid → recordId
                let resolvedDebt = await this._resolveLedgerId(data, options)
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
                let resolvedRecurring = await this._resolveLedgerId(
                    data,
                    options
                )
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

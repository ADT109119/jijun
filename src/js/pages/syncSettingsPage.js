import { showToast, customConfirm, customAlert, closeModalWithAnimation, escapeHTML, showProgressModal } from '../utils.js'
import { DEFAULT_SERVER_URL } from '../syncService.js'

// Google 帳號登入按鈕（Google 雲端模式與自架代理模式共用）
const GOOGLE_BTN_INNER = `
    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
    <span class="text-sm font-medium text-wabi-text-primary">使用 Google 帳號登入</span>
`

// 自架同步使用說明：GitHub 上渲染好的 SELF_HOST.md（前後端一體驗證、環境變數、帳號管理、家人共用帳本）
const SELFHOST_DOCS_URL = 'https://github.com/ADT109119/jijun/blob/main/SELF_HOST.md'

export class SyncSettingsPage {
    constructor(app) {
        this.app = app
        // UI 狀態（非持久化）：
        // activeMode = 'official' | 'selfhost'：頂部模式 selector 目前顯示的面板
        // authMethod = 'pin' | 'google'：自架模式下選擇的登入方式
        this.activeMode = null
        this.authMethod = 'pin'
    }

    // 推導頂部 selector 預設值（只在首次 render 時設定；之後以使用者點選為準）。
    //   selfHostToken 存在        → 自架（帳號 PIN 通道，資料存 server SQLite）
    //   Google token 存在          → 官方雲端（含自架 server 的代理換證：
    //                              資料通道仍為 Google Drive，已登入卡與登出
    //                              統一顯示於官方面板，避免雙邊邏輯矛盾）
    //   未登入                     → 官方雲端（預設）
    deriveActiveMode(isSelfHostMode) {
        return isSelfHostMode ? 'selfhost' : 'official'
    }

    async render() {
        const ss = this.app.syncService
        // render 重入防護：render() 含多個 await（adminListUsers / getSetting），
        // 快速連點分頁會併發多次 render；以遞增 token 確保只有「最後一次」render
        // 的結果寫入 DOM，較早（慢）的 render 完成時若 token 已過期則棄寫。
        this._renderSeq = (this._renderSeq || 0) + 1
        const seq = this._renderSeq
        const isSelfHostMode = ss.isSelfHostMode()
        const hasGoogle = !!(ss.accessToken && ss.refreshToken)
        const selfHostUsername = ss.selfHostUsername
        const userInfo = ss.userInfo
        const serverUrl = ss.getServerUrl()
        const lastBackup =
            await this.app.dataService.getSetting('sync_last_backup')
        const lastSync = await this.app.dataService.getSetting('sync_last_sync')
        const autoSyncEnabled =
            await this.app.dataService.getSetting('sync_auto_enabled')
        const autoBackupEnabled = await this.app.dataService.getSetting(
            'sync_auto_backup_enabled'
        )
        const autoBackupInterval = await this.app.dataService.getSetting(
            'sync_auto_backup_interval'
        )
        const backupIntervalValue = autoBackupInterval?.value || 'daily'

        // self-host 額外狀態：公開註冊是否開放（health）+ 目前使用者是否 admin
        let registerEnabled = null
        let selfHostIsAdmin = false
        let adminUsers = []
        if (isSelfHostMode && serverUrl) {
            try {
                const adminRes = await ss.adminListUsers()
                selfHostIsAdmin = true
                adminUsers = adminRes.users || []
                registerEnabled = adminRes.registerEnabled === true
            } catch {
                // 非 admin 或失敗 → false
            }
        } else if (!isSelfHostMode && serverUrl) {
            try {
                const healthRes = await fetch(`${serverUrl}/api/health`, {
                    cache: 'no-store',
                })
                if (healthRes.ok) {
                    const health = await healthRes.json()
                    registerEnabled = health.registerEnabled === true
                }
            } catch {
                // server 不達 → 保持 null（顯示註冊按鈕，登入時再說）
            }
        }

        // 頂部模式 selector：首次 render 依 token 推導，之後以使用者點選為準
        if (!this.activeMode) {
            this.activeMode = this.deriveActiveMode(isSelfHostMode)
        }
        const mode = this.activeMode
        const authMethod = this.authMethod || 'pin'

        const html = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">雲端備份&同步</h2>
                    <div class="w-8"></div>
                </div>
                <div class="p-4 space-y-6 pb-24">

                    ${this.renderModeSelector(mode, isSelfHostMode, hasGoogle)}

                    ${mode === 'official'
                        ? this.renderOfficialPanel({ hasGoogle, userInfo, isSelfHostMode, serverUrl })
                        : this.renderSelfHostPanel({ isSelfHostMode, selfHostUsername, selfHostIsAdmin, adminUsers, registerEnabled, authMethod, hasGoogle, serverUrl })
                    }

                    <!--
                      帳號卡 / 備份同步卡「跟隨 active mode 的通道」顯示，
                      避免跨分頁滲漏：
                      - Google 帳號卡（含登出入口）只在官方面板顯示——
                        若在自架面板也顯示，會與自架登入表單並列造成混淆。
                      - 備份/同步卡只在「目前 mode 的通道已登入」時顯示：
                        官方面板 + Google 已登入、或自架面板 + 自架已登入。
                      - 自架帳號卡與登出入口由自架面板內部的 signedInCard 提供。
                      另一通道的登入狀態由頂部 selector 的綠點標示。
                    -->
                    ${
                        mode === 'official' && hasGoogle
                            ? this.renderGoogleAccountCard({ userInfo, isSelfHostMode, serverUrl })
                            : ''
                    }

                    ${
                        (mode === 'official' && hasGoogle) ||
                        (mode === 'selfhost' && isSelfHostMode)
                            ? this.renderSignedInCards({ isSelfHostMode, lastBackup, lastSync, autoSyncEnabled, autoBackupEnabled, backupIntervalValue })
                            : ''
                    }

                </div>
            </div>
        `
        // render 重入防護：若已有更新的 render 啟動（seq 過期），棄寫本次結果
        if (seq !== this._renderSeq) return
        this.app.appContainer.innerHTML = html
        this.setupSyncSettingsListeners()
    }

    // ── 頂部模式 selector（官方雲端 / 自架伺服器）──
    // 綠點顯示「目前資料通道」：selfHostToken（SQLite 通道）亮自架；
    // Google token（Drive 通道，含自架 server 代理換證）亮官方雲端。
    renderModeSelector(mode, isSelfHostMode, hasGoogle) {
        const officialConnected = hasGoogle && !isSelfHostMode
        const selfhostConnected = isSelfHostMode
        const tab = (id, icon, label, active, connected) => `
            <button id="${id}"
                class="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${active
                    ? 'bg-wabi-primary text-wabi-surface'
                    : 'bg-wabi-surface text-wabi-text-secondary border border-wabi-border hover:bg-wabi-bg'}">
                <i class="fa-solid ${icon}"></i> ${label}
                ${connected ? '<span class="w-2 h-2 rounded-full bg-green-400" title="目前資料通道"></span>' : ''}
            </button>`
        return `
            <div class="bg-wabi-surface rounded-xl p-3 space-y-2">
                <p class="text-xs text-wabi-text-secondary">同步服務模式</p>
                <div class="flex gap-2">
                    ${tab('sync-mode-official', 'fa-cloud', 'Google 雲端', mode === 'official', officialConnected)}
                    ${tab('sync-mode-selfhost', 'fa-server', '自架伺服器', mode === 'selfhost', selfhostConnected)}
                </div>
            </div>
        `
    }

    // ── 官方雲端面板 ──
    // 注意：Google「已登入」卡與登出按鈕抽離至 renderGoogleAccountCard
    // （獨立卡片、hasGoogle 時顯示於面板下方）。官方面板未登入時
    // 顯示 Google 登入卡（主 CTA）；自架模式透過「Google 帳號（代理）」
    // 登入後，deriveActiveMode 會導向官方面板並顯示已登入卡與登出入口，
    // 不會掉進未登入死胡同。
    renderOfficialPanel({ hasGoogle, serverUrl }) {
        const googleSignInCard = !hasGoogle
            ? `
            <div class="text-center py-4">
                <p class="text-sm text-wabi-text-secondary mb-3">登入 Google 帳號以使用雲端備份和同步功能</p>
                <button id="sync-sign-in-btn" class="px-6 py-2.5 bg-wabi-surface border border-wabi-border rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center justify-center gap-2 mx-auto">
                    ${GOOGLE_BTN_INNER}
                </button>
            </div>
            `
            : ''
        return `
            <div class="bg-wabi-surface rounded-xl p-4 space-y-4">
                <div class="space-y-1">
                    <h3 class="text-wabi-primary text-base font-bold"><i class="fa-solid fa-shield-halved mr-2"></i>Google 雲端服務</h3>
                    <p class="text-xs text-wabi-text-secondary">
                        使用個人 Google Drive 作為雲端儲存空間，伺服器僅轉發授權請求，記帳資料存於你的 Drive。
                    </p>
                </div>
                ${googleSignInCard}
                <div class="pt-3 border-t border-wabi-border space-y-2">
                    <label class="text-sm text-wabi-text-secondary">同步伺服器地址</label>
                    <div class="flex flex-wrap gap-2">
                        <input type="url" id="sync-server-url-input"
                            class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary"
                            value="${escapeHTML(serverUrl)}"
                            placeholder="${escapeHTML(DEFAULT_SERVER_URL)}" />
                        <button id="sync-server-save-btn" class="px-3 py-2 bg-wabi-primary text-wabi-surface rounded-lg text-sm font-medium hover:bg-wabi-primary/90 shrink-0">
                            儲存
                        </button>
                        <button id="sync-server-reset-btn" class="px-3 py-2 bg-wabi-bg text-wabi-text-secondary rounded-lg text-sm font-medium hover:bg-wabi-bg shrink-0" title="還原預設值">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                    </div>
                    <p class="text-xs text-wabi-text-secondary">Google 雲端服務地址，一般使用者無需修改；使用自架同步請切換「自架伺服器」模式。</p>
                </div>
            </div>
        `
    }

    // ── Google 帳號卡（已登入才顯示，獨立於模式面板）──
    // 顯示目前 Google Drive 通道的帳號狀態；若 OAuth 換證走的是自架 server
    // （serverUrl 非官方預設），附註「經自架伺服器代理換證」。
    renderGoogleAccountCard({ userInfo, isSelfHostMode, serverUrl }) {
        const proxyNote =
            !isSelfHostMode &&
            serverUrl.replace(/\/+$/, '') !== DEFAULT_SERVER_URL.replace(/\/+$/, '')
                ? '（經自架伺服器代理換證）'
                : ''
        return `
            <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                <div class="flex items-center gap-3 p-3 bg-wabi-bg rounded-lg border border-wabi-border">
                    ${userInfo?.picture
                        ? `<img src="${escapeHTML(userInfo.picture)}" class="w-10 h-10 rounded-full" alt="avatar" />`
                        : '<div class="w-10 h-10 rounded-full bg-wabi-primary/20 flex items-center justify-center"><i class="fa-solid fa-user text-wabi-primary"></i></div>'}
                    <div class="flex-1">
                        <p class="font-medium text-wabi-text-primary">${escapeHTML(userInfo?.name || 'Google User')}</p>
                        <p class="text-xs text-wabi-text-secondary">${escapeHTML(userInfo?.email || '')}${proxyNote}</p>
                    </div>
                    <span class="text-xs px-2 py-1 bg-wabi-income/15 text-wabi-income border border-wabi-income/30 rounded-full font-medium">已連結</span>
                </div>
                <button id="sync-sign-out-btn" class="w-full py-2 text-red-500 hover:text-red-600 text-sm font-medium border border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 rounded-lg transition-colors">
                    <i class="fa-solid fa-right-from-bracket mr-1"></i> 登出 Google 帳號
                </button>
            </div>
        `
    }

    // ── 自架伺服器面板 ──
    renderSelfHostPanel({ isSelfHostMode, selfHostUsername, selfHostIsAdmin, adminUsers, registerEnabled, authMethod, hasGoogle, serverUrl }) {
        const signedInCard = `
            <div class="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <div class="w-10 h-10 rounded-full bg-wabi-primary/20 flex items-center justify-center"><i class="fa-solid fa-server text-wabi-primary"></i></div>
                <div class="flex-1">
                    <p class="font-medium text-wabi-text-primary">${escapeHTML(selfHostUsername || 'Self-Host')}</p>
                    <p class="text-xs text-wabi-text-secondary">已連接到自架同步伺服器</p>
                </div>
                <div class="flex flex-col gap-1 items-end">
                    <span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">已連結</span>
                    ${selfHostIsAdmin ? '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">管理員</span>' : ''}
                </div>
            </div>
            <button id="sync-selfhost-signout-btn" class="w-full py-2 text-red-500 text-sm font-medium border border-red-200 rounded-lg hover:bg-red-50">
                <i class="fa-solid fa-right-from-bracket mr-1"></i> 登出自架帳號
            </button>
            ${selfHostIsAdmin ? this.renderAdminPanel({ registerEnabled, adminUsers }) : ''}
        `

        const pinForm = `
            <div class="space-y-3">
                <div>
                    <label class="text-sm text-wabi-text-secondary block mb-1">帳號</label>
                    <input type="text" id="sync-selfhost-username"
                        class="w-full px-3 py-2 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary"
                        placeholder="admin" />
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary block mb-1">PIN 碼</label>
                    <input type="password" id="sync-selfhost-pin"
                        class="w-full px-3 py-2 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary"
                        placeholder="••••••••" autocomplete="off" />
                </div>
                <div class="flex gap-2">
                    <button id="sync-selfhost-login-btn" class="flex-1 py-2 bg-wabi-primary text-wabi-surface rounded-lg text-sm font-medium hover:bg-wabi-primary/90">登入</button>
                    ${registerEnabled === false
                        ? `<button id="sync-selfhost-register-btn" class="flex-1 py-2 border border-wabi-border text-wabi-text-secondary rounded-lg text-sm font-medium opacity-60 cursor-not-allowed" title="此伺服器未開放公開註冊，請管理員手動建立帳號">註冊新帳號</button>`
                        : `<button id="sync-selfhost-register-btn" class="flex-1 py-2 border border-wabi-primary text-wabi-primary rounded-lg text-sm font-medium hover:bg-wabi-primary/10">註冊新帳號</button>`}
                </div>
                ${registerEnabled === false
                    ? `<p class="text-xs text-amber-700 leading-relaxed"><i class="fa-solid fa-lock mr-1"></i>此伺服器已關閉公開註冊，請管理員在管理員面板手動建立帳號後再登入。管理方式詳見 <a href="${SELFHOST_DOCS_URL}" target="_blank" rel="noopener noreferrer" class="underline font-medium">使用說明</a>。</p>`
                    : ''}
            </div>
        `

        const googleProxyCard = `
            <div class="space-y-3">
                <div class="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p class="text-xs text-blue-800 leading-relaxed">
                        <i class="fa-solid fa-circle-info mr-1"></i>透過此自架伺服器代理 OAuth 換證，資料仍儲存於你的 Google Drive（伺服器不保留記帳資料）。
                        伺服器需設定 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，未啟用時請改用帳號 PIN 登入。
                    </p>
                </div>
                <button id="sync-selfhost-google-btn" class="w-full py-2.5 bg-wabi-surface border border-wabi-border rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center justify-center gap-2">
                    ${GOOGLE_BTN_INNER}
                </button>
            </div>
        `

        return `
            <div id="selfhost-section" class="bg-wabi-surface rounded-xl p-4 space-y-4">
                <div class="space-y-1">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-wabi-primary text-base font-bold"><i class="fa-solid fa-server mr-2"></i>自架伺服器</h3>
                        <a href="${SELFHOST_DOCS_URL}" target="_blank" rel="noopener noreferrer" class="text-xs text-wabi-primary underline shrink-0 hover:opacity-80">
                            <i class="fa-solid fa-book-open mr-1"></i>部署與使用說明
                        </a>
                    </div>
                    <p class="text-xs text-wabi-text-secondary">
                        連接到自己的同步伺服器（SQLite 儲存，不綁 Google 帳號）。部署、環境變數與帳號管理詳見
                        <a href="${SELFHOST_DOCS_URL}" target="_blank" rel="noopener noreferrer" class="underline hover:text-wabi-primary">使用說明（SELF_HOST.md）</a>。
                    </p>
                </div>

                <!-- 伺服器連線設定 -->
                <div class="space-y-2">
                    <label class="text-sm text-wabi-text-secondary">伺服器地址</label>
                    <div class="flex flex-wrap gap-2">
                        <input type="url" id="sync-server-url-input"
                            class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary"
                            value="${escapeHTML(serverUrl)}"
                            placeholder="https://your-server.example.com" />
                        <button id="sync-server-save-btn" class="px-3 py-2 bg-wabi-primary text-wabi-surface rounded-lg text-sm font-medium hover:bg-wabi-primary/90 shrink-0">
                            儲存
                        </button>
                        <button id="sync-server-reset-btn" class="px-3 py-2 bg-wabi-bg text-wabi-text-secondary rounded-lg text-sm font-medium hover:bg-wabi-bg shrink-0" title="還原預設值">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                    </div>
                    <div class="flex items-center gap-2 pt-1">
                        <button id="sync-selfhost-test-btn" class="text-xs text-wabi-text-secondary underline hover:text-wabi-primary">測試伺服器連線</button>
                        <span id="sync-selfhost-test-result" class="text-xs text-wabi-text-secondary"></span>
                    </div>
                </div>

                ${isSelfHostMode
                    ? signedInCard
                    : `
                ${hasGoogle ? `
                <div class="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p class="text-xs text-amber-800"><i class="fa-solid fa-triangle-exclamation mr-1"></i>目前已連結 Google 雲端。登入自架帳號將登出目前 Google 連結，改用自架伺服器通道。</p>
                </div>
                ` : ''}
                <!-- 登入方式選擇 -->
                <div class="space-y-2">
                    <p class="text-sm text-wabi-text-secondary">選擇登入方式</p>
                    <div class="flex gap-2">
                        <button id="sync-auth-pin"
                            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border transition-colors ${authMethod === 'pin'
                                ? 'bg-wabi-primary text-wabi-surface border-wabi-primary'
                                : 'bg-wabi-surface text-wabi-text-secondary border-wabi-border hover:border-wabi-primary'}">
                            <i class="fa-solid fa-key"></i> 伺服器帳號 PIN
                        </button>
                        <button id="sync-auth-google"
                            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border transition-colors ${authMethod === 'google'
                                ? 'bg-wabi-primary text-wabi-surface border-wabi-primary'
                                : 'bg-wabi-surface text-wabi-text-secondary border-wabi-border hover:border-wabi-primary'}">
                            <i class="fa-brands fa-google"></i> Google 帳號
                        </button>
                    </div>
                    ${authMethod === 'pin' ? pinForm : googleProxyCard}
                </div>
                `
                }
            </div>
        `
    }

    // ── 管理員帳號管理面板（自架已登入且為 admin）──
    renderAdminPanel({ registerEnabled, adminUsers }) {
        return `
            <div class="mt-4 pt-4 border-t border-wabi-border space-y-4">
                <h4 class="text-sm font-bold text-wabi-text-primary flex items-center gap-2">
                    <i class="fa-solid fa-users-gear"></i> 管理員：帳號管理
                </h4>
                <div class="flex items-center justify-between p-3 bg-wabi-bg rounded-lg border border-wabi-border">
                    <div>
                        <p class="text-sm font-medium text-wabi-text-primary">公開註冊</p>
                        <p class="text-xs text-wabi-text-secondary">開放後，任何人可直接註冊新帳號</p>
                    </div>
                    <button id="selfhost-register-toggle-btn" data-enabled="${registerEnabled ? 'true' : 'false'}" class="px-3 py-1.5 text-sm rounded-lg border font-medium ${registerEnabled
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-wabi-bg text-wabi-text-secondary border-wabi-border'}">
                        ${registerEnabled ? '已開啟' : '已關閉'}
                    </button>
                </div>
                <div class="space-y-2 p-3 bg-wabi-bg rounded-lg border border-wabi-border">
                    <p class="text-xs font-bold text-wabi-text-primary mb-2">現有帳號</p>
                    ${adminUsers.length === 0
                        ? '<p class="text-xs text-wabi-text-secondary">（載入中或無帳號）</p>'
                        : adminUsers
                              .map(
                                  u => `
                                <div class="flex items-center justify-between gap-2 py-1 border-b border-wabi-border/50 last:border-0">
                                    <span class="text-sm text-wabi-text-primary truncate">${escapeHTML(u.username)}${u.isAdmin
                                        ? ' <span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded ml-1">管理員</span>'
                                        : ''}</span>
                                    <div class="flex items-center gap-1 shrink-0">
                                        <button class="selfhost-reset-pin-btn px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded" data-username="${escapeHTML(u.username)}">重置 PIN</button>
                                        ${!u.isAdmin
                                            ? `<button class="selfhost-delete-user-btn px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded" data-username="${escapeHTML(u.username)}">刪除</button>`
                                            : ''}
                                    </div>
                                </div>`
                              )
                              .join('')}
                </div>
                <div class="space-y-2 p-3 bg-wabi-bg rounded-lg border border-wabi-border">
                    <p class="text-xs font-bold text-wabi-text-primary mb-2">手動建立帳號（不需開放公開註冊）</p>
                    <div class="flex gap-2">
                        <input type="text" id="selfhost-admin-new-username" placeholder="帳號名稱" class="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-wabi-border" />
                        <input type="text" id="selfhost-admin-new-pin" placeholder="PIN（至少 4 碼）" class="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-wabi-border" />
                        <button id="selfhost-admin-create-btn" class="px-3 py-1.5 text-sm bg-wabi-primary text-wabi-surface rounded-lg shrink-0">建立</button>
                    </div>
                </div>
            </div>
        `
    }

    // ── 備份 + 多裝置同步卡片（已登入才顯示，兩種通道共用）──
    renderSignedInCards({ isSelfHostMode, lastBackup, lastSync, autoSyncEnabled, autoBackupEnabled, backupIntervalValue }) {
        const channelName = isSelfHostMode ? '自架伺服器' : 'Google Drive'
        const retentionNote = isSelfHostMode
            ? '備份保留由伺服器管理（BACKUP_RETENTION_COUNT 環境變數，預設 100 筆）。'
            : '備份保留策略：近 7 天的備份全部保留，更早的每月僅保留一筆，超過一年的自動刪除。'
        return `
            <!-- Backup -->
            <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                <h3 class="text-wabi-primary text-base font-bold">雲端備份</h3>
                <p class="text-xs text-wabi-text-secondary">
                    上次備份：${lastBackup?.value?.timestamp ? new Date(lastBackup.value.timestamp).toLocaleString('zh-TW') : '尚未備份'}（${channelName}）
                </p>
                <div class="grid grid-cols-2 gap-3">
                    <button id="sync-backup-btn" class="py-2.5 bg-wabi-primary text-wabi-surface rounded-lg text-sm font-medium hover:bg-wabi-primary/90 flex items-center justify-center gap-1">
                        <i class="fa-solid fa-cloud-arrow-up"></i> 立即備份
                    </button>
                    <button id="sync-restore-btn" class="py-2.5 border border-wabi-primary text-wabi-primary rounded-lg text-sm font-medium hover:bg-wabi-primary/10 flex items-center justify-center gap-1">
                        <i class="fa-solid fa-cloud-arrow-down"></i> 還原備份
                    </button>
                </div>

                <!-- Auto Backup -->
                <div class="border-t border-wabi-border pt-3 space-y-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm text-wabi-text-primary">自動備份</p>
                            <p class="text-xs text-wabi-text-secondary">定期自動備份到${channelName}</p>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="sync-auto-backup-toggle" class="sr-only peer" ${autoBackupEnabled?.value ? 'checked' : ''}>
                            <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                            <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                        </label>
                    </div>
                    <div id="auto-backup-interval-container" class="${autoBackupEnabled?.value ? '' : 'hidden'}">
                        <label class="text-xs text-wabi-text-secondary mb-1 block">備份頻率</label>
                        <div class="flex gap-2">
                            <button data-interval="daily" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === 'daily' ? 'bg-wabi-primary text-wabi-surface border-wabi-primary' : 'bg-wabi-surface text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每天</button>
                            <button data-interval="3days" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === '3days' ? 'bg-wabi-primary text-wabi-surface border-wabi-primary' : 'bg-wabi-surface text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每 3 天</button>
                            <button data-interval="weekly" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === 'weekly' ? 'bg-wabi-primary text-wabi-surface border-wabi-primary' : 'bg-wabi-surface text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每週</button>
                        </div>
                    </div>
                    <p class="text-xs text-wabi-text-secondary">
                        <i class="fa-solid fa-circle-info mr-1"></i>
                        ${retentionNote}
                    </p>
                </div>
            </div>

            <!-- Multi-device Sync -->
            <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                <h3 class="text-wabi-primary text-base font-bold">多裝置同步(Beta)</h3>
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-wabi-text-primary">自動同步</p>
                        <p class="text-xs text-wabi-text-secondary">
                            上次同步：${lastSync?.value ? new Date(lastSync.value).toLocaleString('zh-TW') : '尚未同步'}
                        </p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="sync-auto-toggle" class="sr-only peer" ${autoSyncEnabled?.value ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                        <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                    </label>
                </div>
                <button id="sync-now-btn" class="w-full py-2.5 border border-wabi-border text-wabi-text-primary rounded-lg text-sm font-medium hover:bg-wabi-bg flex items-center justify-center gap-1">
                    <i class="fa-solid fa-rotate"></i> 立即同步
                </button>
                <p class="text-xs text-wabi-text-secondary">
                    裝置 ID: <code class="bg-wabi-bg px-1 rounded">${this.app.syncService.deviceId}</code>
                </p>
            </div>
        `
    }

    setupSyncSettingsListeners() {
        const ss = this.app.syncService

        // ── 頂部模式 selector ──
        const modeOfficialBtn = document.getElementById('sync-mode-official')
        if (modeOfficialBtn) {
            modeOfficialBtn.addEventListener('click', async () => {
                if (this.activeMode === 'official') return
                this.activeMode = 'official'
                await this.render()
            })
        }
        const modeSelfhostBtn = document.getElementById('sync-mode-selfhost')
        if (modeSelfhostBtn) {
            modeSelfhostBtn.addEventListener('click', async () => {
                if (this.activeMode === 'selfhost') return
                this.activeMode = 'selfhost'
                this.authMethod = this.authMethod || 'pin'
                await this.render()
            })
        }

        // ── 自架登入方式 selector（PIN / Google 代理）──
        const authPinBtn = document.getElementById('sync-auth-pin')
        if (authPinBtn) {
            authPinBtn.addEventListener('click', async () => {
                if (this.authMethod === 'pin') return
                this.authMethod = 'pin'
                await this.render()
            })
        }
        const authGoogleBtn = document.getElementById('sync-auth-google')
        if (authGoogleBtn) {
            authGoogleBtn.addEventListener('click', async () => {
                if (this.authMethod === 'google') return
                this.authMethod = 'google'
                await this.render()
            })
        }

        // ── Server URL save（自架已登入時更換地址需先登出）──
        const serverSaveBtn = document.getElementById('sync-server-save-btn')
        if (serverSaveBtn) {
            serverSaveBtn.addEventListener('click', async () => {
                const input = document.getElementById('sync-server-url-input')
                const rawUrl = input.value.trim()
                if (!rawUrl) {
                    showToast('請輸入伺服器 URL', 'error')
                    return
                }
                // 標準化比對（setServerUrl 內部會去除結尾斜線，
                // 輸入 https://foo.com/ 不應誤觸「更換伺服器」）
                const normalizedUrl = rawUrl.replace(/\/+$/, '')
                const currentUrl = ss.getServerUrl().replace(/\/+$/, '')
                // 自架已登入且變更地址 → 舊憑證將失效（401 自動登出），先主動登出避免狀態脫鉤
                if (ss.isSelfHostMode() && normalizedUrl !== currentUrl) {
                    const ok = await customConfirm(
                        '目前自架帳號已連結其他伺服器。變更伺服器地址將登出目前自架帳號，是否繼續？'
                    )
                    if (!ok) return
                    await ss.signOut()
                    showToast('已登出原自架帳號，請登入新伺服器', 'info')
                    this.activeMode = null // 登出後重新推導 selector
                }
                await ss.setServerUrl(normalizedUrl)
                showToast('伺服器 URL 已儲存', 'success')
                await this.render()
            })
        }

        // Server URL reset
        const serverResetBtn = document.getElementById('sync-server-reset-btn')
        if (serverResetBtn) {
            serverResetBtn.addEventListener('click', async () => {
                // 自架已登入時還原官方地址等同換伺服器 → 需登出（同 save 按鈕防護）。
                // 注意：不可在確認前就改寫 input.value——使用者按「取消」會留下
                // 與實際設定脫鉤的輸入框內容，後續按「儲存」會意外登出。
                const currentUrl = ss.getServerUrl().replace(/\/+$/, '')
                if (ss.isSelfHostMode() && DEFAULT_SERVER_URL !== currentUrl) {
                    const ok = await customConfirm(
                        '還原預設地址將登出目前自架帳號，是否繼續？'
                    )
                    if (!ok) return
                    await ss.signOut()
                    showToast('已登出原自架帳號，請登入新伺服器', 'info')
                    this.activeMode = null
                }
                await ss.setServerUrl(DEFAULT_SERVER_URL)
                showToast('已還原預設伺服器 URL', 'success')
                await this.render()
            })
        }

        // ── Self-Host 登入/註冊/登出/測試連線 ──
        const selfHostUsernameInput = document.getElementById(
            'sync-selfhost-username'
        )
        const selfHostPinInput = document.getElementById('sync-selfhost-pin')
        const readSelfHostCreds = () => ({
            username: selfHostUsernameInput?.value.trim() || '',
            pin: selfHostPinInput?.value || '',
        })

        const doSelfHostAuth = async (mode) => {
            const { username, pin } = readSelfHostCreds()
            if (!username || !pin) {
                showToast('請輸入帳號與 PIN 碼', 'error')
                return
            }
            const btn = document.getElementById(
                mode === 'register'
                    ? 'sync-selfhost-register-btn'
                    : 'sync-selfhost-login-btn'
            )
            btn.disabled = true
            const originalText = btn.textContent
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 處理中...'
            try {
                if (mode === 'register') {
                    await ss.selfHostRegister(username, pin)
                    showToast('自架帳號註冊成功！', 'success')
                } else {
                    await ss.selfHostLogin(username, pin)
                    showToast('自架帳號登入成功！', 'success')
                }
                await this.render()
            } catch (err) {
                console.error('Self-host auth error:', err)
                showToast(
                    (mode === 'register' ? '註冊失敗：' : '登入失敗：') +
                        err.message,
                    'error'
                )
                btn.disabled = false
                btn.textContent = originalText
            }
        }

        const selfHostLoginBtn = document.getElementById(
            'sync-selfhost-login-btn'
        )
        if (selfHostLoginBtn) {
            selfHostLoginBtn.addEventListener('click', () =>
                doSelfHostAuth('login')
            )
        }

        const selfHostRegisterBtn = document.getElementById(
            'sync-selfhost-register-btn'
        )
        if (selfHostRegisterBtn) {
            selfHostRegisterBtn.addEventListener('click', () =>
                doSelfHostAuth('register')
            )
        }

        const selfHostTestBtn = document.getElementById(
            'sync-selfhost-test-btn'
        )
        if (selfHostTestBtn) {
            selfHostTestBtn.addEventListener('click', async () => {
                const resultEl = document.getElementById(
                    'sync-selfhost-test-result'
                )
                resultEl.textContent = '測試中...'
                try {
                    // 測試「輸入框目前的值」而非已存設定，避免未先按
                    // 「儲存」就測到舊伺服器的狀態
                    const currentUrl = document
                        .getElementById('sync-server-url-input')
                        ?.value.trim()
                    const ok = await ss.selfHostCheckServer(currentUrl)
                    if (ok) {
                        resultEl.textContent = '連線成功（自架同步已啟用）'
                        resultEl.className = 'text-xs text-green-600'
                    } else {
                        resultEl.textContent = '伺服器無回應或自架同步未啟用'
                        resultEl.className = 'text-xs text-red-500'
                    }
                } catch (err) {
                    resultEl.textContent = '無法連接到伺服器'
                    resultEl.className = 'text-xs text-red-500'
                }
            })
        }

        const selfHostSignOutBtn = document.getElementById(
            'sync-selfhost-signout-btn'
        )
        if (selfHostSignOutBtn) {
            selfHostSignOutBtn.addEventListener('click', async () => {
                if (
                    !(await customConfirm(
                        '確定要登出自架帳號？這會停止自動同步。'
                    ))
                )
                    return
                await ss.signOut()
                showToast('已登出自架帳號', 'success')
                this.activeMode = null // 登出後重新推導 selector
                await this.render()
            })
        }

        // ── 自架模式 Google 代理登入 ──
        const selfHostGoogleBtn = document.getElementById(
            'sync-selfhost-google-btn'
        )
        if (selfHostGoogleBtn) {
            selfHostGoogleBtn.addEventListener('click', async () => {
                try {
                    selfHostGoogleBtn.disabled = true
                    selfHostGoogleBtn.innerHTML =
                        '<i class="fa-solid fa-spinner fa-spin"></i> 登入中...'
                    await ss.signIn()
                    showToast('Google 帳號登入成功！', 'success')
                    // Google 代理登入後 isSelfHostMode 轉為 false（走 Drive 通道），
                    // 重設 activeMode 交由 deriveActiveMode 切回官方面板顯示已登入卡
                    // 與登出入口，避免卡在自架面板呈現未登入表單＋Google 卡的矛盾。
                    this.activeMode = null
                    await this.render()
                } catch (err) {
                    console.error('Self-host Google sign in error:', err)
                    showToast(
                        'Google 登入失敗：' +
                            err.message +
                            '。若此伺服器未啟用 Google OAuth 代理（未設定 GOOGLE_CLIENT_ID），請改用「伺服器帳號 PIN」登入。',
                        'error'
                    )
                    selfHostGoogleBtn.disabled = false
                    selfHostGoogleBtn.innerHTML = GOOGLE_BTN_INNER
                }
            })
        }

        // ── 管理員：註冊開關 / 建帳號 / 重置 PIN / 刪帳號 ──
        const registerToggleBtn = document.getElementById(
            'selfhost-register-toggle-btn'
        )
        if (registerToggleBtn) {
            registerToggleBtn.addEventListener('click', async () => {
                // 以 data-enabled 判定目前狀態（不可用 textContent 比對，
                // 模板縮排換行會帶入空白導致永遠判 false）
                const registerEnabled = registerToggleBtn.dataset.enabled === 'true'
                const next = !registerEnabled
                try {
                    await ss.adminSetRegister(next)
                    showToast(
                        next ? '已開啟公開註冊' : '已關閉公開註冊',
                        'success'
                    )
                    await this.render()
                } catch (err) {
                    showToast('操作失敗：' + err.message, 'error')
                }
            })
        }

        const adminCreateBtn = document.getElementById(
            'selfhost-admin-create-btn'
        )
        if (adminCreateBtn) {
            adminCreateBtn.addEventListener('click', async () => {
                const username = document
                    .getElementById('selfhost-admin-new-username')
                    ?.value.trim()
                const pin = document
                    .getElementById('selfhost-admin-new-pin')?.value
                if (!username || !/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
                    showToast('帳號需 2-32 字元（英數字/_/-）', 'error')
                    return
                }
                if (!pin || pin.length < 4) {
                    showToast('PIN 至少 4 碼', 'error')
                    return
                }
                try {
                    adminCreateBtn.disabled = true
                    const res = await ss.adminCreateUser(
                        username,
                        pin
                    )
                    // 新 PIN 只回傳一次 → 彈出顯示（操作已完成，
                    // 用單按鈕 customAlert 而非 customConfirm，避免「取消」誤解）
                    await customAlert(
                        `帳號「${res.username}」已建立。\n\nPIN：${res.pin}\n\n請立即將 PIN 告知該使用者並改存他處（此後無法再查）。`,
                        '確認'
                    )
                    showToast('帳號已建立', 'success')
                    await this.render()
                } catch (err) {
                    showToast('建立失敗：' + err.message, 'error')
                } finally {
                    adminCreateBtn.disabled = false
                }
            })
        }

        document
            .querySelectorAll('.selfhost-reset-pin-btn')
            .forEach(btn => {
                btn.addEventListener('click', async () => {
                    const username = btn.dataset.username
                    const pin = window.prompt(
                        `為「${username}」設定新 PIN（至少 4 碼）：`
                    )
                    if (!pin || pin.length < 4) {
                        showToast('PIN 至少 4 碼', 'error')
                        return
                    }
                    try {
                        const res = await ss.adminResetPin(
                            username,
                            pin
                        )
                        // 操作已完成 → 單按鈕 customAlert 告知新 PIN
                        await customAlert(
                            `「${res.username}」的 PIN 已重置。\n\n新 PIN：${res.pin}\n\n請立即告知該使用者（舊 PIN 立即失效）。`,
                            '確認'
                        )
                        showToast('PIN 已重置', 'success')
                    } catch (err) {
                        showToast('重置失敗：' + err.message, 'error')
                    }
                })
            })

        document
            .querySelectorAll('.selfhost-delete-user-btn')
            .forEach(btn => {
                btn.addEventListener('click', async () => {
                    const username = btn.dataset.username
                    if (
                        !(await customConfirm(
                            `確定要刪除帳號「${username}」？\n\n將同時刪除該帳號的所有裝置、同步記錄與備份。此操作無法復原。`
                        ))
                    )
                        return
                    try {
                        await ss.adminDeleteUser(username)
                        showToast('帳號已刪除', 'success')
                        await this.render()
                    } catch (err) {
                        showToast('刪除失敗：' + err.message, 'error')
                    }
                })
            })

        // ── 官方模式 Google 登入/登出 ──
        const signInBtn = document.getElementById('sync-sign-in-btn')
        if (signInBtn) {
            signInBtn.addEventListener('click', async () => {
                try {
                    signInBtn.disabled = true
                    signInBtn.innerHTML =
                        '<i class="fa-solid fa-spinner fa-spin"></i> 登入中...'
                    await ss.signIn()
                    showToast('Google 帳號登入成功！', 'success')
                    await this.render()
                } catch (err) {
                    console.error('Sign in error:', err)
                    showToast('登入失敗：' + err.message, 'error')
                    signInBtn.disabled = false
                    signInBtn.innerHTML = GOOGLE_BTN_INNER
                }
            })
        }

        const signOutBtn = document.getElementById('sync-sign-out-btn')
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                if (
                    !(await customConfirm(
                        '確定要登出 Google 帳號？這會停止自動同步。'
                    ))
                )
                    return
                await ss.signOut()
                showToast('已登出 Google 帳號', 'success')
                this.activeMode = null // 登出後重新推導 selector
                await this.render()
            })
        }

        // Backup
        const backupBtn = document.getElementById('sync-backup-btn')
        if (backupBtn) {
            backupBtn.addEventListener('click', async () => {
                try {
                    backupBtn.disabled = true
                    backupBtn.innerHTML =
                        '<i class="fa-solid fa-spinner fa-spin"></i> 備份中...'
                    await ss.backupToDrive()
                    showToast('備份成功！', 'success')
                    await this.render()
                } catch (err) {
                    console.error('Backup error:', err)
                    showToast('備份失敗：' + err.message, 'error')
                    backupBtn.disabled = false
                    backupBtn.innerHTML =
                        '<i class="fa-solid fa-cloud-arrow-up"></i> 立即備份'
                }
            })
        }

        // Restore
        const restoreBtn = document.getElementById('sync-restore-btn')
        if (restoreBtn) {
            restoreBtn.addEventListener('click', async () => {
                try {
                    const backups = await ss.listBackups()
                    if (backups.length === 0) {
                        showToast('沒有找到任何備份', 'info')
                        return
                    }
                    // Show backup selection
                    const listHtml = backups
                        .map((b, _i) => {
                            const date = new Date(b.createdTime).toLocaleString(
                                'zh-TW'
                            )
                            const sizeKB = b.size
                                ? (parseInt(b.size) / 1024).toFixed(1)
                                : '?'
                            return `<button class="restore-backup-item w-full text-left p-3 hover:bg-wabi-bg rounded-lg border border-wabi-border" data-file-id="${b.id}">
                            <p class="text-sm font-medium text-wabi-text-primary">${escapeHTML(b.name)}</p>
                            <p class="text-xs text-wabi-text-secondary">${date} · ${sizeKB} KB</p>
                        </button>`
                        })
                        .join('')

                    const modal = document.createElement('div')
                    modal.className =
                        'fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in'
                    modal.innerHTML = `
                        <div class="bg-wabi-surface w-full max-w-lg rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto animate-slide-up">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-lg font-bold text-wabi-primary">選擇備份</h3>
                                <button id="close-restore-modal" class="p-2 text-wabi-text-secondary hover:text-wabi-primary">
                                    <i class="fa-solid fa-xmark text-xl"></i>
                                </button>
                            </div>
                            <div class="space-y-2">${listHtml}</div>
                        </div>
                    `
                    document.body.appendChild(modal)

                    const closeModal = (cb) => closeModalWithAnimation(modal, modal.firstElementChild, cb)

                    modal
                        .querySelector('#close-restore-modal')
                        .addEventListener('click', () => closeModal())
                    modal.addEventListener('click', e => {
                        if (e.target === modal) closeModal()
                    })

                    modal
                        .querySelectorAll('.restore-backup-item')
                        .forEach(btn => {
                            btn.addEventListener('click', async () => {
                                if (
                                    !(await customConfirm(
                                        '確定要從此備份還原？這將覆蓋目前的所有資料。'
                                    ))
                                )
                                    return
                                const fileId = btn.dataset.fileId
                                closeModal(async () => {
                                    const progressModal = showProgressModal(
                                        '雲端還原',
                                        '正在從雲端下載備份...'
                                    )
                                    progressModal.update(10, '正在從 Google Drive 下載備份...')
                                    try {
                                        const backupData =
                                            await ss.restoreFromDrive(fileId)
                                        progressModal.update(25, '正在準備還原資料...')
                                        // Use the import logic — create a temporary blob
                                        const blob = new Blob(
                                            [JSON.stringify(backupData)],
                                            {
                                                type: 'application/json',
                                            }
                                        )
                                        const file = new File(
                                            [blob],
                                            'restore.json',
                                            {
                                                type: 'application/json',
                                            }
                                        )
                                        const result =
                                            await this.app.dataService.importData(
                                                file,
                                                {
                                                    skipConfirm: true,
                                                    onProgress: (pct, msg) => {
                                                        // Map 0-100% of import to 25% - 85%
                                                        progressModal.update(25 + Math.round(pct * 0.6), msg)
                                                    }
                                                }
                                            )
                                        if (result.success) {
                                            progressModal.update(88, '正在更新同步狀態...')
                                            // Reset sync history to avoid replaying old changes
                                            await ss.markAllRemoteChangesAsPulled()
                                            progressModal.update(94, '正在重新載入系統設定...')
                                            await this.app.reloadAppData()
                                            progressModal.update(100, '備份還原成功！')
                                            setTimeout(() => {
                                                progressModal.close(() => {
                                                    showToast(
                                                        '備份還原成功！正在重新載入...',
                                                        'success'
                                                    )
                                                    this.app.currentHash = null
                                                    window.location.hash = '#home'
                                                    setTimeout(() => {
                                                        window.location.reload()
                                                    }, 300)
                                                })
                                            }, 500)
                                        } else {
                                            progressModal.close()
                                            showToast(
                                                result.message || '還原失敗',
                                                'error'
                                            )
                                        }
                                    } catch (err) {
                                        progressModal.close()
                                        showToast(
                                            '還原失敗：' + err.message,
                                            'error'
                                        )
                                    }
                                })
                            })
                        })
                } catch (err) {
                    showToast('載入備份列表失敗：' + err.message, 'error')
                }
            })
        }

        // Auto backup toggle
        const autoBackupToggle = document.getElementById(
            'sync-auto-backup-toggle'
        )
        if (autoBackupToggle) {
            autoBackupToggle.addEventListener('change', async e => {
                const enabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'sync_auto_backup_enabled',
                    value: enabled,
                })
                const intervalContainer = document.getElementById(
                    'auto-backup-interval-container'
                )
                if (enabled) {
                    const intervalSetting =
                        await this.app.dataService.getSetting(
                            'sync_auto_backup_interval'
                        )
                    const interval = intervalSetting?.value || 'daily'
                    ss.startAutoBackup(interval)
                    if (intervalContainer)
                        intervalContainer.classList.remove('hidden')
                    showToast('已啟用自動備份', 'success')
                } else {
                    ss.stopAutoBackup()
                    if (intervalContainer)
                        intervalContainer.classList.add('hidden')
                    showToast('已停用自動備份', 'info')
                }
            })
        }

        // Auto backup interval buttons
        document.querySelectorAll('.auto-backup-interval-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const interval = btn.dataset.interval
                await this.app.dataService.saveSetting({
                    key: 'sync_auto_backup_interval',
                    value: interval,
                })
                // Update button styles
                document
                    .querySelectorAll('.auto-backup-interval-btn')
                    .forEach(b => {
                        b.className = b.className.replace(
                            /bg-wabi-primary text-wabi-surface border-wabi-primary/g,
                            'bg-wabi-surface text-wabi-text-primary border-wabi-border hover:border-wabi-primary'
                        )
                    })
                btn.className = btn.className.replace(
                    /bg-wabi-surface text-wabi-text-primary border-wabi-border hover:border-wabi-primary/g,
                    'bg-wabi-primary text-wabi-surface border-wabi-primary'
                )
                // Restart auto backup with new interval
                const autoBackupSetting = await this.app.dataService.getSetting(
                    'sync_auto_backup_enabled'
                )
                if (autoBackupSetting?.value) {
                    ss.startAutoBackup(interval)
                }
                const labels = {
                    daily: '每天',
                    '3days': '每 3 天',
                    weekly: '每週',
                }
                showToast(`備份頻率已設定為${labels[interval]}`, 'success')
            })
        })

        // Auto sync toggle
        const autoSyncToggle = document.getElementById('sync-auto-toggle')
        if (autoSyncToggle) {
            autoSyncToggle.addEventListener('change', async e => {
                const enabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'sync_auto_enabled',
                    value: enabled,
                })
                if (enabled) {
                    ss.startAutoSync(24 * 60 * 60 * 1000)
                    showToast('已啟用自動同步', 'success')
                } else {
                    ss.stopAutoSync()
                    showToast('已停用自動同步', 'info')
                }
            })
        }

        // Sync now
        const syncNowBtn = document.getElementById('sync-now-btn')
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', async () => {
                try {
                    syncNowBtn.disabled = true
                    syncNowBtn.innerHTML =
                        '<i class="fa-solid fa-spinner fa-spin"></i> 同步中...'
                    await ss.performSync()
                    showToast('同步完成！', 'success')
                    await this.render()
                } catch (err) {
                    console.error('Sync error:', err)
                    showToast('同步失敗：' + err.message, 'error')
                    syncNowBtn.disabled = false
                    syncNowBtn.innerHTML =
                        '<i class="fa-solid fa-rotate"></i> 立即同步'
                }
            })
        }
    }
}

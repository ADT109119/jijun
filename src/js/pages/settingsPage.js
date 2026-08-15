import { showToast, customConfirm } from '../utils.js'
import { DARK_THEME_ID } from '../themeManager.js'

export class SettingsPage {
    constructor(app) {
        this.app = app
    }

    async render() {
        const isAndroidApk = typeof window !== 'undefined' && 
                             window.Capacitor && 
                             window.Capacitor.isNativePlatform?.() && 
                             window.Capacitor.getPlatform?.() === 'android';

        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">設定</h2>
                </div>
                <div class="p-4 space-y-6">
                    <!-- Settings -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">應用程式</h3>

                        ${this.createSettingItem('fa-solid fa-cloud-arrow-down', '強制更新', 'force-update-btn')}
                        ${this.createSettingItem('fa-solid fa-share-nodes', '分享此 App', 'share-app-btn')}
                        <div id="install-pwa-btn-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-mobile-screen-button', '安裝為應用程式', 'install-pwa-btn')}
                        </div>
                        ${this.createSettingItem('fa-solid fa-puzzle-piece', '擴充功能管理', 'manage-plugins-btn')}
                        ${this.createSettingItem('fa-solid fa-palette', '外觀主題', 'manage-themes-btn')}
                        ${isAndroidApk ? this.createSettingItem('fa-solid fa-barcode', '設定發票載具', 'set-invoice-carrier-btn') : ''}
                    
                        <!-- 深色模式快速切換 -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between border-b border-wabi-border/30">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-moon"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">深色模式</p>
                                    <p class="text-xs text-wabi-text-secondary">開啟即自動套用內建深色主題</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="dark-mode-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        
                    </div>

                    <!-- Data Management -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">資料管理</h3>
                        ${this.createSettingItem('fa-solid fa-book-bookmark', '帳本管理', 'manage-ledgers-btn')}
                        ${this.createSettingItem('fa-solid fa-cloud', '雲端備份&同步', 'cloud-sync-btn')}
                        ${this.createSettingItem('fa-solid fa-download', '匯出資料', 'export-data-btn')}
                        ${this.createSettingItem('fa-solid fa-upload', '匯入資料', 'import-data-btn')}
                        <input type="file" id="import-file-input" accept=".json" class="hidden">
                    </div>
                    <!-- App Info -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">關於</h3>
                        ${this.createSettingItem('fa-solid fa-arrows-rotate', '檢查更新', 'check-update-btn')}
                        ${this.createSettingItem('fa-solid fa-file-lines', '更新日誌', 'changelog-btn')}
                        ${this.createSettingItem('fa-solid fa-compass-drafting', '導覽教學', 'guide-tour-btn')}
                        ${this.createSettingItem('fa-solid fa-shield-halved', '隱私權政策', 'privacy-btn')}
                        ${this.createSettingItem('fa-solid fa-scale-balanced', '授權條款', 'license-btn')}
                        <a id="github-repo-link" href="https://github.com/ADT109119/jijun" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-brands fa-github"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">GitHub 儲存庫</p>
                            </div>
                            <div class="flex items-center gap-2 shrink-0">
                                <span id="github-stars" class="flex items-center gap-1 text-wabi-text-secondary text-sm">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/></svg>
                                    <span id="star-count">載入中...</span>
                                </span>
                                <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
                            </div>
                        </a>
                        <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
                        <div id="version-info" class="px-4 py-3 text-xs text-center text-wabi-text-secondary"></div>
                    </div>

                    <!-- Sponsor the Author -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">贊助作者</h3>
                        <a href="https://buymeacoffee.com/thewalkingfish" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-mug-hot"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">Buy me a Coffee</p>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </div>
                        </a>
                    </div>

                    <!-- Advanced Features -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">實驗功能</h3>
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-wallet"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">多帳戶模式</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="advanced-account-mode-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-accounts-link-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-credit-card', '帳戶管理', 'manage-accounts-btn')}
                        </div>
                        ${this.createSettingItem('fa-solid fa-repeat', '週期性交易', 'manage-recurring-btn')}
                        <!-- Amortization Management Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-chart-gantt"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">攤提/分期管理</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="amortization-management-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-amortizations-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-chart-gantt', '攤提/分期管理', 'manage-amortizations-btn')}
                        </div>
                        <!-- Debt Management Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-handshake"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">欠款管理</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="debt-management-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-debts-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-receipt', '欠款管理', 'manage-debts-btn')}
                        </div>
                        <!-- Group Management Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-layer-group"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">群組功能</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="group-management-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-groups-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-layer-group', '群組與專案管理', 'manage-groups-btn')}
                        </div>
                        <!-- AI Offline Voice Assistant Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-microchip"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">AI 離線記帳語音助手</p>
                                    <p class="text-xs text-wabi-text-secondary">使用端側 58M LLM 解析口語與語音記帳</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 shrink-0">
                                <button id="ai-model-select-btn" class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-wabi-primary/10 text-wabi-primary hover:bg-wabi-primary/20 transition-colors cursor-pointer" title="點擊設定或更新 AI 模型量化版本">
                                    <i class="fa-solid fa-layer-group text-[10px]"></i>
                                    <span id="ai-model-badge-text">Q4_0</span>
                                    <span id="ai-model-update-tag" class="hidden px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-full">新版本</span>
                                </button>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" id="ai-experimental-toggle" class="sr-only peer">
                                    <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                    <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                                </label>
                            </div>
                        </div>
                        <!-- Calculator Mode Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-calculator"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">關閉計算機功能</p>
                                    <p class="text-xs text-wabi-text-secondary">開啟後記帳小鍵盤將不顯示加減乘除與等於鍵</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="calculator-mode-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="calculator-mode-info" class="hidden px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <p class="text-xs text-wabi-text-secondary mt-2"><i class="fa-solid fa-circle-info mr-1"></i>啟用此選項後，記帳小鍵盤將隱藏 ＋、−、×、÷ 與 ＝ 按鈕，僅作為標準數字輸入鍵盤使用。</p>
                        </div>

                        <!-- Default Records Period -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-clock-rotate-left"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">明細預設時間範圍</p>
                                    <p class="text-xs text-wabi-text-secondary">進入明細頁面時的預設時間範圍</p>
                                </div>
                            </div>
                        </div>
                        <div id="default-period-container" class="px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <div class="mt-2">
                                <select id="default-period-select" class="bg-wabi-surface border border-wabi-border text-wabi-text-primary text-sm rounded-lg focus:ring-wabi-primary focus:border-wabi-primary w-full p-2 outline-none appearance-none">
                                    <option value="week">本週</option>
                                    <option value="month">本月</option>
                                    <option value="today">今天</option>
                                    <option value="last7days">近 7 天</option>
                                    <option value="last30days">近 30 天</option>
                                    <option value="last">上次時間範圍</option>
                                </select>
                            </div>
                        </div>

                        
                        <!-- Daily Reminder Feature -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 py-3 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-bell"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">每日提醒</p>
                                    <p class="text-xs text-wabi-text-secondary">定時提醒記帳</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="reminder-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="reminder-settings-container" class="hidden px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <div class="mt-4 flex items-center justify-between">
                                <label class="text-sm font-medium text-wabi-text-primary">提醒時間</label>
                                <input type="time" id="reminder-time" class="bg-wabi-surface border border-wabi-border text-wabi-text-primary text-sm rounded-lg focus:ring-wabi-primary focus:border-wabi-primary p-2 outline-none">
                            </div>
                            <div class="mt-4">
                                <label class="text-sm font-medium text-wabi-text-primary block mb-2">提醒條件</label>
                                <select id="reminder-condition" class="bg-wabi-surface border border-wabi-border text-wabi-text-primary text-sm rounded-lg focus:ring-wabi-primary focus:border-wabi-primary w-full p-2 outline-none appearance-none">
                                    <option value="always">時間到一律提醒</option>
                                    <option value="no_records">當日尚未記帳才提醒</option>
                                </select>
                            </div>
                        </div>

                        ${this.createSettingItem('fa-solid fa-rectangle-ad', '觀看廣告以移除廣告 7 天', 'sponsor-reward-ad-btn')}

                    </div>

                    <!-- Banner Ad -->
                    <div id="settings-banner-ad" class="rounded-xl overflow-hidden"></div>

                    <div class="pb-24"></div>
                </div>
            </div>
        `
        await this.setupSettingsPageListeners()
        // Add listener for plugin manager button
        const managePluginsBtn = document.getElementById('manage-plugins-btn')
        if (managePluginsBtn) {
            managePluginsBtn.addEventListener('click', () => {
                window.location.hash = '#plugins'
            })
        }
        // Themes manager button
        const manageThemesBtn = document.getElementById('manage-themes-btn')
        if (manageThemesBtn) {
            manageThemesBtn.addEventListener('click', () => {
                window.location.hash = '#themes'
            })
        }
        // Invoice Carrier setting button
        const setInvoiceCarrierBtn = document.getElementById('set-invoice-carrier-btn')
        if (setInvoiceCarrierBtn) {
            setInvoiceCarrierBtn.addEventListener('click', () => {
                const currentCarrier = localStorage.getItem('invoice_carrier_code') || ''
                this.showInputModal(
                    '設定發票載具',
                    '請輸入發票載具號碼 (例如: /ABC1234):',
                    currentCarrier,
                    async (newCarrier) => {
                        const trimmed = newCarrier.trim()
                        if (trimmed && !trimmed.startsWith('/')) {
                            showToast('發票載具必須以 / 開頭！', 'error')
                            return
                        }
                        localStorage.setItem('invoice_carrier_code', trimmed)
                        showToast('發票載具設定成功！', 'success')
                        
                        const { updateAndroidWidget } = await import('../widgetHelper.js')
                        updateAndroidWidget(this.app.dataService, this.app.budgetManager)
                    }
                )
            })
        }
        // Ledger management button
        const manageLedgersBtn = document.getElementById('manage-ledgers-btn')
        if (manageLedgersBtn) {
            manageLedgersBtn.addEventListener('click', () => {
                window.location.hash = '#ledgers'
            })
        }
        // Cloud sync button
        const cloudSyncBtn = document.getElementById('cloud-sync-btn')
        if (cloudSyncBtn) {
            cloudSyncBtn.addEventListener('click', () => {
                window.location.hash = '#sync-settings'
            })
        }
        // 贊助 - 觀看獎勵廣告以移除廣告 7 天
        const rewardAdBtn = document.getElementById('sponsor-reward-ad-btn')
        if (rewardAdBtn) {
            rewardAdBtn.addEventListener('click', async () => {
                try {
                    const granted =
                        await this.app.rewardService.showRewardedAd()
                    if (granted) {
                        this.render()
                    }
                } catch (e) {
                    console.warn('獎勵廣告流程失敗:', e)
                }
            })
        }
        // 渲染底部橫幅廣告
        this.app.rewardService
            .renderBannerAd(document.getElementById('settings-banner-ad'))
            .catch(() => {})

        // PWA install button visibility
        if (this.app.deferredInstallPrompt) {
            const installBtnContainer = document.getElementById(
                'install-pwa-btn-container'
            )
            if (installBtnContainer) {
                installBtnContainer.classList.remove('hidden')
            }
        }
    }

    createSettingItem(icon, text, id) {
        return `
            <button id="${id}" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                <div class="flex items-center gap-4">
                    <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                        <i class="${icon}"></i>
                    </div>
                    <p class="text-wabi-text-primary text-base font-normal">${text}</p>
                </div>
                <div class="shrink-0 text-wabi-text-secondary">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
            <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
        `.trim()
    }

    async setupSettingsPageListeners() {
        document
            .getElementById('export-data-btn')
            .addEventListener('click', async () => {
                // Show export options dialog
                await this.showExportOptionsModal()
            })

        const importFileInput = document.getElementById('import-file-input')
        document
            .getElementById('import-data-btn')
            .addEventListener('click', () => {
                importFileInput.click()
            })

        importFileInput.addEventListener('change', async event => {
            const file = event.target.files[0]
            if (!file) return

            this.showConfirmModal(
                '匯入資料將會覆蓋所有現有紀錄，確定要繼續嗎？',
                async () => {
                    try {
                        await this.app.dataService.importData(file)
                        showToast('資料已成功匯入！正在重整...', 'success')
                        setTimeout(() => window.location.reload(), 2000)
                    } catch (error) {
                        console.error('匯入失敗:', error)
                        showToast('資料匯入失敗', 'error')
                    }
                }
            )
            importFileInput.value = '' // Reset input
        })

        document
            .getElementById('check-update-btn')
            .addEventListener('click', () => this.checkForUpdates())
        document
            .getElementById('changelog-btn')
            .addEventListener('click', () =>
                this.app.changelogManager.showChangelogModal()
            )
        // 導覽教學：重置導引狀態並重新展示歡迎教學
        const guideTourBtn = document.getElementById('guide-tour-btn')
        if (guideTourBtn) {
            guideTourBtn.addEventListener('click', () => {
                this.app.guideManager.resetAllGuides()
                this.app.guideManager.showWelcomeModal()
            })
        }
        document.getElementById('privacy-btn').addEventListener('click', () => {
            window.location.hash = '#privacy'
        })
        document.getElementById('license-btn').addEventListener('click', () => {
            window.location.hash = '#license'
        })

        // New Listeners
        document
            .getElementById('force-update-btn')
            .addEventListener('click', () => this.forceUpdate())

        const installBtn = document.getElementById('install-pwa-btn')
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (this.app.deferredInstallPrompt) {
                    this.app.deferredInstallPrompt.prompt()
                    const { outcome } =
                        await this.app.deferredInstallPrompt.userChoice
                    console.log(
                        `User response to the install prompt: ${outcome}`
                    )
                    this.app.deferredInstallPrompt = null
                    document
                        .getElementById('install-pwa-btn-container')
                        .classList.add('hidden')
                }
            })
        }

        const shareBtn = document.getElementById('share-app-btn')
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                if (navigator.share) {
                    navigator
                        .share({
                            title: '輕鬆記帳',
                            text: '快來試試這款簡單好用的記帳 App！',
                            url: window.location.origin,
                        })
                        .then(() => console.log('Successful share'))
                        .catch(error => console.log('Error sharing', error))
                } else {
                    showToast('您的瀏覽器不支援分享功能', 'warning')
                }
            })
        }

        const versionInfo = document.getElementById('version-info')
        if (versionInfo) {
            const latestVersion = this.app.changelogManager.getAllVersions()[0]
            versionInfo.textContent = `版本 v${latestVersion.version}`
        }

        // GitHub Star 數量 (透過 GitHub API 動態取得)
        const starCount = document.getElementById('star-count')
        if (starCount) {
            fetch('https://api.github.com/repos/ADT109119/jijun')
                .then(res => res.json())
                .then(data => {
                    starCount.textContent = data.stargazers_count || 0
                })
                .catch(() => {
                    starCount.textContent = ''
                })
        }

        // 深色模式快速切換
        const darkModeToggle = document.getElementById('dark-mode-toggle')
        if (darkModeToggle) {
            // 標記目前是否已是深色主題
            const activeSetting =
                await this.app.dataService.getSetting('activeThemeId')
            darkModeToggle.checked = activeSetting?.value === DARK_THEME_ID

            darkModeToggle.addEventListener('change', async e => {
                if (e.target.checked) {
                    // 套用深色主題
                    const darkTheme =
                        await this.app.dataService.getTheme(DARK_THEME_ID)
                    if (darkTheme) {
                        await this.app.themeManager.applyTheme(darkTheme)
                        showToast('已切換為深色模式', 'success')
                    } else {
                        showToast(
                            '深色主題沒有安裝，請先從主題商店下載',
                            'error'
                        )
                        e.target.checked = false
                    }
                } else {
                    // 切回預設亮色主題
                    await this.app.themeManager.clearTheme()
                    showToast('已切換為亮色模式', 'success')
                }
            })
        }

        const advancedModeToggle = document.getElementById(
            'advanced-account-mode-toggle'
        )
        if (advancedModeToggle) {
            this.app.dataService
                .getSetting('advancedAccountModeEnabled')
                .then(setting => {
                    const isEnabled = !!setting?.value
                    advancedModeToggle.checked = isEnabled
                    if (isEnabled) {
                        document
                            .getElementById('manage-accounts-link-container')
                            .classList.remove('hidden')
                    }
                })

            advancedModeToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'advancedAccountModeEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    await this.handleAdvancedModeActivation()
                    // 第一次開啟多帳戶模式時立即顯示功能介紹
                    if (this.app.guideManager) {
                        this.app.guideManager.showToggleTour('accounts')
                    }
                }
                showToast(
                    `多帳戶模式已${isEnabled ? '啟用' : '停用'}，將重新載入...`
                )
                setTimeout(() => window.location.reload(), 1500)
            })
        }

        const manageAccountsBtn = document.getElementById('manage-accounts-btn')
        if (manageAccountsBtn) {
            manageAccountsBtn.addEventListener('click', () => {
                window.location.hash = '#accounts'
            })
        }

        const manageRecurringBtn = document.getElementById(
            'manage-recurring-btn'
        )
        if (manageRecurringBtn) {
            manageRecurringBtn.addEventListener('click', () => {
                window.location.hash = '#recurring'
            })
        }

        // Amortization Management Toggle
        const amortizationManagementToggle = document.getElementById(
            'amortization-management-toggle'
        )
        if (amortizationManagementToggle) {
            this.app.dataService
                .getSetting('amortizationEnabled')
                .then(setting => {
                    const isEnabled = !!setting?.value
                    amortizationManagementToggle.checked = isEnabled
                    if (isEnabled) {
                        document
                            .getElementById(
                                'manage-amortizations-link-container'
                            )
                            .classList.remove('hidden')
                    }
                })

            amortizationManagementToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'amortizationEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    document
                        .getElementById('manage-amortizations-link-container')
                        .classList.remove('hidden')
                    // 第一次開啟攤提/分期時立即顯示功能介紹
                    if (this.app.guideManager) {
                        this.app.guideManager.showToggleTour('amortizations')
                    }
                } else {
                    document
                        .getElementById('manage-amortizations-link-container')
                        .classList.add('hidden')
                }
                showToast(`攤提/分期管理已${isEnabled ? '啟用' : '停用'}`)
            })
        }

        const manageAmortizationsBtn = document.getElementById(
            'manage-amortizations-btn'
        )
        if (manageAmortizationsBtn) {
            manageAmortizationsBtn.addEventListener('click', () => {
                window.location.hash = '#amortizations'
            })
        }

        // Debt Management Toggle
        const debtManagementToggle = document.getElementById(
            'debt-management-toggle'
        )
        if (debtManagementToggle) {
            this.app.dataService.getSetting('debtManagementEnabled').then(setting => {
                const isEnabled = setting ? !!setting.value : false;
                debtManagementToggle.checked = isEnabled;
                if (isEnabled) {
                    document.getElementById('manage-debts-link-container')?.classList.remove('hidden');
                } else {
                    document.getElementById('manage-debts-link-container')?.classList.add('hidden');
                }
            });

            debtManagementToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'debtManagementEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    document.getElementById('manage-debts-link-container')?.classList.remove('hidden');
                    // 第一次開啟欠款管理時立即顯示功能介紹
                    if (this.app.guideManager) {
                        this.app.guideManager.showToggleTour('debts')
                    }
                } else {
                    document.getElementById('manage-debts-link-container')?.classList.add('hidden');
                }
                showToast(`欠款管理已${isEnabled ? '啟用' : '停用'}`);
            });
        }

        // Group Management Toggle
        const groupManagementToggle = document.getElementById(
            'group-management-toggle'
        )
        if (groupManagementToggle) {
            this.app.dataService.getSetting('groupManagementEnabled').then(setting => {
                const isEnabled = setting ? !!setting.value : false;
                groupManagementToggle.checked = isEnabled;
                if (isEnabled) {
                    document.getElementById('manage-groups-link-container')?.classList.remove('hidden');
                } else {
                    document.getElementById('manage-groups-link-container')?.classList.add('hidden');
                }
            });

            groupManagementToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'groupManagementEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    document.getElementById('manage-groups-link-container')?.classList.remove('hidden');
                    // 第一次開啟群組功能時立即顯示功能介紹
                    if (this.app.guideManager) {
                        this.app.guideManager.showToggleTour('groups')
                    }
                } else {
                    document.getElementById('manage-groups-link-container')?.classList.add('hidden');
                }
                showToast(`群組功能已${isEnabled ? '啟用' : '停用'}`);
            });
        }

        // AI Experimental Feature Toggle & Model Select Button
        const aiExperimentalToggle = document.getElementById('ai-experimental-toggle')
        const aiModelSelectBtn = document.getElementById('ai-model-select-btn')
        const aiModelBadgeText = document.getElementById('ai-model-badge-text')
        const aiModelUpdateTag = document.getElementById('ai-model-update-tag')

        if (aiModelBadgeText) {
            const currentQuant = this.app.aiService.getQuantization()
            aiModelBadgeText.textContent = currentQuant.toUpperCase()
        }

        if (this.app.aiService.hasModelUpdate() && aiModelUpdateTag) {
            aiModelUpdateTag.classList.remove('hidden')
        } else if (this.app.aiService.isModelDownloaded()) {
            this.app.aiService.checkForModelUpdate().then(res => {
                if (res && res.hasUpdate && aiModelUpdateTag) {
                    aiModelUpdateTag.classList.remove('hidden')
                }
            }).catch(() => {})
        }

        if (aiModelSelectBtn) {
            aiModelSelectBtn.addEventListener('click', () => {
                this.showAIDownloadModal(aiExperimentalToggle)
            })
        }

        if (aiExperimentalToggle) {
            const isEnabled = this.app.aiService.isExperimentalEnabled()
            aiExperimentalToggle.checked = isEnabled

            aiExperimentalToggle.addEventListener('change', async e => {
                const wantEnable = e.target.checked
                if (wantEnable) {
                    if (this.app.aiService.isModelDownloaded()) {
                        this.app.aiService.setExperimentalEnabled(true)
                        if (this.app.updateNavAddIcon) this.app.updateNavAddIcon()
                        // 第一次開啟 AI 語音記帳時立即顯示功能介紹
                        if (this.app.guideManager) {
                            this.app.guideManager.showToggleTour('ai')
                        }
                        showToast('已開啟 AI 離線記帳語音助手', 'success')
                    } else {
                        e.target.checked = false // Wait for modal completion
                        this.showAIDownloadModal(aiExperimentalToggle)
                    }
                } else {
                    this.app.aiService.setExperimentalEnabled(false)
                    if (this.app.updateNavAddIcon) this.app.updateNavAddIcon()

                    const shouldDeleteModel = await customConfirm(
                        '已關閉 AI 離線記帳助手。請問是否一併刪除已下載的 AI 模型檔案以釋放裝置儲存空間？',
                        '刪除模型檔案確認'
                    )

                    if (shouldDeleteModel) {
                        await this.app.aiService.deleteModel()
                        if (aiModelUpdateTag) aiModelUpdateTag.classList.add('hidden')
                        showToast('已關閉 AI 助手並刪除離線模型檔案', 'info')
                    } else {
                        showToast('已關閉 AI 助手（保留離線模型檔）', 'info')
                    }
                }
            })
        }

        const manageDebtsBtn = document.getElementById('manage-debts-btn')
        if (manageDebtsBtn) {
            manageDebtsBtn.addEventListener('click', () => {
                window.location.hash = '#debts'
            })
        }

        const manageGroupsBtn = document.getElementById('manage-groups-btn')
        if (manageGroupsBtn) {
            manageGroupsBtn.addEventListener('click', () => {
                window.location.hash = '#groups'
            })
        }

        // Calculator Mode Toggle
        const calculatorModeToggle = document.getElementById(
            'calculator-mode-toggle'
        )
        if (calculatorModeToggle) {
            this.app.dataService
                .getSetting('calculatorModeEnabled')
                .then(setting => {
                    const isEnabled = setting ? !!setting.value : true // 預設為 true (開啟)
                    calculatorModeToggle.checked = !isEnabled // 關閉按鈕勾選代表 disabled (!isEnabled)
                    if (!isEnabled) {
                        document
                            .getElementById('calculator-mode-info')
                            ?.classList.remove('hidden')
                    }
                })

            calculatorModeToggle.addEventListener('change', async e => {
                const isDisabled = e.target.checked // 勾選 = 關閉
                const isEnabled = !isDisabled
                await this.app.dataService.saveSetting({
                    key: 'calculatorModeEnabled',
                    value: isEnabled,
                })
                if (isDisabled) {
                    document
                        .getElementById('calculator-mode-info')
                        ?.classList.remove('hidden')
                } else {
                    document
                        .getElementById('calculator-mode-info')
                        ?.classList.add('hidden')
                }
                showToast(`小鍵盤計算機模式已${isEnabled ? '啟用' : '停用'}`)
            })
        }

        // Default Records Period Setting
        const defaultPeriodSelect = document.getElementById(
            'default-period-select'
        )
        if (defaultPeriodSelect) {
            this.app.dataService
                .getSetting('defaultRecordsPeriod')
                .then(setting => {
                    const periodValue = setting?.value || 'month'
                    defaultPeriodSelect.value = periodValue
                })

            defaultPeriodSelect.addEventListener('change', async e => {
                await this.app.dataService.saveSetting({
                    key: 'defaultRecordsPeriod',
                    value: e.target.value,
                })
                showToast('已設定明細預設時間範圍')
            })
        }

        // Daily Reminder UI Setup
        const reminderToggle = document.getElementById('reminder-toggle')
        const reminderSettingsContainer = document.getElementById(
            'reminder-settings-container'
        )
        const reminderTimeInput = document.getElementById('reminder-time')
        const reminderConditionSelect =
            document.getElementById('reminder-condition')

        if (reminderToggle) {
            Promise.all([
                this.app.dataService.getSetting('reminderEnabled'),
                this.app.dataService.getSetting('reminderTime'),
                this.app.dataService.getSetting('reminderCondition'),
            ]).then(([enabledSetting, timeSetting, conditionSetting]) => {
                const isEnabled = !!enabledSetting?.value
                reminderToggle.checked = isEnabled
                reminderTimeInput.value = timeSetting?.value || '20:00'
                reminderConditionSelect.value =
                    conditionSetting?.value || 'no_records'

                if (isEnabled) {
                    reminderSettingsContainer.classList.remove('hidden')
                }
            })

            const updateReminderLogic = async () => {
                const isEnabled = reminderToggle.checked
                const timeStr = reminderTimeInput.value || '20:00'
                const condition = reminderConditionSelect.value || 'always'

                await this.app.dataService.saveSetting({
                    key: 'reminderEnabled',
                    value: isEnabled,
                })
                await this.app.dataService.saveSetting({
                    key: 'reminderTime',
                    value: timeStr,
                })
                await this.app.dataService.saveSetting({
                    key: 'reminderCondition',
                    value: condition,
                })

                if (isEnabled) {
                    const hasPerm =
                        await this.app.notificationService.requestPermission()
                    if (!hasPerm) {
                        showToast('請允許通知權限以使用此功能', 'warning')
                        reminderToggle.checked = false
                        reminderSettingsContainer.classList.add('hidden')
                        await this.app.dataService.saveSetting({
                            key: 'reminderEnabled',
                            value: false,
                        })
                        return
                    }
                }

                await this.app.notificationService.applyCurrentSettings()
            }

            reminderToggle.addEventListener('change', e => {
                if (e.target.checked) {
                    reminderSettingsContainer.classList.remove('hidden')
                } else {
                    reminderSettingsContainer.classList.add('hidden')
                }
                updateReminderLogic()
            })

            reminderTimeInput.addEventListener('change', updateReminderLogic)
            reminderConditionSelect.addEventListener(
                'change',
                updateReminderLogic
            )
        }
    }

    async showExportOptionsModal() {
        const debtEnabled = await this.app.dataService.getSetting(
            'debtManagementEnabled'
        )
        const showDebtOption = !!debtEnabled?.value
        const advancedModeEnabled = await this.app.dataService.getSetting(
            'advancedAccountModeEnabled'
        )
        const showAccountOption = !!advancedModeEnabled?.value

        const modal = document.createElement('div')
        modal.id = 'export-options-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
                <h3 class="text-lg font-bold text-wabi-primary mb-4">匯出資料選項</h3>
                <div class="space-y-3 mb-6">
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-records" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">記帳紀錄</p>
                            <p class="text-xs text-wabi-text-secondary">所有收支紀錄</p>
                        </div>
                    </label>
                    ${
                        showAccountOption
                            ? `
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-accounts" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">帳戶</p>
                            <p class="text-xs text-wabi-text-secondary">多帳戶設定及餘額</p>
                        </div>
                    </label>
                    `
                            : ''
                    }
                    ${
                        showDebtOption
                            ? `
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-debts" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">欠款資料</p>
                            <p class="text-xs text-wabi-text-secondary">聯絡人及欠款紀錄</p>
                        </div>
                    </label>
                    `
                            : ''
                    }
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-categories" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">自訂分類</p>
                            <p class="text-xs text-wabi-text-secondary">自訂的收支分類</p>
                        </div>
                    </label>
                </div>
                <div class="flex space-x-3">
                    <button id="confirm-export-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        <i class="fa-solid fa-download mr-2"></i>匯出
                    </button>
                    <button id="cancel-export-btn" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `

        document.body.appendChild(modal)

        const closeModal = () => modal.remove()

        modal
            .querySelector('#cancel-export-btn')
            .addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        modal
            .querySelector('#confirm-export-btn')
            .addEventListener('click', async () => {
                const options = {
                    includeRecords:
                        modal.querySelector('#export-records')?.checked ?? true,
                    includeAccounts:
                        modal.querySelector('#export-accounts')?.checked ??
                        true,
                    includeDebts:
                        modal.querySelector('#export-debts')?.checked ?? true,
                    includeCategories:
                        modal.querySelector('#export-categories')?.checked ??
                        true,
                }

                try {
                    await this.app.dataService.exportData(options)
                    showToast('資料已成功匯出！', 'success')
                    closeModal()
                } catch (error) {
                    console.error('匯出失敗:', error)
                    showToast('資料匯出失敗', 'error')
                }
            })
    }

    async checkForUpdates() {
        if (!('serviceWorker' in navigator)) {
            showToast('瀏覽器不支援自動更新', 'warning')
            return
        }
        const registration = await navigator.serviceWorker.getRegistration()
        if (!registration) {
            showToast('Service Worker 未註冊', 'error')
            return
        }

        showToast('正在檢查更新...')
        await registration.update()

        if (registration.waiting) {
            this.showUpdateAvailable(registration)
        } else {
            showToast('已是最新版本！', 'success')
        }
    }

    async forceUpdate() {
        this.showConfirmModal(
            '確定要強制更新嗎？這將會清除所有快取資料並重新載入 App。',
            async () => {
                showToast('強制更新中...')
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations()
                        for (const registration of registrations) {
                            await registration.unregister()
                        }
                    }
                    const keys = await caches.keys()
                    await Promise.all(keys.map(key => caches.delete(key)))
                    window.location.reload(true)
                } catch (error) {
                    console.error('強制更新失敗:', error)
                    showToast('強制更新失敗', 'error')
                }
            }
        )
    }

    showConfirmModal(message, onConfirm) {
        const modal = document.createElement('div')
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]'
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 text-center shadow-xl">
                <div class="size-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-triangle-exclamation text-2xl text-wabi-expense"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-expense mb-2">確認操作</h3>
                <p class="text-wabi-text-primary font-medium mb-6">${message}</p>
                <div class="flex space-x-3">
                    <button id="settings-confirm-ok" class="flex-1 bg-wabi-expense hover:bg-red-600 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        確定
                    </button>
                    <button id="settings-confirm-cancel" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        modal
            .querySelector('#settings-confirm-cancel')
            .addEventListener('click', () => modal.remove())
        modal
            .querySelector('#settings-confirm-ok')
            .addEventListener('click', () => {
                modal.remove()
                onConfirm()
            })
    }

    showAlertModal(
        title,
        message,
        icon = 'fa-solid fa-circle-info',
        iconColor = 'text-wabi-primary'
    ) {
        const modal = document.createElement('div')
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]'
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 text-center shadow-xl">
                <div class="size-12 bg-wabi-bg rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="${icon} text-2xl ${iconColor}"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-primary mb-2">${title}</h3>
                <p class="text-wabi-text-primary font-medium mb-6">${message}</p>
                <button id="settings-alert-ok" class="w-full bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                    我知道了
                </button>
            </div>
        `
        document.body.appendChild(modal)

        modal
            .querySelector('#settings-alert-ok')
            .addEventListener('click', () => modal.remove())
    }

    showInputModal(title, message, defaultValue, onConfirm) {
        const modal = document.createElement('div')
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]'
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 shadow-xl border border-wabi-border/30">
                <h3 class="text-lg font-bold text-wabi-primary mb-2">${title}</h3>
                <p class="text-sm text-wabi-text-secondary mb-4">${message}</p>
                <div class="mb-6">
                    <input type="text" id="settings-input-value" value="${defaultValue}" class="w-full bg-wabi-surface border border-wabi-border text-wabi-text-primary text-base rounded-lg focus:ring-2 focus:ring-wabi-primary focus:border-wabi-primary p-3 outline-none" placeholder="例如: /ABC1234">
                </div>
                <div class="flex space-x-3">
                    <button id="settings-input-ok" class="flex-1 bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        確定
                    </button>
                    <button id="settings-input-cancel" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const inputEl = modal.querySelector('#settings-input-value')
        setTimeout(() => {
            inputEl.focus()
            inputEl.select()
        }, 100)

        const handleOk = () => {
            const val = inputEl.value
            modal.remove()
            onConfirm(val)
        }

        modal
            .querySelector('#settings-input-cancel')
            .addEventListener('click', () => modal.remove())
        modal
            .querySelector('#settings-input-ok')
            .addEventListener('click', handleOk)

        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                handleOk()
            }
        })
    }

    showUpdateAvailable(registration) {
        const toast = document.getElementById('toast')
        if (!toast) return
        toast.innerHTML = `
            <span>發現新版本！</span>
            <button id="update-now-btn" class="ml-4 font-bold underline">立即更新</button>
        `
        toast.className =
            'fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg opacity-0 transition-opacity duration-300 z-[100] text-wabi-surface bg-wabi-primary toast-show'

        document
            .getElementById('update-now-btn')
            .addEventListener('click', () => {
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
                }
                toast.classList.replace('toast-show', 'toast-hide')
                // reset toast inner HTML for subsequent uses
                setTimeout(() => {
                    toast.innerHTML = '<span id="toast-message"></span>'
                }, 300)
            })
    }

    async handleAdvancedModeActivation() {
        const accounts = await this.app.dataService.getAccounts()
        let defaultAccount

        if (accounts.length === 0) {
            console.log('No accounts found, creating a default account.')
            const newAccount = {
                name: '現金',
                balance: 0,
                type: 'cash',
                icon: 'fa-solid fa-money-bill-wave',
                color: 'bg-green-500',
            }
            const newAccountId =
                await this.app.dataService.addAccount(newAccount)
            defaultAccount = await this.app.dataService.getAccount(newAccountId)
            showToast('已建立預設「現金」帳戶')
        } else {
            defaultAccount = accounts[0]
        }

        if (!defaultAccount) {
            console.error('Failed to get or create a default account.')
            return
        }

        const allRecords = await this.app.dataService.getRecords()
        const recordsToUpdate = allRecords.filter(
            r => r.accountId === undefined
        )

        if (recordsToUpdate.length > 0) {
            console.log(
                `Migrating ${recordsToUpdate.length} records to default account...`
            )
            for (const record of recordsToUpdate) {
                await this.app.dataService.updateRecord(record.id, {
                    ...record,
                    accountId: defaultAccount.id,
                })
            }
            console.log('Record migration complete.')
            showToast(`${recordsToUpdate.length} 筆舊紀錄已歸入預設帳戶`)
        }
    }

    showAIDownloadModal(toggleElement) {
        const aiService = this.app.aiService
        let activeQuant = aiService.getQuantization()
        const hasUpdate = aiService.hasModelUpdate(activeQuant)
        const isCurrentDownloaded = aiService.isModelDownloaded(activeQuant)

        const getQuantBadge = quant => {
            const downloaded = aiService.isModelDownloaded(quant)
            const isActive = (quant === activeQuant)
            if (isActive) {
                return '<span class="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md flex items-center gap-1"><i class="fa-solid fa-circle-check text-[10px]"></i> 使用中</span>'
            }
            if (downloaded) {
                return '<span class="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-md">已下載</span>'
            }
            return ''
        }

        const modal = document.createElement('div')
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in'
        modal.innerHTML = `
            <div class="bg-wabi-surface rounded-3xl p-6 max-w-md w-full border border-wabi-border shadow-2xl space-y-5 relative animate-modal-pop">
                <div class="flex items-center justify-between border-b border-wabi-border/60 pb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-wabi-accent/20 text-wabi-primary flex items-center justify-center text-xl shrink-0">
                            <i class="fa-solid fa-microchip"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-wabi-text-primary">${hasUpdate ? '更新 AI 離線記帳模型' : (isCurrentDownloaded ? '管理 AI 離線模型' : '下載 AI 離線記帳模型')}</h3>
                            <p class="text-xs text-wabi-text-secondary">使用端側輕量化 LLM，無須連網保障隱私</p>
                        </div>
                    </div>
                    <button id="close-ai-download-modal-btn" class="text-wabi-text-secondary hover:text-wabi-text-primary p-1 text-lg shrink-0 cursor-pointer" title="關閉">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                ${hasUpdate ? `
                    <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                        <i class="fa-solid fa-cloud-arrow-down text-amber-500 text-sm shrink-0"></i>
                        <div>發現新版本模型！點擊下方按鈕即可重新下載並更新至最新版。</div>
                    </div>
                ` : ''}

                <div class="text-sm text-wabi-text-primary space-y-2">
                    <p>開啟此功能需下載離線 AI 模型檔至您的裝置中。請選擇適合您的量化版本：</p>
                    <div class="space-y-2 pt-1" id="quant-options">
                        <label class="flex items-center justify-between p-3 rounded-xl border border-wabi-border hover:bg-wabi-bg/50 cursor-pointer transition-colors">
                            <div class="flex items-center gap-3">
                                <input type="radio" name="quant-choice" value="q4_0" ${activeQuant === 'q4_0' ? 'checked' : ''} class="text-wabi-primary focus:ring-wabi-primary">
                                <div>
                                    <p class="font-bold text-sm text-wabi-text-primary">Q4_0 量化版 (推薦)</p>
                                    <p class="text-xs text-wabi-text-secondary">推論極快、低記憶體消耗</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span id="badge-q4_0">${getQuantBadge('q4_0')}</span>
                                <span class="text-xs font-bold text-wabi-primary bg-wabi-primary/10 px-2 py-1 rounded-md">~35.2 MB</span>
                            </div>
                        </label>

                        <label class="flex items-center justify-between p-3 rounded-xl border border-wabi-border hover:bg-wabi-bg/50 cursor-pointer transition-colors">
                            <div class="flex items-center gap-3">
                                <input type="radio" name="quant-choice" value="q8_0" ${activeQuant === 'q8_0' ? 'checked' : ''} class="text-wabi-primary focus:ring-wabi-primary">
                                <div>
                                    <p class="font-bold text-sm text-wabi-text-primary">Q8_0 量化版</p>
                                    <p class="text-xs text-wabi-text-secondary">高精確度、對複雜語意理解佳</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span id="badge-q8_0">${getQuantBadge('q8_0')}</span>
                                <span class="text-xs font-bold text-wabi-primary bg-wabi-primary/10 px-2 py-1 rounded-md">~65.4 MB</span>
                            </div>
                        </label>

                        <label class="flex items-center justify-between p-3 rounded-xl border border-wabi-border hover:bg-wabi-bg/50 cursor-pointer transition-colors">
                            <div class="flex items-center gap-3">
                                <input type="radio" name="quant-choice" value="fp16" ${activeQuant === 'fp16' ? 'checked' : ''} class="text-wabi-primary focus:ring-wabi-primary">
                                <div>
                                    <p class="font-bold text-sm text-wabi-text-primary">FP16 全精度版</p>
                                    <p class="text-xs text-wabi-text-secondary">無損耗原生浮點精度</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span id="badge-fp16">${getQuantBadge('fp16')}</span>
                                <span class="text-xs font-bold text-wabi-primary bg-wabi-primary/10 px-2 py-1 rounded-md">~116.2 MB</span>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Download Progress Container -->
                <div id="ai-download-progress-box" class="hidden space-y-2 bg-wabi-bg/60 p-4 rounded-xl border border-wabi-border/60">
                    <div class="flex justify-between text-xs font-bold text-wabi-text-primary">
                        <span id="ai-download-status-text">正在下載模型檔案...</span>
                        <span id="ai-download-percent-text">0%</span>
                    </div>
                    <div class="w-full h-3 bg-wabi-border/60 rounded-full overflow-hidden">
                        <div id="ai-download-bar" class="h-full bg-wabi-primary transition-all duration-150" style="width: 0%"></div>
                    </div>
                    <p id="ai-download-size-text" class="text-xs text-right text-wabi-text-secondary">0.0 MB / 35.2 MB</p>
                </div>

                <div class="flex gap-3 pt-2">
                    <button id="cancel-ai-download-btn" class="flex-1 py-2.5 rounded-xl border border-wabi-border text-wabi-text-secondary font-bold text-sm hover:bg-wabi-bg transition-colors cursor-pointer">
                        取消
                    </button>
                    <button id="start-ai-download-btn" class="flex-1 py-2.5 rounded-xl bg-wabi-primary text-wabi-surface font-bold text-sm hover:opacity-90 transition-all cursor-pointer">
                        <i class="fa-solid fa-download mr-1"></i> 開始下載
                    </button>
                </div>
                <div id="re-download-container" class="hidden text-center pt-1">
                    <button id="re-download-btn" class="text-xs text-wabi-text-secondary hover:text-wabi-primary underline cursor-pointer transition-colors">
                        檔案損壞或需要重下載？點此重新下載
                    </button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const cancelBtn = modal.querySelector('#cancel-ai-download-btn')
        const closeXBtn = modal.querySelector('#close-ai-download-modal-btn')
        const startBtn = modal.querySelector('#start-ai-download-btn')
        const reDownloadContainer = modal.querySelector('#re-download-container')
        const reDownloadBtn = modal.querySelector('#re-download-btn')
        const progressBox = modal.querySelector('#ai-download-progress-box')
        const percentText = modal.querySelector('#ai-download-percent-text')
        const bar = modal.querySelector('#ai-download-bar')
        const sizeText = modal.querySelector('#ai-download-size-text')
        const quantOptions = modal.querySelector('#quant-options')

        const refreshQuantBadges = () => {
            ['q4_0', 'q8_0', 'fp16'].forEach(q => {
                const el = modal.querySelector(`#badge-${q}`)
                if (el) el.innerHTML = getQuantBadge(q)
            })
        }

        const updateBtnState = selectedQuant => {
            const downloaded = aiService.isModelDownloaded(selectedQuant)
            const modelUpdate = aiService.hasModelUpdate(selectedQuant)
            const isActive = (selectedQuant === activeQuant)

            if (modelUpdate) {
                startBtn.disabled = false
                startBtn.className = 'flex-1 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-all cursor-pointer shadow-md'
                startBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down mr-1"></i> 下載更新模型'
                if (reDownloadContainer) reDownloadContainer.classList.add('hidden')
            } else if (!downloaded) {
                startBtn.disabled = false
                startBtn.className = 'flex-1 py-2.5 rounded-xl bg-wabi-primary text-wabi-surface font-bold text-sm hover:opacity-90 transition-all cursor-pointer shadow-md'
                startBtn.innerHTML = '<i class="fa-solid fa-download mr-1"></i> 開始下載'
                if (reDownloadContainer) reDownloadContainer.classList.add('hidden')
            } else if (isActive) {
                // 已下載 且 目前作用中 (無法重複切換 -> disabled、變淡、打勾標示)
                startBtn.disabled = true
                startBtn.className = 'flex-1 py-2.5 rounded-xl bg-wabi-primary/10 text-wabi-primary/50 font-bold text-sm cursor-not-allowed border border-wabi-primary/20 opacity-60 transition-all flex items-center justify-center gap-1.5'
                startBtn.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500 text-base"></i> 目前使用中'
                if (reDownloadContainer) reDownloadContainer.classList.remove('hidden')
            } else {
                // 已下載 且 非作用中 (可點擊切換)
                startBtn.disabled = false
                startBtn.className = 'flex-1 py-2.5 rounded-xl bg-wabi-primary text-wabi-surface font-bold text-sm hover:opacity-90 transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5'
                startBtn.innerHTML = '<i class="fa-solid fa-right-left mr-1"></i> 切換使用此模型'
                if (reDownloadContainer) reDownloadContainer.classList.remove('hidden')
            }
        }

        updateBtnState(activeQuant)

        quantOptions.querySelectorAll('input[name="quant-choice"]').forEach(radio => {
            radio.addEventListener('change', e => {
                updateBtnState(e.target.value)
            })
        })

        const closeModal = () => {
            const card = modal.querySelector('.animate-modal-pop')
            if (card) {
                card.classList.remove('animate-modal-pop')
                card.classList.add('animate-modal-pop-down')
            }
            modal.classList.add('animate-fade-out')

            setTimeout(() => {
                modal.remove()
                if (toggleElement && !aiService.isExperimentalEnabled()) {
                    toggleElement.checked = false
                }
            }, 180)
        }

        cancelBtn.addEventListener('click', closeModal)
        if (closeXBtn) closeXBtn.addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        const executeModelDownload = async selectedQuant => {
            startBtn.disabled = true
            cancelBtn.disabled = true
            if (reDownloadBtn) reDownloadBtn.disabled = true
            if (reDownloadContainer) reDownloadContainer.classList.add('hidden')
            quantOptions.classList.add('pointer-events-none', 'opacity-60')
            progressBox.classList.remove('hidden')

            try {
                await aiService.downloadModel(selectedQuant, ({ loadedBytes, totalBytes, percent }) => {
                    const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1)
                    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1)
                    bar.style.width = `${percent}%`
                    percentText.textContent = `${percent}%`
                    sizeText.textContent = `${loadedMB} MB / ${totalMB} MB`
                })

                aiService.setQuantization(selectedQuant)
                activeQuant = selectedQuant
                aiService.setExperimentalEnabled(true)
                if (toggleElement) toggleElement.checked = true
                if (this.app.updateNavAddIcon) this.app.updateNavAddIcon()

                const badgeTextEl = document.getElementById('ai-model-badge-text')
                const updateTagEl = document.getElementById('ai-model-update-tag')
                if (badgeTextEl) badgeTextEl.textContent = selectedQuant.toUpperCase()
                if (updateTagEl) updateTagEl.classList.add('hidden')

                showToast('AI 離線記帳模型下載成功！已啟用 AI 功能', 'success')
                modal.remove()
            } catch (err) {
                console.error('模型下載失敗:', err);
                showToast('模型下載失敗: ' + err.message, 'error')
                closeModal()
            }
        }

        startBtn.addEventListener('click', async () => {
            const selectedRadio = modal.querySelector('input[name="quant-choice"]:checked')
            const selectedQuant = selectedRadio ? selectedRadio.value : 'q4_0'
            const downloaded = aiService.isModelDownloaded(selectedQuant)
            const modelUpdate = aiService.hasModelUpdate(selectedQuant)

            // 若選擇的模型已下載且無更新，直接進行模型切換，無須重複下載
            if (downloaded && !modelUpdate) {
                aiService.setQuantization(selectedQuant)
                aiService.setExperimentalEnabled(true)
                activeQuant = selectedQuant

                // 更新 UI 狀態：重新整理清單 Badges 並將按鈕轉為「目前使用中」(Disabled + 打勾)
                refreshQuantBadges()
                updateBtnState(selectedQuant)

                if (toggleElement) toggleElement.checked = true
                if (this.app.updateNavAddIcon) this.app.updateNavAddIcon()

                const badgeTextEl = document.getElementById('ai-model-badge-text')
                const updateTagEl = document.getElementById('ai-model-update-tag')
                if (badgeTextEl) badgeTextEl.textContent = selectedQuant.toUpperCase()
                if (updateTagEl) updateTagEl.classList.add('hidden')

                showToast(`已成功切換至 ${selectedQuant.toUpperCase()} AI 離線模型`, 'success')

                // 短暫展示切換後打勾狀態再自動關閉視窗
                setTimeout(() => {
                    closeModal()
                }, 400)
                return
            }

            await executeModelDownload(selectedQuant)
        })

        if (reDownloadBtn) {
            reDownloadBtn.addEventListener('click', async () => {
                const selectedRadio = modal.querySelector('input[name="quant-choice"]:checked')
                const selectedQuant = selectedRadio ? selectedRadio.value : 'q4_0'
                await executeModelDownload(selectedQuant)
            })
        }
    }
}

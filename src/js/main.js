import DataService from './dataService.js'
import {
    formatDateToString,
    calculateNextDueDate,
    shouldSkipDate,
    calculateAmortizationDetails,
    showToast,
    MAX_ITERATIONS,
} from './utils.js'

// 全域防護瀏覽器擴充套件引起的無害 postMessage 異步過濾錯
if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
        if (event.reason && (event.reason.message?.includes("postMessage") || event.reason.message?.includes("target origin 'null'"))) {
            event.preventDefault();
        }
    });
}
import { BudgetManager } from './budgetManager.js'
import { CategoryManager } from './categoryManager.js'
import { ChangelogManager } from './changelog.js'
import { QuickSelectManager } from './quickSelectManager.js'
import { DebtManager } from './debtManager.js'
import { GroupManager } from './groupManager.js'
import { LedgerManager } from './ledgerManager.js'
import { PluginManager } from './pluginManager.js'
import { SyncService } from './syncService.js'
import { RewardService } from './rewardService.js'
import { NotificationService } from './notificationService.js'
import { ThemeManager } from './themeManager.js'
import { AIService } from './aiService.js'
import { Router } from './router.js'
import { GuideManager } from './tourManager.js'
import { escapeHTML } from './utils.js'
import { updateAndroidWidget } from './widgetHelper.js'

import { HomePage } from './pages/homePage.js'
import { AddPage } from './pages/addPage.js'
import { SettingsPage } from './pages/settingsPage.js'
import { AccountsPage } from './pages/accountsPage.js'
import { RecurringPage } from './pages/recurringPage.js'
import { SyncSettingsPage } from './pages/syncSettingsPage.js'
import { PluginsPage } from './pages/pluginsPage.js'
import { RecordsPage } from './pages/recordsPage.js'
import { StatsPage } from './pages/statsPage.js'
import { ComparisonPage } from './pages/comparisonPage.js'
import { DebtsPage } from './pages/debtsPage.js'
import { ContactsPage } from './pages/contactsPage.js'
import { LedgersPage } from './pages/ledgersPage.js'
import { GroupsPage } from './pages/groupsPage.js'
import { AmortizationsPage } from './pages/amortizationsPage.js'
import { StorePage } from './pages/storePage.js'
import { ThemesPage } from './pages/themesPage.js'
import { ThemeStorePage } from './pages/themeStorePage.js'
import { PrivacyPage } from './pages/privacyPage.js'
import { LicensePage } from './pages/licensePage.js'

export class EasyAccountingApp {
    constructor() {
        const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNative) {
            document.body.classList.add('is-capacitor-native');
        }

        this.dataService = new DataService()
        this.aiService = new AIService(this.dataService)
        this.categoryManager = new CategoryManager(this.dataService)
        this.changelogManager = new ChangelogManager()
        // 為導覽系統提供 app 引用（Phase 5 版本導覽：Changelog 關閉後串列觸發）
        this.changelogManager.app = this
        this.budgetManager = new BudgetManager(
            this.dataService,
            this.categoryManager
        )
        this.quickSelectManager = new QuickSelectManager()
        this.debtManager = new DebtManager(this.dataService, this)
        this.groupManager = new GroupManager(this.dataService, this)
        this.ledgerManager = new LedgerManager(this.dataService, this)
        this.pluginManager = new PluginManager(this.dataService, this)
        this.syncService = new SyncService(this.dataService)
        this.rewardService = new RewardService()
        this.notificationService = new NotificationService(this.dataService)
        this.themeManager = new ThemeManager(this.dataService)
        this.guideManager = new GuideManager(this)

        this.appContainer = document.getElementById('app-container')

        this.currentHash = null
        this.deferredInstallPrompt = null

        this.router = new Router(this)

        // Catch the beforeinstallprompt event early, before any async init logic
        window.addEventListener('beforeinstallprompt', e => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault()
            // Stash the event so it can be triggered later.
            this.deferredInstallPrompt = e
            // Update UI to notify the user they can install the PWA if they are on settings page
            const installBtnContainer = document.getElementById(
                'install-pwa-btn-container'
            )
            if (installBtnContainer) {
                installBtnContainer.classList.remove('hidden')
            }
        })

        this.init()
    }

    async init() {
        // 請求瀏覽器將本站的儲存（IndexedDB/localStorage）標記為「持久化」，
        // 大幅降低 Chromium/Brave 在磁碟空間不足時自動清除（eviction）的機率。
        // 失敗不阻擋啟動（部分瀏覽器會要求用戶手動點擊授權）。
        this._requestStoragePersistence()

        // DB 初始化失敗時不再靜默繼續：顯示明確的警示畫面。
        // 舊版 init 永不拋錯（全部 catch 掉），DB 壞了用戶看到的是空 app，
        // 誤以為「更新後資料全部消失」。
        try {
            await this.dataService.init()
        } catch (error) {
            console.error('App init 失敗：資料庫無法初始化', error)
            this.showInitFailureScreen(error)
            return
        }

        // 啟動時執行欠款紀錄完整性檢查：修復因操作中斷（如結清/收款途中關閉應用）
        // 而殘留的「付款已記錄、對應記帳紀錄卻未建立」的資料。
        // 目前每次啟動都檢查；未來版本可改為僅在特定 DB 版本升級時執行。
        try {
            const needsRepair = await this.dataService
                .needsDebtRepair()
                .catch(() => false)
            if (needsRepair) {
                await this.runDebtIntegrityCheck()
            }
        } catch (e) {
            console.error('欠款紀錄完整性檢查失敗:', e)
        }

        // 並行初始化無相依關係的核心模組與服務
        await Promise.all([
            this.themeManager.init(),
            this.categoryManager.init(),
            this.budgetManager.loadBudget(),
            this.ledgerManager.init(),
            this.pluginManager.init(),
            this.syncService.init(),
            this.notificationService.init(),
        ])

        const advancedModeSetting = await this.dataService.getSetting(
            'advancedAccountModeEnabled'
        )
        this.advancedModeEnabled = !!advancedModeSetting?.value
        if (this.advancedModeEnabled) {
            this.accounts = await this.dataService.getAccounts()
        } else {
            this.accounts = []
        }

        this.registerServiceWorker()
        this.setupOfflineBanner()

        // Hide install button if already in standalone mode
        if (window.matchMedia('(display-mode: standalone)').matches) {
            const installBtnContainer = document.getElementById(
                'install-pwa-btn-container'
            )
            if (installBtnContainer) {
                installBtnContainer.classList.add('hidden')
            }
        }

        this.processRecurringTransactions()
        this.processAmortizations()
        this.processCreditCardStatements()
        this._setupCreditAutoPayScheduler()

        // 檢查版本升級並自動彈出最新 Changelog Modal
        this.changelogManager.checkAndShowVersionUpdateModal()

        // 導覽功能：#U08 初次開啟歡迎 Modal / 版本更新新導覽
        // 使用 changelog 列表中真正的最新版本（而非構造器緩存的舊版本號）
        const latestVersion =
            this.changelogManager.getAllVersions()[0]?.version ||
            this.changelogManager.currentVersion
        this.guideManager.init(latestVersion)

        // Connect DataService hooks to PluginManager & NotificationService
        this.dataService.setHookProvider(async (hookName, payload) => {
            if (hookName === 'afterAddRecord') {
                this.notificationService.handleRecordAdded()
            }
            return await this.pluginManager.triggerHook(hookName, payload)
        })

        // Setup sidebar ledger switcher
        this.updateSidebarLedger()
        const ledgerSwitcherBtn = document.getElementById(
            'sidebar-ledger-switcher'
        )
        if (ledgerSwitcherBtn) {
            ledgerSwitcherBtn.addEventListener('click', () =>
                this.showLedgerSwitcherPopup()
            )
        }

        // Setup sidebar version info
        const sidebarVersionInfo = document.getElementById(
            'sidebar-version-info'
        )
        if (sidebarVersionInfo) {
            const latestVersion = this.changelogManager.getAllVersions()[0]
            sidebarVersionInfo.textContent = `版本 v${latestVersion.version}`
        }

        // Register Routes
        this.router.register('home', new HomePage(this))
        this.router.register('records', new RecordsPage(this))
        this.router.register('add', new AddPage(this))
        this.router.register('stats', new StatsPage(this))
        this.router.register('settings', new SettingsPage(this))
        this.router.register('accounts', new AccountsPage(this))
        this.router.register('recurring', new RecurringPage(this))
        this.router.register('debts', new DebtsPage(this))
        this.router.register('groups', new GroupsPage(this))
        this.router.register('contacts', new ContactsPage(this))
        this.router.register('ledgers', new LedgersPage(this))
        this.router.register('amortizations', new AmortizationsPage(this))
        this.router.register('plugins', new PluginsPage(this))
        this.router.register('store', new StorePage(this))
        this.router.register('themes', new ThemesPage(this))
        this.router.register('theme-store', new ThemeStorePage(this))
        this.router.register('sync-settings', new SyncSettingsPage(this))
        this.router.register('privacy', new PrivacyPage(this))
        this.router.register('license', new LicensePage(this))
        this.router.register('comparison', new ComparisonPage(this))

        // Check for PWA Share Target parameters
        const urlParams = new URLSearchParams(window.location.search)
        const shareTitle = urlParams.get('share_title')
        const shareText = urlParams.get('share_text')
        const shareUrl = urlParams.get('share_url')

        if (shareTitle || shareText || shareUrl) {
            const combinedText = [shareTitle, shareText, shareUrl]
                .filter(Boolean)
                .join('\n')

            // Regex to extract amount from bank transaction alerts
            // Requires either prefix indicator (e.g., 消費, NT$) OR suffix indicator (元, 元整) to avoid false positives on arbitrary numbers
            let amount = ''
            const amountRegex =
                /(?:(?:消費|金額|扣款|刷卡|支付|NT\$|TWD|USD|[$￥])\s*([0-9,]+(?:\.[0-9]+)?)|([0-9,]+(?:\.[0-9]+)?)\s*(?:元|元整))/i
            const match = combinedText.match(amountRegex)
            if (match) {
                amount = (match[1] || match[2]).replace(/,/g, '')
            }

            const redirectParams = new URLSearchParams()
            if (amount) redirectParams.set('amount', amount)
            redirectParams.set('note', combinedText)

            // Clean up window history search parameters immediately to prevent refresh loop
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            )

            // Redirect router to add page with parameters
            window.location.hash = `add?${redirectParams.toString()}`
        }

        // Start Router
        this.router.init()

        // 偵測並設定 Capacitor 原生環境
        const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNative) {
            // 處理 Capacitor Android 實體返回鍵與 Deep Link
            import('@capacitor/app').then(({ App }) => {
                let lastBackTime = 0;
                App.addListener('backButton', () => {
                    const hash = window.location.hash;
                    if (!hash || hash === '#home') {
                        const now = Date.now();
                        if (now - lastBackTime < 2000) {
                            App.exitApp();
                        } else {
                            lastBackTime = now;
                            showToast('再按一次返回鍵退出應用', 'info');
                        }
                    } else {
                        const oldHash = window.location.hash;
                        window.history.back();
                        setTimeout(() => {
                            if (window.location.hash === oldHash) {
                                window.location.hash = '#home';
                            }
                        }, 100);
                    }
                });

                // 處理冷啟動 Deep Link (從 Widget 啟動)
                App.getLaunchUrl().then((launchUrlObj) => {
                    if (launchUrlObj && launchUrlObj.url) {
                        this.handleDeepLink(launchUrlObj.url);
                    }
                });

                // 處理熱啟動 Deep Link (從 Widget 喚醒)
                App.addListener('appUrlOpen', (event) => {
                    if (event && event.url) {
                        this.handleDeepLink(event.url);
                    }
                });
            });

            // 初始化時更新一次 Widget 資料
            if (['home', 'records'].includes(window.location.hash.replace('#', '') || 'home')) {
                updateAndroidWidget(this.dataService, this.budgetManager);
            }
        }

        // 每次渲染頁面完成後，同步更新 Widget 資料
        this.pluginManager.registerHook('onPageRenderAfter', (pageName) => {
            if (['home', 'records'].includes(pageName)) {
                updateAndroidWidget(this.dataService, this.budgetManager);
            }

            // 處理小工具捷徑分類自動選取
            if (pageName === 'add' && this.pendingWidgetCategory) {
                const categoryId = this.pendingWidgetCategory;
                this.pendingWidgetCategory = null; // 清除暫存
                
                // 等待 DOM 渲染完畢再點擊
                setTimeout(() => {
                    this.autoSelectCategoryOnAddPage(categoryId);
                }, 100);
            }
        });
    }

    /**
     * 處理原生 Widget 的 Deep Link 跳轉
     * @param {string} urlStr
     */
    handleDeepLink(urlStr) {
        try {
            // 解析 deep link，例如 easyaccounting://home?widget_action=quick_add&category=food
            const url = new URL(urlStr);
            if (url.protocol === 'easyaccounting:') {
                if (url.searchParams.get('widget_action') === 'quick_add') {
                    const category = url.searchParams.get('category');
                    if (category) {
                        this.pendingWidgetCategory = category;
                    }
                    window.location.hash = '#add';
                }
            }
        } catch (e) {
            console.error('Failed to parse deep link URL:', e);
        }
    }

    /**
     * 自動選取記帳頁面上的類別
     * @param {string} categoryId 
     */
    autoSelectCategoryOnAddPage(categoryId) {
        const btn = document.querySelector(`.category-button[data-category-id="${categoryId}"]`);
        if (btn) {
            btn.click();
        } else {
            console.warn(`Category button for categoryId "${categoryId}" not found.`);
        }
    }

    async processRecurringTransactions() {
        const today = formatDateToString(new Date())
        // 處理所有帳本的週期交易（不限當前帳本）
        const recurringTxs = await this.dataService.getRecurringTransactions({
            allLedgers: true,
        })

        for (const tx of recurringTxs) {
            try {
                let { nextDueDate } = tx

                let iterations = 0

                while (
                    nextDueDate &&
                    nextDueDate <= today &&
                    iterations < MAX_ITERATIONS
                ) {
                    iterations++
                    const dateToCheck = new Date(nextDueDate)

                    // Check if the date should be skipped
                    if (shouldSkipDate(dateToCheck, tx.skipRules)) {
                        // If skipped, just advance the date and continue the loop
                        nextDueDate = calculateNextDueDate(
                            nextDueDate,
                            tx.frequency,
                            tx.interval
                        )
                        continue
                    }

                    // ── 跨裝置去重：檢查該期是否已被其他裝置產生過紀錄 ──
                    // 先檢查帶有 recurringTransactionUuid 的紀錄（P01 修復）
                    let alreadyFired = false
                    if (tx.uuid) {
                        try {
                            const allRecords = await this.dataService.db.getAll(
                                'records'
                            )
                            alreadyFired = allRecords.some(
                                r =>
                                    r.recurringTransactionUuid === tx.uuid &&
                                    r.date === nextDueDate
                            )
                        } catch (_) {
                            // Fallback: 如果 db 訪問失敗，保守地跳過
                            console.warn(
                                '[Recurring] 無法檢查重複，跳過此期:',
                                tx.uuid,
                                nextDueDate
                            )
                            nextDueDate = calculateNextDueDate(
                                nextDueDate,
                                tx.frequency,
                                tx.interval
                            )
                            continue
                        }
                    }

                    // 若仍未找到，再檢查舊紀錄（無 recurringTransactionUuid，靠 date + amount + category + accountId 匹配）
                    if (!alreadyFired && !tx.uuid) {
                        // 沒有 uuid 的舊交易，無法精確去重，正常建立
                    }

                    if (alreadyFired) {
                        console.log(
                            `[Recurring] 該期已被其他裝置產生，跳過:`,
                            tx.uuid,
                            nextDueDate
                        )
                        // 仍要推進日期，避免死循環
                        nextDueDate = calculateNextDueDate(
                            nextDueDate,
                            tx.frequency,
                            tx.interval
                        )
                        continue
                    }

                    // Generate a new record for this due date（帶上正確的 ledgerId）
                    const newRecord = {
                        type: tx.type,
                        amount: tx.amount,
                        category: tx.category,
                        description: tx.description,
                        date: nextDueDate,
                        accountId: tx.accountId,
                        ledgerId: tx.ledgerId,
                        recurringTransactionUuid: tx.uuid || null,
                    }
                    await this.dataService.addRecord(newRecord)

                    // Calculate the next due date for the next iteration
                    nextDueDate = calculateNextDueDate(
                        nextDueDate,
                        tx.frequency,
                        tx.interval
                    )
                }

                if (iterations >= MAX_ITERATIONS) {
                    console.warn(
                        `週期交易「${tx.description}」迭代次數超過上限 (${MAX_ITERATIONS})，已中止`
                    )
                }

                // Update the recurring transaction with the final new due date
                if (nextDueDate !== tx.nextDueDate) {
                    await this.dataService.updateRecurringTransaction(tx.id, {
                        nextDueDate,
                    })
                }
            } catch (error) {
                console.error(
                    `處理週期交易「${tx.description || '(無名稱)'}」失敗，跳過並繼續:`,
                    error
                )
            }
        }
    }

    // ==================== 欠款紀錄完整性檢查 ====================
    // 顯示「資料轉換中，請勿關閉」的進度 Modal，並執行欠款紀錄修復。
    // 僅在 needsDebtRepair() 為 true 時由 init() 呼叫，避免無謂的 Modal 閃爍。
    async runDebtIntegrityCheck() {
        let modal = null
        let progressBar = null
        let progressText = null
        let modalShown = false

        const ensureModal = () => {
            if (modalShown) return
            modalShown = true
            modal = document.createElement('div')
            modal.className =
                'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4'
            modal.innerHTML = `
                <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 text-center">
                    <div class="mb-4">
                        <i class="fa-solid fa-arrows-rotate fa-spin text-2xl text-wabi-primary"></i>
                    </div>
                    <h3 class="text-lg font-semibold mb-2 text-wabi-primary">資料轉換中</h3>
                    <p class="text-sm text-wabi-text-secondary mb-4">正在檢查並修復欠款紀錄，請勿關閉應用程式。</p>
                    <div class="w-full bg-wabi-border rounded-full h-2.5 overflow-hidden">
                        <div id="debt-repair-progress" class="bg-wabi-primary h-2.5 rounded-full transition-all" style="width:0%"></div>
                    </div>
                    <p id="debt-repair-text" class="text-xs text-wabi-text-secondary mt-2">準備中…</p>
                </div>`
            document.body.appendChild(modal)
            progressBar = modal.querySelector('#debt-repair-progress')
            progressText = modal.querySelector('#debt-repair-text')
        }

        const onProgress = ({ current, total, repairedCount }) => {
            ensureModal()
            const pct = total > 0 ? Math.round((current / total) * 100) : 100
            if (progressBar) progressBar.style.width = `${pct}%`
            if (progressText) {
                progressText.textContent =
                    repairedCount > 0
                        ? `已修復 ${repairedCount} 筆欠款紀錄 (${current}/${total})`
                        : `檢查中 ${current}/${total}`
            }
        }

        try {
            const result = await this.dataService.repairOrphanedDebtRecords(
                onProgress
            )
            if (modal) {
                if (progressBar) progressBar.style.width = '100%'
                if (progressText) {
                    progressText.textContent =
                        result.repairedCount > 0
                            ? `已完成，修復 ${result.repairedCount} 筆欠款紀錄`
                            : '欠款紀錄檢查完成'
                }
                await new Promise(resolve =>
                    setTimeout(resolve, result.repairedCount > 0 ? 800 : 300)
                )
            }
        } finally {
            if (modal) modal.remove()
        }
    }

    // ==================== 攤提/分期自動記帳 ====================
    async processAmortizations() {
        const today = formatDateToString(new Date())
        const items = await this.dataService.getAmortizations({
            allLedgers: true,
        })

        // 預先載入所有 records，按 amortizationId 分組 — 避免迴圈內 N+1 查詢
        const allRecords = await this.dataService.getRecords({
            allLedgers: true,
        })
        const recordsByAmortId = new Map()
        for (const r of allRecords) {
            if (r.amortizationId !== null && r.amortizationId !== undefined) {
                const list = recordsByAmortId.get(r.amortizationId) || []
                list.push(r)
                recordsByAmortId.set(r.amortizationId, list)
            }
        }

        // 預先載入所有帳戶（含信用卡）— 避免迴圈內 N+1 查詢
        const allAccounts = await this.dataService.getAccounts({ allLedgers: true })
        const accountById = new Map()
        for (const a of allAccounts) accountById.set(a.id, a)

        for (const item of items) {
            try {
                if (item.status !== 'active') continue

                let { nextDueDate, completedPeriods } = item
                let iterations = 0

                while (
                    nextDueDate &&
                    nextDueDate <= today &&
                    completedPeriods < item.periods &&
                    iterations < MAX_ITERATIONS
                ) {
                    iterations++

                    // 處理最後一期的差額
                    let generateAmount = item.amountPerPeriod
                    if (
                        completedPeriods === item.periods - 1 &&
                        item.periods > 1
                    ) {
                        const principal = Math.max(
                            0,
                            item.totalAmount - (item.downPayment || 0)
                        )
                        const { exactTotalToPay } =
                            calculateAmortizationDetails(
                                principal,
                                item.periods,
                                item.interestRate || 0,
                                item.frequency,
                                item.decimalStrategy || 'round'
                            )

                        const historyRecords =
                            recordsByAmortId.get(item.id) || []
                        // upfront：轉帳對含「扣款帳戶支出 + 卡收入」兩腿，
                        // 已還金額只算卡端收入腿（避免雙重計數）
                        const paidSoFarFilter = item.chargeMode === 'upfront'
                            ? (r) => r.type === 'income'
                            : () => true
                        const actualPaidSoFar = historyRecords
                            .filter(paidSoFarFilter)
                            .reduce((sum, r) => sum + r.amount, 0)
                        const remaining = exactTotalToPay - actualPaidSoFar

                        if (item.decimalStrategy === 'keep') {
                            generateAmount = Math.max(
                                0,
                                Math.round(remaining * 100) / 100
                            )
                        } else {
                            generateAmount = Math.max(0, Math.round(remaining))
                        }
                    }

                    // 產生一筆記帳紀錄
                    if (generateAmount > 0) {
                        if (item.chargeMode === 'upfront') {
                            // 信用卡分期：每期 = 轉帳對（扣款帳戶支出 + 卡收入）
                            // 卡收入抵銷欠款 → 額度逐月釋放
                            const card = accountById.get(item.accountId)
                            const debitId =
                                card && card.autoPayAccountId
                                    ? card.autoPayAccountId
                                    : null
                            if (debitId) {
                                const periodLabel = `第 ${completedPeriods + 1}/${item.periods} 期`
                                const debitRecord = {
                                    type: 'expense',
                                    category: 'transfer',
                                    amount: generateAmount,
                                    description: `${item.name} 分期扣款 (${periodLabel})`,
                                    date: nextDueDate,
                                    accountId: debitId,
                                    ledgerId: item.ledgerId,
                                    amortizationId: item.id, // 標記關聯 ID
                                }
                                const incomeRecord = {
                                    type: 'income',
                                    category: 'transfer',
                                    amount: generateAmount,
                                    description: `${item.name} 分期還款入卡 (${periodLabel})`,
                                    date: nextDueDate,
                                    accountId: item.accountId,
                                    ledgerId: item.ledgerId,
                                    amortizationId: item.id, // 標記關聯 ID
                                }
                                await this.dataService.addRecord(debitRecord, true)
                                await this.dataService.addRecord(incomeRecord, true)
                                // 同步記憶體快取：同一次執行補跑多期時，
                                // 末期差額分支才能看到本輪已記的款項（防多扣）
                                const amortRecs =
                                    recordsByAmortId.get(item.id) || []
                                amortRecs.push(debitRecord, incomeRecord)
                                recordsByAmortId.set(item.id, amortRecs)
                            }
                            // 無扣款帳戶：跳過紀錄、只推進期數（攤提頁顯示警示）
                        } else {
                            const newRecord = {
                                type: item.recordType || 'expense',
                                amount: generateAmount,
                                category: item.category,
                                description: `${item.name} (第 ${completedPeriods + 1}/${item.periods} 期)`,
                                date: nextDueDate,
                                accountId: item.accountId || undefined,
                                ledgerId: item.ledgerId,
                                amortizationId: item.id, // 標記關聯 ID
                            }

                            await this.dataService.addRecord(newRecord, true) // skipLog = true 以避免洗版
                            // 同步記憶體快取（同上：補跑多期時末期差額需看到本輪款項）
                            const amortRecs =
                                recordsByAmortId.get(item.id) || []
                            amortRecs.push(newRecord)
                            recordsByAmortId.set(item.id, amortRecs)
                        }
                    }

                    completedPeriods++

                    // 計算下一期日期
                    nextDueDate = calculateNextDueDate(
                        nextDueDate,
                        item.frequency,
                        1
                    )
                }

                // 更新攤提狀態
                if (
                    completedPeriods !== item.completedPeriods ||
                    nextDueDate !== item.nextDueDate
                ) {
                    const updates = { completedPeriods, nextDueDate }
                    if (completedPeriods >= item.periods) {
                        updates.status = 'completed'
                    }
                    await this.dataService.updateAmortization(item.id, updates)
                }
            } catch (error) {
                console.error(
                    `處理攤提「${item.name || '(無名稱)'}」失敗，跳過並繼續:`,
                    error
                )
            }
        }
    }

    // ==================== 信用卡自動出帳 ====================
    async processCreditCardStatements() {
        try {
            // 1. 自動產生到期信用卡的本期帳單
            await this.dataService.autoGenerateCreditStatements()
            // 2. 執行信用卡自動扣款繳卡費（於繳款日當天或之後自動轉帳還款）
            await this.dataService.autoPayCreditStatements()
            // 3. 自動更新所有帳單的繳款狀態 (先進先出 FIFO 沖銷)
            await this.dataService.updateCreditStatementsStatus()
        } catch (error) {
            console.error('處理信用卡自動出帳與銷帳失敗:', error)
        }
    }

    // ==================== 信用卡自動扣款後台排程 (#B05-3) ====================
    // 問題：processCreditCardStatements() 只在 app 啟動時執行一次，若用戶繳款日當天
    // 沒打開 app（或長時間保持打開跨過午夜），到期帳單無法自動扣款／沖銷。
    // 方案：在 app 開啟期間每小時檢查一次 + 頁面重新可見／獲焦時立即檢查，
    // 以「本地日期」為粒度限流（每天最多跑一次完整邏輯），保證冪等且低開銷。
    _setupCreditAutoPayScheduler() {
        // init() 已執行 processCreditCardStatements()，故將今日標記為已處理，
        // 後續 interval/事件僅負責「新的一天」與「頁面復蘇」時補跑。
        this._lastCreditAutoPayDate = this._todayStr()

        const maybeRun = () => {
            const todayStr = this._todayStr()
            if (this._lastCreditAutoPayDate === todayStr) return
            this._lastCreditAutoPayDate = todayStr
            this.processCreditCardStatements()
        }

        // 每小時檢查一次（覆蓋跨午夜、長時間後台運行場景）
        if (this._creditAutoPayTimer) clearInterval(this._creditAutoPayTimer)
        this._creditAutoPayTimer = setInterval(maybeRun, 60 * 60 * 1000)

        // 頁面從後台恢復或重新獲焦時立即檢查
        this._creditAutoPayVisHandler = () => {
            if (document.visibilityState === 'visible') maybeRun()
        }
        document.addEventListener('visibilitychange', this._creditAutoPayVisHandler)
        this._creditAutoPayFocusHandler = () => maybeRun()
        window.addEventListener('focus', this._creditAutoPayFocusHandler)
    }

    _todayStr() {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    /**
     * 請求瀏覽器持久化本站儲存空間，降低 eviction 機率。
     * Chromium/Brave 在磁碟壓力下會清除「非持久化」網站的 IndexedDB；
     * persist() 成功後該網站被視為高價值，幾乎不會被自動清除。
     * 結果記錄到 this.storagePersisted，供設定頁顯示狀態。
     */
    _requestStoragePersistence() {
        const nav = typeof navigator !== 'undefined' ? navigator : null
        if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') {
            this.storagePersisted = null
            return
        }
        nav.storage
            .persist()
            .then(ok => {
                this.storagePersisted = !!ok
                console.log(
                    `[Storage] persist() = ${ok}（true 代表已標記持久化，不易被瀏覽器清除）`
                )
            })
            .catch(e => {
                this.storagePersisted = false
                console.warn('[Storage] persist() 失敗（不影響使用）:', e)
            })
    }

    /**
     * 資料庫初始化失敗時的警示畫面。
     * 取代舊版「靜默降級 → 空 app」的體驗：明確告知用戶資料可能還在、
     * 提供重新載入與（若有）備份還原指引，而不是讓用戶以為資料被清掉了。
     */
    showInitFailureScreen(error) {
        const diagnostics =
            (this.dataService && this.dataService.initDiagnostics) || null
        const detail =
            (diagnostics && diagnostics.error) ||
            (error && error.message) ||
            '未知錯誤'
        const blocked =
            diagnostics && diagnostics.blocked
            ? '目前升級被其他分頁鎖定，請關閉所有分頁後重新載入。'
            : ''

        const skeleton = document.getElementById('skeleton-screen')
        if (skeleton) skeleton.style.display = 'none'

        const existing = document.getElementById('init-failure-screen')
        if (existing) existing.remove()

        const el = document.createElement('div')
        el.id = 'init-failure-screen'
        el.className =
            'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6'
        el.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center" role="alertdialog" aria-live="assertive">
                <div class="mx-auto mb-3 h-12 w-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-2xl font-bold">!</div>
                <h2 class="text-xl font-bold mb-2">資料載入失敗</h2>
                <p class="text-sm text-gray-600 mb-1">
                    應用程式無法開啟資料庫。你的資料<strong>可能仍然存在</strong>於裝置中，
                    通常重新載入即可恢復。
                </p>
                <p class="text-xs text-gray-500 mb-4 break-words">${blocked}</p>
                <p class="text-xs text-gray-400 mb-5 font-mono break-words">${detail}</p>
                <div class="flex gap-3 justify-center">
                    <button id="init-failure-reload"
                        class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                        重新載入
                    </button>
                </div>
                <p class="text-xs text-gray-400 mt-4">
                    若多次重新載入仍失敗，請至「設定 → 資料管理」嘗試備份還原，
                    或聯絡開發者（附上上述錯誤代號）。
                </p>
            </div>
        `
        document.body.appendChild(el)
        const btn = document.getElementById('init-failure-reload')
        if (btn) {
            btn.addEventListener('click', () => {
                if (typeof location !== 'undefined') location.reload()
            })
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration =
                    await navigator.serviceWorker.register('/serviceWorker.js')
                console.log('Service Worker registered')

                // Listen for controller change to reload the page
                let refreshing = false
                navigator.serviceWorker.addEventListener(
                    'controllerchange',
                    () => {
                        if (refreshing) return
                        refreshing = true
                        // Check if user is actively editing a form to avoid losing data
                        const activeEl = document.activeElement
                        const isEditing = activeEl && (
                            activeEl.tagName === 'INPUT' ||
                            activeEl.tagName === 'TEXTAREA' ||
                            activeEl.isContentEditable
                        )
                        if (isEditing && activeEl.value) {
                            if (confirm('應用程式有新版本可用，但您有未儲存的資料。確定要重新載入嗎？')) {
                                window.location.reload()
                            } else {
                                refreshing = false // 使用者取消，重置旗標讓下次可正常更新
                            }
                        } else {
                            window.location.reload()
                        }
                    }
                )

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing
                    newWorker.addEventListener('statechange', () => {
                        if (
                            newWorker.state === 'installed' &&
                            navigator.serviceWorker.controller
                        ) {
                            showToast('新版本可用，請重新整理頁面', 'info')
                        }
                    })
                })
            } catch (error) {
                console.error('Service Worker registration failed:', error)
            }
        }
    }

    // ==================== 離線狀態提示 ====================

    /**
     * 離線狀態列：斷網時頂部顯示細條「離線模式」，給使用者確定感
     * （本地 IndexedDB 資料安全、記帳仍可用；僅雲端同步/備份暫停）。
     * 監聽 online/offline 事件即時切換；無 emoji，依設計慣例用功能圖示。
     */
    setupOfflineBanner() {
        const update = () => {
            let banner = document.getElementById('offline-banner')
            const isOnline = navigator.onLine
            if (!isOnline && !banner) {
                banner = document.createElement('div')
                banner.id = 'offline-banner'
                banner.className =
                    'fixed top-0 left-0 right-0 z-[60] bg-amber-600 text-white text-xs text-center py-1.5 px-3 shadow-md flex items-center justify-center gap-1.5'
                banner.innerHTML =
                    '<i class="fa-solid fa-wifi fa-slash"></i><span>離線模式：資料安全存於本機，記帳照常可用（雲端同步暫停）</span>'
                document.body.prepend(banner)
            } else if (isOnline && banner) {
                banner.remove()
            }
        }
        window.addEventListener('online', update)
        window.addEventListener('offline', update)
        update()
    }

    // ==================== 帳本切換器 ====================

    /** 更新側邊欄帳本顯示 */
    updateSidebarLedger() {
        const ledger = this.ledgerManager.getActiveLedger()
        if (!ledger) return
        const iconEl = document.getElementById('sidebar-ledger-icon')
        const nameEl = document.getElementById('sidebar-ledger-name')
        if (iconEl) {
            // Use CSS custom property so theme system can override the ledger color
            iconEl.style.setProperty('--ledger-color', ledger.color || '#334A52')
            iconEl.style.backgroundColor = 'var(--ledger-color)'
            const safeIcon = /^fa-(solid|regular|brands)\s+fa-[a-zA-Z0-9-]+$/.test(
                ledger.icon
            )
                ? ledger.icon
                : 'fa-solid fa-book'
            iconEl.innerHTML = `<i class="${safeIcon}"></i>`
        }
        if (nameEl) nameEl.textContent = ledger.name
    }

    /** 顯示帳本切換彈窗 */
    showLedgerSwitcherPopup() {
        // 移除已存在的彈窗
        document.getElementById('ledger-switcher-popup')?.remove()

        const ledgers = this.ledgerManager.getAllLedgers()
        const activeLedgerId = this.dataService.activeLedgerId

        const popup = document.createElement('div')
        popup.id = 'ledger-switcher-popup'
        popup.className =
            'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-[2px]'
        popup.innerHTML = `
            <div class="bg-wabi-bg rounded-xl max-w-xs w-full shadow-xl overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-wabi-border">
                    <h3 class="font-bold text-wabi-primary">切換帳本</h3>
                    <button id="close-ledger-popup" class="text-wabi-text-secondary hover:text-wabi-primary p-1">
                        <i class="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>
                <div class="max-h-64 overflow-y-auto p-2 space-y-1">
                    ${ledgers
                        .map(
                            l => `
                        <button class="ledger-switch-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                            ${l.id === activeLedgerId ? 'bg-wabi-primary/10 border border-wabi-primary/30' : 'hover:bg-wabi-bg border border-transparent'}"
                            data-id="${l.id}">
                            <div class="flex items-center justify-center rounded-lg text-white shrink-0 size-9 text-sm shadow-sm" style="background-color: ${/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(l.color) ? l.color : '#334A52'}">
                                <i class="${/^fa-(solid|regular|brands)\s+fa-[a-zA-Z0-9-]+$/.test(l.icon) ? l.icon : 'fa-solid fa-book'}"></i>
                            </div>
                            <div class="flex-1 min-w-0 text-left flex flex-col justify-center">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-sm font-medium text-wabi-text-primary truncate">${escapeHTML(l.name)}</span>
                                    ${l.isShared || l.type === 'shared' ? '<span class="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded flex items-center shrink-0" title="共用帳本"><i class="fa-solid fa-users mr-1"></i>共用</span>' : ''}
                                </div>
                            </div>
                            ${l.id === activeLedgerId ? '<i class="fa-solid fa-check text-wabi-primary text-sm shrink-0"></i>' : ''}
                        </button>
                    `
                        )
                        .join('')}
                </div>
                <div class="border-t border-wabi-border p-2">
                    <a href="#ledgers" id="manage-ledgers-link" class="flex items-center justify-center gap-2 py-2 text-sm text-wabi-primary hover:bg-wabi-primary/5 rounded-lg transition-colors">
                        <i class="fa-solid fa-gear text-xs"></i> 管理帳本
                    </a>
                </div>
            </div>
        `
        document.body.appendChild(popup)

        // 關閉
        const close = () => popup.remove()
        popup
            .querySelector('#close-ledger-popup')
            .addEventListener('click', close)
        popup.addEventListener('click', e => {
            if (e.target === popup) close()
        })
        popup
            .querySelector('#manage-ledgers-link')
            .addEventListener('click', close)

        // 切換帳本
        popup.querySelectorAll('.ledger-switch-item').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id)
                if (id === activeLedgerId) {
                    close()
                    return
                }
                close()
                await this.ledgerManager.switchLedger(id)
                this.updateSidebarLedger()
            })
        })
    }

    /**
     * 動態切換底部工作列中央新增按鈕之圖標 (AI 實驗功能開啟時切換為麥克風，編輯模式/關閉時為加號)
     * @param {boolean} [isEditMode=false]
     */
    updateNavAddIcon(isEditMode = false) {
        const navAddIcon = document.getElementById('nav-add-icon')
        if (!navAddIcon) return

        const currentHash = window.location.hash || '#home'
        const isEditUrl = currentHash.includes('editRecordId=')
        const isAddPage = (currentHash === '#add' || currentHash.startsWith('#add')) && !isEditUrl
        const isAiEnabled = this.aiService ? this.aiService.isExperimentalEnabled() : false

        if (isAddPage && isAiEnabled && !isEditMode) {
            navAddIcon.className = 'fa-solid fa-microphone text-2xl md:text-xl'
        } else {
            navAddIcon.className = 'fa-solid fa-plus text-2xl md:text-xl'
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new EasyAccountingApp()
})

import DataService from './dataService.js'
import { getCategoryName, getCategoryIcon } from './categories.js'
import {
  formatCurrency,
  formatDate,
  showToast,
  getDateRange,
  formatDateToString,
  getMonthRange,
  calculateNextDueDate,
  shouldSkipDate,
} from './utils.js'
import { StatisticsManager } from './statistics.js'
import { RecordsListManager } from './recordsList.js'
import { BudgetManager } from './budgetManager.js'
import { CategoryManager } from './categoryManager.js'
import { ChangelogManager } from './changelog.js'
import { QuickSelectManager } from './quickSelectManager.js'
import { DebtManager } from './debtManager.js'
import { PluginManager } from './pluginManager.js'
import { SyncService } from './syncService.js'
import { AdService } from './adService.js'

class EasyAccountingApp {
  constructor() {
    this.dataService = new DataService()
    this.categoryManager = new CategoryManager()
    this.changelogManager = new ChangelogManager()
    this.budgetManager = new BudgetManager(
      this.dataService,
      this.categoryManager
    )
    this.quickSelectManager = new QuickSelectManager()
    this.quickSelectManager = new QuickSelectManager()
    this.debtManager = new DebtManager(this.dataService)
    this.pluginManager = new PluginManager(this.dataService, this)
    this.syncService = new SyncService(this.dataService)
    this.adService = new AdService()

    this.appContainer = document.getElementById('app-container')
    this.navItems = document.querySelectorAll('.nav-item')
    this.bottomNav = document.getElementById('bottom-nav')

    this.currentHash = null
    this.currentChart = null
    this.deferredInstallPrompt = null

    this.init()
  }

  async init() {
    await this.dataService.init()

    const advancedModeSetting = await this.dataService.getSetting(
      'advancedAccountModeEnabled'
    )
    this.advancedModeEnabled = !!advancedModeSetting?.value
    if (this.advancedModeEnabled) {
      this.accounts = await this.dataService.getAccounts()
    } else {
      this.accounts = []
    }

    this.setupEventListeners()
    // this.handleRouteChange(); // Moved to after plugin init
    this.registerServiceWorker()

    window.addEventListener('beforeinstallprompt', e => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault()
      // Stash the event so it can be triggered later.
      this.deferredInstallPrompt = e
      // Update UI to notify the user they can install the PWA
      const installBtnContainer = document.getElementById(
        'install-pwa-btn-container'
      )
      if (installBtnContainer) {
        installBtnContainer.classList.remove('hidden')
      }
    })

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

    // Initialize plugins
    await this.pluginManager.init()

    // Connect DataService hooks to PluginManager
    this.dataService.setHookProvider(async (hookName, payload) => {
      return await this.pluginManager.triggerHook(hookName, payload)
    })

    // Initialize sync service (restore saved tokens/settings)
    await this.syncService.init()

    // Setup sidebar version info
    const sidebarVersionInfo = document.getElementById('sidebar-version-info')
    if (sidebarVersionInfo) {
      const latestVersion = this.changelogManager.getAllVersions()[0]
      sidebarVersionInfo.textContent = `版本 v${latestVersion.version}`
    }

    // Handle initial route after plugins are loaded
    this.handleRouteChange()
  }

  async processRecurringTransactions() {
    const today = formatDateToString(new Date())
    const recurringTxs = await this.dataService.getRecurringTransactions()

    for (const tx of recurringTxs) {
      let { nextDueDate } = tx

      while (nextDueDate && nextDueDate <= today) {
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

        // Generate a new record for this due date
        const newRecord = {
          type: tx.type,
          amount: tx.amount,
          category: tx.category,
          description: tx.description,
          date: nextDueDate,
          accountId: tx.accountId,
        }
        await this.dataService.addRecord(newRecord)
        console.log(
          `Generated record for recurring transaction: ${tx.description}`
        )

        // Calculate the next due date for the next iteration
        nextDueDate = calculateNextDueDate(
          nextDueDate,
          tx.frequency,
          tx.interval
        )
      }

      // Update the recurring transaction with the final new due date
      if (nextDueDate !== tx.nextDueDate) {
        await this.dataService.updateRecurringTransaction(tx.id, {
          nextDueDate,
        })
      }
    }
  }

  setupEventListeners() {
    window.addEventListener('hashchange', () => this.handleRouteChange())
    document.addEventListener('click', e => {
      this.pluginManager.triggerHook('onPageClick', e)
    })
  }

  async handleRouteChange() {
    const hash = window.location.hash || '#home'
    if (hash === this.currentHash) return
    this.currentHash = hash

    const [page, query] = hash.substring(1).split('?')
    const params = new URLSearchParams(query)
    const recordId = params.get('id')

    this.updateActiveNavItem(page)

    // Scroll to top on page change
    window.scrollTo(0, 0)

    switch (page) {
      case 'home':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'home')
        await this.renderHomePage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'home')
        break
      case 'records':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'records')
        await this.renderRecordsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'records')
        break
      case 'add':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'add')
        await this.renderAddPage(recordId)
        await this.pluginManager.triggerHook('onPageRenderAfter', 'add')
        break
      case 'stats':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'stats')
        this.renderStatsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'stats')
        break
      case 'settings':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'settings')
        this.renderSettingsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'settings')
        break
      case 'accounts':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'accounts')
        this.renderAccountsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'accounts')
        break
      case 'recurring':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'recurring')
        this.renderRecurringPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'recurring')
        break
      case 'debts':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'debts')
        this.renderDebtsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'debts')
        break
      case 'contacts':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'contacts')
        this.renderContactsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'contacts')
        break
      case 'plugins':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'plugins')
        this.renderPluginsPage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'plugins')
        break
      case 'store':
        await this.pluginManager.triggerHook('onPageRenderBefore', 'store')
        this.renderStorePage()
        await this.pluginManager.triggerHook('onPageRenderAfter', 'store')
        break
      case 'sync-settings':
        await this.renderSyncSettingsPage()
        break
      default: {
        const customPage = this.pluginManager.getCustomPage(page)
        console.log('Routing check:', page, customPage) // Debug
        if (customPage) {
          this.appContainer.innerHTML = '' // Clear container
          try {
            await this.pluginManager.triggerHook('onPageRenderBefore', page)
            customPage.renderFn(this.appContainer)
            await this.pluginManager.triggerHook('onPageRenderAfter', page)
          } catch (e) {
            console.error('Error rendering custom page:', e)
            showToast('頁面載入失敗', 'error')
          }
        } else {
          console.warn('Route not found, redirecting to home:', page)
          window.location.hash = 'home'
        }
        break
      }
    }
  }

  updateActiveNavItem(activePage) {
    this.navItems.forEach(item => {
      if (item.dataset.page === activePage) {
        item.classList.add('active')
      } else {
        item.classList.remove('active')
      }
    })
  }

  // --- Page Renderers ---

  async renderHomePage() {
    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <button id="home-month-selector-btn" class="text-2xl font-bold text-wabi-primary bg-transparent border-0 focus:ring-0 flex items-center gap-2">
                        <span id="home-month-display"></span>
                        <i class="fa-solid fa-chevron-down text-base"></i>
                    </button>
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-gear text-xl"></i>
                    </a>
                </div>

                <!-- Balance Card -->
                <div class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8">
                    <p class="text-center text-wabi-text-secondary text-base font-medium">本月結餘</p>
                    <p id="home-balance" class="text-center text-wabi-primary text-4xl font-bold tracking-tight mt-1">$0</p>
                    <div class="flex justify-around pt-6 mt-4 border-t border-wabi-border">
                        <div class="text-center">
                            <p class="text-sm text-wabi-text-secondary">總收入</p>
                            <p id="home-income" class="text-lg font-bold text-wabi-income">$0</p>
                        </div>
                        <div class="text-center">
                            <p class="text-sm text-wabi-text-secondary">總支出</p>
                            <p id="home-expense" class="text-lg font-bold text-wabi-expense">$0</p>
                        </div>
                    </div>
                </div>

                <!-- Budget Widget -->
                <div id="budget-widget-container"></div>

                <!-- Plugin Widgets -->
                <div class="flex items-center justify-between mb-2 mt-6">
                     <h3 class="text-sm font-bold text-wabi-text-secondary">小工具</h3>
                     <button id="manage-widgets-btn" class="text-xs text-wabi-primary hover:underline bg-wabi-primary/10 px-2 py-1 rounded">
                        <i class="fa-solid fa-sort mr-1"></i>調整順序
                     </button>
                </div>
                <div id="plugin-home-widgets" class="mb-6"></div>

                <!-- Recent Transactions -->
                <div>
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-wabi-primary">最近紀錄</h3>
                        <a href="#records" class="text-sm font-medium text-wabi-accent hover:underline">查看全部</a>
                    </div>
                    <div id="recent-records-container" class="space-y-2"></div>
                </div>
            </div>
        `
    this.setupHomePageEventListeners()
    await this.populateHomeMonthFilter()
    this.pluginManager.renderHomeWidgets(
      document.getElementById('plugin-home-widgets')
    )

    // Manage Widgets Handler
    const manageWidgetsBtn = document.getElementById('manage-widgets-btn')
    if (manageWidgetsBtn) {
      manageWidgetsBtn.addEventListener('click', () =>
        this.showWidgetOrderModal()
      )
    }

    await this.loadHomePageData()
  }

  showWidgetOrderModal() {
    const modal = document.createElement('div')
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 animation-fade-in'

    const renderList = () => {
      const order = this.pluginManager.widgetOrder
      const activeWidgets = order.filter(id =>
        this.pluginManager.homeWidgets.has(id)
      )

      if (activeWidgets.length === 0)
        return '<p class="text-center text-gray-400 py-4">無可用的小工具</p>'

      return activeWidgets
        .map((id, index) => {
          const name = this.pluginManager.getPluginName(id) || '未知小工具'
          return `
                   <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2 transition-all">
                       <span class="font-medium text-gray-700">${name}</span>
                       <div class="flex gap-1">
                           <button class="p-2 text-gray-400 hover:text-wabi-primary move-widget-btn hover:bg-white rounded-md transition-colors" data-id="${id}" data-dir="-1" ${index === 0 ? 'disabled class="p-2 text-gray-200 cursor-not-allowed"' : ''}>
                                <i class="fa-solid fa-arrow-up"></i>
                           </button>
                           <button class="p-2 text-gray-400 hover:text-wabi-primary move-widget-btn hover:bg-white rounded-md transition-colors" data-id="${id}" data-dir="1" ${index === activeWidgets.length - 1 ? 'disabled class="p-2 text-gray-200 cursor-not-allowed"' : ''}>
                                <i class="fa-solid fa-arrow-down"></i>
                           </button>
                       </div>
                   </div>
                `
        })
        .join('')
    }

    const updateContent = () => {
      const listContainer = modal.querySelector('#widget-order-list')
      if (listContainer) {
        listContainer.innerHTML = renderList()
        bindEvents()
      }
    }

    modal.innerHTML = `
            <div class="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl transform transition-all scale-100 flex flex-col max-h-[80vh]">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold text-gray-800">調整顯示順序</h3>
                    <button id="close-widget-modal" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times text-xl"></i>
                    </button>
                </div>
                <div id="widget-order-list" class="overflow-y-auto flex-1 mb-4">
                    ${renderList()}
                </div>
                <div class="mt-auto pt-2 border-t border-gray-100">
                     <p class="text-xs text-center text-gray-400">點擊箭頭調整順序</p>
                </div>
            </div>
        `
    document.body.appendChild(modal)

    const close = () => {
      modal.remove()
      // Re-render home widgets to reflect changes immediately
      this.pluginManager.renderHomeWidgets(
        document.getElementById('plugin-home-widgets')
      )
    }

    modal.querySelector('#close-widget-modal').addEventListener('click', close)

    const bindEvents = () => {
      modal.querySelectorAll('.move-widget-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          const id = btn.dataset.id
          const dir = parseInt(btn.dataset.dir)
          await this.pluginManager.moveWidget(id, dir)
          updateContent()
        })
      })
    }
    bindEvents()
  }

  async renderRecordsPage() {
    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center pb-2 justify-between">
                    <h1 class="text-wabi-primary text-xl font-bold text-center flex-1">記帳紀錄</h1>
                </div>

                <!-- Period Filter (Date Filter) - New Row -->
                <div id="records-period-filter" class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mb-4">
                    <button data-period="week" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">週</button>
                    <button data-period="month" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">月</button>
                    <button data-period="year" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">年</button>
                    <button data-period="custom" class="period-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">自訂</button>
                </div>

                <!-- Type & Category Filters -->
                <div class="flex gap-2 py-2 overflow-x-auto">
                    <div id="records-type-filter" class="flex items-center justify-center rounded-lg bg-gray-200/50 p-1">
                        <button data-type="all" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-surface text-wabi-primary shadow-sm">全部</button>
                        <button data-type="expense" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">支出</button>
                        <button data-type="income" class="type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">收入</button>
                    </div>
                    <button id="records-category-filter-btn" class="h-9 shrink-0 flex items-center justify-center gap-x-1.5 rounded-full bg-white px-4 border border-gray-200">
                        <p class="text-wabi-text-primary text-sm font-medium leading-normal">類別</p>
                        <i class="fa-solid fa-chevron-down text-xs text-wabi-text-secondary"></i>
                    </button>
                    <button id="records-account-filter-btn" class="h-9 shrink-0 flex items-center justify-center gap-x-1.5 rounded-full bg-white px-4 border border-gray-200 hidden">
                        <p class="text-wabi-text-primary text-sm font-medium leading-normal">帳戶</p>
                        <i class="fa-solid fa-chevron-down text-xs text-wabi-text-secondary"></i>
                    </button>
                </div>

                <!-- Summary Cards -->
                <div class="grid grid-cols-3 gap-3 my-4">
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-text-secondary">筆數</div>
                        <div id="record-count" class="text-lg font-bold text-wabi-primary">0</div>
                    </div>
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-income">收入</div>
                        <div id="total-income" class="text-lg font-bold text-wabi-income">$0</div>
                    </div>
                    <div class="bg-wabi-surface p-3 rounded-lg shadow-sm border border-wabi-border text-center">
                        <div class="text-sm text-wabi-expense">支出</div>
                        <div id="total-expense" class="text-lg font-bold text-wabi-expense">$0</div>
                    </div>
                </div>

                <!-- Transaction List -->
                <div id="records-list-container" class="flex flex-col space-y-1"></div>

                <!-- Modals -->
                <div id="records-modals-container"></div>
            </div>
        `
    const pageElement = this.appContainer.querySelector('.page')
    this.recordsListManager = new RecordsListManager(
      this.dataService,
      this.categoryManager,
      pageElement
    )
    this.recordsListManager.init()
  }

  async renderAddPage(recordId) {
    const isEditMode = !!recordId
    const debtEnabled = await this.dataService.getSetting(
      'debtManagementEnabled'
    )
    const showDebtBtn = !!debtEnabled?.value

    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-48 md:pb-8 max-w-3xl mx-auto"> <!-- Add padding-bottom to avoid overlap with fixed keypad -->
                <!-- Header -->
                <div class="flex items-center pb-2 justify-between">
                    <button id="add-page-close-btn" class="flex size-12 shrink-0 items-center justify-center">
                        <i class="fa-solid fa-xmark text-2xl text-wabi-text-primary"></i>
                    </button>
                    <h2 class="text-lg font-bold flex-1 text-center">${isEditMode ? '編輯紀錄' : '新增紀錄'}</h2>
                    <div class="flex items-center gap-2">
                        ${
                          showDebtBtn
                            ? `
                            <button id="toggle-debt-btn" class="size-10 flex items-center justify-center rounded-full text-wabi-text-secondary hover:bg-gray-100" title="標記為欠款">
                                <i class="fa-solid fa-handshake text-lg"></i>
                            </button>
                        `
                            : ''
                        }
                        ${isEditMode ? '<button id="delete-record-btn" class="text-wabi-expense"><i class="fa-solid fa-trash-can"></i></button>' : ''}
                    </div>
                </div>

                <!-- Debt Panel (hidden by default) -->
                <div id="debt-panel" class="hidden bg-wabi-primary/10 rounded-lg p-4 mb-4 border border-wabi-primary/30">
                    <div class="flex items-center justify-between mb-3">
                        <span class="font-medium text-wabi-primary"><i class="fa-solid fa-handshake mr-2"></i>欠款標記</span>
                        <button id="close-debt-panel" class="text-wabi-text-secondary hover:text-wabi-primary">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                    <div class="flex h-9 w-full items-center justify-center rounded-lg bg-white/80 p-1 mb-3">
                        <button id="debt-type-receivable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-income text-white">別人欠我</button>
                        <button id="debt-type-payable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">我欠別人</button>
                    </div>
                    <select id="debt-contact-select" class="w-full p-2 bg-white border border-wabi-border rounded-lg text-sm">
                        <option value="">選擇聯絡人...</option>
                    </select>
                    <p class="text-xs text-wabi-text-secondary mt-2">儲存時將同時建立欠款記錄</p>
                </div>

                <!-- Type Switcher & Amount -->
                <div class="px-4">
                    <div class="flex h-11 w-full items-center justify-center rounded-lg bg-gray-200/80 p-1 mb-4">
                        <button id="add-type-expense" class="flex-1 h-full rounded-md text-sm font-medium">支出</button>
                        <button id="add-type-income" class="flex-1 h-full rounded-md text-sm font-medium">收入</button>
                    </div>
                    <div class="flex items-center justify-between py-4">
                        <div id="add-selected-category" class="flex items-center gap-4">
                            <div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12">
                                <i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i>
                            </div>
                            <p class="text-lg font-medium">選擇分類</p>
                        </div>
                        <div id="add-amount-display" class="text-wabi-expense tracking-light text-5xl font-bold">$0</div>
                    </div>
                </div>

                <!-- Categories -->
                <div id="add-category-grid" class="px-4 mt-2 grid grid-cols-4 gap-4"></div>
            </div>
            <!-- Note, Date, and Keypad -->
            <div id="keypad-container" class="fixed bottom-20 md:bottom-0 left-0 md:left-64 right-0 md:max-w-3xl md:mx-auto md:border-x md:border-t md:border-wabi-border md:rounded-t-xl md:shadow-[0_0_15px_rgba(0,0,0,0.05)] bg-gray-200/80 text-wabi-primary z-20 transform translate-y-full transition-transform duration-300 ease-in-out">
                <!-- Account Selector & Quick Select Container -->
                <div class="flex items-start px-4 pt-2 gap-2">
                    <div id="account-selector-container" class="w-1/4 shrink-0"></div>
                    <div id="quick-select-container" class="w-3/4 grow hidden"></div>
                </div>

                <div class="flex items-center px-4 py-2 gap-2">
                    <label class="relative flex items-center gap-2 p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-calendar-days text-wabi-text-secondary"></i>
                        <span id="add-date-display" class="text-sm font-medium">${formatDate(formatDateToString(new Date()), 'short')}</span>
                        <input type="date" id="add-date-input" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                    </label>
                    <input id="add-note-input" class="w-full rounded-lg border-gray-300 bg-white/80 placeholder:text-wabi-text-secondary focus:border-wabi-primary focus:ring-wabi-primary" placeholder="新增備註" type="text"/>
                    <button id="keypad-toggle-btn" class="p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-keyboard"></i>
                    </button>
                </div>
                <div id="keypad-grid" class="grid grid-cols-4 gap-px bg-gray-200/80">
                    ${['1', '2', '3', 'backspace', '4', '5', '6', 'ac', '7', '8', '9', 'save', '00', '0', '.', ''].map(k => this.createKeypadButton(k, isEditMode)).join('')}
                </div>
            </div>
        `
    this.setupAddPageListeners(recordId)
  }

  async renderStatsPage() {
    this.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between p-4 bg-wabi-bg/80 backdrop-blur-sm border-b border-wabi-border">
                    <h1 class="text-lg font-bold text-wabi-primary flex-1 text-center">收支分析</h1>
                </header>
                <main class="flex-1 p-4 pb-24">
                    <div id="stats-container"></div>
                </main>
            </div>
        `
    this.statisticsManager = new StatisticsManager(
      this.dataService,
      this.categoryManager
    )
    this.statisticsManager.renderStatisticsPage(
      document.getElementById('stats-container')
    )
  }

  async renderSettingsPage() {
    this.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">設定</h2>
                </div>
                <div class="p-4 space-y-6">
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">應用程式</h3>
                        ${this.createSettingItem('fa-solid fa-cloud-arrow-down', '強制更新', 'force-update-btn')}
                        ${this.createSettingItem('fa-solid fa-share-nodes', '分享此 App', 'share-app-btn')}
                        <div id="install-pwa-btn-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-mobile-screen-button', '安裝為應用程式', 'install-pwa-btn')}
                        </div>
                        ${this.createSettingItem('fa-solid fa-puzzle-piece', '擴充功能管理', 'manage-plugins-btn')}
                    </div>

                    <!-- Data Management -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">資料管理</h3>
                        ${this.createSettingItem('fa-solid fa-cloud', '雲端同步', 'cloud-sync-btn')}
                        ${this.createSettingItem('fa-solid fa-download', '匯出資料', 'export-data-btn')}
                        ${this.createSettingItem('fa-solid fa-upload', '匯入資料', 'import-data-btn')}
                        <input type="file" id="import-file-input" accept=".json" class="hidden">
                    </div>
                    <!-- App Info -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">關於</h3>
                        ${this.createSettingItem('fa-solid fa-arrows-rotate', '檢查更新', 'check-update-btn')}
                        ${this.createSettingItem('fa-solid fa-file-lines', '更新日誌', 'changelog-btn')}
                        <a href="https://github.com/ADT109119/jijun" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-gray-100/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-brands fa-github"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">GitHub 儲存庫</p>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-chevron-right"></i>
                            </div>
                        </a>
                        <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
                        <div id="version-info" class="px-4 py-3 text-xs text-center text-wabi-text-secondary"></div>
                    </div>

                    <!-- Sponsor the Author -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">贊助作者</h3>
                        <a href="https://buymeacoffee.com/thewalkingfish" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-gray-100/50">
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
                                <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-accounts-link-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-credit-card', '帳戶管理', 'manage-accounts-btn')}
                        </div>
                        <div id="manage-recurring-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-repeat', '週期性交易', 'manage-recurring-btn')}
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
                                <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-debts-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-receipt', '欠款管理', 'manage-debts-btn')}
                        </div>

                        ${this.createSettingItem('fa-solid fa-rectangle-ad', '觀看廣告以移除廣告 24 小時', 'sponsor-reward-ad-btn')}

                    </div>

                    <!-- Banner Ad -->
                    <div id="settings-banner-ad" class="rounded-xl overflow-hidden"></div>

                    <div class="pb-24"></div>
                </div>
            </div>
        `
    this.setupSettingsPageListeners()
    // Add listener for plugin manager button
    const managePluginsBtn = document.getElementById('manage-plugins-btn')
    if (managePluginsBtn) {
      managePluginsBtn.addEventListener('click', () => {
        window.location.hash = '#plugins'
      })
    }
    // Cloud sync button
    const cloudSyncBtn = document.getElementById('cloud-sync-btn')
    if (cloudSyncBtn) {
      cloudSyncBtn.addEventListener('click', () => {
        window.location.hash = '#sync-settings'
      })
    }
    // 贊助 - 觀看獎勵廣告以移除廣告 24 小時
    const rewardAdBtn = document.getElementById('sponsor-reward-ad-btn')
    if (rewardAdBtn) {
      rewardAdBtn.addEventListener('click', async () => {
        try {
          const granted = await this.adService.showRewardedAd()
          if (granted) {
            this.renderSettingsPage()
          }
        } catch (e) {
          console.warn('獎勵廣告流程失敗:', e)
        }
      })
    }
    // 渲染底部橫幅廣告
    this.adService
      .renderBannerAd(document.getElementById('settings-banner-ad'))
      .catch(() => {})
  }

  async renderPluginsPage() {
    const plugins = await this.pluginManager.getInstalledPlugins()

    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">擴充功能商店</h1>
                    <div class="w-8"></div>
                </div>

                <!-- Store Section -->
                 <h3 class="font-bold text-wabi-primary mb-3">推薦擴充</h3>
                 <div id="store-list-container" class="space-y-3 mb-8">
                    <div class="text-center py-4 text-wabi-text-secondary animate-pulse">
                        載入中...
                    </div>
                 </div>

                <!-- Custom Pages List -->
                ${
                  this.pluginManager.customPages.size > 0
                    ? `
                    <h3 class="font-bold text-wabi-primary mb-3">已安裝應用程式</h3>
                    <div class="space-y-3 mb-6">
                        ${Array.from(this.pluginManager.customPages.entries())
                          .map(
                            ([route, page]) => `
                            <a href="#${route}" class="block bg-wabi-surface p-4 rounded-xl border border-wabi-border flex justify-between items-center hover:bg-gray-50">
                                <div>
                                    <h4 class="font-bold text-wabi-text-primary">${page.title}</h4>
                                    <p class="text-xs text-wabi-text-secondary mt-1">#${route}</p>
                                </div>
                                <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
                            </a>
                        `
                          )
                          .join('')}
                    </div>
                `
                    : ''
                }

                <!-- Plugin List -->
                <h3 class="font-bold text-wabi-primary mb-3">已安裝插件模組</h3>
                <div id="plugin-list-container" class="space-y-3">
                    ${
                      plugins.length === 0
                        ? `
                        <div class="text-center py-8 text-wabi-text-secondary">
                            <i class="fa-solid fa-puzzle-piece text-4xl mb-3 opacity-30"></i>
                            <p>尚未安裝任何擴充功能</p>
                        </div>
                    `
                        : plugins
                            .map(
                              p => `
                        <div class="bg-wabi-surface p-4 rounded-xl border border-wabi-border flex justify-between items-center">
                            <div>
                                <h4 class="font-bold text-wabi-text-primary">${p.name} <span class="text-xs text-wabi-text-secondary font-normal">v${p.version}</span></h4>
                                <p class="text-xs text-wabi-text-secondary mt-1">${p.description || '無描述'}</p>
                            </div>
                            <button class="delete-plugin-btn text-wabi-expense p-2" data-id="${p.id}">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    `
                            )
                            .join('')
                    }
                </div>
            </div>
        `

    // Load Store Data
    try {
      const res = await fetch(`plugins/index.json?t=${Date.now()}`)
      if (res.ok) {
        const storePlugins = await res.json()
        const storeContainer = document.getElementById('store-list-container')

        storeContainer.innerHTML = storePlugins
          .slice(0, 3)
          .map(p => {
            const installed = plugins.find(i => i.id === p.id)
            let btnHtml = ''

            if (installed) {
              if (
                this.pluginManager.compareVersions(
                  p.version,
                  installed.version
                ) > 0
              ) {
                // Update available
                btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-yellow-500 text-white hover:bg-yellow-600 shadow"
                                data-url="${p.file}" data-id="${p.id}">
                                更新 (v${p.version})
                            </button>`
              } else {
                // Already installed & up to date
                btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-green-100 text-green-700 cursor-default" disabled>
                                已安裝
                            </button>`
              }
            } else {
              // Not installed
              btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-wabi-primary text-white hover:bg-opacity-90 shadow"
                            data-url="${p.file}" data-id="${p.id}">
                            安裝
                        </button>`
            }

            return `
                    <div class="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                        <div class="flex items-center gap-4">
                            <div class="bg-wabi-primary/10 text-wabi-primary rounded-lg size-12 flex items-center justify-center text-xl aspect-square">
                                <i class="fa-solid ${p.icon || 'fa-puzzle-piece'}"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-wabi-text-primary text-lg">${p.name}</h4>
                                <p class="text-sm text-wabi-text-secondary line-clamp-1">${p.description}</p>
                            </div>
                        </div>
                        ${btnHtml}
                    </div>
                `
          })
          .join('')

        if (storePlugins.length > 3) {
          storeContainer.innerHTML += `
                        <a href="#store" class="block w-full py-3 text-center text-wabi-primary font-bold bg-wabi-primary/5 rounded-xl hover:bg-wabi-primary/10 transition-colors mt-3">
                            查看更多擴充功能 (${storePlugins.length})
                        </a>
                    `
        }

        // Bind Install Events
        document.querySelectorAll('.store-install-btn').forEach(btn => {
          if (!btn.disabled) {
            btn.addEventListener('click', async () => {
              btn.disabled = true
              btn.textContent = '下載中...'
              try {
                const response = await fetch(btn.dataset.url)
                const script = await response.text()
                const file = new File([script], 'plugin.js', {
                  type: 'text/javascript',
                })
                // 找到對應的商店插件資訊，傳入權限與 icon
                const matchedPlugin = storePlugins.find(
                  sp => sp.id === btn.dataset.id
                )
                await this.pluginManager.installPlugin(
                  file,
                  matchedPlugin || null
                )
                showToast('安裝成功！', 'success')
                this.renderPluginsPage()
              } catch (e) {
                console.error(e)
                if (
                  e.message !== '使用者取消安裝' &&
                  e.message !== '使用者取消更新'
                ) {
                  showToast('安裝失敗', 'error')
                }
                btn.disabled = false
                btn.textContent = '安裝'
              }
            })
          }
        })
      } else {
        document.getElementById('store-list-container').innerHTML =
          '<p class="text-center text-red-500">無法載入商店列表</p>'
      }
    } catch (e) {
      console.error(e)
      document.getElementById('store-list-container').innerHTML =
        '<p class="text-center text-red-500">無法連結至商店</p>'
    }

    // Handle Delete
    document.querySelectorAll('.delete-plugin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('確定要移除此擴充功能嗎？')) {
          await this.pluginManager.uninstallPlugin(btn.dataset.id)
          this.renderPluginsPage()
        }
      })
    })
  }

  // ── Sync Settings Page ──────────────────────────────────

  async renderSyncSettingsPage() {
    const isSignedIn = this.syncService.isSignedIn()
    const userInfo = this.syncService.userInfo
    const serverUrl = this.syncService.getServerUrl()
    const lastBackup = await this.dataService.getSetting('sync_last_backup')
    const lastSync = await this.dataService.getSetting('sync_last_sync')
    const autoSyncEnabled =
      await this.dataService.getSetting('sync_auto_enabled')
    const autoBackupEnabled = await this.dataService.getSetting(
      'sync_auto_backup_enabled'
    )
    const autoBackupInterval = await this.dataService.getSetting(
      'sync_auto_backup_interval'
    )
    const backupIntervalValue = autoBackupInterval?.value || 'daily'

    this.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">雲端同步</h2>
                    <div class="w-8"></div>
                </div>
                <div class="p-4 space-y-6 pb-24">

                    <!-- Server Settings -->
                    <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                        <h3 class="text-wabi-primary text-base font-bold">伺服器設定</h3>
                        <div class="space-y-2">
                            <label class="text-sm text-wabi-text-secondary">同步伺服器 URL</label>
                            <div class="flex flex-wrap gap-2">
                                <input type="url" id="sync-server-url-input"
                                    class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-wabi-border bg-white text-sm focus:ring-wabi-primary focus:border-wabi-primary"
                                    value="${serverUrl}"
                                    placeholder="https://jijun-server.the-walking-fish.com" />
                                <button id="sync-server-save-btn" class="px-3 py-2 bg-wabi-primary text-white rounded-lg text-sm font-medium hover:bg-wabi-primary/90 shrink-0">
                                    儲存
                                </button>
                                <button id="sync-server-reset-btn" class="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 shrink-0" title="還原預設值">
                                    <i class="fa-solid fa-rotate-left"></i>
                                </button>
                            </div>
                            <p class="text-xs text-wabi-text-secondary">用於 Google OAuth 代理的伺服器地址</p>
                        </div>
                    </div>

                    <!-- Google Account -->
                    <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                        <h3 class="text-wabi-primary text-base font-bold">Google 帳號</h3>
                        ${
                          isSignedIn && userInfo
                            ? `
                            <div class="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                ${userInfo.picture ? `<img src="${userInfo.picture}" class="w-10 h-10 rounded-full" alt="avatar" />` : '<div class="w-10 h-10 rounded-full bg-wabi-primary/20 flex items-center justify-center"><i class="fa-solid fa-user text-wabi-primary"></i></div>'}
                                <div class="flex-1">
                                    <p class="font-medium text-wabi-text-primary">${userInfo.name || 'Google User'}</p>
                                    <p class="text-xs text-wabi-text-secondary">${userInfo.email || ''}</p>
                                </div>
                                <span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">已連結</span>
                            </div>
                            <button id="sync-sign-out-btn" class="w-full py-2 text-red-500 text-sm font-medium border border-red-200 rounded-lg hover:bg-red-50">
                                <i class="fa-solid fa-right-from-bracket mr-1"></i> 登出 Google 帳號
                            </button>
                        `
                            : `
                            <div class="text-center py-4">
                                <p class="text-sm text-wabi-text-secondary mb-3">登入 Google 帳號以使用雲端備份和同步功能</p>
                                <button id="sync-sign-in-btn" class="px-6 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center justify-center gap-2 mx-auto">
                                    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                                    <span class="text-sm font-medium text-gray-700">使用 Google 帳號登入</span>
                                </button>
                            </div>
                        `
                        }
                    </div>

                    ${
                      isSignedIn
                        ? `
                    <!-- Backup -->
                    <div class="bg-wabi-surface rounded-xl p-4 space-y-3">
                        <h3 class="text-wabi-primary text-base font-bold">雲端備份</h3>
                        <p class="text-xs text-wabi-text-secondary">
                            上次備份：${lastBackup?.value?.timestamp ? new Date(lastBackup.value.timestamp).toLocaleString('zh-TW') : '尚未備份'}
                        </p>
                        <div class="grid grid-cols-2 gap-3">
                            <button id="sync-backup-btn" class="py-2.5 bg-wabi-primary text-white rounded-lg text-sm font-medium hover:bg-wabi-primary/90 flex items-center justify-center gap-1">
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
                                    <p class="text-xs text-wabi-text-secondary">定期自動備份到 Google Drive</p>
                                </div>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" id="sync-auto-backup-toggle" class="sr-only peer" ${autoBackupEnabled?.value ? 'checked' : ''}>
                                    <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary"></div>
                                    <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full"></span>
                                </label>
                            </div>
                            <div id="auto-backup-interval-container" class="${autoBackupEnabled?.value ? '' : 'hidden'}">
                                <label class="text-xs text-wabi-text-secondary mb-1 block">備份頻率</label>
                                <div class="flex gap-2">
                                    <button data-interval="daily" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === 'daily' ? 'bg-wabi-primary text-white border-wabi-primary' : 'bg-white text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每天</button>
                                    <button data-interval="3days" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === '3days' ? 'bg-wabi-primary text-white border-wabi-primary' : 'bg-white text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每 3 天</button>
                                    <button data-interval="weekly" class="auto-backup-interval-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${backupIntervalValue === 'weekly' ? 'bg-wabi-primary text-white border-wabi-primary' : 'bg-white text-wabi-text-primary border-wabi-border hover:border-wabi-primary'}">每週</button>
                                </div>
                            </div>
                            <p class="text-xs text-wabi-text-secondary">
                                <i class="fa-solid fa-circle-info mr-1"></i>
                                備份保留策略：近 7 天的備份全部保留，更早的每月僅保留一筆，超過一年的自動刪除。
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
                                <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <button id="sync-now-btn" class="w-full py-2.5 border border-wabi-border text-wabi-text-primary rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-rotate"></i> 立即同步
                        </button>
                        <p class="text-xs text-wabi-text-secondary">
                            裝置 ID: <code class="bg-gray-100 px-1 rounded">${this.syncService.deviceId}</code>
                        </p>
                    </div>
                    `
                        : ''
                    }

                </div>
            </div>
        `
    this.setupSyncSettingsListeners()
  }

  setupSyncSettingsListeners() {
    // Server URL save
    const serverSaveBtn = document.getElementById('sync-server-save-btn')
    if (serverSaveBtn) {
      serverSaveBtn.addEventListener('click', async () => {
        const input = document.getElementById('sync-server-url-input')
        const url = input.value.trim()
        if (!url) {
          showToast('請輸入伺服器 URL', 'error')
          return
        }
        await this.syncService.setServerUrl(url)
        showToast('伺服器 URL 已儲存', 'success')
      })
    }

    // Server URL reset
    const serverResetBtn = document.getElementById('sync-server-reset-btn')
    if (serverResetBtn) {
      serverResetBtn.addEventListener('click', async () => {
        const defaultUrl = 'https://jijun-server.the-walking-fish.com'
        const input = document.getElementById('sync-server-url-input')
        if (input) input.value = defaultUrl
        await this.syncService.setServerUrl(defaultUrl)
        showToast('已還原預設伺服器 URL', 'success')
      })
    }

    // Sign in
    const signInBtn = document.getElementById('sync-sign-in-btn')
    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        try {
          signInBtn.disabled = true
          signInBtn.innerHTML =
            '<i class="fa-solid fa-spinner fa-spin"></i> 登入中...'
          await this.syncService.signIn()
          showToast('Google 帳號登入成功！', 'success')
          await this.renderSyncSettingsPage()
        } catch (err) {
          console.error('Sign in error:', err)
          showToast('登入失敗：' + err.message, 'error')
          signInBtn.disabled = false
          signInBtn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/></svg> <span class="text-sm font-medium text-gray-700">使用 Google 帳號登入</span>'
        }
      })
    }

    // Sign out
    const signOutBtn = document.getElementById('sync-sign-out-btn')
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        if (!confirm('確定要登出 Google 帳號？這會停止自動同步。')) return
        await this.syncService.signOut()
        showToast('已登出 Google 帳號', 'success')
        await this.renderSyncSettingsPage()
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
          await this.syncService.backupToDrive()
          showToast('備份成功！', 'success')
          await this.renderSyncSettingsPage()
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
          const backups = await this.syncService.listBackups()
          if (backups.length === 0) {
            showToast('沒有找到任何備份', 'info')
            return
          }
          // Show backup selection
          const listHtml = backups
            .map((b, i) => {
              const date = new Date(b.createdTime).toLocaleString('zh-TW')
              const sizeKB = b.size ? (parseInt(b.size) / 1024).toFixed(1) : '?'
              return `<button class="restore-backup-item w-full text-left p-3 hover:bg-gray-50 rounded-lg border border-wabi-border" data-file-id="${b.id}">
                            <p class="text-sm font-medium text-wabi-text-primary">${b.name}</p>
                            <p class="text-xs text-wabi-text-secondary">${date} · ${sizeKB} KB</p>
                        </button>`
            })
            .join('')

          const modal = document.createElement('div')
          modal.className =
            'fixed inset-0 z-50 flex items-end justify-center bg-black/40'
          modal.innerHTML = `
                        <div class="bg-white w-full max-w-lg rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto animate-slide-up">
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

          modal
            .querySelector('#close-restore-modal')
            .addEventListener('click', () => modal.remove())
          modal.addEventListener('click', e => {
            if (e.target === modal) modal.remove()
          })

          modal.querySelectorAll('.restore-backup-item').forEach(btn => {
            btn.addEventListener('click', async () => {
              if (!confirm('確定要從此備份還原？這將覆蓋目前的所有資料。'))
                return
              const fileId = btn.dataset.fileId
              modal.remove()
              try {
                const backupData =
                  await this.syncService.restoreFromDrive(fileId)
                // Use the import logic — create a temporary blob
                const blob = new Blob([JSON.stringify(backupData)], {
                  type: 'application/json',
                })
                const file = new File([blob], 'restore.json', {
                  type: 'application/json',
                })
                const result = await this.dataService.importData(file)
                showToast(result.message, result.success ? 'success' : 'error')
                if (result.success) {
                  this.currentHash = null
                  window.location.hash = '#home'
                }
              } catch (err) {
                showToast('還原失敗：' + err.message, 'error')
              }
            })
          })
        } catch (err) {
          showToast('載入備份列表失敗：' + err.message, 'error')
        }
      })
    }

    // Auto backup toggle
    const autoBackupToggle = document.getElementById('sync-auto-backup-toggle')
    if (autoBackupToggle) {
      autoBackupToggle.addEventListener('change', async e => {
        const enabled = e.target.checked
        await this.dataService.saveSetting({
          key: 'sync_auto_backup_enabled',
          value: enabled,
        })
        const intervalContainer = document.getElementById(
          'auto-backup-interval-container'
        )
        if (enabled) {
          const intervalSetting = await this.dataService.getSetting(
            'sync_auto_backup_interval'
          )
          const interval = intervalSetting?.value || 'daily'
          this.syncService.startAutoBackup(interval)
          if (intervalContainer) intervalContainer.classList.remove('hidden')
          showToast('已啟用自動備份', 'success')
        } else {
          this.syncService.stopAutoBackup()
          if (intervalContainer) intervalContainer.classList.add('hidden')
          showToast('已停用自動備份', 'info')
        }
      })
    }

    // Auto backup interval buttons
    document.querySelectorAll('.auto-backup-interval-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const interval = btn.dataset.interval
        await this.dataService.saveSetting({
          key: 'sync_auto_backup_interval',
          value: interval,
        })
        // Update button styles
        document.querySelectorAll('.auto-backup-interval-btn').forEach(b => {
          b.className = b.className.replace(
            /bg-wabi-primary text-white border-wabi-primary/g,
            'bg-white text-wabi-text-primary border-wabi-border hover:border-wabi-primary'
          )
        })
        btn.className = btn.className.replace(
          /bg-white text-wabi-text-primary border-wabi-border hover:border-wabi-primary/g,
          'bg-wabi-primary text-white border-wabi-primary'
        )
        // Restart auto backup with new interval
        const autoBackupSetting = await this.dataService.getSetting(
          'sync_auto_backup_enabled'
        )
        if (autoBackupSetting?.value) {
          this.syncService.startAutoBackup(interval)
        }
        const labels = { daily: '每天', '3days': '每 3 天', weekly: '每週' }
        showToast(`備份頻率已設定為${labels[interval]}`, 'success')
      })
    })

    // Auto sync toggle
    const autoSyncToggle = document.getElementById('sync-auto-toggle')
    if (autoSyncToggle) {
      autoSyncToggle.addEventListener('change', async e => {
        const enabled = e.target.checked
        await this.dataService.saveSetting({
          key: 'sync_auto_enabled',
          value: enabled,
        })
        if (enabled) {
          this.syncService.startAutoSync(24 * 60 * 60 * 1000)
          showToast('已啟用自動同步', 'success')
        } else {
          this.syncService.stopAutoSync()
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
          await this.syncService.performSync()
          showToast('同步完成！', 'success')
          await this.renderSyncSettingsPage()
        } catch (err) {
          console.error('Sync error:', err)
          showToast('同步失敗：' + err.message, 'error')
          syncNowBtn.disabled = false
          syncNowBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 立即同步'
        }
      })
    }
  }

  // --- Page Loaders & Setup ---

  async populateHomeMonthFilter() {
    const allRecords = await this.dataService.getRecords()
    const months = [...new Set(allRecords.map(r => r.date.slice(0, 7)))]
      .sort()
      .reverse()

    const currentMonth = formatDateToString(new Date()).slice(0, 7)
    if (!months.includes(currentMonth)) {
      months.unshift(currentMonth)
    }

    // Update the display for the new button
    const monthDisplay = document.getElementById('home-month-display')
    if (monthDisplay) {
      monthDisplay.textContent = currentMonth.replace('-', ' / ')
    }
  }

  async loadHomePageData(selectedMonthString = null) {
    const selectedMonth =
      selectedMonthString ||
      document
        .getElementById('home-month-display')
        .textContent.replace(' / ', '-')

    const year = parseInt(selectedMonth.split('-')[0])
    const month = parseInt(selectedMonth.split('-')[1]) - 1
    const { startDate, endDate } = getMonthRange(year, month)

    const stats = await this.dataService.getStatistics(
      startDate,
      endDate,
      null,
      true
    ) // Exclude transfers from totals

    const allRecords = await this.dataService.getRecords()
    const recentRecords = allRecords.slice(0, 5)

    const balanceCardTitle = document.querySelector(
      '.page.active .bg-wabi-surface p:first-child'
    )
    if (balanceCardTitle) {
      balanceCardTitle.textContent = `${selectedMonth.replace('-', ' / ')} 結餘`
    }

    document.getElementById('home-balance').textContent = formatCurrency(
      stats.totalIncome - stats.totalExpense
    )
    document.getElementById('home-income').textContent = formatCurrency(
      stats.totalIncome
    )
    document.getElementById('home-expense').textContent = formatCurrency(
      stats.totalExpense
    )

    const container = document.getElementById('recent-records-container')
    if (recentRecords.length === 0) {
      container.innerHTML = `<p class="text-center text-wabi-text-secondary py-4">還沒有任何紀錄喔！</p>`
    } else {
      container.innerHTML = recentRecords
        .map(record => {
          const isIncome = record.type === 'income'
          let icon, name, color

          if (record.category === 'transfer') {
            icon = 'fa-solid fa-money-bill-transfer'
            name = '帳戶間轉帳'
            color = 'bg-gray-400'
          } else {
            const category = this.categoryManager.getCategoryById(
              record.type,
              record.category
            )
            icon = category?.icon || 'fa-solid fa-question'
            name = category?.name || '未分類'
            color = category?.color || 'bg-gray-400'
          }

          const colorStyle = color.startsWith('#')
            ? `style="background-color: ${color}"`
            : ''
          const colorClass = !color.startsWith('#') ? color : ''

          return `
                    <div class="flex items-center gap-4 bg-wabi-surface px-4 py-3 rounded-lg border border-wabi-border">
                        <div class="flex items-center justify-center rounded-lg ${colorClass} text-white shrink-0 size-12" ${colorStyle}>
                            <i class="${icon} text-2xl"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-wabi-text-primary truncate">${name}</p>
                            <p class="text-sm text-wabi-text-secondary line-clamp-2 break-all">${record.description || formatDate(record.date, 'short')}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-medium ${isIncome ? 'text-wabi-income' : 'text-wabi-expense'}">${isIncome ? '+' : '-'} ${formatCurrency(record.amount)}</p>
                            <p class="text-xs text-wabi-text-secondary">${formatDate(record.date, 'short')}</p>
                        </div>
                    </div>
                `
        })
        .join('')
    }

    this.loadBudgetWidget()
  }

  async loadBudgetWidget() {
    const container = document.getElementById('budget-widget-container')
    if (!container) return
    container.innerHTML = await this.budgetManager.renderBudgetWidget()
    // Re-bind events for the new widget content
    const editBudgetBtn = document.getElementById('edit-budget-btn')
    if (editBudgetBtn) {
      editBudgetBtn.addEventListener('click', () =>
        this.budgetManager.showBudgetModal()
      )
    }
    const setBudgetBtn = document.getElementById('set-budget-btn')
    if (setBudgetBtn) {
      setBudgetBtn.addEventListener('click', () =>
        this.budgetManager.showBudgetModal()
      )
    }
  }

  setupHomePageEventListeners() {
    const monthSelectorBtn = document.getElementById('home-month-selector-btn')
    if (monthSelectorBtn) {
      monthSelectorBtn.addEventListener('click', () => {
        const currentMonthDisplay =
          document.getElementById('home-month-display').textContent
        const [year, month] = currentMonthDisplay.split(' / ').map(Number)
        this.showMonthYearPickerModal(year, month - 1, newMonthString => {
          this.loadHomePageData(newMonthString)
        })
      })
    }
  }

  showMonthYearPickerModal(initialYear, initialMonthIndex, onApply) {
    const modal = document.createElement('div')
    modal.id = 'month-year-picker-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    let selectedYear = initialYear
    let selectedMonth = initialMonthIndex + 1 // 1-indexed month

    const renderModalContent = () => {
      modal.innerHTML = `
                <div class="bg-wabi-bg rounded-lg max-w-xs w-full p-6">
                    <h3 class="text-lg font-semibold mb-4 text-wabi-primary text-center">選擇月份</h3>
                    <!-- Year Navigation -->
                    <div class="flex items-center justify-between mb-6">
                        <button id="prev-year" class="p-2 rounded-full hover:bg-gray-200/50 text-wabi-primary">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span id="current-year" class="text-xl font-bold text-wabi-primary">${selectedYear}年</span>
                        <button id="next-year" class="p-2 rounded-full hover:bg-gray-200/50 text-wabi-primary">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    <!-- Month Grid -->
                    <div id="month-grid" class="grid grid-cols-3 gap-3 mb-6">
                        ${Array.from({ length: 12 }, (_, i) => {
                          const monthNum = i + 1
                          const isActive =
                            monthNum === selectedMonth
                              ? 'bg-wabi-accent text-wabi-primary'
                              : 'bg-wabi-surface text-wabi-text-primary'
                          return `<button data-month="${monthNum}" class="month-btn p-3 rounded-lg font-medium ${isActive}">${monthNum}月</button>`
                        }).join('')}
                    </div>
                    <div class="flex justify-end">
                        <button id="cancel-month-year" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
                    </div>
                </div>
            `

      // Attach event listeners after rendering content
      modal.querySelector('#prev-year').addEventListener('click', () => {
        selectedYear--
        renderModalContent()
      })
      modal.querySelector('#next-year').addEventListener('click', () => {
        selectedYear++
        renderModalContent()
      })
      modal.querySelectorAll('.month-btn').forEach(button => {
        button.addEventListener('click', e => {
          selectedMonth = parseInt(e.target.dataset.month)
          const newMonthString = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`

          // Update the display and call the callback
          document.getElementById('home-month-display').textContent =
            newMonthString.replace('-', ' / ')
          if (onApply) {
            onApply(newMonthString)
          }
          modal.remove()
        })
      })
      modal
        .querySelector('#cancel-month-year')
        .addEventListener('click', () => {
          modal.remove()
        })
    }

    renderModalContent() // Initial render
    document.body.appendChild(modal)

    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove()
      }
    })
  }

  setupSettingsPageListeners() {
    document
      .getElementById('export-data-btn')
      .addEventListener('click', async () => {
        // Show export options dialog
        await this.showExportOptionsModal()
      })

    const importFileInput = document.getElementById('import-file-input')
    document.getElementById('import-data-btn').addEventListener('click', () => {
      importFileInput.click()
    })

    importFileInput.addEventListener('change', async event => {
      const file = event.target.files[0]
      if (!file) return

      if (confirm('匯入資料將會覆蓋所有現有紀錄，確定要繼續嗎？')) {
        try {
          await this.dataService.importData(file)
          showToast('資料已成功匯入！正在重整...', 'success')
          setTimeout(() => window.location.reload(), 2000)
        } catch (error) {
          console.error('匯入失敗:', error)
          showToast('資料匯入失敗', 'error')
        }
      }
    })

    document
      .getElementById('check-update-btn')
      .addEventListener('click', () => this.checkForUpdates())
    document
      .getElementById('changelog-btn')
      .addEventListener('click', () =>
        this.changelogManager.showChangelogModal()
      )

    // New Listeners
    document
      .getElementById('force-update-btn')
      .addEventListener('click', () => this.forceUpdate())

    const installBtn = document.getElementById('install-pwa-btn')
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (this.deferredInstallPrompt) {
          this.deferredInstallPrompt.prompt()
          const { outcome } = await this.deferredInstallPrompt.userChoice
          console.log(`User response to the install prompt: ${outcome}`)
          this.deferredInstallPrompt = null
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
      const latestVersion = this.changelogManager.getAllVersions()[0]
      versionInfo.textContent = `版本 v${latestVersion.version}`
    }

    const advancedModeToggle = document.getElementById(
      'advanced-account-mode-toggle'
    )
    if (advancedModeToggle) {
      this.dataService
        .getSetting('advancedAccountModeEnabled')
        .then(setting => {
          const isEnabled = !!setting?.value
          advancedModeToggle.checked = isEnabled
          if (isEnabled) {
            document
              .getElementById('manage-accounts-link-container')
              .classList.remove('hidden')
            document
              .getElementById('manage-recurring-link-container')
              .classList.remove('hidden')
          }
        })

      advancedModeToggle.addEventListener('change', async e => {
        const isEnabled = e.target.checked
        await this.dataService.saveSetting({
          key: 'advancedAccountModeEnabled',
          value: isEnabled,
        })
        if (isEnabled) {
          await this.handleAdvancedModeActivation()
        }
        showToast(`多帳戶模式已${isEnabled ? '啟用' : '停用'}，將重新載入...`)
        setTimeout(() => window.location.reload(), 1500)
      })
    }

    const manageAccountsBtn = document.getElementById('manage-accounts-btn')
    if (manageAccountsBtn) {
      manageAccountsBtn.addEventListener('click', () => {
        window.location.hash = '#accounts'
      })
    }

    const manageRecurringBtn = document.getElementById('manage-recurring-btn')
    if (manageRecurringBtn) {
      manageRecurringBtn.addEventListener('click', () => {
        window.location.hash = '#recurring'
      })
    }

    // Debt Management Toggle
    const debtManagementToggle = document.getElementById(
      'debt-management-toggle'
    )
    if (debtManagementToggle) {
      this.dataService.getSetting('debtManagementEnabled').then(setting => {
        const isEnabled = !!setting?.value
        debtManagementToggle.checked = isEnabled
        if (isEnabled) {
          document
            .getElementById('manage-debts-link-container')
            .classList.remove('hidden')
        }
      })

      debtManagementToggle.addEventListener('change', async e => {
        const isEnabled = e.target.checked
        await this.dataService.saveSetting({
          key: 'debtManagementEnabled',
          value: isEnabled,
        })
        if (isEnabled) {
          document
            .getElementById('manage-debts-link-container')
            .classList.remove('hidden')
        } else {
          document
            .getElementById('manage-debts-link-container')
            .classList.add('hidden')
        }
        showToast(`欠款管理已${isEnabled ? '啟用' : '停用'}`)
      })
    }

    const manageDebtsBtn = document.getElementById('manage-debts-btn')
    if (manageDebtsBtn) {
      manageDebtsBtn.addEventListener('click', () => {
        window.location.hash = '#debts'
      })
    }
  }

  async renderAccountsPage() {
    const advancedMode = await this.dataService.getSetting(
      'advancedAccountModeEnabled'
    )
    if (!advancedMode?.value) {
      window.location.hash = '#settings'
      return
    }

    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">帳戶管理</h1>
                    <div class="w-6"></div> <!-- Placeholder for alignment -->
                </div>

                <!-- Total Assets -->
                <div class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8 text-center">
                    <p class="text-wabi-text-secondary text-base font-medium">總資產</p>
                    <p id="total-assets" class="text-wabi-primary text-4xl font-bold tracking-tight mt-1">$0</p>
                </div>

                <!-- Account List -->
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold text-wabi-primary">帳戶列表</h3>
                    <div class="flex gap-2">
                        <button id="transfer-btn" class="bg-wabi-income text-white rounded-full w-8 h-8 flex items-center justify-center">
                            <i class="fa-solid fa-money-bill-transfer"></i>
                        </button>
                        <button id="add-account-btn" class="bg-wabi-primary text-white rounded-full w-8 h-8 flex items-center justify-center">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>
                <div id="accounts-list-container" class="space-y-2"></div>
            </div>
        `
    this.setupAccountsPageListeners()
  }

  async setupAccountsPageListeners() {
    const accounts = await this.dataService.getAccounts()
    const allRecords = await this.dataService.getRecords() // Get all records once
    const container = document.getElementById('accounts-list-container')
    const totalAssetsEl = document.getElementById('total-assets')

    let totalAssets = 0
    container.innerHTML = ''

    if (accounts.length === 0) {
      container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">尚未建立任何帳戶</p>`
    }

    for (const account of accounts) {
      const recordsForAccount = allRecords.filter(
        r => r.accountId === account.id
      )
      const currentBalance = recordsForAccount.reduce((balance, record) => {
        return (
          balance + (record.type === 'income' ? record.amount : -record.amount)
        )
      }, account.balance) // Start with initial balance

      totalAssets += currentBalance

      const accountEl = document.createElement('div')
      accountEl.className =
        'flex items-center justify-between bg-wabi-surface p-4 rounded-lg border border-wabi-border'
      accountEl.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="flex items-center justify-center rounded-lg ${account.color} text-white shrink-0 size-12">
                        <i class="${account.icon} text-2xl"></i>
                    </div>
                    <div>
                        <p class="font-medium text-wabi-text-primary">${account.name}</p>
                        <p class="text-sm text-wabi-text-secondary">餘額: ${formatCurrency(currentBalance)}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button class="edit-account-btn" data-id="${account.id}"><i class="fa-solid fa-pen text-wabi-text-secondary"></i></button>
                    <button class="delete-account-btn" data-id="${account.id}"><i class="fa-solid fa-trash-can text-wabi-expense"></i></button>
                </div>
            `
      container.appendChild(accountEl)
    }

    totalAssetsEl.textContent = formatCurrency(totalAssets)

    document.getElementById('add-account-btn').addEventListener('click', () => {
      this.showAccountModal()
    })

    document.getElementById('transfer-btn').addEventListener('click', () => {
      this.showTransferModal()
    })

    container.querySelectorAll('.edit-account-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const accountId = parseInt(e.currentTarget.dataset.id, 10)
        const account = await this.dataService.getAccount(accountId)
        this.showAccountModal(account)
      })
    })

    container.querySelectorAll('.delete-account-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const accountId = parseInt(e.currentTarget.dataset.id, 10)
        const records = await this.dataService.getRecords({ accountId })
        if (records.length > 0) {
          alert('此帳戶尚有交易紀錄，無法刪除。')
          return
        }
        if (confirm('確定要刪除此帳戶嗎？')) {
          await this.dataService.deleteAccount(accountId)
          showToast('帳戶已刪除')
          this.renderAccountsPage() // Re-render the page
        }
      })
    })
  }

  showAccountSelectionModal(accounts, currentAccountId, onSelect) {
    const modal = document.createElement('div')
    modal.id = 'account-selection-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    const accountListHtml = accounts
      .map(
        account => `
            <button data-id="${account.id}" class="account-select-item w-full flex items-center gap-4 p-4 rounded-lg text-left ${account.id === currentAccountId ? 'bg-wabi-accent/20' : 'hover:bg-wabi-surface'}">
                <div class="flex items-center justify-center rounded-lg ${account.color} text-white shrink-0 size-10">
                    <i class="${account.icon} text-xl"></i>
                </div>
                <span class="font-medium text-wabi-text-primary">${account.name}</span>
            </button>
        `
      )
      .join('')

    modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">選擇帳戶</h3>
                <div class="space-y-2 max-h-60 overflow-y-auto">
                    ${accountListHtml}
                </div>
                <button id="cancel-account-select-btn" class="w-full py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
            </div>
        `
    document.body.appendChild(modal)

    const closeModal = () => modal.remove()

    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal()
    })

    modal
      .querySelector('#cancel-account-select-btn')
      .addEventListener('click', closeModal)

    modal.querySelectorAll('.account-select-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const newAccountId = parseInt(btn.dataset.id, 10)
        onSelect(newAccountId)
        closeModal()
      })
    })
  }

  async renderDebtsPage() {
    const debtEnabled = await this.dataService.getSetting(
      'debtManagementEnabled'
    )
    if (!debtEnabled?.value) {
      window.location.hash = '#settings'
      return
    }
    await this.debtManager.renderDebtsPage(this.appContainer)
  }

  async renderContactsPage() {
    const debtEnabled = await this.dataService.getSetting(
      'debtManagementEnabled'
    )
    if (!debtEnabled?.value) {
      window.location.hash = '#settings'
      return
    }
    await this.debtManager.renderContactsPage(this.appContainer)
  }

  async renderRecurringPage() {
    const advancedMode = await this.dataService.getSetting(
      'advancedAccountModeEnabled'
    )
    if (!advancedMode?.value) {
      window.location.hash = '#settings'
      return
    }

    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">週期性交易</h1>
                    <div class="w-6"></div> <!-- Placeholder for alignment -->
                </div>

                <!-- Recurring Transaction List -->
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold text-wabi-primary">已設定項目</h3>
                    <button id="add-recurring-btn" class="bg-wabi-primary text-white rounded-full w-8 h-8 flex items-center justify-center">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
                <div id="recurring-list-container" class="space-y-2"></div>
            </div>
        `
    this.setupRecurringPageListeners(
      this.appContainer.querySelector('.page.active')
    )
  }

  async setupRecurringPageListeners(pageElement) {
    if (!pageElement) return

    const recurringTxs = await this.dataService.getRecurringTransactions()
    const container = pageElement.querySelector('#recurring-list-container')
    container.innerHTML = ''

    if (recurringTxs.length === 0) {
      container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">尚未建立任何週期性交易</p>`
      // Still need to set up the add button listener
    } else {
      for (const tx of recurringTxs) {
        const txEl = document.createElement('div')
        txEl.className =
          'flex items-center justify-between bg-wabi-surface p-4 rounded-lg border border-wabi-border'
        txEl.innerHTML = `
                    <div>
                        <p class="font-medium text-wabi-text-primary">${tx.description}</p>
                        <p class="text-sm text-wabi-text-secondary">金額: ${formatCurrency(tx.amount)} | 下次日期: ${tx.nextDueDate}</p>
                    </div>
                    <div class="flex gap-2">
                        <button class="edit-recurring-btn" data-id="${tx.id}"><i class="fa-solid fa-pen text-wabi-text-secondary"></i></button>
                        <button class="delete-recurring-btn" data-id="${tx.id}"><i class="fa-solid fa-trash-can text-wabi-expense"></i></button>
                    </div>
                `
        container.appendChild(txEl)
      }
    }

    const addBtn = pageElement.querySelector('#add-recurring-btn')
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        await this.showRecurringTransactionModal()
      })
    }

    pageElement.querySelectorAll('.edit-recurring-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const txId = parseInt(e.currentTarget.dataset.id, 10)
        const tx = recurringTxs.find(t => t.id === txId)
        await this.showRecurringTransactionModal(tx)
      })
    })

    pageElement.querySelectorAll('.delete-recurring-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const txId = parseInt(e.currentTarget.dataset.id, 10)
        if (confirm('確定要刪除此週期性交易嗎？')) {
          await this.dataService.deleteRecurringTransaction(txId)
          showToast('已刪除週期性交易')
          this.renderRecurringPage()
        }
      })
    })
  }

  async showRecurringTransactionModal(txToEdit = null) {
    const isEdit = !!txToEdit
    const modal = document.createElement('div')
    modal.id = 'recurring-tx-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    // Ensure accounts are loaded
    const accounts = this.advancedModeEnabled
      ? await this.dataService.getAccounts()
      : []

    // Prepare category and account options
    const expenseCategories = this.categoryManager
      .getAllCategories('expense')
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('')
    const incomeCategories = this.categoryManager
      .getAllCategories('income')
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('')
    const accountOptions = this.advancedModeEnabled
      ? accounts
          .map(acc => `<option value="${acc.id}">${acc.name}</option>`)
          .join('')
      : ''

    modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <h3 class="text-lg font-bold text-wabi-primary">${isEdit ? '編輯' : '新增'}週期性交易</h3>
                
                <div>
                    <label class="text-sm">描述</label>
                    <input type="text" id="recurring-desc" value="${txToEdit?.description || ''}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>

                <div>
                    <label class="text-sm">金額</label>
                    <input type="number" id="recurring-amount" value="${txToEdit?.amount || ''}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>

                <div>
                    <label class="text-sm">類型</label>
                    <div class="flex h-10 w-full items-center justify-center rounded-lg bg-gray-200/50 p-1 mt-1">
                        <button data-type="expense" class="recurring-type-btn flex-1 h-full rounded-md text-sm font-medium">支出</button>
                        <button data-type="income" class="recurring-type-btn flex-1 h-full rounded-md text-sm font-medium">收入</button>
                    </div>
                </div>

                <div>
                    <label class="text-sm">分類</label>
                    <select id="recurring-category" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface"></select>
                </div>

                ${
                  this.advancedModeEnabled
                    ? `
                <div>
                    <label class="text-sm">帳戶</label>
                    <select id="recurring-account" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">${accountOptions}</select>
                </div>
                `
                    : ''
                }

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-sm">頻率</label>
                        <select id="recurring-frequency" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                            <option value="daily">每日</option>
                            <option value="weekly">每週</option>
                            <option value="monthly">每月</option>
                            <option value="yearly">每年</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm">間隔</label>
                        <input type="number" id="recurring-interval" value="${txToEdit?.interval || 1}" min="1" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                    </div>
                </div>

                <div>
                    <label class="text-sm">開始日期</label>
                    <input type="date" id="recurring-start-date" value="${txToEdit?.startDate || formatDateToString(new Date())}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>

                <!-- Skip Rules -->
                <div id="skip-rules-container" class="space-y-2 pt-2 hidden">
                    <label class="text-sm font-medium text-wabi-text-primary">略過規則 (可選)</label>
                    <!-- Weekly Skip -->
                    <div id="skip-weekly-controls" class="hidden">
                        <div class="grid grid-cols-4 gap-2 text-center">
                            ${['日', '一', '二', '三', '四', '五', '六']
                              .map(
                                (day, i) => `
                                <label class="p-2 rounded-lg border border-wabi-border has-[:checked]:bg-wabi-accent has-[:checked]:border-wabi-primary">
                                    <input type="checkbox" name="skipDayOfWeek" value="${i}" class="sr-only">
                                    <span>${day}</span>
                                </label>
                            `
                              )
                              .join('')}
                        </div>
                    </div>
                    <!-- Monthly Skip -->
                    <div id="skip-monthly-controls" class="hidden">
                        <label class="text-sm font-medium text-wabi-text-primary" for="skip-day-of-month-input">略過每月幾號:</label>
                        <input type="text" id="skip-day-of-month-input" placeholder="例如: 15, 31 (用逗號分隔)" class="w-full p-2 rounded-lg border-wabi-border bg-wabi-surface">
                    </div>
                    <!-- Yearly Skip -->
                    <div id="skip-yearly-controls" class="hidden">
                        <label class="text-sm font-medium text-wabi-text-primary" for="skip-month-of-year-input">略過每年幾月:</label>
                         <input type="text" id="skip-month-of-year-input" placeholder="例如: 7, 8 (用逗號分隔)" class="w-full p-2 rounded-lg border-wabi-border bg-wabi-surface">
                    </div>
                </div>

                <div class="flex gap-2 mt-6">
                    <button id="save-recurring-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">儲存</button>
                    <button id="cancel-recurring-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
                </div>
            </div>
        `
    document.body.appendChild(modal)

    const typeExpenseBtn = modal.querySelector(
      '.recurring-type-btn[data-type="expense"]'
    )
    const typeIncomeBtn = modal.querySelector(
      '.recurring-type-btn[data-type="income"]'
    )
    const categorySelect = modal.querySelector('#recurring-category')
    const frequencySelect = modal.querySelector('#recurring-frequency')
    let currentType = txToEdit?.type || 'expense'

    const skipRulesContainer = modal.querySelector('#skip-rules-container')
    const skipWeeklyControls = modal.querySelector('#skip-weekly-controls')
    const skipMonthlyControls = modal.querySelector('#skip-monthly-controls')
    const skipYearlyControls = modal.querySelector('#skip-yearly-controls')

    // Make all skip rule controls visible
    skipRulesContainer.classList.remove('hidden')
    skipWeeklyControls.classList.remove('hidden')
    skipMonthlyControls.classList.remove('hidden')
    skipYearlyControls.classList.remove('hidden')

    const updateCategoryOptions = () => {
      if (currentType === 'expense') {
        categorySelect.innerHTML = expenseCategories
        typeExpenseBtn.classList.add('bg-wabi-expense', 'text-white')
        typeIncomeBtn.classList.remove('bg-wabi-income', 'text-white')
      } else {
        categorySelect.innerHTML = incomeCategories
        typeIncomeBtn.classList.add('bg-wabi-income', 'text-white')
        typeExpenseBtn.classList.remove('bg-wabi-expense', 'text-white')
      }
    }

    updateCategoryOptions()

    if (txToEdit) {
      categorySelect.value = txToEdit.category
      if (this.advancedModeEnabled)
        modal.querySelector('#recurring-account').value = txToEdit.accountId
      frequencySelect.value = txToEdit.frequency

      // Populate skip rules
      if (txToEdit.skipRules && Array.isArray(txToEdit.skipRules)) {
        txToEdit.skipRules.forEach(rule => {
          const { type, values } = rule
          if (type === 'dayOfWeek') {
            values.forEach(day => {
              const checkbox = modal.querySelector(
                `input[name="skipDayOfWeek"][value="${day}"]`
              )
              if (checkbox) checkbox.checked = true
            })
          } else if (type === 'dayOfMonth') {
            modal.querySelector('#skip-day-of-month-input').value =
              values.join(', ')
          } else if (type === 'monthOfYear') {
            // Convert 0-indexed month back to 1-indexed for display
            modal.querySelector('#skip-month-of-year-input').value = values
              .map(m => m + 1)
              .join(', ')
          }
        })
      }
    }

    typeExpenseBtn.addEventListener('click', () => {
      currentType = 'expense'
      updateCategoryOptions()
    })
    typeIncomeBtn.addEventListener('click', () => {
      currentType = 'income'
      updateCategoryOptions()
    })

    const closeModal = () => modal.remove()
    modal
      .querySelector('#cancel-recurring-btn')
      .addEventListener('click', closeModal)
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal()
    })

    modal
      .querySelector('#save-recurring-btn')
      .addEventListener('click', async () => {
        const data = {
          description: modal.querySelector('#recurring-desc').value,
          amount: parseFloat(modal.querySelector('#recurring-amount').value),
          type: currentType,
          category: categorySelect.value,
          accountId: this.advancedModeEnabled
            ? parseInt(modal.querySelector('#recurring-account').value, 10)
            : null,
          frequency: frequencySelect.value,
          interval: parseInt(
            modal.querySelector('#recurring-interval').value,
            10
          ),
          startDate: modal.querySelector('#recurring-start-date').value,
          nextDueDate: modal.querySelector('#recurring-start-date').value, // First due date is the start date
          skipRules: [],
        }

        // Parse all skip rules
        const weeklyValues = [
          ...modal.querySelectorAll('input[name="skipDayOfWeek"]:checked'),
        ].map(cb => parseInt(cb.value, 10))
        if (weeklyValues.length > 0) {
          data.skipRules.push({ type: 'dayOfWeek', values: weeklyValues })
        }

        const monthlyInput = modal.querySelector(
          '#skip-day-of-month-input'
        ).value
        const monthlyValues = monthlyInput
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n >= 1 && n <= 31)
        if (monthlyValues.length > 0) {
          data.skipRules.push({ type: 'dayOfMonth', values: monthlyValues })
        }

        const yearlyInput = modal.querySelector(
          '#skip-month-of-year-input'
        ).value
        const yearlyValues = yearlyInput
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n >= 1 && n <= 12)
        if (yearlyValues.length > 0) {
          // Convert to 0-indexed month for storage
          data.skipRules.push({
            type: 'monthOfYear',
            values: yearlyValues.map(m => m - 1),
          })
        }

        if (data.skipRules.length === 0) {
          data.skipRules = null
        }

        if (
          !data.description ||
          !data.amount ||
          data.amount <= 0 ||
          !data.startDate
        ) {
          showToast('請填寫所有必要欄位', 'error')
          return
        }

        if (isEdit) {
          await this.dataService.updateRecurringTransaction(txToEdit.id, {
            ...txToEdit,
            ...data,
          })
          showToast('週期性交易已更新')
        } else {
          await this.dataService.addRecurringTransaction(data)
          showToast('週期性交易已新增')
        }
        this.renderRecurringPage()
        closeModal()
      })
  }

  async showTransferModal() {
    const accounts = await this.dataService.getAccounts()
    if (accounts.length < 2) {
      showToast('你需要至少兩個帳戶才能轉帳', 'warning')
      return
    }

    const modal = document.createElement('div')
    modal.id = 'transfer-form-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    const accountOptions = accounts
      .map(acc => `<option value="${acc.id}">${acc.name}</option>`)
      .join('')

    modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">建立轉帳</h3>
                <div>
                    <label class="text-sm text-wabi-text-secondary">從</label>
                    <select id="transfer-from-account" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">至</label>
                    <select id="transfer-to-account" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">金額</label>
                    <input type="number" id="transfer-amount" placeholder="0.00" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">日期</label>
                    <input type="date" id="transfer-date" value="${formatDateToString(new Date())}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">備註</label>
                    <input type="text" id="transfer-note" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="save-transfer-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">儲存</button>
                    <button id="cancel-transfer-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
                </div>
            </div>
        `
    document.body.appendChild(modal)

    // Set default selection to different accounts
    const fromSelect = modal.querySelector('#transfer-from-account')
    const toSelect = modal.querySelector('#transfer-to-account')
    if (accounts.length > 1) {
      toSelect.value = accounts[1].id
    }

    const closeModal = () => modal.remove()

    modal
      .querySelector('#cancel-transfer-btn')
      .addEventListener('click', closeModal)
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal()
    })

    modal
      .querySelector('#save-transfer-btn')
      .addEventListener('click', async () => {
        const fromId = parseInt(fromSelect.value, 10)
        const toId = parseInt(toSelect.value, 10)
        const amount = parseFloat(
          document.getElementById('transfer-amount').value
        )
        const date = document.getElementById('transfer-date').value
        const note = document.getElementById('transfer-note').value

        if (fromId === toId) {
          showToast('不能在同一個帳戶內轉帳', 'error')
          return
        }
        if (!amount || amount <= 0) {
          showToast('請輸入有效的金額', 'error')
          return
        }

        const fromAccount = accounts.find(a => a.id === fromId)
        const toAccount = accounts.find(a => a.id === toId)

        const expenseRecord = {
          type: 'expense',
          category: 'transfer', // Special category
          amount: amount,
          date: date,
          description: `${note || ''} (轉出至 ${toAccount.name})`.trim(),
          accountId: fromId,
        }

        const incomeRecord = {
          type: 'income',
          category: 'transfer', // Special category
          amount: amount,
          date: date,
          description: `${note || ''} (從 ${fromAccount.name} 轉入)`.trim(),
          accountId: toId,
        }

        await this.dataService.addRecord(expenseRecord)
        await this.dataService.addRecord(incomeRecord)
        showToast('轉帳成功！')
        this.renderAccountsPage() // Re-render to show updated balances
        closeModal()
      })
  }

  async showExportOptionsModal() {
    const debtEnabled = await this.dataService.getSetting(
      'debtManagementEnabled'
    )
    const showDebtOption = !!debtEnabled?.value
    const advancedModeEnabled = await this.dataService.getSetting(
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
                        <input type="checkbox" id="export-records" checked class="w-5 h-5 rounded border-gray-300 text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">記帳紀錄</p>
                            <p class="text-xs text-wabi-text-secondary">所有收支紀錄</p>
                        </div>
                    </label>
                    ${
                      showAccountOption
                        ? `
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-accounts" checked class="w-5 h-5 rounded border-gray-300 text-wabi-primary focus:ring-wabi-primary">
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
                        <input type="checkbox" id="export-debts" checked class="w-5 h-5 rounded border-gray-300 text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">欠款資料</p>
                            <p class="text-xs text-wabi-text-secondary">聯絡人及欠款紀錄</p>
                        </div>
                    </label>
                    `
                        : ''
                    }
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-categories" checked class="w-5 h-5 rounded border-gray-300 text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">自訂分類</p>
                            <p class="text-xs text-wabi-text-secondary">自訂的收支分類</p>
                        </div>
                    </label>
                </div>
                <div class="flex space-x-3">
                    <button id="confirm-export-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
                        <i class="fa-solid fa-download mr-2"></i>匯出
                    </button>
                    <button id="cancel-export-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
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
            modal.querySelector('#export-accounts')?.checked ?? true,
          includeDebts: modal.querySelector('#export-debts')?.checked ?? true,
          includeCategories:
            modal.querySelector('#export-categories')?.checked ?? true,
        }

        try {
          await this.dataService.exportData(options)
          showToast('資料已成功匯出！', 'success')
          closeModal()
        } catch (error) {
          console.error('匯出失敗:', error)
          showToast('資料匯出失敗', 'error')
        }
      })
  }

  showAccountModal(accountToEdit = null) {
    const isEdit = !!accountToEdit
    const modal = document.createElement('div')
    modal.id = 'account-form-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">${isEdit ? '編輯帳戶' : '新增帳戶'}</h3>
                <div>
                    <label class="text-sm text-wabi-text-secondary">帳戶名稱</label>
                    <input type="text" id="account-name-input" value="${accountToEdit?.name || ''}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface" required>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">初始餘額</label>
                    <input type="number" id="account-balance-input" value="${accountToEdit?.balance || 0}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface" ${isEdit ? 'disabled' : ''}>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">圖示 (Font Awesome)</label>
                    <input type="text" id="account-icon-input" value="${accountToEdit?.icon || 'fa-solid fa-wallet'}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">顏色 (Tailwind CSS)</label>
                    <input type="text" id="account-color-input" value="${accountToEdit?.color || 'bg-blue-500'}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="save-account-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">儲存</button>
                    <button id="cancel-account-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
                </div>
            </div>
        `
    document.body.appendChild(modal)

    const closeModal = () => modal.remove()

    modal
      .querySelector('#cancel-account-btn')
      .addEventListener('click', closeModal)
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal()
    })

    modal
      .querySelector('#save-account-btn')
      .addEventListener('click', async () => {
        const name = document.getElementById('account-name-input').value
        if (!name) {
          showToast('請輸入帳戶名稱', 'error')
          return
        }

        const accountData = {
          name: name,
          balance:
            parseFloat(
              document.getElementById('account-balance-input').value
            ) || 0,
          icon:
            document.getElementById('account-icon-input').value ||
            'fa-solid fa-wallet',
          color:
            document.getElementById('account-color-input').value ||
            'bg-blue-500',
        }

        if (isEdit) {
          await this.dataService.updateAccount(accountToEdit.id, {
            ...accountToEdit,
            ...accountData,
          })
          showToast('帳戶已更新')
        } else {
          await this.dataService.addAccount(accountData)
          showToast('帳戶已新增')
        }
        this.renderAccountsPage() // Re-render the page
        closeModal()
      })
  }

  async handleAdvancedModeActivation() {
    const accounts = await this.dataService.getAccounts()
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
      const newAccountId = await this.dataService.addAccount(newAccount)
      defaultAccount = await this.dataService.getAccount(newAccountId)
      showToast('已建立預設「現金」帳戶')
    } else {
      defaultAccount = accounts[0]
    }

    if (!defaultAccount) {
      console.error('Failed to get or create a default account.')
      return
    }

    const allRecords = await this.dataService.getRecords()
    const recordsToUpdate = allRecords.filter(r => r.accountId === undefined)

    if (recordsToUpdate.length > 0) {
      console.log(
        `Migrating ${recordsToUpdate.length} records to default account...`
      )
      for (const record of recordsToUpdate) {
        await this.dataService.updateRecord(record.id, {
          ...record,
          accountId: defaultAccount.id,
        })
      }
      console.log('Record migration complete.')
      showToast(`${recordsToUpdate.length} 筆舊紀錄已歸入預設帳戶`)
    }
  }

  showPaymentModal(debt, recordId, remainingAmount) {
    const isReceivable = debt.type === 'receivable'

    const modal = document.createElement('div')
    modal.id = 'payment-modal'
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

    modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
                <h3 class="text-lg font-semibold mb-4 text-wabi-primary">
                    <i class="fa-solid fa-coins mr-2"></i>${isReceivable ? '登記收款' : '登記還款'}
                </h3>
                <p class="text-sm text-wabi-text-secondary mb-4">
                    剩餘金額：<span class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${formatCurrency(remainingAmount)}</span>
                </p>
                
                <div class="mb-4">
                    <label class="text-sm font-medium text-wabi-text-primary mb-2 block">還款金額</label>
                    <input type="number" id="payment-amount-input" value="" min="1" max="${remainingAmount}" step="1" placeholder="輸入金額"
                           class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary text-lg">
                </div>

                <div class="flex gap-2 mb-4">
                    <button id="pay-full-btn" class="flex-1 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg bg-wabi-primary/10">
                        <i class="fa-solid fa-check-double mr-1"></i>全額還清
                    </button>
                </div>

                <div class="flex gap-3">
                    <button id="confirm-payment-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
                        確認
                    </button>
                    <button id="cancel-payment-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `

    document.body.appendChild(modal)

    const closeModal = () => modal.remove()
    const amountInput = modal.querySelector('#payment-amount-input')

    modal
      .querySelector('#cancel-payment-btn')
      .addEventListener('click', closeModal)
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal()
    })

    // Focus input
    setTimeout(() => amountInput.focus(), 100)

    // Pay full amount button
    modal.querySelector('#pay-full-btn').addEventListener('click', () => {
      amountInput.value = remainingAmount
    })

    // Confirm payment
    modal
      .querySelector('#confirm-payment-btn')
      .addEventListener('click', async () => {
        const amount = parseFloat(amountInput.value)

        if (!amount || amount <= 0) {
          showToast('請輸入有效金額', 'error')
          return
        }

        if (amount > remainingAmount) {
          showToast(
            `金額不能超過剩餘金額 ${formatCurrency(remainingAmount)}`,
            'error'
          )
          return
        }

        await this.dataService.settleDebt(debt.id, amount)
        closeModal()
        showToast('還款成功！')
        await this.renderAddPage(recordId)
      })
  }

  async setupAddPageListeners(recordId) {
    const isEditMode = !!recordId
    let recordToEdit = null

    const advancedMode = await this.dataService.getSetting(
      'advancedAccountModeEnabled'
    )
    const advancedModeEnabled = !!advancedMode?.value

    const debtManagement = await this.dataService.getSetting(
      'debtManagementEnabled'
    )
    const debtManagementEnabled = !!debtManagement?.value

    let currentType = 'expense'
    let currentAmount = '0'
    let selectedCategory = null
    let selectedAccountId = null // New state for multi-account mode
    let currentDate = formatDateToString(new Date())
    let keypadGridOpen = true

    // Debt panel state
    let debtEnabled = false
    let debtType = 'receivable'
    let debtContactId = null

    const amountDisplay = document.getElementById('add-amount-display')
    const categoryGrid = document.getElementById('add-category-grid')

    // Back Button Logic
    document
      .getElementById('add-page-close-btn')
      .addEventListener('click', () => {
        if (window.history.length > 1) {
          window.history.back()
        } else {
          window.location.hash = '#home'
        }
      })
    const selectedCategoryUI = document.getElementById('add-selected-category')
    const noteInput = document.getElementById('add-note-input')
    const dateInput = document.getElementById('add-date-input')
    const dateDisplay = document.getElementById('add-date-display')
    const keypadContainer = document.getElementById('keypad-container')
    const keypadGrid = document.getElementById('keypad-grid')
    const keypadToggleBtn = document.getElementById('keypad-toggle-btn')
    const expenseBtn = document.getElementById('add-type-expense')
    const incomeBtn = document.getElementById('add-type-income')
    const quickSelectContainer = document.getElementById(
      'quick-select-container'
    )
    const debtPanel = document.getElementById('debt-panel')
    const toggleDebtBtn = document.getElementById('toggle-debt-btn')

    // Plugin Support: Pre-fill from Session Storage
    if (!recordId) {
      const tempDataStr = sessionStorage.getItem('temp_add_data')
      if (tempDataStr) {
        try {
          const tempData = JSON.parse(tempDataStr)
          if (tempData.type) currentType = tempData.type
          if (tempData.amount) currentAmount = tempData.amount.toString()
          if (tempData.category) selectedCategory = tempData.category
          if (tempData.description && noteInput)
            noteInput.value = tempData.description
          if (amountDisplay)
            amountDisplay.textContent = formatCurrency(currentAmount)
          sessionStorage.removeItem('temp_add_data')
        } catch (e) {
          console.error('Error applying temp data:', e)
        }
      }
    }

    // Setup debt panel if available
    if (toggleDebtBtn && debtPanel) {
      const loadContacts = async () => {
        const contacts = await this.dataService.getContacts()
        const select = document.getElementById('debt-contact-select')
        if (select) {
          select.innerHTML =
            `<option value="">選擇聯絡人...</option>` +
            contacts
              .map(c => `<option value="${c.id}">${c.name}</option>`)
              .join('')
        }
      }

      toggleDebtBtn.addEventListener('click', async () => {
        debtEnabled = !debtEnabled
        debtPanel.classList.toggle('hidden', !debtEnabled)
        toggleDebtBtn.classList.toggle('text-wabi-primary', debtEnabled)
        toggleDebtBtn.classList.toggle('bg-wabi-primary/10', debtEnabled)
        toggleDebtBtn.classList.toggle('text-wabi-text-secondary', !debtEnabled)
        if (debtEnabled) {
          await loadContacts()
        }
      })

      document
        .getElementById('close-debt-panel')
        ?.addEventListener('click', () => {
          debtEnabled = false
          debtPanel.classList.add('hidden')
          toggleDebtBtn.classList.remove(
            'text-wabi-primary',
            'bg-wabi-primary/10'
          )
          toggleDebtBtn.classList.add('text-wabi-text-secondary')
        })

      document.querySelectorAll('.debt-add-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          debtType =
            btn.id === 'debt-type-receivable-add' ? 'receivable' : 'payable'
          document.querySelectorAll('.debt-add-type-btn').forEach(b => {
            b.classList.remove(
              'bg-wabi-income',
              'bg-wabi-expense',
              'text-white'
            )
            b.classList.add('text-wabi-text-secondary')
          })
          if (debtType === 'receivable') {
            btn.classList.add('bg-wabi-income', 'text-white')
          } else {
            btn.classList.add('bg-wabi-expense', 'text-white')
          }
          btn.classList.remove('text-wabi-text-secondary')
        })
      })

      document
        .getElementById('debt-contact-select')
        ?.addEventListener('change', e => {
          debtContactId = e.target.value ? parseInt(e.target.value) : null
        })
    }

    // --- Account Selector Logic ---
    const accountSelectorContainer = document.getElementById(
      'account-selector-container'
    )
    let accounts = []

    const updateAccountSelectorUI = () => {
      if (!advancedModeEnabled || !accountSelectorContainer) return
      const selectedAccount = accounts.find(a => a.id === selectedAccountId)
      if (selectedAccount) {
        accountSelectorContainer.innerHTML = `
                    <label class="text-sm text-wabi-text-secondary">帳戶</label>
                    <button id="account-selector-btn" class="w-full flex items-center justify-between bg-wabi-surface py-1 px-2 mt-1 rounded-lg border border-wabi-border">
                        <div class="flex items-center gap-3 truncate">
                            <i class="${selectedAccount.icon} text-lg"></i>
                            <span class="font-medium">${selectedAccount.name}</span>
                        </div>
                        <i class="fa-solid fa-chevron-down text-xs text-wabi-text-secondary"></i>
                    </button>
                `
        document
          .getElementById('account-selector-btn')
          .addEventListener('click', () => {
            this.showAccountSelectionModal(
              accounts,
              selectedAccountId,
              newAccountId => {
                selectedAccountId = newAccountId
                updateAccountSelectorUI()
              }
            )
          })
      } else if (accounts.length > 0) {
        // If no account is selected (e.g. from a quick select without one), default to the first
        selectedAccountId = accounts[0].id
        updateAccountSelectorUI()
      }
    }

    if (advancedModeEnabled) {
      accounts = await this.dataService.getAccounts()
      if (accounts.length > 0) {
        selectedAccountId = accounts[0].id // Default to first account
      } else {
        accountSelectorContainer.innerHTML = `<p class="text-center text-red-500">請先至「設定」頁面建立一個帳戶</p>`
      }
    }

    const toggleKeypadGrid = force => {
      const shouldOpen = force === undefined ? !keypadGridOpen : force
      if (shouldOpen) {
        keypadGrid.style.display = 'grid'
        keypadToggleBtn.classList.add('bg-wabi-accent', 'text-wabi-primary')
      } else {
        keypadGrid.style.display = 'none'
        keypadToggleBtn.classList.remove('bg-wabi-accent', 'text-wabi-primary')
      }
      keypadGridOpen = shouldOpen
    }

    keypadContainer.classList.remove('translate-y-full')

    const updateTypeUI = () => {
      if (currentType === 'expense') {
        expenseBtn.classList.add('bg-wabi-expense', 'text-white', 'shadow-sm')
        incomeBtn.classList.remove('bg-wabi-income', 'text-white', 'shadow-sm')
        amountDisplay.classList.remove('text-wabi-income')
        amountDisplay.classList.add('text-wabi-expense')
      } else {
        incomeBtn.classList.add('bg-wabi-income', 'text-white', 'shadow-sm')
        expenseBtn.classList.remove(
          'bg-wabi-expense',
          'text-white',
          'shadow-sm'
        )
        amountDisplay.classList.remove('text-wabi-expense')
        amountDisplay.classList.add('text-wabi-income')
      }
      renderCategories()
      const category = this.categoryManager.getCategoryById(
        currentType,
        selectedCategory
      )
      updateSelectedCategoryUI(category)
    }

    const renderCategories = () => {
      categoryGrid.innerHTML = ''
      const categories = this.categoryManager.getAllCategories(currentType)
      categories.forEach(cat => {
        const btn = document.createElement('button')
        btn.className =
          'category-button flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-transparent'
        btn.dataset.categoryId = cat.id
        if (cat.id === selectedCategory) {
          btn.classList.add(
            currentType === 'income' ? 'active-income' : 'active'
          )
        }

        const colorStyle = cat.color.startsWith('#')
          ? `style="background-color: ${cat.color}"`
          : ''
        const colorClass = !cat.color.startsWith('#') ? cat.color : ''

        btn.innerHTML = `
                    <div class="flex size-14 items-center justify-center rounded-full ${colorClass} text-white" ${colorStyle}>
                        <i class="${cat.icon} text-3xl"></i>
                    </div>
                    <p class="text-xs text-center text-wabi-text-secondary">${cat.name}</p>
                `
        btn.addEventListener('click', () => {
          selectedCategory = cat.id
          updateSelectedCategoryUI(cat)
          document
            .querySelectorAll('.category-button')
            .forEach(b => b.classList.remove('active', 'active-income'))
          btn.classList.add(
            currentType === 'income' ? 'active-income' : 'active'
          )
        })
        categoryGrid.appendChild(btn)
      })
      const manageBtn = document.createElement('button')
      manageBtn.className =
        'flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-dashed border-wabi-border hover:border-wabi-primary'
      manageBtn.innerHTML = `<div class="flex size-14 items-center justify-center rounded-full bg-wabi-bg"><i class="fa-solid fa-gear text-3xl text-wabi-text-secondary"></i></div><p class="text-xs text-center text-wabi-text-secondary">管理</p>`
      manageBtn.addEventListener('click', () =>
        this.categoryManager.showManageCategoriesModal(
          currentType,
          renderCategories
        )
      )
      categoryGrid.appendChild(manageBtn)
    }

    const updateSelectedCategoryUI = category => {
      if (category) {
        const colorStyle = category.color.startsWith('#')
          ? `style="background-color: ${category.color}"`
          : ''
        const colorClass = !category.color.startsWith('#') ? category.color : ''
        selectedCategoryUI.innerHTML = `
                    <div class="flex items-center justify-center rounded-full ${colorClass} text-white shrink-0 size-12" ${colorStyle}>
                        <i class="${category.icon} text-3xl"></i>
                    </div>
                    <p class="text-lg font-medium flex-1 truncate">${category.name}</p>
                `
      } else {
        selectedCategoryUI.innerHTML = `<div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12"><i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i></div><p class="text-lg font-medium">選擇分類</p>`
      }
    }

    const handleKeypad = async key => {
      if ((key >= '0' && key <= '9') || key === '00') {
        if (currentAmount === '0') currentAmount = ''
        if (currentAmount.replace('.', '').length < 9) currentAmount += key
      } else if (key === '.') {
        if (!currentAmount.includes('.')) currentAmount += '.'
      } else if (key === 'backspace') {
        currentAmount = currentAmount.slice(0, -1) || '0'
      } else if (key === 'ac') {
        currentAmount = '0'
      } else if (key === 'done') {
        toggleKeypadGrid(false)
      } else if (key === 'save') {
        const amount = parseFloat(currentAmount)
        if (advancedModeEnabled && !selectedAccountId) {
          showToast('請先建立一個帳戶', 'error')
          return
        }
        if (debtEnabled && !debtContactId) {
          showToast('請選擇欠款聯絡人', 'error')
          return
        }
        if (amount > 0 && selectedCategory) {
          const recordData = {
            type: currentType,
            category: selectedCategory,
            amount: amount,
            description: noteInput.value,
            date: currentDate,
            accountId: advancedModeEnabled ? selectedAccountId : null,
          }

          let newRecordId = null
          if (isEditMode) {
            try {
              const numericId = parseInt(recordId, 10)
              await this.dataService.updateRecord(numericId, recordData)

              // If record has existing debt, check if amount changed and update
              if (recordToEdit.debtId && recordToEdit.amount !== amount) {
                const debt = await this.dataService.getDebt(recordToEdit.debtId)
                if (debt && !debt.settled) {
                  // Update debt amount proportionally
                  const oldOriginal = debt.originalAmount ?? debt.amount ?? 0
                  const oldRemaining = debt.remainingAmount ?? oldOriginal
                  const paidAmount = oldOriginal - oldRemaining
                  const newRemaining = Math.max(0, amount - paidAmount)
                  await this.dataService.updateDebt(recordToEdit.debtId, {
                    originalAmount: amount,
                    remainingAmount: newRemaining,
                  })
                }
              }

              // If record doesn't have debt but user enabled debt, create one
              if (debtEnabled && debtContactId && !recordToEdit.debtId) {
                const debtId = await this.dataService.addDebt({
                  type: debtType,
                  contactId: debtContactId,
                  amount: amount,
                  date: currentDate,
                  description: noteInput.value || selectedCategory,
                  recordId: numericId,
                })
                await this.dataService.updateRecord(numericId, {
                  debtId: debtId,
                })
                showToast('更新成功並建立欠款記錄！')
              } else {
                showToast('更新成功！')
              }

              // Proceed to navigation only on success
              window.location.hash = 'records'
            } catch (e) {
              console.error('Update failed or cancelled:', e)
              // Stay on page
              return
            }
          } else {
            newRecordId = await this.dataService.addRecord(recordData)
            if (!newRecordId) return // Cancelled by plugin or error
            this.quickSelectManager.addRecord(
              recordData.type,
              recordData.category,
              recordData.description,
              recordData.accountId
            )

            // Create debt record if enabled
            if (debtEnabled && debtContactId) {
              const debtId = await this.dataService.addDebt({
                type: debtType,
                contactId: debtContactId,
                amount: amount,
                date: currentDate,
                description: noteInput.value || selectedCategory,
                recordId: newRecordId,
              })
              // Update record with debtId to create bidirectional link
              await this.dataService.updateRecord(newRecordId, {
                debtId: debtId,
              })
              showToast('儲存成功並建立欠款記錄！')
            } else {
              showToast('儲存成功！')
            }
            window.location.hash = 'records'
          }
        } else {
          showToast('請輸入金額並選擇分類', 'error')
        }
      }
      amountDisplay.textContent = formatCurrency(currentAmount)
    }

    if (isEditMode) {
      const numericRecordId = parseInt(recordId, 10)
      const records = await this.dataService.getRecords()
      recordToEdit = records.find(r => r.id === numericRecordId)
      if (recordToEdit) {
        currentType = recordToEdit.type
        currentAmount = String(recordToEdit.amount)
        selectedCategory = recordToEdit.category
        currentDate = recordToEdit.date
        noteInput.value = recordToEdit.description
        if (advancedModeEnabled) {
          selectedAccountId = recordToEdit.accountId
        }
        amountDisplay.textContent = formatCurrency(currentAmount)
        dateDisplay.textContent = formatDate(currentDate, 'short')
        dateInput.value = currentDate

        // Load associated debt if exists
        if (recordToEdit.debtId) {
          const debt = await this.dataService.getDebt(recordToEdit.debtId)
          if (debt) {
            const contacts = await this.dataService.getContacts()
            const contact = contacts.find(c => c.id === debt.contactId)
            const contactName = contact?.name || '未知聯絡人'
            const isReceivable = debt.type === 'receivable'
            const remainingAmount =
              debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0
            const originalAmount = debt.originalAmount ?? debt.amount ?? 0
            const paidPercent =
              originalAmount > 0
                ? Math.round(
                    ((originalAmount - remainingAmount) / originalAmount) * 100
                  )
                : 0

            // Store debt info for later use
            debtContactId = debt.contactId
            debtType = debt.type
            debtEnabled = true

            // Build contact options for edit
            const contactOptions = contacts
              .map(
                c =>
                  `<option value="${c.id}" ${c.id === debt.contactId ? 'selected' : ''}>${c.name}</option>`
              )
              .join('')

            // Show debt info panel
            const debtInfoPanel = document.createElement('div')
            debtInfoPanel.id = 'debt-info-panel'
            debtInfoPanel.className =
              'bg-orange-50 rounded-lg p-4 mb-4 border border-orange-200'
            debtInfoPanel.innerHTML = `
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-medium text-orange-700">
                                    <i class="fa-solid fa-handshake mr-2"></i>關聯欠款
                                </span>
                                ${debt.settled ? '<span class="text-xs bg-wabi-income/20 text-wabi-income px-2 py-1 rounded">已還清</span>' : ''}
                            </div>
                            ${
                              !debt.settled
                                ? `
                                <!-- Editable debt info -->
                                <div class="space-y-2 mb-3">
                                    <div class="flex gap-2">
                                        <button id="debt-type-receivable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${isReceivable ? 'bg-wabi-income text-white border-wabi-income' : 'border-orange-300 text-orange-600'}">
                                            別人欠我
                                        </button>
                                        <button id="debt-type-payable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${!isReceivable ? 'bg-wabi-expense text-white border-wabi-expense' : 'border-orange-300 text-orange-600'}">
                                            我欠別人
                                        </button>
                                    </div>
                                    <select id="debt-contact-edit" class="w-full p-2 border border-orange-300 rounded-lg text-sm bg-white">
                                        ${contactOptions}
                                    </select>
                                </div>
                                <!-- Progress bar -->
                                <div class="mb-3">
                                    <div class="flex justify-between text-xs text-orange-600 mb-1">
                                        <span>剩餘：${formatCurrency(remainingAmount)}</span>
                                        <span>${paidPercent}% 已還</span>
                                    </div>
                                    <div class="w-full bg-orange-200 rounded-full h-2">
                                        <div class="bg-wabi-income h-2 rounded-full" style="width: ${paidPercent}%"></div>
                                    </div>
                                </div>
                                <!-- Action buttons -->
                                <div class="flex gap-2">
                                    <button id="partial-pay-btn" class="flex-1 py-2 text-sm font-medium text-white bg-wabi-primary rounded-lg">
                                        <i class="fa-solid fa-coins mr-1"></i>還款
                                    </button>
                                    <button id="remove-debt-link-btn" class="py-2 px-3 text-sm font-medium text-red-600 border border-red-300 rounded-lg bg-white">
                                        <i class="fa-solid fa-unlink"></i>
                                    </button>
                                </div>
                            `
                                : `
                                <div class="text-sm text-orange-600">
                                    <p><strong>聯絡人：</strong>${contactName}</p>
                                    <p><strong>類型：</strong>${isReceivable ? '別人欠我' : '我欠別人'}</p>
                                    <p><strong>原始金額：</strong>${formatCurrency(originalAmount)}</p>
                                </div>
                            `
                            }
                        `

            // Insert after header
            const header = this.appContainer.querySelector(
              '.page .flex.items-center.pb-2'
            )
            if (header && header.nextElementSibling) {
              header.parentNode.insertBefore(
                debtInfoPanel,
                header.nextElementSibling
              )
            }

            // Hide the toggle debt button since this record already has a debt
            if (toggleDebtBtn) {
              toggleDebtBtn.classList.add('hidden')
            }
            if (debtPanel) {
              debtPanel.classList.add('hidden')
            }

            // Bind debt type edit buttons
            document
              .getElementById('debt-type-receivable-edit')
              ?.addEventListener('click', async () => {
                await this.dataService.updateDebt(debt.id, {
                  type: 'receivable',
                })
                showToast('欠款類型已更新')
                await this.renderAddPage(recordId)
              })
            document
              .getElementById('debt-type-payable-edit')
              ?.addEventListener('click', async () => {
                await this.dataService.updateDebt(debt.id, { type: 'payable' })
                showToast('欠款類型已更新')
                await this.renderAddPage(recordId)
              })

            // Bind contact edit
            document
              .getElementById('debt-contact-edit')
              ?.addEventListener('change', async e => {
                const newContactId = parseInt(e.target.value)
                if (newContactId) {
                  await this.dataService.updateDebt(debt.id, {
                    contactId: newContactId,
                  })
                  showToast('欠款人已更新')
                }
              })

            // Bind partial payment button - show custom modal
            const partialPayBtn = document.getElementById('partial-pay-btn')
            if (partialPayBtn) {
              partialPayBtn.addEventListener('click', () => {
                this.showPaymentModal(debt, recordId, remainingAmount)
              })
            }

            // Bind remove debt link button
            const removeDebtBtn = document.getElementById(
              'remove-debt-link-btn'
            )
            if (removeDebtBtn) {
              removeDebtBtn.addEventListener('click', async () => {
                if (
                  confirm('確定要取消此記錄與欠款的關聯嗎？欠款記錄將被刪除。')
                ) {
                  await this.dataService.deleteDebt(debt.id)
                  await this.dataService.updateRecord(numericRecordId, {
                    debtId: null,
                  })
                  showToast('已取消欠款關聯')
                  await this.renderAddPage(recordId)
                }
              })
            }
          }
        }
      }
    }

    const handleQuickSelect = (type, categoryId, description, accountId) => {
      if (isEditMode) return

      currentType = type
      selectedCategory = categoryId
      noteInput.value = description

      if (advancedModeEnabled && accountId !== null) {
        selectedAccountId = accountId
        updateAccountSelectorUI()
      }

      updateTypeUI()
    }

    if (!isEditMode) {
      this.quickSelectManager.render(
        quickSelectContainer,
        handleQuickSelect,
        this.categoryManager,
        advancedModeEnabled
      )
    }

    keypadToggleBtn.addEventListener('click', () => toggleKeypadGrid())
    dateInput.addEventListener('change', e => {
      currentDate = e.target.value
      dateDisplay.textContent = formatDate(currentDate, 'short')
    })
    document.querySelectorAll('.keypad-btn').forEach(btn => {
      btn.addEventListener('click', () => handleKeypad(btn.dataset.key))
    })

    // Add physical keyboard listener for the add page
    if (this._keypadListener) {
      document.removeEventListener('keydown', this._keypadListener)
    }
    this._keypadListener = e => {
      if (this.currentHash && !this.currentHash.startsWith('#add')) return
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      )
        return
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const keyMap = {
        0: '0',
        1: '1',
        2: '2',
        3: '3',
        4: '4',
        5: '5',
        6: '6',
        7: '7',
        8: '8',
        9: '9',
        '.': '.',
        Backspace: 'backspace',
        Enter: 'save',
        Delete: 'ac',
        Escape: 'ac',
      }
      if (keyMap[e.key]) {
        e.preventDefault()
        handleKeypad(keyMap[e.key])
      }
    }
    document.addEventListener('keydown', this._keypadListener)

    expenseBtn.addEventListener('click', () => {
      if (!isEditMode) {
        currentType = 'expense'
        updateTypeUI()
      }
    })
    incomeBtn.addEventListener('click', () => {
      if (!isEditMode) {
        currentType = 'income'
        updateTypeUI()
      }
    })

    if (isEditMode) {
      document
        .getElementById('delete-record-btn')
        .addEventListener('click', async () => {
          if (confirm('確定要刪除這筆紀錄嗎？')) {
            await this.dataService.deleteRecord(parseInt(recordId, 10))
            showToast('紀錄已刪除')
            window.location.hash = 'records'
          }
        })
    }

    updateTypeUI()
    updateAccountSelectorUI()
    toggleKeypadGrid(true)
  }

  createKeypadButton(key, isEditMode = false) {
    let content = key
    if (key === 'ac') content = 'AC'
    if (key === 'backspace') content = '<i class="fa-solid fa-delete-left"></i>'
    if (key === 'save')
      content = isEditMode
        ? '<span class="font-bold">更新</span>'
        : '<span class="font-bold">儲存</span>'

    const specialClasses =
      {
        save: 'row-span-2 bg-wabi-accent text-wabi-primary',
        ac: 'bg-gray-300/80',
        '': 'bg-transparent',
      }[key] || ''

    if (key === '') return `<div class="${specialClasses}"></div>`

    return `
            <button data-key="${key}" class="keypad-btn text-xl py-3 text-center rounded-none transition-colors touch-manipulation duration-200 ease-in-out ${specialClasses} hover:bg-gray-300/80">
                ${content}
            </button>
        `
  }

  createSettingItem(icon, text, id) {
    return `
            <button id="${id}" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-gray-100/50">
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
    if (confirm('確定要強制更新嗎？這將會清除所有快取資料並重新載入 App。')) {
      showToast('強制更新中...')
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map(key => caches.delete(key)))
        window.location.reload(true)
      } catch (error) {
        console.error('強制更新失敗:', error)
        showToast('強制更新失敗', 'error')
      }
    }
  }

  showUpdateAvailable(registration) {
    const toast = document.getElementById('toast')
    toast.innerHTML = `
            <span>發現新版本！</span>
            <button id="update-now-btn" class="ml-4 font-bold underline">立即更新</button>
        `
    toast.className =
      'fixed top-5 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg toast-show z-50'

    document.getElementById('update-now-btn').addEventListener('click', () => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
      toast.classList.replace('toast-show', 'toast-hide')
    })
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration =
          await navigator.serviceWorker.register('/serviceWorker.js')
        console.log('Service Worker registered')

        // Listen for controller change to reload the page
        let refreshing = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return
          refreshing = true
          window.location.reload()
        })

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              this.showUpdateAvailable(registration)
            }
          })
        })
      } catch (error) {
        console.error('Service Worker registration failed:', error)
      }
    }
  }
  async renderStorePage() {
    this.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 h-full flex flex-col bg-wabi-bg max-w-3xl mx-auto">
                <header class="flex items-center gap-4 mb-4 shrink-0 bg-white p-4 -m-4 mb-4 shadow-sm border-b border-gray-100 sticky top-0 z-10">
                    <a href="#plugins" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600 transition-colors">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <div class="flex-1 relative">
                        <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input type="text" id="store-search" class="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-full outline-none focus:ring-2 focus:ring-wabi-primary transition-all placeholder-gray-400" placeholder="搜尋擴充功能...">
                    </div>
                </header>
                
                <div id="full-store-list" class="flex-1 overflow-y-auto space-y-3 pb-8">
                     <div class="text-center py-12 text-wabi-text-secondary animate-pulse">載入中...</div>
                </div>
            </div>
        `

    const plugins = await this.pluginManager.getInstalledPlugins()

    try {
      const res = await fetch(`plugins/index.json?t=${Date.now()}`)
      if (res.ok) {
        const storePlugins = await res.json()
        this.renderStoreList(storePlugins, plugins)

        // Search Logic
        document.getElementById('store-search').addEventListener('input', e => {
          const term = e.target.value.toLowerCase().trim()
          const filtered = storePlugins.filter(
            p =>
              p.name.toLowerCase().includes(term) ||
              p.description.toLowerCase().includes(term) ||
              (p.author && p.author.toLowerCase().includes(term))
          )
          this.renderStoreList(filtered, plugins)
        })
      }
    } catch (e) {
      document.getElementById('full-store-list').innerHTML =
        `<div class="text-center py-12 text-red-500">無法載入商店資料</div>`
    }
  }

  renderStoreList(list, installedPlugins) {
    const container = document.getElementById('full-store-list')
    if (list.length === 0) {
      container.innerHTML = `<div class="text-center py-12 text-gray-400">沒有找到相關插件</div>`
      return
    }

    container.innerHTML = list
      .map(p => {
        const installed = installedPlugins.find(i => i.id === p.id)
        let btnHtml = ''

        if (installed) {
          if (
            this.pluginManager.compareVersions(p.version, installed.version) > 0
          ) {
            btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-yellow-500 text-white hover:bg-yellow-600 shadow" data-url="${p.file}" data-id="${p.id}">更新 (v${p.version})</button>`
          } else {
            btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-green-100 text-green-700 cursor-default" disabled>已安裝</button>`
          }
        } else {
          btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-wabi-primary text-white hover:bg-opacity-90 shadow" data-url="${p.file}" data-id="${p.id}">安裝</button>`
        }

        return `
                    <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-wabi-primary transition-colors group">
                        <div class="flex items-center gap-4">
                            <div class="bg-wabi-primary/10 text-wabi-primary rounded-xl size-14 flex items-center justify-center text-2xl aspect-square group-hover:scale-110 transition-transform">
                                <i class="fa-solid ${p.icon || 'fa-puzzle-piece'}"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-gray-800 text-lg">${p.name}</h4>
                                <p class="text-sm text-gray-500 line-clamp-1">${p.description}</p>
                                <p class="text-xs text-gray-400 mt-1">v${p.version} • ${p.author || 'Unknown'}</p>
                            </div>
                        </div>
                        ${btnHtml}
                    </div>
             `
      })
      .join('')

    // Bind Store Page Buttons
    container.querySelectorAll('.store-install-btn').forEach(btn => {
      if (!btn.disabled) {
        btn.addEventListener('click', async () => {
          const originalText = btn.innerHTML
          btn.disabled = true
          btn.textContent = '下載中...'

          try {
            const response = await fetch(btn.dataset.url)
            const script = await response.text()
            const file = new File([script], 'plugin.js', {
              type: 'text/javascript',
            })
            // 找到對應的商店插件資訊，傳入權限與 icon
            const matchedPlugin = list.find(sp => sp.id === btn.dataset.id)
            await this.pluginManager.installPlugin(file, matchedPlugin || null)
            showToast('安裝成功！', 'success')

            // Updates UI
            // Fetch latest status
            const newPlugins = await this.pluginManager.getInstalledPlugins()
            this.renderStorePage()
          } catch (e) {
            console.error(e)
            if (
              e.message !== '使用者取消安裝' &&
              e.message !== '使用者取消更新'
            ) {
              showToast('安裝失敗', 'error')
            }
            btn.disabled = false
            btn.innerHTML = originalText
          }
        })
      }
    })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new EasyAccountingApp()
})

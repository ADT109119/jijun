import {
    formatDate,
    formatDateToString,
    formatCurrency,
    showToast,
    escapeHTML,
    calculateAmortizationDetails,
    calculateNextDueDate,
    customConfirm,
    customAlert,
} from '../utils.js'
import { VirtualKeyboardDetector } from '../virtualKeyboardDetector.js'

export class AddPage {
    constructor(app) {
        this.app = app
        this.aiService = this.app.aiService
        this._keypadListener = null
    }

    async render(params) {
        const recordId = params.get('id')
        const isEditMode = !!recordId
        if (this.app.updateNavAddIcon) {
            this.app.updateNavAddIcon(isEditMode)
        }
        const debtEnabled = await this.app.dataService.getSetting(
            'debtManagementEnabled'
        )
        const showDebtBtn = !!debtEnabled?.value
        const groupEnabledSetting = await this.app.dataService.getSetting(
            'groupManagementEnabled'
        )
        const showGroupBtn = !!groupEnabledSetting?.value
        const amortizationEnabled = await this.app.dataService.getSetting(
            'amortizationEnabled'
        )
        const showInstallmentBtn = !!amortizationEnabled?.value

        // 計算機模式設定（預設為啟用）
        const calculatorModeSetting = await this.app.dataService.getSetting(
            'calculatorModeEnabled'
        )
        const calculatorModeEnabled = calculatorModeSetting
            ? !!calculatorModeSetting.value
            : true

        // 根據計算機模式產生不同的鍵盤佈局
        // 計算機模式: 5欄 (數字3欄 + 運算符1欄 + 功能鍵1欄)
        // 運算符排列: +, -, ×, ÷ (從上到下，符合標準計算機習慣)
        const keypadGridCols = calculatorModeEnabled
            ? 'grid-cols-5'
            : 'grid-cols-4'
        const keypadKeys = calculatorModeEnabled
            ? [
                  '1',
                  '2',
                  '3',
                  '+',
                  'backspace',
                  '4',
                  '5',
                  '6',
                  '-',
                  'ac',
                  '7',
                  '8',
                  '9',
                  '×',
                  'save',
                  '00',
                  '0',
                  '.',
                  '÷',
              ]
            : [
                  '1',
                  '2',
                  '3',
                  'backspace',
                  '4',
                  '5',
                  '6',
                  'ac',
                  '7',
                  '8',
                  '9',
                  'save',
                  '00',
                  '0',
                  '.',
                  '',
              ]

        // Use a fixed container to ensure perfect pinning to the viewport (considering bottom nav on mobile)
        this.app.appContainer.innerHTML = `
            <div id="add-page-wrapper" class="fixed top-0 left-0 right-0 bottom-20 md:bottom-0 md:left-64 flex flex-col overflow-hidden bg-wabi-bg z-20">
                <!-- Scrollable Content Area -->
                <div class="flex-1 overflow-y-auto">
                    <div class="page active p-4 max-w-3xl mx-auto">
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
                                    <button id="toggle-debt-btn" class="size-10 flex items-center justify-center rounded-full text-wabi-text-secondary hover:bg-wabi-bg" title="標記為欠款">
                                        <i class="fa-solid fa-handshake text-lg"></i>
                                    </button>
                                `
                                        : ''
                                }
                                ${
                                    showGroupBtn
                                        ? `
                                    <button id="toggle-group-btn" class="size-10 flex items-center justify-center rounded-full text-wabi-text-secondary hover:bg-wabi-bg" title="加入群組">
                                        <i class="fa-solid fa-layer-group text-lg"></i>
                                    </button>
                                `
                                        : ''
                                }
                                ${
                                    showInstallmentBtn
                                        ? `
                                    <button id="toggle-installment-btn" class="size-10 flex items-center justify-center rounded-full text-wabi-text-secondary hover:bg-wabi-bg" title="建立分期/攤提">
                                        <i class="fa-solid fa-credit-card text-lg"></i>
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
                            <div class="flex h-9 w-full items-center justify-center rounded-lg bg-wabi-primary/5 p-1 mb-3">
                                <button id="debt-type-receivable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-income text-wabi-surface">別人欠我</button>
                                <button id="debt-type-payable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">我欠別人</button>
                            </div>
                            <select id="debt-contact-select" class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm">
                                <option value="">選擇聯絡人...</option>
                            </select>
                            <p class="text-xs text-wabi-text-secondary mt-2">儲存時將同時建立欠款記錄</p>
                        </div>

                        <!-- Installment Panel (hidden by default) -->
                        <div id="installment-panel" class="hidden bg-blue-500/10 rounded-lg p-4 mb-4 border border-blue-500/30">
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-medium text-blue-600"><i class="fa-solid fa-credit-card mr-2"></i>分期/攤提</span>
                                <button id="close-installment-panel" class="text-wabi-text-secondary hover:text-blue-600">
                                    <i class="fa-solid fa-times"></i>
                                </button>
                            </div>
                            <div class="mb-2">
                                <input type="text" id="installment-name" maxlength="40" placeholder="名稱（如：MacBook 分期）"
                                    class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div class="flex h-9 w-full items-center justify-center rounded-lg bg-blue-500/5 p-1 mb-2">
                                <button class="inst-type-btn flex-1 h-full rounded-md px-3 py-1 text-xs font-medium bg-blue-500 text-white" data-inst-type="installment">分期付款</button>
                                <button class="inst-type-btn flex-1 h-full rounded-md px-3 py-1 text-xs font-medium text-wabi-text-secondary" data-inst-type="depreciation">折舊</button>
                                <button class="inst-type-btn flex-1 h-full rounded-md px-3 py-1 text-xs font-medium text-wabi-text-secondary" data-inst-type="amortization">攤提</button>
                            </div>
                            <div class="grid grid-cols-2 gap-2 mb-2">
                                <div>
                                    <label class="text-xs text-wabi-text-secondary">總期數</label>
                                    <input type="number" id="installment-periods" min="1" max="600" placeholder="12"
                                        class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label class="text-xs text-wabi-text-secondary">頻率</label>
                                    <select id="installment-frequency" class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500">
                                        <option value="monthly" selected>每月</option>
                                        <option value="weekly">每週</option>
                                        <option value="yearly">每年</option>
                                    </select>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-2 mb-2">
                                <div id="installment-downpayment-wrap">
                                    <label class="text-xs text-wabi-text-secondary">首付金額 <span class="opacity-50">(選填)</span></label>
                                    <input type="number" id="installment-downpayment" min="0" step="0.01" placeholder="0"
                                        class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label class="text-xs text-wabi-text-secondary">年利率 % <span class="opacity-50">(選填)</span></label>
                                    <input type="number" id="installment-interest" min="0" max="100" step="0.01" placeholder="0"
                                        class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500" />
                                </div>
                            </div>
                            <div class="mb-2">
                                <label class="text-xs text-wabi-text-secondary">每期小數點處理 <span class="opacity-50">(差額會在最後一期補齊)</span></label>
                                <select id="installment-decimal-strategy" class="w-full p-2 bg-wabi-surface border border-wabi-border rounded-lg text-sm outline-none focus:border-blue-500">
                                    <option value="round" selected>四捨五入 (至整數)</option>
                                    <option value="ceil">無條件進位 (至整數)</option>
                                    <option value="floor">無條件捨去 (至整數)</option>
                                    <option value="keep">保留小數 (至小數第二位)</option>
                                </select>
                            </div>
                            <div id="installment-calc-preview" class="p-2 bg-blue-500/5 rounded-lg text-xs text-wabi-text-secondary">
                                <span>每期金額：</span><strong id="installment-per-period" class="text-blue-600">--</strong>
                            </div>
                            <div id="installment-mode-hint" class="hidden mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-wabi-text-secondary">
                                <i class="fa-solid fa-credit-card mr-1 text-amber-600"></i><span id="installment-mode-hint-text"></span>
                            </div>
                            <p class="text-xs text-wabi-text-secondary mt-2">金額/分類/日期由上方記帳欄位帶入，儲存時自動建立分期計畫。</p>
                        </div>

                        <!-- Group Panel (hidden by default) -->
                        <div id="group-panel" class="hidden bg-emerald-500/10 rounded-lg p-4 mb-4 border border-emerald-500/30">
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-medium text-emerald-600"><i class="fa-solid fa-layer-group mr-2"></i>明細群組</span>
                                <button id="close-group-panel" class="text-wabi-text-secondary hover:text-emerald-600">
                                    <i class="fa-solid fa-times"></i>
                                </button>
                            </div>
                            <!-- 搜尋（全量清單直接顯示於下方；全量細選走底部「查看全部」） -->
                            <div class="flex items-center gap-2 bg-wabi-surface border border-wabi-border rounded-xl px-3 py-2 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all shadow-sm mb-2">
                                <i class="fa-solid fa-magnifying-glass text-wabi-text-secondary text-xs shrink-0"></i>
                                <input type="text" id="custom-group-search-input" placeholder="搜尋群組名稱..." class="w-full text-sm bg-transparent text-wabi-text-primary border-none outline-none ring-0 focus:border-none focus:outline-none focus:ring-0 appearance-none shadow-none placeholder:text-wabi-text-secondary/60" autocomplete="off" style="border: none !important; outline: none !important; box-shadow: none !important;" />
                            </div>

                            <!-- 已選群組卡片（同時是管理卡片：細節/改名/刪除） -->
                            <div id="selected-group-card" class="hidden flex-col p-3 mb-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs">
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <i class="fa-solid fa-circle-check text-emerald-500 text-sm shrink-0"></i>
                                        <span class="text-wabi-text-secondary shrink-0">已選：</span>
                                        <span id="selected-group-name-display" class="font-bold text-sm text-emerald-700 dark:text-emerald-400 truncate">未選擇</span>
                                    </div>
                                    <button type="button" id="clear-selected-group-btn" class="text-xs px-2.5 py-1 bg-wabi-surface text-wabi-text-secondary hover:text-wabi-expense border border-wabi-border rounded-md transition-colors shrink-0">
                                        <i class="fa-solid fa-unlink mr-1"></i>取消關聯
                                    </button>
                                </div>
                                <div id="selected-group-actions" class="hidden items-center gap-2 mt-2.5 pt-2.5 border-t border-emerald-500/20">
                                    <button type="button" data-group-mgmt="detail" class="group-mgmt-btn flex-1 px-2 py-1.5 text-xs font-medium text-wabi-primary border border-wabi-primary/40 rounded-lg hover:bg-wabi-primary/5 transition-colors">細節</button>
                                    <button type="button" data-group-mgmt="rename" title="改名" class="group-mgmt-btn size-8 flex items-center justify-center text-xs text-wabi-text-secondary border border-wabi-border rounded-lg hover:text-wabi-primary transition-colors">
                                        <i class="fa-solid fa-pen"></i>
                                    </button>
                                    <button type="button" data-group-mgmt="delete" title="刪除" class="group-mgmt-btn size-8 flex items-center justify-center text-xs text-wabi-text-secondary border border-wabi-border rounded-lg hover:text-wabi-expense transition-colors">
                                        <i class="fa-solid fa-trash-can"></i>
                                    </button>
                                </div>
                            </div>

                            <!-- 群組清單（近期 5 筆 + 建立行；整行可點、每行含 ⋯ 管理） -->
                            <div class="text-[11px] font-medium text-wabi-text-secondary px-1 mb-1 flex items-center justify-between">
                                <span>近期群組 (點擊選取)</span>
                                <span class="text-[10px] opacity-70">未結清優先</span>
                            </div>
                            <div id="custom-group-quick-list" class="bg-wabi-surface border border-wabi-border rounded-xl shadow-sm max-h-64 overflow-y-auto divide-y divide-wabi-border text-sm">
                                <!-- 動態渲染近 5 筆預設/過濾群組 + 「建立新群組」行 -->
                            </div>
                        </div>

                        <!-- Type Switcher & Amount -->
                        <div class="px-4">
                            <div class="flex h-11 w-full items-center justify-center rounded-lg bg-wabi-primary/5 p-1 mb-4">
                                <button id="add-type-expense" class="flex-1 h-full rounded-md text-sm font-medium">支出</button>
                                <button id="add-type-income" class="flex-1 h-full rounded-md text-sm font-medium">收入</button>
                            </div>
                            <div class="flex items-center justify-between py-4">
                                <div id="add-selected-category" class="flex items-center gap-4">
                                    <div class="flex items-center justify-center rounded-full bg-wabi-text-secondary/10 shrink-0 size-12">
                                        <i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i>
                                    </div>
                                    <p class="text-lg font-medium">選擇分類</p>
                                </div>
                                <div id="add-amount-display" class="text-wabi-expense tracking-light text-5xl font-bold">$0</div>
                            </div>
                        </div>

                        <!-- Categories -->
                        <div id="add-category-grid" class="px-4 mt-2 grid grid-cols-4 gap-4"></div>
                        <div id="add-debt-category-hint" class="hidden mx-4 mt-3 p-3 rounded-lg bg-wabi-primary/5 border border-wabi-primary/20 text-wabi-text-secondary text-xs leading-relaxed">
                          <i class="fa-solid fa-circle-info mr-1 text-wabi-primary"></i>
                          此類別較為特殊：<b>不會計入</b>收支統計，但會<b>影響</b>多帳戶模式下所選帳戶的餘額。
                        </div>
                        <div class="h-8"></div> <!-- Spacer for better scrolling end experience -->
                    </div>
                </div>

                <!-- Note, Date, and Keypad -->
                <div id="keypad-container" class="shrink-0 w-full max-w-3xl mx-auto md:border-x md:border-t md:border-wabi-border md:rounded-t-xl md:shadow-[0_0_15px_rgba(0,0,0,0.05)] bg-wabi-keypad/80 text-wabi-primary z-20 transform translate-y-full transition-transform duration-300 ease-in-out">
                    <!-- Account Selector & Quick Select Container -->
                    <div class="flex items-start px-4 pt-2 gap-2">
                        <div id="account-selector-container" class="w-1/4 shrink-0"></div>
                        <div id="quick-select-container" class="w-3/4 grow hidden"></div>
                    </div>

                    <div class="flex items-center px-4 py-2 gap-2">
                        <label class="relative flex items-center gap-2 p-2 rounded-lg bg-wabi-surface/50">
                            <i class="fa-solid fa-calendar-days text-wabi-text-secondary"></i>
                            <span id="add-date-display" class="text-sm font-medium">${formatDate(formatDateToString(new Date()), 'short')}</span>
                            <input type="date" id="add-date-input" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                        </label>
                        <input id="add-note-input" class="w-full rounded-lg border-wabi-border bg-wabi-surface/80 placeholder:text-wabi-text-secondary focus:border-wabi-primary focus:ring-wabi-primary" placeholder="新增備註" type="text"/>
                        <button id="keypad-toggle-btn" class="p-2 rounded-lg bg-wabi-surface/50">
                            <i class="fa-solid fa-keyboard"></i>
                        </button>
                    </div>
                    <div id="keypad-grid" class="${keypadGridCols} gap-px bg-wabi-keypad/80">
                        ${keypadKeys.map(k => this.createKeypadButton(k, isEditMode, calculatorModeEnabled)).join('')}
                    </div>
                </div>
            </div>
        `
        await this.setupAddPageListeners(recordId, params)
    }

    async setupAddPageListeners(recordId, params) {
        const isEditMode = !!recordId
        let recordToEdit = null

        const advancedMode = await this.app.dataService.getSetting(
            'advancedAccountModeEnabled'
        )
        const advancedModeEnabled = !!advancedMode?.value

        // 計算機模式設定（需在此處讀取以用於 handleKeypad，預設為啟用）
        const calculatorModeSetting = await this.app.dataService.getSetting(
            'calculatorModeEnabled'
        )
        const calculatorModeEnabled = calculatorModeSetting
            ? !!calculatorModeSetting.value
            : true

        let currentType = 'expense'
        let currentAmount = '0'
        let selectedCategory = null
        let selectedAccountId = null // New state for multi-account mode
        let accounts = [] // 帳戶清單（提前宣告：供 hoisted 的 getUpfrontCard/refreshUpfrontState 安全引用）
        let currentDate = formatDateToString(new Date())
        let keypadGridOpen = false

        // Virtual keyboard state tracking
        let vkForcedHide = false
        let vkDetector = null

        // Debt panel state
        let debtEnabled = false // 是否已設定欠款（已選聯絡人）→ 決定右上角按鈕 active
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
        const selectedCategoryUI = document.getElementById(
            'add-selected-category'
        )
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

        // 欠款面板：可見性（純視覺）與「是否已設定」分離
        // 右上角按鈕 active ⇔ 已選聯絡人；收起面板時保留設定
        let debtPanelOpen = false
        const isDebtConfigured = () => debtContactId !== null
        const updateDebtBtn = () => {
            debtEnabled = isDebtConfigured()
            // 欠款功能未開啟時 toggleDebtBtn 不存在（條件渲染）
            if (!toggleDebtBtn) return
            toggleDebtBtn.classList.toggle('text-orange-500', debtEnabled)
            toggleDebtBtn.classList.toggle('bg-orange-500/10', debtEnabled)
            toggleDebtBtn.classList.toggle('text-wabi-text-secondary', !debtEnabled)
        }
        const setDebtPanelOpen = open => {
            debtPanelOpen = open
            if (!debtPanel) return
            debtPanel.classList.toggle('hidden', !open)
        }
        const clearDebtConfig = () => {
            debtContactId = null
            debtType = 'receivable'
            const sel = document.getElementById('debt-contact-select')
            if (sel) sel.value = ''
            // 重置欠款類型按鈕為預設（別人欠我）
            document.querySelectorAll('.debt-add-type-btn').forEach(b => {
                b.classList.remove('bg-wabi-income', 'bg-wabi-expense', 'text-wabi-surface')
                b.classList.add('text-wabi-text-secondary')
            })
            const recv = document.getElementById('debt-type-receivable-add')
            if (recv) {
                recv.classList.remove('text-wabi-text-secondary')
                recv.classList.add('bg-wabi-income', 'text-wabi-surface')
            }
            updateDebtBtn()
        }

        // Plugin Support: Pre-fill from Session Storage
        if (!recordId) {
            const tempDataStr = sessionStorage.getItem('temp_add_data')
            if (tempDataStr) {
                try {
                    const tempData = JSON.parse(tempDataStr)
                    if (tempData.type) currentType = tempData.type
                    if (tempData.amount)
                        currentAmount = tempData.amount.toString()
                    if (tempData.category) selectedCategory = tempData.category
                    if (tempData.description && noteInput)
                        noteInput.value = tempData.description
                    if (amountDisplay)
                        amountDisplay.textContent =
                            formatCurrency(currentAmount)
                    sessionStorage.removeItem('temp_add_data')
                } catch (e) {
                    console.error('Error applying temp data:', e)
                }
            }
        }

        // PWA Share Target & Query Param Pre-fill Support
        if (!recordId && params) {
            const amountParam = params.get('amount')
            const noteParam = params.get('note')
            const typeParam = params.get('type')

            if (
                typeParam &&
                (typeParam === 'expense' || typeParam === 'income')
            ) {
                currentType = typeParam
            }
            if (amountParam && !isNaN(parseFloat(amountParam))) {
                currentAmount = amountParam.toString()
                if (amountDisplay) {
                    amountDisplay.textContent = formatCurrency(currentAmount)
                }
            }
            if (noteParam && noteInput) {
                noteInput.value = noteParam
            }
        }

        // Setup debt panel if available
        if (toggleDebtBtn && debtPanel) {
            const loadContacts = async (selectedId = null) => {
                const contacts = await this.app.dataService.getContacts()
                const select = document.getElementById('debt-contact-select')
                if (select) {
                    select.innerHTML =
                        `<option value="">選擇聯絡人...</option>` +
                        contacts
                            .map(
                                c =>
                                    `<option value="${c.id}" ${selectedId !== null && c.id === selectedId ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
                            )
                            .join('') +
                        `<option value="__new__">+ 新增聯絡人</option>`
                }
            }

            // 快速新增聯絡人（新增記帳頁內嵌）
            const showQuickAddContactModal = () => {
                const modal = document.createElement('div')
                modal.id = 'quick-add-contact-modal'
                modal.className =
                    'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
                modal.innerHTML = `
                    <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
                        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">新增聯絡人</h3>
                        <div class="mb-6">
                            <label class="text-sm font-medium text-wabi-text-primary mb-2 block">名稱</label>
                            <input type="text" id="quick-contact-name" placeholder="輸入聯絡人名稱"
                                class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
                        </div>
                        <div class="flex space-x-3">
                            <button id="quick-contact-save" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">新增</button>
                            <button id="quick-contact-cancel" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
                        </div>
                    </div>
                `
                document.body.appendChild(modal)
                const closeModal = () => modal.remove()
                modal
                    .querySelector('#quick-contact-cancel')
                    .addEventListener('click', closeModal)
                modal.addEventListener('click', e => {
                    if (e.target === modal) closeModal()
                })
                setTimeout(() => {
                    modal.querySelector('#quick-contact-name').focus()
                }, 100)
                modal
                    .querySelector('#quick-contact-save')
                    .addEventListener('click', async () => {
                        const name = modal
                            .querySelector('#quick-contact-name')
                            .value.trim()
                        if (!name) {
                            customAlert('請輸入聯絡人名稱')
                            return
                        }
                        const newId = await this.app.dataService.addContact({
                            name,
                        })
                        closeModal()
                        await loadContacts(newId)
                        debtContactId = newId
                        updateDebtBtn()
                        showToast('已新增聯絡人', 'success')
                    })
            }

            toggleDebtBtn.addEventListener('click', async () => {
                const willOpen = !debtPanelOpen
                // 互斥：欠款與分期同時只保留一方的設定
                // （點任一按鈕即生效，含「收起後再切換」的情況）
                setInstallmentPanelOpen(false)
                clearInstallmentConfig()
                setDebtPanelOpen(willOpen)
                if (willOpen) {
                    await loadContacts(debtContactId)
                }
            })

            document
                .getElementById('close-debt-panel')
                ?.addEventListener('click', () => {
                    // X = 取消：清空欠款設定並關閉面板（避免按錯後直接儲存）
                    // 「收合但保留設定」請用右上角按鈕（再點一次）
                    clearDebtConfig()
                    setDebtPanelOpen(false)
                })

            document.querySelectorAll('.debt-add-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    debtType =
                        btn.id === 'debt-type-receivable-add'
                            ? 'receivable'
                            : 'payable'
                    document
                        .querySelectorAll('.debt-add-type-btn')
                        .forEach(b => {
                            b.classList.remove(
                                'bg-wabi-income',
                                'bg-wabi-expense',
                                'text-wabi-surface'
                            )
                            b.classList.add('text-wabi-text-secondary')
                        })
                    if (debtType === 'receivable') {
                        btn.classList.add('bg-wabi-income', 'text-wabi-surface')
                    } else {
                        btn.classList.add(
                            'bg-wabi-expense',
                            'text-wabi-surface'
                        )
                    }
                    btn.classList.remove('text-wabi-text-secondary')
                })
            })

            document
                .getElementById('debt-contact-select')
                ?.addEventListener('change', e => {
                    const val = e.target.value
                    if (val === '__new__') {
                        showQuickAddContactModal()
                        e.target.value = debtContactId || ''
                        return
                    }
                    debtContactId = val ? parseInt(val) : null
                    updateDebtBtn()
                })
        }

        // --- 分期/攤提面板 ---
        const installmentBtn = document.getElementById('toggle-installment-btn')
        const installmentPanel = document.getElementById('installment-panel')
        let installmentEnabled = false
        let installmentType = 'installment'

        // 分期面板：可見性與「是否已設定」分離
        // 右上角按鈕 active ⇔ 已輸入分期名稱；收起面板時保留設定
        let installmentPanelOpen = false
        const isInstallmentConfigured = () =>
            (document.getElementById('installment-name')?.value.trim() || '')
                .length > 0
        const updateInstallmentBtn = () => {
            installmentEnabled = isInstallmentConfigured()
            installmentBtn.classList.toggle('text-blue-500', installmentEnabled)
            installmentBtn.classList.toggle('bg-blue-500/10', installmentEnabled)
            installmentBtn.classList.toggle(
                'text-wabi-text-secondary',
                !installmentEnabled
            )
        }
        const setInstallmentPanelOpen = open => {
            installmentPanelOpen = open
            installmentPanel.classList.toggle('hidden', !open)
        }
        const clearInstallmentConfig = () => {
            ['installment-name',
                'installment-periods',
                'installment-downpayment',
                'installment-interest',
            ].forEach(id => {
                const el = document.getElementById(id)
                if (el) el.value = ''
            })
            const freqEl = document.getElementById('installment-frequency')
            if (freqEl) freqEl.value = 'monthly'
            const stratEl = document.getElementById('installment-decimal-strategy')
            if (stratEl) stratEl.value = 'round'
            // 類型重置為「分期付款」
            installmentType = 'installment'
            document.querySelectorAll('.inst-type-btn').forEach(b => {
                b.classList.remove('bg-blue-500', 'text-white')
                b.classList.add('text-wabi-text-secondary')
            })
            const defaultTypeBtn = document.querySelector(
                '.inst-type-btn[data-inst-type="installment"]'
            )
            if (defaultTypeBtn) {
                defaultTypeBtn.classList.remove('text-wabi-text-secondary')
                defaultTypeBtn.classList.add('bg-blue-500', 'text-white')
            }
            const perEl = document.getElementById('installment-per-period')
            if (perEl) perEl.textContent = '--'
            // 信用卡分期 upfront 狀態同步重置
            upfrontActive = false
            upfrontDebitName = ''
            if (document.getElementById('installment-mode-hint'))
                document
                    .getElementById('installment-mode-hint')
                    .classList.add('hidden')
            const dpWrap = document.getElementById(
                'installment-downpayment-wrap'
            )
            if (dpWrap) dpWrap.classList.remove('hidden')
            updateInstallmentBtn()
        }

        // --- 信用卡分期 upfront 模式（選到信用卡帳戶時：全額入账 + 月度扣款）---
        // 註：function 宣告會 hoist，可安全引用後段宣告的 accounts/selectedAccountId
        let upfrontActive = false
        let upfrontDebitName = ''
        function getUpfrontCard() {
            const sel =
                advancedModeEnabled &&
                selectedAccountId != null &&
                !isEditMode
                    ? accounts.find(a => a.id === selectedAccountId)
                    : null
            return sel && sel.type === 'credit_card' ? sel : null
        }
        function refreshUpfrontState() {
            const hint = document.getElementById('installment-mode-hint')
            const hintText = document.getElementById(
                'installment-mode-hint-text'
            )
            const dpWrap = document.getElementById(
                'installment-downpayment-wrap'
            )
            const dpInput = document.getElementById(
                'installment-downpayment'
            )
            const card = getUpfrontCard()
            upfrontActive = !!card
            upfrontDebitName = card
                ? accounts.find(a => a.id === card.autoPayAccountId)?.name ||
                  ''
                : ''
            if (hint) hint.classList.toggle('hidden', !card)
            if (dpWrap) dpWrap.classList.toggle('hidden', !!card)
            // upfront 禁用首付（全額刷卡）
            if (dpInput) dpInput.disabled = !!card
            if (card && hintText) {
                const total = parseFloat(currentAmount) || 0
                const periods =
                    parseInt(
                        document.getElementById('installment-periods')?.value
                    ) || 0
                const freq =
                    document.getElementById('installment-frequency')?.value ||
                    'monthly'
                const { amountPerPeriod } = calculateAmortizationDetails(
                    total,
                    Math.max(1, periods),
                    parseFloat(
                        document.getElementById('installment-interest')?.value
                    ) || 0,
                    freq,
                    document
                        .getElementById('installment-decimal-strategy')
                        ?.value || 'round'
                )
                const p1Date = calculateNextDueDate(
                    currentDate,
                    freq,
                    1
                )
                hintText.textContent = `信用卡分期：全額 ${formatCurrency(total)} 立即佔用額度，自 ${p1Date} 起每期扣 ${formatCurrency(amountPerPeriod)}（${
                    upfrontDebitName
                        ? `扣款帳戶：${upfrontDebitName}`
                        : '未設定扣款帳戶，到期不產生扣款紀錄'
                    }）`
            }
        }

        if (installmentBtn && installmentPanel) {
            installmentBtn.addEventListener('click', () => {
                const willOpen = !installmentPanelOpen
                // 互斥：欠款與分期同時只保留一方的設定
                setDebtPanelOpen(false)
                clearDebtConfig()
                setInstallmentPanelOpen(willOpen)
            })

            document
                .getElementById('close-installment-panel')
                ?.addEventListener('click', () => {
                    // X = 取消：清空分期設定並關閉面板（避免按錯後直接儲存）
                    // 「收合但保留設定」請用右上角按鈕（再點一次）
                    clearInstallmentConfig()
                    setInstallmentPanelOpen(false)
                })

            // 類型切換
            document.querySelectorAll('.inst-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    installmentType = btn.dataset.instType
                    document.querySelectorAll('.inst-type-btn').forEach(b => {
                        b.classList.remove('bg-blue-500', 'text-white')
                        b.classList.add('text-wabi-text-secondary')
                    })
                    btn.classList.remove('text-wabi-text-secondary')
                    btn.classList.add('bg-blue-500', 'text-white')
                })
            })

            // 即時計算每期金額
            const calcPreview = () => {
                const total = parseFloat(currentAmount) || 0
                const periods =
                    parseInt(
                        document.getElementById('installment-periods')?.value
                    ) || 0
                const downPayment =
                    parseFloat(
                        document.getElementById('installment-downpayment')
                            ?.value
                    ) || 0
                const annualRate =
                    parseFloat(
                        document.getElementById('installment-interest')?.value
                    ) || 0
                const display = document.getElementById(
                    'installment-per-period'
                )
                if (!display || total <= 0 || periods <= 0) {
                    if (display) display.textContent = '--'
                    return
                }
                const principal = Math.max(0, total - downPayment)
                const decimalStrategy =
                    document.getElementById('installment-decimal-strategy')
                        ?.value || 'round'
                const freq =
                    document.getElementById('installment-frequency')?.value ||
                    'monthly'

                const { amountPerPeriod } = calculateAmortizationDetails(
                    principal,
                    periods,
                    annualRate,
                    freq,
                    decimalStrategy
                )
                display.textContent = `$${amountPerPeriod.toLocaleString('zh-TW')}`
                refreshUpfrontState()
            }
            ;[
                'installment-periods',
                'installment-downpayment',
                'installment-interest',
            ].forEach(id => {
                document
                    .getElementById(id)
                    ?.addEventListener('input', () => {
                        calcPreview()
                        refreshUpfrontState()
                    })
            })
            // 名稱輸入時更新右上角按鈕 active
            document
                .getElementById('installment-name')
                ?.addEventListener('input', () => updateInstallmentBtn())
            document
                .getElementById('installment-frequency')
                ?.addEventListener('change', () => {
                    calcPreview()
                    refreshUpfrontState()
                })
            document
                .getElementById('installment-decimal-strategy')
                ?.addEventListener('change', () => {
                    calcPreview()
                    refreshUpfrontState()
                })
            // 金額變動時也更新
            const origUpdateAmount = () => {
                calcPreview()
                refreshUpfrontState()
            }
            const amountObserver = new MutationObserver(origUpdateAmount)
            amountObserver.observe(amountDisplay, {
                childList: true,
                characterData: true,
                subtree: true,
            })
        }

        // --- Group Panel ---
        const groupPanel = document.getElementById('group-panel')
        const toggleGroupBtn = document.getElementById('toggle-group-btn')
        let groupEnabled = false
        let selectedGroupId = null
        let groupCleared = false // 使用者明確「清除選取/取消關聯」→ 儲存時移除群組
        let groupEditPrefilled = false // 編輯模式已預填選取（只預填一次）
        let applyEditGroupPrefill = null // closure hook：由群組面板區塊設定，供編輯預載呼叫

        // 群組面板：可見性與「是否已設定」分離
        // 右上角按鈕 active ⇔ 已選群組；收起面板時保留設定
        // （「建立即生效」後，建立＝立即 createGroup + 選取，不再有「建立中未選取」狀態）
        let groupPanelOpen = false
        const isGroupConfigured = () => selectedGroupId !== null
        const updateGroupBtn = () => {
            groupEnabled = isGroupConfigured()
            toggleGroupBtn.classList.toggle('text-emerald-500', groupEnabled)
            toggleGroupBtn.classList.toggle('bg-emerald-500/10', groupEnabled)
            toggleGroupBtn.classList.toggle('text-wabi-text-secondary', !groupEnabled)
        }
        const setGroupPanelOpen = open => {
            groupPanelOpen = open
            groupPanel.classList.toggle('hidden', !open)
        }

        if (toggleGroupBtn && groupPanel) {
            // Toggle panel
            toggleGroupBtn.addEventListener('click', async () => {
                const willOpen = !groupPanelOpen
                setGroupPanelOpen(willOpen)
                if (willOpen) {
                    await loadGroupList()
                }
            })

            // 關閉＝取消：清空群組設定並關閉面板（避免按錯後直接儲存）
            // 「收合但保留設定」請用右上角按鈕（再點一次）
            document.getElementById('close-group-panel')?.addEventListener('click', () => {
                clearGroupConfig()
                setGroupPanelOpen(false)
            })

            // 建立即生效：輸入框 Enter/「建立」→ 立即建立群組並自動選取
            // （與群組管理頁同語義：群組是獨立資源，記帳存不存、群組都已存在）
            const startCreateGroupRow = () => {
                const quickList = document.getElementById('custom-group-quick-list')
                const createRow = quickList?.querySelector('#group-create-row')
                if (!createRow) return
                createRow.innerHTML = `
                    <div class="flex items-center gap-2 py-2">
                        <input type="text" id="group-name-input" maxlength="50" placeholder="群組名稱（如：7/15 台北出差）"
                            class="flex-1 min-w-0 p-2 bg-wabi-bg border border-emerald-500 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" autocomplete="off" />
                        <button type="button" id="group-create-confirm" class="shrink-0 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors">建立</button>
                    </div>
                `
                const input = createRow.querySelector('#group-name-input')
                setTimeout(() => input?.focus(), 50)
                const confirmCreate = async () => {
                    const name = input.value.trim()
                    if (!name) {
                        showToast('請輸入群組名稱', 'error')
                        input.focus()
                        return
                    }
                    try {
                        const newId = await this.app.groupManager.createGroup(name)
                        await loadGroupList() // 重新載入（已含新群組）並渲染
                        const created = allCachedGroups.find(g => g.id === newId)
                        if (created) {
                            updateGroupSelectUI(created)
                        }
                        showToast('已建立群組「' + name + '」', 'success')
                    } catch (e) {
                        console.error('Failed to create group:', e)
                        showToast('建立群組失敗', 'error')
                    }
                }
                createRow.querySelector('#group-create-confirm').addEventListener('click', confirmCreate)
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        confirmCreate()
                    }
                })
            }

            let allCachedGroups = []

            const updateGroupSelectUI = (group = null) => {
                const selectedCard = document.getElementById('selected-group-card')
                const nameDisplay = document.getElementById('selected-group-name-display')
                const actionsRow = document.getElementById('selected-group-actions')
                if (!nameDisplay) return
                if (group) {
                    selectedGroupId = group.id
                    groupCleared = false // 重新選取覆蓋「已取消」狀態
                    nameDisplay.innerHTML = `${escapeHTML(group.name)} <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-normal ${group.settled ? 'bg-wabi-text-secondary/10 text-wabi-text-secondary' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}">${group.settled ? '已結清' : '未結清'}</span>`
                    selectedCard?.classList.remove('hidden')
                    selectedCard?.classList.add('flex')
                    // 管理列（細節/改名/刪除）隨已選卡片顯示
                    actionsRow?.classList.remove('hidden')
                    actionsRow?.classList.add('flex')
                } else {
                    selectedGroupId = null
                    groupCleared = true // 所有 updateGroupSelectUI(null) 呼叫者皆為明確取消
                    nameDisplay.textContent = '未選擇'
                    selectedCard?.classList.add('hidden')
                    selectedCard?.classList.remove('flex')
                    actionsRow?.classList.add('hidden')
                    actionsRow?.classList.remove('flex')
                }
                updateGroupBtn()
            }

            const clearGroupConfig = () => {
                // 清空群組設定：取消已選群組；重繪清單（若建立輸入行開著會恢復成「+ 建立新群組」觸發行）
                updateGroupSelectUI(null) // 清 selectedGroupId + 標記 groupCleared + 更新按鈕
                renderQuickList(document.getElementById('custom-group-search-input')?.value || '')
            }

            // 點「⋯」管理：細節 / 改名 / 刪除（與群組管理頁同款行為，modal 就地開啟不跳頁）
            const handleGroupMgmt = async (kind, gid) => {
                const target = allCachedGroups.find(g => g.id === gid)
                if (!target) return
                if (kind === 'detail') {
                    const dm = this.app.debtManager
                    if (dm && typeof dm.showGroupDetailsModal === 'function') {
                        await dm.showGroupDetailsModal(gid)
                    }
                    return
                }
                if (kind === 'rename') {
                    await showGroupRenameModal(gid)
                    return
                }
                if (kind === 'delete') {
                    const isCurrent = selectedGroupId === gid
                    const msg = isCurrent
                        ? '確定要刪除群組「' + target.name + '」嗎？群組刪除後，屬於該群組的記帳紀錄將不會被刪除，但會解除與群組的關聯（包含目前這筆待存紀錄的選取）。'
                        : '確定要刪除群組「' + target.name + '」嗎？群組刪除後，屬於該群組的記帳紀錄將不會被刪除，但會解除與群組的關聯。'
                    if (!(await customConfirm(msg, '刪除群組'))) return
                    try {
                        await this.app.groupManager.deleteGroup(gid)
                        showToast('已刪除群組', 'success')
                        if (isCurrent) updateGroupSelectUI(null)
                        await loadGroupList() // 重新載入 + 重繪
                    } catch (e) {
                        console.error('Failed to delete group:', e)
                        showToast('刪除群組失敗', 'error')
                    }
                }
            }

            const showGroupRenameModal = (gid) => {
                return new Promise(resolve => {
                    const target = allCachedGroups.find(g => g.id === gid)
                    if (!target) return resolve()
                    const modal = document.createElement('div')
                    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
                    modal.innerHTML = `
                        <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 shadow-xl">
                            <h3 class="text-lg font-bold mb-4 text-wabi-primary">重命名群組</h3>
                            <div class="mb-5">
                                <label class="text-sm font-medium text-wabi-text-primary mb-2 block">群組名稱</label>
                                <input type="text" id="group-rename-input" maxlength="50" value="${escapeHTML(target.name)}"
                                       class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary focus:outline-none focus:border-wabi-primary">
                            </div>
                            <div class="flex space-x-3">
                                <button type="button" id="group-rename-save-btn" class="flex-1 bg-wabi-primary hover:opacity-90 text-wabi-surface font-bold py-3 rounded-lg transition-opacity">
                                    儲存
                                </button>
                                <button type="button" id="group-rename-cancel-btn" class="px-6 bg-wabi-border text-wabi-text-primary py-3 rounded-lg hover:bg-wabi-border/80 transition-colors">
                                    取消
                                </button>
                            </div>
                        </div>
                    `
                    document.body.appendChild(modal)
                    const close = () => { modal.remove(); resolve() }
                    const input = modal.querySelector('#group-rename-input')
                    setTimeout(() => input?.focus(), 100)
                    modal.querySelector('#group-rename-cancel-btn').addEventListener('click', close)
                    modal.addEventListener('click', e => { if (e.target === modal) close() })
                    modal.querySelector('#group-rename-save-btn').addEventListener('click', async () => {
                        const name = input.value.trim()
                        if (!name) {
                            customAlert('請輸入群組名稱')
                            return
                        }
                        try {
                            await this.app.groupManager.renameGroup(gid, name)
                            showToast('已更新群組名稱', 'success')
                            close()
                            await loadGroupList()
                            // 若改名的就是已選群組，同步已選卡片名稱顯示
                            const renamed = allCachedGroups.find(g => g.id === gid)
                            if (renamed && selectedGroupId === gid) {
                                updateGroupSelectUI(renamed)
                            }
                        } catch (e) {
                            console.error('Failed to rename group:', e)
                            showToast('改名失敗', 'error')
                        }
                    })
                    input?.addEventListener('keydown', e => {
                        if (e.key === 'Enter') modal.querySelector('#group-rename-save-btn')?.click()
                    })
                })
            }

            const renderQuickList = (query = '') => {
                const quickList = document.getElementById('custom-group-quick-list')
                if (!quickList) return

                const cleanQuery = query.trim().toLowerCase()
                const filtered = cleanQuery
                    ? allCachedGroups.filter(g => g.name.toLowerCase().includes(cleanQuery))
                    : allCachedGroups
                // 搜尋：顯示全部符合；未搜尋：近期 5 筆
                const displayItems = cleanQuery ? filtered : filtered.slice(0, 5)
                const hasMore = !cleanQuery && filtered.length > 5

                const rowHtml = g => {
                    const isSelected = selectedGroupId === g.id
                    return `
                        <div class="group w-full flex items-stretch">
                            <button type="button" data-group-id="${g.id}" class="group-option-item flex-1 min-w-0 text-left py-3 px-3 hover:bg-emerald-500/10 transition-colors flex items-center justify-between gap-2 ${isSelected ? 'bg-emerald-500/15' : ''}">
                                <div class="flex items-center gap-2.5 min-w-0">
                                    <i class="fa-solid ${g.settled ? 'fa-folder-closed text-wabi-text-secondary' : isSelected ? 'fa-circle-check' : 'fa-layer-group'} ${g.settled ? '' : 'text-emerald-500'} text-sm shrink-0"></i>
                                    <span class="truncate ${isSelected ? 'font-semibold text-emerald-600' : 'text-wabi-text-primary'}">${escapeHTML(g.name)}</span>
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0 text-[11px]">
                                    <span class="${g.netAmount > 0 ? 'text-wabi-income' : g.netAmount < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'} font-mono">${g.netAmount > 0 ? '+' : g.netAmount < 0 ? '-' : ''}${formatCurrency(Math.abs(g.netAmount))}</span>
                                    <span class="px-1.5 py-0.5 rounded text-[10px] ${g.settled ? 'bg-wabi-text-secondary/10 text-wabi-text-secondary' : 'bg-emerald-500/10 text-emerald-600'}">${g.settled ? '已結清' : '進行中'}</span>
                                </div>
                            </button>
                            <button type="button" data-group-mgmt-open="${g.id}" title="管理（細節/改名/刪除）" class="w-11 flex items-center justify-center text-wabi-text-secondary hover:text-wabi-primary transition-colors shrink-0">
                                <i class="fa-solid fa-ellipsis-vertical"></i>
                            </button>
                        </div>
                    `
                }

                const createRowHtml = `
                    <div id="group-create-row" class="w-full">
                        <button type="button" id="group-create-trigger" class="w-full text-left py-3 px-3 hover:bg-emerald-500/10 transition-colors flex items-center gap-2.5 text-sm text-emerald-600 font-medium">
                            <i class="fa-solid fa-plus text-xs shrink-0"></i>
                            <span>建立新群組...</span>
                        </button>
                    </div>
                `

                if (displayItems.length === 0) {
                    if (cleanQuery) {
                        quickList.innerHTML = `<div class="p-3 text-center text-wabi-text-secondary opacity-75 text-sm">無符合「${escapeHTML(cleanQuery)}」的群組</div>`
                    } else {
                        quickList.innerHTML = `
                            <div class="p-4 text-center space-y-2">
                                <div class="text-wabi-text-secondary opacity-75 text-sm">尚無建立的群組</div>
                            </div>
                            ${createRowHtml}
                        `
                        quickList.querySelector('#group-create-trigger')?.addEventListener('click', () => startCreateGroupRow())
                    }
                    return
                }

                let html = displayItems.map(rowHtml).join('')
                // 建立行（搜尋中也顯示，方便搜完直接新建）
                html += createRowHtml
                if (hasMore) {
                    html += `
                        <button type="button" id="quick-list-more-btn" class="w-full text-center py-2.5 text-xs text-emerald-600 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors font-medium flex items-center justify-center gap-1">
                            <i class="fa-solid fa-ellipsis"></i>
                            <span>查看全部 ${filtered.length} 筆</span>
                        </button>
                    `
                }

                quickList.innerHTML = html

                // 選取（已結清 → 錯誤前置 toast，不進入選取狀態）
                quickList.querySelectorAll('.group-option-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const gid = btn.dataset.groupId
                        const target = allCachedGroups.find(g => g.id === gid)
                        if (!target) return
                        if (target.settled) {
                            showToast('已結清的群組無法加入新紀錄', 'error')
                            return
                        }
                        updateGroupSelectUI(target)
                        renderQuickList(document.getElementById('custom-group-search-input')?.value || '')
                    })
                })

                // 建立行觸發
                quickList.querySelector('#group-create-trigger')?.addEventListener('click', () => startCreateGroupRow())

                // 每行「⋯」管理
                quickList.querySelectorAll('[data-group-mgmt-open]').forEach(btn => {
                    btn.addEventListener('click', () => handleGroupMgmtMenu(btn.dataset.groupMgmtOpen))
                })

                quickList.querySelector('#quick-list-more-btn')?.addEventListener('click', () => {
                    showGroupPickerModal()
                })
            }

            // 行上「⋯」→ 小型管理選單（細節/改名/刪除）
            const handleGroupMgmtMenu = (gid) => {
                const target = allCachedGroups.find(g => g.id === gid)
                if (!target) return
                // 已有選單先收掉
                document.getElementById('group-mgmt-menu')?.remove()
                const menu = document.createElement('div')
                menu.id = 'group-mgmt-menu'
                menu.className = 'fixed z-[60] bg-wabi-surface border border-wabi-border rounded-xl shadow-xl py-1 min-w-36'
                menu.innerHTML = `
                    <button type="button" data-mgmt="detail" class="w-full text-left px-4 py-2.5 text-sm hover:bg-wabi-surface/70 transition-colors flex items-center gap-2">
                        <i class="fa-solid fa-circle-info text-wabi-primary w-4"></i>細節
                    </button>
                    <button type="button" data-mgmt="rename" class="w-full text-left px-4 py-2.5 text-sm hover:bg-wabi-surface/70 transition-colors flex items-center gap-2">
                        <i class="fa-solid fa-pen text-wabi-text-secondary w-4"></i>改名
                    </button>
                    <button type="button" data-mgmt="delete" class="w-full text-left px-4 py-2.5 text-sm hover:bg-wabi-surface/70 transition-colors flex items-center gap-2 text-wabi-expense">
                        <i class="fa-solid fa-trash-can w-4"></i>刪除
                    </button>
                `
                document.body.appendChild(menu)
                // 定位到按鈕右下方，手機視口內防溢出
                const anchorRect = document.querySelector(`[data-group-mgmt-open="${CSS.escape(gid)}"]`)?.getBoundingClientRect()
                const menuWidth = 160
                const menuHeight = 132
                let left = anchorRect ? anchorRect.right + 4 : (window.innerWidth - menuWidth - 12)
                if (left + menuWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuWidth - 8)
                let top = anchorRect ? anchorRect.bottom + 4 : 120
                if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, (anchorRect ? anchorRect.top : 120) - menuHeight - 4)
                menu.style.left = left + 'px'
                menu.style.top = top + 'px'
                const closeMenu = () => {
                    menu.remove()
                    document.removeEventListener('click', onDocClick, true)
                }
                const onDocClick = e => {
                    if (!menu.contains(e.target)) closeMenu()
                }
                setTimeout(() => document.addEventListener('click', onDocClick, true), 0)
                menu.querySelectorAll('[data-mgmt]').forEach(btn => {
                    btn.addEventListener('click', e => {
                        e.stopPropagation()
                        closeMenu()
                        handleGroupMgmt(btn.dataset.mgmt, gid)
                    })
                })
            }

            // Load groups (unsettled first, sorted by newest date, top 5 display)
            const loadGroupList = async () => {
                try {
                    allCachedGroups = await this.app.dataService.getGroups()

                    // 排序：優先放未結清 (settled=false)，同狀態下最新日期/時間優先
                    // （dateTo 是日期字串、createdAt 是毫秒數字 → 統一轉字串比較，避免 localeCompare 對數字崩潰）
                    allCachedGroups.sort((a, b) => {
                        if (a.settled !== b.settled) {
                            return a.settled ? 1 : -1
                        }
                        const timeA = String(a.dateTo || a.createdAt || '')
                        const timeB = String(b.dateTo || b.createdAt || '')
                        return timeB.localeCompare(timeA)
                    })

                    // If editing a record with groupId, set initial selection
                    if (isEditMode && recordToEdit?.groupId && !groupEditPrefilled) {
                        groupEditPrefilled = true
                        const existing = allCachedGroups.find(g => g.id === recordToEdit.groupId)
                        if (existing) {
                            // 顯示既有群組：面板自動展開（收合但保留設定），
                            // 右上角按鈕 active，並提供「取消關聯」出口
                            updateGroupSelectUI(existing)
                            setGroupPanelOpen(true)
                        }
                    }

                    renderQuickList()
                } catch (e) {
                    console.error('Failed to load groups:', e)
                }
            }

            // closure hook：編輯既有群組預載（由外層編輯預載段呼叫）
            applyEditGroupPrefill = async () => {
                await loadGroupList() // 內部已做既有群組預填（選取 + 按鈕 active）
                if (recordToEdit?.groupId) {
                    setGroupPanelOpen(true) // 面板自動展開（設定保留，按 X 可取消）
                }
            }

            // Search input listener
            document.getElementById('custom-group-search-input')?.addEventListener('input', e => {
                renderQuickList(e.target.value)
            })

            // Clear button listener
            document.getElementById('clear-selected-group-btn')?.addEventListener('click', () => {
                updateGroupSelectUI(null)
                renderQuickList(document.getElementById('custom-group-search-input')?.value || '')
            })

            // 已選卡片的管理列（細節/改名/刪除）
            document.querySelectorAll('#selected-group-actions [data-group-mgmt]').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (!selectedGroupId) return
                    handleGroupMgmt(btn.dataset.groupMgmt, selectedGroupId)
                })
            })

            // Modal 細選彈窗
            const showGroupPickerModal = () => {
                const modal = document.createElement('div')
                modal.id = 'group-picker-modal'
                modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

                const renderModalContent = (q = '') => {
                    const cleanQ = q.trim().toLowerCase()
                    let items = allCachedGroups
                    if (cleanQ) {
                        items = items.filter(g => g.name.toLowerCase().includes(cleanQ))
                    }

                    const activeItems = items.filter(g => !g.settled)
                    const settledItems = items.filter(g => g.settled)

                    const buildSection = (title, list, badgeClass, badgeText) => {
                        if (list.length === 0) return ''
                        return `
                            <div class="mb-4">
                                <h4 class="text-xs font-semibold text-wabi-text-secondary uppercase tracking-wider mb-2">${title} (${list.length})</h4>
                                <div class="space-y-1.5">
                                    ${list.map(g => `
                                        <button type="button" data-gid="${g.id}" class="modal-group-item w-full text-left p-3 rounded-lg border border-wabi-border bg-wabi-surface hover:border-emerald-500 transition-colors flex items-center justify-between ${selectedGroupId === g.id ? 'ring-2 ring-emerald-500/50 bg-emerald-500/5' : ''}">
                                            <div class="flex items-center gap-3 min-w-0">
                                                <div class="size-8 rounded-lg flex items-center justify-center bg-emerald-500/10 text-emerald-600 shrink-0">
                                                    <i class="fa-solid fa-layer-group"></i>
                                                </div>
                                                <div class="min-w-0">
                                                    <div class="font-medium text-sm text-wabi-text-primary truncate">${escapeHTML(g.name)}</div>
                                                    <div class="text-xs text-wabi-text-secondary">${g.recordCount} 筆交易紀錄</div>
                                                </div>
                                            </div>
                                            <div class="text-right shrink-0">
                                                <div class="text-xs font-mono font-semibold ${g.netAmount > 0 ? 'text-wabi-income' : g.netAmount < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'}">${g.netAmount > 0 ? '+' : g.netAmount < 0 ? '-' : ''}${formatCurrency(Math.abs(g.netAmount))}</div>
                                                <span class="inline-block text-[10px] px-1.5 py-0.5 rounded ${badgeClass}">${badgeText}</span>
                                            </div>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `
                    }

                    const activeHtml = buildSection('進行中群組', activeItems, 'bg-emerald-500/10 text-emerald-600', '進行中')
                    const settledHtml = buildSection('已結清群組', settledItems, 'bg-wabi-text-secondary/10 text-wabi-text-secondary', '已結清')

                    const container = modal.querySelector('#modal-group-list-container')
                    if (container) {
                        container.innerHTML = (activeHtml || settledHtml) ? (activeHtml + settledHtml) : '<div class="py-8 text-center text-wabi-text-secondary text-sm">無符合的群組</div>'
                        container.querySelectorAll('.modal-group-item').forEach(btn => {
                            btn.addEventListener('click', () => {
                                const gid = btn.dataset.gid
                                const target = allCachedGroups.find(g => g.id === gid)
                                if (!target) {
                                    modal.remove()
                                    return
                                }
                                if (target.settled) {
                                    // 錯誤前置：不進入選取狀態，modal 保留方便改選
                                    showToast('已結清的群組無法加入新紀錄', 'error')
                                    return
                                }
                                updateGroupSelectUI(target)
                                renderQuickList()
                                modal.remove()
                            })
                        })
                    }
                }

                modal.innerHTML = `
                    <div class="bg-wabi-bg rounded-xl max-w-md w-full p-5 max-h-[85vh] flex flex-col shadow-xl">
                        <div class="flex items-center justify-between mb-3 pb-2 border-b border-wabi-border">
                            <h3 class="text-base font-bold text-wabi-primary flex items-center gap-2">
                                <i class="fa-solid fa-layer-group text-emerald-500"></i>細選群組
                            </h3>
                            <button id="close-modal-btn" class="text-wabi-text-secondary hover:text-wabi-text-primary p-1">
                                <i class="fa-solid fa-times text-base"></i>
                            </button>
                        </div>
                        <div class="mb-3">
                            <div class="flex items-center gap-2 bg-wabi-surface border border-wabi-border rounded-lg p-2.5">
                                <i class="fa-solid fa-magnifying-glass text-wabi-text-secondary text-xs"></i>
                                <input type="text" id="modal-group-search-input" placeholder="搜尋全量群組名稱..." class="w-full text-xs bg-transparent text-wabi-text-primary focus:outline-none" autocomplete="off" />
                            </div>
                        </div>
                        <div id="modal-group-list-container" class="flex-1 overflow-y-auto pr-1">
                            <!-- 進行中與已結清列表 -->
                        </div>
                    </div>
                `

                document.body.appendChild(modal)
                renderModalContent()

                modal.querySelector('#close-modal-btn')?.addEventListener('click', () => modal.remove())
                modal.addEventListener('click', e => {
                    if (e.target === modal) modal.remove()
                })
                modal.querySelector('#modal-group-search-input')?.addEventListener('input', e => {
                    renderModalContent(e.target.value)
                })
            }

            // 註：原搜尋欄「清單」小按鈕已移除；全量細選改由清單底部「查看全部 N 筆」進入
        }
        let calcPrev = null // 運算前值
        let calcOp = null // 當前運算子
        let calcNew = true // 是否剛開始輸入新數字

        const calculate = (a, op, b) => {
            const numA = parseFloat(a)
            const numB = parseFloat(b)
            switch (op) {
                case '+':
                    return numA + numB
                case '-':
                    return numA - numB
                case '×':
                    return numA * numB
                case '÷':
                    return numB !== 0 ? numA / numB : NaN
                default:
                    return numB
            }
        }

        const formatCalcResult = num => {
            if (isNaN(num) || !isFinite(num)) return '0'
            // 處理浮點數精度問題
            const result = parseFloat(num.toPrecision(12))
            // 限制小數點後 2 位
            return parseFloat(result.toFixed(2)).toString()
        }

        // 儲存按鈕動態切換：計算中顯示「＝」，否則顯示「儲存」
        const updateSaveButtonUI = () => {
            const saveBtn = document.querySelector(
                '.keypad-btn[data-key="save"]'
            )
            if (!saveBtn || !calculatorModeEnabled) return
            if (calcOp !== null) {
                // 計算中：變成等號樣式
                saveBtn.innerHTML = '<span class="font-bold text-2xl">＝</span>'
                saveBtn.classList.remove('bg-wabi-accent', 'text-wabi-primary')
                saveBtn.classList.add('bg-amber-500', 'text-white')
            } else {
                // 正常狀態：顯示儲存
                saveBtn.innerHTML = '<span class="font-bold">儲存</span>'
                saveBtn.classList.remove('bg-amber-500', 'text-white')
                saveBtn.classList.add('bg-wabi-accent', 'text-wabi-primary')
            }
        }

        // --- Account Selector Logic ---
        const accountSelectorContainer = document.getElementById(
            'account-selector-container'
        )

        const updateAccountSelectorUI = () => {
            if (!advancedModeEnabled || !accountSelectorContainer) return
            const selectedAccount = accounts.find(
                a => a.id === selectedAccountId
            )
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
                                refreshUpfrontState()
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
            accounts = await this.app.dataService.getAccounts()
            if (accounts.length > 0) {
                selectedAccountId = accounts[0].id // Default to first account
            } else {
                accountSelectorContainer.innerHTML = `<p class="text-center text-red-500">請先至「設定」頁面建立一個帳戶</p>`
            }
        }
        // 初始化信用卡分期 upfront 狀態（預設帳戶可能是卡）
        refreshUpfrontState()

        const toggleKeypadGrid = force => {
            const shouldOpen = force === undefined ? !keypadGridOpen : force
            const icon = keypadToggleBtn.querySelector('i')
            if (shouldOpen) {
                keypadGrid.style.display = 'grid'
                keypadToggleBtn.classList.add(
                    'bg-wabi-accent',
                    'text-wabi-primary'
                )
                if (icon) {
                    icon.classList.remove('fa-keyboard')
                    icon.classList.add('fa-chevron-up')
                }
            } else {
                keypadGrid.style.display = 'none'
                keypadToggleBtn.classList.remove(
                    'bg-wabi-accent',
                    'text-wabi-primary'
                )
                if (icon) {
                    icon.classList.remove('fa-chevron-up')
                    icon.classList.add('fa-keyboard')
                }
            }
            keypadGridOpen = shouldOpen
        }

        keypadContainer.classList.remove('translate-y-full')

        // Initialize virtual keyboard detector
        vkDetector = new VirtualKeyboardDetector({
            onShow: () => {
                if (window.innerWidth < 768) {
                    vkForcedHide = true
                    toggleKeypadGrid(false) // 強制隱藏 keypad
                }
            },
            onHide: () => {
                if (vkForcedHide) {
                    vkForcedHide = false
                    toggleKeypadGrid(true) // 恢復顯示 keypad
                }
            },
            threshold: 150,
        })
        vkDetector.start()

        const updateTypeUI = () => {
            if (currentType === 'expense') {
                expenseBtn.classList.add(
                    'bg-wabi-expense',
                    'text-wabi-surface',
                    'shadow-sm'
                )
                incomeBtn.classList.remove(
                    'bg-wabi-income',
                    'text-wabi-surface',
                    'shadow-sm'
                )
                amountDisplay.classList.remove('text-wabi-income')
                amountDisplay.classList.add('text-wabi-expense')
            } else {
                incomeBtn.classList.add(
                    'bg-wabi-income',
                    'text-wabi-surface',
                    'shadow-sm'
                )
                expenseBtn.classList.remove(
                    'bg-wabi-expense',
                    'text-wabi-surface',
                    'shadow-sm'
                )
                amountDisplay.classList.remove('text-wabi-expense')
                amountDisplay.classList.add('text-wabi-income')
            }
            renderCategories()
            const category = this.app.categoryManager.getCategoryById(
                currentType,
                selectedCategory
            )
            updateSelectedCategoryUI(category)
        }

        const renderCategories = () => {
            categoryGrid.innerHTML = ''
            const categories =
                this.app.categoryManager.getAllCategories(currentType)
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
                    <div class="flex size-12 items-center justify-center rounded-full ${colorClass} text-white" ${colorStyle}>
                        <i class="${cat.icon} text-2xl"></i>
                    </div>
                    <p class="text-xs text-center text-wabi-text-secondary">${cat.name}</p>
                `
                btn.addEventListener('click', () => {
                    selectedCategory = cat.id
                    updateSelectedCategoryUI(cat)
                    document
                        .querySelectorAll('.category-button')
                        .forEach(b =>
                            b.classList.remove('active', 'active-income')
                        )
                    btn.classList.add(
                        currentType === 'income' ? 'active-income' : 'active'
                    )
                })
                categoryGrid.appendChild(btn)
            })
            const manageBtn = document.createElement('button')
            manageBtn.className =
                'flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-dashed border-wabi-border hover:border-wabi-primary'
            manageBtn.innerHTML = `<div class="flex size-12 items-center justify-center rounded-full bg-wabi-text-secondary/10"><i class="fa-solid fa-gear text-2xl text-wabi-text-secondary"></i></div><p class="text-xs text-center text-wabi-text-secondary">管理</p>`
            manageBtn.addEventListener('click', () =>
                this.app.categoryManager.showManageCategoriesModal(
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
                const colorClass = !category.color.startsWith('#')
                    ? category.color
                    : ''
                selectedCategoryUI.innerHTML = `
                    <div class="flex items-center justify-center rounded-full ${colorClass} text-white shrink-0 size-12" ${colorStyle}>
                        <i class="${category.icon} text-3xl"></i>
                    </div>
                    <p class="text-lg font-medium flex-1 truncate">${category.name}</p>
                `
            } else {
                selectedCategoryUI.innerHTML = `<div class="flex items-center justify-center rounded-full bg-wabi-text-secondary/10 shrink-0 size-12"><i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i></div><p class="text-lg font-medium">選擇分類</p>`
            }

            // 提示：還款 / 欠款回收 類別較為特殊
            const debtHint = document.getElementById('add-debt-category-hint')
            if (debtHint) {
                const isSpecial =
                    category &&
                    (category.id === 'debt_repayment' ||
                        category.id === 'debt_collection')
                debtHint.classList.toggle('hidden', !isSpecial)
            }
        }

        const saveInstallmentPlan = async amount => {
            const instName = document
                .getElementById('installment-name')
                ?.value.trim()
            const instPeriods = parseInt(
                document.getElementById('installment-periods')?.value
            )
            if (!instName) {
                showToast('請輸入分期名稱', 'error')
                return
            }
            if (!instPeriods || instPeriods <= 0) {
                showToast('請輸入有效的期數', 'error')
                return
            }
            const instDownPayment =
                parseFloat(
                    document.getElementById('installment-downpayment')?.value
                ) || 0
            const instRate =
                parseFloat(
                    document.getElementById('installment-interest')?.value
                ) || 0
            const instFrequency =
                document.getElementById('installment-frequency')?.value ||
                'monthly'
            const decimalStrategy =
                document.getElementById('installment-decimal-strategy')
                    ?.value || 'round'

            // 信用卡分期：upfront 模式（全額入账 + 月度扣款），首付禁用
            const upfrontCard = getUpfrontCard()
            const isUpfront = !!upfrontCard
            const downPayment = isUpfront ? 0 : instDownPayment
            const principal = Math.max(0, amount - downPayment)

            const { amountPerPeriod } = calculateAmortizationDetails(
                principal,
                instPeriods,
                instRate,
                instFrequency,
                decimalStrategy
            )

            if (isUpfront) {
                // 全額入账：立即佔用額度（真實消費事實，不可刪除）
                await this.app.dataService.addRecord({
                    type: 'expense',
                    category: selectedCategory,
                    amount,
                    date: currentDate,
                    description: `${instName} 信用卡分期入账`,
                    accountId: selectedAccountId,
                    ledgerId: this.app.dataService.activeLedgerId,
                })
            }

            await this.app.dataService.addAmortization({
                name: instName,
                type: installmentType,
                recordType: currentType,
                category: selectedCategory,
                totalAmount: amount,
                downPayment,
                interestRate: instRate,
                periods: instPeriods,
                completedPeriods: 0,
                amountPerPeriod,
                frequency: instFrequency,
                decimalStrategy,
                startDate: currentDate,
                // upfront：首期扣款自下月開始（刷卡當月只入账）；periodic 維持現行「建立即產生首期」
                nextDueDate: isUpfront
                    ? calculateNextDueDate(currentDate, instFrequency, 1)
                    : currentDate,
                status: 'active',
                description: noteInput.value || '',
                accountId: advancedModeEnabled ? selectedAccountId : null,
                chargeMode: isUpfront ? 'upfront' : 'periodic',
            })
            await this.app.processAmortizations()
            showToast(
                isUpfront
                    ? `「${instName}」已全額入账，${formatCurrency(amountPerPeriod)} 起每月自動扣款`
                    : `「${instName}」分期計畫已建立！`
            )
            window.location.hash = 'records'
        }

        const saveRegularRecord = async amount => {
            // 「建立即生效」後，儲存時不再有「建立新群組」分支：
            // 確定名稱時已立即 createGroup + 自動選取，這裡直接用 selectedGroupId

            // 防陷阱：編輯非分期來的紀錄時，若分期面板開著，
            // 儲存流程只處理普通紀錄（會忽略分期設定）→ 提示先收起
            if (isEditMode && installmentPanelOpen) {
                showToast(
                    '此紀錄非由分期產生，儲存為普通紀錄前請先收起分期面板',
                    'error'
                )
                return
            }

            const recordData = {
                type: currentType,
                category: selectedCategory,
                amount: amount,
                description: noteInput.value,
                date: currentDate,
                accountId: advancedModeEnabled ? selectedAccountId : null,
                // groupId: 明確「取消關聯」→ null；啟用面板 → 用使用者選的；
                // 未開啟面板 → 編輯模式保留原始值；新增 → null
                groupId: groupCleared
                    ? null
                    : groupEnabled
                    ? selectedGroupId || null
                    : isEditMode
                    ? recordToEdit?.groupId ?? null
                    : null,
                // groupStatus: 取消關聯 → null；啟用面板 → 依是否開啟欠款標記為
                // active(分帳欠款) 或 project(純專案消費)；未開啟 → 保留原始值
                groupStatus: groupCleared
                    ? null
                    : groupEnabled
                    ? selectedGroupId
                        ? debtEnabled && debtContactId
                            ? 'active'
                            : 'project'
                        : null
                    : isEditMode
                    ? recordToEdit?.groupStatus ?? null
                    : null,
            }

            if (isEditMode) {
                try {
                    const numericId = parseInt(recordId, 10)
                    await this.app.dataService.updateRecord(
                        numericId,
                        recordData
                    )

                    // If record has existing debt, check if amount changed and update
                    if (recordToEdit.debtId && recordToEdit.amount !== amount) {
                        const debt = await this.app.dataService.getDebt(
                            recordToEdit.debtId
                        )
                        if (debt && !debt.settled) {
                            const oldOriginal =
                                debt.originalAmount ?? debt.amount ?? 0
                            const oldRemaining =
                                debt.remainingAmount ?? oldOriginal
                            const paidAmount = oldOriginal - oldRemaining
                            const newRemaining = Math.max(
                                0,
                                amount - paidAmount
                            )
                            await this.app.dataService.updateDebt(
                                recordToEdit.debtId,
                                {
                                    originalAmount: amount,
                                    remainingAmount: newRemaining,
                                }
                            )
                        }
                    }

                    // If record doesn't have debt but user enabled debt, create one
                    if (debtEnabled && debtContactId && !recordToEdit.debtId) {
                        const debtId = await this.app.dataService.addDebt({
                            type: debtType,
                            contactId: debtContactId,
                            amount: amount,
                            date: currentDate,
                            description: noteInput.value || selectedCategory,
                            recordId: numericId,
                        })
                        await this.app.dataService.updateRecord(numericId, {
                            debtId: debtId,
                        })
                        showToast('更新成功並建立欠款記錄！')
                    } else {
                        showToast('更新成功！')
                    }
                    window.location.hash = 'records'
                } catch (e) {
                    console.error('Update failed or cancelled:', e)
                }
            } else {
                const newRecordId =
                    await this.app.dataService.addRecord(recordData)
                if (!newRecordId) return
                this.app.quickSelectManager.addRecord(
                    recordData.type,
                    recordData.category,
                    recordData.description,
                    recordData.accountId
                )

                if (debtEnabled && debtContactId) {
                    const debtId = await this.app.dataService.addDebt({
                        type: debtType,
                        contactId: debtContactId,
                        amount: amount,
                        date: currentDate,
                        description: noteInput.value || selectedCategory,
                        recordId: newRecordId,
                    })
                    await this.app.dataService.updateRecord(newRecordId, {
                        debtId: debtId,
                    })
                    showToast('儲存成功並建立欠款記錄！')
                } else {
                    showToast('儲存成功！')
                }
                window.location.hash = 'records'
            }
        }

        const handleKeypad = async key => {
            // 計算機運算符處理
            if (['+', '-', '×', '÷'].includes(key)) {
                if (currentAmount !== '0') {
                    if (calcPrev !== null && !calcNew) {
                        // 連續運算：先計算上一筆
                        currentAmount = formatCalcResult(
                            calculate(calcPrev, calcOp, currentAmount)
                        )
                    }
                    calcPrev = currentAmount
                    calcOp = key
                    calcNew = true
                }
                updateSaveButtonUI()
                amountDisplay.textContent = formatCurrency(currentAmount)
                return
            }

            if ((key >= '0' && key <= '9') || key === '00') {
                if (calcNew && calcPrev !== null) {
                    // 運算後輸入新數字，重置
                    currentAmount = key
                    calcNew = false
                } else if (currentAmount === '0') {
                    currentAmount = key === '00' ? '0' : key
                } else {
                    if (currentAmount.replace('.', '').length < 9)
                        currentAmount += key
                }
            } else if (key === '.') {
                if (calcNew && calcPrev !== null) {
                    currentAmount = '0.'
                    calcNew = false
                } else if (!currentAmount.includes('.')) currentAmount += '.'
            } else if (key === 'backspace') {
                currentAmount = currentAmount.slice(0, -1) || '0'
            } else if (key === 'ac') {
                currentAmount = '0'
                calcPrev = null
                calcOp = null
                calcNew = true
                updateSaveButtonUI()
            } else if (key === 'done') {
                toggleKeypadGrid(false)
            } else if (key === 'save') {
                // 計算機模式下，如果正在計算中，按下 save 先執行等於
                if (calculatorModeEnabled && calcOp !== null) {
                    currentAmount = formatCalcResult(
                        calculate(calcPrev, calcOp, currentAmount)
                    )
                    calcPrev = null
                    calcOp = null
                    calcNew = true
                    updateSaveButtonUI()
                    amountDisplay.textContent = formatCurrency(currentAmount)
                    return
                }
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
                    if (installmentEnabled && !isEditMode) {
                        await saveInstallmentPlan(amount)
                    } else {
                        await saveRegularRecord(amount)
                    }
                } else {
                    showToast('請輸入金額並選擇分類', 'error')
                }
            }
            amountDisplay.textContent = formatCurrency(currentAmount)
        }

        if (isEditMode) {
            const numericRecordId = parseInt(recordId, 10)

            // 重新渲染（用於欠款/分期/群組關聯變更後刷新頁面）
            // 定義在 isEditMode 頂層，debt 與 amort 兩區塊皆可呼叫
            const refresh = async () => {
                const params = new URLSearchParams()
                if (recordId) params.append('id', recordId)
                await this.render(params)
            }

            const records = await this.app.dataService.getRecords()
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
                    const debt = await this.app.dataService.getDebt(
                        recordToEdit.debtId
                    )
                    if (debt) {
                        const contacts =
                            await this.app.dataService.getContacts()
                        const contact = contacts.find(
                            c => c.id === debt.contactId
                        )
                        const contactName = contact?.name || '未知聯絡人'
                        const isReceivable = debt.type === 'receivable'
                        const remainingAmount =
                            debt.remainingAmount ??
                            debt.originalAmount ??
                            debt.amount ??
                            0
                        const originalAmount =
                            debt.originalAmount ?? debt.amount ?? 0
                        const paidPercent =
                            originalAmount > 0
                                ? Math.round(
                                      ((originalAmount - remainingAmount) /
                                          originalAmount) *
                                          100
                                  )
                                : 0

                        // Store debt info for later use
                        debtContactId = debt.contactId
                        debtType = debt.type
                        updateDebtBtn() // 已有關聯欠款 → 右上角按鈕維持 active

                        // Build contact options for edit
                        const contactOptions = contacts
                            .map(
                                c =>
                                    `<option value="${c.id}" ${c.id === debt.contactId ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
                            )
                            .join('')

                        // Show debt info panel
                        const debtInfoPanel = document.createElement('div')
                        debtInfoPanel.id = 'debt-info-panel'
                        debtInfoPanel.className =
                            'bg-wabi-primary/5 rounded-lg p-4 mb-4 border border-wabi-primary/25'
                        debtInfoPanel.innerHTML = `
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-medium text-wabi-primary">
                                    <i class="fa-solid fa-handshake mr-2"></i>關聯欠款
                                </span>
                                <div class="flex items-center gap-2">
                                    <button id="view-associated-debt-btn" class="text-xs text-wabi-primary hover:underline flex items-center gap-1 font-medium bg-transparent border-0 cursor-pointer">
                                        <i class="fa-solid fa-eye"></i>查看欠款
                                    </button>
                                    ${debt.settled ? '<span class="text-xs bg-wabi-income/20 text-wabi-income px-2 py-1 rounded">已還清</span>' : ''}
                                </div>
                            </div>
                            ${
                                !debt.settled
                                    ? `
                                <!-- Editable debt info -->
                                <div class="space-y-2 mb-3">
                                    <div class="flex gap-2">
                                        <button id="debt-type-receivable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${isReceivable ? 'bg-wabi-income text-white border-wabi-income' : 'border-wabi-border text-wabi-text-secondary'}">
                                            別人欠我
                                        </button>
                                        <button id="debt-type-payable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${!isReceivable ? 'bg-wabi-expense text-white border-wabi-expense' : 'border-wabi-border text-wabi-text-secondary'}">
                                            我欠別人
                                        </button>
                                    </div>
                                    <select id="debt-contact-edit" class="w-full p-2 border border-wabi-border rounded-lg text-sm bg-wabi-surface text-wabi-text-primary">
                                        ${contactOptions}
                                    </select>
                                </div>
                                <!-- Progress bar -->
                                <div class="mb-3">
                                    <div class="flex justify-between text-xs text-wabi-text-secondary mb-1">
                                        <span>剩餘：${formatCurrency(remainingAmount)}</span>
                                        <span>${paidPercent}% 已還</span>
                                    </div>
                                    <div class="w-full bg-wabi-border rounded-full h-2">
                                        <div class="bg-wabi-income h-2 rounded-full" style="width: ${paidPercent}%"></div>
                                    </div>
                                </div>
                                <!-- Action buttons -->
                                <div class="flex gap-2">
                                    <button id="partial-pay-btn" class="flex-1 py-2 text-sm font-medium text-wabi-surface bg-wabi-primary rounded-lg">
                                        <i class="fa-solid fa-coins mr-1"></i>還款
                                    </button>
                                    <button id="remove-debt-link-btn" class="py-2 px-3 text-sm font-medium text-wabi-expense border border-wabi-expense/40 rounded-lg bg-wabi-surface">
                                        <i class="fa-solid fa-unlink"></i>
                                    </button>
                                </div>
                            `
                                    : `
                                <div class="text-sm text-wabi-text-secondary">
                                    <p><strong class="text-wabi-text-primary">聯絡人：</strong>${contactName}</p>
                                    <p><strong class="text-wabi-text-primary">類型：</strong>${isReceivable ? '別人欠我' : '我欠別人'}</p>
                                    <p><strong class="text-wabi-text-primary">原始金額：</strong>${formatCurrency(originalAmount)}</p>
                                </div>
                            `
                            }
                        `

                        // Insert after header
                        const header = this.app.appContainer.querySelector(
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

                        // Bind view associated debt button
                        document.getElementById('view-associated-debt-btn')?.addEventListener('click', (e) => {
                            e.preventDefault();
                            window.location.hash = `#debts?debtId=${debt.id}`;
                        });

                        // Bind debt type edit buttons
                        document
                            .getElementById('debt-type-receivable-edit')
                            ?.addEventListener('click', async () => {
                                await this.app.dataService.updateDebt(debt.id, {
                                    type: 'receivable',
                                })
                                showToast('欠款類型已更新')
                                await refresh()
                            })
                        document
                            .getElementById('debt-type-payable-edit')
                            ?.addEventListener('click', async () => {
                                await this.app.dataService.updateDebt(debt.id, {
                                    type: 'payable',
                                })
                                showToast('欠款類型已更新')
                                await refresh()
                            })

                        // Bind contact edit
                        document
                            .getElementById('debt-contact-edit')
                            ?.addEventListener('change', async e => {
                                const newContactId = parseInt(e.target.value)
                                if (newContactId) {
                                    await this.app.dataService.updateDebt(
                                        debt.id,
                                        {
                                            contactId: newContactId,
                                        }
                                    )
                                    showToast('欠款人已更新')
                                }
                            })

                        // Bind partial payment button - show custom modal
                        const partialPayBtn =
                            document.getElementById('partial-pay-btn')
                        if (partialPayBtn) {
                            partialPayBtn.addEventListener('click', () => {
                                this.showPaymentModal(
                                    debt,
                                    recordId,
                                    remainingAmount
                                )
                            })
                        }

                        // Bind remove debt link button
                        const removeDebtBtn = document.getElementById(
                            'remove-debt-link-btn'
                        )
                        if (removeDebtBtn) {
                            removeDebtBtn.addEventListener(
                                'click',
                                async () => {
                                    if (
                                        await customConfirm(
                                            '確定要取消此記錄與欠款的關聯嗎？欠款記錄將被刪除。'
                                        )
                                    ) {
                                        await this.app.dataService.deleteDebt(
                                            debt.id
                                        )
                                        await this.app.dataService.updateRecord(
                                            numericRecordId,
                                            {
                                                debtId: null,
                                            }
                                        )
                                        showToast('已取消欠款關聯')
                                        await refresh()
                                    }
                                }
                            )
                        }
                    }
                }
            }

            // Load associated amortization if exists
            if (recordToEdit.amortizationId) {
                const amort = await this.app.dataService.getAmortization(
                    recordToEdit.amortizationId
                )
                if (amort) {
                    const amortInfoPanel = document.createElement('div')
                    amortInfoPanel.className =
                        'bg-blue-500/10 rounded-lg p-4 mb-4 border border-blue-500/30'
                    amortInfoPanel.innerHTML = `
                        <div class="flex items-center justify-between mb-2">
                            <span class="font-medium text-blue-600">
                                <i class="fa-solid fa-credit-card mr-2"></i>由分期計畫產生
                            </span>
                            <button id="view-amort-link-btn" class="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600">
                                查看計畫
                            </button>
                        </div>
                        <div class="text-sm text-wabi-text-secondary">
                            <p><strong class="text-wabi-text-primary">名稱：</strong>${escapeHTML(amort.name)}</p>
                            <p><strong class="text-wabi-text-primary">期數進度：</strong>${amort.completedPeriods} / ${amort.periods} 期</p>
                            <p><strong class="text-wabi-text-primary">總金額：</strong>${formatCurrency(amort.totalAmount)}</p>
                            ${amort.chargeMode === 'upfront' ? '<p class="mt-1 text-amber-600">信用卡分期（全額入账 + 每月扣款），不支援編輯</p>' : ''}
                        </div>
                        <div class="flex gap-2 mt-3">
                            <button id="remove-amort-link-btn" class="flex-1 py-2 text-sm font-medium text-wabi-expense border border-wabi-expense/40 rounded-lg bg-wabi-surface">
                                <i class="fa-solid fa-unlink mr-1"></i>取消分期關聯
                            </button>
                        </div>
                    `
                    const header = this.app.appContainer.querySelector(
                        '.page .flex.items-center.pb-2'
                    )
                    if (header && header.nextElementSibling) {
                        header.parentNode.insertBefore(
                            amortInfoPanel,
                            header.nextElementSibling
                        )
                    }
                    const viewBtn = document.getElementById(
                        'view-amort-link-btn'
                    )
                    if (viewBtn) {
                        viewBtn.addEventListener('click', e => {
                            e.preventDefault()
                            window.location.hash = '#amortizations'
                        })
                    }

                    // Bind remove amortization link button（取消分期關聯）
                    const removeAmortBtn = document.getElementById(
                        'remove-amort-link-btn'
                    )
                    if (removeAmortBtn) {
                        removeAmortBtn.addEventListener('click', async () => {
                            if (
                                !(await customConfirm(
                                    `確定要取消此記錄與分期計畫的關聯嗎？\n\n「${amort.name}」計畫會被刪除，已產生的記帳紀錄不會被刪除。`
                                ))
                            )
                                return
                            await this.app.dataService.deleteAmortization(amort.id)
                            await this.app.dataService.updateRecord(
                                numericRecordId,
                                { amortizationId: null }
                            )
                            showToast('已取消分期關聯', 'success')
                            await refresh()
                        })
                    }

                    // Hide the toggle installment button
                    if (installmentBtn) {
                        installmentBtn.classList.add('hidden')
                    }
                    if (installmentPanel) {
                        installmentPanel.classList.add('hidden')
                    }
                }
            }

            // 編輯模式：顯示既有群組（面板自動展開、按鈕 active、可取消）
            // loadGroupList 是群組區塊內部的 block-scoped 函數，
            // 透過 applyEditGroupPrefill 這支 closure hook 呼叫（該區塊執行時設定）
            if (
                isEditMode &&
                recordToEdit?.groupId &&
                typeof applyEditGroupPrefill === 'function'
            ) {
                await applyEditGroupPrefill()
            }
        }

        const handleQuickSelect = (
            type,
            categoryId,
            description,
            accountId
        ) => {
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
            this.app.quickSelectManager.render(
                quickSelectContainer,
                handleQuickSelect,
                this.app.categoryManager,
                advancedModeEnabled
            )
        }

        keypadToggleBtn.addEventListener('click', () => toggleKeypadGrid())

        // Clicking amount display opens the keypad for quick input
        amountDisplay.style.cursor = 'pointer'
        amountDisplay.title = '點擊輸入金額'
        amountDisplay.addEventListener('click', () => toggleKeypadGrid(true))

        dateInput.addEventListener('change', e => {
            currentDate = e.target.value
            dateDisplay.textContent = formatDate(currentDate, 'short')
            // 日期影響信用卡分期提示的首期扣款日（自 X 起每期扣）
            refreshUpfrontState()
        })
        document.querySelectorAll('.keypad-btn').forEach(btn => {
            btn.addEventListener('click', () => handleKeypad(btn.dataset.key))
        })

        // Add physical keyboard listener for the add page
        if (this._keypadListener) {
            document.removeEventListener('keydown', this._keypadListener)
        }
        this._keypadListener = e => {
            if (
                this.app.router.currentHash &&
                !this.app.router.currentHash.startsWith('#add')
            )
                return
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

            if (calculatorModeEnabled) {
                keyMap['+'] = '+'
                keyMap['-'] = '-'
                keyMap['*'] = '×'
                keyMap['/'] = '÷'
                keyMap['='] = 'save'
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
                    if (await customConfirm('確定要刪除這筆紀錄嗎？')) {
                        const id = parseInt(recordId, 10)
                        const record = await this.app.dataService.getRecord(id)
                        const associatedDebtId = record?.debtId

                        await this.app.dataService.deleteRecord(id)

                        const isRepaymentCategory =
                            record?.category === 'debt_repayment' ||
                            record?.category === 'debt_collection'

                        if (associatedDebtId && !isRepaymentCategory) {
                            if (
                                await customConfirm(
                                    '此紀錄有關聯的欠款，是否也要一併刪除該欠款？'
                                )
                            ) {
                                await this.app.dataService.deleteDebt(
                                    associatedDebtId
                                )
                                showToast('紀錄與關聯欠款已刪除')
                            } else {
                                // 清除欠款上的反向引用，避免留下孤立指標
                                await this.app.dataService.updateDebt(
                                    associatedDebtId,
                                    {
                                        recordId: null,
                                        recordUuid: null,
                                    }
                                )
                                showToast('紀錄已刪除')
                            }
                        } else {
                            showToast('紀錄已刪除')
                        }

                        window.location.hash = 'records'
                    }
                })
        }

        updateTypeUI()
        updateAccountSelectorUI()
        // Initialize keypad state: visible by default, auto-hide when virtual keyboard appears
        toggleKeypadGrid(true)
        // 初始化儲存按鈕 UI 狀態
        updateSaveButtonUI()

        // --- AI 語意記帳整合 (在新增模式下啟用) ---
        const openGeminiModal = () => {
            this.showGeminiVoiceModal({
                currentType,
                accounts,
                updateTypeUI,
                updateSelectedCategoryUI,
                renderCategories,
                updateAccountSelectorUI,
                advancedModeEnabled,
                getAmountDisplay: () => amountDisplay,
                getNoteInput: () => noteInput,
                getDateInput: () => document.getElementById('add-date-input'),
                getDateDisplay: () => document.getElementById('date-display'),
                setSelectedCategory: (catId) => { selectedCategory = catId },
                setSelectedAccount: (accId) => { selectedAccountId = accId },
                setCurrentType: (type) => { currentType = type },
                setCurrentAmount: (amt) => { currentAmount = amt }
            })
        }


        // 監聽底部導覽列按鈕：僅當使用者「已在全新記帳新增頁面」且非編輯模式時，點擊底部麥克風按鈕觸發語音 Modal
        const navAddBtn = document.querySelector('a[data-page="add"]')
        if (navAddBtn) {
            if (isEditMode) {
                navAddBtn.onclick = null
            } else {
                navAddBtn.onclick = (e) => {
                    const currentHash = window.location.hash || '#home'
                    const isEditUrl = currentHash.includes('editRecordId=')
                    const isAddPage = (currentHash === '#add' || currentHash.startsWith('#add')) && !isEditUrl
                    if (isAddPage && this.aiService && this.aiService.isExperimentalEnabled()) {
                        e.preventDefault()
                        openGeminiModal()
                    }
                }
            }
        }
    }

    createKeypadButton(key, isEditMode = false, calculatorModeEnabled = false) {
        let content = key
        if (key === 'ac') content = 'AC'
        if (key === 'backspace')
            content = '<i class="fa-solid fa-delete-left"></i>'
        if (key === 'save') {
            // 計算機模式：save 按鈕會根據 calcOp 狀態切換顯示「儲存」或「＝」
            content = isEditMode
                ? '<span class="font-bold">更新</span>'
                : '<span class="font-bold">儲存</span>'
        }

        let specialClasses
        if (key === 'save') {
            // save 按鈕跨 2 行；計算機模式下會有動態樣式切換
            specialClasses =
                'row-span-2 bg-wabi-accent text-wabi-primary flex items-center justify-center text-lg'
        } else if (
            calculatorModeEnabled &&
            ['+', '-', '×', '÷'].includes(key)
        ) {
            specialClasses = 'bg-amber-500/20 text-amber-600 font-medium'
        } else if (key === 'ac') {
            specialClasses = 'bg-wabi-border text-wabi-text-primary'
        } else if (key === 'backspace') {
            specialClasses = 'text-wabi-text-primary'
        } else if (key === '') {
            specialClasses = 'bg-transparent'
        } else {
            specialClasses = 'text-wabi-text-primary'
        }

        if (key === '') return `<div class="${specialClasses}"></div>`

        return `
            <button data-key="${key}" class="keypad-btn text-xl py-2 text-center rounded-none transition-colors touch-manipulation duration-200 ease-in-out ${specialClasses} hover:bg-black/5">
                ${content}
            </button>
        `
    }

    showGeminiVoiceModal({
        currentType,
        accounts,
        updateTypeUI,
        updateSelectedCategoryUI,
        renderCategories,
        updateAccountSelectorUI,
        advancedModeEnabled,
        getAmountDisplay,
        getNoteInput,
        getDateInput,
        getDateDisplay,
        setSelectedCategory,
        setSelectedAccount,
        setCurrentType,
        setCurrentAmount
    }) {
        const aiService = this.aiService || this.app.aiService
        const modal = document.createElement('div')
        modal.id = 'gemini-voice-modal'
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in'

        modal.innerHTML = `
            <div class="gemini-rainbow-glow-container max-w-md w-full shadow-2xl">
                <div class="gemini-rainbow-modal-body p-6 border border-white/60 dark:border-slate-700/60 rounded-3xl text-wabi-text-primary space-y-4">
                    <div class="flex items-center justify-between border-b border-wabi-border/60 pb-3">
                        <div class="flex items-center gap-3">
                            <div id="gemini-mic-pulse" class="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center animate-pulse text-lg shadow-md shrink-0">
                                <i class="fa-solid fa-microphone"></i>
                            </div>
                            <div>
                                <h3 class="text-base font-bold text-wabi-text-primary">AI 語音轉錄記帳</h3>
                                <p id="gemini-status-hint" class="text-xs text-wabi-text-secondary">正在聆聽您的口述內容...</p>
                            </div>
                        </div>
                        <button id="close-gemini-modal" class="text-wabi-text-secondary hover:text-wabi-text-primary p-1 text-lg">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div id="ai-modal-update-banner" class="${aiService && aiService.hasModelUpdate() ? '' : 'hidden'} p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2">
                        <span class="flex items-center gap-1.5"><i class="fa-solid fa-cloud-arrow-down text-amber-500 shrink-0"></i><span>發現新版本 AI 模型，可前往設定更新</span></span>
                        <button id="go-to-ai-settings-btn" class="px-2.5 py-1 text-[11px] font-bold bg-amber-500 text-white rounded-lg shrink-0 hover:bg-amber-600 transition-colors cursor-pointer">前往更新</button>
                    </div>

                    <div class="p-3 rounded-2xl bg-wabi-bg/70 border border-wabi-border/60 text-sm font-medium leading-relaxed">
                        <textarea id="gemini-live-transcript" rows="3" placeholder="請開始說話，或在此手動輸入/修改記帳描述..." class="w-full bg-transparent resize-none outline-none text-wabi-text-primary placeholder:text-wabi-text-secondary/70 text-sm font-medium leading-relaxed"></textarea>
                    </div>

                    <!-- AI 實時淡入生成輸出視窗 (低調簡約灰色風) -->
                    <div id="gemini-ai-stream-box" class="hidden p-2.5 rounded-xl bg-wabi-bg/60 border border-wabi-border/40 text-xs font-mono space-y-1 overflow-hidden transition-all duration-300">
                        <div class="flex items-center justify-between text-[11px] text-wabi-text-secondary/60 pb-0.5">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-sparkles text-amber-500/70 text-[10px] animate-pulse"></i> AI 思考生成中...</span>
                        </div>
                        <div id="gemini-ai-stream-text" class="max-h-20 overflow-y-auto leading-relaxed text-[11px] text-wabi-text-secondary/70 dark:text-slate-400 font-mono tracking-wide"></div>
                    </div>

                    <div class="flex items-center gap-3 pt-1">
                        <button id="gemini-toggle-mic-btn" class="size-12 rounded-2xl bg-red-500 text-white flex items-center justify-center text-lg hover:opacity-90 transition-opacity shrink-0" title="停止/重新錄音">
                            <i class="fa-solid fa-stop"></i>
                        </button>
                        <button id="gemini-parse-btn" class="flex-1 h-12 bg-wabi-primary text-wabi-surface rounded-2xl font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm shadow-md">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span id="gemini-parse-btn-text">AI 語意分析</span>
                        </button>
                    </div>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const closeBtn = modal.querySelector('#close-gemini-modal')
        const transcriptInput = modal.querySelector('#gemini-live-transcript')
        const statusHint = modal.querySelector('#gemini-status-hint')
        const micPulse = modal.querySelector('#gemini-mic-pulse')
        const toggleMicBtn = modal.querySelector('#gemini-toggle-mic-btn')
        const parseBtn = modal.querySelector('#gemini-parse-btn')
        const parseBtnText = modal.querySelector('#gemini-parse-btn-text')

        let recognition = null
        let isRecording = false
        let baseText = ''

        // 智慧融合兩段文字，自動消除 str1 尾部與 str2 首部的重疊/重複內容
        const mergeOverlappingText = (str1, str2) => {
            if (!str1) return str2 || ''
            if (!str2) return str1 || ''

            const s1 = str1.trim()
            const s2 = str2.trim()
            if (!s1) return s2
            if (!s2) return s1

            // 1. 若 s2 完全以 s1 開頭 -> 直接返回 s2
            if (s2.startsWith(s1)) return s2

            // 2. 若 s1 完全包含 s2 結尾 -> 直接返回 s1
            if (s1.endsWith(s2)) return s1

            // 3. 尋找 s1 尾部與 s2 首部的最大重疊子字串
            const maxOverlap = Math.min(s1.length, s2.length)
            for (let len = maxOverlap; len > 0; len--) {
                const tail = s1.slice(-len)
                const head = s2.slice(0, len)
                if (tail === head) {
                    return s1 + s2.slice(len)
                }
            }

            // 4. 無重疊時的自然拼接：若皆為中文則直接相連，否則加空格
            const isS1Chinese = /[\u4e00-\u9fa5]$/.test(s1)
            const isS2Chinese = /^[\u4e00-\u9fa5]/.test(s2)
            const separator = (isS1Chinese && isS2Chinese) ? '' : ' '
            return `${s1}${separator}${s2}`
        }

        // 手動輸入即時同步至 baseText，避免語音辨識蓋過手動塗改
        transcriptInput.addEventListener('input', () => {
            baseText = transcriptInput.value.trim()
        })

        const closeModal = () => {
            if (recognition && isRecording) {
                try { recognition.stop() } catch (e) { /* ignore */ }
            }
            modal.remove()
        }

        closeBtn.addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        const goToSettingsBtn = modal.querySelector('#go-to-ai-settings-btn')
        const updateBanner = modal.querySelector('#ai-modal-update-banner')
        if (goToSettingsBtn) {
            goToSettingsBtn.addEventListener('click', () => {
                closeModal()
                window.location.hash = '#settings'
            })
        }

        if (aiService && typeof aiService.checkForModelUpdate === 'function') {
            aiService.checkForModelUpdate().then(res => {
                if (res && res.hasUpdate && updateBanner) {
                    updateBanner.classList.remove('hidden')
                }
            }).catch(() => {})
        }

        if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
            recognition = new SpeechRec()
            recognition.continuous = true
            recognition.interimResults = true
            recognition.lang = 'zh-TW'

            recognition.onstart = () => {
                isRecording = true
                baseText = transcriptInput.value.trim()
                micPulse.className = 'w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center animate-pulse text-lg shadow-md shrink-0'
                toggleMicBtn.className = 'size-12 rounded-2xl bg-red-500 text-white flex items-center justify-center text-lg hover:opacity-90 transition-opacity shrink-0'
                toggleMicBtn.innerHTML = '<i class="fa-solid fa-stop"></i>'
                statusHint.textContent = '正在聆聽您的口述內容（可直接點擊下方輸入框手動修改）...'
            }

            recognition.onend = () => {
                isRecording = false
                baseText = transcriptInput.value.trim()
                micPulse.className = 'w-10 h-10 rounded-full bg-wabi-primary text-wabi-surface flex items-center justify-center text-lg shadow-md shrink-0'
                toggleMicBtn.className = 'size-12 rounded-2xl bg-wabi-primary/10 text-wabi-primary flex items-center justify-center text-lg hover:bg-wabi-primary/20 transition-colors shrink-0'
                toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>'
                if (transcriptInput.value.trim()) {
                    statusHint.textContent = '可手動編輯文字，點擊「AI 語意分析」開始自動填單'
                } else {
                    statusHint.textContent = '可直接在此手動輸入，或點擊麥克風開始錄音'
                }
            }

            recognition.onresult = event => {
                let speechText = ''

                // 遍歷當前辨識到的所有結果片段並進行重疊融合
                for (let i = 0; i < event.results.length; i++) {
                    const transcript = event.results[i][0]?.transcript || ''
                    if (!transcript) continue
                    speechText = mergeOverlappingText(speechText, transcript)
                }

                // 過濾連續出現的重複短語 (如 "便當便當" -> "便當")
                speechText = speechText.replace(/(.{2,15}?)(?:\s*|,|，|\+)\1+/g, '$1')

                // 智慧融合初始/手動基準文字與語音辨識文字
                const fullDisplay = mergeOverlappingText(baseText, speechText)

                if (fullDisplay) {
                    transcriptInput.value = fullDisplay
                    transcriptInput.scrollTop = transcriptInput.scrollHeight
                }
            }

            recognition.onerror = event => {
                isRecording = false
                micPulse.className = 'w-10 h-10 rounded-full bg-wabi-primary text-wabi-surface flex items-center justify-center text-lg shadow-md shrink-0'
                toggleMicBtn.className = 'size-12 rounded-2xl bg-wabi-primary/10 text-wabi-primary flex items-center justify-center text-lg hover:bg-wabi-primary/20 transition-colors shrink-0'
                toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>'

                if (event.error === 'network') {
                    statusHint.textContent = '無法連線至語音辨識伺服器（請確認網路連線），您仍可在此手動輸入文字'
                } else if (event.error === 'not-allowed') {
                    statusHint.textContent = '未取得麥克風存取權限，請授權後重試，或直接在此手動輸入'
                } else if (event.error === 'no-speech') {
                    statusHint.textContent = '未偵測到聲音，可點擊麥克風重試，或直接在此手動輸入'
                } else {
                    statusHint.textContent = `語音服務暫時無法使用 (${event.error})，您可直接在此手動輸入文字`
                }
            }

            try { recognition.start() } catch (e) { /* ignore */ }
        } else {
            statusHint.textContent = '您的瀏覽器不支援 Web Speech 語音輸入，請直接手動輸入'
        }

        toggleMicBtn.addEventListener('click', () => {
            if (!recognition) return
            if (isRecording) {
                recognition.stop()
            } else {
                recognition.start()
            }
        })

        parseBtn.addEventListener('click', async () => {
            const text = transcriptInput.value.trim()
            if (!text) {
                showToast('請先口述或手動輸入記帳描述內容！', 'warning')
                return
            }

            if (recognition && isRecording) {
                try { recognition.stop() } catch (e) { /* ignore */ }
            }

            const streamBox = modal.querySelector('#gemini-ai-stream-box')
            const streamText = modal.querySelector('#gemini-ai-stream-text')
            if (streamBox && streamText) {
                streamBox.classList.remove('hidden')
                streamText.innerHTML = ''
            }

            parseBtn.disabled = true
            parseBtnText.textContent = 'AI 解析中...'
            statusHint.textContent = 'AI 正在分析金額、分類、帳戶與日期...'

            const onTokenCallback = (piece) => {
                if (streamText) {
                    const span = document.createElement('span')
                    span.className = 'animate-token-appear inline'
                    span.textContent = piece
                    streamText.appendChild(span)
                    streamText.scrollTop = streamText.scrollHeight
                }
            }

            try {
                const categoryManager = this.app.categoryManager
                const accountNames = accounts.map(a => a.name)
                const allCatNames = categoryManager.getAllCategories().map(c => c.name)

                // 首次推論：提供全部分類供模型參考 (含流式輸出)
                let parsed = await aiService.parseRecord(text, allCatNames, accountNames, new Date(), onTokenCallback)

                // 防呆機制：驗證收支類型與分類相符度
                const recognizedType = parsed.type === 'income' ? 'income' : 'expense'
                const targetCatNames = categoryManager.getAllCategories(recognizedType).map(c => c.name)
                const oppositeType = recognizedType === 'income' ? 'expense' : 'income'
                const oppositeCatNames = categoryManager.getAllCategories(oppositeType).map(c => c.name)

                // 若生成的類別不存在，或者辨識出來的類別其實屬於相反收支類型的分類中：
                if (parsed.category && (!targetCatNames.includes(parsed.category) || oppositeCatNames.includes(parsed.category))) {
                    console.warn(`[AI 防呆驗證] 分類 "${parsed.category}" 未能在 ${recognizedType} 分類中匹配，移除無關收支類型的分類重新執行 AI 解析...`)
                    if (streamText) streamText.textContent = ''
                    // 移除無關收支類型的分類，只把目標收支類型的分類放進 System Prompt 重跑一次
                    parsed = await aiService.parseRecord(text, targetCatNames, accountNames, new Date(), onTokenCallback)
                }

                // 1. 套用收支類型 (Income/Expense)
                if (parsed.type && parsed.type !== currentType) {
                    setCurrentType(parsed.type)
                    updateTypeUI()
                }

                // 2. 套用金額
                if (parsed.amount) {
                    setCurrentAmount(parsed.amount.toString())
                    const amountDisplay = getAmountDisplay()
                    if (amountDisplay) {
                        amountDisplay.textContent = formatCurrency(parsed.amount.toString())
                    }
                }

                // 3. 套用描述與備註
                if (parsed.description) {
                    const noteInput = getNoteInput()
                    if (noteInput) noteInput.value = parsed.description
                }

                // 4. 套用日期
                if (parsed.date) {
                    const dateInput = getDateInput()
                    const dateDisplay = getDateDisplay()
                    if (dateInput) {
                        dateInput.value = parsed.date
                        if (dateDisplay) dateDisplay.textContent = formatDate(parsed.date)
                    }
                }

                // 5. 分類防呆：若重試後依然找不到匹配分類，留預設選定分類
                if (parsed.category) {
                    const currentTypeCats = categoryManager.getAllCategories(currentType)
                    const matchedCat = currentTypeCats.find(c => c.name === parsed.category)
                    if (matchedCat) {
                        setSelectedCategory(matchedCat.id)
                        updateSelectedCategoryUI(matchedCat)
                        renderCategories()
                    } else {
                        console.warn(`[AI 防呆驗證] 重新解析後分類 "${parsed.category}" 仍無法與系統分類匹配，保留預設分類`)
                    }
                }

                // 6. 帳戶防呆：若辨識出來的帳戶不存在，留預設選定帳戶
                if (parsed.account && advancedModeEnabled) {
                    const matchedAcc = accounts.find(a => a.name === parsed.account)
                    if (matchedAcc) {
                        setSelectedAccount(matchedAcc.id)
                        updateAccountSelectorUI()
                    } else {
                        console.warn(`[AI 防呆驗證] AI 解析之帳戶 "${parsed.account}" 不存在於帳戶清單，保留預設帳戶`)
                    }
                }

                if (aiService.lastMode === 'rules') {
                    showToast('AI 已用離線規則模式解析（模型未就緒），分類/日期可能不準', 'warning')
                } else {
                    showToast('AI 記帳解析成功！已自動填妥欄位。', 'success')
                }
                closeModal()
            } catch (err) {
                console.error('AI 解析失敗:', err)
                showToast('AI 解析發生錯誤: ' + err.message, 'error')
                parseBtn.disabled = false
                parseBtnText.textContent = 'AI 語意分析'
            }
        })
    }

    showAccountSelectionModal(accounts, currentAccountId, onSelect) {
        const modal = document.createElement('div')
        modal.id = 'account-selection-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'

        const accountListHtml = accounts
            .map(account => {
                const isHex = account.color && account.color.startsWith('#')
                const colorClass = isHex
                    ? ''
                    : escapeHTML(account.color || 'bg-gray-500')
                const colorStyle = isHex
                    ? `style="background-color: ${escapeHTML(account.color)}"`
                    : ''
                return `
            <button data-id="${account.id}" class="account-select-item w-full flex items-center gap-4 p-4 rounded-lg text-left ${account.id === currentAccountId ? 'bg-wabi-accent/20' : 'hover:bg-wabi-surface'}">
                <div class="relative flex items-center justify-center rounded-lg ${colorClass} text-white shrink-0 size-10" ${colorStyle}>
                    <i class="${escapeHTML(account.icon || 'fa-solid fa-wallet')} text-xl"></i>
                    ${account.type === 'credit_card' ? '<span class="absolute -top-1 -right-1 bg-wabi-expense text-wabi-surface text-xs px-1 rounded-full" title="信用卡"><i class="fa-solid fa-credit-card"></i></span>' : ''}
                </div>
                <span class="font-medium text-wabi-text-primary">${escapeHTML(account.name)}</span>
            </button>
        `
            })
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

    async showPaymentModal(debt, recordId, remainingAmount) {
        const isReceivable = debt.type === 'receivable';

        const advancedModeSetting = await this.app.dataService.getSetting('advancedAccountModeEnabled');
        const isAdvancedMode = !!advancedModeSetting?.value;
        let accounts = [];
        let defaultAccountId = null;

        if (isAdvancedMode) {
            accounts = await this.app.dataService.getAccounts();
            let preferredId = null;
            if (debt.recordId) {
                const mainRecord = await this.app.dataService.getRecord(debt.recordId);
                if (mainRecord && mainRecord.accountId) {
                    preferredId = mainRecord.accountId;
                }
            }
            // 還款無法入信用卡帳戶：信用卡轉導至其自動扣繳帳戶/現金
            defaultAccountId = await this.app.dataService.resolveDefaultSettleAccountId(preferredId);
            if (!defaultAccountId && accounts.length > 0) {
                defaultAccountId = accounts[0].id;
            }
        }

        const modal = document.createElement('div');
        modal.id = 'payment-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

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

                ${isAdvancedMode ? `
                <div class="mb-4">
                    <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${isReceivable ? '入帳' : '出帳'}帳戶</label>
                    <select id="payment-account-select" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
                        ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
                    </select>
                </div>
                ` : ''}

                <div class="flex gap-2 mb-4">
                    <button id="pay-full-btn" class="flex-1 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg bg-wabi-primary/10">
                        <i class="fa-solid fa-check-double mr-1"></i>全額還清
                    </button>
                </div>

                <div class="flex gap-3">
                    <button id="confirm-payment-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
                        確認
                    </button>
                    <button id="cancel-payment-btn" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
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

            const accountSelect = modal.querySelector('#payment-account-select');
            const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;

            await this.app.dataService.settleDebt(debt.id, amount, {
                accountId: selectedAccountId,
            });
            closeModal();
            showToast('還款成功！');
            // Re-render
            const params = new URLSearchParams();
            if(recordId) params.append('id', recordId);
            await this.render(params);
        });
    }
}

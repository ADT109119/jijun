import { showToast } from '../utils.js'

export class PreferencesPage {
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
                <!-- Top Header -->
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary transition-colors p-1" title="返回設定">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">記帳與偏好設定</h2>
                    <div class="w-8"></div>
                </div>

                <div class="p-4 space-y-6">
                    <!-- Keypad & Input Preferences -->
                    <div class="bg-wabi-surface rounded-xl overflow-hidden shadow-sm">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">記帳小鍵盤</h3>
                        
                        <!-- Calculator Mode Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-calculator"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">關閉計算機功能</p>
                                    <p class="text-xs text-wabi-text-secondary">記帳小鍵盤不顯示加減乘除與等於鍵</p>
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
                    </div>

                    <!-- Records Display Preferences -->
                    <div class="bg-wabi-surface rounded-xl overflow-hidden shadow-sm">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">明細瀏覽</h3>
                        
                        <!-- Default Records Period -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-clock-rotate-left"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">明細預設時間範圍</p>
                                    <p class="text-xs text-wabi-text-secondary">進入明細頁面時預設顯示的時間範圍</p>
                                </div>
                            </div>
                        </div>
                        <div id="default-period-container" class="px-4 pb-4 pt-2 bg-wabi-bg/30">
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
                    </div>

                    <!-- Reminders & Notifications -->
                    <div class="bg-wabi-surface rounded-xl overflow-hidden shadow-sm">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">提醒與通知</h3>
                        
                        <!-- Daily Reminder Feature -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 py-3.5 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-bell"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">每日提醒</p>
                                    <p class="text-xs text-wabi-text-secondary">定時發送推播提醒記帳</p>
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

                        <!-- Low Balance Warning Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-triangle-exclamation"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">餘額不足提醒</p>
                                    <p class="text-xs text-wabi-text-secondary">支出存入後帳戶透支或信用卡超出額度時警示（需開啟多帳戶模式）</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="low-balance-warning-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="low-balance-warning-info" class="hidden px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <p class="text-xs text-wabi-text-secondary mt-2"><i class="fa-solid fa-circle-info mr-1"></i>記帳時若該筆支出使一般帳戶餘額轉為負值、或信用卡欠款超出額度，會以黃色警示提示（不阻擋記帳）。</p>
                        </div>

                        <!-- Calendar Bill Dots Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-calendar-day"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">行事曆繳款圓點</p>
                                    <p class="text-xs text-wabi-text-secondary">收支分析月曆標示信用卡繳款日（紅點）與出帳日（藍點）（需開啟多帳戶模式）</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="calendar-bill-dots-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="calendar-bill-dots-info" class="hidden px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <p class="text-xs text-wabi-text-secondary mt-2"><i class="fa-solid fa-circle-info mr-1"></i>停用後，收支分析的行事曆金流檢視將不再標示信用卡繳款日（紅點）與出帳日（藍點）。</p>
                        </div>
                    </div>

                    ${isAndroidApk ? `
                    <!-- Android Carrier Settings -->
                    <div class="bg-wabi-surface rounded-xl overflow-hidden shadow-sm">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">電子發票</h3>
                        <button id="set-invoice-carrier-btn" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-barcode"></i>
                                </div>
                                <div class="text-left">
                                    <p class="text-wabi-text-primary text-base font-normal">設定發票載具</p>
                                    <p id="current-invoice-carrier-text" class="text-xs text-wabi-text-secondary">點擊設定或修改發票手機條碼</p>
                                </div>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-chevron-right"></i>
                            </div>
                        </button>
                    </div>
                    ` : ''}

                    <div class="pb-24"></div>
                </div>
            </div>
        `

        await this.setupPreferencesListeners(isAndroidApk)
    }

    async setupPreferencesListeners(isAndroidApk) {
        // 1. Calculator Mode Toggle
        const calculatorModeToggle = document.getElementById('calculator-mode-toggle')
        if (calculatorModeToggle) {
            this.app.dataService.getSetting('calculatorModeEnabled').then(setting => {
                const isEnabled = setting ? !!setting.value : true // 預設為 true (開啟)
                calculatorModeToggle.checked = !isEnabled // 關閉按鈕勾選代表 disabled (!isEnabled)
                if (!isEnabled) {
                    document.getElementById('calculator-mode-info')?.classList.remove('hidden')
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
                    document.getElementById('calculator-mode-info')?.classList.remove('hidden')
                } else {
                    document.getElementById('calculator-mode-info')?.classList.add('hidden')
                }
                showToast(`小鍵盤計算機模式已${isEnabled ? '啟用' : '停用'}`)
            })
        }

        // 2. Default Records Period Setting
        const defaultPeriodSelect = document.getElementById('default-period-select')
        if (defaultPeriodSelect) {
            this.app.dataService.getSetting('defaultRecordsPeriod').then(setting => {
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

        // 3. Daily Reminder UI Setup
        const reminderToggle = document.getElementById('reminder-toggle')
        const reminderSettingsContainer = document.getElementById('reminder-settings-container')
        const reminderTimeInput = document.getElementById('reminder-time')
        const reminderConditionSelect = document.getElementById('reminder-condition')

        if (reminderToggle) {
            Promise.all([
                this.app.dataService.getSetting('reminderEnabled'),
                this.app.dataService.getSetting('reminderTime'),
                this.app.dataService.getSetting('reminderCondition'),
            ]).then(([enabledSetting, timeSetting, conditionSetting]) => {
                const isEnabled = !!enabledSetting?.value
                reminderToggle.checked = isEnabled
                reminderTimeInput.value = timeSetting?.value || '20:00'
                reminderConditionSelect.value = conditionSetting?.value || 'no_records'

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
                    const hasPerm = await this.app.notificationService.requestPermission()
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
            reminderConditionSelect.addEventListener('change', updateReminderLogic)
        }

        // 4. Low Balance Warning Toggle
        const lowBalanceWarningToggle = document.getElementById('low-balance-warning-toggle')
        if (lowBalanceWarningToggle) {
            this.app.dataService.getSetting('lowBalanceWarningEnabled').then(setting => {
                const isEnabled = !!setting?.value
                lowBalanceWarningToggle.checked = isEnabled
                if (isEnabled) {
                    document.getElementById('low-balance-warning-info')?.classList.remove('hidden')
                }
            })

            lowBalanceWarningToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'lowBalanceWarningEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    document.getElementById('low-balance-warning-info')?.classList.remove('hidden')
                    // 導覽系統：開關開啟瞬間在偏好頁彈功能介紹氣泡
                    if (this.app.guideManager) {
                        this.app.guideManager.showToggleTour('lowBalance')
                    }
                } else {
                    document.getElementById('low-balance-warning-info')?.classList.add('hidden')
                }
                showToast(`餘額不足提醒已${isEnabled ? '啟用' : '停用'}`)
            })
        }

        // 5. Calendar Bill Dots Toggle
        const calendarBillDotsToggle = document.getElementById('calendar-bill-dots-toggle')
        if (calendarBillDotsToggle) {
            this.app.dataService.getSetting('calendarBillDotsEnabled').then(setting => {
                const isEnabled = !(setting && setting.value === false)
                calendarBillDotsToggle.checked = isEnabled
                if (!isEnabled) {
                    document.getElementById('calendar-bill-dots-info')?.classList.remove('hidden')
                }
            })

            calendarBillDotsToggle.addEventListener('change', async e => {
                const isEnabled = e.target.checked
                await this.app.dataService.saveSetting({
                    key: 'calendarBillDotsEnabled',
                    value: isEnabled,
                })
                if (isEnabled) {
                    document.getElementById('calendar-bill-dots-info')?.classList.add('hidden')
                } else {
                    document.getElementById('calendar-bill-dots-info')?.classList.remove('hidden')
                }
                showToast(`行事曆繳款圓點已${isEnabled ? '啟用' : '停用'}`)
            })
        }

        // 6. Invoice Carrier Setting Button (Android APK)
        if (isAndroidApk) {
            const setInvoiceCarrierBtn = document.getElementById('set-invoice-carrier-btn')
            const currentCarrierText = document.getElementById('current-invoice-carrier-text')
            const savedCarrier = localStorage.getItem('invoice_carrier_code') || ''
            if (currentCarrierText && savedCarrier) {
                currentCarrierText.textContent = `目前載具：${savedCarrier}`
            }

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
                            if (currentCarrierText) {
                                currentCarrierText.textContent = trimmed ? `目前載具：${trimmed}` : '點擊設定或修改發票手機條碼'
                            }
                            showToast('發票載具設定成功！', 'success')
                            
                            const { updateAndroidWidget } = await import('../widgetHelper.js')
                            updateAndroidWidget(this.app.dataService, this.app.budgetManager)
                        }
                    )
                })
            }
        }
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
                    <input type="text" id="pref-input-value" value="${defaultValue}" class="w-full bg-wabi-surface border border-wabi-border text-wabi-text-primary text-base rounded-lg focus:ring-2 focus:ring-wabi-primary focus:border-wabi-primary p-3 outline-none" placeholder="例如: /ABC1234">
                </div>
                <div class="flex space-x-3">
                    <button id="pref-input-ok" class="flex-1 bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        確定
                    </button>
                    <button id="pref-input-cancel" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const inputEl = modal.querySelector('#pref-input-value')
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
            .querySelector('#pref-input-cancel')
            .addEventListener('click', () => modal.remove())
        modal
            .querySelector('#pref-input-ok')
            .addEventListener('click', handleOk)

        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                handleOk()
            }
        })
    }
}

import {
    formatCurrency,
    showToast,
    escapeHTML,
    formatDateToString,
    customAlert,
    customConfirm,
} from '../utils.js'
import { FONT_AWESOME_ICONS } from '../fontAwesomeIcons.js'
import { getCategoryName, getCategoryIcon } from '../categories.js'

export class AccountsPage {
    constructor(app) {
        this.app = app
    }

    async render() {
        const advancedMode = await this.app.dataService.getSetting(
            'advancedAccountModeEnabled'
        )
        if (!advancedMode?.value) {
            window.location.hash = '#settings'
            return
        }

        this.app.appContainer.innerHTML = `
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

                <!-- Credit Card Debt Summary -->
                <div id="credit-debt-section" class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8 text-center hidden">
                    <p class="text-wabi-text-secondary text-base font-medium">信用卡總欠款</p>
                    <p id="credit-debt-total" class="text-wabi-expense text-4xl font-bold tracking-tight mt-1">$0</p>
                </div>

                <!-- Account List -->
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold text-wabi-primary">帳戶列表</h3>
                    <div class="flex gap-2">
                        <button id="transfer-btn" class="bg-wabi-income text-wabi-surface rounded-full w-8 h-8 flex items-center justify-center">
                            <i class="fa-solid fa-money-bill-transfer"></i>
                        </button>
                        <button id="add-account-btn" class="bg-wabi-primary text-wabi-surface rounded-full w-8 h-8 flex items-center justify-center">
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
        await this.app.dataService.deduplicateAccounts()

        // 每次載入帳戶管理時，自動檢查並產生到期帳單與執行自動扣繳平帳
        try {
            await this.app.dataService.autoGenerateCreditStatements()
            await this.app.dataService.autoPayCreditStatements()
            await this.app.dataService.updateCreditStatementsStatus()
        } catch (err) {
            console.warn('自動處理信用卡帳單扣繳失敗:', err)
        }

        const accounts = await this.app.dataService.getAccounts()
        const allRecords = await this.app.dataService.getRecords() // Get all records once
        // 建立「我欠別人」(payable) 欠款的 id 集合，用於從帳戶餘額中排除其原始欠款紀錄
        // （依使用者模型：建立 payable 欠款當下不扣款，實際扣款發生於還款時）
        const debts = await this.app.dataService.getDebts()
        const payableDebtIds = new Set(
            debts.filter(d => d.type === 'payable').map(d => String(d.id))
        )
        const isBalanceExempt = record =>
            record.debtId !== null &&
            payableDebtIds.has(String(record.debtId)) &&
            record.category !== 'debt_repayment'
        const container = document.getElementById('accounts-list-container')
        const totalAssetsEl = document.getElementById('total-assets')

        let totalAssets = 0
        let totalCreditDebt = 0
        let hasCreditCard = false
        container.innerHTML = ''

        if (accounts.length === 0) {
            container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">尚未建立任何帳戶</p>`
        }

        for (const account of accounts) {
            const recordsForAccount = allRecords.filter(
                r => r.accountId === account.id && !isBalanceExempt(r)
            )
            const currentBalance = recordsForAccount.reduce(
                (balance, record) => {
                    return (
                        balance +
                        (record.type === 'income'
                            ? record.amount
                            : -record.amount)
                    )
                },
                account.balance
            ) // Start with initial balance

            // 信用卡：currentBalance 為淨現金流（消費為負、繳款為正）。
            // 欠款（額度佔用）= 餘額為負時的欠款金額；餘額為正代表超繳，欠款為 0
            const creditLimit = account.creditLimit || 0
            const cardDebt = Math.max(
                0,
                -1 * (typeof currentBalance === 'number' ? currentBalance : 0)
            )

            const isCreditCard = account.type === 'credit_card'
            let billingInfo = null
            let hasOverdue = false
            if (isCreditCard) {
                hasCreditCard = true
                totalCreditDebt += cardDebt
                billingInfo =
                    await this.app.dataService.getCreditCardBillingInfo(
                        account.id
                    )
                const today0 = new Date().setHours(0, 0, 0, 0)
                hasOverdue = (billingInfo?.unpaidStatements || []).some(
                    s => s.dueDate && today0 >= new Date(s.dueDate).setHours(0, 0, 0, 0)
                )
            } else {
                totalAssets += currentBalance
            }

            const availableCredit = Math.max(0, creditLimit - cardDebt)
            const billedDueTotal = billingInfo?.billedDueTotal || 0
            const unbilledTotal = billingInfo?.unbilledTotal || 0

            const accountEl = document.createElement('div')
            accountEl.className =
                'flex items-center justify-between bg-wabi-surface p-3.5 sm:p-4 rounded-lg border border-wabi-border hover:border-wabi-primary/40 transition-colors'
            const isHex = account.color && account.color.startsWith('#')
            const colorClass = isHex ? '' : (account.color || 'bg-gray-500')
            const colorStyle = isHex
                ? `style="background-color: ${escapeHTML(account.color)}"`
                : ''

            if (isCreditCard) {
                accountEl.className =
                    'bg-wabi-surface p-3.5 sm:p-4 rounded-xl border border-wabi-border hover:border-wabi-primary/40 transition-colors space-y-3'
                accountEl.innerHTML = `
                    <!-- 頂部：卡片圖示、名稱、標籤與繳款快捷按鈕 -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer credit-card-card-click" data-id="${account.id}" title="點擊查看帳務明細 (即時消費 / 出帳帳單)">
                            <div class="relative shrink-0">
                                <div class="flex items-center justify-center rounded-lg ${colorClass} text-wabi-surface shrink-0 size-10 sm:size-11" ${colorStyle}>
                                    <i class="${account.icon} text-lg sm:text-xl"></i>
                                </div>
                                <span class="absolute -top-1 -right-1 bg-wabi-expense text-wabi-surface text-[9px] px-1 rounded-full font-bold" title="信用卡"><i class="fa-solid fa-credit-card"></i></span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <p class="font-bold text-wabi-text-primary text-sm sm:text-base truncate">${escapeHTML(account.name)}</p>
                                    <span class="text-[10px] bg-wabi-expense/10 text-wabi-expense px-1.5 py-0.5 rounded-full shrink-0 font-medium">信用卡</span>
                                    ${hasOverdue ? '<span class="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full shrink-0 font-medium">已到期待扣款</span>' : ''}
                                </div>
                                <p class="text-[11px] sm:text-xs text-wabi-text-secondary mt-0.5 truncate">
                                    總欠款: <span class="font-semibold text-wabi-expense">${formatCurrency(cardDebt)}</span>${creditLimit > 0 ? ` · 可用 ${formatCurrency(availableCredit)} / 額度 ${formatCurrency(creditLimit)}` : ''}
                                </p>
                            </div>
                        </div>
                        <div class="shrink-0 flex items-center">
                            <button class="credit-pay-btn px-2.5 py-1 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 ${hasOverdue ? 'bg-amber-500 hover:bg-amber-600 text-white' : billedDueTotal > 0 ? 'bg-wabi-expense hover:opacity-90 text-white' : 'bg-wabi-bg text-wabi-text-secondary hover:text-wabi-primary border border-wabi-border'}" data-id="${account.id}" title="${hasOverdue ? '已到期，立即扣繳平帳' : '立即繳款'}">
                                <i class="fa-solid fa-money-bill-wave text-[11px]"></i>
                                <span>${hasOverdue ? '扣繳平帳' : '繳款'}</span>
                            </button>
                        </div>
                    </div>

                    <!-- 中間：準備繳納 與 即時未出帳 獨立雙欄卡片 -->
                    <div class="grid grid-cols-2 gap-2 cursor-pointer credit-card-card-click" data-id="${account.id}" title="點擊查看帳務明細 (即時消費 / 出帳帳單)">
                        <div class="bg-wabi-bg/70 dark:bg-wabi-bg/40 p-2.5 rounded-lg border border-wabi-border/60">
                            <span class="text-[11px] text-wabi-text-secondary block truncate">
                                <i class="fa-solid fa-clock mr-1 text-[10px] text-wabi-expense"></i>準備繳納 (已出帳)
                            </span>
                            <p class="text-sm sm:text-base font-bold mt-0.5 truncate ${billedDueTotal > 0 ? 'text-wabi-expense' : 'text-wabi-text-primary'}">
                                ${formatCurrency(billedDueTotal)}
                            </p>
                        </div>
                        <div class="bg-wabi-bg/70 dark:bg-wabi-bg/40 p-2.5 rounded-lg border border-wabi-border/60">
                            <span class="text-[11px] text-wabi-text-secondary block truncate">
                                <i class="fa-solid fa-bolt mr-1 text-[10px] text-blue-500"></i>即時未出帳
                            </span>
                            <p class="text-sm sm:text-base font-bold mt-0.5 truncate text-blue-600 dark:text-blue-400">
                                ${formatCurrency(unbilledTotal)}
                            </p>
                        </div>
                    </div>

                    <!-- 底部：帳單消費明細入口與管理功能 (矯正、編輯、刪除) -->
                    <div class="flex items-center justify-between pt-2 border-t border-wabi-border/50 text-xs">
                        <button class="credit-detail-btn text-wabi-primary hover:text-wabi-accent font-medium flex items-center gap-1.5 transition-colors py-0.5" data-id="${account.id}" title="查看帳單與即時消費">
                            <i class="fa-solid fa-file-invoice-dollar text-sm"></i>
                            <span>帳單與消費明細</span>
                            <i class="fa-solid fa-chevron-right text-[10px] opacity-60"></i>
                        </button>
                        <div class="flex items-center gap-1 text-wabi-text-secondary">
                            <button class="adjust-balance-btn p-1.5 hover:text-wabi-primary transition-colors" data-id="${account.id}" data-balance="${currentBalance}" title="餘額矯正">
                                <i class="fa-solid fa-scale-balanced text-sm"></i>
                            </button>
                            <button class="edit-account-btn p-1.5 hover:text-wabi-primary transition-colors" data-id="${account.id}" title="編輯帳戶">
                                <i class="fa-solid fa-pen text-sm"></i>
                            </button>
                            <button class="delete-account-btn p-1.5 text-wabi-expense hover:text-red-700 transition-colors" data-id="${account.id}" title="刪除帳戶">
                                <i class="fa-solid fa-trash-can text-sm"></i>
                            </button>
                        </div>
                    </div>
                `
            } else {
                accountEl.className =
                    'flex items-center justify-between bg-wabi-surface p-3.5 sm:p-4 rounded-xl border border-wabi-border hover:border-wabi-primary/40 transition-colors'
                accountEl.innerHTML = `
                    <div class="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                        <div class="flex items-center justify-center rounded-lg ${colorClass} text-wabi-surface shrink-0 size-11 sm:size-12" ${colorStyle}>
                            <i class="${account.icon} text-xl sm:text-2xl"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-medium text-wabi-text-primary text-sm sm:text-base truncate">${escapeHTML(account.name)}</p>
                            <p class="text-sm text-wabi-text-secondary">餘額: ${formatCurrency(currentBalance)}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1 sm:gap-2 shrink-0 ml-2">
                        <button class="adjust-balance-btn p-1.5 sm:p-2 text-wabi-text-secondary hover:text-wabi-primary transition-colors" data-id="${account.id}" data-balance="${currentBalance}" title="餘額矯正">
                            <i class="fa-solid fa-scale-balanced text-sm sm:text-base"></i>
                        </button>
                        <button class="edit-account-btn p-1.5 sm:p-2 text-wabi-text-secondary hover:text-wabi-primary transition-colors" data-id="${account.id}" title="編輯帳戶">
                            <i class="fa-solid fa-pen text-sm sm:text-base"></i>
                        </button>
                        <button class="delete-account-btn p-1.5 sm:p-2 text-wabi-expense hover:text-red-700 transition-colors" data-id="${account.id}" title="刪除帳戶">
                            <i class="fa-solid fa-trash-can text-sm sm:text-base"></i>
                        </button>
                    </div>
                `
            }
            container.appendChild(accountEl)
        }

        totalAssetsEl.textContent = formatCurrency(totalAssets)

        // 信用卡總欠款區塊顯示邏輯
        const creditDebtSection = document.getElementById('credit-debt-section')
        const creditDebtTotalEl = document.getElementById('credit-debt-total')
        if (hasCreditCard) {
            creditDebtSection.classList.remove('hidden')
            creditDebtTotalEl.textContent = formatCurrency(totalCreditDebt)
        } else {
            creditDebtSection.classList.add('hidden')
        }

        document
            .getElementById('add-account-btn')
            .addEventListener('click', () => {
                this.showAccountModal()
            })

        document
            .getElementById('transfer-btn')
            .addEventListener('click', () => {
                this.showTransferModal()
            })

        container
            .querySelectorAll('.credit-detail-btn, .credit-card-card-click')
            .forEach(btn => {
                btn.addEventListener('click', async e => {
                    const accountId = parseInt(e.currentTarget.dataset.id, 10)
                    if (Number.isNaN(accountId)) return
                    const account =
                        await this.app.dataService.getAccount(accountId)
                    if (account) {
                        this.showCreditDetailModal(account)
                    }
                })
            })

        container.querySelectorAll('.adjust-balance-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10)
                const currentBalance = parseFloat(
                    e.currentTarget.dataset.balance
                )
                const account = await this.app.dataService.getAccount(accountId)
                this.showAdjustBalanceModal(account, currentBalance)
            })
        })

        container.querySelectorAll('.edit-account-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10)
                const account = await this.app.dataService.getAccount(accountId)
                this.showAccountModal(account)
            })
        })

        container.querySelectorAll('.credit-pay-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10)
                if (Number.isNaN(accountId)) return
                const account = await this.app.dataService.getAccount(accountId)
                if (!account) {
                    showToast('無法找到該信用卡帳戶', 'error')
                    return
                }
                this.showCreditPayModal(account)
            })
        })

        container.querySelectorAll('.delete-account-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10)
                const records = await this.app.dataService.getRecords({
                    accountId,
                })
                if (records.length > 0) {
                    customAlert('此帳戶尚有交易紀錄，無法刪除。')
                    return
                }
                if (await customConfirm('確定要刪除此帳戶嗎？')) {
                    await this.app.dataService.deleteAccount(accountId)
                    showToast('帳戶已刪除')
                    this.render() // Re-render the page
                }
            })
        })
    }

    async showAdjustBalanceModal(account, currentBalance) {
        // 取得所有信用卡帳戶供「補扣卡費」平帳選擇
        const allAccounts = await this.app.dataService.getAccounts()
        const creditCards = allAccounts.filter(a => a.type === 'credit_card')
        const isNotCreditCard = account.type !== 'credit_card'

        const modal = document.createElement('div')
        modal.id = 'adjust-balance-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden'
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-4 sm:p-6 space-y-4 max-h-[90vh] flex flex-col overflow-hidden box-border">
                <h3 class="text-lg font-bold text-wabi-primary">餘額矯正</h3>

                <div class="space-y-4">
                    <div>
                        <p class="text-sm font-medium text-wabi-text-secondary">目前餘額</p>
                        <p class="text-lg font-bold text-wabi-text-primary mt-1">${formatCurrency(currentBalance)}</p>
                    </div>
                    <div>
                        <label class="text-sm font-medium text-wabi-text-secondary">實際餘額</label>
                        <input type="number" id="actual-balance-input" value="${currentBalance}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary" step="0.01" required>
                    </div>
                    <div id="difference-display" class="hidden">
                        <p class="text-sm font-medium text-wabi-text-secondary">差額</p>
                        <p id="difference-amount" class="text-lg font-bold mt-1"></p>
                    </div>
                    <div id="diff-reason-section" class="space-y-2 pt-2 border-t border-wabi-border/40 hidden">
                        <label class="text-xs font-semibold text-wabi-text-secondary">平帳原因</label>
                        <div class="space-y-1.5 text-xs">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="adjust-reason" value="general" checked class="text-wabi-primary focus:ring-wabi-primary">
                                <span class="text-wabi-text-primary">一般帳務差額 (平帳)</span>
                            </label>
                            ${isNotCreditCard && creditCards.length > 0 ? `
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="adjust-reason" value="credit_pay" class="text-wabi-primary focus:ring-wabi-primary">
                                <span class="text-wabi-text-primary">補記信用卡費扣繳 (不計入生活支出)</span>
                            </label>
                            ` : ''}
                        </div>
                        ${isNotCreditCard && creditCards.length > 0 ? `
                        <div id="adjust-card-select-container" class="hidden mt-1.5 pl-6">
                            <label class="text-[11px] text-wabi-text-secondary block mb-1">選擇扣繳的信用卡</label>
                            <select id="adjust-credit-card-select" class="w-full text-xs p-2 rounded-lg border-wabi-border bg-wabi-surface text-wabi-text-primary truncate">
                                ${creditCards.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}
                            </select>
                        </div>
                        ` : ''}
                    </div>
                    <div class="flex items-center gap-2 mt-2">
                        <input type="checkbox" id="add-adjustment-record" class="h-4 w-4 text-wabi-primary focus:ring-wabi-primary border-gray-300 rounded" checked>
                        <label for="add-adjustment-record" class="text-sm text-wabi-text-secondary cursor-pointer">加入記帳紀錄 (平帳)</label>
                    </div>
                </div>

                <div class="flex gap-2 pt-4 border-t border-wabi-border mt-2">
                    <button id="save-adjustment-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg hover:bg-wabi-accent/90 transition-colors">儲存</button>
                    <button id="cancel-adjustment-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg hover:bg-wabi-bg transition-colors">取消</button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const closeModal = () => modal.remove()
        const actualBalanceInput = modal.querySelector('#actual-balance-input')
        const diffDisplay = modal.querySelector('#difference-display')
        const diffAmountEl = modal.querySelector('#difference-amount')
        const diffReasonSection = modal.querySelector('#diff-reason-section')
        const adjustCardSelectContainer = modal.querySelector('#adjust-card-select-container')

        modal.querySelectorAll('input[name="adjust-reason"]').forEach(radio => {
            radio.addEventListener('change', e => {
                if (adjustCardSelectContainer) {
                    if (e.target.value === 'credit_pay') {
                        adjustCardSelectContainer.classList.remove('hidden')
                    } else {
                        adjustCardSelectContainer.classList.add('hidden')
                    }
                }
            })
        })

        const updateDifference = () => {
            const actual = parseFloat(actualBalanceInput.value) || 0
            const diff = actual - currentBalance
            if (diff === 0) {
                diffDisplay.classList.add('hidden')
                if (diffReasonSection) diffReasonSection.classList.add('hidden')
            } else {
                diffDisplay.classList.remove('hidden')
                diffAmountEl.textContent = formatCurrency(Math.abs(diff))
                if (diff > 0) {
                    diffAmountEl.className =
                        'text-lg font-bold mt-1 text-wabi-income'
                    diffAmountEl.textContent = '+ ' + diffAmountEl.textContent
                    if (diffReasonSection) diffReasonSection.classList.add('hidden')
                } else {
                    diffAmountEl.className =
                        'text-lg font-bold mt-1 text-wabi-expense'
                    diffAmountEl.textContent = '- ' + diffAmountEl.textContent
                    if (diffReasonSection && isNotCreditCard && creditCards.length > 0) {
                        diffReasonSection.classList.remove('hidden')
                    }
                }
            }
        }

        actualBalanceInput.addEventListener('input', updateDifference)
        modal
            .querySelector('#cancel-adjustment-btn')
            .addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        modal
            .querySelector('#save-adjustment-btn')
            .addEventListener('click', async () => {
                const actual = parseFloat(actualBalanceInput.value)
                if (isNaN(actual)) {
                    showToast('請輸入有效的金額', 'error')
                    return
                }

                const diff = actual - currentBalance
                if (diff === 0) {
                    showToast('餘額無變動')
                    closeModal()
                    return
                }

                const createRecord = modal.querySelector(
                    '#add-adjustment-record'
                ).checked

                if (createRecord) {
                    const reason = modal.querySelector('input[name="adjust-reason"]:checked')?.value || 'general'
                    if (diff < 0 && reason === 'credit_pay' && isNotCreditCard) {
                        const cardId = parseInt(modal.querySelector('#adjust-credit-card-select')?.value, 10)
                        const card = creditCards.find(c => c.id === cardId)
                        const newRecord = {
                            amount: Math.abs(diff),
                            type: 'expense',
                            category: 'transfer',
                            date: formatDateToString(new Date()),
                            description: card
                                ? `[卡費扣繳平帳] 扣除 ${card.name} 卡費 (信用卡已歸零)`
                                : '[卡費扣繳平帳] 扣除信用卡費 (信用卡已歸零)',
                            accountId: account.id,
                            ledgerId: account.ledgerId,
                            createdAt: Date.now(),
                        }
                        await this.app.dataService.addRecord(newRecord)
                        showToast(`已新增卡費扣繳平帳紀錄，扣除 ${formatCurrency(Math.abs(diff))}！`)
                    } else {
                        // 平帳紀錄：使用隱藏的「帳務差額」分類（不可手動選擇，不計入收支統計，但會影響帳戶餘額）
                        const type = diff > 0 ? 'income' : 'expense'
                        const newRecord = {
                            amount: Math.abs(diff),
                            type: type,
                            category: 'balance_adjustment',
                            date: formatDateToString(new Date()),
                            description: '平帳',
                            accountId: account.id,
                            ledgerId: account.ledgerId,
                            createdAt: Date.now(),
                        }
                        await this.app.dataService.addRecord(newRecord)
                        showToast('已新增平帳紀錄')
                    }
                } else {
                    account.balance += diff
                    await this.app.dataService.updateAccount(
                        account.id,
                        account
                    )
                    showToast('已更新帳戶初始餘額')
                }

                this.render()
                closeModal()
            })
    }

    async showAccountModal(accountToEdit = null) {
        const isEdit = !!accountToEdit
        const accountType = accountToEdit?.type || 'wallet'

        // 取得所有其他的一般帳戶 (用於自動扣款設定，排除信用卡，且排除目前編輯的這個帳戶)
        const allAccounts = await this.app.dataService.getAccounts()
        const debitAccounts = allAccounts.filter(
            a =>
                a.type !== 'credit_card' &&
                (!accountToEdit || a.id !== accountToEdit.id)
        )

        const modal = document.createElement('div')
        modal.id = 'account-form-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden'
        const defaultCreditIcon = 'fa-solid fa-credit-card'
        const defaultWalletIcon = 'fa-solid fa-wallet'
        const currentIcon = accountToEdit?.icon || defaultWalletIcon
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-4 sm:p-6 space-y-4 max-h-[90vh] flex flex-col overflow-hidden box-border">
                <h3 class="text-lg font-bold text-wabi-primary">${isEdit ? '編輯帳戶' : '新增帳戶'}</h3>
                
                <div class="flex-1 overflow-y-auto overflow-x-hidden pr-1 sm:pr-2 space-y-4">
                    <div>
                        <label class="text-sm font-medium text-wabi-text-secondary">帳戶類型</label>
                        <div class="flex gap-2 mt-1">
                            <label class="flex-1 cursor-pointer min-w-0">
                                <input type="radio" name="account-type" value="wallet" ${accountType === 'wallet' ? 'checked' : ''} class="sr-only peer">
                                <div class="p-2.5 sm:p-3 rounded-lg border-2 border-wabi-border bg-wabi-surface text-center peer-checked:border-wabi-primary peer-checked:bg-wabi-primary/10 peer-checked:text-wabi-primary transition-all">
                                    <i class="fa-solid fa-wallet text-base sm:text-lg mb-1"></i>
                                    <p class="text-xs sm:text-sm font-medium">一般帳戶</p>
                                </div>
                            </label>
                            <label class="flex-1 cursor-pointer min-w-0">
                                <input type="radio" name="account-type" value="credit_card" ${accountType === 'credit_card' ? 'checked' : ''} class="sr-only peer">
                                <div class="p-2.5 sm:p-3 rounded-lg border-2 border-wabi-border bg-wabi-surface text-center peer-checked:border-wabi-primary peer-checked:bg-wabi-primary/10 peer-checked:text-wabi-primary transition-all">
                                    <i class="fa-solid fa-credit-card text-base sm:text-lg mb-1"></i>
                                    <p class="text-xs sm:text-sm font-medium">信用卡</p>
                                </div>
                            </label>
                        </div>
                    </div>
                    <div>
                        <label class="text-sm font-medium text-wabi-text-secondary">帳戶名稱</label>
                        <input type="text" id="account-name-input" value="${escapeHTML(accountToEdit?.name || '')}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary" required>
                    </div>
                    <div>
                        <label class="text-sm font-medium text-wabi-text-secondary" id="account-balance-label">初始餘額</label>
                        <input type="number" id="account-balance-input" value="${accountToEdit?.balance || 0}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary" ${isEdit ? 'disabled' : ''}>
                    </div>

                    <div id="credit-card-fields" class="space-y-3 ${accountType === 'credit_card' ? '' : 'hidden'}">
                        <div>
                            <label class="text-sm font-medium text-wabi-text-secondary">信用額度</label>
                            <input type="number" id="credit-limit-input" value="${accountToEdit?.creditLimit || 0}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
                        </div>
                        <div class="grid grid-cols-2 gap-2 sm:gap-3">
                            <div class="min-w-0">
                                <label class="text-xs sm:text-sm font-medium text-wabi-text-secondary">出帳日</label>
                                <input type="number" id="statement-day-input" min="1" max="31" value="${accountToEdit?.statementDay || 25}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary text-sm">
                            </div>
                            <div class="min-w-0">
                                <label class="text-xs sm:text-sm font-medium text-wabi-text-secondary">繳款日</label>
                                <input type="number" id="due-day-input" min="1" max="31" value="${accountToEdit?.dueDay || 15}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary text-sm">
                            </div>
                        </div>
                        <!-- 自動繳款與扣款帳戶設定 -->
                        <div class="flex items-center justify-between border-t border-wabi-border/30 pt-3">
                            <label class="text-sm font-medium text-wabi-text-secondary">啟用自動扣繳卡費</label>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="auto-pay-toggle" ${accountToEdit?.autoPayEnabled ? 'checked' : ''} class="sr-only peer">
                                <div class="w-9 h-5 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-2 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-0.5 top-0.5 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="auto-pay-account-container" class="${accountToEdit?.autoPayEnabled ? '' : 'hidden'}">
                            <label class="text-sm font-medium text-wabi-text-secondary">自動扣款帳戶</label>
                            <select id="auto-pay-account-select" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary truncate">
                                <option value="">-- 選擇扣款帳戶 --</option>
                                ${debitAccounts
                                    .map(
                                        a => `
                                    <option value="${a.id}" ${accountToEdit?.autoPayAccountId === a.id ? 'selected' : ''}>${escapeHTML(a.name)}</option>
                                `
                                    )
                                    .join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-wabi-text-secondary mb-2">選擇圖示</label>
                        <div class="mb-3">
                            <div class="flex items-center space-x-2 mb-2">
                                <input type="text" id="custom-icon-input" 
                                       placeholder="設定預設 (如: fas fa-wallet)"
                                       value="${escapeHTML(currentIcon)}"
                                       class="flex-1 min-w-0 p-2 text-sm bg-transparent border border-wabi-border rounded-lg bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary">
                                <button type="button" id="preview-icon-btn" class="shrink-0 px-3 py-2 bg-wabi-bg border border-wabi-border rounded-lg hover:bg-wabi-border transition-colors">
                                  <span id="icon-preview" class="text-lg text-wabi-primary">
                                    <i class="${currentIcon}"></i>
                                  </span>
                                </button>
                            </div>
                            <input type="text" id="icon-search-input" 
                                   placeholder="搜尋內建圖示... (例: wallet)"
                                   class="w-full min-w-0 p-2 text-sm bg-transparent border border-wabi-border rounded-lg bg-wabi-surface focus:ring-2 focus:ring-wabi-accent focus:border-transparent text-wabi-text-primary mb-2">
                        </div>
                        <div class="grid grid-cols-6 gap-1.5 sm:gap-2 max-h-40 overflow-y-auto overflow-x-hidden border border-wabi-border rounded-lg p-2 sm:p-3 bg-wabi-surface" id="icon-selector">
                            <!-- 圖標將從 JavaScript 動態渲染 -->
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-wabi-text-secondary mb-2">選擇顏色</label>
                        <div class="grid grid-cols-6 gap-2 p-2 sm:gap-3 sm:p-3 border border-wabi-border rounded-lg bg-wabi-surface overflow-x-hidden" id="color-selector">
                          ${this.getAvailableColors()
                              .map(
                                  color => `
                            <button type="button" class="color-option w-7 h-7 sm:w-8 sm:h-8 mx-auto rounded-lg border-2 border-transparent hover:border-wabi-primary transition-colors ${color}" data-color="${color}">
                            </button>
                          `
                              )
                              .join('')}
                          <label for="custom-color-picker-input" id="custom-color-picker-label" class="w-7 h-7 sm:w-8 sm:h-8 mx-auto rounded-lg border-2 border-dashed border-wabi-border flex items-center justify-center cursor-pointer hover:border-wabi-primary">
                            <i class="fas fa-palette text-wabi-text-secondary text-sm"></i>
                            <input type="color" id="custom-color-picker-input" class="absolute w-0 h-0 opacity-0" value="#3B82F6">
                          </label>
                        </div>
                    </div>
                </div>

                <div class="flex gap-2 pt-4 border-t border-wabi-border mt-2">
                    <button id="save-account-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg hover:bg-wabi-accent/90 transition-colors">儲存</button>
                    <button id="cancel-account-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg hover:bg-wabi-bg transition-colors">取消</button>
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

        // 帳戶類型切換邏輯
        const creditCardFields = modal.querySelector('#credit-card-fields')
        const balanceLabel = modal.querySelector('#account-balance-label')
        const typeRadios = modal.querySelectorAll('input[name="account-type"]')

        let selectedIcon = currentIcon
        let selectedColor = accountToEdit?.color || 'bg-blue-500'

        // 自訂圖標輸入
        const customIconInput = document.getElementById('custom-icon-input')
        const previewIconBtn = document.getElementById('preview-icon-btn')
        const iconPreview = document.getElementById('icon-preview')

        // 圖標預覽功能
        const updateIconPreview = () => {
            const iconClass =
                customIconInput.value.trim() || 'fa-solid fa-wallet'
            iconPreview.innerHTML = `<i class="${iconClass}"></i>`
            selectedIcon = iconClass
            document.querySelectorAll('.icon-option').forEach(b => {
                b.classList.remove('border-wabi-primary', 'bg-wabi-primary/10')
                b.classList.add('border-wabi-border')
            })
        }

        customIconInput.addEventListener('input', updateIconPreview)
        customIconInput.addEventListener('keyup', updateIconPreview)
        previewIconBtn.addEventListener('click', updateIconPreview)

        const updateAccountTypeUI = () => {
            const selectedType = modal.querySelector(
                'input[name="account-type"]:checked'
            ).value
            if (selectedType === 'credit_card') {
                creditCardFields.classList.remove('hidden')
                balanceLabel.textContent = '初始欠款'
            } else {
                creditCardFields.classList.add('hidden')
                balanceLabel.textContent = '初始餘額'
            }
        }

        const autoPayToggle = modal.querySelector('#auto-pay-toggle')
        const autoPayAccountContainer = modal.querySelector(
            '#auto-pay-account-container'
        )
        if (autoPayToggle && autoPayAccountContainer) {
            autoPayToggle.addEventListener('change', () => {
                if (autoPayToggle.checked) {
                    autoPayAccountContainer.classList.remove('hidden')
                } else {
                    autoPayAccountContainer.classList.add('hidden')
                }
            })
        }

        typeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const selectedType = radio.value
                // 切換類型時更新預設圖示
                if (selectedType === 'credit_card') {
                    customIconInput.value = 'fa-solid fa-credit-card'
                    selectedIcon = 'fa-solid fa-credit-card'
                } else {
                    customIconInput.value = 'fa-solid fa-wallet'
                    selectedIcon = 'fa-solid fa-wallet'
                }
                updateIconPreview()
                updateAccountTypeUI()
            })
        })

        // 圖示渲染邏輯
        const iconSelector = document.getElementById('icon-selector')

        const bindIconSelection = () => {
            document.querySelectorAll('.icon-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.icon-option').forEach(b => {
                        b.classList.remove(
                            'border-wabi-primary',
                            'bg-wabi-primary/10'
                        )
                        b.classList.add('border-wabi-border')
                    })
                    btn.classList.remove('border-wabi-border')
                    btn.classList.add(
                        'border-wabi-primary',
                        'bg-wabi-primary/10'
                    )
                    selectedIcon = btn.dataset.icon
                    customIconInput.value = selectedIcon
                    updateIconPreview()
                })
            })
        }

        const renderIcons = icons => {
            iconSelector.innerHTML = icons
                .map(
                    icon => `
            <button type="button" class="icon-option p-2 border border-wabi-border rounded-lg hover:border-wabi-primary hover:bg-wabi-primary/10 transition-colors text-lg text-wabi-text-secondary flex justify-center items-center" data-icon="${icon}" title="${icon}">
              <i class="${icon}"></i>
            </button>
          `
                )
                .join('')

            if (selectedIcon) {
                const btn = iconSelector.querySelector(
                    `[data-icon="${selectedIcon}"]`
                )
                if (btn) {
                    btn.classList.remove('border-wabi-border')
                    btn.classList.add(
                        'border-wabi-primary',
                        'bg-wabi-primary/10'
                    )
                }
            }
            bindIconSelection()
        }

        renderIcons(this.getAvailableIcons())

        // 搜尋功能
        const iconSearchInput = document.getElementById('icon-search-input')
        iconSearchInput.addEventListener('input', e => {
            const query = e.target.value.trim().toLowerCase()
            if (!query) {
                renderIcons(this.getAvailableIcons())
                return
            }
            const filteredIcons = FONT_AWESOME_ICONS.filter(icon =>
                icon.toLowerCase().includes(query)
            ).slice(0, 100)
            if (filteredIcons.length === 0) {
                iconSelector.innerHTML =
                    '<div class="col-span-6 text-center text-sm text-gray-500 py-4">找不到相關圖示</div>'
            } else {
                renderIcons(filteredIcons)
            }
        })

        // 顏色選擇
        const colorOptions = document.querySelectorAll('.color-option')
        const customColorPickerInput = document.getElementById(
            'custom-color-picker-input'
        )
        const customColorPickerLabel = document.getElementById(
            'custom-color-picker-label'
        )

        const clearColorSelection = () => {
            colorOptions.forEach(b => {
                b.classList.remove(
                    'border-wabi-primary',
                    'ring-2',
                    'ring-wabi-accent'
                )
                b.classList.add('border-transparent')
            })
            customColorPickerLabel.classList.remove(
                'border-wabi-primary',
                'ring-2',
                'ring-wabi-accent',
                'border-solid'
            )
            customColorPickerLabel.classList.add(
                'border-dashed',
                'border-wabi-border'
            )
            customColorPickerLabel.style.backgroundColor = 'transparent'
        }

        colorOptions.forEach(btn => {
            btn.addEventListener('click', () => {
                clearColorSelection()
                btn.classList.add(
                    'border-wabi-primary',
                    'ring-2',
                    'ring-wabi-accent'
                )
                selectedColor = btn.dataset.color
            })
        })

        customColorPickerInput.addEventListener('input', e => {
            clearColorSelection()
            customColorPickerLabel.classList.add(
                'border-wabi-primary',
                'ring-2',
                'ring-wabi-accent',
                'border-solid'
            )
            customColorPickerLabel.classList.remove(
                'border-dashed',
                'border-wabi-border'
            )
            customColorPickerLabel.style.backgroundColor = e.target.value
            selectedColor = e.target.value
        })

        // 初始狀態
        if (selectedColor) {
            if (selectedColor.startsWith('#')) {
                customColorPickerInput.value = selectedColor
                customColorPickerLabel.classList.add(
                    'border-wabi-primary',
                    'ring-2',
                    'ring-wabi-accent',
                    'border-solid'
                )
                customColorPickerLabel.classList.remove(
                    'border-dashed',
                    'border-wabi-border'
                )
                customColorPickerLabel.style.backgroundColor = selectedColor
            } else {
                const selectedBtn = document.querySelector(
                    `.color-option[data-color="${selectedColor}"]`
                )
                if (selectedBtn) {
                    selectedBtn.classList.add(
                        'border-wabi-primary',
                        'ring-2',
                        'ring-wabi-accent'
                    )
                }
            }
        }

        modal
            .querySelector('#save-account-btn')
            .addEventListener('click', async () => {
                const name = document.getElementById('account-name-input').value
                if (!name) {
                    showToast('請輸入帳戶名稱', 'error')
                    return
                }

                const selectedType = modal.querySelector(
                    'input[name="account-type"]:checked'
                ).value

                const accountData = {
                    type: selectedType,
                    name: name,
                    balance:
                        parseFloat(
                            document.getElementById('account-balance-input')
                                .value
                        ) || 0,
                    icon: selectedIcon,
                    color: selectedColor,
                }

                // 信用卡額外欄位
                if (selectedType === 'credit_card') {
                    accountData.creditLimit =
                        parseFloat(
                            document.getElementById('credit-limit-input').value
                        ) || 0
                    accountData.statementDay =
                        parseInt(
                            document.getElementById('statement-day-input')
                                .value,
                            10
                        ) || 25
                    accountData.dueDay =
                        parseInt(
                            document.getElementById('due-day-input').value,
                            10
                        ) || 15

                    const autoPayEnabled =
                        document.getElementById('auto-pay-toggle').checked
                    accountData.autoPayEnabled = autoPayEnabled
                    if (autoPayEnabled) {
                        const autoPayAccountId = parseInt(
                            document.getElementById('auto-pay-account-select')
                                .value,
                            10
                        )
                        accountData.autoPayAccountId = autoPayAccountId || null
                    } else {
                        accountData.autoPayAccountId = null
                    }
                }

                if (isEdit) {
                    await this.app.dataService.updateAccount(accountToEdit.id, {
                        ...accountToEdit,
                        ...accountData,
                    })
                    showToast('帳戶已更新')
                } else {
                    await this.app.dataService.addAccount(accountData)
                    showToast('帳戶已新增')
                }
                this.render() // Re-render the page
                closeModal()
            })
    }

    async showCreditDetailModal(account) {
        const billingInfo =
            await this.app.dataService.getCreditCardBillingInfo(account.id)
        if (!billingInfo) return

        const existingModal = document.getElementById('credit-detail-modal')
        if (existingModal) existingModal.remove()

        const modal = document.createElement('div')
        modal.id = 'credit-detail-modal'
        modal.className =
            'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden'

        const isHex = account.color && account.color.startsWith('#')
        const colorClass = isHex ? '' : (account.color || 'bg-gray-500')
        const colorStyle = isHex
            ? `style="background-color: ${escapeHTML(account.color)}"`
            : ''

        const {
            statementDay,
            dueDay,
            creditLimit,
            availableCredit,
            totalDebt,
            unbilledPeriod,
            daysUntilStatement,
            unbilledRecords,
            unbilledTotal,
            statements,
            billedDueTotal,
            nextDueDate,
        } = billingInfo

        let nextDueDateText = '無待繳帳單'
        let nextDueDateFull = ''
        if (nextDueDate) {
            const dueDateObj = new Date(nextDueDate)
            nextDueDateFull = `${formatDateToString(dueDateObj)} 繳款截止`
            const isDiffYear = dueDateObj.getFullYear() !== new Date().getFullYear()
            const dueDateShort = isDiffYear
                ? `${dueDateObj.getFullYear()}/${dueDateObj.getMonth() + 1}/${dueDateObj.getDate()}`
                : `${dueDateObj.getMonth() + 1}/${dueDateObj.getDate()}`
            nextDueDateText = `${dueDateShort} 截止`
        }
        const isOverdue =
            nextDueDate && Date.now() > nextDueDate && billedDueTotal > 0

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-2xl max-w-lg w-full p-4 sm:p-6 space-y-4 max-h-[90vh] flex flex-col shadow-2xl overflow-hidden box-border">
                <!-- Header -->
                <div class="flex items-center justify-between border-b border-wabi-border/60 pb-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="size-10 sm:size-11 rounded-xl flex items-center justify-center text-wabi-surface shrink-0 ${colorClass}" ${colorStyle}>
                            <i class="${account.icon} text-lg sm:text-xl"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-base sm:text-lg text-wabi-text-primary truncate">${escapeHTML(account.name)}</h3>
                            <p class="text-[11px] sm:text-xs text-wabi-text-secondary truncate">
                                出帳日: 每月 ${statementDay} 日 · 繳款日: 每月 ${dueDay} 日
                            </p>
                        </div>
                    </div>
                    <button id="close-credit-detail-btn" class="text-wabi-text-secondary hover:text-wabi-primary p-2 shrink-0 rounded-lg hover:bg-wabi-surface transition-colors">
                        <i class="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <!-- 頂部摘要雙卡 -->
                <div class="grid grid-cols-2 gap-2.5 sm:gap-3 shrink-0">
                    <!-- 準備繳納 (已出帳待繳) -->
                    <div class="bg-wabi-surface border ${billedDueTotal > 0 ? 'border-wabi-expense/30 bg-wabi-expense/5' : 'border-wabi-border'} rounded-xl p-3 flex flex-col justify-between min-w-0">
                        <div>
                            <div class="flex items-center justify-between gap-1 mb-1 min-w-0">
                                <span class="text-xs font-semibold ${billedDueTotal > 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'} truncate">
                                    <i class="fa-solid fa-clock mr-1 text-[10px]"></i>準備繳納
                                </span>
                                ${billedDueTotal > 0 ? `<span class="text-[10px] ${isOverdue ? 'bg-red-600 text-white' : 'bg-wabi-expense text-wabi-surface'} px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">${isOverdue ? '已逾期' : '待繳'}</span>` : '<span class="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">已結清</span>'}
                            </div>
                            <p class="text-lg sm:text-2xl font-bold ${billedDueTotal > 0 ? 'text-wabi-expense' : 'text-wabi-text-primary'} truncate">
                                ${formatCurrency(billedDueTotal)}
                            </p>
                        </div>
                        <div class="mt-2 pt-2 border-t border-wabi-border/30 text-[11px] sm:text-xs text-wabi-text-secondary flex items-center justify-between gap-1 min-w-0">
                            <span class="truncate min-w-0 ${isOverdue ? 'text-red-600 font-bold' : ''}" title="${nextDueDateFull || nextDueDateText}">${nextDueDateText}</span>
                            ${billedDueTotal > 0 ? `<button id="detail-pay-btn" class="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-bold hover:underline shrink-0 whitespace-nowrap ml-1">立即繳納</button>` : `<button id="detail-pay-btn" class="text-[11px] sm:text-xs text-wabi-primary font-bold hover:underline shrink-0 whitespace-nowrap ml-1" title="自扣款帳戶扣除卡費以達平帳">扣款平帳</button>`}
                        </div>
                    </div>

                    <!-- 即時消費 (未出帳) -->
                    <div class="bg-wabi-surface border border-wabi-border rounded-xl p-3 flex flex-col justify-between min-w-0">
                        <div>
                            <div class="flex items-center justify-between gap-1 mb-1 min-w-0">
                                <span class="text-xs font-semibold text-blue-600 dark:text-blue-400 truncate">
                                    <i class="fa-solid fa-bolt mr-1 text-[10px]"></i>即時消費
                                </span>
                                <span class="text-[10px] bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0">未出帳</span>
                            </div>
                            <p class="text-lg sm:text-2xl font-bold text-wabi-text-primary truncate">
                                ${formatCurrency(unbilledTotal)}
                            </p>
                        </div>
                        <div class="mt-2 pt-2 border-t border-wabi-border/30 text-[11px] sm:text-xs text-wabi-text-secondary">
                            <span class="truncate block" title="距結帳約 ${daysUntilStatement} 天 (每月 ${statementDay} 日)">距結帳約 ${daysUntilStatement} 天 (每月 ${statementDay} 日)</span>
                        </div>
                    </div>
                </div>

                <!-- 額度資訊條 -->
                <div class="bg-wabi-surface/60 border border-wabi-border/50 rounded-lg p-2.5 px-3 flex items-center justify-between text-xs text-wabi-text-secondary shrink-0">
                    <span>總欠款: <strong class="text-wabi-text-primary">${formatCurrency(totalDebt)}</strong></span>
                    ${creditLimit > 0 ? `<span>可用額度: <strong class="text-green-600 dark:text-green-400">${formatCurrency(availableCredit)}</strong> / 額度 ${formatCurrency(creditLimit)}</span>` : ''}
                </div>

                <!-- 頁籤 Tabs -->
                <div class="flex border-b border-wabi-border gap-2 shrink-0">
                    <button id="tab-unbilled-btn" class="py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-wabi-primary text-wabi-primary transition-colors">
                        即時消費明細 (${unbilledRecords.length})
                    </button>
                    <button id="tab-billed-btn" class="py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-transparent text-wabi-text-secondary hover:text-wabi-primary transition-colors">
                        出帳帳單 (${statements.length})
                    </button>
                </div>

                <!-- Tab 內容容器 -->
                <div id="credit-tab-content" class="flex-1 overflow-y-auto overflow-x-hidden space-y-3 min-h-[200px] pr-1">
                    <!-- 動態渲染 -->
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const closeModal = () => modal.remove()
        modal
            .querySelector('#close-credit-detail-btn')
            .addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        const payBtn = modal.querySelector('#detail-pay-btn')
        if (payBtn) {
            payBtn.addEventListener('click', () => {
                if (billedDueTotal > 0) {
                    this.showCreditPayModal(account, billedDueTotal)
                } else {
                    this.showCreditPayModal(account, null, { deductOnly: true })
                }
            })
        }

        // Tab 切換與內容渲染
        const tabUnbilledBtn = modal.querySelector('#tab-unbilled-btn')
        const tabBilledBtn = modal.querySelector('#tab-billed-btn')
        const contentContainer = modal.querySelector('#credit-tab-content')

        let currentTab = 'unbilled'

        const renderTabContent = () => {
            if (currentTab === 'unbilled') {
                tabUnbilledBtn.className =
                    'py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-wabi-primary text-wabi-primary transition-colors'
                tabBilledBtn.className =
                    'py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-transparent text-wabi-text-secondary hover:text-wabi-primary transition-colors'

                if (unbilledRecords.length === 0) {
                    contentContainer.innerHTML = `
                        <div class="text-center py-12 text-wabi-text-secondary">
                            <i class="fa-solid fa-receipt text-3xl mb-2 opacity-40 block"></i>
                            <p class="text-sm font-medium">本期尚無未出帳的即時消費</p>
                            <p class="text-xs text-wabi-text-secondary/70 mt-1">週期：${unbilledPeriod.startStr} ~ ${unbilledPeriod.endStr}</p>
                        </div>
                    `
                    return
                }

                contentContainer.innerHTML = `
                    <div class="text-xs text-wabi-text-secondary bg-wabi-surface/50 border border-wabi-border/40 rounded-lg p-2 flex items-center justify-between">
                        <span><i class="fa-regular fa-calendar mr-1"></i>本期未出帳週期：${unbilledPeriod.startStr} ~ ${unbilledPeriod.endStr}</span>
                        <span class="font-semibold text-wabi-text-primary">共 ${unbilledRecords.length} 筆</span>
                    </div>
                    <div class="space-y-1.5" id="unbilled-records-list">
                        ${unbilledRecords
                            .map(r => {
                                const isExp = r.type === 'expense'
                                const catName = getCategoryName(
                                    r.type,
                                    r.category
                                )
                                const catIcon = getCategoryIcon(
                                    r.type,
                                    r.category
                                )
                                return `
                                <div class="flex items-center justify-between p-2.5 bg-wabi-surface rounded-xl border border-wabi-border/60 hover:border-wabi-border transition-colors">
                                    <div class="flex items-center gap-3 min-w-0">
                                        <div class="size-8 rounded-lg flex items-center justify-center shrink-0 ${isExp ? 'bg-wabi-expense/10 text-wabi-expense' : 'bg-green-500/10 text-green-600'}">
                                            <i class="${catIcon} text-sm"></i>
                                        </div>
                                        <div class="min-w-0">
                                            <div class="flex items-center gap-1.5">
                                                <span class="text-xs font-bold text-wabi-text-primary truncate">${escapeHTML(r.description || catName)}</span>
                                                <span class="text-[10px] bg-wabi-bg text-wabi-text-secondary px-1.5 py-0.2 rounded border border-wabi-border/40 shrink-0">${escapeHTML(catName)}</span>
                                            </div>
                                            <p class="text-[11px] text-wabi-text-secondary">${r.date}</p>
                                        </div>
                                    </div>
                                    <div class="text-right shrink-0 ml-2">
                                        <span class="font-bold text-sm ${isExp ? 'text-wabi-expense' : 'text-green-600'}">
                                            ${isExp ? '-' : '+'}${formatCurrency(r.amount)}
                                        </span>
                                    </div>
                                </div>
                            `
                            })
                            .join('')}
                    </div>
                `
            } else {
                // 出帳帳單
                tabUnbilledBtn.className =
                    'py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-transparent text-wabi-text-secondary hover:text-wabi-primary transition-colors'
                tabBilledBtn.className =
                    'py-2 px-3 sm:px-4 font-bold text-xs sm:text-sm border-b-2 border-wabi-primary text-wabi-primary transition-colors'

                if (statements.length === 0) {
                    contentContainer.innerHTML = `
                        <div class="text-center py-12 text-wabi-text-secondary">
                            <i class="fa-solid fa-file-invoice text-3xl mb-2 opacity-40 block"></i>
                            <p class="text-sm font-medium">尚無任何出帳帳單</p>
                            <p class="text-xs text-wabi-text-secondary/70 mt-1">到達結帳日後系統將自動生成帳單</p>
                        </div>
                    `
                    return
                }

                contentContainer.innerHTML = `
                    <div class="space-y-3" id="statements-list">
                        ${statements
                            .map(stmt => {
                                const isPaid = stmt.status === 'paid'
                                const isZero =
                                    stmt.status === 'zero' || stmt.amount === 0
                                const stmtPeriodInfo =
                                    this.app.dataService.getStatementPeriod(
                                        account,
                                        stmt.period
                                    )
                                const toDateStr = d =>
                                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                                const periodRange = `${toDateStr(stmtPeriodInfo.startDate)} ~ ${toDateStr(stmtPeriodInfo.endDate)}`
                                const stmtDueDateStr = stmt.dueDate
                                    ? formatDateToString(
                                          new Date(stmt.dueDate)
                                      )
                                    : ''
                                const today0 = new Date().setHours(0, 0, 0, 0)
                                const stmtDue0 = stmt.dueDate
                                    ? new Date(stmt.dueDate).setHours(0, 0, 0, 0)
                                    : null
                                const stmtOverdue =
                                    !isPaid &&
                                    !isZero &&
                                    stmtDue0 !== null &&
                                    today0 >= stmtDue0

                                return `
                                <div class="bg-wabi-surface border border-wabi-border rounded-xl p-3.5 space-y-2.5 transition-all" data-period="${stmt.period}">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-2">
                                            <span class="font-bold text-sm sm:text-base text-wabi-text-primary">${stmt.period} 期帳單</span>
                                            ${isPaid ? '<span class="text-[10px] bg-green-500/10 text-green-600 font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">已繳清</span>' : isZero ? '<span class="text-[10px] bg-gray-400/10 text-gray-500 font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">無欠款</span>' : `<span class="text-[10px] ${stmtOverdue ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30' : 'bg-wabi-expense text-wabi-surface'} font-bold px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">${stmtOverdue ? '已到期待扣繳' : '待繳納'}</span>`}
                                        </div>
                                        <div class="text-right">
                                            <span class="text-base sm:text-lg font-bold ${isPaid || isZero ? 'text-wabi-text-primary' : 'text-wabi-expense'}">
                                                ${formatCurrency(stmt.amount)}
                                            </span>
                                        </div>
                                    </div>

                                    <div class="text-xs text-wabi-text-secondary flex items-center justify-between border-t border-wabi-border/40 pt-2 flex-wrap gap-1">
                                        <span>計費區間: ${periodRange}</span>
                                        ${stmtDueDateStr ? `<span>繳款日: ${stmtDueDateStr}</span>` : ''}
                                    </div>

                                    <div class="flex items-center justify-between pt-1">
                                        <button class="toggle-stmt-records-btn text-xs text-wabi-primary hover:text-wabi-accent font-medium flex items-center gap-1" data-period="${stmt.period}">
                                            <span>查看該期消費明細</span>
                                            <i class="fa-solid fa-chevron-down text-[10px] transition-transform"></i>
                                        </button>
                                        ${!isPaid && !isZero ? `
                                            <button class="pay-single-stmt-btn text-xs ${stmtOverdue ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-wabi-accent text-wabi-primary hover:bg-wabi-accent/90'} font-bold px-2.5 py-1 rounded-lg transition-colors" data-period="${stmt.period}" data-amount="${stmt.amount}" data-stmt-id="${stmt.id}">${stmtOverdue ? '扣繳平帳' : '繳款'}</button>
                                        ` : isPaid && stmt.amount > 0 ? `
                                            <button class="reconcile-stmt-btn text-[11px] text-wabi-text-secondary hover:text-wabi-primary border border-wabi-border hover:border-wabi-primary/50 font-medium px-2 py-0.5 rounded-lg transition-colors" data-period="${stmt.period}" data-amount="${stmt.amount}" data-stmt-id="${stmt.id}" title="若扣款帳戶尚未扣除此期卡費，可點此補扣平帳">
                                                <i class="fa-solid fa-scale-balanced mr-1"></i>扣款平帳
                                            </button>
                                        ` : ''}
                                    </div>

                                    <!-- 折疊明細容器 -->
                                    <div class="stmt-records-container hidden border-t border-wabi-border/30 pt-2 mt-2 space-y-1.5" data-period="${stmt.period}">
                                        <div class="text-center py-2 text-xs text-wabi-text-secondary"><i class="fa-solid fa-spinner fa-spin mr-1"></i>載入明細中...</div>
                                    </div>
                                </div>
                            `
                            })
                            .join('')}
                    </div>
                `

                // 綁定帳單明細折疊與繳款按鈕
                contentContainer
                    .querySelectorAll('.toggle-stmt-records-btn')
                    .forEach(btn => {
                        btn.addEventListener('click', async e => {
                            const period = e.currentTarget.dataset.period
                            const card = contentContainer.querySelector(
                                `[data-period="${period}"]`
                            )
                            const detailBox = card.querySelector(
                                `.stmt-records-container[data-period="${period}"]`
                            )
                            const icon = e.currentTarget.querySelector('i')

                            if (detailBox.classList.contains('hidden')) {
                                detailBox.classList.remove('hidden')
                                icon.classList.add('rotate-180')

                                // 撈取資料
                                const records =
                                    await this.app.dataService.getStatementRecords(
                                        account,
                                        period
                                    )
                                if (records.length === 0) {
                                    detailBox.innerHTML =
                                        '<p class="text-center py-3 text-xs text-wabi-text-secondary">該期無相關消費記錄</p>'
                                } else {
                                    detailBox.innerHTML = records
                                        .map(r => {
                                            const isExp = r.type === 'expense'
                                            const catName = getCategoryName(
                                                r.type,
                                                r.category
                                            )
                                            const catIcon = getCategoryIcon(
                                                r.type,
                                                r.category
                                            )
                                            return `
                                        <div class="flex items-center justify-between p-2 bg-wabi-bg/60 rounded-lg text-xs">
                                            <div class="flex items-center gap-2 min-w-0">
                                                <i class="${catIcon} ${isExp ? 'text-wabi-expense' : 'text-green-600'} text-xs"></i>
                                                <span class="font-medium text-wabi-text-primary truncate">${escapeHTML(r.description || catName)}</span>
                                                <span class="text-[10px] text-wabi-text-secondary">${r.date}</span>
                                            </div>
                                            <span class="font-semibold ${isExp ? 'text-wabi-expense' : 'text-green-600'} ml-2 shrink-0">
                                                ${isExp ? '-' : '+'}${formatCurrency(r.amount)}
                                            </span>
                                        </div>
                                    `
                                        })
                                        .join('')
                                }
                            } else {
                                detailBox.classList.add('hidden')
                                icon.classList.remove('rotate-180')
                            }
                        })
                    })

                contentContainer
                    .querySelectorAll('.pay-single-stmt-btn')
                    .forEach(btn => {
                        btn.addEventListener('click', async e => {
                            const amount = parseFloat(
                                e.currentTarget.dataset.amount
                            )
                            const stmtId = parseInt(
                                e.currentTarget.dataset.stmtId,
                                10
                            )
                            const period = e.currentTarget.dataset.period

                            if (
                                account.autoPayAccountId &&
                                !Number.isNaN(stmtId)
                            ) {
                                const debitAcc =
                                    await this.app.dataService.getAccount(
                                        account.autoPayAccountId
                                    )
                                if (debitAcc) {
                                    const confirmed = await customConfirm(
                                        totalDebt <= 0
                                            ? `此信用卡欠款已為 0，是否確認立即由指定帳戶「${escapeHTML(debitAcc.name)}」扣繳卡費 ${formatCurrency(amount)} 進行平帳？\n（將僅扣除扣款帳戶餘額以達平帳，不重複增加信用卡餘額，且不計入生活支出）`
                                            : `是否確認立即由指定帳戶「${escapeHTML(debitAcc.name)}」扣繳卡費 ${formatCurrency(amount)} 進行平帳？\n（此紀錄不計入生活支出，但會調整帳戶餘額以達平帳）`
                                    )
                                    if (confirmed) {
                                        try {
                                            await this.app.dataService.payCreditStatement(
                                                stmtId,
                                                debitAcc.id,
                                                amount,
                                                null,
                                                { deductOnly: totalDebt <= 0 }
                                            )
                                            showToast(
                                                '卡費扣繳成功，已完成平帳！'
                                            )
                                            this.render()
                                            this.showCreditDetailModal(account)
                                            return
                                        } catch (err) {
                                            console.error('扣繳失敗:', err)
                                            showToast(
                                                '扣繳失敗，請稍後重試',
                                                'error'
                                            )
                                        }
                                    }
                                }
                            }

                            this.showCreditPayModal(account, amount, {
                                statementId: stmtId,
                                period,
                                deductOnly: totalDebt <= 0,
                            })
                        })
                    })

                contentContainer
                    .querySelectorAll('.reconcile-stmt-btn')
                    .forEach(btn => {
                        btn.addEventListener('click', e => {
                            const amount = parseFloat(
                                e.currentTarget.dataset.amount
                            )
                            const stmtId = parseInt(
                                e.currentTarget.dataset.stmtId,
                                10
                            )
                            const period = e.currentTarget.dataset.period
                            this.showCreditPayModal(account, amount, {
                                statementId: stmtId,
                                period,
                                deductOnly: true,
                            })
                        })
                    })
            }
        }

        tabUnbilledBtn.addEventListener('click', () => {
            currentTab = 'unbilled'
            renderTabContent()
        })
        tabBilledBtn.addEventListener('click', () => {
            currentTab = 'billed'
            renderTabContent()
        })

        // 預設渲染即時未出帳
        renderTabContent()
    }

    async showCreditPayModal(account, prefilledAmount = null, options = {}) {
        const statementId = options?.statementId || null
        const period = options?.period || null

        // 取得扣款賬戶 (排除信用卡和當前賬戶)
        const allAccounts = await this.app.dataService.getAccounts()
        const debitAccounts = allAccounts.filter(
            a => a.type !== 'credit_card' && a.id !== account.id
        )

        if (debitAccounts.length === 0) {
            showToast('你需要至少一個非信用卡賬戶才能扣繳/繳款', 'warning')
            return
        }

        // 計算該信用卡目前欠款
        const allRecords = await this.app.dataService.getRecords()
        const recordsForCard = allRecords.filter(
            r => r.accountId === account.id
        )
        const currentCardBal = recordsForCard.reduce(
            (bal, r) => bal + (r.type === 'income' ? r.amount : -r.amount),
            account.balance || 0
        )
        const cardDebt = Math.max(0, -currentCardBal)

        // 獲取該信用卡所有帳單以取得未繳帳單及最近一期資訊
        const allStatements = await this.app.dataService.getCreditStatements({
            accountId: account.id,
            allLedgers: true,
        })
        const unpaidStatements = allStatements.filter(s => s.status === 'unpaid')
        const unpaidTotal = unpaidStatements.reduce(
            (sum, s) => sum + (s.amount || 0),
            0
        )
        const recentStatement = allStatements
            .filter(s => (s.amount || 0) > 0)
            .sort((a, b) => b.period.localeCompare(a.period))[0]

        let amountToPay = 0
        if (prefilledAmount !== null) {
            amountToPay = prefilledAmount
        } else if (unpaidTotal > 0) {
            amountToPay = unpaidTotal
        } else if (recentStatement) {
            amountToPay = recentStatement.amount
        }

        const isDeductOnlyDefault =
            options?.deductOnly === true || cardDebt <= 0

        const modal = document.createElement('div')
        modal.id = 'credit-pay-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden'

        // 預設選中卡片設定的自動扣款帳戶 (若有)，否則選第一個
        const selectedDebitId =
            account.autoPayAccountId &&
            debitAccounts.some(a => a.id === account.autoPayAccountId)
                ? account.autoPayAccountId
                : debitAccounts[0]?.id

        const accountOptions = debitAccounts
            .map(
                a =>
                    `<option value="${a.id}" ${a.id === selectedDebitId ? 'selected' : ''}>${escapeHTML(a.name)}</option>`
            )
            .join('')

        const titleText = period
            ? `扣繳信用卡費 (${period} 期)`
            : cardDebt <= 0
              ? '信用卡扣款平帳'
              : '繳納信用卡費 / 扣繳平帳'

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-4 sm:p-6 space-y-4 overflow-hidden box-border">
                <h3 class="text-lg font-bold text-wabi-primary">${titleText}</h3>
                <p class="text-sm text-wabi-text-secondary">${escapeHTML(account.name)} — 未繳賬單合計: <span class="font-semibold text-wabi-expense">${formatCurrency(unpaidTotal)}</span> (總欠款: ${formatCurrency(cardDebt)})</p>
                ${cardDebt <= 0 ? `
                <div class="text-xs text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-lg flex items-start gap-2">
                    <i class="fa-solid fa-circle-info text-sm mt-0.5 shrink-0 text-blue-500"></i>
                    <div class="space-y-1">
                        <p class="font-bold">信用卡目前欠款已為 ${formatCurrency(0)}</p>
                        <p class="text-[11px] opacity-90 leading-relaxed">
                            若銀行帳戶在現實中已被扣款，請勾選下方<strong>「僅扣款帳戶平帳」</strong>：系統將只自扣款帳戶扣除此筆卡費，<strong>不會重複增加信用卡餘額</strong>，且<strong>不計入日常生活支出</strong>。
                        </p>
                    </div>
                </div>
                ` : `
                <div class="text-xs text-wabi-text-secondary bg-wabi-surface/80 p-2.5 rounded-lg border border-wabi-border/40">
                    <i class="fa-solid fa-circle-info text-wabi-accent mr-1"></i>此扣繳將調整帳戶餘額以達平帳，<strong>不計入日常生活支出</strong>。
                </div>
                `}
                <div>
                    <label class="text-sm text-wabi-text-secondary">扣款賬戶</label>
                    <select id="credit-pay-account" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface truncate text-wabi-text-primary">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">扣繳金額</label>
                    <input type="number" id="credit-pay-amount" placeholder="0.00" min="0" step="0.01" value="${amountToPay > 0 ? amountToPay : ''}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface text-wabi-text-primary">
                    ${recentStatement ? `
                    <div class="flex items-center justify-between text-[11px] text-wabi-text-secondary mt-1 px-0.5">
                        <span>最近一期 (${recentStatement.period} 期): ${formatCurrency(recentStatement.amount)}</span>
                        <button type="button" id="use-recent-stmt-amount-btn" class="text-wabi-accent font-bold hover:underline" data-amount="${recentStatement.amount}">帶入金額</button>
                    </div>
                    ` : ''}
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-wabi-surface border border-wabi-border/60">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="credit-pay-deduct-only" class="h-4 w-4 rounded text-wabi-primary focus:ring-wabi-primary" ${isDeductOnlyDefault ? 'checked' : ''}>
                        <label for="credit-pay-deduct-only" class="text-xs font-semibold text-wabi-text-primary cursor-pointer">
                            僅扣款帳戶平帳
                        </label>
                    </div>
                    <span class="text-[10px] text-wabi-text-secondary">不增加信用卡餘額</span>
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="confirm-credit-pay-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg hover:bg-wabi-accent/90 transition-colors">確認扣繳平帳</button>
                    <button id="cancel-credit-pay-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg hover:bg-wabi-bg transition-colors">取消</button>
                </div>
            </div>
        `
        document.body.appendChild(modal)

        const closeModal = () => modal.remove()

        const useRecentBtn = modal.querySelector('#use-recent-stmt-amount-btn')
        if (useRecentBtn) {
            useRecentBtn.addEventListener('click', () => {
                const amt = useRecentBtn.dataset.amount
                if (amt) {
                    modal.querySelector('#credit-pay-amount').value = amt
                }
            })
        }

        modal
            .querySelector('#cancel-credit-pay-btn')
            .addEventListener('click', closeModal)
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal()
        })

        modal
            .querySelector('#confirm-credit-pay-btn')
            .addEventListener('click', async () => {
                const debitId = parseInt(
                    modal.querySelector('#credit-pay-account').value,
                    10
                )
                const amount = parseFloat(
                    modal.querySelector('#credit-pay-amount').value
                )

                if (!amount || amount <= 0) {
                    showToast('請輸入有效的金額', 'error')
                    return
                }

                const debitAccount = debitAccounts.find(a => a.id === debitId)
                if (!debitAccount) {
                    showToast('無法找到扣款賬戶', 'error')
                    return
                }

                const isDeductOnly =
                    modal.querySelector('#credit-pay-deduct-only')?.checked ||
                    false

                try {
                    if (statementId) {
                        await this.app.dataService.payCreditStatement(
                            statementId,
                            debitId,
                            amount,
                            null,
                            { deductOnly: isDeductOnly }
                        )
                    } else {
                        const dateStr = formatDateToString(new Date())
                        const descSuffix = period
                            ? ` (${account.name} ${period} 期)`
                            : ` (${account.name})`

                        // 寫扣款賬戶支出 (類別 transfer，不計入日常支出但扣減餘額以達平帳)
                        const expenseRecord = {
                            type: 'expense',
                            category: 'transfer',
                            amount,
                            date: dateStr,
                            description: isDeductOnly
                                ? `[卡費扣繳平帳] 扣除 ${account.name} 卡費${descSuffix} (信用卡已歸零)`
                                : `[卡費扣繳] 繳納信用卡費${descSuffix}`,
                            accountId: debitId,
                            ledgerId: account.ledgerId,
                            createdAt: Date.now(),
                        }
                        await this.app.dataService.addRecord(expenseRecord)

                        if (!isDeductOnly) {
                            // 寫信用卡收入
                            const incomeRecord = {
                                type: 'income',
                                category: 'transfer',
                                amount,
                                date: dateStr,
                                description: `[卡費扣繳] 從 ${debitAccount.name} 扣款繳費${descSuffix}`,
                                accountId: account.id,
                                ledgerId: account.ledgerId,
                                createdAt: Date.now(),
                            }
                            await this.app.dataService.addRecord(incomeRecord)
                        }

                        // FIFO 沖銷未繳賬單狀態
                        await this.app.dataService.updateCreditStatementsStatus()
                    }

                    showToast(
                        isDeductOnly
                            ? '扣款帳戶已成功扣除卡費並完成平帳！'
                            : '卡費扣繳成功，已完成平帳！'
                    )
                    this.render()
                    closeModal()
                    if (document.getElementById('credit-detail-modal')) {
                        this.showCreditDetailModal(account)
                    }
                } catch (err) {
                    console.error('信用卡扣繳平帳失敗:', err)
                    showToast('扣繳失敗，請稍後重試', 'error')
                }
            })
    }

    async showTransferModal() {
        const accounts = await this.app.dataService.getAccounts()
        if (accounts.length < 2) {
            showToast('你需要至少兩個帳戶才能轉帳', 'warning')
            return
        }

        const modal = document.createElement('div')
        modal.id = 'transfer-form-modal'
        modal.className =
            'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden'

        const accountOptions = accounts
            .map(
                acc =>
                    `<option value="${acc.id}">${escapeHTML(acc.name)}</option>`
            )
            .join('')

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-4 sm:p-6 space-y-4 overflow-hidden box-border">
                <h3 class="text-lg font-bold text-wabi-primary">建立轉帳</h3>
                <div>
                    <label class="text-sm text-wabi-text-secondary">從</label>
                    <select id="transfer-from-account" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface truncate">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">至</label>
                    <select id="transfer-to-account" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface truncate">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">金額</label>
                    <input type="number" id="transfer-amount" placeholder="0.00" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">日期</label>
                    <input type="date" id="transfer-date" value="${formatDateToString(new Date())}" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">備註</label>
                    <input type="text" id="transfer-note" class="w-full min-w-0 mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="save-transfer-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg hover:bg-wabi-accent/90 transition-colors">儲存</button>
                    <button id="cancel-transfer-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg hover:bg-wabi-bg transition-colors">取消</button>
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
                    description:
                        `${note || ''} (轉出至 ${toAccount.name})`.trim(),
                    accountId: fromId,
                }

                const incomeRecord = {
                    type: 'income',
                    category: 'transfer', // Special category
                    amount: amount,
                    date: date,
                    description:
                        `${note || ''} (從 ${fromAccount.name} 轉入)`.trim(),
                    accountId: toId,
                }

                await this.app.dataService.addRecord(expenseRecord)
                await this.app.dataService.addRecord(incomeRecord)
                showToast('轉帳成功！')
                this.render() // Re-render to show updated balances
                closeModal()
            })
    }

    getAvailableIcons() {
        return [
            'fas fa-wallet',
            'fas fa-piggy-bank',
            'fas fa-sack-dollar',
            'fas fa-coins',
            'fas fa-credit-card',
            'fas fa-building-columns',
            'fas fa-money-bill-wave',
            'fas fa-vault',
        ]
    }

    getAvailableColors() {
        return [
            'bg-slate-400',
            'bg-stone-400',
            'bg-red-400',
            'bg-orange-400',
            'bg-amber-400',
            'bg-yellow-400',
            'bg-lime-400',
            'bg-green-400',
            'bg-emerald-400',
            'bg-teal-400',
            'bg-cyan-400',
            'bg-sky-400',
            'bg-blue-400',
            'bg-indigo-400',
            'bg-violet-400',
            'bg-purple-400',
        ]
    }
}

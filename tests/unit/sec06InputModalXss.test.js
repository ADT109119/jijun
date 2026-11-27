/**
 * #SEC06: showInputModal 與各編輯彈窗 value 屬性 XSS 跳脫單元測試
 *
 * 驗證：
 * 1. utils.js 的統一 showInputModal 對 defaultValue / title / message / placeholder / options 皆進行完整跳脫，
 *    且以 DOM `.value` 還原原始字串，不發生 attribute breakout 與標籤注入。
 * 2. SettingsPage（showInputModal / showConfirmModal / showAlertModal）與 PreferencesPage（showInputModal）皆受保護。
 * 3. DebtManager 編輯欠款彈窗、showAmortizationModal、createDateRangeModal、RecurringPage 編輯彈窗、
 *    AccountsPage 帳戶編輯彈窗與信用卡帳單明細彈窗皆對歷史髒資料進行 value/attribute 跳脫且不崩潰。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showInputModal, escapeHTML } from '../../src/js/utils.js'
import { createDateRangeModal } from '../../src/js/datePickerModal.js'
import { showAmortizationModal } from '../../src/js/amortizationModal.js'
import { DebtManager } from '../../src/js/debtManager.js'
import { SettingsPage } from '../../src/js/pages/settingsPage.js'
import { PreferencesPage } from '../../src/js/pages/preferencesPage.js'
import { RecurringPage } from '../../src/js/pages/recurringPage.js'
import { AccountsPage } from '../../src/js/pages/accountsPage.js'

const PAYLOAD_IMG = '"><img src=x onerror="window.__sec06Pwn=1">'
const PAYLOAD_ATTR = '" autofocus onfocus="window.__sec06Focus=1" data-evil="'
const PAYLOAD_SCRIPT = '<script>window.__sec06Script=1</script>'
const PAYLOAD_MIXED = `A"B'C<D>E&F`

beforeEach(() => {
    document.body.innerHTML = ''
    delete window.__sec06Pwn
    delete window.__sec06Focus
    delete window.__sec06Script
})

afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('#SEC06 — utils.showInputModal 屬性跳脫與功能驗證', () => {
    it('defaultValue 含 "><img src=x onerror=...> 時不發生 attribute breakout 且原樣回傳輸入值', () => {
        const onConfirm = vi.fn()
        showInputModal('編輯名稱', '請輸入新名稱', PAYLOAD_IMG, onConfirm)

        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(window.__sec06Pwn).toBeUndefined()

        const input = document.querySelector('[data-input-modal="field"]')
        expect(input).not.toBeNull()
        expect(input.value).toBe(PAYLOAD_IMG)
        expect(input.getAttribute('onerror')).toBeNull()

        // 點擊確定後 onConfirm 收到完整原始字串（不遺失雙引號或尖括號）
        document.querySelector('[data-input-modal="ok"]').click()
        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onConfirm).toHaveBeenCalledWith(PAYLOAD_IMG)
        // 彈窗應已移除
        expect(document.querySelector('[data-input-modal="field"]')).toBeNull()
    })

    it('defaultValue 含雙引號事件注入（autofocus onfocus）時不產生任何額外屬性', () => {
        showInputModal('標題', '說明', PAYLOAD_ATTR, vi.fn())

        const input = document.querySelector('[data-input-modal="field"]')
        expect(input).not.toBeNull()
        expect(input.hasAttribute('autofocus')).toBe(false)
        expect(input.hasAttribute('onfocus')).toBe(false)
        expect(input.hasAttribute('data-evil')).toBe(false)
        expect(input.value).toBe(PAYLOAD_ATTR)
    })

    it('title、message、placeholder 含 <script> 與 HTML 標籤時一律轉義為純文字', () => {
        showInputModal(PAYLOAD_SCRIPT, PAYLOAD_IMG, PAYLOAD_MIXED, vi.fn(), {
            placeholder: PAYLOAD_ATTR,
            inputId: 'custom-input',
            okId: 'custom-ok',
            cancelId: 'custom-cancel',
        })

        expect(document.querySelector('script')).toBeNull()
        expect(document.querySelector('img[src="x"]')).toBeNull()

        const input = document.getElementById('custom-input')
        expect(input).not.toBeNull()
        expect(input.placeholder).toBe(PAYLOAD_ATTR)
        expect(input.value).toBe(PAYLOAD_MIXED)
        expect(input.hasAttribute('onfocus')).toBe(false)
    })

    it('null / undefined defaultValue 正規化為空字串，Enter 鍵送出、取消按鈕不觸發 onConfirm', () => {
        const onConfirm1 = vi.fn()
        showInputModal('T1', 'M1', null, onConfirm1)
        const input1 = document.querySelector('[data-input-modal="field"]')
        expect(input1.value).toBe('')
        input1.value = '新數值'
        input1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(onConfirm1).toHaveBeenCalledWith('新數值')

        const onConfirm2 = vi.fn()
        showInputModal('T2', 'M2', undefined, onConfirm2)
        document.querySelector('[data-input-modal="cancel"]').click()
        expect(onConfirm2).not.toHaveBeenCalled()
        expect(document.querySelector('[data-input-modal="field"]')).toBeNull()
    })

    it('inputId/okId/cancelId 若傳入惡意引號字串亦不會突破 id 屬性或拋出 selector SyntaxError', () => {
        expect(() =>
            showInputModal('T', 'M', 'val', vi.fn(), {
                inputId: PAYLOAD_IMG,
                okId: PAYLOAD_ATTR,
                cancelId: PAYLOAD_SCRIPT,
            })
        ).not.toThrow()
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
    })
})

describe('#SEC06 — SettingsPage 與 PreferencesPage 彈窗防護', () => {
    it('SettingsPage.showInputModal 保留原 DOM ID 並阻擋 defaultValue XSS breakout', () => {
        const sp = new SettingsPage({ appContainer: document.body, dataService: {} })
        const onConfirm = vi.fn()
        sp.showInputModal(PAYLOAD_SCRIPT, PAYLOAD_IMG, PAYLOAD_IMG, onConfirm)

        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()

        const input = document.getElementById('settings-input-value')
        expect(input).not.toBeNull()
        expect(input.value).toBe(PAYLOAD_IMG)

        document.getElementById('settings-input-ok').click()
        expect(onConfirm).toHaveBeenCalledWith(PAYLOAD_IMG)
    })

    it('SettingsPage.showConfirmModal 與 showAlertModal 跳脫 message / title / icon / iconColor', () => {
        const sp = new SettingsPage({ appContainer: document.body, dataService: {} })
        sp.showConfirmModal(PAYLOAD_IMG, vi.fn())
        expect(document.querySelector('img[src="x"]')).toBeNull()
        document.getElementById('settings-confirm-cancel').click()

        sp.showAlertModal(
            PAYLOAD_SCRIPT,
            PAYLOAD_IMG,
            PAYLOAD_IMG,
            'text-red-500" onclick="alert(1)'
        )
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
        expect(document.querySelector('[onclick]')).toBeNull()
        const icon = document.querySelector('i')
        expect(icon.className).toContain('fa-circle-info')
        expect(icon.className).toContain('text-wabi-primary')
    })

    it('PreferencesPage.showInputModal 保留 pref-input-* ID 並阻擋 defaultValue XSS breakout', () => {
        const pp = new PreferencesPage({ appContainer: document.body, dataService: {} })
        const onConfirm = vi.fn()
        pp.showInputModal('偏好設定', PAYLOAD_SCRIPT, PAYLOAD_ATTR, onConfirm)

        expect(document.querySelector('script')).toBeNull()
        const input = document.getElementById('pref-input-value')
        expect(input).not.toBeNull()
        expect(input.value).toBe(PAYLOAD_ATTR)
        expect(input.hasAttribute('onfocus')).toBe(false)

        document.getElementById('pref-input-ok').click()
        expect(onConfirm).toHaveBeenCalledWith(PAYLOAD_ATTR)
    })
})

describe('#SEC06 — 其他編輯彈窗（欠款 / 攤提 / 日期範圍 / 週期交易 / 帳戶）', () => {
    it('DebtManager 編輯欠款彈窗跳脫 description / date / amount 屬性值', async () => {
        const ds = {
            getContacts: vi.fn(async () => [{ id: 1, name: '小明' }]),
        }
        const dm = new DebtManager(ds)
        const container = document.createElement('div')
        document.body.appendChild(container)
        dm.container = container

        await dm.showAddDebtModal({
            id: 10,
            type: 'receivable',
            contactId: 1,
            originalAmount: PAYLOAD_IMG,
            date: PAYLOAD_ATTR,
            description: PAYLOAD_IMG,
        })

        expect(document.querySelector('img[src="x"]')).toBeNull()
        const descInput = document.getElementById('debt-description')
        expect(descInput).not.toBeNull()
        expect(descInput.value).toBe(PAYLOAD_IMG)
        expect(descInput.getAttribute('onerror')).toBeNull()

        const dateInput = document.getElementById('debt-date')
        expect(dateInput.hasAttribute('onfocus')).toBe(false)
    })

    it('showAmortizationModal 跳脫所有輸入欄位與分類選項的 value 屬性', async () => {
        const app = {
            categoryManager: {
                getAllCategories: vi.fn(() => [
                    { id: PAYLOAD_IMG, name: PAYLOAD_SCRIPT },
                ]),
            },
            dataService: {
                getSetting: vi.fn(async () => ({ value: false })),
                getAccounts: vi.fn(async () => []),
            },
        }
        showAmortizationModal(app, {
            id: 1,
            name: PAYLOAD_IMG,
            type: PAYLOAD_ATTR,
            recordType: 'expense',
            category: PAYLOAD_IMG,
            totalAmount: PAYLOAD_IMG,
            downPayment: PAYLOAD_ATTR,
            interestRate: PAYLOAD_ATTR,
            periods: PAYLOAD_IMG,
            completedPeriods: PAYLOAD_ATTR,
            startDate: PAYLOAD_IMG,
            frequency: 'monthly',
        })
        await new Promise(r => setTimeout(r, 0))

        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
        const nameInput = document.getElementById('amort-name')
        expect(nameInput.value).toBe(PAYLOAD_IMG)
        const hiddenType = document.getElementById('amort-type')
        expect(hiddenType.value).toBe(PAYLOAD_ATTR)
        expect(hiddenType.hasAttribute('onfocus')).toBe(false)
    })

    it('createDateRangeModal 跳脫 initialStartDate / initialEndDate 屬性值', () => {
        const modal = createDateRangeModal({
            initialStartDate: PAYLOAD_IMG,
            initialEndDate: PAYLOAD_ATTR,
            onApply: vi.fn(),
        })
        document.body.appendChild(modal)

        expect(modal.querySelector('img[src="x"]')).toBeNull()
        expect(modal.querySelector('#custom-start-date').getAttribute('onerror')).toBeNull()
        expect(modal.querySelector('#custom-end-date').hasAttribute('onfocus')).toBe(false)
    })

    it('RecurringPage 編輯週期交易彈窗跳脫 amount / interval / startDate 與 option value', async () => {
        const app = {
            appContainer: document.body,
            dataService: {
                getSetting: vi.fn(async () => ({ value: true })),
                getAccounts: vi.fn(async () => [{ id: PAYLOAD_IMG, name: PAYLOAD_SCRIPT }]),
            },
            categoryManager: {
                getAllCategories: vi.fn(() => [{ id: PAYLOAD_ATTR, name: PAYLOAD_IMG }]),
            },
        }
        const rp = new RecurringPage(app)
        await rp.showRecurringTransactionModal({
            id: 5,
            type: 'expense',
            description: PAYLOAD_IMG,
            amount: PAYLOAD_ATTR,
            interval: PAYLOAD_IMG,
            startDate: PAYLOAD_ATTR,
            category: PAYLOAD_ATTR,
            accountId: PAYLOAD_IMG,
            frequency: 'monthly',
        })

        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
        const descInput = document.getElementById('recurring-desc')
        expect(descInput.value).toBe(PAYLOAD_IMG)
        expect(document.getElementById('recurring-amount').hasAttribute('onfocus')).toBe(false)
        expect(document.getElementById('recurring-start-date').hasAttribute('onfocus')).toBe(false)
    })

    it('AccountsPage 編輯彈窗與信用卡帳單明細彈窗跳脫所有髒欄位與 icon 並防止 selector 注入', async () => {
        const app = {
            appContainer: document.body,
            dataService: {
                getAccounts: vi.fn(async () => []),
                getCreditCardBillingInfo: vi.fn(async () => ({
                    unbilledPeriod: {
                        startStr: '2026-08-16',
                        endStr: '2026-09-15',
                        lastStatementEndStr: '2026-08-15',
                    },
                    daysUntilStatement: 5,
                    unbilledRecords: [
                        {
                            id: 2,
                            type: 'expense',
                            amount: 50,
                            category: 'evil',
                            description: PAYLOAD_IMG,
                            date: PAYLOAD_SCRIPT,
                        },
                    ],
                    unbilledExpense: 50,
                    unbilledRepayment: 0,
                    unbilledTotal: 50,
                    statements: [
                        {
                            id: 1,
                            period: PAYLOAD_IMG,
                            amount: 100,
                            status: 'unpaid',
                            statementDate: PAYLOAD_ATTR,
                            dueDate: PAYLOAD_ATTR,
                        },
                    ],
                    unpaidStatements: [],
                    billedDueTotal: 100,
                    nextDueDate: null,
                })),
                getStatementPeriod: vi.fn(() => ({
                    startDate: new Date(2026, 6, 16),
                    endDate: new Date(2026, 7, 15),
                })),
                getStatementRecords: vi.fn(async () => [
                    {
                        id: 1,
                        type: 'expense',
                        amount: 100,
                        category: 'evil',
                        description: PAYLOAD_IMG,
                        date: PAYLOAD_SCRIPT,
                    },
                ]),
            },
            categoryManager: {
                getCategoryById: vi.fn(() => ({
                    name: PAYLOAD_SCRIPT,
                    icon: PAYLOAD_IMG,
                    color: '#ef4444',
                })),
            },
        }
        const ap = new AccountsPage(app)

        await ap.showAccountModal({
            id: 1,
            name: PAYLOAD_IMG,
            type: 'credit_card',
            balance: PAYLOAD_ATTR,
            creditLimit: PAYLOAD_IMG,
            statementDay: PAYLOAD_ATTR,
            paymentDueDay: PAYLOAD_IMG,
            icon: PAYLOAD_IMG,
            color: '#3b82f6',
        })
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.getElementById('account-name-input').value).toBe(PAYLOAD_IMG)
        expect(document.getElementById('account-balance-input').hasAttribute('onfocus')).toBe(false)
        document.body.innerHTML = ''

        await ap.showCreditDetailModal({
            id: 1,
            name: PAYLOAD_IMG,
            type: 'credit_card',
            statementDay: 15,
            paymentDueDay: 5,
        })
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()

        // 切到歷史帳單分頁並點擊帶惡意 period 的明細按鈕，不得拋出 querySelector SyntaxError
        document.getElementById('tab-billed-btn')?.click()
        const toggleBtn = document.querySelector('.toggle-stmt-records-btn')
        expect(toggleBtn).not.toBeNull()
        expect(toggleBtn.dataset.period).toBe(PAYLOAD_IMG)
        toggleBtn.click()
        await new Promise(r => setTimeout(r, 0))

        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
        expect(escapeHTML(PAYLOAD_IMG)).toContain('&quot;&gt;&lt;img')
    })
})

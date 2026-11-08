import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AccountsPage } from '../../src/js/pages/accountsPage.js'

// mock utils.js：格式/Toast 用可控回傳，customConfirm/customAlert 需斷言呼叫
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn(v => (Number.isFinite(v) ? `$${Math.round(v)}` : '0')),
    showToast: vi.fn(),
    escapeHTML: vi.fn(s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
    formatDateToString: vi.fn(() => '2026-09-02'),
    customAlert: vi.fn(),
    customConfirm: vi.fn(async () => true),
    // #SEC04：圖示白名單以真實語意提供（白名單外一律 fallback）
    isSafeIconClass: icon =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(icon.trim()),
    getSafeIconClass: (icon, fallback = 'fa-solid fa-question') =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(icon.trim())
            ? icon.trim()
            : fallback,
    // #SEC05：顏色白名單以真實語意提供（髒值雙空→不輸出屬性）
    getSafeBgColorStyle: color => {
        if (
            typeof color === 'string' &&
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)
        ) {
            return { style: `background-color: ${color}`, className: '' }
        }
        if (typeof color === 'string' && /^bg-[a-z0-9-]+$/.test(color)) {
            return { style: '', className: color }
        }
        return { style: '', className: '' }
    },
}))

import { showToast, customAlert, customConfirm } from '../../src/js/utils.js'

// render() 結尾 fire-and-forget 呼叫 setupAccountsPageListeners()（未 await），
// 測試需在 render 後 flush microtask 讓列表填充完成
const flush = () => new Promise(r => setTimeout(r, 0))

function makeApp({ accounts = [], records = [], debts = [], creditStatements = [] } = {}) {
    const appContainer = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(appContainer)
    const dataService = {
        getSetting: vi.fn(async key => (key === 'advancedAccountModeEnabled' ? { value: true } : null)),
        deduplicateAccounts: vi.fn(async () => ({ removed: 0 })),
        getAccounts: vi.fn(async () => accounts),
        getAccount: vi.fn(async id => accounts.find(a => a.id === id) || null),
        getRecords: vi.fn(async () => records),
        getDebts: vi.fn(async () => debts),
        deleteAccount: vi.fn(async () => true),
        updateAccount: vi.fn(async () => true),
        addRecord: vi.fn(async () => 1),
        getCreditStatements: vi.fn(async () => creditStatements),
        updateCreditStatementsStatus: vi.fn(async () => {}),
        // v2.1.8.2 起 render 列表對信用卡呼叫帳務資訊（即時/出帳分離顯示）
        getCreditCardBillingInfo: vi.fn(async () => null),
    }
    const app = { appContainer, dataService }
    return { app, dataService, appContainer }
}

describe('AccountsPage - render() 路由守門', () => {
    let app, page

    beforeEach(() => {
        const { app: a } = makeApp()
        app = a
        page = new AccountsPage(app)
    })

    it('多帳戶模式未開啟時跳轉 #settings 且不渲染頁面', async () => {
        app.dataService.getSetting.mockResolvedValue({ value: false })
        await page.render()
        await flush()
        expect(window.location.hash).toBe('#settings')
        expect(app.appContainer.innerHTML).toBe('')
    })

    it('多帳戶模式開啟時渲染帳戶管理頁骨架', async () => {
        await page.render()
        await flush()
        expect(window.location.hash).not.toBe('#settings')
        expect(app.appContainer.innerHTML).toContain('帳戶管理')
        expect(app.appContainer.querySelector('#total-assets')).not.toBeNull()
        expect(app.appContainer.querySelector('#credit-debt-section')).not.toBeNull()
        expect(app.appContainer.querySelector('#add-account-btn')).not.toBeNull()
    })

    afterEach(() => {
        window.location.hash = ''
    })
})

describe('AccountsPage - 帳戶餘額計算 (setupAccountsPageListeners)', () => {
    let app, page, container

    beforeEach(() => {
        const { app: a, appContainer } = makeApp()
        app = a
        page = new AccountsPage(app)
        container = appContainer
    })

    it('無帳戶時顯示「尚未建立任何帳戶」', async () => {
        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        expect(list.innerHTML).toContain('尚未建立任何帳戶')
    })

    it('一般帳戶餘額 = 初始餘額 + 收入 - 支出', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 1, type: 'income', amount: 500, debtId: null, category: 'salary' },
            { id: 12, accountId: 1, type: 'expense', amount: 200, debtId: null, category: 'food' },
        ])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        // 1000 + 500 - 200 = 1300
        expect(list.textContent).toContain('$1300')
        expect(container.querySelector('#total-assets').textContent).toBe('$1300')
    })

    it('payable 欠款的原始紀錄排除在餘額外（建立當下不扣款）', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getDebts.mockResolvedValue([{ id: 5, type: 'payable', amount: 800 }])
        app.dataService.getRecords.mockResolvedValue([
            // payable 欠款的原始紀錄 → 排除
            { id: 11, accountId: 1, type: 'expense', amount: 800, debtId: 5, category: 'food' },
            // 一般支出 → 計入
            { id: 12, accountId: 1, type: 'expense', amount: 100, debtId: null, category: 'food' },
        ])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        // 1000 - 100 = 900（800 的 payable 原始紀錄不扣）
        expect(list.textContent).toContain('$900')
    })

    it('debt_repayment 還款紀錄是實際金錢流動，必須計入餘額', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getDebts.mockResolvedValue([{ id: 5, type: 'payable', amount: 800 }])
        app.dataService.getRecords.mockResolvedValue([
            // 還款紀錄帶 debtId 但 category=debt_repayment → 不排除
            { id: 13, accountId: 1, type: 'expense', amount: 300, debtId: 5, category: 'debt_repayment' },
        ])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        // 1000 - 300 = 700
        expect(list.textContent).toContain('$700')
    })

    it('receivable（別人欠我）的原始紀錄不排除、正常計入', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getDebts.mockResolvedValue([{ id: 6, type: 'receivable', amount: 800 }])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 1, type: 'expense', amount: 800, debtId: 6, category: 'food' },
        ])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        // receivable 不排除：1000 - 800 = 200
        expect(list.textContent).toContain('$200')
    })

    it('debtId 為 null 的紀錄永遠不排除', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getDebts.mockResolvedValue([{ id: 5, type: 'payable', amount: 800 }])
        app.dataService.getRecords.mockResolvedValue([
            // debtId null → 不排除
            { id: 11, accountId: 1, type: 'expense', amount: 400, debtId: null, category: 'food' },
        ])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        expect(list.textContent).toContain('$600')
    })

    it('其他帳戶的紀錄不計入本帳戶餘額', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 1000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
            { id: 2, name: '銀行', type: 'wallet', balance: 0, icon: 'fa-solid fa-building-columns', color: 'bg-blue-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 2, type: 'income', amount: 9999, debtId: null, category: 'salary' },
        ])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        // 只斷言帳戶 1 的卡片（帳戶 2 卡片會顯示自己的餘額 $9999）
        const btn1 = [...container.querySelectorAll('.edit-account-btn')].find(b => b.dataset.id === '1')
        const card1 = btn1.closest('div.flex.items-center.justify-between')
        // 帳戶 1 不受帳戶 2 的紀錄影響
        expect(card1.textContent).toContain('餘額: $1000')
        expect(card1.textContent).not.toContain('$9999')
        // 總資產 = 1000 + 9999
        expect(container.querySelector('#total-assets').textContent).toBe('$10999')
    })
})

describe('AccountsPage - 信用卡欠款語意 (cardDebt)', () => {
    let app, page, container

    beforeEach(() => {
        const { app: a, appContainer } = makeApp()
        app = a
        page = new AccountsPage(app)
        container = appContainer
    })

    it('刷卡消費 → 餘額為負 → 欠款 = 負值取負號', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 5000, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
            { id: 2, name: '銀行卡', type: 'credit_card', balance: 0, creditLimit: 10000, icon: 'fa-solid fa-credit-card', color: 'bg-red-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 2, type: 'expense', amount: 5000, debtId: null, category: 'shopping' },
        ])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const cardEl = [...container.querySelectorAll('.edit-account-btn')].find(b => b.dataset.id === '2').closest('div.bg-wabi-surface')
        expect(cardEl.textContent).toContain('欠款: $5000')
        // 額度 10000 / 可用 5000
        expect(cardEl.textContent).toContain('額度 $10000')
        expect(cardEl.textContent).toContain('可用 $5000')
        // 信用卡不計入總資產，而是計入總欠款
        expect(container.querySelector('#total-assets').textContent).toBe('$5000')
        const debtSection = container.querySelector('#credit-debt-section')
        expect(debtSection.classList.contains('hidden')).toBe(false)
        expect(debtSection.textContent).toContain('$5000')
    })

    it('超繳（餘額為正）→ 欠款為 0、可用額度 = 全額度', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 2, name: '銀行卡', type: 'credit_card', balance: 0, creditLimit: 10000, icon: 'fa-solid fa-credit-card', color: 'bg-red-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 2, type: 'expense', amount: 5000, debtId: null, category: 'shopping' },
            { id: 12, accountId: 2, type: 'income', amount: 5200, debtId: null, category: 'refund' },
        ])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        // 淨現金流 = -5000 + 5200 = +200 → 超繳，欠款 0
        expect(list.textContent).toContain('欠款: $0')
        expect(list.textContent).toContain('可用 $10000')
        expect(container.querySelector('#credit-debt-total').textContent).toBe('$0')
    })

    it('無信用卡時總欠款區塊隱藏', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 100, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const debtSection = container.querySelector('#credit-debt-section')
        expect(debtSection.classList.contains('hidden')).toBe(true)
    })

    it('信用卡卡片顯示信用卡 badge 與「立即繳款」按鈕', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 2, name: '銀行卡', type: 'credit_card', balance: -100, creditLimit: 5000, icon: 'fa-solid fa-credit-card', color: 'bg-red-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        expect(list.textContent).toContain('信用卡')
        const payBtn = list.querySelector('.credit-pay-btn')
        expect(payBtn).not.toBeNull()
        expect(payBtn.dataset.id).toBe('2')
    })

    it('信用卡初始餘額為 undefined（舊資料 NaN）時欠款不為 NaN', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 2, name: '銀行卡', type: 'credit_card', balance: undefined, creditLimit: 5000, icon: 'fa-solid fa-credit-card', color: 'bg-red-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        // 無紀錄時 currentBalance 保持 undefined（typeof !== 'number'）→ cardDebt 走 0
        // 若防護被移除（直接 -undefined = NaN），欠款會顯示 NaN
        const list = container.querySelector('#accounts-list-container')
        const debtSection = container.querySelector('#credit-debt-section')
        expect(list.textContent).toContain('欠款: $0')
        expect(debtSection.textContent).not.toContain('NaN')
    })
})

describe('AccountsPage - XSS 防護', () => {
    let app, page, container

    beforeEach(() => {
        const { app: a, appContainer } = makeApp()
        app = a
        page = new AccountsPage(app)
        container = appContainer
    })

    it('帳戶名稱含 XSS payload 時被 escapeHTML 防護', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '<img src=x onerror=alert(1)>惡意帳戶', type: 'wallet', balance: 100, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        expect(list.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;惡意帳戶')
        expect(list.querySelector('img[src="x"]')).toBeNull()
    })

    it('hex 顏色走 inline style 時經 escapeHTML（不產生 raw 注入）', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 0, icon: 'fa-solid fa-wallet', color: '#22c55e' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])

        await page.render()
        await flush()
        const list = container.querySelector('#accounts-list-container')
        const colorBox = list.querySelector('.rounded-lg[style]')
        expect(colorBox).not.toBeNull()
        expect(colorBox.getAttribute('style')).toContain('#22c55e')
    })
})

describe('AccountsPage - 帳戶刪除與轉帳按鈕', () => {
    let app, page, container

    beforeEach(() => {
        const { app: a, appContainer } = makeApp()
        app = a
        page = new AccountsPage(app)
        container = appContainer
    })

    it('有交易紀錄的帳戶無法刪除（customAlert 提示）', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 0, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([
            { id: 11, accountId: 1, type: 'expense', amount: 10, debtId: null, category: 'food' },
        ])
        app.dataService.getDebts.mockResolvedValue([])
        customConfirm.mockResolvedValue(true)

        await page.render()
        await flush()
        const btn = container.querySelector('.delete-account-btn')
        btn.click()
        await new Promise(r => setTimeout(r, 0))

        expect(customAlert).toHaveBeenCalledWith('此帳戶尚有交易紀錄，無法刪除。')
        expect(app.dataService.deleteAccount).not.toHaveBeenCalled()
    })

    it('無紀錄且確認刪除時呼叫 deleteAccount 並重繪頁面', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 0, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])
        customConfirm.mockResolvedValue(true)

        await page.render()
        await flush()
        const btn = container.querySelector('.delete-account-btn')
        btn.click()
        await new Promise(r => setTimeout(r, 0))

        expect(customConfirm).toHaveBeenCalledWith('確定要刪除此帳戶嗎？')
        expect(app.dataService.deleteAccount).toHaveBeenCalledWith(1)
        expect(showToast).toHaveBeenCalledWith('帳戶已刪除')
    })

    it('無紀錄但取消確認時不刪除', async () => {
        app.dataService.getAccounts.mockResolvedValue([
            { id: 1, name: '現金', type: 'wallet', balance: 0, icon: 'fa-solid fa-wallet', color: 'bg-gray-500' },
        ])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])
        customConfirm.mockResolvedValue(false)

        await page.render()
        await flush()
        const btn = container.querySelector('.delete-account-btn')
        btn.click()
        await new Promise(r => setTimeout(r, 0))

        expect(app.dataService.deleteAccount).not.toHaveBeenCalled()
    })

    it('轉帳按鈕觸發 showTransferModal', async () => {
        app.dataService.getAccounts.mockResolvedValue([])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])
        const spy = vi.spyOn(page, 'showTransferModal').mockResolvedValue()

        await page.render()
        await flush()
        container.querySelector('#transfer-btn').click()
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })

    it('新增帳戶按鈕觸發 showAccountModal', async () => {
        app.dataService.getAccounts.mockResolvedValue([])
        app.dataService.getRecords.mockResolvedValue([])
        app.dataService.getDebts.mockResolvedValue([])
        const spy = vi.spyOn(page, 'showAccountModal').mockResolvedValue()

        await page.render()
        await flush()
        container.querySelector('#add-account-btn').click()
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})

describe('AccountsPage - showAdjustBalanceModal 餘額矯正', () => {
    let app, page, account, modal, input

    beforeEach(async () => {
        const { app: a } = makeApp()
        app = a
        page = new AccountsPage(app)
        account = { id: 7, name: '現金', type: 'wallet', balance: 1000 }
        app.dataService.addRecord.mockClear()
        app.dataService.updateAccount.mockClear()
        // v2.1.8.2：showAdjustBalanceModal 改 async（先讀帳戶清單供補扣卡費選擇）
        await page.showAdjustBalanceModal(account, 1000)
        modal = document.getElementById('adjust-balance-modal')
        input = modal.querySelector('#actual-balance-input')
    })

    afterEach(() => {
        document.getElementById('adjust-balance-modal')?.remove()
    })

    it('顯示目前餘額並預填實際餘額輸入框', () => {
        expect(modal.textContent).toContain('$1000')
        expect(input.value).toBe('1000')
    })

    it('輸入高於目前餘額 → 差額顯示 + 且 income 顏色', () => {
        input.value = '1500'
        input.dispatchEvent(new Event('input'))
        const diffDisplay = modal.querySelector('#difference-display')
        const diffAmount = modal.querySelector('#difference-amount')
        expect(diffDisplay.classList.contains('hidden')).toBe(false)
        expect(diffAmount.textContent).toContain('+')
        expect(diffAmount.textContent).toContain('$500')
        expect(diffAmount.className).toContain('text-wabi-income')
    })

    it('輸入低於目前餘額 → 差額顯示 - 且 expense 顏色', () => {
        input.value = '800'
        input.dispatchEvent(new Event('input'))
        const diffDisplay = modal.querySelector('#difference-display')
        const diffAmount = modal.querySelector('#difference-amount')
        expect(diffDisplay.classList.contains('hidden')).toBe(false)
        expect(diffAmount.textContent).toContain('-')
        expect(diffAmount.textContent).toContain('$200')
        expect(diffAmount.className).toContain('text-wabi-expense')
    })

    it('輸入等於目前餘額 → 差額區塊隱藏', () => {
        input.value = '1000'
        input.dispatchEvent(new Event('input'))
        expect(modal.querySelector('#difference-display').classList.contains('hidden')).toBe(true)
    })

    it('勾選「加入記帳紀錄」+ 差額為正 → 寫入 income 平帳紀錄', async () => {
        input.value = '1500'
        modal.querySelector('#save-adjustment-btn').click()
        await new Promise(r => setTimeout(r, 0))

        expect(app.dataService.addRecord).toHaveBeenCalledWith(expect.objectContaining({
            amount: 500,
            type: 'income',
            category: 'balance_adjustment',
            accountId: 7,
        }))
        expect(app.dataService.updateAccount).not.toHaveBeenCalled()
    })

    it('勾選「加入記帳紀錄」+ 差額為負 → 寫入 expense 平帳紀錄', async () => {
        input.value = '500'
        modal.querySelector('#save-adjustment-btn').click()
        await new Promise(r => setTimeout(r, 0))

        expect(app.dataService.addRecord).toHaveBeenCalledWith(expect.objectContaining({
            amount: 500,
            type: 'expense',
            category: 'balance_adjustment',
            accountId: 7,
        }))
    })

    it('未勾選「加入記帳紀錄」→ 直接更新帳戶初始餘額', async () => {
        input.value = '1200'
        modal.querySelector('#add-adjustment-record').checked = false
        modal.querySelector('#save-adjustment-btn').click()
        await new Promise(r => setTimeout(r, 0))

        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(account.balance).toBe(1200)
        expect(app.dataService.updateAccount).toHaveBeenCalledWith(7, account)
    })

    it('差額為 0 時提示「餘額無變動」且不寫入任何資料', async () => {
        input.value = '1000'
        modal.querySelector('#save-adjustment-btn').click()
        await new Promise(r => setTimeout(r, 0))

        expect(showToast).toHaveBeenCalledWith('餘額無變動')
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(app.dataService.updateAccount).not.toHaveBeenCalled()
        expect(document.getElementById('adjust-balance-modal')).toBeNull()
    })

    it('輸入非法金額 → showToast error 且不寫入資料', async () => {
        input.value = 'abc'
        modal.querySelector('#save-adjustment-btn').click()
        await new Promise(r => setTimeout(r, 0))

        expect(showToast).toHaveBeenCalledWith('請輸入有效的金額', 'error')
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(document.getElementById('adjust-balance-modal')).not.toBeNull()
    })

    it('取消按鈕移除 modal', () => {
        modal.querySelector('#cancel-adjustment-btn').click()
        expect(document.getElementById('adjust-balance-modal')).toBeNull()
    })

    it('點擊背景遮罩移除 modal', () => {
        // click 事件的 target 為 modal 本身（背景點擊）
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        // 事件 target 是 dispatch 目標 modal
        expect(document.getElementById('adjust-balance-modal')).toBeNull()
    })
})

describe('AccountsPage - showCreditPayModal 繳款金額語意', () => {
    let app, page

    const card = {
        id: 9,
        name: '測試卡',
        type: 'credit_card',
        ledgerId: 1,
    }

    beforeEach(() => {
        document.body.innerHTML = ''
    })

    afterEach(() => {
        document.getElementById('credit-pay-modal')?.remove()
    })

    it('unpaid 帳單 → 預填全額合計', async () => {
        const { app: a } = makeApp({
            accounts: [card, { id: 1, name: '銀行', type: 'bank' }],
            creditStatements: [
                { id: 1, accountId: 9, period: '2026-05', amount: 1000, status: 'unpaid' },
                { id: 2, accountId: 9, period: '2026-06', amount: 2000, status: 'unpaid' },
            ],
        })
        app = a
        page = new AccountsPage(app)
        await page.showCreditPayModal(card)
        const modal = document.getElementById('credit-pay-modal')
        expect(modal).not.toBeNull()
        // 未繳合計 3000：顯示於提示文字與預填金額
        expect(modal.textContent).toContain('$3000')
        expect(modal.querySelector('#credit-pay-amount').value).toBe('3000')
    })

    it('partial 帳單 → 只計剩額（帳單額 − 已繳），不重複提示全額', async () => {
        const { app: a } = makeApp({
            accounts: [card, { id: 1, name: '銀行', type: 'bank' }],
            creditStatements: [
                // 一期已全繳清（paid）：不計入
                { id: 1, accountId: 9, period: '2026-04', amount: 800, status: 'paid', paidAmount: 800 },
                // 一期部分繳款 500/2000：剩額 1500
                { id: 2, accountId: 9, period: '2026-05', amount: 2000, status: 'partial', paidAmount: 500 },
                // 一期全未繳：全額 1000
                { id: 3, accountId: 9, period: '2026-06', amount: 1000, status: 'unpaid' },
            ],
        })
        app = a
        page = new AccountsPage(app)
        await page.showCreditPayModal(card)
        const modal = document.getElementById('credit-pay-modal')
        // 待繳 = 1500 + 1000 = 2500（舊版会把 partial 當不存在/全額，會誤提示 3000+）
        expect(modal.textContent).toContain('$2500')
        expect(modal.querySelector('#credit-pay-amount').value).toBe('2500')
    })

    it('髒資料 paidAmount 超過帳單額 → 剩額下限 0 不產生負數', async () => {
        const { app: a } = makeApp({
            accounts: [card, { id: 1, name: '銀行', type: 'bank' }],
            creditStatements: [
                { id: 1, accountId: 9, period: '2026-05', amount: 500, status: 'partial', paidAmount: 800 },
            ],
        })
        app = a
        page = new AccountsPage(app)
        await page.showCreditPayModal(card)
        const modal = document.getElementById('credit-pay-modal')
        expect(modal.querySelector('#credit-pay-amount').value).toBe('')
        expect(modal.textContent).not.toContain('-')
    })
})

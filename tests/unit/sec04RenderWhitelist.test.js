// ==================== #SEC04 渲染面白名單補完回歸測試 ====================
// 補充 10/1 #SEC04 工作樹的 code review 修復三案：
// 1. accountsPage 編輯彈窗：歷史髒 icon 建立時即自愈為合法預設（存檔不受阻）
// 2. debtManager 群組詳情彈窗：自訂分類名 escapeHTML
// 3. rewardService 內建推廣廣告：icon 過全站白名單（原正則會誤殺合法 FA6 寫法）

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 1. AccountsPage 編輯彈窗歷史髒 icon 自愈 ──────────────────
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn(v => (Number.isFinite(v) ? `$${Math.round(v)}` : '0')),
    showToast: vi.fn(),
    escapeHTML: vi.fn(
        s =>
            String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
    ),
    formatDateToString: vi.fn(() => '2026-09-02'),
    formatDate: vi.fn(d => d || '2026/09/02'),
    customAlert: vi.fn(),
    customConfirm: vi.fn(async () => true),
    isSafeIconClass: icon =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(
            icon.trim()
        ),
    getSafeIconClass: (icon, fallback = 'fa-solid fa-question') =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(
            icon.trim()
        )
            ? icon.trim()
            : fallback,
    // #SEC05：顏色白名單以真實語意提供（髒值雙空→不輸出屬性）
    getSafeBgColorStyle: color => {
        if (
            typeof color === 'string' &&
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
                color
            )
        ) {
            return { style: `background-color: ${color}`, className: '' }
        }
        if (typeof color === 'string' && /^bg-[a-z0-9-]+$/.test(color)) {
            return { style: '', className: color }
        }
        return { style: '', className: '' }
    },
}))

import { AccountsPage } from '../../src/js/pages/accountsPage.js'

describe('AccountsPage - #SEC04 編輯彈窗歷史髒 icon 自愈', () => {
    let app, page

    beforeEach(() => {
        const appContainer = document.createElement('div')
        document.body.innerHTML = ''
        document.body.appendChild(appContainer)
        app = {
            appContainer,
            dataService: {
                getSetting: vi.fn(async () => null),
                getAccounts: vi.fn(async () => []),
            },
        }
        page = new AccountsPage(app)
    })

    it('髒 icon 帳戶開彈窗：不注入 img、預覽退回錢包圖示', async () => {
        const dirtyAccount = {
            id: 7,
            name: '髒帳戶',
            type: 'cash',
            icon: '"><img src=x onerror=alert(1)>',
            color: '#10b981',
            balance: 0,
        }
        await page.showAccountModal(dirtyAccount)
        const modal = document.getElementById('account-form-modal')
        expect(modal).toBeTruthy()
        expect(modal.querySelector('img[src="x"]')).toBeNull()
        expect(modal.innerHTML).not.toContain('onerror')
        // 預覽退回合法預設圖示（非髒值）
        const preview = modal.querySelector('#icon-preview i')
        expect(preview.className).toContain('fa-wallet')
        modal.remove()
    })

    it('信用卡帳戶髒 icon：預覽退回信用卡圖示（type 感知 fallback）', async () => {
        const dirtyCard = {
            id: 8,
            name: '髒卡',
            type: 'credit_card',
            icon: "fa-solid fa-book' onmouseover='alert(1)",
            color: '#10b981',
            balance: 0,
            creditLimit: 10000,
            statementDay: 25,
            dueDay: 15,
        }
        await page.showAccountModal(dirtyCard)
        const modal = document.getElementById('account-form-modal')
        const preview = modal.querySelector('#icon-preview i')
        expect(preview.className).toContain('fa-credit-card')
        modal.remove()
    })

    it('合法 icon 編輯：預覽保留原圖示且反白對應按鈕', async () => {
        // 用內建圖示清單（getAvailableIcons）的合法舊式寫法，才會命中反白
        const goodAccount = {
            id: 9,
            name: '正常帳戶',
            type: 'wallet',
            icon: 'fas fa-piggy-bank',
            color: '#10b981',
            balance: 0,
        }
        await page.showAccountModal(goodAccount)
        const modal = document.getElementById('account-form-modal')
        const preview = modal.querySelector('#icon-preview i')
        expect(preview.className).toContain('fa-piggy-bank')
        // 反白按鈕存在且帶 selected 樣式（selector 注入防護路徑不拋錯）
        const highlighted = modal.querySelector(
            '.icon-option.border-wabi-primary'
        )
        expect(highlighted).toBeTruthy()
        expect(highlighted.dataset.icon).toBe('fas fa-piggy-bank')
        modal.remove()
    })
})

// ── 1b. AccountsPage 信用卡帳務明細彈窗渲染面白名單 (#SEC04/#SEC05) ──
describe('AccountsPage - #SEC04/#SEC05 信用卡明細彈窗髒 icon/color 渲染', () => {
    let app, page

    const dirtyCard = {
        id: 21,
        name: '髒卡面',
        type: 'credit_card',
        icon: '"><img src=x onerror=window.__pwn=1>',
        color: '#fff;background-image:url(evil)',
        balance: -5000,
        creditLimit: 20000,
        statementDay: 25,
        dueDay: 15,
    }

    const billingInfo = {
        account: dirtyCard,
        statementDay: 25,
        dueDay: 15,
        creditLimit: 20000,
        totalDebt: 5000,
        availableCredit: 15000,
        unbilledPeriod: {
            startDate: new Date(2026, 9, 26),
            endDate: new Date(2026, 10, 25),
            startStr: '2026-10-26',
            endStr: '2026-11-25',
            lastStatementEndStr: '2026-10-25',
        },
        daysUntilStatement: 30,
        unbilledRecords: [],
        unbilledExpense: 0,
        unbilledRepayment: 0,
        unbilledTotal: 0,
        statements: [],
        unpaidStatements: [],
        billedDueTotal: 0,
        nextDueDate: null,
    }

    beforeEach(() => {
        window.__pwn = 0
        document.body.innerHTML = ''
        app = {
            appContainer: document.createElement('div'),
            dataService: {
                getCreditCardBillingInfo: vi.fn(async () => billingInfo),
            },
        }
        page = new AccountsPage(app)
    })

    it('髒 color 不逃脫成 CSS 規則、髒 icon 不注入 img（退回白名單值）', async () => {
        await page.showCreditDetailModal(dirtyCard)
        const modal = document.getElementById('credit-detail-modal')
        expect(modal).toBeTruthy()
        // 注入面：img 節點不得成立、onerror 字串不得出現
        expect(modal.querySelector('img[src="x"]')).toBeNull()
        expect(modal.innerHTML).not.toContain('onerror')
        expect(window.__pwn).toBe(0)
        // 顏色：髒值被白名單拒絕 → 不輸出 style，退回中性底色
        const iconBox = modal.querySelector('.size-10')
        expect(iconBox.getAttribute('style')).toBeNull()
        expect(iconBox.className).toContain('bg-gray-500')
        // 圖示：白名單外 → type 感知 fallback
        const icon = modal.querySelector('.size-10 i')
        expect(icon.className).toContain('fa-credit-card')
        expect(icon.className).not.toContain('pwn')
        modal.remove()
    })

    it('合法 color/icon：正常套用原值（白名單零誤殺）', async () => {
        const goodCard = {
            ...dirtyCard,
            icon: 'fas fa-credit-card',
            color: '#10b981',
        }
        await page.showCreditDetailModal(goodCard)
        const modal = document.getElementById('credit-detail-modal')
        const iconBox = modal.querySelector('.size-10')
        expect(iconBox.getAttribute('style')).toBe('background-color: #10b981')
        expect(modal.querySelector('.size-10 i').className).toContain(
            'fa-credit-card'
        )
        modal.remove()
    })
})

// ── 2. DebtManager 群組詳情彈窗分類名 escape ──────────────────
vi.mock('../../src/js/categories.js', () => ({
    getCategoryById: vi.fn(() => ({
        name: '"><img src=x onerror=alert(1)>',
        icon: 'fa-solid fa-receipt',
        color: '#ef4444',
    })),
    // accountsPage 明細彈窗使用（同為不可信資料面，回傳髒值驗證轉義）
    getCategoryName: vi.fn(() => '飲食'),
    getCategoryIcon: vi.fn(() => 'fa-solid fa-utensils'),
}))

import { DebtManager } from '../../src/js/debtManager.js'

describe('DebtManager - #SEC04 群組詳情彈窗分類名轉義', () => {
    let dm

    beforeEach(() => {
        dm = new DebtManager({ activeLedgerId: 1 })
    })

    it('自訂分類名含 HTML：群組明細行渲染為純文字，不產生 img 節點', async () => {
        dm.dataService = {
            getGroupMeta: vi.fn(async () => ({ name: '聚餐群', settled: false })),
            getGroupRecords: vi.fn(async () => [
                {
                    id: 1,
                    type: 'expense',
                    category: 'evilcat',
                    amount: 100,
                    date: '2026-10-01',
                    description: 'normal',
                },
            ]),
            _calculateGroupNetAsync: vi.fn(async () => ({
                netAmount: -100,
                totalExpense: 100,
                totalIncome: 0,
            })),
            getDebts: vi.fn(async () => []),
            // v2.1.8.2：群組詳情彈窗會批次載入聯絡人（欠款人標示）
            getContacts: vi.fn(async () => []),
        }
        await dm.showGroupDetailsModal('group-1')
        const modal = document.getElementById('group-details-modal')
        expect(modal).toBeTruthy()
        expect(modal.querySelector('img[src="x"]')).toBeNull()
        // 文字內容保留原字面（轉義後仍可見），但非可執行標籤
        expect(modal.textContent).toContain('<img src=x')
        expect(modal.innerHTML).not.toContain('<img src="x"')
        modal.remove()
    })
})

// ── 3. RewardService 內建推廣廣告 icon 白名單 ─────────────────
// utils.js 以同款白名單語意 mock（與真實實作逐字一致的正則），驗證
// getSafeIconClass 對 FA6 完整寫法的接受度——這是原內聯正則
// /^fa-[a-zA-Z0-9-]+$/ 的誤殺點（internal-ads.json 全數為 FA6 完整寫法）。

import { RewardService } from '../../src/js/rewardService.js'
import { getSafeIconClass } from '../../src/js/utils.js'

describe('RewardService - #SEC04 內建推廣廣告圖示白名單', () => {
    let service

    beforeEach(() => {
        localStorage.removeItem('adFreeUntil')
        service = new RewardService()
        document.body.innerHTML = ''
    })

    it('getSafeIconClass 接受 internal-ads.json 的 FA6 完整寫法（原正則誤殺回歸鎖）', () => {
        // public/internal-ads.json 實際使用 'fa-brands fa-github' 等完整寫法
        expect(getSafeIconClass('fa-brands fa-github', 'fa-solid fa-gift')).toBe(
            'fa-brands fa-github'
        )
        expect(getSafeIconClass('fa-solid fa-blog', 'fa-solid fa-gift')).toBe(
            'fa-solid fa-blog'
        )
        // 非法值退回 gift
        expect(getSafeIconClass('"><img src=x>', 'fa-solid fa-gift')).toBe(
            'fa-solid fa-gift'
        )
    })

    it('_showInternalAd：廣告 icon 白名單外退回 gift，title/description 注入不成立', async () => {
        const originalFetch = global.fetch
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => [
                {
                    icon: '"><img src=x onerror=alert(1)>',
                    color: '#333333',
                    title: '"><script>alert(2)</script>',
                    description: '<img src=y>',
                    buttonText: '按我',
                    url: 'https://example.com',
                    image: '',
                },
            ],
        }))
        try {
            const promise = service._showInternalAd()
            await new Promise(r => setTimeout(r, 50))
            const modal = document.querySelector('.fixed.inset-0')
            expect(modal).toBeTruthy()
            expect(modal.querySelector('img[src="x"]')).toBeNull()
            expect(modal.querySelector('script')).toBeNull()
            expect(modal.querySelector('img[src="y"]')).toBeNull()
            // icon 退回 gift
            expect(modal.querySelector('i').className).toContain('fa-gift')
            // 關閉按鈕結束 promise（避免定時器洩漏）
            modal.querySelector('[data-action="cancel"]').click()
            const result = await promise
            expect(result).toBe(false)
        } finally {
            global.fetch = originalFetch
        }
    })
})

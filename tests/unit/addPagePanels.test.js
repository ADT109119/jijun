import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddPage } from '../../src/js/pages/addPage.js'

describe('AddPage - 面板獨立開啟與互斥空值安全防護', () => {
    let app, addPage, container

    beforeEach(() => {
        container = document.createElement('div')
        container.id = 'app-container'
        document.body.innerHTML = ''
        document.body.appendChild(container)

        app = {
            appContainer: container,
            aiService: {},
            updateNavAddIcon: vi.fn(),
            dataService: {
                getSetting: vi.fn(),
                getContacts: vi.fn().mockResolvedValue([
                    { id: 1, name: '小明' },
                    { id: 2, name: '小美' },
                ]),
                getAccounts: vi.fn().mockResolvedValue([
                    { id: 1, name: '現金', type: 'cash', color: '#10b981' },
                ]),
                getCategories: vi.fn().mockResolvedValue([]),
                getRecords: vi.fn().mockResolvedValue([]),
                getDebt: vi.fn().mockResolvedValue(null),
                getAmortization: vi.fn().mockResolvedValue(null),
                getAllGroupMeta: vi.fn().mockResolvedValue([]),
                getGroups: vi.fn().mockResolvedValue([]),
                addContact: vi.fn().mockResolvedValue(3),
            },
            categoryManager: {
                getCategories: vi.fn().mockReturnValue([
                    { id: 'food', name: '餐飲', icon: 'fa-utensils', type: 'expense', color: '#10b981' },
                ]),
                getCustomCategories: vi.fn().mockReturnValue([]),
                getAllCategories: vi.fn().mockReturnValue([
                    { id: 'food', name: '餐飲', icon: 'fa-utensils', type: 'expense', color: '#10b981' },
                ]),
                getCategoryById: vi.fn().mockReturnValue({
                    id: 'food',
                    name: '餐飲',
                    icon: 'fa-utensils',
                    type: 'expense',
                    color: '#10b981',
                }),
            },
            ledgerManager: {
                getActiveLedger: vi.fn().mockReturnValue({ id: 1, name: '預設帳本' }),
                getAllLedgers: vi.fn().mockReturnValue([{ id: 1 }]),
            },
            groupManager: {
                createGroup: vi.fn().mockResolvedValue('g-new'),
            },
            debtManager: {},
            quickSelectManager: {
                render: vi.fn(),
            },
        }

        addPage = new AddPage(app)
    })

    it('只開啟欠款功能時（分期與群組關閉），點擊欠款按鈕能正常開啟欠款面板且不拋出 TypeError', async () => {
        app.dataService.getSetting.mockImplementation(async key => {
            if (key === 'debtManagementEnabled') return { value: true }
            if (key === 'groupManagementEnabled') return { value: false }
            if (key === 'amortizationEnabled') return { value: false }
            if (key === 'calculatorModeEnabled') return { value: true }
            return null
        })

        const params = new URLSearchParams()
        await addPage.render(params)

        const toggleDebtBtn = container.querySelector('#toggle-debt-btn')
        const debtPanel = container.querySelector('#debt-panel')
        const toggleInstallmentBtn = container.querySelector('#toggle-installment-btn')
        const toggleGroupBtn = container.querySelector('#toggle-group-btn')

        // 驗證只有欠款按鈕被渲染
        expect(toggleDebtBtn).not.toBeNull()
        expect(toggleInstallmentBtn).toBeNull()
        expect(toggleGroupBtn).toBeNull()

        // 預設面板應為隱藏
        expect(debtPanel.classList.contains('hidden')).toBe(true)

        // 點擊欠款按鈕：應成功展開欠款面板，不因分期/群組按鈕為 null 而崩潰
        expect(() => {
            toggleDebtBtn.click()
        }).not.toThrow()

        expect(debtPanel.classList.contains('hidden')).toBe(false)
        expect(app.dataService.getContacts).toHaveBeenCalled()
    })

    it('只開啟分期功能時（欠款與群組關閉），點擊分期按鈕能正常開啟分期面板且不拋錯', async () => {
        app.dataService.getSetting.mockImplementation(async key => {
            if (key === 'debtManagementEnabled') return { value: false }
            if (key === 'groupManagementEnabled') return { value: false }
            if (key === 'amortizationEnabled') return { value: true }
            if (key === 'calculatorModeEnabled') return { value: true }
            return null
        })

        const params = new URLSearchParams()
        await addPage.render(params)

        const toggleDebtBtn = container.querySelector('#toggle-debt-btn')
        const toggleInstallmentBtn = container.querySelector('#toggle-installment-btn')
        const installmentPanel = container.querySelector('#installment-panel')

        expect(toggleDebtBtn).toBeNull()
        expect(toggleInstallmentBtn).not.toBeNull()
        expect(installmentPanel.classList.contains('hidden')).toBe(true)

        expect(() => {
            toggleInstallmentBtn.click()
        }).not.toThrow()

        expect(installmentPanel.classList.contains('hidden')).toBe(false)
    })

    it('只開啟群組功能時（欠款與分期關閉），點擊群組按鈕能正常開啟群組面板且不拋錯', async () => {
        app.dataService.getSetting.mockImplementation(async key => {
            if (key === 'debtManagementEnabled') return { value: false }
            if (key === 'groupManagementEnabled') return { value: true }
            if (key === 'amortizationEnabled') return { value: false }
            if (key === 'calculatorModeEnabled') return { value: true }
            return null
        })

        const params = new URLSearchParams()
        await addPage.render(params)

        const toggleGroupBtn = container.querySelector('#toggle-group-btn')
        const groupPanel = container.querySelector('#group-panel')

        expect(toggleGroupBtn).not.toBeNull()
        expect(groupPanel.classList.contains('hidden')).toBe(true)

        expect(() => {
            toggleGroupBtn.click()
        }).not.toThrow()

        expect(groupPanel.classList.contains('hidden')).toBe(false)
    })

    it('欠款與分期同時開啟時，點擊欠款按鈕能正確互斥收合分期面板', async () => {
        app.dataService.getSetting.mockImplementation(async key => {
            if (key === 'debtManagementEnabled') return { value: true }
            if (key === 'groupManagementEnabled') return { value: false }
            if (key === 'amortizationEnabled') return { value: true }
            if (key === 'calculatorModeEnabled') return { value: true }
            return null
        })

        const params = new URLSearchParams()
        await addPage.render(params)

        const toggleDebtBtn = container.querySelector('#toggle-debt-btn')
        const toggleInstallmentBtn = container.querySelector('#toggle-installment-btn')
        const debtPanel = container.querySelector('#debt-panel')
        const installmentPanel = container.querySelector('#installment-panel')

        // 先開啟分期面板
        toggleInstallmentBtn.click()
        expect(installmentPanel.classList.contains('hidden')).toBe(false)

        // 點擊欠款按鈕：分期面板應自動關閉，欠款面板應開啟
        toggleDebtBtn.click()
        expect(installmentPanel.classList.contains('hidden')).toBe(true)
        expect(debtPanel.classList.contains('hidden')).toBe(false)

        // 再點擊分期按鈕：欠款面板應自動關閉，分期面板應開啟
        toggleInstallmentBtn.click()
        expect(debtPanel.classList.contains('hidden')).toBe(true)
        expect(installmentPanel.classList.contains('hidden')).toBe(false)
    })
})

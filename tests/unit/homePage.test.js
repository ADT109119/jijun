import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HomePage } from '../../src/js/pages/homePage.js'

describe('HomePage - loadGroupBalance Widget', () => {
    let app, homePage, container, groupBalanceContainer

    beforeEach(() => {
        container = document.createElement('div')
        document.body.innerHTML = ''
        document.body.appendChild(container)

        groupBalanceContainer = document.createElement('div')
        groupBalanceContainer.id = 'group-balance-container'
        container.appendChild(groupBalanceContainer)

        app = {
            appContainer: container,
            dataService: {
                getSetting: vi.fn(),
                getGroups: vi.fn(),
            },
            ledgerManager: {
                getActiveLedger: vi.fn().mockReturnValue({ id: 1, name: '預設' }),
                getAllLedgers: vi.fn().mockReturnValue([{ id: 1 }]),
            },
        }

        homePage = new HomePage(app)
    })

    it('功能開關皆關閉時，清空容器不顯示任何群組', async () => {
        app.dataService.getSetting.mockImplementation(async key => {
            if (key === 'debtManagementEnabled') return { value: false }
            if (key === 'groupManagementEnabled') return { value: false }
            return null
        })

        await homePage.loadGroupBalance()
        expect(groupBalanceContainer.innerHTML).toBe('')
    })

    it('無任何未結清群組時，清空容器', async () => {
        app.dataService.getSetting.mockResolvedValue({ value: true })
        app.dataService.getGroups.mockResolvedValue([
            { id: 'g1', name: '已結清群組', settled: true, netAmount: 0 },
        ])

        await homePage.loadGroupBalance()
        expect(groupBalanceContainer.innerHTML).toBe('')
    })

    it('只有 1 個未結清群組時，正常顯示總覽橫幅與該群組明細卡片', async () => {
        app.dataService.getSetting.mockResolvedValue({ value: true })
        app.dataService.getGroups.mockResolvedValue([
            {
                id: 'g-one',
                name: '出差專案',
                settled: false,
                netAmount: -2500,
                recordCount: 3,
                dateFrom: '2026-08-10',
                dateTo: '2026-08-12',
            },
        ])

        await homePage.loadGroupBalance()
        expect(groupBalanceContainer.innerHTML).not.toBe('')
        expect(groupBalanceContainer.textContent).toContain('出差專案')
        expect(groupBalanceContainer.textContent).toContain('3筆')
        expect(groupBalanceContainer.textContent).toContain('2026-08-10 ~ 2026-08-12')
        expect(groupBalanceContainer.textContent).toContain('$2,500')
        expect(groupBalanceContainer.textContent).toContain('1 筆 · 點擊管理')
    })

    it('超過 5 個未結清群組時，最多切片展示前 5 筆', async () => {
        app.dataService.getSetting.mockResolvedValue({ value: true })
        const mockGroups = Array.from({ length: 8 }, (_, i) => ({
            id: `g-${i + 1}`,
            name: `測試群組 ${i + 1}`,
            settled: false,
            netAmount: (i + 1) * 100,
            recordCount: 2,
            dateFrom: '2026-08-01',
            dateTo: '2026-08-05',
        }))
        app.dataService.getGroups.mockResolvedValue(mockGroups)

        await homePage.loadGroupBalance()
        expect(groupBalanceContainer.textContent).toContain('8 筆 · 點擊管理')
        // 前 5 筆有出現
        expect(groupBalanceContainer.textContent).toContain('測試群組 1')
        expect(groupBalanceContainer.textContent).toContain('測試群組 5')
        // 第 6 筆被 slice(0, 5) 排除
        expect(groupBalanceContainer.textContent).not.toContain('測試群組 6')
    })

    it('對含有特殊字元的群組名稱進行 XSS escapeHTML 防護', async () => {
        app.dataService.getSetting.mockResolvedValue({ value: true })
        app.dataService.getGroups.mockResolvedValue([
            {
                id: 'g-xss',
                name: '<img src=x onerror=alert(1)>惡意群組',
                settled: false,
                netAmount: 500,
                recordCount: 1,
            },
        ])

        await homePage.loadGroupBalance()
        expect(groupBalanceContainer.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;惡意群組')
        expect(groupBalanceContainer.innerHTML).not.toContain('<img src=x')
    })
})

import { describe, it, expect, vi } from 'vitest'

// Mock utils before importing CalendarCashFlow
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        formatCurrency: vi.fn((amount) => `$${amount.toLocaleString()}`),
        escapeHTML: vi.fn((str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')),
        formatDateToString: vi.fn((d) => {
            if (typeof d === 'string') return d
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            return `${y}-${m}-${day}`
        }),
    }
})

import { CalendarCashFlow } from '../../src/js/calendarCashFlow.js'

describe('CalendarCashFlow 單元測試', () => {
    const mockDataService = {
        getRecords: vi.fn().mockResolvedValue([
            { date: '2026-07-05', type: 'expense', amount: 150, category: '餐飲', description: '午餐' },
            { date: '2026-07-05', type: 'income', amount: 30000, category: '薪資', description: '7月薪水' },
            { date: '2026-07-15', type: 'expense', amount: 890, category: '購物', description: '網購' },
        ])
    }

    const mockCategoryManager = {
        getCategoryIcon: vi.fn(cat => {
            if (cat === '餐飲') return '☕'
            if (cat === '薪資') return '💰'
            if (cat === '購物') return '🛒'
            return '💰'
        })
    }

    it('1. groupByDate 正確群組', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const records = [
            { date: '2026-07-05', type: 'expense', amount: 100 },
            { date: '2026-07-05', type: 'income', amount: 500 },
            { date: '2026-07-10', type: 'expense', amount: 200 }
        ]

        const grouped = cal.groupByDate(records)
        expect(grouped['2026-07-05']).toHaveLength(2)
        expect(grouped['2026-07-10']).toHaveLength(1)
        expect(grouped['2026-07-15']).toBeUndefined()
    })

    it('2. getFirstDayOfMonth 邊界（2 月閏年、大小月）', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        // 2024-02-01 is Thursday (=4)
        expect(cal.getFirstDayOfMonth(2024, 2)).toBe(4)
        // 2026-07-01 is Wednesday (=3)
        expect(cal.getFirstDayOfMonth(2026, 7)).toBe(3)
    })

    it('3. getDaysInMonth 正確', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        expect(cal.getDaysInMonth(2024, 2)).toBe(29) // Leap year
        expect(cal.getDaysInMonth(2025, 2)).toBe(28) // Normal year
        expect(cal.getDaysInMonth(2026, 7)).toBe(31) // July
        expect(cal.getDaysInMonth(2026, 4)).toBe(30) // April
    })

    it('4. 格子渲染 XSS 防護（分類名含 <script>）', () => {
        const container = document.createElement('div')
        // Manually create the modal container since we're not calling render()
        const modalContainer = document.createElement('div')
        modalContainer.id = 'cal-modal-container'
        container.appendChild(modalContainer)

        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const unsafeRecords = [
            { date: '2026-07-01', type: 'expense', amount: 100, category: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' }
        ]

        cal.showDayDetails('2026-07-01', unsafeRecords)
        const html = container.querySelector('#cal-modal-container').innerHTML

        // Raw HTML tags should NOT appear (XSS blocked)
        expect(html).not.toContain('<script>alert(1)</script>')
        expect(html).not.toContain('<img src=x')
        // Escaped version SHOULD appear
        expect(html).toContain('&lt;script&gt;')
    })

    it('5. 月份切換跨年（12→1、1→12）', async () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        cal.currentDate = new Date(2026, 11, 15) // Dec 2026
        await cal.changeMonth(1)
        expect(cal.currentDate.getFullYear()).toBe(2027)
        expect(cal.currentDate.getMonth()).toBe(0) // January

        await cal.changeMonth(-1)
        expect(cal.currentDate.getFullYear()).toBe(2026)
        expect(cal.currentDate.getMonth()).toBe(11) // December
    })

    it('7. groupByDate 忽略無 date 的紀錄', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const records = [
            { date: '2026-07-05', type: 'expense', amount: 100 },
            { type: 'expense', amount: 200 }, // no date
            { date: null, type: 'expense', amount: 300 },
        ]

        const grouped = cal.groupByDate(records)
        expect(Object.keys(grouped)).toHaveLength(1)
        expect(grouped['2026-07-05']).toHaveLength(1)
    })

    it('8. _formatShort 小數（<10000）', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        expect(cal._formatShort(150)).toBe('150')
        expect(cal._formatShort(9999)).toBe('9999')
        expect(cal._formatShort(0)).toBe('0')
        expect(cal._formatShort(-1)).toBe('0')
    })

    it('9. _formatShort 大數（≥10000）', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        expect(cal._formatShort(10000)).toBe('10k')
        expect(cal._formatShort(15000)).toBe('15k')
        expect(cal._formatShort(15500)).toBe('15.5k')
        expect(cal._formatShort(99999)).toBe('100k')
    })

    it('10. _formatShort NaN / undefined', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        expect(cal._formatShort(NaN)).toBe('0')
        expect(cal._formatShort(Infinity)).toBe('0')
        expect(cal._formatShort(undefined)).toBe('0')
    })

    it('11. _formatAmount 格式化', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        // formatCurrency returns currency string, _formatAmount strips prefix
        expect(cal._formatAmount(100)).toBeTruthy()
        expect(typeof cal._formatAmount(100)).toBe('string')
    })

    it('12. renderCell — 今日高亮', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const html = cal.renderCell(2026, 7, 30, [], '2026-07-30')
        expect(html).toContain('border-wabi-accent')
        expect(html).toContain('bg-wabi-accent/5')
    })

    it('13. renderCell — 非今日', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const html = cal.renderCell(2026, 7, 15, [], '2026-07-30')
        expect(html).not.toContain('border-wabi-accent')
        expect(html).toContain('hover:bg-wabi-bg/60')
    })

    it('14. renderCell — 有支出紀錄顯示 bars', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const records = [
            { type: 'expense', amount: 150, category: 'food' },
            { type: 'expense', amount: 5000, category: 'shopping' },
        ]
        const html = cal.renderCell(2026, 7, 15, records, '2026-07-30')
        expect(html).toContain('$150')
        expect(html).toContain('$5000')
    })

    it('15. renderCell — 只有收入時顯示收入指示', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const records = [
            { type: 'income', amount: 30000, category: 'salary' },
        ]
        const html = cal.renderCell(2026, 7, 1, records, '2026-07-30')
        expect(html).toContain('💰 收入')
        expect(html).toContain('+$30k')
    })

    it('16. renderCell — 空日顯示占位', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const html = cal.renderCell(2026, 7, 20, [], '2026-07-30')
        expect(html).toContain('h-[3px]')
    })

    it('17. _buildRecordHTML — 一般支出', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const r = { type: 'expense', amount: 150, category: 'food', description: '午餐' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('-')
        expect(html).toContain('午餐')
    })

    it('18. _buildRecordHTML — 收入', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const r = { type: 'income', amount: 30000, category: 'salary' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('+')
    })

    it('19. _buildRecordHTML — 轉帳特殊顯示', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const r = { type: 'expense', amount: 5000, category: 'transfer' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('帳戶間轉帳')
    })

    it('20. _buildRecordHTML — 帳務差額特殊顯示', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        const r = { type: 'expense', amount: 100, category: 'balance_adjustment' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('帳務差額')
    })

    it('21. _buildRecordHTML — 分類 XSS 防護', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        // Mock categoryManager returning unsafe color/icon
        const maliciousCm = {
            getCategoryById: () => ({
                name: '<script>alert(1)</script>',
                color: 'bg-red-500"><img src=x onerror=alert(1)>',
                icon: 'fa-question"><img src=x>',
            }),
        }
        cal.categoryManager = maliciousCm
        // Also update the cached reference
        cal._getCategory = maliciousCm.getCategoryById.bind(maliciousCm)

        const r = { type: 'expense', amount: 100, category: 'food' }
        const html = cal._buildRecordHTML(r)
        expect(html).not.toContain('<script>')
        expect(html).not.toContain('<img')
        expect(html).toContain('&lt;script&gt;')
    })

    it('22. _buildRecordHTML — 欠款 badge（已清償）', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)
        cal.debtsMap = { 'd1': { settled: true } }

        const r = { type: 'expense', amount: 100, category: 'food', debtId: 'd1' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('已清償')
    })

    it('23. _buildRecordHTML — 欠款 badge（未清償）', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)
        cal.debtsMap = { 'd1': { settled: false } }

        const r = { type: 'expense', amount: 100, category: 'food', debtId: 'd1' }
        const html = cal._buildRecordHTML(r)
        expect(html).toContain('未還款')
    })

    it('24. destroy 清理事件監聽器', () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        // Set up handlers
        cal._prevHandler = () => {}
        cal._nextHandler = () => {}
        cal._cellHandler = () => {}
        cal._todayHandler = () => {}

        cal.destroy()

        expect(cal._prevHandler).toBeNull()
        expect(cal._nextHandler).toBeNull()
        expect(cal._cellHandler).toBeNull()
        expect(cal._todayHandler).toBeNull()
        expect(cal._grouped).toBeNull()
        expect(cal.debtsMap).toEqual({})
    })

    it('25. showDayDetails — 空紀錄顯示提示', () => {
        const container = document.createElement('div')
        const modalContainer = document.createElement('div')
        modalContainer.id = 'cal-modal-container'
        container.appendChild(modalContainer)

        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)
        cal.showDayDetails('2026-07-01', [])

        const html = modalContainer.innerHTML
        expect(html).toContain('當日無記帳紀錄')
    })

    it('26. showDayDetails — 有紀錄顯示清單', () => {
        const container = document.createElement('div')
        const modalContainer = document.createElement('div')
        modalContainer.id = 'cal-modal-container'
        container.appendChild(modalContainer)

        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)
        const records = [
            { type: 'expense', amount: 100, category: 'food', description: '午餐' },
        ]
        cal.showDayDetails('2026-07-01', records)

        const html = modalContainer.innerHTML
        expect(html).toContain('午餐')
        expect(html).toContain('當日淨收支')
    })

    it('27. showDayDetails — 淨收支正/負', () => {
        const container = document.createElement('div')
        const modalContainer = document.createElement('div')
        modalContainer.id = 'cal-modal-container'
        container.appendChild(modalContainer)

        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        // Net positive
        cal.showDayDetails('2026-07-01', [
            { type: 'income', amount: 500 },
            { type: 'expense', amount: 200 },
        ])
        expect(modalContainer.innerHTML).toContain('+')
        modalContainer.innerHTML = ''

        // Net negative
        cal.showDayDetails('2026-07-01', [
            { type: 'income', amount: 100 },
            { type: 'expense', amount: 500 },
        ])
        expect(modalContainer.innerHTML).toContain('-')
    })

    it('28. setupEventListeners 綁定按鈕', async () => {
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(mockDataService, mockCategoryManager, container)

        await cal.render()

        const prevBtn = container.querySelector('#cal-prev-btn')
        const nextBtn = container.querySelector('#cal-next-btn')
        const todayBtn = container.querySelector('#cal-today-btn')

        expect(prevBtn).not.toBeNull()
        expect(nextBtn).not.toBeNull()
        expect(todayBtn).not.toBeNull()
    })

    it('29. render 過濾 debt 類型的紀錄', async () => {
        const debtDataService = {
            getRecords: vi.fn().mockResolvedValue([
                { date: '2026-07-05', type: 'expense', amount: 100, category: 'food' },
                { date: '2026-07-05', type: 'expense', amount: 5000, category: 'debt_repayment' },
                { date: '2026-07-05', type: 'income', amount: 3000, category: 'debt_collection' },
                { date: '2026-07-05', type: 'expense', amount: 50, category: 'balance_adjustment' },
            ]),
            getDebts: vi.fn().mockResolvedValue([]),
        }
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(debtDataService, mockCategoryManager, container)

        await cal.render()

        // Only the food record should be in cal.records
        expect(cal.records).toHaveLength(1)
        expect(cal.records[0].category).toBe('food')
    })
})

// ==================== 信用卡繳款/出帳日圓點標記 ====================

describe('CalendarCashFlow 繳款圓點標記', () => {
    const catMgr = { getCategoryById: vi.fn(() => null) }

    function makeCalWithCards(accounts, opts = {}) {
        const ds = {
            getRecords: vi.fn().mockResolvedValue([]),
            getDebts: vi.fn().mockResolvedValue([]),
            getAccounts: vi.fn(async () => accounts),
            getSetting: vi.fn(async key => {
                if (key === 'advancedAccountModeEnabled') {
                    return opts.advanced === false ? null : { key, value: true }
                }
                if (key === 'calendarBillDotsEnabled' && opts.dotsOff) {
                    return { key, value: false }
                }
                return null
            }),
        }
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(ds, catMgr, container)
        return { cal, container, ds }
    }

    it('多帳戶模式關閉時不產生任何圓點', async () => {
        const { cal } = makeCalWithCards(
            [{ type: 'credit_card', name: '台新卡', dueDay: 15, statementDay: 25 }],
            { advanced: false }
        )
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap).toEqual({})
    })

    it('設定 calendarBillDotsEnabled=false 時停用圓點', async () => {
        const { cal } = makeCalWithCards(
            [{ type: 'credit_card', name: '台新卡', dueDay: 15, statementDay: 25 }],
            { dotsOff: true }
        )
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap).toEqual({})
    })

    it('信用卡 dueDay/statementDay 落入正確日期', async () => {
        const { cal } = makeCalWithCards([
            { type: 'credit_card', name: '台新卡', dueDay: 15, statementDay: 25 },
        ])
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap['2026-09-15'].due).toEqual(['台新卡'])
        expect(cal._dueDateMap['2026-09-15'].statement).toEqual([])
        expect(cal._dueDateMap['2026-09-25'].statement).toEqual(['台新卡'])
        expect(cal._dueDateMap['2026-09-25'].due).toEqual([])
    })

    it('繳款日與出帳日同天時同一筆 entry 同時有兩種圓點', async () => {
        const { cal } = makeCalWithCards([
            { type: 'credit_card', name: '台新卡', dueDay: 10, statementDay: 10 },
        ])
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap['2026-09-10']).toEqual({
            due: ['台新卡'],
            statement: ['台新卡'],
        })
    })

    it('月底越界收斂：2 月遇 31 日改標示月底 (28 日)', async () => {
        const { cal } = makeCalWithCards([
            { type: 'credit_card', name: '三張卡', dueDay: 31, statementDay: 31 },
        ])
        await cal.loadBillMarkers(2026, 2)
        expect(cal._dueDateMap['2026-02-28'].due).toEqual(['三張卡'])
        expect(cal._dueDateMap['2026-02-28'].statement).toEqual(['三張卡'])
        expect(cal._dueDateMap['2026-02-31']).toBeUndefined()
    })

    it('非信用卡帳戶與非法日期值被忽略', async () => {
        const { cal } = makeCalWithCards([
            { type: 'wallet', name: '現金', dueDay: 5, statementDay: 5 },
            { type: 'credit_card', name: '壞卡', dueDay: 0, statementDay: 32 },
            { type: 'credit_card', name: '壞卡2', dueDay: 'abc', statementDay: null },
            null,
        ])
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap).toEqual({})
    })

    it('多卡同日圓點合併卡名', async () => {
        const { cal } = makeCalWithCards([
            { type: 'credit_card', name: 'A卡', dueDay: 15 },
            { type: 'credit_card', name: 'B卡', dueDay: 15 },
        ])
        await cal.loadBillMarkers(2026, 9)
        expect(cal._dueDateMap['2026-09-15'].due).toEqual(['A卡', 'B卡'])
    })

    it('getAccounts 拋錯時降級為無圓點（不崩潰）', async () => {
        const container = document.createElement('div')
        const ds = {
            getRecords: vi.fn().mockResolvedValue([]),
            getAccounts: vi.fn(async () => {
                throw new Error('db down')
            }),
            getSetting: vi.fn(async () => ({ value: true })),
        }
        const cal = new CalendarCashFlow(ds, catMgr, container)
        await expect(cal.loadBillMarkers(2026, 9)).resolves.toBeUndefined()
        expect(cal._dueDateMap).toEqual({})
    })

    it('renderCell 依 _dueDateMap 渲染紅/藍圓點與 title', () => {
        const { cal } = makeCalWithCards([])
        cal._dueDateMap = {
            '2026-09-15': { due: ['台新卡'], statement: ['台新卡', '兆豐卡'] },
        }
        const html = cal.renderCell(2026, 9, 15, [], '2026-09-30')
        expect(html).toContain('bg-red-500')
        expect(html).toContain('bg-sky-500')
        expect(html).toContain('繳款日：台新卡')
        expect(html).toContain('出帳日：台新卡、兆豐卡')
    })

    it('renderCell 無標記日期不出現圓點', () => {
        const { cal } = makeCalWithCards([])
        cal._dueDateMap = { '2026-09-15': { due: ['台新卡'], statement: [] } }
        const html = cal.renderCell(2026, 9, 16, [], '2026-09-30')
        expect(html).not.toContain('bg-red-500')
        expect(html).not.toContain('bg-sky-500')
    })

    it('圓點 title 卡名 XSS 防護：注入 <script> 被 escapeHTML', () => {
        const { cal } = makeCalWithCards([])
        cal._dueDateMap = {
            '2026-09-15': { due: ['<script>alert(1)</script>'], statement: [] },
        }
        const html = cal.renderCell(2026, 9, 15, [], '2026-09-30')
        expect(html).not.toContain('<script>alert(1)</script>')
        expect(html).toContain('&lt;script&gt;')
    })

    it('render() 有圓點時顯示圖例列（繳款日/出帳日）', async () => {
        const { cal, container } = makeCalWithCards([
            { type: 'credit_card', name: '台新卡', dueDay: 15, statementDay: 25 },
        ])
        cal.currentDate = new Date(2026, 8, 10) // 2026-09
        await cal.render()
        expect(container.innerHTML).toContain('繳款日')
        expect(container.innerHTML).toContain('出帳日')
        expect(container.innerHTML).toContain('bg-red-500')
    })

    it('render() 無圓點（無信用卡）時不顯示圖例列', async () => {
        const { cal, container } = makeCalWithCards([])
        cal.currentDate = new Date(2026, 8, 10)
        await cal.render()
        expect(container.innerHTML).not.toContain('bg-red-500')
    })

    it('destroy() 清空 _dueDateMap', () => {
        const { cal } = makeCalWithCards([])
        cal._dueDateMap = { '2026-09-15': { due: ['台新卡'], statement: [] } }
        cal.destroy()
        expect(cal._dueDateMap).toEqual({})
    })
})

import { describe, it, expect, vi } from 'vitest'
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

    it('6. 空月（無交易）渲染正確', async () => {
        const emptyDataService = {
            getRecords: vi.fn().mockResolvedValue([])
        }
        const container = document.createElement('div')
        const cal = new CalendarCashFlow(emptyDataService, mockCategoryManager, container)

        await cal.render()
        expect(container.innerHTML).toContain('2026 年')
        // New compact summary bar (Google Calendar style)
        expect(container.innerHTML).toContain('收入')
        expect(container.innerHTML).toContain('支出')
        expect(container.innerHTML).toContain('結餘')
        // Verify calendar grid structure
        expect(container.innerHTML).toContain('calendar-cell')
        expect(container.innerHTML).toContain('calendar-cell')
    })
})

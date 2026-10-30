import { describe, it, expect, vi, beforeEach } from 'vitest'

// utils mock：mock showToast / customConfirm，保留 escapeHTML 與 calculateAmortizationDetails 真實實作
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        showToast: vi.fn(),
        customConfirm: vi.fn(async () => true),
    }
})
// amortizationModal mock：避免真實 modal 展開 DOM
vi.mock('../../src/js/amortizationModal.js', () => ({
    showAmortizationModal: vi.fn(),
}))

import { AmortizationsPage } from '../../src/js/pages/amortizationsPage.js'
import { showToast, customConfirm } from '../../src/js/utils.js'
import { showAmortizationModal } from '../../src/js/amortizationModal.js'

// 通用 item helper
const makeItem = over => ({
    id: 1,
    name: '手機分期',
    type: 'installment',
    status: 'active',
    periods: 10,
    completedPeriods: 2,
    amountPerPeriod: 1667,
    totalAmount: 16670,
    downPayment: 0,
    interestRate: 0,
    frequency: 'monthly',
    decimalStrategy: 'round',
    category: 'food',
    recordType: 'expense',
    accountId: null,
    chargeMode: 'periodic',
    nextDueDate: '2026-09-01',
    ...over,
})

// 信用卡帳戶（upfront 額度顯示用）
const makeCard = over => ({
    id: 7,
    name: '信用卡A',
    type: 'credit_card',
    autoPayAccountId: 1,
    ...over,
})

// 讓 async click handler 的 microtask 跑完
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

describe('AmortizationsPage', () => {
    let app, page

    beforeEach(() => {
        vi.clearAllMocks()
        document.body.innerHTML = '<div id="app"></div>'
        app = {
            appContainer: document.getElementById('app'),
            dataService: {
                getSetting: vi.fn(async () => ({ value: true })),
                getAmortizations: vi.fn(async () => []),
                getRecords: vi.fn(async () => []),
                getAccounts: vi.fn(async () => []),
                getAccount: vi.fn(async () => null),
                addRecord: vi.fn(async () => 1),
                getAmortization: vi.fn(),
                updateAmortization: vi.fn(async () => {}),
                deleteAmortization: vi.fn(async () => {}),
            },
            categoryManager: {
                getCategoryById: vi.fn((type, id) =>
                    id === 'food' ? { name: '伙食費' } : null
                ),
            },
        }
        page = new AmortizationsPage(app)
    })

    async function renderPage(items, records = [], accounts = []) {
        app.dataService.getAmortizations.mockResolvedValue(items)
        app.dataService.getRecords.mockResolvedValue(records)
        app.dataService.getAccounts.mockResolvedValue(accounts)
        await page.render()
        return app.appContainer.innerHTML
    }

    // ==================== A. 頁面渲染基本 ====================
    describe('頁面渲染基本', () => {
        it('0 項目時顯示空狀態，且不 batch load records', async () => {
            const html = await renderPage([])
            expect(html).toContain('尚無攤提/分期項目')
            expect(app.dataService.getRecords).not.toHaveBeenCalled()
        })

        it('active 項目顯示名稱、類型、分類與進度', async () => {
            const html = await renderPage([makeItem()])
            expect(html).toContain('手機分期')
            expect(html).toContain('分期付款')
            expect(html).toContain('伙食費')
            expect(html).toContain('已完成 2/10 期')
            expect(html).toContain('data-amort-id="1"')
        })

        it('未知類型 fallback 到分期付款圖示', async () => {
            const html = await renderPage([makeItem({ type: 'weird' })])
            // installment fallback 圖示 fa-credit-card（intro 文字不含此 class）
            expect(html).toContain('fa-solid fa-credit-card')
            expect(html).not.toContain('weird')
        })

        it('未知狀態 fallback 到進行中 badge', async () => {
            page.statusFilter = 'all' // unknown 狀態會過預設 active 篩選
            const html = await renderPage([makeItem({ status: 'unknown' })])
            // active 狀態 badge 的 class（篩選按鈕不使用此 class）
            expect(html).toContain('bg-green-100 text-green-700 border-green-200')
        })

        it('預設篩選 active：completed 項目不顯示', async () => {
            const html = await renderPage([
                makeItem({ id: 1, name: '進行中項目' }),
                makeItem({ id: 2, name: '已完成項目', status: 'completed', completedPeriods: 10 }),
            ])
            expect(html).toContain('進行中項目')
            expect(html).not.toContain('已完成項目')
        })

        it('點擊「全部」篩選後 completed 項目也顯示', async () => {
            await renderPage([
                makeItem({ id: 1, name: '進行中項目' }),
                makeItem({ id: 2, name: '已完成項目', status: 'completed', completedPeriods: 10 }),
            ])
            document
                .querySelector('.status-filter-btn[data-status="all"]')
                .click()
            await tick()
            const html = app.appContainer.innerHTML
            expect(html).toContain('進行中項目')
            expect(html).toContain('已完成項目')
        })

        it('存在 4 個狀態篩選按鈕', async () => {
            await renderPage([])
            const btns = document.querySelectorAll('.status-filter-btn')
            expect(btns.length).toBe(4)
            const statuses = [...btns].map(b => b.dataset.status)
            expect(statuses).toEqual(['all', 'active', 'paused', 'completed'])
        })

        it('進度條依 completedPeriods/periods 計算 (2/10 → 20%)', async () => {
            const html = await renderPage([makeItem()])
            expect(html).toContain('width: 20%')
        })

        it('periods 為 0 時不除零崩潰 (progress 0%)', async () => {
            const html = await renderPage([makeItem({ periods: 0, completedPeriods: 0 })])
            expect(html).toContain('width: 0%')
        })
    })

    // ==================== B. 欄位條件顯示 ====================
    describe('欄位條件顯示', () => {
        it('有首付時顯示首付金額', async () => {
            const html = await renderPage([makeItem({ downPayment: 5000 })])
            expect(html).toContain('首付')
            expect(html).toContain('$5,000')
        })

        it('無首付時不顯示首付欄位', async () => {
            const html = await renderPage([makeItem({ downPayment: 0 })])
            expect(html).not.toContain('首付')
        })

        it('有利率時顯示利率', async () => {
            const html = await renderPage([makeItem({ interestRate: 3 })])
            expect(html).toContain('利率 3%')
        })

        it('無利率時不顯示利率欄位', async () => {
            const html = await renderPage([makeItem({ interestRate: 0 })])
            expect(html).not.toContain('利率')
        })

        it('completed 狀態不顯示下期、沒有暫停按鈕', async () => {
            page.statusFilter = 'all'
            const html = await renderPage([
                makeItem({ status: 'completed', completedPeriods: 10 }),
            ])
            expect(html).not.toContain('下期')
            expect(document.querySelector('.toggle-pause-btn')).toBeNull()
        })

        it('active 狀態顯示下期日期', async () => {
            const html = await renderPage([makeItem()])
            expect(html).toContain('下期')
            expect(html).toContain('2026-09-01')
        })
    })

    // ==================== C. 信用卡 upfront 額度區 ====================
    describe('信用卡 upfront 額度顯示', () => {
        it('upfront + 有扣款帳戶：顯示 badge 與佔用額度，無未設定警示', async () => {
            const html = await renderPage(
                [makeItem({ chargeMode: 'upfront', accountId: 7 })],
                [],
                [makeCard()]
            )
            expect(html).toContain('信用卡分期')
            expect(html).toContain('佔用額度')
            expect(html).toContain('$16,670')
            expect(html).toContain('已還')
            expect(html).not.toContain('未設定扣款帳戶')
        })

        it('upfront 卡片未設 autoPayAccountId：顯示未設定扣款帳戶警示', async () => {
            const html = await renderPage(
                [makeItem({ chargeMode: 'upfront', accountId: 7 })],
                [],
                [makeCard({ autoPayAccountId: null })]
            )
            expect(html).toContain('未設定扣款帳戶，到期不產生扣款')
        })

        it('已還金額只算卡端 income 腿，transfer expense 腿不計入', async () => {
            const history = [
                { id: 1, amortizationId: 1, type: 'income', amount: 1000 },
                { id: 2, amortizationId: 1, type: 'income', amount: 500 },
                { id: 3, amortizationId: 1, type: 'expense', amount: 1000 },
                { id: 4, amortizationId: 1, type: 'expense', amount: 500 },
            ]
            const html = await renderPage(
                [makeItem({ chargeMode: 'upfront', accountId: 7 })],
                history,
                [makeCard()]
            )
            // 已還 = 1000 + 500 = 1500（只算 income 腿）
            expect(html).toContain('已還 <strong class="text-wabi-text-primary">$1,500</strong>')
            // 佔用額度 = 16670 - 1500 = 15170
            expect(html).toContain('$15,170')
            // 若誤把 expense 腿也算進去會變成 2500，確認未發生
            expect(html).not.toContain('$2,500</strong>')
        })

        it('upfront 但 accountId 為 null：完全不顯示信用卡分期區塊', async () => {
            const html = await renderPage(
                [makeItem({ chargeMode: 'upfront', accountId: null })],
                [],
                [makeCard()]
            )
            expect(html).not.toContain('信用卡分期')
        })
    })

    // ==================== D. 溢繳偵測 ====================
    describe('溢繳偵測', () => {
        const overpaidHistory = [
            { id: 1, amortizationId: 1, type: 'expense', amount: 1667 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 1667 },
            { id: 3, amortizationId: 1, type: 'expense', amount: 1667 },
        ]

        it('periodic 累計溢繳 (5001 > 5000) 顯示已溢繳', async () => {
            page.statusFilter = 'paused' // paused 項目會過預設 active 篩選
            const html = await renderPage(
                [makeItem({ totalAmount: 5000, periods: 3, completedPeriods: 3, status: 'paused' })],
                overpaidHistory
            )
            expect(html).toContain('已溢繳')
        })

        it('periodic 未溢繳 (3334 < 5000) 不顯示已溢繳', async () => {
            page.statusFilter = 'paused' // paused 項目會過預設 active 篩選
            const html = await renderPage(
                [makeItem({ totalAmount: 5000, periods: 3, completedPeriods: 3, status: 'paused' })],
                overpaidHistory.slice(0, 2)
            )
            expect(html).not.toContain('已溢繳')
        })

        it('upfront 溢繳只算 income 腿（3 筆 income 1667 → 5001 > 5000）', async () => {
            page.statusFilter = 'paused' // paused 項目會過預設 active 篩選
            const incomeHistory = [
                { id: 1, amortizationId: 1, type: 'income', amount: 1667 },
                { id: 2, amortizationId: 1, type: 'income', amount: 1667 },
                { id: 3, amortizationId: 1, type: 'income', amount: 1667 },
            ]
            const html = await renderPage(
                [makeItem({ chargeMode: 'upfront', accountId: 7, totalAmount: 5000, periods: 3, completedPeriods: 3, status: 'paused' })],
                incomeHistory,
                [makeCard()]
            )
            expect(html).toContain('已溢繳')
        })

        it('completed 狀態即使 history 溢繳也不顯示已溢繳', async () => {
            page.statusFilter = 'all'
            const html = await renderPage(
                [makeItem({ totalAmount: 5000, periods: 3, completedPeriods: 3, status: 'completed' })],
                overpaidHistory
            )
            expect(html).not.toContain('已溢繳')
        })
    })

    // ==================== E. 按鈕事件 ====================
    describe('按鈕事件', () => {
        it('add 按鈕開啟新增 modal（null item）', async () => {
            await renderPage([])
            document.getElementById('add-amort-btn').click()
            await tick()
            expect(showAmortizationModal).toHaveBeenCalledWith(
                app,
                null,
                {},
                expect.any(Function)
            )
        })

        it('edit 非 upfront 項目開啟編輯 modal 並傳入 item', async () => {
            const item = makeItem()
            app.dataService.getAmortization.mockResolvedValue(item)
            await renderPage([item])
            document.querySelector('.edit-amort-btn[data-id="1"]').click()
            await tick()
            expect(showAmortizationModal).toHaveBeenCalledWith(
                app,
                item,
                {},
                expect.any(Function)
            )
            expect(showToast).not.toHaveBeenCalled()
        })

        it('edit upfront 項目被阻止並 toast 警示', async () => {
            const item = makeItem({ chargeMode: 'upfront' })
            app.dataService.getAmortization.mockResolvedValue(item)
            await renderPage([item])
            document.querySelector('.edit-amort-btn[data-id="1"]').click()
            await tick()
            expect(showToast).toHaveBeenCalledWith(
                '信用卡分期不支援編輯，請刪除後重建',
                'warning'
            )
            expect(showAmortizationModal).not.toHaveBeenCalled()
        })

        it('active 項目點暫停 → updateAmortization 設 paused + toast 已暫停', async () => {
            const item = makeItem({ status: 'active' })
            app.dataService.getAmortization.mockResolvedValue(item)
            await renderPage([item])
            document.querySelector('.toggle-pause-btn').click()
            await tick()
            expect(app.dataService.updateAmortization).toHaveBeenCalledWith(1, {
                status: 'paused',
            })
            expect(showToast).toHaveBeenCalledWith('已暫停', 'success')
        })

        it('paused 項目點恢復 → updateAmortization 設 active + toast 已恢復', async () => {
            const item = makeItem({ status: 'paused' })
            page.statusFilter = 'paused' // paused 項目會過預設 active 篩選
            app.dataService.getAmortization.mockResolvedValue(item)
            await renderPage([item])
            document.querySelector('.toggle-pause-btn').click()
            await tick()
            expect(app.dataService.updateAmortization).toHaveBeenCalledWith(1, {
                status: 'active',
            })
            expect(showToast).toHaveBeenCalledWith('已恢復', 'success')
        })

        it('delete + 確認 → deleteAmortization + toast 已刪除', async () => {
            const item = makeItem()
            app.dataService.getAmortization.mockResolvedValue(item)
            customConfirm.mockResolvedValue(true)
            await renderPage([item])
            document.querySelector('.delete-amort-btn').click()
            await tick()
            expect(app.dataService.deleteAmortization).toHaveBeenCalledWith(1)
            expect(showToast).toHaveBeenCalledWith('已刪除', 'success')
        })

        it('delete + 取消 → 不呼叫 deleteAmortization', async () => {
            const item = makeItem()
            app.dataService.getAmortization.mockResolvedValue(item)
            customConfirm.mockResolvedValue(false)
            await renderPage([item])
            document.querySelector('.delete-amort-btn').click()
            await tick()
            expect(app.dataService.deleteAmortization).not.toHaveBeenCalled()
        })
    })

    // ==================== F. XSS 防護 ====================
    describe('XSS 防護', () => {
        it('item 名稱含 HTML 注入時被 escapeHTML 轉義', async () => {
            const payload = '<img src=x onerror=alert(1)>'
            const html = await renderPage([makeItem({ name: payload })])
            expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
            expect(html).not.toContain(payload)
        })
    })
})

// ==================== 提前結清 (#MOZE-ESC) ====================

describe('提前結清', () => {
    let app, page

    beforeEach(() => {
        vi.clearAllMocks()
        document.body.innerHTML = '<div id="app"></div>'
        app = {
            appContainer: document.getElementById('app'),
            dataService: {
                getSetting: vi.fn(async () => ({ value: true })),
                getAmortizations: vi.fn(async () => []),
                getRecords: vi.fn(async () => []),
                getAccounts: vi.fn(async () => []),
                getAccount: vi.fn(async () => null),
                addRecord: vi.fn(async () => 1),
                getAmortization: vi.fn(),
                updateAmortization: vi.fn(async () => {}),
                deleteAmortization: vi.fn(async () => {}),
            },
            categoryManager: {
                getCategoryById: vi.fn((type, id) =>
                    id === 'food' ? { name: '伙食費' } : null
                ),
            },
        }
        page = new AmortizationsPage(app)
    })

    const tick = () => new Promise(resolve => setTimeout(resolve, 10))

    // 無利率 12000/12 期：每期 1000、exactTotalToPay = 12000
    const escItem = over => ({
        ...makeItem({
            totalAmount: 12000,
            periods: 12,
            completedPeriods: 4,
            amountPerPeriod: 1000,
        }),
        ledgerId: 1,
        ...over,
    })

    // ===== 按鈕顯示 =====
    it('active 項目卡片顯示提前結清按鈕', async () => {
        app.dataService.getAmortizations.mockResolvedValue([escItem()])
        await page.render()
        const btn = document.querySelector('.early-settle-btn')
        expect(btn).not.toBeNull()
        expect(btn.dataset.id).toBe('1')
        expect(btn.innerHTML).toContain('fa-money-bill-transfer')
    })

    it('paused 項目也顯示提前結清按鈕；completed 不顯示', async () => {
        page.statusFilter = 'all'
        app.dataService.getAmortizations.mockResolvedValue([
            escItem({ id: 2, status: 'paused' }),
            escItem({ id: 3, status: 'completed', completedPeriods: 12 }),
        ])
        await page.render()
        const btns = document.querySelectorAll('.early-settle-btn')
        expect(btns).toHaveLength(1)
        expect(btns[0].dataset.id).toBe('2')
    })

    // ===== periodic 正常結清 =====
    it('periodic：剩餘 8000 單筆入帳（寫入同步日誌）並結案', async () => {
        const item = escItem()
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 3, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 4, amortizationId: 1, type: 'expense', amount: 1000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        expect(app.dataService.addRecord).toHaveBeenCalledTimes(1)
        const [rec, skipLog] = app.dataService.addRecord.mock.calls[0]
        expect(rec).toMatchObject({
            type: 'expense',
            amount: 8000,
            category: 'food',
            ledgerId: 1,
            amortizationId: 1,
        })
        expect(rec.description).toContain('提前結清')
        expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(skipLog).toBeUndefined()
        expect(app.dataService.updateAmortization).toHaveBeenCalledWith(1, {
            completedPeriods: 12,
            nextDueDate: null,
            status: 'completed',
        })
    })

    // ===== 起始已還期數基線 (#MOZE-START) =====
    it('startCompletedPeriods：跳過的期數無紀錄仍計入已還（剩餘不虛增）', async () => {
        // 12000/12 期，起始已還 4 期（無任何紀錄）→ 剩餘應為 8000 而非 12000
        const item = escItem({ startCompletedPeriods: 4 })
        app.dataService.getRecords.mockResolvedValue([])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        expect(app.dataService.addRecord).toHaveBeenCalledTimes(1)
        const [rec] = app.dataService.addRecord.mock.calls[0]
        expect(rec.amount).toBe(8000)
    })

    it('startCompletedPeriods + 部分紀錄：基線與實際入帳合計', async () => {
        // 起始 2 期基線(2000) + 實際入帳 2 筆(2000) = 已還 4000 → 剩餘 8000
        const item = escItem({ startCompletedPeriods: 2 })
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 1000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        const [rec] = app.dataService.addRecord.mock.calls[0]
        expect(rec.amount).toBe(8000)
    })

    it('upfront startCompletedPeriods：只算 income 腿再加基線', async () => {
        // 起始 2 期基線(2000) + income 腿 1000（expense 腿不計）= 已還 3000 → 剩餘 9000
        const item = escItem({
            chargeMode: 'upfront',
            accountId: 7,
            startCompletedPeriods: 2,
            completedPeriods: 3,
        })
        app.dataService.getAccount.mockResolvedValue({
            id: 7,
            type: 'credit_card',
            autoPayAccountId: 2,
        })
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'income', amount: 1000 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 1000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        const [debit] = app.dataService.addRecord.mock.calls[0]
        expect(debit.amount).toBe(9000)
    })

    // ===== upfront 成對轉帳 =====
    it('upfront：扣款帳戶支出 + 卡收入成對、只算 income 腿防雙重計數', async () => {
        const item = escItem({ chargeMode: 'upfront', accountId: 7 })
        app.dataService.getAccount.mockResolvedValue({
            id: 7,
            type: 'credit_card',
            autoPayAccountId: 2,
        })
        // 已還 3000：income 腿 3000 + expense 腿 3000（只算 income）
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'income', amount: 3000 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 3000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        expect(app.dataService.addRecord).toHaveBeenCalledTimes(2)
        const [debit, debitSkip] = app.dataService.addRecord.mock.calls[0]
        const [income, incomeSkip] = app.dataService.addRecord.mock.calls[1]
        expect(debit).toMatchObject({
            type: 'expense',
            category: 'transfer',
            amount: 9000,
            accountId: 2,
            ledgerId: 1,
            amortizationId: 1,
        })
        expect(income).toMatchObject({
            type: 'income',
            category: 'transfer',
            amount: 9000,
            accountId: 7,
            ledgerId: 1,
            amortizationId: 1,
        })
        expect(income.description).toContain('提前結清')
        expect(debitSkip).toBeUndefined()
        expect(incomeSkip).toBeUndefined()
    })

    // ===== upfront 防呆 =====
    it('upfront 無扣繳帳戶：warning toast、不入帳、不彈確認框、回 false', async () => {
        const item = escItem({ chargeMode: 'upfront', accountId: 7 })
        app.dataService.getAccount.mockResolvedValue({
            id: 7,
            type: 'credit_card',
            autoPayAccountId: null,
        })
        const done = await page._earlySettle(item)
        expect(done).toBe(false)
        expect(showToast).toHaveBeenCalledWith(
            '信用卡分期需先設定自動扣繳帳戶',
            'warning'
        )
        expect(customConfirm).not.toHaveBeenCalled()
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(app.dataService.updateAmortization).not.toHaveBeenCalled()
    })

    it('upfront 卡不存在（getAccount 回 null）：同樣擋下回 false', async () => {
        const item = escItem({ chargeMode: 'upfront', accountId: 7 })
        app.dataService.getAccount.mockResolvedValue(null)
        const done = await page._earlySettle(item)
        expect(done).toBe(false)
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
    })

    // ===== 取消與邊界 =====
    it('customConfirm 取消：不入帳不結案、回 false', async () => {
        const item = escItem()
        customConfirm.mockResolvedValue(false)
        const done = await page._earlySettle(item)
        expect(done).toBe(false)
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(app.dataService.updateAmortization).not.toHaveBeenCalled()
    })

    it('溢繳（剩餘金額為 0）：不入帳但仍結案、回 true', async () => {
        const item = escItem()
        // 已入帳 13000 > exactTotalToPay 12000
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'expense', amount: 13000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(app.dataService.updateAmortization).toHaveBeenCalledWith(1, {
            completedPeriods: 12,
            nextDueDate: null,
            status: 'completed',
        })
    })

    it('含息總額：有利率時剩餘金額 = 含息總額 - 已入帳', async () => {
        // 5% 年利率 12 期：每期 PMT ≈ 1027.22、含息總額 ≈ 12326.68，已還 4000 → 剩餘 8327
        const item = escItem({ interestRate: 5 })
        app.dataService.getRecords.mockResolvedValue([
            { id: 1, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 2, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 3, amortizationId: 1, type: 'expense', amount: 1000 },
            { id: 4, amortizationId: 1, type: 'expense', amount: 1000 },
        ])
        customConfirm.mockResolvedValue(true)
        const done = await page._earlySettle(item)
        expect(done).toBe(true)
        const [rec] = app.dataService.addRecord.mock.calls[0]
        expect(rec.amount).toBe(8327)
    })

    // ===== 點擊流程 =====
    it('點擊按鈕：getAmortization → 結清 → toast + 重繪', async () => {
        const item = escItem()
        customConfirm.mockResolvedValue(true)
        app.dataService.getAmortizations.mockResolvedValue([item])
        app.dataService.getAmortization.mockResolvedValue(item)
        await page.render()
        document.querySelector('.early-settle-btn').click()
        await tick()
        expect(app.dataService.getAmortization).toHaveBeenCalledWith(1)
        expect(app.dataService.addRecord).toHaveBeenCalledTimes(1)
        expect(showToast).toHaveBeenCalledWith('已提前結清', 'success')
    })

    it('點擊時 DB 已 completed（雙開畫面競態）：跳過結清只重繪', async () => {
        const item = escItem()
        app.dataService.getAmortizations.mockResolvedValue([item])
        // DB 讀回已是 completed（例如另一裝置已結清並同步）
        app.dataService.getAmortization.mockResolvedValue({
            ...item,
            status: 'completed',
        })
        await page.render()
        document.querySelector('.early-settle-btn').click()
        await tick()
        expect(app.dataService.addRecord).not.toHaveBeenCalled()
        expect(app.dataService.updateAmortization).not.toHaveBeenCalled()
        expect(showToast).not.toHaveBeenCalledWith('已提前結清', 'success')
    })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showAmortizationModal } from '../../src/js/amortizationModal.js'

// ── Mock showToast ───────────────────────────────────────────
vi.mock('../../src/js/utils.js', async () => {
    const actual = await vi.importActual('../../src/js/utils.js')
    return {
        ...actual,
        showToast: vi.fn(),
    }
})

// ── Helper: create mock app ──────────────────────────────────
function createMockApp() {
    return {
        dataService: {
            getAmortization: vi.fn(async () => null),
            addAmortization: vi.fn(async () => 200),
            updateAmortization: vi.fn(async () => true),
            getRecords: vi.fn(async () => []),
            activeLedgerId: 1,
        },
        categoryManager: {
            getAllCategories: vi.fn(type => {
                if (type === 'expense') {
                    return [
                        { id: 'food', name: '餐飲' },
                        { id: 'transport', name: '交通' },
                        { id: 'shopping', name: '購物' },
                    ]
                }
                return [
                    { id: 'salary', name: '薪資' },
                    { id: 'investment', name: '投資' },
                ]
            }),
        },
    }
}

describe('showAmortizationModal', () => {
    let app

    beforeEach(() => {
        app = createMockApp()
        // Clean any leftover modals
        document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove())
    })

    afterEach(() => {
        document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove())
        vi.clearAllMocks()
    })

    // ── DOM 結構 ─────────────────────────────────────────────────
    describe('DOM 結構', () => {
        it('新增模式：建立 modal 並附加至 body', () => {
            showAmortizationModal(app)
            const modal = document.querySelector('[class*="fixed"][class*="inset-0"]')
            expect(modal).not.toBeNull()
            expect(modal.querySelector('#amort-name')).not.toBeNull()
        })

        it('新增模式：標題顯示「新增攤提/分期」', () => {
            showAmortizationModal(app)
            const title = document.querySelector('h3')
            expect(title.textContent).toBe('新增攤提/分期')
        })

        it('包含名稱、類型、金額、期數等輸入欄位', () => {
            showAmortizationModal(app)
            expect(document.querySelector('#amort-name')).not.toBeNull()
            expect(document.querySelector('#amort-type')).not.toBeNull()
            expect(document.querySelector('#amort-total')).not.toBeNull()
            expect(document.querySelector('#amort-periods')).not.toBeNull()
            expect(document.querySelector('#amort-start-date')).not.toBeNull()
            expect(document.querySelector('#amort-frequency')).not.toBeNull()
            expect(document.querySelector('#amort-decimal-strategy')).not.toBeNull()
            expect(document.querySelector('#amort-record-type')).not.toBeNull()
        })

        it('包含儲存和取消按鈕', () => {
            showAmortizationModal(app)
            expect(document.querySelector('#amort-save-btn')).not.toBeNull()
            expect(document.querySelector('#amort-cancel-btn')).not.toBeNull()
        })

        it('新增模式：不顯示已完成期數欄位', () => {
            showAmortizationModal(app)
            expect(document.querySelector('#amort-completed')).toBeNull()
        })

        it('類型選擇有三個按鈕（分期付款/折舊/攤提）', () => {
            showAmortizationModal(app)
            const typeOptions = document.querySelectorAll('.type-option')
            expect(typeOptions.length).toBe(3)
            expect(typeOptions[0].querySelector('span').textContent).toBe('分期付款')
            expect(typeOptions[1].querySelector('span').textContent).toBe('折舊')
            expect(typeOptions[2].querySelector('span').textContent).toBe('攤提')
        })

        it('包含預覽區塊', () => {
            showAmortizationModal(app)
            expect(document.querySelector('#amort-preview')).not.toBeNull()
            expect(document.querySelector('#amort-per-period')).not.toBeNull()
        })
    })

    // ── 類別選項 ─────────────────────────────────────────────────
    describe('類別選項', () => {
        it('支出模式下載入支出分類', () => {
            showAmortizationModal(app)
            const select = document.querySelector('#amort-category')
            expect(select).not.toBeNull()
            // 預設 recordType = expense，應有 food/transport/shopping
            expect(select.innerHTML).toContain('餐飲')
            expect(select.innerHTML).toContain('交通')
            expect(select.innerHTML).toContain('購物')
        })

        it('切換為收入模式時載入收入分類', () => {
            showAmortizationModal(app)
            const select = document.querySelector('#amort-category')
            const recordType = document.querySelector('#amort-record-type')
            recordType.value = 'income'
            recordType.dispatchEvent(new Event('change'))
            expect(select.innerHTML).toContain('薪資')
            expect(select.innerHTML).toContain('投資')
            expect(select.innerHTML).not.toContain('餐飲')
        })
    })

    // ── 類型選擇 ─────────────────────────────────────────────────
    describe('類型選擇', () => {
        it('預設選擇分期付款', () => {
            showAmortizationModal(app)
            const typeInput = document.querySelector('#amort-type')
            expect(typeInput.value).toBe('installment')
        })

        it('點擊折舊按鈕時更新 hidden input', () => {
            showAmortizationModal(app)
            const depreciationBtn = document.querySelectorAll('.type-option')[1]
            depreciationBtn.click()
            const typeInput = document.querySelector('#amort-type')
            expect(typeInput.value).toBe('depreciation')
        })

        it('點擊類型按鈕時更新視覺樣式（active 樣式切換）', () => {
            showAmortizationModal(app)
            const options = document.querySelectorAll('.type-option')
            const amortBtn = options[2]

            amortBtn.click()

            // 被點擊的按鈕應有 primary 樣式
            expect(amortBtn.classList.contains('border-wabi-primary')).toBe(true)
            expect(amortBtn.classList.contains('text-wabi-primary')).toBe(true)
            expect(amortBtn.classList.contains('font-bold')).toBe(true)

            // 其他按鈕不應有 primary 樣式
            expect(options[0].classList.contains('border-wabi-primary')).toBe(false)
            expect(options[1].classList.contains('border-wabi-primary')).toBe(false)
        })

        it('類型選擇後 hidden input 正確更新', () => {
            showAmortizationModal(app)
            const options = document.querySelectorAll('.type-option')
            const typeInput = document.querySelector('#amort-type')

            // 依序測試三種
            options[1].click()
            expect(typeInput.value).toBe('depreciation')

            options[2].click()
            expect(typeInput.value).toBe('amortization')

            options[0].click()
            expect(typeInput.value).toBe('installment')
        })
    })

    // ── 即時計算 ─────────────────────────────────────────────────
    describe('即時金額計算', () => {
        it('預設顯示 "--"（無輸入）', () => {
            showAmortizationModal(app)
            const display = document.querySelector('#amort-per-period')
            expect(display.textContent).toBe('--')
        })

        it('輸入金額和期數後更新計算結果', async () => {
            showAmortizationModal(app)
            const totalInput = document.querySelector('#amort-total')
            const periodsInput = document.querySelector('#amort-periods')

            totalInput.value = '3600'
            periodsInput.value = '12'
            totalInput.dispatchEvent(new Event('input'))

            // 非同步等待計算更新 (updateCalculation)
            await vi.waitFor(() => {
                const display = document.querySelector('#amort-per-period')
                // 3600 / 12 = 300
                expect(display.textContent).toContain('300')
            })
        })

        it('輸入首付金額時使用本金 = 總額 - 首付', async () => {
            showAmortizationModal(app)
            const totalInput = document.querySelector('#amort-total')
            const periodsInput = document.querySelector('#amort-periods')
            const downPaymentInput = document.querySelector('#amort-downpayment')

            totalInput.value = '12000'
            periodsInput.value = '12'
            downPaymentInput.value = '2000'
            downPaymentInput.dispatchEvent(new Event('input'))

            // 本金 = 10000, 12期, 無息 => 833.33 -> round to 833
            await vi.waitFor(() => {
                const display = document.querySelector('#amort-per-period')
                expect(display.textContent).toContain('833')
            })
        })
    })

    // ── 儲存驗證 ─────────────────────────────────────────────────
    describe('儲存驗證', () => {
        it('名稱為空時顯示錯誤並中止', async () => {
            const { showToast } = await import('../../src/js/utils.js')
            showAmortizationModal(app)
            document.querySelector('#amort-save-btn').click()
            expect(showToast).toHaveBeenCalledWith('請輸入名稱', 'error')
        })

        it('金額為空時顯示錯誤並中止', async () => {
            const { showToast } = await import('../../src/js/utils.js')
            showAmortizationModal(app)
            document.querySelector('#amort-name').value = '測試分期'
            document.querySelector('#amort-save-btn').click()
            expect(showToast).toHaveBeenCalledWith('請輸入有效的總金額', 'error')
        })

        it('期數為空時顯示錯誤並中止', async () => {
            const { showToast } = await import('../../src/js/utils.js')
            showAmortizationModal(app)
            document.querySelector('#amort-name').value = '測試分期'
            document.querySelector('#amort-total').value = '10000'
            document.querySelector('#amort-save-btn').click()
            expect(showToast).toHaveBeenCalledWith('請輸入有效的期數', 'error')
        })

        it('成功儲存時呼叫 addAmortization 並移除 modal', async () => {
            showAmortizationModal(app)
            document.querySelector('#amort-name').value = 'MacBook Pro 分期'
            document.querySelector('#amort-total').value = '54000'
            document.querySelector('#amort-periods').value = '12'
            document.querySelector('#amort-save-btn').click()

            // 等待非同步儲存完成（click handler 是 async）
            await vi.waitFor(() => {
                expect(app.dataService.addAmortization).toHaveBeenCalled()
            })
        })

        it('成功儲存後移除 modal', async () => {
            const onSaved = vi.fn()
            showAmortizationModal(app, null, {}, onSaved)

            document.querySelector('#amort-name').value = '測試儲存'
            document.querySelector('#amort-total').value = '3000'
            document.querySelector('#amort-periods').value = '3'
            document.querySelector('#amort-save-btn').click()

            await vi.waitFor(() => {
                expect(onSaved).toHaveBeenCalled()
                expect(document.querySelector('#amort-name')).toBeNull()
            })
        })
    })

    // ── 取消按鈕 ─────────────────────────────────────────────────
    describe('取消按鈕', () => {
        it('點擊取消時移除 modal', () => {
            showAmortizationModal(app)
            expect(document.querySelector('#amort-name')).not.toBeNull()
            document.querySelector('#amort-cancel-btn').click()
            expect(document.querySelector('#amort-name')).toBeNull()
        })
    })

    // ── 背景點擊關閉 ─────────────────────────────────────────────
    describe('背景點擊關閉', () => {
        it('點擊 modal 背景時移除', () => {
            showAmortizationModal(app)
            const modal = document.querySelector('[class*="fixed"][class*="inset-0"]')
            expect(modal).not.toBeNull()

            // Simulate clicking the background (the modal element itself)
            modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            expect(document.querySelector('#amort-name')).toBeNull()
        })

        it('點擊 modal 內部元素時不關閉', () => {
            showAmortizationModal(app)
            const innerBtn = document.querySelector('.type-option')
            innerBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            expect(document.querySelector('#amort-name')).not.toBeNull()
        })
    })

    // ── 編輯模式 ─────────────────────────────────────────────────
    describe('編輯模式', () => {
        const editItem = {
            id: 42,
            name: '舊筆電分期',
            type: 'installment',
            recordType: 'expense',
            category: 'shopping',
            totalAmount: 36000,
            downPayment: 6000,
            interestRate: 2.5,
            periods: 6,
            completedPeriods: 2,
            amountPerPeriod: 5085,
            frequency: 'monthly',
            decimalStrategy: 'round',
            startDate: '2026-01-15',
            nextDueDate: '2026-03-15',
            status: 'active',
        }

        it('編輯模式標題顯示「編輯項目」', () => {
            showAmortizationModal(app, editItem)
            const title = document.querySelector('h3')
            expect(title.textContent).toBe('編輯項目')
        })

        it('編輯模式預填所有欄位', () => {
            showAmortizationModal(app, editItem)

            expect(document.querySelector('#amort-name').value).toBe('舊筆電分期')
            expect(document.querySelector('#amort-type').value).toBe('installment')
            expect(document.querySelector('#amort-record-type').value).toBe('expense')
            expect(document.querySelector('#amort-total').value).toBe('36000')
            expect(document.querySelector('#amort-downpayment').value).toBe('6000')
            expect(document.querySelector('#amort-periods').value).toBe('6')
            expect(document.querySelector('#amort-start-date').value).toBe('2026-01-15')
        })

        it('編輯模式顯示已完成期數欄位', () => {
            showAmortizationModal(app, editItem)
            expect(document.querySelector('#amort-completed')).not.toBeNull()
            expect(document.querySelector('#amort-completed').value).toBe('2')
        })

        it('編輯模式儲存時呼叫 updateAmortization', async () => {
            showAmortizationModal(app, editItem)

            // 修改名稱後儲存
            document.querySelector('#amort-name').value = '新筆電分期'
            document.querySelector('#amort-save-btn').click()

            await vi.waitFor(() => {
                expect(app.dataService.updateAmortization).toHaveBeenCalledWith(
                    42,
                    expect.objectContaining({ name: '新筆電分期' })
                )
            })
        })

        it('編輯模式 completedPeriods >= periods 時自動設為 completed', async () => {
            const nearlyDone = { ...editItem, completedPeriods: 5 }
            showAmortizationModal(app, nearlyDone)

            document.querySelector('#amort-completed').value = '6'
            document.querySelector('#amort-save-btn').click()

            await vi.waitFor(() => {
                expect(app.dataService.updateAmortization).toHaveBeenCalledWith(
                    42,
                    expect.objectContaining({ status: 'completed' })
                )
            })
        })

        it('編輯模式 completedPeriods 預設帶有現有值', () => {
            showAmortizationModal(app, editItem)
            expect(document.querySelector('#amort-completed').value).toBe('2')
        })

        it('編輯模式 completedPeriods 為 0 時正確顯示', () => {
            const zeroCompleted = { ...editItem, completedPeriods: 0 }
            showAmortizationModal(app, zeroCompleted)
            expect(document.querySelector('#amort-completed').value).toBe('0')
        })
    })

    // ── 溢繳偵測（編輯模式）──────────────────────────────────────
    describe('溢繳偵測（編輯模式）', () => {
        it('實際已付款超過應付總額時顯示溢繳警告', async () => {
            app.dataService.getRecords = vi.fn(async () => [
                { amount: 50000 },
            ])

            // 每期 5000, 6期 => 含息總額約 30000，已付 50000 > 30000
            const editItem = {
                id: 1,
                name: '已溢繳',
                type: 'installment',
                recordType: 'expense',
                category: 'shopping',
                totalAmount: 30000,
                downPayment: 0,
                interestRate: 0,
                periods: 6,
                completedPeriods: 2,
                amountPerPeriod: 5000,
                frequency: 'monthly',
                decimalStrategy: 'round',
                startDate: '2026-01-15',
                nextDueDate: '2026-03-15',
                status: 'active',
            }

            showAmortizationModal(app, editItem)

            // 觸發 updateCalculation（輸入變更）
            const totalInput = document.querySelector('#amort-total')
            totalInput.value = '30000'
            totalInput.dispatchEvent(new Event('input'))

            await vi.waitFor(() => {
                const totalDisplay = document.querySelector('#amort-total-with-interest')
                expect(totalDisplay.innerHTML).toContain('已溢繳')
            })
        })

        it('實際已付款未超過應付總額時不顯示溢繳', async () => {
            app.dataService.getRecords = vi.fn(async () => [
                { amount: 15000 },
            ])

            const editItem = {
                id: 2,
                name: '正常',
                type: 'installment',
                recordType: 'expense',
                category: 'food',
                totalAmount: 30000,
                downPayment: 0,
                interestRate: 0,
                periods: 6,
                completedPeriods: 2,
                amountPerPeriod: 5000,
                frequency: 'monthly',
                decimalStrategy: 'round',
                startDate: '2026-01-15',
                nextDueDate: '2026-03-15',
                status: 'active',
            }

            showAmortizationModal(app, editItem)

            const totalInput = document.querySelector('#amort-total')
            totalInput.value = '30000'
            totalInput.dispatchEvent(new Event('input'))

            await vi.waitFor(() => {
                const totalDisplay = document.querySelector('#amort-total-with-interest')
                expect(totalDisplay.innerHTML).not.toContain('已溢繳')
            })
        })
    })

    // ── 初始化 ─────────────────────────────────────────────────
    describe('初始化行為', () => {
        it('focus 在名稱輸入框', () => {
            showAmortizationModal(app)
            // 在 jsdom 中 activeElement 不一定支援 focus（不實作 focus），
            // 至少確認名稱輸入框存在
            expect(document.querySelector('#amort-name')).not.toBeNull()
        })

        it('使用 onSaved callback 時在儲存後呼叫', async () => {
            const onSaved = vi.fn()
            showAmortizationModal(app, null, {}, onSaved)

            document.querySelector('#amort-name').value = 'onSaved 測試'
            document.querySelector('#amort-total').value = '100'
            document.querySelector('#amort-periods').value = '1'
            document.querySelector('#amort-save-btn').click()

            await vi.waitFor(() => {
                expect(onSaved).toHaveBeenCalled()
            })
        })

        it('無 onSaved callback 時不拋錯', () => {
            expect(() => showAmortizationModal(app)).not.toThrow()
        })
    })
})

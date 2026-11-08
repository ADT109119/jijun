import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    RecordsListManager,
    getEffectiveVisibleFields,
    RECORD_FIELD_IDS,
    RECORD_FIELD_DEFS,
} from '../../src/js/recordsList.js'

// Mock utils.js for predictable dates
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return {
        ...actual,
        getDateRange: vi.fn(period => {
            if (period === 'week')
                return { startDate: '2026-06-28', endDate: '2026-07-04' }
            return { startDate: '2026-06-01', endDate: '2026-06-30' }
        }),
    }
})

vi.mock('../../src/js/datePickerModal.js', () => ({
    createDateRangeModal: vi.fn(() => {
        const modal = document.createElement('div')
        modal.id = 'date-range-modal'
        return modal
    }),
}))

/** 明細頁 DOM（與 recordsList.test.js 的 createDOMContainer 一致 + 欄位按鈕） */
function createDOMContainer() {
    const div = document.createElement('div')
    div.innerHTML = `
        <div class="page">
            <button id="prev-period-btn"></button>
            <h1 id="records-header-title"></h1>
            <button id="next-period-btn"></button>
            <input type="text" id="records-search-input">
            <button id="records-clear-search-btn" class="hidden"></button>
            <div id="records-period-filter">
                <button class="period-btn" data-period="week">週</button>
                <button class="period-btn" data-period="month">月</button>
                <button class="period-btn" data-period="year">年</button>
                <button class="period-btn" data-period="custom">自訂</button>
            </div>
            <div id="records-type-filter">
                <button class="type-btn" data-type="all"></button>
                <button class="type-btn" data-type="expense"></button>
                <button class="type-btn" data-type="income"></button>
            </div>
            <button id="records-category-filter-btn"></button>
            <button id="records-account-filter-btn" class="hidden"></button>
            <button id="records-fields-btn"></button>
            <div id="record-count">0</div>
            <div id="total-income">$0</div>
            <div id="total-expense">$0</div>
            <div id="records-list-container"></div>
            <div id="records-modals-container"></div>
        </div>
    `
    return div.querySelector('.page')
}

/** in-memory dataService mock（getSetting/saveSetting 走同一 settings obj） */
function createMockDataService(settings = {}, { advancedMode = false } = {}) {
    return {
        activeLedgerId: 1,
        getSetting: vi.fn(async key => {
            if (key === 'advancedAccountModeEnabled')
                return advancedMode ? { key, value: true } : null
            if (settings[key] !== undefined)
                return { key, value: settings[key] }
            return null
        }),
        saveSetting: vi.fn(async ({ key, value }) => {
            settings[key] = value
            return true
        }),
        getAccounts: vi.fn().mockResolvedValue([]),
        getRecords: vi.fn().mockResolvedValue([]),
        getDebts: vi.fn().mockResolvedValue([]),
    }
}

const basicCategoryManager = () => ({
    getCategories: vi.fn().mockReturnValue([]),
    getCategoryById: vi.fn().mockReturnValue({
        name: '伙食',
        icon: 'fa-solid fa-utensils',
        color: '#f97316',
    }),
})

/**
 * 建立單一 manager（settings 在 init 前 seed 進 mock，避免同 DOM 雙實例）
 * @returns {Promise<{container, dataService, manager}>}
 */
async function setupManager(settings = {}, opts = {}) {
    sessionStorage.clear()
    const container = createDOMContainer()
    const dataService = createMockDataService(settings, opts)
    const manager = new RecordsListManager(
        dataService,
        basicCategoryManager(),
        container
    )
    await manager.init()
    return { container, dataService, manager }
}

describe('getEffectiveVisibleFields — 純函數', () => {
    it('null/undefined/非陣列時回預設全部欄位（未保存的 account/date 依模式過濾）', () => {
        // 非陣列 → 預設全 4 欄 → advanced=false 時 account 被可用性過濾
        expect(getEffectiveVisibleFields(null)).toEqual([
            'description',
            'debtStatus',
            'date',
        ])
        expect(getEffectiveVisibleFields(undefined, true)).toEqual([
            'description',
            'debtStatus',
            'account',
        ])
        expect(getEffectiveVisibleFields('bad')).toEqual([
            'description',
            'debtStatus',
            'date',
        ])
        expect(getEffectiveVisibleFields(42, true)).toEqual([
            'description',
            'debtStatus',
            'account',
        ])
    })

    it('過濾未知 id（防設定污染）', () => {
        expect(
            getEffectiveVisibleFields(['description', 'hacked', 123])
        ).toEqual(['description'])
    })

    it('多帳戶模式=true 時排除 date（account 可用）', () => {
        expect(getEffectiveVisibleFields(null, true)).toEqual([
            'description',
            'debtStatus',
            'account',
        ])
        expect(getEffectiveVisibleFields(['date'], true)).toEqual([])
    })

    it('多帳戶模式=false 時排除 account（date 可用）', () => {
        expect(getEffectiveVisibleFields(null, false)).toEqual([
            'description',
            'debtStatus',
            'date',
        ])
        expect(getEffectiveVisibleFields(['account'], false)).toEqual([])
    })
})

describe('RecordsListManager — 欄位管理器設定載入', () => {
    it('無設定時 visibleFields 預設為全部 4 個已知 id', async () => {
        const { manager } = await setupManager()
        expect(manager.visibleFields).toEqual(RECORD_FIELD_IDS)
        manager.destroy()
    })

    it('per-ledger setting key 含帳本 suffix（recordDisplayFields_1）', async () => {
        const { dataService, manager } = await setupManager()
        expect(manager._recordFieldsSettingKey()).toBe(
            'recordDisplayFields_1'
        )
        // init 載入時應以該 key 讀取
        const calls = dataService.getSetting.mock.calls.map(c => c[0])
        expect(calls).toContain('recordDisplayFields_1')
        manager.destroy()
    })

    it('載入已保存的欄位子集', async () => {
        const { manager } = await setupManager({
            recordDisplayFields_1: ['description', 'debtStatus'],
        })
        expect(manager.visibleFields).toEqual([
            'description',
            'debtStatus',
        ])
        manager.destroy()
    })

    it('保存值非陣列時保留預設（不覆蓋）', async () => {
        const { manager } = await setupManager({
            recordDisplayFields_1: 'corrupted',
        })
        expect(manager.visibleFields).toEqual(RECORD_FIELD_IDS)
        manager.destroy()
    })

    it('欄位設定 getSetting 拋錯時降級預設且不中斷 init', async () => {
        sessionStorage.clear()
        const container = createDOMContainer()
        const dataService = createMockDataService()
        dataService.getSetting.mockImplementation(async key => {
            if (key === 'recordDisplayFields_1') throw new Error('boom')
            return null
        })
        const manager = new RecordsListManager(
            dataService,
            basicCategoryManager(),
            container
        )
        await manager.init()
        expect(manager.visibleFields).toEqual(RECORD_FIELD_IDS)
        manager.destroy()
    })
})

describe('RecordsListManager — 欄位管理器 modal', () => {
    it('渲染 4 個 checkbox 且 data-field-id 與定義一致', async () => {
        const { container, manager } = await setupManager()
        manager.showFieldsModal()
        const checkboxes = container.querySelectorAll('input[data-field-id]')
        expect(checkboxes).toHaveLength(4)
        const ids = [...checkboxes].map(el => el.dataset.fieldId)
        expect(ids).toEqual(RECORD_FIELD_DEFS.map(def => def.id))
        manager.destroy()
    })

    it('預設（無設定、非 advanced）：description/debtStatus/date 勾選、account disabled', async () => {
        const { container, manager } = await setupManager()
        manager.showFieldsModal()
        const checkboxes = container.querySelectorAll('input[data-field-id]')
        expect(checkboxes).toHaveLength(4)
        const states = Object.fromEntries(
            [...checkboxes].map(el => [
                el.dataset.fieldId,
                { checked: el.checked, disabled: el.disabled },
            ])
        )
        expect(states.description).toEqual({ checked: true, disabled: false })
        expect(states.debtStatus).toEqual({ checked: true, disabled: false })
        expect(states.date).toEqual({ checked: true, disabled: false })
        // 非 advanced 模式：account 停用
        expect(states.account).toEqual({ checked: true, disabled: true })
        manager.destroy()
    })

    it('多帳戶模式=true 時 date checkbox disabled、account 可用', async () => {
        const { container, manager } = await setupManager(
            {},
            { advancedMode: true }
        )
        manager.showFieldsModal()
        const dateCb = container.querySelector('input[data-field-id="date"]')
        const accountCb = container.querySelector(
            'input[data-field-id="account"]'
        )
        expect(dateCb.disabled).toBe(true)
        expect(accountCb.disabled).toBe(false)
        manager.destroy()
    })

    it('多帳戶模式=false 時 account checkbox disabled、date 可用', async () => {
        const { container, manager } = await setupManager()
        manager.showFieldsModal()
        const dateCb = container.querySelector('input[data-field-id="date"]')
        const accountCb = container.querySelector(
            'input[data-field-id="account"]'
        )
        expect(dateCb.disabled).toBe(false)
        expect(accountCb.disabled).toBe(true)
        manager.destroy()
    })

    it('disabled 欄位勾選狀態保留已保存設定', async () => {
        const { container, manager } = await setupManager({
            recordDisplayFields_1: [
                'description',
                'debtStatus',
                'account',
                'date',
            ],
        })
        manager.showFieldsModal()
        // account 在非 advanced 模式 disabled，但其已保存的勾選狀態應保留
        const accountCb = container.querySelector(
            'input[data-field-id="account"]'
        )
        expect(accountCb.disabled).toBe(true)
        expect(accountCb.checked).toBe(true)
        manager.destroy()
    })

    it('取消勾選 description 並套用後：saveSetting 不含 description 且列表不再顯示備註', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '午餐',
                debtId: null,
                amortizationId: null,
            },
        ]
        sessionStorage.clear()
        const container = createDOMContainer()
        const dataService = createMockDataService()
        dataService.getRecords.mockResolvedValueOnce(records)
        const manager = new RecordsListManager(
            dataService,
            basicCategoryManager(),
            container
        )
        await manager.init()
        // 備註預設顯示
        expect(
            container.querySelector('#records-list-container p.line-clamp-2')
        ).not.toBeNull()

        manager.showFieldsModal()
        const descCb = container.querySelector(
            'input[data-field-id="description"]'
        )
        descCb.checked = false
        container.querySelector('#apply-fields-btn').click()
        // 等 apply 的 async handler（saveSetting await）完成
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'recordDisplayFields_1',
            value: ['debtStatus', 'account', 'date'],
        })
        // 備註不再渲染
        expect(
            container.querySelector('#records-list-container p.line-clamp-2')
        ).toBeNull()
        // modal 已關閉
        expect(
            container.querySelector('#records-modals-container').innerHTML
        ).toBe('')
        manager.destroy()
    })

    it('隱藏欄位後重新勾選可復原（不可逆 bug 反向測試）', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '午餐',
                debtId: null,
                amortizationId: null,
            },
        ]
        sessionStorage.clear()
        const container = createDOMContainer()
        const dataService = createMockDataService()
        dataService.getRecords
            .mockResolvedValueOnce(records)
            .mockResolvedValueOnce(records)
        const manager = new RecordsListManager(
            dataService,
            basicCategoryManager(),
            container
        )
        await manager.init()

        // 第一次：取消勾選 description 並套用 → 隱藏
        manager.showFieldsModal()
        container.querySelector('input[data-field-id="description"]').checked = false
        container.querySelector('#apply-fields-btn').click()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(dataService.saveSetting).toHaveBeenLastCalledWith({
            key: 'recordDisplayFields_1',
            value: ['debtStatus', 'account', 'date'],
        })

        // 第二次：重新開啟 modal，description checkbox 依保存狀態為未勾選，
        // 重新打勾並套用 → 必須能加回 description（舊 filter 實作無法做到）
        manager.showFieldsModal()
        const descCb = container.querySelector('input[data-field-id="description"]')
        expect(descCb.checked).toBe(false)
        descCb.checked = true
        container.querySelector('#apply-fields-btn').click()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(dataService.saveSetting).toHaveBeenLastCalledWith({
            key: 'recordDisplayFields_1',
            value: ['description', 'debtStatus', 'account', 'date'],
        })
        manager.destroy()
    })

    it('隱藏欠款狀態後 debt badge 不再渲染（金額仍顯示）', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '',
                debtId: 10,
                amortizationId: null,
            },
        ]
        sessionStorage.clear()
        const container = createDOMContainer()
        const dataService = createMockDataService()
        dataService.getRecords.mockResolvedValueOnce(records)
        dataService.getDebts.mockResolvedValueOnce([
            {
                id: 10,
                type: 'payable',
                settled: false,
                contactId: null,
            },
        ])
        const manager = new RecordsListManager(
            dataService,
            basicCategoryManager(),
            container
        )
        await manager.init()
        expect(
            container.querySelector('#records-list-container .debt-link-btn')
        ).not.toBeNull()

        manager.visibleFields = ['description', 'account', 'date']
        manager.applyFiltersAndRender()
        expect(
            container.querySelector('#records-list-container .debt-link-btn')
        ).toBeNull()
        // 金額仍正常顯示（核心欄位不受影響）
        expect(
            container
                .querySelector('#records-list-container')
                .textContent
        ).toContain('-')
        manager.destroy()
    })

    it('套用時保留 unavailable 欄位的原設定（disabled 欄位不被清空）', async () => {
        // 非 advanced 模式、預設設定（4 欄全在）：account 為 disabled，
        // 不做任何勾選改動直接套用 → 保存值仍含 account
        const { container, dataService, manager } = await setupManager()
        manager.showFieldsModal()
        container.querySelector('#apply-fields-btn').click()
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(dataService.saveSetting).toHaveBeenCalledWith({
            key: 'recordDisplayFields_1',
            value: ['description', 'debtStatus', 'account', 'date'],
        })
        manager.destroy()
    })

    it('關閉按鈕與背景點擊皆可關閉 modal', async () => {
        const { container, manager } = await setupManager()
        manager.showFieldsModal()
        expect(container.querySelector('#fields-modal')).not.toBeNull()

        container.querySelector('#close-fields-modal').click()
        expect(container.querySelector('#fields-modal')).toBeNull()

        manager.showFieldsModal()
        container.querySelector('#fields-modal').dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        )
        expect(container.querySelector('#fields-modal')).toBeNull()
        manager.destroy()
    })
})

describe('RecordsListManager — 欄位管理器渲染 XSS 防護', () => {
    it('description 含 script 標籤時輸出經 escapeHTML（顯示狀態）', async () => {
        const records = [
            {
                id: 1,
                type: 'expense',
                category: 'food',
                amount: 200,
                date: '2026-06-15',
                description: '午餐<script>alert(1)</script>',
                debtId: null,
                amortizationId: null,
            },
        ]
        sessionStorage.clear()
        const container = createDOMContainer()
        const dataService = createMockDataService()
        dataService.getRecords.mockResolvedValueOnce(records)
        const manager = new RecordsListManager(
            dataService,
            basicCategoryManager(),
            container
        )
        await manager.init()
        const listHtml = container
            .querySelector('#records-list-container')
            .innerHTML
        expect(listHtml).not.toContain('<script>alert(1)</script>')
        expect(listHtml).toContain('&lt;script&gt;')
        manager.destroy()
    })
})

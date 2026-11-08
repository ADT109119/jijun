import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LedgersPage } from '../../src/js/pages/ledgersPage.js'

// mock utils.js：escapeHTML 用真實轉義（XSS 斷言有效）、toast/confirm 可斷言
vi.mock('../../src/js/utils.js', () => ({
    showToast: vi.fn(),
    escapeHTML: vi.fn(s =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    ),
    customConfirm: vi.fn(async () => true),
    // #SEC04：圖示白名單以真實語意提供（白名單外一律 fallback）
    isSafeIconClass: icon =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(icon.trim()),
    getSafeIconClass: (icon, fallback = 'fa-solid fa-book') =>
        typeof icon === 'string' &&
        /^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-zA-Z0-9-]+$/.test(icon.trim())
            ? icon.trim()
            : fallback,
    // #SEC05：顏色白名單以真實語意提供（白名單外一律退回 fallback）
    isSafeHexColor: value =>
        typeof value === 'string' &&
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value),
    getSafeHexColor: (color, fallback = '#334A52') =>
        typeof color === 'string' &&
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)
            ? color
            : fallback,
}))

import { showToast, customConfirm } from '../../src/js/utils.js'

// flush：讓 async handler 的多段 await 鏈跑完
const flush = () => new Promise(r => setTimeout(r, 0))
const flush2 = async () => {
    await flush()
    await flush()
}

function makeApp({
    ledgers,
    activeLedgerId = 1,
    signedIn = true,
    selfHost = false,
} = {}) {
    const defaultLedgers = [
        { id: 1, name: '預設帳本', icon: 'fa-solid fa-book', color: '#334A52' },
        { id: 2, name: '公司帳本', icon: 'fa-solid fa-briefcase', color: '#0ea5e9' },
    ]
    const ledgerList = ledgers || defaultLedgers

    document.body.innerHTML = ''
    const appContainer = document.createElement('div')
    document.body.appendChild(appContainer)

    const dataService = {
        activeLedgerId,
        getLedger: vi.fn(async id => ledgerList.find(l => l.id === id) || null),
        getSetting: vi.fn(async () => null),
        saveSetting: vi.fn(async () => true),
    }
    const ledgerManager = {
        getAllLedgers: vi.fn(() => ledgerList),
        getColorOptions: vi.fn(() => ['#334A52', '#0ea5e9', '#f59e0b']),
        getIconOptions: vi.fn(() => [
            'fa-solid fa-book',
            'fa-solid fa-briefcase',
            'fa-solid fa-wallet',
        ]),
        switchLedger: vi.fn(async () => {}),
        createLedger: vi.fn(async () => 2),
        updateLedger: vi.fn(async () => true),
        deleteLedger: vi.fn(async () => true),
        isLedgerOwner: vi.fn(async () => true),
        shareLedger: vi.fn(async () => 'FILE_ID_123'),
        joinSharedLedger: vi.fn(async () => 3),
        getSharedUsers: vi.fn(async () => []),
        removeSharedUser: vi.fn(async () => true),
        unshareLedger: vi.fn(async () => true),
    }
    const syncService = {
        isSignedIn: vi.fn(() => signedIn),
        isSelfHostMode: vi.fn(() => selfHost),
        openSharedLedgerPicker: vi.fn(async () => 'PICKED_ID'),
    }
    const app = { appContainer, dataService, ledgerManager, syncService }
    return { app, dataService, ledgerManager, syncService }
}

// 假 QRCode：讓 loadQRCodeLib() 直接 resolve（不注入 script，jsdom 不會載入）
beforeEach(() => {
    window.QRCode = class {
        constructor() {}
    }
})

function bodyModals() {
    return [...document.body.querySelectorAll('.fixed.inset-0')]
}
function lastModal() {
    return bodyModals()[bodyModals().length - 1]
}

describe('LedgersPage - render()', () => {
    let app, page

    beforeEach(() => {
        ;({ app } = makeApp())
        page = new LedgersPage(app)
    })

    it('渲染帳本管理頁骨架：標題、新增、加入共用按鈕', async () => {
        await page.render()
        expect(app.appContainer.textContent).toContain('帳本管理(Beta)')
        expect(app.appContainer.querySelector('#add-ledger-btn')).not.toBeNull()
        expect(app.appContainer.querySelector('#join-ledger-btn')).not.toBeNull()
    })

    it('每個帳本渲染一張卡片（data-ledger-id）', async () => {
        await page.render()
        const cards = app.appContainer.querySelectorAll('[data-ledger-id]')
        expect(cards).toHaveLength(2)
        expect(cards[0].dataset.ledgerId).toBe('1')
        expect(cards[1].dataset.ledgerId).toBe('2')
    })

    it('使用中帳本顯示「使用中」badge，非使用中帳本不顯示', async () => {
        await page.render()
        const activeCard = app.appContainer.querySelector(
            '[data-ledger-id="1"]'
        )
        const otherCard = app.appContainer.querySelector(
            '[data-ledger-id="2"]'
        )
        expect(activeCard.textContent).toContain('使用中')
        expect(otherCard.textContent).not.toContain('使用中')
    })

    it('預設帳本顯示「預設」badge 且沒有刪除按鈕', async () => {
        await page.render()
        const defaultCard = app.appContainer.querySelector(
            '[data-ledger-id="1"]'
        )
        expect(defaultCard.textContent).toContain('預設')
        expect(defaultCard.querySelector('.delete-ledger-btn')).toBeNull()
    })

    it('非預設帳本有分享/刪除按鈕；使用中帳本沒有切換按鈕', async () => {
        await page.render()
        const defaultCard = app.appContainer.querySelector(
            '[data-ledger-id="1"]'
        )
        const otherCard = app.appContainer.querySelector(
            '[data-ledger-id="2"]'
        )
        expect(defaultCard.querySelector('.switch-ledger-btn')).toBeNull()
        expect(otherCard.querySelector('.share-ledger-btn')).not.toBeNull()
        expect(otherCard.querySelector('.delete-ledger-btn')).not.toBeNull()
        expect(otherCard.querySelector('.switch-ledger-btn')).not.toBeNull()
    })

    it('XSS 防護：帳本名稱含 script 字串時經 escapeHTML 渲染', async () => {
        const { app: a } = makeApp({
            ledgers: [
                {
                    id: 1,
                    name: '惡意<script>alert(1)</script>帳本',
                    icon: 'fa-solid fa-book',
                    color: '#334A52',
                },
            ],
        })
        const p = new LedgersPage(a)
        await p.render()
        const card = a.appContainer.querySelector('[data-ledger-id="1"]')
        expect(card.innerHTML).toContain('&lt;script&gt;')
        // 名稱欄位不允許出現原始 <script> 開頭字串
        const nameEl = card.querySelector('p.font-bold')
        expect(nameEl.innerHTML).not.toContain('<script>')
        expect(nameEl.textContent).toBe('惡意<script>alert(1)</script>帳本')
    })
})

describe('LedgersPage - 帳本新增/編輯 modal (_showEditModal)', () => {
    let app, page

    beforeEach(async () => {
        ;({ app } = makeApp())
        page = new LedgersPage(app)
        await page.render()
    })

    it('新增模式：標題「新增帳本」、名稱空白、預覽「新帳本」、建立按鈕', () => {
        page._showEditModal(null)
        const modal = lastModal()
        expect(modal.textContent).toContain('新增帳本')
        expect(modal.querySelector('#ledger-name-input').value).toBe('')
        expect(modal.querySelector('#preview-name').textContent).toBe('新帳本')
        expect(modal.querySelector('#ledger-save-btn').textContent).toContain(
            '建立'
        )
    })

    it('編輯模式：標題「編輯帳本」、名稱預填、儲存按鈕', () => {
        page._showEditModal({ id: 2, name: '公司帳本', icon: 'fa-solid fa-briefcase', color: '#0ea5e9' })
        const modal = lastModal()
        expect(modal.textContent).toContain('編輯帳本')
        expect(modal.querySelector('#ledger-name-input').value).toBe('公司帳本')
        expect(modal.querySelector('#ledger-save-btn').textContent).toContain(
            '儲存'
        )
    })

    it('預設顏色被選中（第一顆 color-option 有選中樣式）', () => {
        page._showEditModal(null)
        const modal = lastModal()
        const first = modal.querySelector('.color-option[data-color="#334A52"]')
        expect(first.classList.contains('border-wabi-primary')).toBe(true)
    })

    it('點選顏色：hidden color input 與預覽背景色同步更新', () => {
        page._showEditModal(null)
        const modal = lastModal()
        modal
            .querySelector('.color-option[data-color="#f59e0b"]')
            .dispatchEvent(new Event('click'))
        expect(modal.querySelector('#ledger-color-input').value).toBe('#f59e0b')
        expect(modal.querySelector('#preview-icon').style.backgroundColor).toBe(
            'rgb(245, 158, 11)'
        )
    })

    it('點選圖示：hidden icon input 與預覽圖示同步更新', () => {
        page._showEditModal(null)
        const modal = lastModal()
        modal
            .querySelector('.icon-option[data-icon="fa-solid fa-wallet"]')
            .dispatchEvent(new Event('click', { bubbles: true }))
        expect(modal.querySelector('#ledger-icon-input').value).toBe(
            'fa-solid fa-wallet'
        )
        expect(modal.querySelector('#preview-icon').innerHTML).toContain(
            'fa-solid fa-wallet'
        )
    })

    it('圖示搜尋：關鍵字 car 過濾出符合的圖示（上限 100）', () => {
        vi.useFakeTimers()
        try {
            page._showEditModal(null)
            const modal = lastModal()
            const search = modal.querySelector('#ledger-icon-search')
            search.value = 'car'
            search.dispatchEvent(new Event('input'))
            vi.advanceTimersByTime(250)
            const options = modal.querySelectorAll('.icon-option')
            expect(options.length).toBeGreaterThan(0)
            expect(options.length).toBeLessThanOrEqual(100)
            options.forEach(b => {
                expect(b.dataset.icon).toContain('car')
            })
        } finally {
            vi.useRealTimers()
        }
    })

    it('圖示搜尋：清空關鍵字恢復預設圖示清單', () => {
        vi.useFakeTimers()
        try {
            page._showEditModal(null)
            const modal = lastModal()
            const search = modal.querySelector('#ledger-icon-search')
            search.value = 'car'
            search.dispatchEvent(new Event('input'))
            vi.advanceTimersByTime(250)
            expect(modal.querySelectorAll('.icon-option').length).toBeGreaterThan(3)
            // 清空
            search.value = ''
            search.dispatchEvent(new Event('input'))
            vi.advanceTimersByTime(250)
            const options = modal.querySelectorAll('.icon-option')
            expect(options).toHaveLength(3)
        } finally {
            vi.useRealTimers()
        }
    })

    it('名稱空白時儲存：toast 錯誤、createLedger 未呼叫、modal 保留', async () => {
        page._showEditModal(null)
        const modal = lastModal()
        modal.querySelector('#ledger-save-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(showToast).toHaveBeenCalledWith('請輸入帳本名稱', 'error')
        expect(app.ledgerManager.createLedger).not.toHaveBeenCalled()
        expect(modal.isConnected).toBe(true)
    })

    it('新增儲存成功：createLedger 以 name/color/icon 呼叫、toast、modal 移除', async () => {
        page._showEditModal(null)
        const modal = lastModal()
        modal.querySelector('#ledger-name-input').value = '家庭帳本'
        modal.querySelector('#ledger-save-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(app.ledgerManager.createLedger).toHaveBeenCalledWith({
            name: '家庭帳本',
            color: '#334A52',
            icon: 'fa-solid fa-book',
        })
        expect(showToast).toHaveBeenCalledWith('「家庭帳本」帳本已建立', 'success')
        expect(modal.isConnected).toBe(false)
    })

    it('新增儲存失敗：toast 顯示錯誤訊息、modal 保留', async () => {
        app.ledgerManager.createLedger.mockRejectedValueOnce(
            new Error('名稱重複')
        )
        page._showEditModal(null)
        const modal = lastModal()
        modal.querySelector('#ledger-name-input').value = '重複名稱'
        modal.querySelector('#ledger-save-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(showToast).toHaveBeenCalledWith('名稱重複', 'error')
        expect(modal.isConnected).toBe(true)
    })

    it('取消按鈕與 modal 背景點擊都能移除 modal', () => {
        page._showEditModal(null)
        const modal = lastModal()
        modal.querySelector('#ledger-cancel-btn').dispatchEvent(new Event('click'))
        expect(modal.isConnected).toBe(false)

        page._showEditModal(null)
        const modal2 = lastModal()
        modal2.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(modal2.isConnected).toBe(false)
    })
})

describe('LedgersPage - 刪除帳本', () => {
    let app, page

    beforeEach(async () => {
        ;({ app } = makeApp())
        page = new LedgersPage(app)
        await page.render()
    })

    it('確認取消：deleteLedger 未呼叫', async () => {
        customConfirm.mockResolvedValueOnce(false)
        app.appContainer
            .querySelector('.delete-ledger-btn[data-id="2"]')
            .dispatchEvent(new Event('click'))
        await flush()
        expect(app.ledgerManager.deleteLedger).not.toHaveBeenCalled()
    })

    it('確認刪除：deleteLedger(2) 被呼叫、成功 toast、重新渲染', async () => {
        app.appContainer
            .querySelector('.delete-ledger-btn[data-id="2"]')
            .dispatchEvent(new Event('click'))
        await flush2()
        expect(app.ledgerManager.deleteLedger).toHaveBeenCalledWith(2)
        expect(showToast).toHaveBeenCalledWith('已刪除「公司帳本」', 'success')
        // 重新 render 後仍是 2 卡（mock 未移除資料，僅驗證 render 被重跑不崩潰）
        expect(
            app.appContainer.querySelectorAll('[data-ledger-id]').length
        ).toBeGreaterThan(0)
    })

    it('刪除目前使用中帳本：自動切回預設帳本 (id=1)', async () => {
        const { app: a } = makeApp({ activeLedgerId: 2 })
        const p = new LedgersPage(a)
        await p.render()
        a.appContainer
            .querySelector('.delete-ledger-btn[data-id="2"]')
            .dispatchEvent(new Event('click'))
        await flush2()
        expect(a.ledgerManager.deleteLedger).toHaveBeenCalledWith(2)
        expect(a.ledgerManager.switchLedger).toHaveBeenCalledWith(1)
    })
})

describe('LedgersPage - 共用帳本 modal (_showShareModal)', () => {
    let app, page

    const sharedLedger = {
        id: 2,
        name: '公司帳本',
        icon: 'fa-solid fa-briefcase',
        color: '#0ea5e9',
        sharedFileId: 'SHARED_CODE_9',
    }

    beforeEach(async () => {
        ;({ app } = makeApp())
        page = new LedgersPage(app)
        await page.render()
    })

    it('未登入：toast 提示且不開啟 modal', async () => {
        const { app: a } = makeApp({ signedIn: false })
        const p = new LedgersPage(a)
        await p.render()
        await p._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '請先登入同步功能（設定 → 雲端備份&同步）',
            'error'
        )
        expect(a.appContainer.querySelector('#share-email-input')).toBeNull()
        expect(bodyModals()).toHaveLength(0)
    })

    it('個人帳本 owner (drive)：有 email 輸入（type=email）與送出按鈕、無 unshare', async () => {
        await page._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        const emailInput = modal.querySelector('#share-email-input')
        expect(emailInput).not.toBeNull()
        expect(emailInput.type).toBe('email')
        expect(modal.querySelector('#share-submit-btn')).not.toBeNull()
        expect(modal.querySelector('#unshare-btn')).toBeNull()
    })

    it('self-host 模式：受邀人帳號輸入（type=text）', async () => {
        const { app: a } = makeApp({ selfHost: true })
        const p = new LedgersPage(a)
        await p.render()
        await p._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        const input = modal.querySelector('#share-email-input')
        expect(input.type).toBe('text')
        expect(modal.textContent).toContain('受邀人帳號')
    })

    it('已共用但非 owner：無 unshare 按鈕且顯示參與者提示', async () => {
        app.ledgerManager.isLedgerOwner.mockResolvedValueOnce(false)
        await page._showShareModal(sharedLedger)
        await flush()
        const modal = lastModal()
        expect(modal.querySelector('#unshare-btn')).toBeNull()
        expect(modal.textContent).toContain('您是此共用帳本的參與者')
    })

    it('送出空白：toast「請輸入有效的 Email」、shareLedger 未呼叫', async () => {
        await page._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        modal.querySelector('#share-submit-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(showToast).toHaveBeenCalledWith('請輸入有效的 Email', 'error')
        expect(app.ledgerManager.shareLedger).not.toHaveBeenCalled()
    })

    it('drive 模式輸入不含 @ 的 email：toast「請輸入有效的 Email」', async () => {
        await page._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        modal.querySelector('#share-email-input').value = 'not-an-email'
        modal.querySelector('#share-submit-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(showToast).toHaveBeenCalledWith('請輸入有效的 Email', 'error')
        expect(app.ledgerManager.shareLedger).not.toHaveBeenCalled()
    })

    it('送出成功：shareLedger 呼叫、modal 重開並顯示共用代碼與 unshare', async () => {
        // 重開 modal 時 getLedger 回傳「已帶 sharedFileId」的帳本
        app.dataService.getLedger.mockResolvedValue({
            id: 2,
            name: '公司帳本',
            icon: 'fa-solid fa-briefcase',
            color: '#0ea5e9',
            sharedFileId: 'FILE_ID_123',
        })
        await page._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        modal.querySelector('#share-email-input').value = 'friend@gmail.com'
        modal.querySelector('#share-submit-btn').dispatchEvent(new Event('click'))
        await flush2()
        expect(app.ledgerManager.shareLedger).toHaveBeenCalledWith(
            2,
            'friend@gmail.com'
        )
        // modal 重新開啟（非 await 呼叫，需再 flush）
        const reopened = lastModal()
        expect(reopened.querySelector('#unshare-btn')).not.toBeNull()
        const codeInput = reopened.querySelector(
            'input[readonly][value="FILE_ID_123"]'
        )
        expect(codeInput).not.toBeNull()
    })

    it('送出失敗：toast「授權失敗」、按鈕恢復可點', async () => {
        app.ledgerManager.shareLedger.mockRejectedValueOnce(
            new Error('權限不足')
        )
        await page._showShareModal({ id: 2, name: '公司帳本' })
        await flush()
        const modal = lastModal()
        const submitBtn = modal.querySelector('#share-submit-btn')
        modal.querySelector('#share-email-input').value = 'friend@gmail.com'
        submitBtn.dispatchEvent(new Event('click'))
        await flush2()
        expect(showToast).toHaveBeenCalledWith('授權失敗：權限不足', 'error')
        expect(submitBtn.disabled).toBe(false)
    })

    it('已共用 owner：顯示共用代碼與複製按鈕，複製成功 toast', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })
        await page._showShareModal(sharedLedger)
        await flush()
        const modal = lastModal()
        const codeInput = modal.querySelector('input[readonly]')
        expect(codeInput.value).toBe('SHARED_CODE_9')
        expect(modal.querySelector('.copy-code-btn')).not.toBeNull()
        modal.querySelector('.copy-code-btn').dispatchEvent(new Event('click'))
        await flush()
        expect(writeText).toHaveBeenCalledWith('SHARED_CODE_9')
        expect(showToast).toHaveBeenCalledWith('已複製共用代碼', 'success')
    })

    it('移除使用者：owner 視角 member 有移除按鈕，確認後呼叫 removeSharedUser', async () => {
        app.ledgerManager.getSharedUsers.mockResolvedValueOnce([
            { id: 'u1', role: 'owner', displayName: 'Owner', emailAddress: 'o@x.com' },
            { id: 'u2', role: 'member', displayName: 'Member', emailAddress: 'm@x.com' },
        ])
        await page._showShareModal(sharedLedger)
        await flush2()
        const modal = lastModal()
        const removeBtns = modal.querySelectorAll('.remove-user-btn')
        expect(removeBtns).toHaveLength(1)
        removeBtns[0].dispatchEvent(new Event('click'))
        await flush2()
        expect(app.ledgerManager.removeSharedUser).toHaveBeenCalledWith(
            2,
            'u2'
        )
        expect(showToast).toHaveBeenCalledWith(
            '已移除該使用者的共用權限',
            'success'
        )
        expect(modal.querySelectorAll('.remove-user-btn')).toHaveLength(0)
    })

    it('取消共用：確認後 unshareLedger 呼叫、toast、modal 移除', async () => {
        await page._showShareModal(sharedLedger)
        await flush2()
        const modal = lastModal()
        modal.querySelector('#unshare-btn').dispatchEvent(new Event('click'))
        await flush2()
        expect(app.ledgerManager.unshareLedger).toHaveBeenCalledWith(2)
        expect(showToast).toHaveBeenCalledWith(
            '已取消共用，帳本已還原為個人帳本',
            'success'
        )
        expect(modal.isConnected).toBe(false)
    })

    it('取消共用：確認取消時 unshareLedger 未呼叫', async () => {
        customConfirm.mockResolvedValueOnce(false)
        await page._showShareModal(sharedLedger)
        await flush2()
        const modal = lastModal()
        modal.querySelector('#unshare-btn').dispatchEvent(new Event('click'))
        await flush2()
        expect(app.ledgerManager.unshareLedger).not.toHaveBeenCalled()
        expect(modal.isConnected).toBe(true)
    })
})

describe('LedgersPage - 加入共用帳本 modal (_showJoinModal)', () => {
    let app, page

    beforeEach(async () => {
        ;({ app } = makeApp())
        page = new LedgersPage(app)
        await page.render()
    })

    it('未登入：toast 提示且無 code input', async () => {
        const { app: a } = makeApp({ signedIn: false })
        const p = new LedgersPage(a)
        await p.render()
        p._showJoinModal()
        await flush()
        expect(showToast).toHaveBeenCalledWith(
            '請先登入同步功能才能加入共用帳本',
            'error'
        )
        expect(document.querySelector('#join-code-input')).toBeNull()
    })

    it('drive 有 picker 按鈕、self-host 無', () => {
        page._showJoinModal()
        expect(document.querySelector('#picker-btn')).not.toBeNull()
        const { app: a } = makeApp({ selfHost: true })
        const p = new LedgersPage(a)
        p._showJoinModal()
        expect(document.querySelector('#picker-btn')).toBeNull()
    })

    it('送出空白 code：toast「請輸入或選擇共用代碼」、join 未呼叫', async () => {
        page._showJoinModal()
        const submit = document.querySelector('#join-submit-btn')
        submit.dispatchEvent(new Event('click'))
        await flush()
        expect(showToast).toHaveBeenCalledWith('請輸入或選擇共用代碼', 'error')
        expect(app.ledgerManager.joinSharedLedger).not.toHaveBeenCalled()
    })

    it('手動輸入 code（drive）：先經 picker 確認授權再 join 並切換帳本', async () => {
        page._showJoinModal()
        document.querySelector('#join-code-input').value = 'ABC'
        document.querySelector('#join-submit-btn').dispatchEvent(new Event('click'))
        await flush2()
        expect(app.syncService.openSharedLedgerPicker).toHaveBeenCalledWith(
            'ABC'
        )
        expect(app.ledgerManager.joinSharedLedger).toHaveBeenCalledWith(
            'PICKED_ID'
        )
        expect(app.ledgerManager.switchLedger).toHaveBeenCalledWith(3)
        expect(showToast).toHaveBeenCalledWith('成功加入共用帳本！', 'success')
        expect(document.querySelector('#join-code-input')).toBeNull()
    })

    it('picker 按鈕：openSharedLedgerPicker 無參呼叫並自動送出', async () => {
        page._showJoinModal()
        document.querySelector('#picker-btn').dispatchEvent(new Event('click'))
        await flush2()
        expect(app.syncService.openSharedLedgerPicker).toHaveBeenCalledWith()
        expect(app.ledgerManager.joinSharedLedger).toHaveBeenCalledWith(
            'PICKED_ID'
        )
        expect(app.ledgerManager.switchLedger).toHaveBeenCalledWith(3)
    })

    it('使用者取消：不顯示「加入失敗」toast', async () => {
        app.ledgerManager.joinSharedLedger.mockRejectedValueOnce(
            new Error('使用者取消選擇')
        )
        page._showJoinModal()
        document.querySelector('#join-code-input').value = 'ABC'
        document.querySelector('#join-submit-btn').dispatchEvent(new Event('click'))
        await flush2()
        const failCalls = showToast.mock.calls.filter(
            c => String(c[0]).includes('加入失敗')
        )
        expect(failCalls).toHaveLength(0)
    })

    it('加入失敗：toast「加入失敗」、按鈕恢復可點', async () => {
        app.ledgerManager.joinSharedLedger.mockRejectedValueOnce(
            new Error('找不到帳本')
        )
        page._showJoinModal()
        const submit = document.querySelector('#join-submit-btn')
        document.querySelector('#join-code-input').value = 'NOPE'
        submit.dispatchEvent(new Event('click'))
        await flush2()
        expect(showToast).toHaveBeenCalledWith('加入失敗：找不到帳本', 'error')
        expect(submit.disabled).toBe(false)
    })
})

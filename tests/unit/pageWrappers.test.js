// 頁面包裝模組測試：contactsPage / debtsPage / privacyPage
// 三個 0 測試覆蓋的 src/js/pages/ 模組：
//   - ContactsPage：欠款功能守門 + 轉發 debtManager.renderContactsPage
//   - DebtsPage：欠款功能守門 + 轉發 debtManager.renderDebtsPage（含 params 透傳）
//   - PrivacyPage：靜態隱私權政策內容渲染
// 純測試，零 src 變更。
// 註：window.location.hash 用直接 assignment（jsdom 允許，與 accountsPage/router 測試同慣例），
//     不用 Object.defineProperty（hash 屬性 non-configurable 會 throw）。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContactsPage } from '../../src/js/pages/contactsPage.js'
import { DebtsPage } from '../../src/js/pages/debtsPage.js'
import { PrivacyPage } from '../../src/js/pages/privacyPage.js'

// ── 共用 helper：建立 mockApp 與容器 ─────────────────────
function makeApp(settingValue, renderContactsImpl, renderDebtsImpl) {
    const appContainer = document.createElement('div')
    appContainer.id = 'app-container'
    document.body.appendChild(appContainer)
    const mockApp = {
        appContainer,
        dataService: {
            // 債務功能開關：回傳 { value } 包裝（與 dataService.getSetting 原型一致）
            getSetting: vi.fn().mockResolvedValue(settingValue),
        },
        debtManager: {
            renderContactsPage: renderContactsImpl ?? vi.fn().mockResolvedValue(undefined),
            renderDebtsPage: renderDebtsImpl ?? vi.fn().mockResolvedValue(undefined),
        },
    }
    return mockApp
}

// ============================================================
describe('ContactsPage', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        window.location.hash = ''
    })

    it('欠款功能關閉 (value=false) 時應跳轉 #settings 且不渲染聯絡人頁', async () => {
        const renderContactsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp({ value: false }, renderContactsPage)
        const page = new ContactsPage(mockApp)
        await page.render()

        expect(window.location.hash).toBe('#settings')
        expect(renderContactsPage).not.toHaveBeenCalled()
        expect(mockApp.appContainer.innerHTML).toBe('')
        expect(mockApp.dataService.getSetting).toHaveBeenCalledWith('debtManagementEnabled')
    })

    it('欠款功能未設定 (getSetting 回傳 null) 時應跳轉 #settings', async () => {
        const renderContactsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp(null, renderContactsPage)
        const page = new ContactsPage(mockApp)
        await page.render()

        expect(window.location.hash).toBe('#settings')
        expect(renderContactsPage).not.toHaveBeenCalled()
    })

    it('欠款功能開啟 (value=true) 時應以 appContainer 渲染聯絡人頁', async () => {
        const renderContactsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp({ value: true }, renderContactsPage)
        const page = new ContactsPage(mockApp)
        await page.render()

        // 開啟時不跳轉：hash 維持空值
        expect(window.location.hash).toBe('')
        expect(renderContactsPage).toHaveBeenCalledTimes(1)
        expect(renderContactsPage).toHaveBeenCalledWith(mockApp.appContainer)
    })
})

// ============================================================
describe('DebtsPage', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        window.location.hash = ''
    })

    it('欠款功能關閉 (value=false) 時應跳轉 #settings 且不渲染欠款頁', async () => {
        const renderDebtsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp({ value: false }, undefined, renderDebtsPage)
        const page = new DebtsPage(mockApp)
        await page.render()

        expect(window.location.hash).toBe('#settings')
        expect(renderDebtsPage).not.toHaveBeenCalled()
        expect(mockApp.dataService.getSetting).toHaveBeenCalledWith('debtManagementEnabled')
    })

    it('欠款功能未設定 (getSetting 回傳 undefined) 時應跳轉 #settings', async () => {
        const renderDebtsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp(undefined, undefined, renderDebtsPage)
        const page = new DebtsPage(mockApp)
        await page.render()

        expect(window.location.hash).toBe('#settings')
        expect(renderDebtsPage).not.toHaveBeenCalled()
    })

    it('欠款功能開啟時應以 appContainer 渲染欠款頁', async () => {
        const renderDebtsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp({ value: true }, undefined, renderDebtsPage)
        const page = new DebtsPage(mockApp)
        await page.render()

        expect(window.location.hash).toBe('')
        expect(renderDebtsPage).toHaveBeenCalledTimes(1)
        expect(renderDebtsPage).toHaveBeenCalledWith(mockApp.appContainer, undefined)
    })

    it('應將路由 params 透傳給 debtManager.renderDebtsPage', async () => {
        const renderDebtsPage = vi.fn().mockResolvedValue(undefined)
        const mockApp = makeApp({ value: true }, undefined, renderDebtsPage)
        const params = { debtId: 42 }
        const page = new DebtsPage(mockApp)
        await page.render(params)

        expect(renderDebtsPage).toHaveBeenCalledTimes(1)
        expect(renderDebtsPage).toHaveBeenCalledWith(mockApp.appContainer, { debtId: 42 })
    })
})

// ============================================================
describe('PrivacyPage', () => {
    let mockApp

    beforeEach(() => {
        document.body.innerHTML = '<div id="app-container"></div>'
        mockApp = {
            appContainer: document.getElementById('app-container'),
        }
    })

    it('應成功渲染隱私權政策頁面骨架（返回連結 + 標題）', async () => {
        const page = new PrivacyPage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML
        expect(html).toContain('href="#settings"')
        expect(html).toContain('fa-chevron-left')
        expect(html).toContain('隱私權政策')
        expect(html).toContain('page active')
    })

    it('應包含全部 5 個政策章節標題', async () => {
        const page = new PrivacyPage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML
        expect(html).toContain('1. 本機資料儲存')
        // innerHTML 序列化時 & 會被編碼為 &amp;（jsdom 標準行為），故斷言編碼後的字串
        expect(html).toContain('2. 雲端備份&amp;同步功能')
        expect(html).toContain('3. 廣告與第三方服務')
        expect(html).toContain('4. 資料刪除')
        expect(html).toContain('5. 政策更新')
    })

    it('應包含 Google 隱私權政策外部連結（target=_blank）', async () => {
        const page = new PrivacyPage(mockApp)
        await page.render()

        const link = mockApp.appContainer.querySelector(
            'a[href="https://policies.google.com/privacy"]'
        )
        expect(link).not.toBeNull()
        expect(link.getAttribute('target')).toBe('_blank')
    })

    it('應說明本機資料儲存於 IndexedDB 且雲端備份走 Google Drive', async () => {
        const page = new PrivacyPage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML
        expect(html).toContain('IndexedDB')
        expect(html).toContain('Google Drive')
        expect(html).toContain('Google Identity Services')
    })
})

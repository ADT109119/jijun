import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GroupsPage } from '../../src/js/pages/groupsPage.js'
import DataService from '../../src/js/dataService.js'

function clearMockData() {
    if (globalThis.indexedDB && globalThis.indexedDB._storeData) {
        for (const name of Object.keys(globalThis.indexedDB._storeData)) {
            globalThis.indexedDB._storeData[name].length = 0
        }
    }
}

describe('GroupsPage', () => {
    let mockApp
    let ds

    beforeEach(async () => {
        clearMockData()
        localStorage.clear()
        document.body.innerHTML = '<div id="app-container"></div>'

        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1

        mockApp = {
            appContainer: document.getElementById('app-container'),
            dataService: ds,
            debtManager: {
                showGroupDetailsModal: vi.fn(),
            },
        }
    })

    it('空資料時顯示無群組提示及建立第一個群組按鈕', async () => {
        const page = new GroupsPage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML
        expect(html).toContain('群組與專案管理')
        expect(html).toContain('尚無任何群組或活動專案')
        expect(html).toContain('建立第一個群組')
    })

    it('有群組時正確渲染群組列表與統計金額', async () => {
        await ds.saveGroupMeta({ id: 'g1', name: '日本旅行', ledgerId: 1 })
        const tx = ds.db.transaction('records', 'readwrite')
        await tx.store.add({ type: 'expense', amount: 1500, date: '2024-02-01', groupId: 'g1', ledgerId: 1 })
        await tx.done

        const page = new GroupsPage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML
        expect(html).toContain('日本旅行')
        expect(html).toContain('1,500')
        expect(html).toContain('進行中')
    })

    it('點擊細節按鈕呼叫 showGroupDetailsModal', async () => {
        await ds.saveGroupMeta({ id: 'g1', name: '專案分帳', ledgerId: 1 })
        const page = new GroupsPage(mockApp)
        await page.render()

        const detailBtn = mockApp.appContainer.querySelector('.view-group-detail-btn')
        expect(detailBtn).not.toBeNull()
        detailBtn.click()

        expect(mockApp.debtManager.showGroupDetailsModal).toHaveBeenCalledWith('g1')
    })
})

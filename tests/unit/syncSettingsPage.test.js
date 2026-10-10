import { describe, it, expect, beforeEach } from 'vitest'
import { SyncSettingsPage } from '../../src/js/pages/syncSettingsPage.js'

describe('SyncSettingsPage Theme & Styling', () => {
    let mockApp
    let mockSyncService
    let mockDataService

    beforeEach(() => {
        document.body.innerHTML = '<div id="app-container"></div>'

        mockDataService = {
            getSetting: async (key) => null,
            saveSetting: async (obj) => {}
        }

        mockSyncService = {
            isSignedIn: () => false,
            userInfo: null,
            getServerUrl: () => 'https://jijun-server.the-walking-fish.com',
            deviceId: 'test-device-123'
        }

        mockApp = {
            appContainer: document.getElementById('app-container'),
            dataService: mockDataService,
            syncService: mockSyncService
        }
    })

    it('未登入時，登入按鈕應使用主題背景與主題文字變數，且無未適配的寫死顏色', async () => {
        const page = new SyncSettingsPage(mockApp)
        await page.render()

        const signInBtn = document.getElementById('sync-sign-in-btn')
        expect(signInBtn).not.toBeNull()
        expect(signInBtn.className).toContain('bg-wabi-bg')
        expect(signInBtn.className).toContain('text-wabi-text-primary')
        expect(signInBtn.className).not.toContain('bg-green-50')
        expect(signInBtn.innerHTML).toContain('text-wabi-text-primary')
        expect(signInBtn.innerHTML).not.toContain('text-gray-700')
    })

    it('已登入時，帳號名稱外框應使用 bg-wabi-bg 與主題邊框，無寫死之 bg-green-50', async () => {
        mockSyncService.isSignedIn = () => true
        mockSyncService.userInfo = {
            name: '測試使用者',
            email: 'test@example.com',
            picture: 'https://example.com/avatar.png'
        }

        const page = new SyncSettingsPage(mockApp)
        await page.render()

        const containerHtml = mockApp.appContainer.innerHTML

        // 檢查不含寫死綠色背景與文字
        expect(containerHtml).not.toContain('bg-green-50')
        expect(containerHtml).not.toContain('border-green-200')
        expect(containerHtml).not.toContain('bg-green-100')
        expect(containerHtml).not.toMatch(/\bhover:bg-red-50\b/)

        // 檢查已套用主題變數
        expect(containerHtml).toContain('bg-wabi-bg rounded-lg border border-wabi-border')
        expect(containerHtml).toContain('text-wabi-income')
        expect(containerHtml).toContain('測試使用者')
        expect(containerHtml).toContain('test@example.com')
    })
})

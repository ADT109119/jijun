import { describe, it, expect, beforeEach } from 'vitest'
import { LicensePage } from '../../src/js/pages/licensePage.js'

describe('LicensePage', () => {
    let mockApp

    beforeEach(() => {
        document.body.innerHTML = '<div id="app-container"></div>'
        mockApp = {
            appContainer: document.getElementById('app-container')
        }
    })

    it('應成功渲染授權條款頁面且包含所有第三方函式庫宣告', async () => {
        const page = new LicensePage(mockApp)
        await page.render()

        const html = mockApp.appContainer.innerHTML

        expect(html).toContain('授權條款')
        expect(html).toContain('原始碼授權 (MIT License)')
        expect(html).toContain('wllama')
        expect(html).toContain('SortableJS')
        expect(html).toContain('QRCode.js')
        expect(html).toContain('html5-qrcode')
        expect(html).toContain('Tailwind CSS')
        expect(html).toContain('Font Awesome Free')
        expect(html).toContain('Chart.js')
        expect(html).toContain('date-fns')
        expect(html).toContain('idb')
        expect(html).toContain('Capacitor &amp; Plugins')
        expect(html).toContain('@codetrix-studio/capacitor-google-auth')
        expect(html).toContain('Google Identity Services API')
    })
})

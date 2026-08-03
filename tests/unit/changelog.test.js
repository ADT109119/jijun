import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChangelogManager, CHANGELOG } from '../../src/js/changelog.js'

describe('ChangelogManager', () => {
    let changelogManager

    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        changelogManager = new ChangelogManager()
    })

    it('能正確獲取最新版本號與 Changelog 資料', () => {
        const versions = changelogManager.getAllVersions()
        expect(versions.length).toBeGreaterThan(0)
        expect(versions[0].version).toBe('2.1.6.7')
        expect(versions[0].title).toContain('全新 AI 離線語音記帳助手')
    })

    it('當軟體版本升級 (lastSeenVersion !== currentVersion) 時應自動寫入 localStorage 並產生彈窗', () => {
        localStorage.setItem('app-last-seen-version', '2.1.6.6')
        
        changelogManager.checkAndShowVersionUpdateModal()

        expect(localStorage.getItem('app-last-seen-version')).toBe('2.1.6.7')
        const modal = document.getElementById('update-changelog-modal')
        expect(modal).not.toBeNull()
        expect(modal.innerHTML).toContain('v2.1.6.7 登場！')
        expect(modal.innerHTML).toContain('全新 AI 離線語音記帳助手')
    })

    it('當為首次安裝 (無 lastSeenVersion) 時，記錄當前最新版本但不強制干擾彈窗', () => {
        changelogManager.checkAndShowVersionUpdateModal()

        expect(localStorage.getItem('app-last-seen-version')).toBe('2.1.6.7')
        const modal = document.getElementById('update-changelog-modal')
        expect(modal).toBeNull()
    })

    it('手動觸發 showUpdateChangelogModal 可開啟最新版本亮點 Modal', () => {
        changelogManager.showUpdateChangelogModal()

        const modal = document.getElementById('update-changelog-modal')
        expect(modal).not.toBeNull()
        expect(modal.querySelector('h3').textContent).toContain('v2.1.6.7 登場！')

        // 點擊關閉按鈕
        const closeBtn = document.getElementById('close-update-changelog-btn')
        closeBtn.click()
        expect(document.getElementById('update-changelog-modal')).toBeNull()
    })
})

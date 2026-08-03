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
        const latest = changelogManager.getLatestVersion()
        expect(versions[0].version).toBe(latest.version)
        expect(versions[0].title).toBe(latest.title)
    })

    it('當軟體版本升級 (lastSeenVersion !== currentVersion) 時應自動寫入 localStorage 並產生彈窗', () => {
        localStorage.setItem('app-last-seen-version', '2.1.6.9')
        const latestVersion = changelogManager.getLatestVersion().version

        changelogManager.checkAndShowVersionUpdateModal()

        expect(localStorage.getItem('app-last-seen-version')).toBe(latestVersion)
        const modal = document.getElementById('update-changelog-modal')
        expect(modal).not.toBeNull()
        expect(modal.innerHTML).toContain(`v${latestVersion} 登場！`)
    })

    it('當舊用戶升級 (app-current-version 為舊版且未曾有 lastSeenVersion) 時應產生彈窗', () => {
        localStorage.setItem('app-current-version', '2.1.6.9')
        localStorage.setItem('activeLedgerId', '1')
        const latestVersion = changelogManager.getLatestVersion().version

        changelogManager.checkAndShowVersionUpdateModal()

        expect(localStorage.getItem('app-last-seen-version')).toBe(latestVersion)
        const modal = document.getElementById('update-changelog-modal')
        expect(modal).not.toBeNull()
        expect(modal.innerHTML).toContain(`v${latestVersion} 登場！`)
    })

    it('當為全新安裝 (零 localStorage 資料) 時，記錄當前最新版本但不彈出 Modal', () => {
        const latestVersion = changelogManager.getLatestVersion().version

        changelogManager.checkAndShowVersionUpdateModal()

        expect(localStorage.getItem('app-last-seen-version')).toBe(latestVersion)
        const modal = document.getElementById('update-changelog-modal')
        expect(modal).toBeNull()
    })

    it('手動觸發 showUpdateChangelogModal 可開啟最新版本亮點 Modal', () => {
        const latestVersion = changelogManager.getLatestVersion().version
        changelogManager.showUpdateChangelogModal()

        const modal = document.getElementById('update-changelog-modal')
        expect(modal).not.toBeNull()
        expect(modal.querySelector('h3').textContent).toContain(`v${latestVersion} 登場！`)

        // 點擊關閉按鈕
        const closeBtn = document.getElementById('close-update-changelog-btn')
        closeBtn.click()
        expect(document.getElementById('update-changelog-modal')).toBeNull()
    })
})

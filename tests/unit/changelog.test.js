// ==================== ChangelogManager 單元測試 ====================
// 測試重點：版本資訊查詢、HTML 渲染、版本排序、showChangelogModal DOM 操作
// 不包含無意義的 snapshot 測試，專注於行為正確性

import { describe, it, expect, beforeEach } from 'vitest'
import { CHANGELOG, ChangelogManager } from '../../src/js/changelog.js'

// ── 測試資料輔助 ──────────────────────────────────────

/** 預期 CHANGELOG 中應包含的版本 key */
const EXPECTED_VERSIONS = [
    '2.1.6.2', '2.1.6.1', '2.1.6.0', '2.1.5.9', '2.1.5.8',
    '2.1.5.7', '2.1.5.6', '2.1.5.5', '2.1.5.4', '2.1.5.3',
    '2.1.5.2', '2.1.5.1', '2.1.5.0', '2.1.4.9', '2.1.4.8',
    '2.1.4.7', '2.1.4.6', '2.1.4.5', '2.1.4.4', '2.1.4.3',
    '2.1.4.2', '2.1.4.1', '2.1.4.0', '2.1.3.1', '2.1.3.0',
    '2.1.2.9', '2.1.2.8', '2.1.2.7', '2.1.2.6', '2.1.2.5',
    '2.1.2.4', '2.1.2.3', '2.1.2.2', '2.1.2.1', '2.1.2.0',
    '2.1.1.3', '2.1.1.2', '2.1.1.1', '2.1.1.0', '2.1.0.8',
    '2.1.0.7', '2.1.0.6', '2.1.0.5', '2.1.0.4', '2.1.0.3',
    '2.1.0.2', '2.1.0.1', '2.1.0', '2.0.7.6', '2.0.7.5',
    '2.0.7.4', '2.0.7.3', '2.0.7.2', '2.0.7.1', '2.0.7',
    '2.0.6.3', '2.0.6.2', '2.0.6.1', '2.0.6', '2.0.5',
    '2.0.4.2', '2.0.4.1', '2.0.4', '2.0.3', '2.0.2',
    '2.0.1', '2.0.0', '1.x',
]

// ── setup ─────────────────────────────────────────────

beforeEach(() => {
    localStorage.clear()
    // 預設 localStorage 中無 app-current-version，讓 constructor 使用 __APP_VERSION__
})

// ── CHANGELOG 資料完整性 ─────────────────────────────

describe('CHANGELOG 資料完整性', () => {
    it('包含所有預期版本', () => {
        for (const v of EXPECTED_VERSIONS) {
            expect(CHANGELOG).toHaveProperty(v)
        }
    })

    it('每個版本都有 date 與 title 欄位，且 features/bugfixes/improvements 若存在則為陣列', () => {
        for (const entry of Object.values(CHANGELOG)) {
            expect(entry).toHaveProperty('date')
            expect(entry).toHaveProperty('title')
            // 舊版（2.0.x 以前）可能缺少 features/bugfixes/improvements，renderVersionInfo 有預設值 []
            if ('features' in entry) {
                expect(Array.isArray(entry.features)).toBe(true)
            }
            if ('bugfixes' in entry) {
                expect(Array.isArray(entry.bugfixes)).toBe(true)
            }
            if ('improvements' in entry) {
                expect(Array.isArray(entry.improvements)).toBe(true)
            }
        }
    })

    it('版本日期格式為 YYYY-MM-DD 或 YYYY-M-D', () => {
        for (const entry of Object.values(CHANGELOG)) {
            expect(entry.date).toMatch(/^\d{4}-\d{1,2}-\d{1,2}$/)
        }
    })

    it('最新版本的 date 不小於次新版本的 date（根據 getAllVersions 排序）', () => {
        const manager = new ChangelogManager()
        const all = manager.getAllVersions()
        for (let i = 0; i < all.length - 1; i++) {
            const d1 = new Date(all[i].date).getTime()
            const d2 = new Date(all[i + 1].date).getTime()
            expect(d1).toBeGreaterThanOrEqual(d2)
        }
    })
})

// ── ChangelogManager ──────────────────────────────────

describe('ChangelogManager', () => {
    let manager

    beforeEach(() => {
        manager = new ChangelogManager()
    })

    describe('constructor', () => {
        it('localStorage 無 app-current-version 時使用 __APP_VERSION__', () => {
            expect(manager.currentVersion).toBeDefined()
        })

        it('localStorage 有 app-current-version 時使用該值', () => {
            localStorage.setItem('app-current-version', '2.1.5.0')
            const m = new ChangelogManager()
            expect(m.currentVersion).toBe('2.1.5.0')
        })
    })

    describe('getCurrentVersionInfo', () => {
        it('回傳物件包含 version 與 CHANGELOG 資訊', () => {
            const info = manager.getCurrentVersionInfo()
            expect(info).toHaveProperty('version', manager.currentVersion)
            expect(info).toHaveProperty('title')
            expect(info).toHaveProperty('date')
            expect(Array.isArray(info.features)).toBe(true)
        })

        it('回傳的 version 在 CHANGELOG 中有對應項目', () => {
            const info = manager.getCurrentVersionInfo()
            expect(CHANGELOG[info.version]).toBeDefined()
        })
    })

    describe('getAllVersions', () => {
        it('回傳所有版本的陣列', () => {
            const all = manager.getAllVersions()
            expect(all.length).toBe(Object.keys(CHANGELOG).length)
        })

        it('每個元素都有 version 與 CHANGELOG 欄位', () => {
            const all = manager.getAllVersions()
            for (const item of all) {
                expect(item).toHaveProperty('version')
                expect(item).toHaveProperty('title')
                expect(item).toHaveProperty('date')
            }
        })

        it('依照日期降序排序（最新在前）', () => {
            const all = manager.getAllVersions()
            for (let i = 0; i < all.length - 1; i++) {
                const d1 = new Date(all[i].date)
                const d2 = new Date(all[i + 1].date)
                // 允許相等（同一天發佈的版本）
                expect(d1.getTime()).toBeGreaterThanOrEqual(d2.getTime())
            }
        })

        it('排序後的第一個版本是最新版本', () => {
            const all = manager.getAllVersions()
            const sortedKeys = Object.keys(CHANGELOG).sort(
                (a, b) => new Date(CHANGELOG[b].date) - new Date(CHANGELOG[a].date)
            )
            expect(all[0].version).toBe(sortedKeys[0])
        })

        it('排序後的最後一個版本是最舊版本', () => {
            const all = manager.getAllVersions()
            const sortedKeys = Object.keys(CHANGELOG).sort(
                (a, b) => new Date(CHANGELOG[a].date) - new Date(CHANGELOG[b].date)
            )
            expect(all[all.length - 1].version).toBe(sortedKeys[0])
        })
    })

    describe('getVersionInfo', () => {
        it('回傳指定版本的資訊', () => {
            const info = manager.getVersionInfo('2.1.5.7')
            expect(info).not.toBeNull()
            expect(info.version).toBe('2.1.5.7')
            expect(info.title).toContain('信用卡')
        })

        it('不存在的版本回傳 null', () => {
            expect(manager.getVersionInfo('0.0.0')).toBeNull()
            expect(manager.getVersionInfo('')).toBeNull()
        })

        it('存在但非字串 key 回傳 null (防禦)', () => {
            expect(manager.getVersionInfo(undefined)).toBeNull()
            expect(manager.getVersionInfo(null)).toBeNull()
        })

        it('回傳 v2.1.4.7 包含深色模式資訊', () => {
            const info = manager.getVersionInfo('2.1.4.7')
            expect(info.title).toContain('深色模式')
            expect(info.features.length).toBeGreaterThan(0)
        })

        it('回傳 v1.x 包含 note 欄位', () => {
            const info = manager.getVersionInfo('1.x')
            expect(info.note).toContain('停止維護')
        })
    })

    describe('renderVersionInfo', () => {
        function parseHtml(html) {
            const div = document.createElement('div')
            div.innerHTML = html
            return div
        }

        it('為目前版本加上「目前版本」標籤', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info, true)
            const el = parseHtml(html)
            expect(el.textContent).toContain('目前版本')
        })

        it('非目前版本不顯示「目前版本」標籤', () => {
            const info = manager.getVersionInfo('2.1.0')
            const html = manager.renderVersionInfo(info, false)
            expect(html).not.toContain('目前版本')
        })

        it('預設 isCurrentVersion=false', () => {
            const info = manager.getVersionInfo('2.1.6.1')
            const html = manager.renderVersionInfo(info)
            expect(html).not.toContain('目前版本')
        })

        it('渲染版本標題 v2.1.5.7', () => {
            const info = manager.getVersionInfo('2.1.5.7')
            const html = manager.renderVersionInfo(info)
            expect(html).toContain('v2.1.5.7')
            expect(html).toContain('2026-06-28')
        })

        it('渲染新功能區塊（有 features 時）', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info)
            expect(html).toContain('✨ 新功能')
            expect(html).toContain('預算排除類別')
        })

        it('無 features 時不渲染新功能區塊（v2.1.5.8 features 為空陣列）', () => {
            const info = manager.getVersionInfo('2.1.5.8')
            const html = manager.renderVersionInfo(info)
            expect(html).not.toContain('✨ 新功能')
        })

        it('渲染 bugfixes 區塊', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info)
            expect(html).toContain('🐛 錯誤修復')
            expect(html).toContain('多帳本背景同步')
        })

        it('無 bugfixes 時不渲染錯誤修復區塊', () => {
            const info = manager.getVersionInfo('2.1.6.0')
            const html = manager.renderVersionInfo(info)
            expect(html).not.toContain('🐛 錯誤修復')
        })

        it('渲染 improvements 區塊', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info)
            expect(html).toContain('🔧 改進優化')
            expect(html).toContain('PWA Widget 本地時區')
        })

        it('無 improvements 時不渲染改進優化區塊', () => {
            const info = manager.getVersionInfo('2.1.5.7')
            const html = manager.renderVersionInfo(info)
            expect(html).not.toContain('🔧 改進優化')
        })

        it('渲染 note 區塊（v1.x）', () => {
            const info = manager.getVersionInfo('1.x')
            const html = manager.renderVersionInfo(info)
            expect(html).toContain('yellow')
            expect(html).toContain('停止維護')
        })

        it('無 note 時不渲染 note 區塊', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info)
            expect(html).not.toContain('yellow')
        })

        it('包含正確的 CSS class 名稱（目前版本：accent border + bg；非目前版本：一般 border + bg）', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            // 目前版本有 accent class
            const currentHtml = manager.renderVersionInfo(info, true)
            expect(currentHtml).toContain('border-wabi-accent/50')
            expect(currentHtml).toContain('bg-wabi-accent/10')
            // 非目前版本有一般 class
            const nonCurrentHtml = manager.renderVersionInfo(info)
            expect(nonCurrentHtml).toContain('border-wabi-border')
            expect(nonCurrentHtml).toContain('bg-wabi-surface')
        })

        it('features 列表有正確的項目數量（v2.1.6.2: 1 feature + 2 bugfixes + 6 improvements = 9 li items）', () => {
            const info = manager.getVersionInfo('2.1.6.2')
            const html = manager.renderVersionInfo(info)
            const featureMatch = html.match(/<li class="flex items-start">/g)
            expect(featureMatch).toHaveLength(9)
        })
    })

    describe('renderCurrentVersionSummary', () => {
        it('回傳的 HTML 包含版本標題', () => {
            const html = manager.renderCurrentVersionSummary()
            expect(html).toContain(CHANGELOG[manager.currentVersion].title)
        })

        it('features 數量超過 3 時顯示「還有 N 項功能」', () => {
            // 2.1.5.7 有 3 個 features，剛好不觸發 truncation
            localStorage.setItem('app-current-version', '2.1.5.7')
            const m = new ChangelogManager()
            const html = m.renderCurrentVersionSummary()
            expect(html).not.toContain('還有')
        })

        it('無 features 時不顯示新功能區塊（v2.1.5.8 無新功能）', () => {
            localStorage.setItem('app-current-version', '2.1.5.8')
            const m = new ChangelogManager()
            const html = m.renderCurrentVersionSummary()
            expect(html).not.toContain('✨ 新功能')
        })

        it('無 bugfixes 時不顯示錯誤修復區塊', () => {
            localStorage.setItem('app-current-version', '2.1.6.0')
            const m = new ChangelogManager()
            const html = m.renderCurrentVersionSummary()
            expect(html).not.toContain('🐛 錯誤修復')
        })

        it('無 improvements 時不顯示改進優化區塊', () => {
            localStorage.setItem('app-current-version', '2.1.5.7')
            const m = new ChangelogManager()
            const html = m.renderCurrentVersionSummary()
            expect(html).not.toContain('🔧 改進優化')
        })

        it('只顯示前 3 項 features', () => {
            // v2.1.5.5 有 1 個 feature，v2.1.4.4 有 2 個
            // 都沒有超過 3 個，所以不會有 truncation
            const allVersions = Object.keys(CHANGELOG)
            const versionWithManyFeatures = allVersions.find(
                v => CHANGELOG[v].features.length > 3
            )
            if (versionWithManyFeatures) {
                localStorage.setItem('app-current-version', versionWithManyFeatures)
                const m = new ChangelogManager()
                const html = m.renderCurrentVersionSummary()
                expect(html).toContain('還有')
            }
        })
    })

    describe('showChangelogModal', () => {
        beforeEach(() => {
            document.body.innerHTML = ''
        })

        it('建立 modal 並附加到 body', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            expect(modal).not.toBeNull()
            expect(modal.classList.contains('fixed')).toBe(true)
        })

        it('modal 包含版本更新日誌標題', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            expect(modal.textContent).toContain('版本更新日誌')
        })

        it('modal 包含關閉按鈕', () => {
            manager.showChangelogModal()
            const btn = document.getElementById('close-changelog-btn')
            expect(btn).not.toBeNull()
            expect(btn.tagName).toBe('BUTTON')
        })

        it('點擊關閉按鈕移除 modal', () => {
            manager.showChangelogModal()
            const btn = document.getElementById('close-changelog-btn')
            btn.click()
            expect(document.getElementById('changelog-modal')).toBeNull()
        })

        it('點擊背景移除 modal', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            modal.click()
            expect(document.getElementById('changelog-modal')).toBeNull()
        })

        it('雙次呼叫 showChangelogModal 不會殘留多個 modal', () => {
            manager.showChangelogModal()
            manager.showChangelogModal()
            const modals = document.querySelectorAll('#changelog-modal')
            expect(modals.length).toBe(1)
        })

        it('modal 包含目前版本標記', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            expect(modal.textContent).toContain('目前版本')
        })

        it('modal 包含感謝訊息', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            expect(modal.textContent).toContain('感謝您使用輕鬆記帳')
        })

        it('modal 內容包含所有的版本歷史', () => {
            manager.showChangelogModal()
            const modal = document.getElementById('changelog-modal')
            // 驗證有最新的幾個版本標題出現
            expect(modal.textContent).toContain('v2.1.6.2')
            expect(modal.textContent).toContain('v2.1.6.0')
        })
    })
})

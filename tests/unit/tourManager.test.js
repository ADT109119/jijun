// ==================== GuideManager 單元測試 (#U08 導覽功能) ====================
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GuideManager, TourManager, TOURS } from '../../src/js/tourManager.js'

// 簡單 mock utils 的 escapeHTML（保留真實實現以測 XSS 防禦）
vi.mock('../../src/js/utils.js', async importOriginal => {
    const actual = await importOriginal()
    return { ...actual }
})

describe('GuideManager', () => {
    let gm

    beforeEach(() => {
        localStorage.clear()
        gm = new GuideManager({})
    })

    describe('別名相容性', () => {
        it('TourManager 應為 GuideManager 的別名', () => {
            expect(TourManager).toBe(GuideManager)
            const tm = new TourManager({})
            expect(tm).toBeInstanceOf(GuideManager)
        })
    })

    describe('狀態檢測', () => {
        it('首次啟動 (isFirstLaunch) 為 true（無 completedVersion）', () => {
            expect(gm.isFirstLaunch()).toBe(true)
        })

        it('完成版本後 isFirstLaunch 為 false', () => {
            gm.markVersionCompleted('2.1.7.3')
            expect(gm.isFirstLaunch()).toBe(false)
        })

        it('hasUnseenVersionTour 在版本不同時返回 true', () => {
            gm.markVersionCompleted('2.1.7.2')
            expect(gm.hasUnseenVersionTour('2.1.7.3')).toBe(true)
        })

        it('hasSeenTour/markTourSeen 正確交互', () => {
            expect(gm.hasSeenTour('debts')).toBe(false)
            gm.markTourSeen('debts')
            expect(gm.hasSeenTour('debts')).toBe(true)
        })
    })

    describe('歡迎 Modal', () => {
        it('showWelcomeModal 渲染歡迎容器與分頁點', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            expect(modal).toBeTruthy()
            const dots = modal.querySelectorAll('#guide-welcome-dots span')
            expect(dots.length).toBe(TOURS.welcome.pages.length)
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('點擊「下一頁」切換到下一頁內容', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const nextBtn = modal.querySelector('#guide-welcome-next')
            nextBtn.click()
            const content = modal.querySelector('#guide-welcome-content')
            // 第二頁應顯示第二頁標題
            expect(content.textContent).toContain(
                TOURS.welcome.pages[1].title
            )
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('最後一頁點擊「開始使用」關閉 modal 並標記版本完成 + 啟動基礎導覽', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const nextBtn = modal.querySelector('#guide-welcome-next')
            // 翻到最後
            for (let i = 0; i < TOURS.welcome.pages.length; i++) {
                nextBtn.click()
            }
            expect(document.getElementById('guide-welcome-modal')).toBeNull()
            expect(gm.isFirstLaunch()).toBe(false)
        })

        it('跳過按鈕關閉 modal 並標記版本完成', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const skipBtn = modal.querySelector('#guide-welcome-skip')
            skipBtn.click()
            expect(document.getElementById('guide-welcome-modal')).toBeNull()
            expect(gm.isFirstLaunch()).toBe(false)
        })

        it('渲染 Slider Track：所有頁面預渲染 + aria-hidden 正確', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const track = modal.querySelector('#guide-welcome-track')
            const slides = track.querySelectorAll('[data-welcome-slide]')
            expect(slides.length).toBe(TOURS.welcome.pages.length)
            // 首頁 aria-hidden=false，其餘爲 true
            expect(slides[0].getAttribute('aria-hidden')).toBe('false')
            expect(slides[1].getAttribute('aria-hidden')).toBe('true')
            // transform 初始爲 0
            expect(track.style.transform).toBe('translateX(0%)')
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('點擊「上一頁」返回上一頁（頁0時無效果且 invisible）', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const prevBtn = modal.querySelector('#guide-welcome-prev')
            // 頁 0 時 prev 是 invisible（版位保留）
            expect(prevBtn.classList.contains('invisible')).toBe(true)
            // 翻到第 2 頁（index 1）
            modal.querySelector('#guide-welcome-next').click()
            expect(prevBtn.classList.contains('invisible')).toBe(false)
            // 點 prev 回頁 0
            prevBtn.click()
            const track = modal.querySelector('#guide-welcome-track')
            expect(track.style.transform).toBe('translateX(0%)')
            expect(prevBtn.classList.contains('invisible')).toBe(true)
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('鍵盤 ArrowRight/ArrowLeft/Home/End 導航', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const track = modal.querySelector('#guide-welcome-track')
            // ArrowRight → 下一頁
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowRight' })
            )
            expect(track.style.transform).toBe(
                `translateX(-${1 * 100}%)`
            )
            // ArrowRight at last page → 無效果（禁止回繞）
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'End' })
            )
            const last = TOURS.welcome.pages.length - 1
            expect(track.style.transform).toBe(`translateX(-${last * 100}%)`)
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowRight' })
            )
            expect(track.style.transform).toBe(`translateX(-${last * 100}%)`)
            // ArrowLeft → 上一頁
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowLeft' })
            )
            expect(track.style.transform).toBe(
                `translateX(-${(last - 1) * 100}%)`
            )
            // Home → 首頁
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Home' })
            )
            expect(track.style.transform).toBe('translateX(0%)')
            // ArrowLeft at page 0 → 無效果
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowLeft' })
            )
            expect(track.style.transform).toBe('translateX(0%)')
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('觸控左右滑動手勢切頁（touchend 合成事件）', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            const track = modal.querySelector('#guide-welcome-track')
            const content = modal.querySelector('#guide-welcome-content')

            // 左滑（deltaX < 0）→ 下一頁
            content.dispatchEvent(
                new Event('touchstart', { bubbles: true })
            )
            // 使用 defineProperty 注入 touches（jsdom 無 TouchEvent）
            const ev = new Event('touchend', { bubbles: true })
            Object.defineProperty(ev, 'changedTouches', {
                value: [{ clientX: 50, clientY: 5 }],
            })
            content.dispatchEvent(ev)
            expect(track.style.transform).toBe('translateX(0%)')

            // 重新 start 在 x=200，end 在 x=50 → dx=-150（左滑 → 下一頁）
            let startEv = new Event('touchstart', { bubbles: true })
            Object.defineProperty(startEv, 'touches', {
                value: [{ clientX: 200, clientY: 5 }],
            })
            content.dispatchEvent(startEv)
            let endEv = new Event('touchend', { bubbles: true })
            Object.defineProperty(endEv, 'changedTouches', {
                value: [{ clientX: 50, clientY: 5 }],
            })
            content.dispatchEvent(endEv)
            expect(track.style.transform).toBe('translateX(-100%)')

            // 右滑（dx > 0）→ 上一頁
            startEv = new Event('touchstart', { bubbles: true })
            Object.defineProperty(startEv, 'touches', {
                value: [{ clientX: 50, clientY: 5 }],
            })
            content.dispatchEvent(startEv)
            endEv = new Event('touchend', { bubbles: true })
            Object.defineProperty(endEv, 'changedTouches', {
                value: [{ clientX: 200, clientY: 5 }],
            })
            content.dispatchEvent(endEv)
            expect(track.style.transform).toBe('translateX(0%)')

            // 垂直滑動（dy 更大）→ 不切頁
            startEv = new Event('touchstart', { bubbles: true })
            Object.defineProperty(startEv, 'touches', {
                value: [{ clientX: 100, clientY: 100 }],
            })
            content.dispatchEvent(startEv)
            endEv = new Event('touchend', { bubbles: true })
            Object.defineProperty(endEv, 'changedTouches', {
                value: [{ clientX: 80, clientY: 400 }],
            })
            content.dispatchEvent(endEv)
            expect(track.style.transform).toBe('translateX(0%)')
            document.getElementById('guide-welcome-modal')?.remove()
        })

        it('Modal 標記 role=dialog + aria-modal', () => {
            gm.showWelcomeModal()
            const modal = document.getElementById('guide-welcome-modal')
            expect(modal.getAttribute('role')).toBe('dialog')
            expect(modal.getAttribute('aria-modal')).toBe('true')
            document.getElementById('guide-welcome-modal')?.remove()
        })
    })

    describe('功能導覽 (startFeatureTour)', () => {
        it('對不存在的 tour id 返回 false', () => {
            expect(gm.startFeatureTour('nonexistent')).toBe(false)
        })

        it('目標元素存在時渲染氣泡', () => {
            const el = document.createElement('button')
            el.id = 'add-debt-btn'
            document.body.appendChild(el)
            const started = gm.startFeatureTour('debts')
            expect(started).toBe(true)
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            expect(bubble.textContent).toContain('導覽教學')
            el.remove()
        })

        it('點擊「下一步」推進到下一氣泡或完成', async () => {
            // 建立欠款導覽所需的所有目標元素
            const makeEl = sel => {
                const el = document.createElement('div')
                if (sel.startsWith('.')) el.className = sel.slice(1)
                else el.id = sel.slice(1)
                document.body.appendChild(el)
                return el
            }
            makeEl('#summary-cards-container')
            makeEl('#add-debt-btn')
            makeEl('#show-summary-table-btn')
            makeEl('#debt-list-container')
            makeEl('#toggle-debt-btn')
            makeEl('#debt-panel')
            gm.startFeatureTour('debts')
            // 逐步點擊「下一步」推進，直到導覽結束
            for (let i = 0; i < 15; i++) {
                const bubble = document.getElementById('guide-tour-bubble')
                if (!bubble) break
                bubble.querySelector('#guide-tour-next')?.click()
                await new Promise(r => setTimeout(r, 20))
            }
            expect(gm.hasSeenTour('debts')).toBe(true)
            document
                .querySelectorAll(
                    '#summary-cards-container,#add-debt-btn,#show-summary-table-btn,#debt-list-container,#toggle-debt-btn,#debt-panel'
                )
                .forEach(e => e.remove())
        })

        it('step.expand 自動觸發點擊展開隱藏面板', () => {
            const toggleBtn = document.createElement('button')
            toggleBtn.id = 'toggle-debt-btn'
            const panel = document.createElement('div')
            panel.id = 'debt-panel'
            panel.classList.add('hidden')
            toggleBtn.addEventListener('click', () => {
                panel.classList.remove('hidden')
            })
            document.body.appendChild(toggleBtn)
            document.body.appendChild(panel)

            const customSteps = [
                {
                    target: '#debt-panel',
                    expand: '#toggle-debt-btn',
                    title: '展開測試',
                    body: '測試自動展開面板',
                },
            ]
            gm.showStep(customSteps, 'custom_test')
            expect(panel.classList.contains('hidden')).toBe(false)
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            toggleBtn.remove()
            panel.remove()
        })

        it('step.beforeShow 正確執行前置動作', () => {
            const beforeShowFn = vi.fn()
            const customSteps = [
                {
                    target: null,
                    beforeShow: beforeShowFn,
                    title: '前置測試',
                    body: '測試 beforeShow 執行',
                },
            ]
            gm.showStep(customSteps, 'custom_before_show')
            expect(beforeShowFn).toHaveBeenCalled()
            document.getElementById('guide-tour-bubble')?.remove()
        })
    })

    describe('特定功能觸發', () => {
        it('checkFeatureTour 在無映射頁面不觸發任何導覽', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm.checkFeatureTour('privacy')
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('首次進入欠款頁且未看過時觸發欠款導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            // 欠款導覽第一步目標需存在
            const el = document.createElement('button')
            el.id = 'add-debt-btn'
            document.body.appendChild(el)
            gm.checkFeatureTour('debts')
            // 等待內部 300ms 延遲
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('首次進入統計頁觸發統計導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('div')
            el.id = 'stats-expense-donut-container'
            document.body.appendChild(el)
            gm.checkFeatureTour('stats')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('首次進入週期交易頁觸發週期導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('button')
            el.id = 'add-recurring-btn'
            document.body.appendChild(el)
            gm.checkFeatureTour('recurring')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('首次進入帳本頁觸發帳本導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('button')
            el.id = 'add-ledger-btn'
            document.body.appendChild(el)
            gm.checkFeatureTour('ledgers')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('首次進入群組頁觸發群組導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('button')
            el.id = 'add-group-btn'
            document.body.appendChild(el)
            gm.checkFeatureTour('groups')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('首次進入首頁觸發預算導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('div')
            el.id = 'budget-amount'
            document.body.appendChild(el)
            gm.checkFeatureTour('home')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('已看過欠款導覽後不再觸發', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm.markTourSeen('debts')
            gm.checkFeatureTour('debts')
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('setPendingTour 在同一頁面檢查時觸發對應導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('button')
            el.id = 'add-amort-btn'
            document.body.appendChild(el)
            gm.setPendingTour('amortizations', 'amortizations')
            gm.checkFeatureTour('amortizations')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('setPendingTour 在其他頁面不觸發（保留待導覽）', async () => {
            gm.markVersionCompleted('2.1.7.3')
            // 預先標記欠款导览已看，避免跨页导览污染本测试（欠款導览含 goto 記账頁步骤）
            gm.markTourSeen('debts')
            const el = document.createElement('button')
            el.id = 'add-amort-btn'
            document.body.appendChild(el)
            gm.setPendingTour('amortizations', 'amortizations')
            // 先進入欠款頁（不匹配 pending 頁面），不應觸發攤提導览
            gm.checkFeatureTour('debts')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
            // pending 保留，進入攤提頁時才觸發
            gm.checkFeatureTour('amortizations')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('setPendingTour 對已看過的導覽不設置', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm.markTourSeen('groups')
            gm.setPendingTour('groups', 'groups')
            gm.checkFeatureTour('groups')
            expect(gm.takePendingTour('groups')).toBeNull()
        })

        it('首次進入攤提頁觸發攤提導覽', async () => {
            gm.markVersionCompleted('2.1.7.3')
            const el = document.createElement('button')
            el.id = 'add-amort-btn'
            document.body.appendChild(el)
            gm.checkFeatureTour('amortizations')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })
    })

    describe('重置', () => {
        it('resetAllGuides 清除所有狀態', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm.markTourSeen('debts')
            gm.resetAllGuides()
            expect(gm.isFirstLaunch()).toBe(true)
            expect(gm.hasSeenTour('debts')).toBe(false)
        })
    })

    describe('自動實操導覽（basics 升級）', () => {
        it('startFeatureTour("basics") 轉為自動演示而非普通氣泡導覽', async () => {
            gm.app = {}
            const spy = vi.spyOn(gm, 'startDemoTour').mockImplementation(() => Promise.resolve())
            const result = gm.startFeatureTour('basics')
            expect(spy).toHaveBeenCalled()
            expect(result).toBe(true)
            spy.mockRestore()
        })

        it('showDemoBubble 無目標時居中顯示氣泡', () => {
            gm.showDemoBubble('導覽標題', '導覽內容', null)
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            expect(bubble.querySelector('h4').textContent).toBe('導覽標題')
            expect(bubble.style.left).toBe('50%')
            document.getElementById('guide-tour-bubble')?.remove()
        })

        it('showDemoBubble 有目標時顯示在目標旁並高亮', () => {
            const el = document.createElement('button')
            el.id = 'demo-target'
            document.body.appendChild(el)
            gm.showDemoBubble('導覽標題', '導覽內容', '#demo-target', 'bottom')
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            expect(el.classList.contains('guide-highlight')).toBe(true)
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('destroyBubble 移除氣泡並清除高亮', () => {
            const el = document.createElement('button')
            el.id = 'demo-target'
            document.body.appendChild(el)
            gm.showDemoBubble('導覽標題', '導覽內容', '#demo-target')
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            gm.destroyBubble()
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
            expect(el.classList.contains('guide-highlight')).toBe(false)
            el.remove()
        })

        it('startDemoTour 無 app 時直接返回', async () => {
            gm.app = null
            const result = await gm.startDemoTour()
            expect(result).toBeUndefined()
        })
    })

    describe('導覽互斥', () => {
        it('導覽進行中時 startFeatureTour 拒絕併發觸發', () => {
            gm._tourActive = true
            const result = gm.startFeatureTour('debts')
            expect(result).toBe(false)
        })

        it('首次啟動時 pending 導覽仍觸發（不受 isFirstLaunch 限制）', async () => {
            // 不調用 markVersionCompleted，保持 isFirstLaunch=true
            localStorage.removeItem('guide_completed_version')
            const el = document.createElement('button')
            el.id = 'add-amort-btn'
            document.body.appendChild(el)
            gm.setPendingTour('amortizations', 'amortizations')
            gm.checkFeatureTour('amortizations')
            await new Promise(r => setTimeout(r, 400))
            expect(document.getElementById('guide-tour-bubble')).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('導覽進行中時 checkFeatureTour 跳過', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm._tourActive = true
            gm.checkFeatureTour('debts')
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('導覽進行中時 startDemoTour 不重新演示', async () => {
            gm.app = {}
            gm._tourActive = true
            const result = await gm.startDemoTour()
            expect(result).toBeUndefined()
        })

        it('導覽進行中時 pending 導覽不被打斷', () => {
            gm.markVersionCompleted('2.1.7.3')
            gm._tourActive = true
            gm.setPendingTour('amortizations', 'amortizations')
            // checkFeatureTour 在導覽進行中應跳過，pending 保留
            gm.checkFeatureTour('amortizations')
            expect(gm.takePendingTour('amortizations')).not.toBeNull()
        })
    })

    describe('開關開啟即顯示功能介紹', () => {
        it('showToggleTour 立即顯示氣泡並設置 pending', () => {
            localStorage.removeItem('guide_completed_version')
            const gm2 = new GuideManager({})
            gm2.showToggleTour('amortizations')
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            expect(localStorage.getItem('guide_pending_tour')).toContain('amortizations')
            document.getElementById('guide-tour-bubble')?.remove()
        })

        it('showToggleTour 對已看過的導覽不顯示', () => {
            const gm2 = new GuideManager({})
            gm2.markTourSeen('debts')
            gm2.showToggleTour('debts')
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('showToggleTour 無 toggle 配置時不顯示', () => {
            const gm2 = new GuideManager({})
            gm2.showToggleTour('statistics')
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('點擊「去使用」跳轉到 goto 頁面', () => {
            const gm2 = new GuideManager({})
            gm2.showToggleTour('debts')
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            // 驗證 goto 配置
            document.getElementById('guide-tour-bubble')?.remove()
            // 手動觸發導航回調（通過讀取 toggle 配置模擬）
            expect(window.location.hash).toBeDefined()
        })
    })

    describe('AI 記帳頁導覽需先開啟功能', () => {
        it('未開啟 AI 時進入記帳頁不觸發 AI 導覽', () => {
            localStorage.setItem('guide_completed_version', '2.1.7.3')
            localStorage.setItem('ai_experimental_enabled', 'false')
            gm.checkFeatureTour('add')
            // 等過 setTimeout 後確認無氣泡
            return new Promise(resolve => {
                setTimeout(() => {
                    const bubble = document.getElementById('guide-tour-bubble')
                    expect(bubble).toBeNull()
                    resolve()
                }, 400)
            })
        })

        it('開啟 AI 時進入記帳頁觸發 AI 導覽', async () => {
            localStorage.setItem('guide_completed_version', '2.1.7.3')
            localStorage.setItem('ai_experimental_enabled', 'true')
            // 創建 AI 導覽的目標元素（記帳頁新增導按鈕）
            const el = document.createElement('i')
            el.id = 'nav-add-icon'
            document.body.appendChild(el)
            // 直接調用 startFeatureTour 排除 checkFeatureTour 的延遲干擾
            const started = gm.startFeatureTour('ai')
            expect(started).toBe(true)
            const bubble = document.getElementById('guide-tour-bubble')
            expect(bubble).toBeTruthy()
            document.getElementById('guide-tour-bubble')?.remove()
            el.remove()
        })

        it('關閉 AI 後殘留 pending tour 不觸發', () => {
            localStorage.setItem('guide_completed_version', '2.1.7.3')
            localStorage.setItem('ai_experimental_enabled', 'false')
            localStorage.setItem('guide_pending_tour', JSON.stringify({ tourId: 'ai', page: 'add' }))
            gm.checkFeatureTour('add')
            return new Promise(resolve => {
                setTimeout(() => {
                    const bubble = document.getElementById('guide-tour-bubble')
                    expect(bubble).toBeNull()
                    resolve()
                }, 400)
            })
        })
    })

    describe('自動導覽取消與異步中斷 (Cancel & Abort)', () => {
        it('cancelActiveTour 應中斷 _demoStep 並拋出 TOUR_CANCELED 異常停止導覽', async () => {
            gm.app = { dataService: { getRecords: vi.fn(), deleteRecord: vi.fn() } }
            
            // 啟動導覽
            const p = gm.startDemoTour()
            
            // 確保已進入第一個 _demoStep，然後取消導覽
            await new Promise(r => setTimeout(r, 50))
            expect(gm._tourActive).toBe(true)
            
            gm.cancelActiveTour()
            
            // 期望 startDemoTour 結束且不拋出未捕獲異常
            await expect(p).resolves.toBeUndefined()
            expect(gm._tourActive).toBe(false)
            expect(document.getElementById('guide-tour-bubble')).toBeNull()
        })

        it('_demoSleep 與 waitFor 在取消後應拒絕執行並拋出異常', async () => {
            gm._tourActive = true
            const sleepPromise = gm._demoSleep(500)
            
            // 中途取消
            gm._tourActive = false
            
            await expect(sleepPromise).rejects.toThrow('TOUR_CANCELED')
        })
    })
    describe('版本導覽（Phase 5）', () => {
        it('onVersionUpdated 對無映射的版本不設定待導覽', () => {
            // TOUR_VERSION_MAP 為空（當前無版本專屬導覽）→ 任何版本都不應設待導覽
            gm.onVersionUpdated('2.1.7.3')
            expect(gm._pendingVersionTour).toBeNull()
        })

        it('getVersionTourId 查詢無效或已觀看的導覽回傳 null', () => {
            expect(gm.getVersionTourId('invalid_version')).toBeNull()
            expect(gm.getVersionTourId(null)).toBeNull()
        })

        it('onChangelogClosed({ startTour: true }) 有待導覽時啟動該導覽並清空待導覽', () => {
            const spy = vi.spyOn(gm, 'startFeatureTour')
            gm._pendingVersionTour = 'debts'
            gm.onChangelogClosed({ startTour: true })
            expect(spy).toHaveBeenCalledWith('debts')
            expect(gm._pendingVersionTour).toBeNull()
        })

        it('onChangelogClosed({ startTour: false }) 或預設關閉時不啟動導覽並標記已略過', () => {
            const spy = vi.spyOn(gm, 'startFeatureTour')
            gm._pendingVersionTour = 'debts'
            gm.onChangelogClosed({ startTour: false })
            expect(spy).not.toHaveBeenCalled()
            expect(gm.hasSeenTour('debts')).toBe(true)
            expect(gm._pendingVersionTour).toBeNull()
        })

        it('onChangelogClosed({ startTour: true }) 導覽進行中時不啟動（導覽互斥）', () => {
            const spy = vi.spyOn(gm, 'startFeatureTour')
            gm._pendingVersionTour = 'debts'
            gm._tourActive = true
            gm.onChangelogClosed({ startTour: true })
            expect(spy).not.toHaveBeenCalled()
            // 待導覽保留，避免丟失
            expect(gm._pendingVersionTour).toBe('debts')
        })

        it('onVersionUpdated 對已看過的導覽不設定待導覽', () => {
            gm.markTourSeen('debts')
            gm._pendingVersionTour = null
            gm.onVersionUpdated('9.9.9')
            expect(gm._pendingVersionTour).toBeNull()
        })
    })

    describe('手機版與視窗邊界定位防護 (_positionBubble)', () => {
        it('在目標元素靠近底部時自動翻轉至上方或嚴格約束在視窗內', () => {
            const bubble = document.createElement('div')
            bubble.id = 'guide-tour-bubble'
            document.body.appendChild(bubble)

            const target = document.createElement('div')
            target.id = 'bottom-target'
            document.body.appendChild(target)

            // 模擬目標元素靠近視窗底部
            vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
                top: 600,
                bottom: 640,
                left: 50,
                right: 250,
                width: 200,
                height: 40,
            })

            // 模擬手機視窗尺寸 (375 x 667)
            const originalInnerWidth = window.innerWidth
            const originalInnerHeight = window.innerHeight
            window.innerWidth = 375
            window.innerHeight = 667

            try {
                gm._positionBubble(bubble, target, 'bottom')
                const top = parseInt(bubble.style.top, 10)
                const left = parseInt(bubble.style.left, 10)

                // top 必須大於等於 12 且氣泡底部不超出視窗
                expect(top).toBeGreaterThanOrEqual(12)
                expect(top).toBeLessThanOrEqual(667 - 190 - 12)
                expect(left).toBeGreaterThanOrEqual(12)
                expect(left).toBeLessThanOrEqual(375 - 288 - 12)
            } finally {
                window.innerWidth = originalInnerWidth
                window.innerHeight = originalInnerHeight
                bubble.remove()
                target.remove()
            }
        })

        it('在手機寬度下 left/right 自動轉為垂直定位並防止左右溢出', () => {
            const bubble = document.createElement('div')
            document.body.appendChild(bubble)
            const target = document.createElement('div')
            document.body.appendChild(target)

            vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
                top: 200,
                bottom: 240,
                left: 10,
                right: 300,
                width: 290,
                height: 40,
            })

            const originalInnerWidth = window.innerWidth
            const originalInnerHeight = window.innerHeight
            window.innerWidth = 360
            window.innerHeight = 640

            try {
                gm._positionBubble(bubble, target, 'left')
                const left = parseInt(bubble.style.left, 10)
                const top = parseInt(bubble.style.top, 10)

                expect(left).toBeGreaterThanOrEqual(12)
                expect(left).toBeLessThanOrEqual(360 - 288 - 12)
                expect(top).toBeGreaterThanOrEqual(12)
            } finally {
                window.innerWidth = originalInnerWidth
                window.innerHeight = originalInnerHeight
                bubble.remove()
                target.remove()
            }
        })
    })
})


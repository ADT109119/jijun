// ==================== TourManager (導覽功能引擎) ====================
// #U08 導覽功能 (Onboarding & Feature Tour)
// 模組化檔案架構：
//  - tours/ 目錄: 每個導覽獨立文件（welcome/basics/debts/accounts/...）
//  - tours/index.js: 導覽註冊表（匯入所有導覽配置匯出 TOURS）
//  - TourManager: 導覽引擎（歡迎Modal、氣泡引導、狀態持久化）
// 類名保留 GuideManager 以兼容既有集成點。
// 狀態存於 localStorage，避免重複打擾用戶。
import { TOURS } from './tours/index.js'
export { TOURS }
import { escapeHTML } from './utils.js'

// ── 存儲鍵 ────────────────────────────────
const STORAGE_KEY = {
    // 記錄「已完成導引的版本」，格式如 '2.1.7.1'
    completedVersion: 'guide_completed_version',
    // 每個功能導覽是否已看過（如 tour_debts）
    tourSeen: key => `guide_tour_${key}_seen`,
    // 待觸發的實驗功能導覽（如 pending=amortizations），開啟實驗功能時設定
    pendingTour: 'guide_pending_tour',
}

// 自動實操導覽創建的測試記錄備注，用於中途取消時清理
const DEMO_TEST_DESC = '導覽測試記錄'

/**
 * 版本 → 專屬導覽 映射表（Phase 5 版本導覽）。
 * 當用戶升級到這些版本時，於 Changelog Modal 關閉後觸發對應導覽。
 * 格式: { '版本號': '導覽 ID' }，導覽 ID 必須在 TOURS 註冊表中存在。
 * 例: 若 2.2.0 發版時想引導用戶體驗新功能，添加 '2.2.0': 'xxxTour'。
 * ⚠️ 當前版本無專屬導覽，映射表保持為空（預留框架）。
 */
const TOUR_VERSION_MAP = {}

function getStored(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null')
    } catch {
        return null
    }
}

function setStored(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
        console.error('Failed to persist guide state:', e)
    }
}

export class GuideManager {
    constructor(app = null) {
        this.app = app
        this.currentTourIndex = 0
        this.currentWelcomePage = 0
        this.bubble = null
        this.latestVersion = null
        // 導覽互斥：導覽進行中為 true，避免其他導覽打斷
        this._tourActive = false
        this._currentStepReject = null
        // 待觸發的版本導覽（changelog 關閉後觸發），null = 無待導覽
        this._pendingVersionTour = null
        this._repositionListener = null
    }

    // ── 狀態查詢 ────────────────────────────

    /**
     * 判斷是否為「初次開啟」（尚未完成的版本記錄）
     */
    isFirstLaunch() {
        return !getStored(STORAGE_KEY.completedVersion)
    }

    /**
     * 判斷指定版本是否有未看過的導覽
     */
    hasUnseenVersionTour(version) {
        const lastSeen = getStored(STORAGE_KEY.completedVersion)
        return !lastSeen || lastSeen !== version
    }

    /**
     * 查詢指定版本是否有專屬且未看過的導覽 ID
     * @param {string} version 版本號
     * @returns {string|null} 導覽 ID 或 null
     */
    getVersionTourId(version) {
        if (!version) return null
        const tourId = TOUR_VERSION_MAP[version]
        if (!tourId) return null
        if (!TOURS[tourId]) {
            console.warn(`[TourManager] TOUR_VERSION_MAP 引用的導覽不存在: ${tourId}`)
            return null
        }
        if (this.hasSeenTour(tourId)) return null
        return tourId
    }

    /**
     * 版本更新導覽：當 app 升級到新版本時調用（ChangelogManager 通知）。
     * @param {string} latestVersion 當前應用版本號
     */
    onVersionUpdated(latestVersion) {
        this.latestVersion = latestVersion
        this._pendingVersionTour = this.getVersionTourId(latestVersion)
    }

    /**
     * Changelog Modal 關閉後的回調。
     * 只有當使用者在更新彈窗點擊「查看教學」時（startTour: true），才啟動導覽；
     * 若使用者直接關閉或選擇「我知道了」，則將該導覽標記為已略過，避免強制打擾。
     * @param {Object|boolean} [options={}] options 物件或 startTour 布林值
     */
    onChangelogClosed(options = {}) {
        const startTour = typeof options === 'boolean' ? options : !!options?.startTour
        const targetTourId = (typeof options === 'object' && options?.tourId) || this._pendingVersionTour

        if (!startTour) {
            if (targetTourId) {
                this.markTourSeen(targetTourId)
            }
            this._pendingVersionTour = null
            return
        }

        if (!targetTourId) return
        if (this._tourActive) return
        this._pendingVersionTour = null
        this.startFeatureTour(targetTourId)
    }

    /**
     * 判斷功能導覽是否已看過
     */
    hasSeenTour(tourId) {
        return !!getStored(STORAGE_KEY.tourSeen(tourId))
    }

    markTourSeen(tourId) {
        setStored(STORAGE_KEY.tourSeen(tourId), true)
    }

    /**
     * 設定待觸發的導覽（實驗功能開啟時調用）。
     * 僅當該導覽未看過時才設定，避免已看過的功能重複觸發。
     * 導覽會與目標頁面綁定，僅在進入該頁面時觸發。
     * @param {string} tourId 導覽 id（如 'accounts'、'amortizations'、'ai'）
     * @param {string} pageName 導覽應綁定的頁面名（如 'accounts'、'amortizations'、'add'）
     */
    setPendingTour(tourId, pageName) {
        if (!TOURS[tourId]) return
        if (this.hasSeenTour(tourId)) return
        setStored(STORAGE_KEY.pendingTour, { tourId, page: pageName || tourId })
    }

    /**
     * 開啟實驗功能時，在設定頁立即顯示功能介紹氣泡（無需進入管理頁）。
     * 氣泡含「去使用」按鈕跳轉到對應頁面。同時設置 pending 供操作導覽在目標頁觸發。
     * @param {string} tourId 導覽 id
     */
    showToggleTour(tourId) {
        const tour = TOURS[tourId]
        if (!tour || !tour.toggle) return
        if (this.hasSeenTour(tourId)) return
        // 設置 pending（進入目標頁時觸發操作導覽）
        this.setPendingTour(tourId, tour.toggle.goto ? tour.toggle.goto.substring(1) : tourId)
        // 導覽互斥：若已有其他導覽進行中，不彈出氣泡打斷，僅保留 pending（進入目標頁時仍會觸發）
        if (this._tourActive) return
        // 在設定頁立即顯示介紹氣泡
        this.showDemoBubble(
            tour.toggle.title,
            tour.toggle.body,
            null, // 居中顯示（不定位到具體元素）
            'bottom',
            () => {
                if (tour.toggle.goto) window.location.hash = tour.toggle.goto
            },
            () => {
                // 關閉提示，pending 已保留，進入目標頁仍會觸發操作導覽
            },
            tour.toggle.gotoLabel || '去使用'
        )
    }

    /**
     * 取出與當前頁面匹配的待觸發導覽；若不匹配則保留。
     * @param {string} pageName 當前頁面名
     * @returns {string|null} 待觸發導覽 id（無則返回 null）
     */
    takePendingTour(pageName) {
        const pending = getStored(STORAGE_KEY.pendingTour)
        if (!pending) return null
        if (pending.page && pending.page !== pageName) return null
        localStorage.removeItem(STORAGE_KEY.pendingTour)
        return pending.tourId
    }

    markVersionCompleted(version) {
        setStored(STORAGE_KEY.completedVersion, version)
    }

    // ── 初始化 ──────────────────────────────

    /**
     * 啟動時調用。決定是否展示歡迎導覽 / 版本更新導覽。
     * @param {string} currentVersion 當前應用版本 (e.g. '2.1.7.3')
     */
    init(currentVersion = '__APP_VERSION__') {
        this.latestVersion = currentVersion

        // 初次開啟：展示歡迎 Modal
        if (this.isFirstLaunch()) {
            this.showWelcomeModal()
            return
        }

        // 非首次啟動：記錄版本狀態，版本導覽交由更新彈窗由使用者自主決定是否查看
        this.onVersionUpdated(currentVersion)
    }

    // ── 歡迎 Modal (可右翻頁) ───────────────

    showWelcomeModal() {
        // 若未通過 init() 設定版本（如從設定頁手動開啟），使用默認值以便正確標記完成
        if (!this.latestVersion) {
            this.latestVersion = '__APP_VERSION__'
        }

        const existing = document.getElementById('guide-welcome-modal')
        if (existing) existing.remove()

        const tour = TOURS.welcome
        this.currentWelcomePage = 0

        const modal = document.createElement('div')
        modal.id = 'guide-welcome-modal'
        modal.className =
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in'
        // 無障礙：標為 dialog 供螢幕閱讀器
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')
        modal.setAttribute('aria-label', '歡迎導引')

        // 動態減速偏好：減少動畫時直接切頁
        let prefersReducedMotion = false
        if (typeof window !== 'undefined' && window.matchMedia) {
            try {
                prefersReducedMotion = window.matchMedia(
                    '(prefers-reduced-motion: reduce)'
                ).matches
            } catch (e) {
                /* 忽略：matchMedia 異常時用默認動畫 */
            }
        }
        // 僅觸控設備顯示滑動手勢提示
        const isCoarsePointer =
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(pointer: coarse)').matches

        modal.innerHTML = `
      <div class="bg-wabi-surface border border-wabi-border rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-modal-pop" role="presentation">
        <!-- 頁面內容（Slider Track：所有頁面一次渲染，translateX 平滑滑動） -->
        <div id="guide-welcome-content" class="relative overflow-hidden" aria-live="polite">
          <div id="guide-welcome-track"
               class="flex ${prefersReducedMotion ? '' : 'transition-transform duration-300'}"
               style="transform: translateX(0)">
            ${tour.pages
                .map(
                    (page, i) => `
              <div class="w-full flex-none p-8 text-center" data-welcome-slide="${i}" aria-hidden="${i !== 0 ? 'true' : 'false'}">
                <div class="size-20 mx-auto rounded-3xl bg-wabi-primary/10 text-wabi-primary flex items-center justify-center text-4xl mb-5 shadow-inner">
                  <i class="${page.icon}"></i>
                </div>
                <h3 class="text-xl font-extrabold text-wabi-text-primary mb-3" data-welcome-title>${escapeHTML(page.title)}</h3>
                <p class="text-sm text-wabi-text-secondary leading-relaxed">${escapeHTML(page.body)}</p>
              </div>`
                )
                .join('')}
          </div>
          ${isCoarsePointer ? '<p class="px-4 pb-1 text-center text-xs text-wabi-text-secondary/80" data-welcome-hint>← 左右滑動切換頁面 →</p>' : ''}
        </div>
        <!-- 底部控制 -->
        <div class="p-4 bg-wabi-bg/50 border-t border-wabi-border/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button id="guide-welcome-prev" class="invisible px-4 py-2 text-sm font-medium text-wabi-text-secondary rounded-xl hover:bg-wabi-bg transition-colors" aria-label="上一頁">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <button id="guide-welcome-skip" class="px-4 py-2 text-sm font-medium text-wabi-text-secondary rounded-xl hover:bg-wabi-bg transition-colors" aria-label="跳過導引">跳過</button>
          </div>
          <div id="guide-welcome-dots" class="flex items-center gap-1.5"></div>
          <button id="guide-welcome-next" class="px-5 py-2 bg-wabi-primary text-wabi-surface text-sm font-bold rounded-2xl hover:opacity-90 transition-opacity shadow-md" aria-label="下一頁">下一頁</button>
        </div>
      </div>
    `

        document.body.appendChild(modal)

        const track = modal.querySelector('#guide-welcome-track')
        const dotsEl = modal.querySelector('#guide-welcome-dots')
        const nextBtn = modal.querySelector('#guide-welcome-next')
        const prevBtn = modal.querySelector('#guide-welcome-prev')
        const skipBtn = modal.querySelector('#guide-welcome-skip')
        const hintEl = modal.querySelector('[data-welcome-hint]')

        // 統一頁面切換：clamp 0..N-1（禁止回繞），更新 transform / dots / 按鈕狀態
        const goTo = index => {
            const max = tour.pages.length - 1
            const clamped = Math.max(0, Math.min(index, max))
            if (clamped === this.currentWelcomePage && clamped !== 0) return
            this.currentWelcomePage = clamped
            track.style.transform = `translateX(${clamped === 0 ? 0 : -clamped * 100}%)`
            track
                .querySelectorAll('[data-welcome-slide]')
                .forEach((slide, i) => {
                    slide.setAttribute('aria-hidden', i === clamped ? 'false' : 'true')
                })
            // 圓點指示
            dotsEl.innerHTML = tour.pages
                .map(
                    (_, i) =>
                        `<span class="w-2 h-2 rounded-full transition-colors ${i === clamped ? 'bg-wabi-primary' : 'bg-wabi-border'}"></span>`
                )
                .join('')
            // 按鈕狀態
            const isLast = clamped === max
            nextBtn.innerHTML = isLast
                ? '<i class="fa-solid fa-rocket mr-1"></i>開始使用'
                : '下一頁'
            nextBtn.setAttribute('aria-label', isLast ? '開始使用' : '下一頁')
            prevBtn.classList.toggle('invisible', clamped === 0)
            if (hintEl) {
                hintEl.classList.toggle('opacity-0', clamped > 0)
            }
        }

        const closeWelcome = () => {
            if (!document.contains(modal)) return
            modal.remove()
        }

        const finishWelcome = () => {
            closeWelcome()
            this.markVersionCompleted(this.latestVersion)
            // 關閉歡迎後（若用戶選擇開始使用）啟動基礎導覽
            this.startFeatureTour('basics')
        }

        // 統一的鍵盤處理：Escape 關閉；方向鍵/Home/End 導航
        const handleKeydown = e => {
            if (e.key === 'Escape') {
                closeWelcome()
                this.markVersionCompleted(this.latestVersion)
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                if (this.currentWelcomePage < tour.pages.length - 1) {
                    goTo(this.currentWelcomePage + 1)
                }
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                if (this.currentWelcomePage > 0) {
                    goTo(this.currentWelcomePage - 1)
                }
            } else if (e.key === 'Home') {
                e.preventDefault()
                goTo(0)
            } else if (e.key === 'End') {
                e.preventDefault()
                goTo(tour.pages.length - 1)
            }
        }
        document.addEventListener('keydown', handleKeydown)

        // 觸控滑動手勢（僅觸控設備行為，desktop 無影響）
        let touchStartX = null
        let touchStartY = null
        const handleTouchStart = e => {
            const t = e.touches && e.touches[0]
            if (!t) return
            touchStartX = t.clientX
            touchStartY = t.clientY
        }
        const handleTouchEnd = e => {
            if (touchStartX === null) return
            const t = e.changedTouches && e.changedTouches[0]
            if (!t) {
                touchStartX = null
                touchStartY = null
                return
            }
            const deltaX = t.clientX - touchStartX
            const deltaY = t.clientY - touchStartY
            touchStartX = null
            touchStartY = null
            // 僅當水平位移佔優且超閾值才切頁（防誤觸垂直捲動）
            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                if (deltaX < 0) {
                    // 左滑 → 下一頁
                    if (this.currentWelcomePage < tour.pages.length - 1) {
                        goTo(this.currentWelcomePage + 1)
                    }
                } else {
                    // 右滑 → 上一頁
                    if (this.currentWelcomePage > 0) {
                        goTo(this.currentWelcomePage - 1)
                    }
                }
            }
        }
        const welcomeContent = modal.querySelector('#guide-welcome-content')
        welcomeContent.addEventListener('touchstart', handleTouchStart, { passive: true })
        welcomeContent.addEventListener('touchend', handleTouchEnd, { passive: true })

        skipBtn.addEventListener('click', () => {
            closeWelcome()
            this.markVersionCompleted(this.latestVersion)
        })

        prevBtn.addEventListener('click', () => {
            if (this.currentWelcomePage > 0) {
                goTo(this.currentWelcomePage - 1)
            }
        })

        nextBtn.addEventListener('click', () => {
            if (this.currentWelcomePage < tour.pages.length - 1) {
                goTo(this.currentWelcomePage + 1)
            } else {
                finishWelcome()
            }
        })

        // 關閉後統一清理所有監聽器 + 恢復焦點
        const previousActiveEl = document.activeElement
        const originalRemove = modal.remove.bind(modal)
        modal.remove = () => {
            document.removeEventListener('keydown', handleKeydown)
            welcomeContent.removeEventListener('touchstart', handleTouchStart)
            welcomeContent.removeEventListener('touchend', handleTouchEnd)
            originalRemove()
            // 焦點恢復到觸發元素（若仍掛載且有 focus）
            if (previousActiveEl && previousActiveEl.focus && document.contains(previousActiveEl)) {
                try {
                    previousActiveEl.focus()
                } catch (e) {
                    /* 忽略：無障礙異常時靜默 */
                }
            }
        }

        goTo(0)
    }

    // ── 對話氣泡導覽 ────────────────────────

    /**
     * 啟動一個功能導覽（對話氣泡式逐步導引）
     * @param {string} tourId TOURS 中的導覽 id
     */
    startFeatureTour(tourId) {
        // 導覽互斥：已有導覽進行中則拒絕併發觸發
        if (this._tourActive) return false

        // 基礎導覽（初次開始使用）→ 自動實操演示完整記帳流程
        if (tourId === 'basics') {
            this.startDemoTour()
            return true
        }
        const tour = TOURS[tourId]
        if (!tour || !tour.steps) return false

        // 清理已有氣泡
        this.destroyBubble()

        this.currentTourIndex = 0
        const steps = tour.steps

        if (steps.length === 0) {
            this.markTourSeen(tour.id)
            return false
        }

        // 標記導覽進行中
        this._tourActive = true
        this.showStep(steps, tour.id)
        return true
    }

    /**
     * 智能計算氣泡位置並嚴格約束在手機與桌機視窗內（防止在手機端破版或超出螢幕）
     * @param {HTMLElement} bubble 氣泡元素
     * @param {HTMLElement|null} targetEl 目標元素
     * @param {string} preferredPosition 偏好方向 'top' | 'bottom' | 'left' | 'right'
     */
    _positionBubble(bubble, targetEl, preferredPosition = 'top') {
        if (!bubble) return

        const vw = typeof window !== 'undefined' ? window.innerWidth : 375
        const vh = typeof window !== 'undefined' ? window.innerHeight : 667
        const margin = 12
        const offset = 12

        // 無目標元素時居中顯示
        if (!targetEl || typeof targetEl.getBoundingClientRect !== 'function') {
            bubble.style.left = '50%'
            bubble.style.top = '25%'
            bubble.style.transform = 'translateX(-50%)'
            return
        }

        bubble.style.transform = '' // 清除居中 transform

        const rect = targetEl.getBoundingClientRect()
        const bw = bubble.offsetWidth || 288
        const bh = bubble.offsetHeight || 190

        // 計算水平基準 (預設盡量對齊目標中心)
        let left = rect.left + rect.width / 2 - bw / 2
        // 水平邊界防溢出
        left = Math.max(margin, Math.min(left, vw - bw - margin))

        // 計算垂直可用空間
        const spaceAbove = rect.top
        const spaceBelow = vh - rect.bottom
        let top

        let side = preferredPosition
        // 在手機垂直螢幕（寬度 < 640px）上，left/right 容易超出左右邊界，自動轉換為 top/bottom
        if (vw < 640 && (side === 'left' || side === 'right')) {
            side = spaceBelow >= spaceAbove ? 'bottom' : 'top'
        }

        // 智能翻轉：若指定方向空間不足且另一側空間更大時翻轉
        if (side === 'top' && spaceAbove < bh + offset + margin && spaceBelow > spaceAbove) {
            side = 'bottom'
        } else if (side === 'bottom' && spaceBelow < bh + offset + margin && spaceAbove > spaceBelow) {
            side = 'top'
        }

        switch (side) {
            case 'bottom':
                top = rect.bottom + offset
                break
            case 'left':
                left = rect.left - bw - offset
                top = rect.top + rect.height / 2 - bh / 2
                break
            case 'right':
                left = rect.right + offset
                top = rect.top + rect.height / 2 - bh / 2
                break
            case 'top':
            default:
                top = rect.top - bh - offset
                break
        }

        // 嚴格 Viewport Clamping：確保氣泡 100% 完整落在可視畫面內
        const minTop = margin
        const maxTop = Math.max(minTop, vh - bh - margin)
        top = Math.max(minTop, Math.min(top, maxTop))

        const minLeft = margin
        const maxLeft = Math.max(minLeft, vw - bw - margin)
        left = Math.max(minLeft, Math.min(left, maxLeft))

        bubble.style.left = `${Math.round(left)}px`
        bubble.style.top = `${Math.round(top)}px`
    }

    showStep(steps, tourId) {
        if (this.currentTourIndex >= steps.length) {
            // 導覽結束
            this.markTourSeen(tourId)
            this._tourActive = false
            this.destroyBubble()
            // Bug 4 修復：導覽結束後補發積壓的版本導覽（之前若互斥被跳過）
            if (this._pendingVersionTour) {
                setTimeout(() => this.onChangelogClosed(), 100)
            }
            return
        }

        // 清除上一步的氣泡與高亮
        this.destroyBubble()

        const step = steps[this.currentTourIndex]
        if (!step) {
            this._tourActive = false
            return
        }

        // 執行步驟前置動作（如自訂操作或準備）
        if (typeof step.beforeShow === 'function') {
            try {
                step.beforeShow()
            } catch (e) {
                console.warn('[TourManager] beforeShow 執行異常:', e)
            }
        }

        // 若步驟指定需展開的按鈕（如記帳頁展開欠款/群組/分期面板），若目標隱藏則自動觸發點擊
        if (step.expand) {
            const expandEl = document.querySelector(step.expand)
            if (expandEl) {
                const targetCheck = step.target ? document.querySelector(step.target) : null
                if (!targetCheck || targetCheck.classList.contains('hidden') || targetCheck.offsetParent === null) {
                    expandEl.click()
                }
            }
        }

        const targetEl = step.target ? document.querySelector(step.target) : null

        // 目標存在（或無目標）時重置跨頁重試計數，進入正常展示
        if (!step.target || targetEl) {
            this._gotoRetry = 0
        }

        // 若指定了目標但暫不存在：
        // 1) 若該步驟指定了 goto（跨頁目標），則先導航到目標頁，等待渲染後再顯示
        // 2) 否則若該步驟重試仍無目標，直接跳過該步驟
        if (step.target && !targetEl) {
            if (step.goto) {
                const gotoHash = String(step.goto).startsWith('#') ? step.goto : `#${step.goto}`
                // 防死循環：同一 step 跨頁重試超過上限則跳過（目標頁可能不渲染該元素）
                if (this._gotoRetry >= 10) {
                    this._gotoRetry = 0
                    this.currentTourIndex++
                    this.showStep(steps, tourId)
                    return
                }
                this._gotoRetry = (this._gotoRetry || 0) + 1
                if (window.location.hash !== gotoHash) {
                    // 標記程序性導航：路由變化時不應取消本次導覽
                    this._allowRouteChange = true
                    window.location.hash = gotoHash
                }
                setTimeout(() => {
                    // 導航已由路由觸發，清除防取消標記後重試該步驟
                    this._allowRouteChange = false
                    this.showStep(steps, tourId)
                }, 450)
                return
            }
            this.currentTourIndex++
            this.showStep(steps, tourId)
            return
        }

        // 立即滾動目標元素至可視區域中央（auto 確保在獲取座標前已就位）
        if (targetEl && typeof targetEl.scrollIntoView === 'function') {
            try {
                targetEl.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
            } catch {
                /* 忽略滾動異常 */
            }
        }

        // 浮動氣泡
        const bubble = document.createElement('div')
        bubble.id = 'guide-tour-bubble'
        bubble.className =
            'fixed z-[9999] bg-wabi-surface border border-wabi-border rounded-2xl shadow-2xl p-4 w-72 max-w-[calc(100vw-1.5rem)] max-h-[85vh] flex flex-col animate-modal-pop'

        bubble.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-wabi-primary uppercase tracking-wide">導覽教學</span>
        <button id="guide-tour-close" class="text-wabi-text-secondary hover:text-wabi-text-primary p-1 text-lg leading-none" aria-label="關閉導覽">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <h4 class="font-bold text-wabi-text-primary text-base mb-1">${escapeHTML(step.title)}</h4>
      <div class="flex-1 overflow-y-auto pr-0.5">
        <p class="text-sm text-wabi-text-secondary leading-relaxed mb-3 whitespace-pre-line">${escapeHTML(step.body)}</p>
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-wabi-text-secondary font-medium">${this.currentTourIndex + 1} / ${steps.length}</span>
        <button id="guide-tour-next" class="px-4 py-1.5 bg-wabi-primary text-wabi-surface text-sm font-bold rounded-xl hover:opacity-90 transition-opacity">
          ${this.currentTourIndex < steps.length - 1 ? '下一步' : '完成'}
        </button>
      </div>
    `

        // 高亮目標元素
        if (targetEl && targetEl.classList) {
            targetEl.classList.add('guide-highlight')
        }

        document.body.appendChild(bubble)
        this.bubble = bubble

        // 掛載後根據實際尺寸與視窗計算定位
        this._positionBubble(bubble, targetEl, step.position || 'top')

        // 綁定 resize 與 scroll 事件動態調整
        if (this._repositionListener) {
            window.removeEventListener('resize', this._repositionListener)
            window.removeEventListener('scroll', this._repositionListener)
        }
        this._repositionListener = () => {
            if (this.bubble && document.contains(this.bubble)) {
                this._positionBubble(this.bubble, targetEl, step.position || 'top')
            }
        }
        window.addEventListener('resize', this._repositionListener, { passive: true })
        window.addEventListener('scroll', this._repositionListener, { passive: true })

        const handleKeydown = e => {
            if (e.key === 'Escape') {
                cleanup()
                this.markTourSeen(tourId)
                this._tourActive = false
                this.destroyBubble()
            }
        }
        document.addEventListener('keydown', handleKeydown)

        const cleanup = () => {
            document.removeEventListener('keydown', handleKeydown)
            if (this._repositionListener) {
                window.removeEventListener('resize', this._repositionListener)
                window.removeEventListener('scroll', this._repositionListener)
                this._repositionListener = null
            }
            if (targetEl && targetEl.classList) {
                targetEl.classList.remove('guide-highlight')
            }
            if (document.contains(bubble)) {
                bubble.remove()
            }
        }

        bubble
            .querySelector('#guide-tour-close')
            .addEventListener('click', () => {
                cleanup()
                this.markTourSeen(tourId)
                this._tourActive = false
                this.destroyBubble()
            })

        bubble.querySelector('#guide-tour-next').addEventListener('click', () => {
            cleanup()
            this.currentTourIndex++
            this.showStep(steps, tourId)
        })
    }

    destroyBubble() {
        if (this._repositionListener) {
            window.removeEventListener('resize', this._repositionListener)
            window.removeEventListener('scroll', this._repositionListener)
            this._repositionListener = null
        }
        const bubble = document.getElementById('guide-tour-bubble')
        if (bubble) bubble.remove()
        this.bubble = null
        document
            .querySelectorAll('.guide-highlight')
            .forEach(el => el.classList.remove('guide-highlight'))
    }

    _checkActive() {
        if (!this._tourActive) {
            throw new Error('TOUR_CANCELED')
        }
    }

    /**
     * 清理自動實操導覽可能殘留的測試紀錄（導覽測試記錄）。
     * 導覽被取消/中斷時調用，保證不污染用戶賬目。
     */
    async cleanupDemoData() {
        try {
            const ds = this.app?.dataService
            if (!ds?.getRecords || !ds?.deleteRecord) return
            const records = await ds.getRecords({ allLedgers: true })
            const demoRecords = (records || []).filter(
                r => r.description === DEMO_TEST_DESC
            )
            for (const rec of demoRecords) {
                await ds.deleteRecord(rec.id)
            }
        } catch (e) {
            // 清理失敗不阻塞主流程（導覽取消優先級更高）
            console.warn('導覽測試記錄清理失敗:', e?.message || e)
        }
    }

    /**
     * 取消進行中的導覽（頁面跳轉等觸發）。
     * 銷燬氣泡、重置互斥標誌；若正在自動實操導覽也一併清理。
     */
    cancelActiveTour() {
        if (!this._tourActive && !this._demoRunning) {
            // 即使無活動導覽，也確保無殘留氣泡
            this.destroyBubble()
            return
        }
        this._tourActive = false
        this.destroyBubble()
        this.cleanupDemoData()
        if (this._currentStepReject) {
            try {
                this._currentStepReject(new Error('TOUR_CANCELED'))
            } catch (e) {
                // 忽略：導覽已取消，無需處理 rejection
            }
            this._currentStepReject = null
        }
        // 導覽取消後補發積壓的版本導覽（Bug 4）
        if (this._pendingVersionTour) {
            setTimeout(() => this.onChangelogClosed(), 100)
        }
    }

    // ── 特定功能觸發導覽 ───────────────────

    /**
     * 頁面渲染後調用：根據頁面名檢查是否觸發對應功能導覽（未看過則觸發）。
     * @param {string} pageName 路由頁面名
     */
    checkFeatureTour(pageName) {
        // 導覽互斥：導覽進行中則不觸發新導覽，避免打斷
        if (this._tourActive) return

        // 優先處理待觸發導覽（實驗功能開啟時設定，僅在綁定頁面觸發）
        // 注意：pending 導覽是用戶主動開啟功能後觸發的，不受 isFirstLaunch 限制
        // AI 導覽僅在 AI 功能已開啟時才觸發——先檢查，避免 pending 被消費後丟失
        const aiEnabled = typeof window !== 'undefined'
            && localStorage.getItem('ai_experimental_enabled') === 'true'
        const pendingTourId = this.takePendingTour(pageName)
        // 若 pending 是 AI 導覽但 AI 已關閉，導覽應在頁面觸發時被攔截——但 pending 已消費，
        // 這裡在消費前檢查；若待觸發導覽不符合則回寫 pending（不丟失）
        const reinsertPending = pendingTourId === 'ai' && !aiEnabled
        if (pendingTourId && !this.hasSeenTour(pendingTourId)) {
            if (reinsertPending) {
                // AI 已關閉：不觸發導覽，且恢復 pending 待下次開啟時再觸發
                this.setPendingTour(pendingTourId, pageName)
                return
            }
            setTimeout(() => {
                this.startFeatureTour(pendingTourId)
            }, 300)
            return
        }

        // 跳過首次歡迎尚未完成時觸發自動導覽（避免導覽衝突）
        if (this.isFirstLaunch()) return

        const tourMap = {
            debts: 'debts',
            groups: 'groups',
            contacts: 'debts',
            accounts: 'accounts',
            ledgers: 'ledgers',
            statistics: 'statistics',
            stats: 'statistics',
            recurring: 'recurring',
            amortizations: 'amortizations',
            add: 'ai',
            home: 'budget',
        }
        const tourId = tourMap[pageName]
        if (!tourId) return
        if (this.hasSeenTour(tourId)) return

        // AI 導覽僅在 AI 實驗功能已開啟時纔在記帳頁觸發（避免未開功能也彈導覽）
        if (tourId === 'ai' && !(typeof window !== 'undefined' && localStorage.getItem('ai_experimental_enabled') === 'true')) {
            return
        }

        // 延遲一小段時間確保頁面 DOM 渲染完成
        setTimeout(() => {
            this.startFeatureTour(tourId)
        }, 300)
    }

    /**
     * 重置所有導覽狀態（供「設定」頁面重新開啟教學）
     */
    resetAllGuides() {
        localStorage.removeItem(STORAGE_KEY.completedVersion)
        Object.keys(TOURS).forEach(key => {
            if (TOURS[key].id) {
                localStorage.removeItem(STORAGE_KEY.tourSeen(TOURS[key].id))
            }
        })
    }

    // ── 自動實操導覽（初識記帳完整流程）────────────

    /** 顯示導覽教學氣泡（自動演示用）。可選「下一步」按鈕與中斷回調 */
    showDemoBubble(title, body, targetSel = null, position = 'bottom', onNext = null, onClose = null, nextLabel = '下一步') {
        this.destroyBubble()
        const bubble = document.createElement('div')
        bubble.id = 'guide-tour-bubble'
        bubble.className =
            'fixed z-[9999] bg-wabi-surface border border-wabi-border rounded-2xl shadow-2xl p-4 w-72 max-w-[calc(100vw-1.5rem)] max-h-[85vh] flex flex-col animate-modal-pop'
        bubble.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-wabi-primary uppercase tracking-wide">導覽教學</span>
        <button id="guide-tour-close" class="text-wabi-text-secondary hover:text-wabi-text-primary p-1 text-lg leading-none" aria-label="關閉導覽">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <h4 class="font-bold text-wabi-text-primary text-base mb-1">${escapeHTML(title)}</h4>
      <div class="flex-1 overflow-y-auto pr-0.5">
        <p class="text-sm text-wabi-text-secondary leading-relaxed mb-2 whitespace-pre-line">${escapeHTML(body)}</p>
      </div>
      ${onNext ? `<button id="guide-tour-next" class="mt-2 w-full py-2 rounded-xl bg-wabi-primary text-white font-bold text-sm hover:opacity-90 transition-all">${escapeHTML(nextLabel)} <i class="fa-solid fa-arrow-right ml-1"></i></button>` : ''}
    `
        const targetEl = targetSel ? document.querySelector(targetSel) : null
        if (targetEl) {
            if (typeof targetEl.scrollIntoView === 'function') {
                try {
                    targetEl.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
                } catch {
                    /* 忽略滾動異常 */
                }
            }
            if (targetEl.classList) {
                targetEl.classList.add('guide-highlight')
            }
        }

        document.body.appendChild(bubble)
        this.bubble = bubble

        this._positionBubble(bubble, targetEl, position || 'bottom')

        if (this._repositionListener) {
            window.removeEventListener('resize', this._repositionListener)
            window.removeEventListener('scroll', this._repositionListener)
        }
        this._repositionListener = () => {
            if (this.bubble && document.contains(this.bubble)) {
                this._positionBubble(this.bubble, targetEl, position || 'bottom')
            }
        }
        window.addEventListener('resize', this._repositionListener, { passive: true })
        window.addEventListener('scroll', this._repositionListener, { passive: true })

        const closeBtn = bubble.querySelector('#guide-tour-close')
        closeBtn.addEventListener('click', () => {
            this.destroyBubble()
            if (onClose) onClose()
        })
        if (onNext) {
            const nextBtn = bubble.querySelector('#guide-tour-next')
            nextBtn.addEventListener('click', () => {
                this.destroyBubble()
                onNext()
            })
        }
    }

    /**
     * 步驟式教學氣泡：顯示內容，等待用戶點擊「下一步」。
     * @returns {Promise<boolean>} true=點「下一步」繼續；false=點「X」中斷導覽
     */
    _demoStep(title, body, targetSel = null, position = 'bottom') {
        this._checkActive()
        return new Promise((resolve, reject) => {
            this._currentStepReject = reject
            this.showDemoBubble(title, body, targetSel, position,
                () => {
                    this._currentStepReject = null
                    resolve(true)
                },
                () => {
                    this._currentStepReject = null
                    resolve(false)
                })
        })
    }

    /** 等待小工具 helper */
    async _demoSleep(ms) {
        this._checkActive()
        await new Promise(resolve => setTimeout(resolve, ms))
        this._checkActive()
    }

    /**
     * 自動實操導覽：進入記帳頁 → 自動新增一條測試記錄 →
     * 進入明細查看 → 編輯金額 → 保存 → 刪除該筆測試記錄。
     * 全程顯示教學氣泡，結束後確保不留測試數據。
     */
    async startDemoTour() {
        if (!this.app) return
        // 導覽互斥：已有其他導覽進行中則不演示
        if (this._tourActive) return
        this._tourActive = true
        // 標示自動實操導覽進行中：其內部頁面跳轉不應被 cancelActiveTour 取消
        this._demoRunning = true
        const DEMO_DESC = DEMO_TEST_DESC
        const MAX_WAIT = 6000

        // 等待目標元素出現（支持字符串選擇器或返回元素的函數）
        const waitFor = async (selectorOrFn, timeout = MAX_WAIT) => {
            const start = Date.now()
            while (Date.now() - start < timeout) {
                this._checkActive()
                const el =
                    typeof selectorOrFn === 'function'
                        ? selectorOrFn()
                        : document.querySelector(selectorOrFn)
                if (el) return el
                await this._demoSleep(150)
            }
            return null
        }

        try {
            // ① 進入記帳頁
            const go1 = await this._demoStep('記帳頁', '記帳頁是記錄每日收支的核心頁面。在這裡，你可以在數字鍵盤輸入金額、選擇收支分類、添加備註，最後點擊「儲存」保存這筆記錄。現在我們來走一遍完整的記帳流程。', '.nav-item[data-page="add"]')
            if (!go1) { this.markTourSeen('basics'); this._tourActive = false; return }
            window.location.hash = 'add'
            await waitFor('#add-type-expense')
            await this._demoSleep(700)

            // ② 選擇支出分類
            const go2 = await this._demoStep('選擇分類', '每筆記錄都需要歸入一個分類，方便之後統計與分析。頂部可以切換「支出 / 收入」類型；下方則是分類列表，每個分類都有對應的圖標與顏色，點擊即可選中。這裏我們選擇「飲食」，代表這筆錢花在飲食上。')
            if (!go2) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; return }
            const catBtn = await waitFor('.category-button[data-category-id="food"]')
            if (catBtn) catBtn.click()
            await this._demoSleep(500)

            // ③ 輸入金額
            const go3 = await this._demoStep('輸入金額', '選好分類後會彈出數字鍵盤。鍵盤包含 0-9 數字、小數點與退格，並支持連續運算（加、減、乘、除），適合快速計算。輸入金額「25」後，下方會實時顯示換算後的金額。', '#add-amount-display', 'top')
            if (!go3) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; return }
            const digits = ['2', '5']
            for (const d of digits) {
                const keyBtn = await waitFor(`.keypad-btn[data-key="${d}"]`, 2000)
                if (keyBtn) keyBtn.click()
                await this._demoSleep(250)
            }
            await this._demoSleep(400)

            // ④ 填備註
            const go4 = await this._demoStep('填寫備註', '備註欄用於記錄這筆消費的具體內容，讓後續在明細中能快速辨認。例如「導覽測試記錄」。備註是可選的，但建議養成填寫的習慣，方便日後回憶。')
            if (!go4) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; return }
            const noteInput = await waitFor('#add-note-input')
            if (noteInput) {
                noteInput.value = DEMO_DESC
                noteInput.dispatchEvent(new Event('input', { bubbles: true }))
            }
            await this._demoSleep(500)

            // ⑤ 保存
            const go5 = await this._demoStep('保存記錄', '確認金額、分類與備註無誤後，點擊鍵盤右下角的「儲存」按鈕。系統會將這筆記錄加入當前帳本，並更新首頁預算與統計數據。')
            if (!go5) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; return }
            const saveBtn = await waitFor('.keypad-btn[data-key="save"]', 3000)
            if (saveBtn) saveBtn.click()
            await this._demoSleep(1200)

            // ⑥ 進入明細
            const go6 = await this._demoStep('進入明細', '記錄已成功保存！「明細」頁會按日期列出所有收支記錄，每條記錄顯示分類圖標、名稱、備註與金額。你可以根據日期或分類篩選，也可以點擊任意一條記錄進入詳情。')
            if (!go6) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; await this.cleanupDemoData(); return }
            window.location.hash = 'records'
            await this._demoSleep(800)

            // 找到剛創建的測試記錄
            const recordLink = await waitFor(() => {
                const items = document.querySelectorAll('a.record-item')
                for (const item of items) {
                    if (item.textContent.includes(DEMO_DESC)) return item
                }
                return null
            })
            if (!recordLink) {
                this.destroyBubble()
                this.markTourSeen('basics')
                this._tourActive = false
                await this.cleanupDemoData()
                return
            }

            // ⑦ 查看測試記錄
            const go7 = await this._demoStep('查看測試記錄', '這就是你剛創建的記錄（備註為「導覽測試記錄」）。點擊它會進入詳情頁，在這裏可以查看或修改金額、分類、備註等所有信息。點「下一步」查看詳情。')
            if (!go7) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; await this.cleanupDemoData(); return }
            recordLink.click()
            await waitFor('#add-page-wrapper')
            await this._demoSleep(700)

            // ⑧ 編輯金額
            const go8 = await this._demoStep('編輯金額', '詳情頁與記帳頁佈局一致。你可以在鍵盤上清空原有金額，再輸入新金額「30」來修改這筆記錄。所有字段都可直接編輯，改完後點「儲存」即可更新。')
            if (!go8) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; await this.cleanupDemoData(); return }
            const backspace = await waitFor('.keypad-btn[data-key="backspace"]', 2000)
            if (backspace) {
                for (let i = 0; i < 8; i++) {
                    backspace.click()
                    await this._demoSleep(150)
                }
                const digits2 = ['3', '0']
                for (const d of digits2) {
                    const kb = await waitFor(`.keypad-btn[data-key="${d}"]`, 1500)
                    if (kb) kb.click()
                    await this._demoSleep(250)
                }
            }
            await this._demoSleep(400)

            // ⑨ 保存修改
            const go9 = await this._demoStep('保存修改', '金額已修改為 30，點擊「儲存」即可把修改保存到這筆記錄。記帳頁同時支持新增與編輯兩種模式，會根據當前狀態自動切換。')
            if (!go9) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; await this.cleanupDemoData(); return }
            const saveBtn2 = await waitFor('.keypad-btn[data-key="save"]', 3000)
            if (saveBtn2) saveBtn2.click()
            await this._demoSleep(1200)

            // ⑩ 刪除測試記錄
            const go10 = await this._demoStep('刪除測試記錄', '如果某筆記錄輸錯了不再需要，可以進入詳情頁，點擊右上角的「垃圾桶」圖標來刪除它。系統會彈出確認框，確認後該筆記錄即被移除。最後我們來演示刪除這筆測試記錄。')
            if (!go10) { this.destroyBubble(); this.markTourSeen('basics'); this._tourActive = false; await this.cleanupDemoData(); return }
            window.location.hash = 'records'
            await this._demoSleep(800)
            const recordLink2 = await waitFor(() => {
                const items = document.querySelectorAll('a.record-item')
                for (const item of items) {
                    if (item.textContent.includes(DEMO_DESC)) return item
                }
                return null
            })
            if (recordLink2) {
                recordLink2.click()
                await waitFor('#add-page-wrapper')
                await this._demoSleep(600)
                const deleteBtn = await waitFor('#delete-record-btn', 2000)
                if (deleteBtn) {
                    deleteBtn.click()
                    await this._demoSleep(500)
                    const okBtn = await waitFor('.custom-confirm-ok', 2000)
                    if (okBtn) {
                        okBtn.click()
                        await this._demoSleep(1000)
                    }
                }
            }

            // ⑪ 完成
            const go11 = await this._demoStep('導覽完成', '恭喜！你已完成一次完整的記帳流程：新增 → 查看 → 編輯 → 刪除。現在你已經掌握了記帳頁的核心操作，可以開始記錄你每天的收支了。導覽教學隨時可在「設定 → 導覽教學」中重新開啟。', null, 'bottom')
            if (go11) {
                this.destroyBubble()
            }
            this.markTourSeen('basics')
            this._tourActive = false
        } catch (e) {
            if (e?.message !== 'TOUR_CANCELED') {
                console.error('自動導覽出錯:', e)
            }
            this.destroyBubble()
            this.markTourSeen('basics')
            this._tourActive = false
            await this.cleanupDemoData()
        } finally {
            this._demoRunning = false
        }
    }
}

export { GuideManager as TourManager }

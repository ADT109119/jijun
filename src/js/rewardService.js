// ==================== 廣告服務模組 ====================
// 雙平臺設計：
//   原生環境 (Capacitor Android) → 使用 @capacitor-community/admob 原生 SDK
//   瀏覽器環境 (Web PWA)        → 使用 AdSense 橫幅 + GPT 獎勵廣告
// 獎勵：觀看獎勵廣告後，停止顯示橫幅廣告 7 天
// 設計原則：Adblocker 友善 — 所有廣告載入失敗時靜默降級，不影響主程式

import { showToast, getSafeIconClass, escapeHTML } from './utils.js'

// ── 常數設定 ──────────────────────────────────────────
const AD_FREE_KEY = 'adFreeUntil'
const AD_FREE_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

// Web 廣告設定值（來源：package.json → adConfig，由 Vite 編譯時注入）
// AD_ENABLED: 廣告總開關（build 時 AD_FREE=1 可關閉；純自架部署用）
const AD_ENABLED = __AD_ENABLED__
const ADSENSE_CLIENT_ID = __AD_ADSENSE_CLIENT_ID__
const ADSENSE_AD_SLOT = __AD_ADSENSE_AD_SLOT__
const REWARDED_AD_UNIT_PATH = __AD_GPT_REWARDED_PATH__

// AdMob 原生廣告設定值（同上，上架前在 package.json 修改）
const ADMOB_BANNER_ID = __AD_ADMOB_BANNER_ID__
const ADMOB_REWARDED_ID = __AD_ADMOB_REWARDED_ID__
const AD_IS_TESTING = __AD_IS_TESTING__

// ── 平臺偵測 ────────────────────────────────────────
export function checkIsNative() {
    return (
        typeof window !== 'undefined' &&
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform() === true
    )
}

// ── 內建推廣廣告（Web / 離線 / 降級備案） ──────────────
export const FALLBACK_INTERNAL_ADS = [
    {
        icon: 'fa-brands fa-github',
        color: '#333333',
        title: '為此專案按個 Star ⭐',
        description: '你的 Star 是我持續開發的動力！',
        buttonText: '前往 GitHub',
        url: 'https://github.com/ADT109119/jijun',
        image: '',
    },
    {
        icon: 'fa-brands fa-youtube',
        color: '#FF0000',
        title: '訂閱 The walking fish步行魚 頻道',
        description: '教學影片、開發日誌，不定期更新！',
        buttonText: '前往 YouTube',
        url: 'https://www.youtube.com/@the_walking_fish',
        image: '',
    },
    {
        icon: 'fa-solid fa-blog',
        color: '#6366f1',
        title: '逛逛我的 Blog',
        description: '技術文章、開發心得分享',
        buttonText: '前往 Blog',
        url: 'https://the-walking-fish.com',
        image: '',
    },
    {
        icon: 'fa-solid fa-wand-magic-sparkles',
        color: '#e5a822',
        title: 'Nano Banana WaterMark Remover',
        description: '開源、純網頁前端，去除 Gemini Nano Banana 浮水印的工具',
        buttonText: '前往網站',
        url: 'https://banana.the-walking-fish.com/',
        image: 'https://adt109119.github.io/projects/nanobananawatermarkremover/image.png',
    },
    {
        icon: 'fa-solid fa-network-wired',
        color: '#333333',
        title: '分佈式 LLM 推理桌面應用程式',
        description: '基於 llama.cpp 的分佈式 LLM 推理程式，利用區域網路協同推理。',
        buttonText: '前往 GitHub',
        url: 'https://github.com/ADT109119/llamacpp-distributed-inference',
        image: 'https://adt109119.github.io/projects/llamacpp-distributed-inference/banner.jpg',
    },
]

let _internalAdsCache = null

async function loadInternalAds() {
    if (_internalAdsCache && _internalAdsCache.length > 0) return _internalAdsCache
    try {
        const res = await fetch('/internal-ads.json')
        if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data) && data.length > 0) {
                _internalAdsCache = data
                return _internalAdsCache
            }
        }
    } catch (e) {
        console.warn('內建推廣廣告資料載入失敗，使用內建備用清單:', e)
    }
    _internalAdsCache = FALLBACK_INTERNAL_ADS
    return _internalAdsCache
}

// ── #SEC04 內建推廣廣告欄位防呆（供應鏈防禦深度）────────────────
// internal-ads.json 雖為第一方資產，但與 #SEC01-03 同處理原則：任何嵌入
// innerHTML / 屬性 / style 的欄位一律先過白名單或 escapeHTML，防托管/CDN
// 或檔案遭竄改時成為 XSS 注入面。
const SAFE_AD_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/
const SAFE_AD_URL_RE = /^https:\/\/[^\s"']+$/

function safeAdColor(value, fallback = '#334A52') {
    return typeof value === 'string' && SAFE_AD_COLOR_RE.test(value.trim())
        ? value.trim()
        : fallback
}

function safeAdUrl(value) {
    // 僅允許 https，杜絕 javascript: / data: 協議注入 href
    return typeof value === 'string' && SAFE_AD_URL_RE.test(value.trim())
        ? value.trim()
        : '#'
}

function safeAdImageUrl(value) {
    // 廣告圖允許 https 或站內相對路徑；其餘（含 data:）一律不渲染
    const v = typeof value === 'string' ? value.trim() : ''
    if (/^https:\/\/[^\s"']+$/.test(v) || /^\/[^\s"']*$/.test(v)) return v
    return ''
}

// ── Web 模組層級狀態 ────────────────────────────────
let adsenseLoaded = false
let gptLoaded = false
let adsenseLoadFailed = false
let gptLoadFailed = false
let gptServicesEnabled = false

// ── 動態載入外部腳本（adblocker 安全） ─────────────

/**
 * 動態載入腳本，失敗時靜默處理
 * @param {string} src - 腳本 URL
 * @returns {Promise<boolean>} 是否載入成功
 */
function loadScript(src, timeoutMs = 3000) {
    return new Promise(resolve => {
        let settled = false
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true
                console.warn(`廣告腳本載入逾時: ${src}`)
                resolve(false)
            }
        }, timeoutMs)

        try {
            const script = document.createElement('script')
            script.src = src
            script.async = true
            script.crossOrigin = 'anonymous'
            script.onload = () => {
                if (!settled) {
                    settled = true
                    clearTimeout(timer)
                    resolve(true)
                }
            }
            script.onerror = () => {
                if (!settled) {
                    settled = true
                    clearTimeout(timer)
                    console.warn(
                        `廣告腳本載入失敗（可能被 Adblocker 攔截）: ${src}`
                    )
                    resolve(false)
                }
            }
            document.head.appendChild(script)
        } catch (e) {
            if (!settled) {
                settled = true
                clearTimeout(timer)
                console.warn('載入腳本時發生錯誤:', e)
                resolve(false)
            }
        }
    })
}

/** 載入 AdSense 腳本 */
async function ensureAdsenseLoaded() {
    if (adsenseLoaded) return true
    if (adsenseLoadFailed) return false

    const success = await loadScript(
        `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`
    )

    if (success) {
        adsenseLoaded = true
    } else {
        adsenseLoadFailed = true
    }
    return success
}

/** 載入 GPT 腳本 */
async function ensureGptLoaded() {
    if (gptLoaded) return true
    if (gptLoadFailed) return false

    const success = await loadScript(
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
    )

    if (success && typeof googletag !== 'undefined') {
        gptLoaded = true
    } else {
        gptLoadFailed = true
    }
    return success
}

/** 安全解析 localStorage 時間戳 */
function parseTimestamp(value) {
    if (!value) return NaN
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : NaN
}

// ── RewardService 類別 ──────────────────────────────────

export class RewardService {
    constructor() {
        // Web GPT 獎勵廣告狀態
        this._rewardedSlot = null
        this._rewardPayload = null
        this._resolveReward = null
        this._hasResolved = false
        this._listeners = []
        this._modal = null

        // 原生 AdMob 狀態
        this._admobInitialized = false
        this._admobModule = null // 延遲載入的 AdMob 模組
        this._admobListeners = [] // 原生事件監聽 handle，供清理

        // 原生環境：初始化 AdMob SDK（build 時關閉廣告則不初始化）
        if (this.isNative && AD_ENABLED) {
            this._initAdMob()
        }
    }

    /** 動態平臺屬性 */
    get isNative() {
        return checkIsNative()
    }

    // ── 原生 AdMob 初始化 ────────────────────────────

    async _initAdMob() {
        if (!this.isNative) return
        try {
            // 動態 import，避免 Web 環境載入原生模組
            const { AdMob } = await import('@capacitor-community/admob')
            this._admobModule = AdMob

            await AdMob.initialize()

            this._admobInitialized = true
            console.log('AdMob SDK 初始化成功')
        } catch (e) {
            console.error('AdMob SDK 初始化失敗:', e)
            this._admobInitialized = false
        }
    }

    // ── 7 天無廣告狀態 ────────────────────────────

    /** build 時廣告是否啟用（AD_FREE=1 / 純自架部署 = false） */
    isAdsEnabled() {
        return AD_ENABLED
    }

    /** 檢查是否處於無廣告期間 */
    isAdFree() {
        try {
            const until = parseTimestamp(localStorage.getItem(AD_FREE_KEY))
            if (isNaN(until)) return false
            return Date.now() < until
        } catch (e) {
            return false
        }
    }

    /** 取得剩餘無廣告時間（毫秒） */
    getAdFreeRemaining() {
        try {
            const until = parseTimestamp(localStorage.getItem(AD_FREE_KEY))
            if (isNaN(until)) return 0
            const remaining = until - Date.now()
            return remaining > 0 ? remaining : 0
        } catch (e) {
            return 0
        }
    }

    /** 格式化剩餘時間為可讀字串 */
    formatRemaining() {
        const ms = this.getAdFreeRemaining()
        if (ms <= 0) return null
        const days = Math.floor(ms / (1000 * 60 * 60 * 24))
        const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
        if (days > 0) {
            return `${days} 天 ${hours} 小時`
        }
        return `${hours} 小時 ${minutes} 分鐘`
    }

    /** 設定無廣告期間 */
    _grantAdFree() {
        try {
            const until = Date.now() + AD_FREE_DURATION_MS
            localStorage.setItem(AD_FREE_KEY, until.toString())

            if (!this.isNative && typeof window !== 'undefined') {
                // 若為 Web 版，為了徹底清除已載入的 AdSense 自動廣告腳本且符合 Google 政策，
                // 於 2 秒後重新載入頁面，讓下一次載入時完全不渲染廣告代碼。
                setTimeout(() => {
                    window.location.reload()
                }, 2000)
            }
        } catch (e) {
            console.warn('無法儲存無廣告狀態:', e)
        }
    }

    // ══════════════════════════════════════════════════
    //  橫幅廣告
    // ══════════════════════════════════════════════════

    /**
     * 在指定容器中渲染橫幅廣告
     * 原生環境 → AdMob showBanner()（原生 overlay，不渲染 DOM）
     * Web 環境 → AdSense ins 元素
     * @param {HTMLElement} container - 廣告容器元素
     */
    async renderBannerAd(container) {
        if (!container) return

        // build 時關閉廣告（AD_FREE=1，純自架部署）：完全不載入廣告腳本
        if (!AD_ENABLED) return

        // 若處於無廣告期間，顯示感謝訊息
        if (this.isAdFree()) {
            // 原生環境：移除 banner overlay 並恢復 body padding
            if (this.isNative && this._admobModule) {
                this._admobModule.removeBanner().catch(() => {})
                document.body.style.paddingTop = ''
            }
            const remaining = this.formatRemaining()
            container.innerHTML = `
                <div class="text-center py-3 text-sm text-wabi-text-secondary">
                    <i class="fa-solid fa-heart text-wabi-expense mr-1"></i>
                    感謝支持！無廣告模式剩餘 ${remaining}
                </div>
            `
            return
        }

        // ── 原生平臺：使用 AdMob Banner ──
        if (this.isNative) {
            if (!this._admobInitialized) {
                await this._initAdMob()
            }
            if (this._admobModule) {
                try {
                    const { BannerAdSize, BannerAdPosition } = await import(
                        '@capacitor-community/admob'
                    )
                    const AdMob = this._admobModule

                    // 監聽 banner 尺寸變化，動態調整 body padding
                    this._bannerSizeListener?.remove?.().catch?.(() => {})
                    this._bannerSizeListener = await AdMob.addListener(
                        'bannerAdSizeChanged',
                        size => {
                            document.body.style.paddingTop = `${size.height}px`
                        }
                    )

                    await AdMob.showBanner({
                        adId: ADMOB_BANNER_ID,
                        adSize: BannerAdSize.ADAPTIVE_BANNER,
                        position: BannerAdPosition.TOP_CENTER,
                        isTesting: AD_IS_TESTING,
                    })

                    // container 不再需要佔位元素
                    container.innerHTML = ''
                } catch (e) {
                    console.warn('AdMob Banner 顯示失敗:', e)
                    document.body.style.paddingTop = ''
                    container.innerHTML = ''
                }
                return
            }
        }

        // ── Web 平臺：使用 AdSense ──
        const loaded = await ensureAdsenseLoaded()
        if (!loaded) {
            container.innerHTML = ''
            return
        }

        container.innerHTML = `
            <div class="text-center">
                <ins class="adsbygoogle"
                     style="display:block"
                     data-ad-client="${ADSENSE_CLIENT_ID}"
                     data-ad-format="auto"
                     data-full-width-responsive="true"
                     data-ad-slot="${ADSENSE_AD_SLOT}"></ins>
            </div>
        `

        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({})
        } catch (e) {
            console.warn('AdSense 廣告請求失敗:', e)
            container.innerHTML = ''
        }
    }

    // ══════════════════════════════════════════════════
    //  獎勵廣告
    // ══════════════════════════════════════════════════

    /**
     * 顯示獎勵廣告
     * @returns {Promise<boolean>} 是否成功獲得獎勵
     */
    async showRewardedAd() {
        // build 時關閉廣告（AD_FREE=1）：沒有獎勵廣告可看
        if (!AD_ENABLED) {
            showToast('此版本無廣告', 'info')
            return false
        }

        // 若已在無廣告期間，直接提示
        if (this.isAdFree()) {
            const remaining = this.formatRemaining()
            showToast(`無廣告模式尚有 ${remaining}`, 'success')
            return false
        }

        // ── 原生平臺：使用 AdMob Rewarded Video ──
        if (this.isNative) {
            return this._showNativeRewardedAd()
        }

        // ── Web 平臺：使用 GPT 獎勵廣告（逾時或無庫存自動降級為內建推廣廣告）──
        return this._showWebRewardedAd()
    }

    // ── 原生 AdMob 獎勵廣告 ──────────────────────────

    async _showNativeRewardedAd() {
        if (!this._admobInitialized) {
            await this._initAdMob()
        }
        const AdMob = this._admobModule

        if (!AdMob || !this._admobInitialized) {
            console.warn('AdMob SDK 初始化失敗，降級顯示內建推廣廣告')
            return this._showInternalAd()
        }

        showToast('正在載入獎勵廣告...', 'info')

        return new Promise(resolve => {
            const doWork = async () => {
                let rewarded = false
                let resolved = false

                const cleanup = () => {
                    this._removeNativeListeners([
                        rewardHandle,
                        dismissHandle,
                        failShowHandle,
                        failLoadHandle,
                    ])
                }

                const safeResolve = async (value, allowFallback = false) => {
                    if (resolved) return
                    resolved = true
                    cleanup()
                    if (allowFallback && !rewarded) {
                        const internalGranted = await this._showInternalAd()
                        resolve(internalGranted)
                    } else {
                        resolve(value)
                    }
                }

                // 12 秒逾時安全網
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        console.warn('AdMob 獎勵廣告逾時，降級顯示內建推廣廣告')
                        safeResolve(false, true)
                    }
                }, 12000)

                // 監聽：用戶獲得獎勵
                const rewardHandle = AdMob.addListener(
                    'onRewardedVideoAdReward',
                    () => {
                        rewarded = true
                    }
                )

                // 監聽：廣告關閉
                const dismissHandle = AdMob.addListener(
                    'onRewardedVideoAdDismissed',
                    () => {
                        clearTimeout(timeout)
                        if (rewarded) {
                            this._grantAdFree()
                            showToast(
                                '感謝觀看！已啟用 7 天無廣告模式 🎉',
                                'success'
                            )
                            safeResolve(true, false)
                        } else {
                            showToast('未完成觀看，無法獲得獎勵', 'error')
                            safeResolve(false, false)
                        }
                    }
                )

                // 監聽：顯示失敗
                const failShowHandle = AdMob.addListener(
                    'onRewardedVideoAdFailedToShow',
                    error => {
                        clearTimeout(timeout)
                        console.error('獎勵廣告顯示失敗:', error)
                        safeResolve(false, true)
                    }
                )

                // 監聽：載入失敗
                const failLoadHandle = AdMob.addListener(
                    'onRewardedVideoAdFailedToLoad',
                    error => {
                        clearTimeout(timeout)
                        console.error('獎勵廣告載入失敗:', error)
                        safeResolve(false, true)
                    }
                )

                try {
                    // 準備獎勵廣告
                    await AdMob.prepareRewardVideoAd({
                        adId: ADMOB_REWARDED_ID,
                        isTesting: AD_IS_TESTING,
                    })

                    // 準備成功 → 顯示
                    await AdMob.showRewardVideoAd()
                } catch (e) {
                    clearTimeout(timeout)
                    console.error('獎勵廣告流程異常:', e)
                    safeResolve(false, true)
                }
            }
            doWork()
        })
    }

    /** 安全移除原生事件監聽 */
    async _removeNativeListeners(handles) {
        for (const h of handles) {
            try {
                const handle = await h
                handle?.remove?.()
            } catch (_) {
                /* 靜默處理 */
            }
        }
    }

    // ── Web GPT 獎勵廣告 ────────────────────────────

    /** 安全 resolve，防止重複呼叫（自動清理 listeners + slot） */
    _resolveWithCleanup(value) {
        if (this._hasResolved) return
        this._hasResolved = true
        this._cleanupRewardedSlot()
        this._resolveReward?.(value)
    }

    /** 註冊 GPT 事件監聯並追蹤，供清理時移除 */
    _addGptListener(type, handler) {
        googletag.pubads().addEventListener(type, handler)
        this._listeners.push({ type, handler })
    }

    async _showWebRewardedAd() {
        // 動態載入 GPT（adblocker 安全）
        const loaded = await ensureGptLoaded()
        if (!loaded || typeof googletag === 'undefined') {
            // GPT 載入失敗（例如被 Adblocker 擋下），顯示內建推廣廣告作為備案
            return this._showInternalAd()
        }

        return new Promise(resolve => {
            this._resolveReward = resolve
            this._rewardPayload = null
            this._hasResolved = false

            googletag.cmd.push(() => {
                try {
                    // 前置檢查：確認 GPT API 完整可用
                    if (!googletag.enums?.OutOfPageFormat?.REWARDED) {
                        this._fallbackToInternalAd()
                        return
                    }

                    // 顯示載入提示
                    showToast('正在載入獎勵廣告...', 'info')

                    // 定義獎勵廣告 slot
                    this._rewardedSlot = googletag.defineOutOfPageSlot(
                        REWARDED_AD_UNIT_PATH,
                        googletag.enums.OutOfPageFormat.REWARDED
                    )

                    // 行動裝置檢查：若不支援 out-of-page rewarded，直接轉內建廣告
                    if (!this._rewardedSlot) {
                        this._fallbackToInternalAd()
                        return
                    }

                    this._rewardedSlot.addService(googletag.pubads())

                    // 6 秒逾時安全網：若 GPT 無庫存 (No Fill) 或網路延遲，自動降級為內建推廣廣告
                    const gptTimeout = setTimeout(() => {
                        console.warn(
                            'GPT 獎勵廣告載入逾時 (無庫存或無回應)，降級顯示內建推廣廣告'
                        )
                        this._fallbackToInternalAd()
                    }, 6000)

                    // 廣告就緒 → 清除逾時並顯示確認彈窗
                    this._addGptListener('rewardedSlotReady', event => {
                        clearTimeout(gptTimeout)
                        this._showConfirmModal(() => {
                            event.makeRewardedVisible()
                        })
                    })

                    // 獎勵發放
                    this._addGptListener('rewardedSlotGranted', event => {
                        this._rewardPayload = event.payload
                    })

                    // 廣告關閉
                    this._addGptListener('rewardedSlotClosed', () => {
                        clearTimeout(gptTimeout)
                        this._dismissModal()

                        if (this._rewardPayload) {
                            this._grantAdFree()
                            showToast(
                                '感謝觀看！已啟用 7 天無廣告模式 🎉',
                                'success'
                            )
                            this._resolveWithCleanup(true)
                        } else {
                            showToast('未完成觀看，無法獲得獎勵', 'error')
                            this._resolveWithCleanup(false)
                        }
                    })

                    // 監聽 slotRenderEnded：若 slot 為空 (No Fill)
                    this._addGptListener('slotRenderEnded', event => {
                        if (
                            event.slot === this._rewardedSlot &&
                            event.isEmpty
                        ) {
                            clearTimeout(gptTimeout)
                            this._fallbackToInternalAd()
                        }
                    })

                    // enableServices 只呼叫一次
                    if (!gptServicesEnabled) {
                        googletag.enableServices()
                        gptServicesEnabled = true
                    }

                    googletag.display(this._rewardedSlot)
                } catch (e) {
                    console.error('獎勵廣告初始化失敗:', e)
                    this._fallbackToInternalAd()
                }
            })
        })
    }

    _fallbackToInternalAd() {
        this._cleanupRewardedSlot()
        this._showInternalAd().then(v => {
            if (this._hasResolved) return
            this._hasResolved = true
            this._resolveReward?.(v)
        })
    }

    // ── 內建推廣廣告（Web / 降級備案） ───────────────

    /**
     * 顯示內建推廣廣告作為獎勵廣告備案
     * 觀看 5 秒後可領取 7 天無廣告獎勵
     * @returns {Promise<boolean>} 是否成功獲得獎勵
     */
    async _showInternalAd() {
        const COUNTDOWN_SECONDS = 5

        // 載入推廣資料（保證永不為空，有本機 fallback）
        const ads = await loadInternalAds()
        const ad = ads[Math.floor(Math.random() * ads.length)]

        return new Promise(resolve => {
            // 圖片區塊：有圖顯示圖片，沒圖顯示 icon
            // #SEC04：全部欄位過白名單/escapeHTML 再入 innerHTML
            const adColor = safeAdColor(ad.color)
            const heroHtml = safeAdImageUrl(ad.image)
                ? `<img src="${escapeHTML(safeAdImageUrl(ad.image))}" alt="${escapeHTML(ad.title || '')}" class="w-full rounded-xl mb-4 max-h-48 object-cover" />`
                : `<div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style="background: ${adColor}15">
                       <i class="${getSafeIconClass(ad.icon, 'fa-solid fa-gift')} text-3xl" style="color: ${adColor}"></i>
                   </div>`

            const modal = document.createElement('div')
            modal.className =
                'fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 animate-fade-in'
            modal.innerHTML = `
                <div class="bg-wabi-surface rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center animate-modal-pop">
                    ${heroHtml}
                    <h3 class="text-xl font-bold text-wabi-text-primary mb-2">${escapeHTML(ad.title || '')}</h3>
                    <p class="text-wabi-text-secondary text-sm mb-4">${escapeHTML(ad.description || '')}</p>
                    <a href="${escapeHTML(safeAdUrl(ad.url))}" target="_blank" rel="noopener noreferrer"
                       class="inline-flex items-center gap-1.5 text-sm font-medium mb-6 px-4 py-2 rounded-lg transition-colors hover:opacity-80"
                       style="color: ${adColor}; background: ${adColor}10">
                        ${escapeHTML(ad.buttonText || '前往')}
                        <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </a>
                    <div class="flex gap-3">
                        <button data-action="cancel" class="flex-1 py-2.5 border border-wabi-border rounded-lg text-wabi-text-secondary font-medium hover:bg-wabi-bg transition-colors">
                            關閉
                        </button>
                        <button data-action="claim" disabled
                                class="flex-1 py-2.5 rounded-lg text-white font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                style="background: ${adColor}">
                            <span data-countdown>等待 ${COUNTDOWN_SECONDS} 秒</span>
                        </button>
                    </div>
                </div>
            `

            document.body.appendChild(modal)

            const claimBtn = modal.querySelector('[data-action="claim"]')
            const countdownSpan = modal.querySelector('[data-countdown]')
            let remaining = COUNTDOWN_SECONDS
            let resolved = false

            // 倒數計時
            const timer = setInterval(() => {
                remaining--
                if (remaining > 0) {
                    countdownSpan.textContent = `等待 ${remaining} 秒`
                } else {
                    clearInterval(timer)
                    claimBtn.disabled = false
                    countdownSpan.textContent = '領取獎勵 🎉'
                }
            }, 1000)

            // 領取獎勵
            claimBtn.addEventListener('click', () => {
                if (resolved) return
                resolved = true
                clearInterval(timer)
                modal.remove()
                this._grantAdFree()
                showToast('感謝支持！已啟用 7 天無廣告模式 🎉', 'success')
                resolve(true)
            })

            // 關閉（不領取）
            modal
                .querySelector('[data-action="cancel"]')
                .addEventListener('click', () => {
                    if (resolved) return
                    resolved = true
                    clearInterval(timer)
                    modal.remove()
                    resolve(false)
                })
        })
    }

    // ── 確認彈窗（Web GPT 用） ──────────────────────

    _showConfirmModal(onConfirm) {
        this._modal = document.createElement('div')
        this._modal.className =
            'fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 animate-fade-in'
        this._modal.innerHTML = `
            <div class="bg-wabi-surface rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center animate-modal-pop">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-wabi-primary/10 flex items-center justify-center">
                    <i class="fa-solid fa-gift text-3xl text-wabi-primary"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-text-primary mb-2">觀看廣告獲得獎勵</h3>
                <p class="text-wabi-text-secondary text-sm mb-6">
                    觀看一則短影片廣告，即可享受 <strong>7 天無廣告</strong>體驗！
                </p>
                <div class="flex gap-3">
                    <button id="reward-cancel-btn" class="flex-1 py-2.5 border border-wabi-border rounded-lg text-wabi-text-secondary font-medium hover:bg-wabi-bg transition-colors">
                        取消
                    </button>
                    <button id="reward-confirm-btn" class="flex-1 py-2.5 bg-wabi-primary text-wabi-surface rounded-lg font-medium hover:bg-wabi-primary/90 transition-colors">
                        觀看廣告
                    </button>
                </div>
            </div>
        `

        document.body.appendChild(this._modal)

        this._modal
            .querySelector('#reward-confirm-btn')
            .addEventListener('click', () => {
                this._dismissModal()
                onConfirm()
            })

        this._modal
            .querySelector('#reward-cancel-btn')
            .addEventListener('click', () => {
                this._dismissModal()
                this._resolveWithCleanup(false)
            })
    }

    _dismissModal() {
        if (this._modal) {
            this._modal.remove()
            this._modal = null
        }
    }

    // ── 清理（含移除事件監聽） ────────────────────────

    _cleanupRewardedSlot() {
        // 移除所有 GPT 事件監聽，避免累積
        if (this._listeners.length > 0) {
            try {
                const pubads = googletag.pubads()
                this._listeners.forEach(({ type, handler }) => {
                    pubads.removeEventListener(type, handler)
                })
            } catch (e) {
                // 靜默處理
            }
            this._listeners = []
        }

        // 銷毀 slot
        if (this._rewardedSlot) {
            try {
                googletag.destroySlots([this._rewardedSlot])
            } catch (e) {
                // 靜默處理
            }
            this._rewardedSlot = null
        }

        this._rewardPayload = null
    }
}

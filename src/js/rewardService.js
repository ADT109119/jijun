// ==================== 廣告服務模組 ====================
// 雙平台設計：
//   原生環境 (Capacitor Android) → 使用 @capacitor-community/admob 原生 SDK
//   瀏覽器環境 (Web PWA)        → 使用 AdSense 橫幅 + GPT 獎勵廣告
// 獎勵：觀看獎勵廣告後，停止顯示橫幅廣告 24 小時
// 設計原則：Adblocker 友善 — 所有廣告載入失敗時靜默降級，不影響主程式

import { showToast } from './utils.js';

// ── 常數設定 ──────────────────────────────────────────
const AD_FREE_KEY = 'adFreeUntil';
const AD_FREE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 小時

// Web 廣告設定值（來源：package.json → adConfig，由 Vite 編譯時注入）
const ADSENSE_CLIENT_ID = __AD_ADSENSE_CLIENT_ID__;
const ADSENSE_AD_SLOT = __AD_ADSENSE_AD_SLOT__;
const REWARDED_AD_UNIT_PATH = __AD_GPT_REWARDED_PATH__;

// AdMob 原生廣告設定值（同上，上架前在 package.json 修改）
const ADMOB_BANNER_ID = __AD_ADMOB_BANNER_ID__;
const ADMOB_REWARDED_ID = __AD_ADMOB_REWARDED_ID__;
const AD_IS_TESTING = __AD_IS_TESTING__;

// ── 平台偵測 ────────────────────────────────────────
const isNative = typeof window !== 'undefined'
    && window.Capacitor?.isNativePlatform?.() === true;

// ── 內建推廣廣告（Web 備案） ──────────────────────────
let _internalAdsCache = null;

async function loadInternalAds() {
    if (_internalAdsCache) return _internalAdsCache;
    try {
        const res = await fetch('/internal-ads.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _internalAdsCache = await res.json();
        return _internalAdsCache;
    } catch (e) {
        console.warn('內建推廣廣告資料載入失敗:', e);
        return null;
    }
}

// ── Web 模組層級狀態 ────────────────────────────────
let adsenseLoaded = false;
let gptLoaded = false;
let adsenseLoadFailed = false;
let gptLoadFailed = false;
let gptServicesEnabled = false;

// ── 動態載入外部腳本（adblocker 安全） ─────────────

/**
 * 動態載入腳本，失敗時靜默處理
 * @param {string} src - 腳本 URL
 * @returns {Promise<boolean>} 是否載入成功
 */
function loadScript(src) {
    return new Promise((resolve) => {
        try {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve(true);
            script.onerror = () => {
                console.warn(`廣告腳本載入失敗（可能被 Adblocker 攔截）: ${src}`);
                resolve(false);
            };
            document.head.appendChild(script);
        } catch (e) {
            console.warn('載入腳本時發生錯誤:', e);
            resolve(false);
        }
    });
}

/** 載入 AdSense 腳本 */
async function ensureAdsenseLoaded() {
    if (adsenseLoaded) return true;
    if (adsenseLoadFailed) return false;

    const success = await loadScript(
        `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`
    );

    if (success) {
        adsenseLoaded = true;
    } else {
        adsenseLoadFailed = true;
    }
    return success;
}

/** 載入 GPT 腳本 */
async function ensureGptLoaded() {
    if (gptLoaded) return true;
    if (gptLoadFailed) return false;

    const success = await loadScript(
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
    );

    if (success && typeof googletag !== 'undefined') {
        gptLoaded = true;
    } else {
        gptLoadFailed = true;
    }
    return success;
}

/** 安全解析 localStorage 時間戳 */
function parseTimestamp(value) {
    if (!value) return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

// ── RewardService 類別 ──────────────────────────────────

export class RewardService {

    constructor() {
        // Web GPT 獎勵廣告狀態
        this._rewardedSlot = null;
        this._rewardPayload = null;
        this._resolveReward = null;
        this._hasResolved = false;
        this._listeners = [];
        this._modal = null;

        // 原生 AdMob 狀態
        this._admobInitialized = false;
        this._admobModule = null;         // 延遲載入的 AdMob 模組
        this._admobListeners = [];        // 原生事件監聽 handle，供清理

        // 原生環境：初始化 AdMob SDK
        if (isNative) {
            this._initAdMob();
        }
    }

    // ── 原生 AdMob 初始化 ────────────────────────────

    async _initAdMob() {
        try {
            // 動態 import，避免 Web 環境載入原生模組
            const { AdMob } = await import('@capacitor-community/admob');
            this._admobModule = AdMob;

            await AdMob.initialize();

            this._admobInitialized = true;
            console.log('AdMob SDK 初始化成功');
        } catch (e) {
            console.error('AdMob SDK 初始化失敗:', e);
            this._admobInitialized = false;
        }
    }

    // ── 24 小時無廣告狀態 ────────────────────────────

    /** 檢查是否處於無廣告期間 */
    isAdFree() {
        try {
            const until = parseTimestamp(localStorage.getItem(AD_FREE_KEY));
            if (isNaN(until)) return false;
            return Date.now() < until;
        } catch (e) {
            return false;
        }
    }

    /** 取得剩餘無廣告時間（毫秒） */
    getAdFreeRemaining() {
        try {
            const until = parseTimestamp(localStorage.getItem(AD_FREE_KEY));
            if (isNaN(until)) return 0;
            const remaining = until - Date.now();
            return remaining > 0 ? remaining : 0;
        } catch (e) {
            return 0;
        }
    }

    /** 格式化剩餘時間為可讀字串 */
    formatRemaining() {
        const ms = this.getAdFreeRemaining();
        if (ms <= 0) return null;
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours} 小時 ${minutes} 分鐘`;
    }

    /** 設定無廣告期間 */
    _grantAdFree() {
        try {
            const until = Date.now() + AD_FREE_DURATION_MS;
            localStorage.setItem(AD_FREE_KEY, until.toString());
        } catch (e) {
            console.warn('無法儲存無廣告狀態:', e);
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
        if (!container) return;

        // 若處於無廣告期間，顯示感謝訊息
        if (this.isAdFree()) {
            // 原生環境：移除 banner overlay 並恢復 body padding
            if (isNative && this._admobModule) {
                this._admobModule.removeBanner().catch(() => {});
                document.body.style.paddingTop = '';
            }
            const remaining = this.formatRemaining();
            container.innerHTML = `
                <div class="text-center py-3 text-sm text-wabi-text-secondary">
                    <i class="fa-solid fa-heart text-wabi-expense mr-1"></i>
                    感謝支持！無廣告模式剩餘 ${remaining}
                </div>
            `;
            return;
        }

        // ── 原生平台：使用 AdMob Banner ──
        // Banner 是 Native Overlay，浮在 WebView 上方
        // 透過 bannerAdSizeChanged 事件取得實際高度 → 設定 body padding-top 推動內容
        if (isNative && this._admobModule) {
            try {
                const { BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');
                const AdMob = this._admobModule;

                // 監聽 banner 尺寸變化，動態調整 body padding
                this._bannerSizeListener?.remove?.().catch?.(() => {});
                this._bannerSizeListener = await AdMob.addListener(
                    'bannerAdSizeChanged',
                    (size) => {
                        document.body.style.paddingTop = `${size.height}px`;
                    }
                );

                await AdMob.showBanner({
                    adId: ADMOB_BANNER_ID,
                    adSize: BannerAdSize.ADAPTIVE_BANNER,
                    position: BannerAdPosition.TOP_CENTER,
                    isTesting: AD_IS_TESTING,
                });

                // container 不再需要佔位元素
                container.innerHTML = '';
            } catch (e) {
                console.warn('AdMob Banner 顯示失敗:', e);
                document.body.style.paddingTop = '';
                container.innerHTML = '';
            }
            return;
        }

        // ── Web 平台：使用 AdSense ──
        const loaded = await ensureAdsenseLoaded();
        if (!loaded) {
            container.innerHTML = '';
            return;
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
        `;

        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
            console.warn('AdSense 廣告請求失敗:', e);
            container.innerHTML = '';
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
        // 若已在無廣告期間，直接提示
        if (this.isAdFree()) {
            const remaining = this.formatRemaining();
            showToast(`無廣告模式尚有 ${remaining}`, 'success');
            return false;
        }

        // ── 原生平台：使用 AdMob Rewarded Video ──
        if (isNative) {
            return this._showNativeRewardedAd();
        }

        // ── Web 平台：使用 GPT 獎勵廣告 ──
        return this._showWebRewardedAd();
    }

    // ── 原生 AdMob 獎勵廣告 ──────────────────────────

    async _showNativeRewardedAd() {
        const AdMob = this._admobModule;

        if (!AdMob || !this._admobInitialized) {
            showToast('廣告系統尚未就緒，請稍後再試', 'error');
            return false;
        }

        showToast('正在載入獎勵廣告...', 'success');

        // 先註冊所有事件監聽，再 prepare + show
        // 避免 prepare 回傳後事件已經觸發但 listener 還沒註冊的 race condition
        return new Promise((resolve) => {
            const doWork = async () => {
            let rewarded = false;
            let resolved = false;

            const cleanup = () => {
                this._removeNativeListeners([
                    rewardHandle, dismissHandle, failShowHandle, failLoadHandle
                ]);
            };

            const safeResolve = (value) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(value);
            };

            // 30 秒逾時安全網
            const timeout = setTimeout(() => {
                if (!resolved) {
                    console.warn('獎勵廣告逾時');
                    showToast('獎勵廣告載入逾時，請稍後再試', 'error');
                    safeResolve(false);
                }
            }, 30000);

            // 監聽：用戶獲得獎勵
            const rewardHandle = AdMob.addListener(
                'onRewardedVideoAdReward',
                () => { rewarded = true; }
            );

            // 監聽：廣告關閉
            const dismissHandle = AdMob.addListener(
                'onRewardedVideoAdDismissed',
                () => {
                    clearTimeout(timeout);
                    if (rewarded) {
                        this._grantAdFree();
                        showToast('感謝觀看！已啟用 24 小時無廣告模式 🎉', 'success');
                        safeResolve(true);
                    } else {
                        showToast('未完成觀看，無法獲得獎勵', 'error');
                        safeResolve(false);
                    }
                }
            );

            // 監聯：顯示失敗
            const failShowHandle = AdMob.addListener(
                'onRewardedVideoAdFailedToShow',
                (error) => {
                    clearTimeout(timeout);
                    console.error('獎勵廣告顯示失敗:', error);
                    showToast('獎勵廣告顯示失敗，請稍後再試', 'error');
                    safeResolve(false);
                }
            );

            // 監聽：載入失敗
            const failLoadHandle = AdMob.addListener(
                'onRewardedVideoAdFailedToLoad',
                (error) => {
                    clearTimeout(timeout);
                    console.error('獎勵廣告載入失敗:', error);
                    showToast('獎勵廣告載入失敗，請稍後再試', 'error');
                    safeResolve(false);
                }
            );

            try {
                // 準備獎勵廣告
                await AdMob.prepareRewardVideoAd({
                    adId: ADMOB_REWARDED_ID,
                    isTesting: AD_IS_TESTING,
                });

                // 準備成功 → 顯示
                await AdMob.showRewardVideoAd();
            } catch (e) {
                clearTimeout(timeout);
                console.error('獎勵廣告流程異常:', e);
                showToast('獎勵廣告載入失敗，請稍後再試', 'error');
                safeResolve(false);
            }
            };
            doWork();
        });
    }

    /** 安全移除原生事件監聽 */
    async _removeNativeListeners(handles) {
        for (const h of handles) {
            try {
                const handle = await h;
                handle?.remove?.();
            } catch (_) { /* 靜默處理 */ }
        }
    }

    // ── Web GPT 獎勵廣告 ────────────────────────────

    /** 安全 resolve，防止重複呼叫（自動清理 listeners + slot） */
    _resolveWithCleanup(value) {
        if (this._hasResolved) return;
        this._hasResolved = true;
        this._cleanupRewardedSlot();
        this._resolveReward?.(value);
    }

    /** 註冊 GPT 事件監聯並追蹤，供清理時移除 */
    _addGptListener(type, handler) {
        googletag.pubads().addEventListener(type, handler);
        this._listeners.push({ type, handler });
    }

    async _showWebRewardedAd() {
        // 動態載入 GPT（adblocker 安全）
        const loaded = await ensureGptLoaded();
        if (!loaded || typeof googletag === 'undefined') {
            // GPT 載入失敗，顯示內建推廣廣告作為備案
            return this._showInternalAd();
        }

        return new Promise((resolve) => {
            this._resolveReward = resolve;
            this._rewardPayload = null;
            this._hasResolved = false;

            googletag.cmd.push(() => {
                try {
                    // 前置檢查：確認 GPT API 完整可用
                    if (!googletag.enums?.OutOfPageFormat?.REWARDED) {
                        this._showInternalAd().then(v => this._resolveWithCleanup(v));
                        return;
                    }

                    // 顯示載入提示
                    showToast('正在載入獎勵廣告...', 'success');

                    // 定義獎勵廣告 slot
                    this._rewardedSlot = googletag.defineOutOfPageSlot(
                        REWARDED_AD_UNIT_PATH,
                        googletag.enums.OutOfPageFormat.REWARDED
                    );

                    // 行動裝置檢查
                    if (!this._rewardedSlot) {
                        this._showInternalAd().then(v => this._resolveWithCleanup(v));
                        return;
                    }

                    this._rewardedSlot.addService(googletag.pubads());

                    // 廣告就緒 → 顯示確認彈窗
                    this._addGptListener('rewardedSlotReady', (event) => {
                        this._showConfirmModal(() => {
                            event.makeRewardedVisible();
                        });
                    });

                    // 獎勵發放
                    this._addGptListener('rewardedSlotGranted', (event) => {
                        this._rewardPayload = event.payload;
                    });

                    // 廣告關閉
                    this._addGptListener('rewardedSlotClosed', () => {
                        this._dismissModal();

                        if (this._rewardPayload) {
                            this._grantAdFree();
                            showToast('感謝觀看！已啟用 24 小時無廣告模式 🎉', 'success');
                            this._resolveWithCleanup(true);
                        } else {
                            showToast('未完成觀看，無法獲得獎勵', 'error');
                            this._resolveWithCleanup(false);
                        }
                    });

                    // 無廣告可用 → 顯示內建推廣廣告
                    this._addGptListener('slotRenderEnded', (event) => {
                        if (event.slot === this._rewardedSlot && event.isEmpty) {
                            this._showInternalAd().then(v => this._resolveWithCleanup(v));
                        }
                    });

                    // enableServices 只呼叫一次
                    if (!gptServicesEnabled) {
                        googletag.enableServices();
                        gptServicesEnabled = true;
                    }

                    googletag.display(this._rewardedSlot);
                } catch (e) {
                    console.error('獎勵廣告初始化失敗:', e);
                    this._resolveWithCleanup(false);
                }
            });
        });
    }

    // ── 內建推廣廣告（Web 備案） ────────────────────

    /**
     * 顯示內建推廣廣告作為獎勵廣告備案
     * 觀看 5 秒後可領取 24 小時無廣告獎勵
     * @returns {Promise<boolean>} 是否成功獲得獎勵
     */
    async _showInternalAd() {
        const COUNTDOWN_SECONDS = 5;

        // 載入推廣資料
        const ads = await loadInternalAds();
        if (!ads || ads.length === 0) {
            showToast('目前沒有可用的獎勵廣告，請稍後再試', 'error');
            return false;
        }

        return new Promise((resolve) => {
            // 隨機挑選一則
            const ad = ads[Math.floor(Math.random() * ads.length)];

            // 圖片區塊：有圖顯示圖片，沒圖顯示 icon
            const heroHtml = ad.image
                ? `<img src="${ad.image}" alt="${ad.title}" class="w-full rounded-xl mb-4 max-h-48 object-cover" />`
                : `<div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style="background: ${ad.color}15">
                       <i class="${ad.icon} text-3xl" style="color: ${ad.color}"></i>
                   </div>`;

            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 animation-fade-in';
            modal.innerHTML = `
                <div class="bg-wabi-surface rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
                    ${heroHtml}
                    <h3 class="text-xl font-bold text-wabi-text-primary mb-2">${ad.title}</h3>
                    <p class="text-wabi-text-secondary text-sm mb-4">${ad.description}</p>
                    <a href="${ad.url}" target="_blank" rel="noopener noreferrer"
                       class="inline-flex items-center gap-1.5 text-sm font-medium mb-6 px-4 py-2 rounded-lg transition-colors hover:opacity-80"
                       style="color: ${ad.color}; background: ${ad.color}10">
                        ${ad.buttonText}
                        <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </a>
                    <div class="flex gap-3">
                        <button data-action="cancel" class="flex-1 py-2.5 border border-wabi-border rounded-lg text-wabi-text-secondary font-medium hover:bg-wabi-bg transition-colors">
                            關閉
                        </button>
                        <button data-action="claim" disabled
                                class="flex-1 py-2.5 rounded-lg text-white font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                style="background: ${ad.color}">
                            <span data-countdown>等待 ${COUNTDOWN_SECONDS} 秒</span>
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const claimBtn = modal.querySelector('[data-action="claim"]');
            const countdownSpan = modal.querySelector('[data-countdown]');
            let remaining = COUNTDOWN_SECONDS;
            let resolved = false;

            // 倒數計時
            const timer = setInterval(() => {
                remaining--;
                if (remaining > 0) {
                    countdownSpan.textContent = `等待 ${remaining} 秒`;
                } else {
                    clearInterval(timer);
                    claimBtn.disabled = false;
                    countdownSpan.textContent = '領取獎勵 🎉';
                }
            }, 1000);

            // 領取獎勵
            claimBtn.addEventListener('click', () => {
                if (resolved) return;
                resolved = true;
                clearInterval(timer);
                modal.remove();
                this._grantAdFree();
                showToast('感謝支持！已啟用 24 小時無廣告模式 🎉', 'success');
                resolve(true);
            });

            // 關閉（不領取）
            modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
                if (resolved) return;
                resolved = true;
                clearInterval(timer);
                modal.remove();
                resolve(false);
            });
        });
    }

    // ── 確認彈窗（Web GPT 用） ──────────────────────

    _showConfirmModal(onConfirm) {
        this._modal = document.createElement('div');
        this._modal.className = 'fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 animation-fade-in';
        this._modal.innerHTML = `
            <div class="bg-wabi-surface rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-wabi-primary/10 flex items-center justify-center">
                    <i class="fa-solid fa-gift text-3xl text-wabi-primary"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-text-primary mb-2">觀看廣告獲得獎勵</h3>
                <p class="text-wabi-text-secondary text-sm mb-6">
                    觀看一則短影片廣告，即可享受 <strong>24 小時無廣告</strong>體驗！
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
        `;

        document.body.appendChild(this._modal);

        this._modal.querySelector('#reward-confirm-btn').addEventListener('click', () => {
            this._dismissModal();
            onConfirm();
        });

        this._modal.querySelector('#reward-cancel-btn').addEventListener('click', () => {
            this._dismissModal();
            this._resolveWithCleanup(false);
        });
    }

    _dismissModal() {
        if (this._modal) {
            this._modal.remove();
            this._modal = null;
        }
    }

    // ── 清理（含移除事件監聽） ────────────────────────

    _cleanupRewardedSlot() {
        // 移除所有 GPT 事件監聽，避免累積
        if (this._listeners.length > 0) {
            try {
                const pubads = googletag.pubads();
                this._listeners.forEach(({ type, handler }) => {
                    pubads.removeEventListener(type, handler);
                });
            } catch (e) {
                // 靜默處理
            }
            this._listeners = [];
        }

        // 銷毀 slot
        if (this._rewardedSlot) {
            try {
                googletag.destroySlots([this._rewardedSlot]);
            } catch (e) {
                // 靜默處理
            }
            this._rewardedSlot = null;
        }

        this._rewardPayload = null;
    }
}

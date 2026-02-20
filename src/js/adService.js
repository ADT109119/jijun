// ==================== 廣告服務模組 ====================
// 管理 AdSense 橫幅廣告 + Google Ad Manager 獎勵廣告
// 獎勵：觀看獎勵廣告後，停止顯示橫幅廣告 24 小時
// 設計原則：Adblocker 友善 — 所有廣告載入失敗時靜默降級，不影響主程式

import { showToast } from './utils.js';

// ── 常數設定 ──────────────────────────────────────────
const AD_FREE_KEY = 'adFreeUntil';
const AD_FREE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 小時

// 廣告設定值
const ADSENSE_CLIENT_ID = 'ca-pub-1250445032458691';
const ADSENSE_AD_SLOT = '3474478906';
const REWARDED_AD_UNIT_PATH = '/23341410483/jijun';

// ── 內建推廣廣告（當獎勵廣告不可用時的備案） ──────────
// 資料來源：/internal-ads.json（放在 public/ 資料夾，方便編輯）
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

// ── 模組層級狀態 ────────────────────────────────────
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

// ── AdService 類別 ──────────────────────────────────

export class AdService {

    constructor() {
        this._rewardedSlot = null;
        this._rewardPayload = null;
        this._resolveReward = null;
        this._hasResolved = false;
        this._listeners = [];
        this._modal = null;
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

    // ── AdSense 橫幅廣告 ────────────────────────────

    /**
     * 在指定容器中渲染 AdSense 橫幅廣告
     * @param {HTMLElement} container - 廣告容器元素
     */
    async renderBannerAd(container) {
        if (!container) return;

        // 若處於無廣告期間，顯示感謝訊息
        if (this.isAdFree()) {
            const remaining = this.formatRemaining();
            container.innerHTML = `
                <div class="text-center py-3 text-sm text-wabi-text-secondary">
                    <i class="fa-solid fa-heart text-wabi-expense mr-1"></i>
                    感謝支持！無廣告模式剩餘 ${remaining}
                </div>
            `;
            return;
        }

        // 動態載入 AdSense（adblocker 安全）
        const loaded = await ensureAdsenseLoaded();
        if (!loaded) {
            container.innerHTML = '';
            return;
        }

        // 渲染 AdSense 橫幅
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

    // ── GPT 獎勵廣告 ────────────────────────────────

    /** 安全 resolve，防止重複呼叫 */
    _safeResolve(value) {
        if (this._hasResolved) return;
        this._hasResolved = true;
        if (this._resolveReward) this._resolveReward(value);
    }

    /** 註冊 GPT 事件監聽並追蹤，供清理時移除 */
    _addGptListener(type, handler) {
        googletag.pubads().addEventListener(type, handler);
        this._listeners.push({ type, handler });
    }

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
                        this._showInternalAd().then(v => this._safeResolve(v));
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
                        this._showInternalAd().then(v => this._safeResolve(v));
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
                            this._safeResolve(true);
                        } else {
                            showToast('未完成觀看，無法獲得獎勵', 'error');
                            this._safeResolve(false);
                        }

                        this._cleanupRewardedSlot();
                    });

                    // 無廣告可用 → 顯示內建推廣廣告
                    this._addGptListener('slotRenderEnded', (event) => {
                        if (event.slot === this._rewardedSlot && event.isEmpty) {
                            this._cleanupRewardedSlot();
                            this._showInternalAd().then(v => this._safeResolve(v));
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
                    this._cleanupRewardedSlot();
                    this._showInternalAd().then(v => this._safeResolve(v));
                }
            });
        });
    }

    // ── 內建推廣廣告（備案） ────────────────────────

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
                <div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
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
                        <button data-action="cancel" class="flex-1 py-2.5 border border-wabi-border rounded-lg text-wabi-text-secondary font-medium hover:bg-gray-50 transition-colors">
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

    // ── 確認彈窗 ────────────────────────────────────

    _showConfirmModal(onConfirm) {
        this._modal = document.createElement('div');
        this._modal.className = 'fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 animation-fade-in';
        this._modal.innerHTML = `
            <div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-wabi-primary/10 flex items-center justify-center">
                    <i class="fa-solid fa-gift text-3xl text-wabi-primary"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-text-primary mb-2">觀看廣告獲得獎勵</h3>
                <p class="text-wabi-text-secondary text-sm mb-6">
                    觀看一則短影片廣告，即可享受 <strong>24 小時無廣告</strong>體驗！
                </p>
                <div class="flex gap-3">
                    <button id="reward-cancel-btn" class="flex-1 py-2.5 border border-wabi-border rounded-lg text-wabi-text-secondary font-medium hover:bg-gray-50 transition-colors">
                        取消
                    </button>
                    <button id="reward-confirm-btn" class="flex-1 py-2.5 bg-wabi-primary text-white rounded-lg font-medium hover:bg-wabi-primary/90 transition-colors">
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
            this._cleanupRewardedSlot();
            this._safeResolve(false);
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

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

// ── 腳本載入狀態 ────────────────────────────────────
let adsenseLoaded = false;
let gptLoaded = false;
let adsenseLoadFailed = false;
let gptLoadFailed = false;

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

// ── AdService 類別 ──────────────────────────────────

export class AdService {

    constructor() {
        this._rewardedSlot = null;
        this._rewardPayload = null;
        this._resolveReward = null;
        this._modal = null;
    }

    // ── 24 小時無廣告狀態 ────────────────────────────

    /** 檢查是否處於無廣告期間 */
    isAdFree() {
        try {
            const until = localStorage.getItem(AD_FREE_KEY);
            if (!until) return false;
            return Date.now() < parseInt(until, 10);
        } catch (e) {
            return false;
        }
    }

    /** 取得剩餘無廣告時間（毫秒） */
    getAdFreeRemaining() {
        try {
            const until = localStorage.getItem(AD_FREE_KEY);
            if (!until) return 0;
            const remaining = parseInt(until, 10) - Date.now();
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
            // AdSense 載入失敗，靜默處理，不影響主程式
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

        // 觸發 AdSense 廣告請求
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
            console.warn('AdSense 廣告請求失敗:', e);
            container.innerHTML = '';
        }
    }

    // ── GPT 獎勵廣告 ────────────────────────────────

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
            showToast('廣告服務無法載入（可能被廣告攔截器阻擋）', 'error');
            return false;
        }

        return new Promise((resolve) => {
            this._resolveReward = resolve;
            this._rewardPayload = null;

            googletag.cmd.push(() => {
                try {
                    // 定義獎勵廣告 slot
                    this._rewardedSlot = googletag.defineOutOfPageSlot(
                        REWARDED_AD_UNIT_PATH,
                        googletag.enums.OutOfPageFormat.REWARDED
                    );

                    // 行動裝置檢查
                    if (!this._rewardedSlot) {
                        showToast('此裝置暫不支援獎勵廣告，請使用手機瀏覽器', 'error');
                        resolve(false);
                        return;
                    }

                    this._rewardedSlot.addService(googletag.pubads());

                    // 廣告就緒 → 顯示確認彈窗
                    googletag.pubads().addEventListener('rewardedSlotReady', (event) => {
                        this._showConfirmModal(() => {
                            event.makeRewardedVisible();
                        });
                    });

                    // 獎勵發放
                    googletag.pubads().addEventListener('rewardedSlotGranted', (event) => {
                        this._rewardPayload = event.payload;
                    });

                    // 廣告關閉
                    googletag.pubads().addEventListener('rewardedSlotClosed', () => {
                        this._dismissModal();
                        this._cleanupRewardedSlot();

                        if (this._rewardPayload) {
                            this._grantAdFree();
                            showToast('感謝觀看！已啟用 24 小時無廣告模式 🎉', 'success');
                            if (this._resolveReward) this._resolveReward(true);
                        } else {
                            showToast('未完成觀看，無法獲得獎勵', 'error');
                            if (this._resolveReward) this._resolveReward(false);
                        }
                    });

                    // 無廣告可用
                    googletag.pubads().addEventListener('slotRenderEnded', (event) => {
                        if (event.slot === this._rewardedSlot && event.isEmpty) {
                            showToast('目前沒有可用的獎勵廣告，請稍後再試', 'error');
                            this._cleanupRewardedSlot();
                            if (this._resolveReward) this._resolveReward(false);
                        }
                    });

                    googletag.enableServices();
                    googletag.display(this._rewardedSlot);
                } catch (e) {
                    console.error('獎勵廣告初始化失敗:', e);
                    showToast('廣告載入失敗，請稍後再試', 'error');
                    this._cleanupRewardedSlot();
                    resolve(false);
                }
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
            if (this._resolveReward) this._resolveReward(false);
        });
    }

    _dismissModal() {
        if (this._modal) {
            this._modal.remove();
            this._modal = null;
        }
    }

    // ── 清理 ────────────────────────────────────────

    _cleanupRewardedSlot() {
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

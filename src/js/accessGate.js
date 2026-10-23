/**
 * 前端存取驗證碼（Access Code）
 *
 * 純自架部署的 UX 門檻：build 時設定 ACCESS_CODE 後，
 * 每個新瀏覽器 session 首次訪問都要輸入正確的驗證碼才能使用 app。
 *
 * 與 AD_FREE 同一套 build-time 機制（100% 編譯期注入）：
 *   ACCESS_CODE=xxx npm run build
 *
 * ⚠️ 安全定位（重要）：
 * 這是**使用者體驗門檻**（防家人外借時外人亂翻帳本），
 * **不是安全機制**——驗證碼會隨 build 產物編進 JS bundle，
 * 懂技術的人 F12 即可取得，且同步 API 本身不驗證此 code。
 * 真正要擋住外部存取，請用 reverse proxy（IP 白名單 / Basic Auth / VPN）。
 *
 * 行為：
 * - 驗證碼空（一般版）→ 立即放行、零 UI（dead code）
 * - sessionStorage（非 localStorage）：每個瀏覽器 session 輸入一次，
 *   關閉所有分頁重開需再輸入
 *
 * 實作上採用 factory（createAccessGate(code)）讓核心邏輯可被單元測試
 * 直接注入不同 code；build 常數 __ACCESS_CODE__ 只在最下方接線一次。
 */

const SESSION_KEY = 'jijun_access_granted'

/**
 * 建立一個 access gate 實例。
 * @param {string} code  驗證碼（空字串 = 無 gate）
 * @param {object} [options]
 * @param {Storage} [options.storage]  預設 sessionStorage（測試可注入）
 * @param {boolean} [options.persistent] 若 true 用 localStorage（跨 session 只輸入一次）
 * @returns {{ensureAccess: Function, isAccessGranted: Function}}
 */
export function createAccessGate(code, options = {}) {
    const enabled = !!code
    const storage =
        options.storage ||
        (typeof sessionStorage !== 'undefined'
            ? sessionStorage
            : options.persistent
                ? localStorage
                : null)

    function _isGranted() {
        if (!enabled) return true
        if (!storage) return false
        try {
            return storage.getItem(SESSION_KEY) === '1'
        } catch (_) {
            return false
        }
    }

    function _markGranted() {
        if (!enabled || !storage) return
        try {
            storage.setItem(SESSION_KEY, '1')
        } catch (_) {
            // 儲存不可用（如 privacy 模式）→ 不持久化，本 session 內仍可用
        }
    }

    let _overlay = null

    function _removeOverlay() {
        if (_overlay && _overlay.parentNode) {
            _overlay.parentNode.removeChild(_overlay)
        }
        _overlay = null
    }

    function _renderOverlay(onUnlock) {
        const el = document.createElement('div')
        el.id = 'access-gate-overlay'
        el.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:var(--wabi-bg, #f5f1e8)',
        ].join(';')

        const card = document.createElement('div')
        card.style.cssText = [
            'max-width:320px',
            'width:90%',
            'padding:32px 28px',
            'border-radius:16px',
            'background:var(--wabi-surface, #fffdf7)',
            'box-shadow:0 8px 32px rgba(0,0,0,0.12)',
            'text-align:center',
        ].join(';')

        const icon = document.createElement('div')
        icon.innerHTML =
            '<i class="fa-solid fa-lock" style="font-size:32px;color:var(--wabi-primary, #4a7c6f);"></i>'
        card.appendChild(icon)

        const title = document.createElement('h2')
        title.textContent = '需要驗證碼'
        title.style.cssText =
            'margin:16px 0 6px;font-size:20px;font-weight:700;color:var(--wabi-text, #2d2a26);'
        card.appendChild(title)

        const desc = document.createElement('p')
        desc.textContent = '此記帳應用需要輸入驗證碼才能繼續'
        desc.style.cssText =
            'margin:0 0 20px;font-size:13px;color:var(--wabi-text-secondary, #8a857d);'
        card.appendChild(desc)

        const input = document.createElement('input')
        input.type = 'password'
        input.autocomplete = 'off'
        input.placeholder = '驗證碼'
        input.style.cssText =
            'width:100%;box-sizing:border-box;padding:12px 14px;font-size:16px;border-radius:10px;border:1px solid var(--wabi-border, #e5e0d5);background:var(--wabi-bg, #f5f1e8);color:var(--wabi-text, #2d2a26);outline:none;'
        card.appendChild(input)

        const errorEl = document.createElement('p')
        errorEl.style.cssText =
            'min-height:20px;margin:10px 0 0;font-size:12px;color:#c0392b;'
        card.appendChild(errorEl)

        const btn = document.createElement('button')
        btn.textContent = '進入'
        btn.style.cssText =
            'width:100%;padding:12px;font-size:15px;font-weight:600;border:none;border-radius:10px;background:var(--wabi-primary, #4a7c6f);color:#fff;cursor:pointer;'
        card.appendChild(btn)

        function tryUnlock() {
            if (input.value === code) {
                _markGranted()
                _removeOverlay()
                if (onUnlock) onUnlock()
            } else {
                errorEl.textContent = '驗證碼不正確，請重試'
                input.value = ''
                input.focus()
            }
        }
        btn.addEventListener('click', tryUnlock)
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') tryUnlock()
        })

        _overlay = el
        el.appendChild(card)
        document.body.appendChild(el)
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => input.focus())
        } else {
            input.focus()
        }
    }

    /**
     * 確保已通過驗證碼門檻。
     * 無驗證碼 / 已授權 → 立即 resolve。
     * 有驗證碼但未授權 → 顯示全螢幕 overlay 並**永不 resolve**
     *（直到使用者輸入正確驗證碼後 app 才會 init）。
     */
    function ensureAccess() {
        if (!enabled || _isGranted()) {
            return Promise.resolve()
        }
        return new Promise(resolve => {
            _renderOverlay(() => resolve())
        })
    }

    /** 目前是否已授權（不觸發 UI）。 */
    function isAccessGranted() {
        return _isGranted()
    }

    return { ensureAccess, isAccessGranted }
}

// build 常數接線（vite.config → __ACCESS_CODE__；空字串 = 無 gate）。
// `if (ACCESS_CODE)` 是編譯期常數判斷：
// - 空 code（一般版）→ minifier 移除整個 if 區塊，createAccessGate 變為
//   未被引用而整段 tree-shake，gate UI 文案不會進 bundle（與 AD_FREE 同機制）。
// - 有 code（自架版）→ 保留 gate 實作。
const ACCESS_CODE = __ACCESS_CODE__

let gateImpl = null
if (ACCESS_CODE) {
    gateImpl = createAccessGate(ACCESS_CODE)
}

/**
 * 確保已通過驗證碼門檻（main.js init 最前面 await）。
 * 無驗證碼 → 立即 resolve（零 UI）；有驗證碼未授權 → 全螢幕 gate，
 * 輸入正確前永不 resolve。
 */
export function ensureAccess() {
    if (!gateImpl) {
        return Promise.resolve()
    }
    return gateImpl.ensureAccess()
}

/** 目前是否已授權（無驗證碼恆為 true）。 */
export function isAccessGranted() {
    if (!gateImpl) {
        return true
    }
    return gateImpl.isAccessGranted()
}

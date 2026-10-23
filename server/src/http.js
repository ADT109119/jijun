/**
 * Easy Accounting Sync Server — 共用 HTTP helpers
 *
 * 抽出供 index.js（OAuth Proxy 路由）與 selfhost.js（自架同步路由）共用，
 * 避免兩檔互相 import 造成循環相依。
 */

/**
 * 統一安全回應標頭（紅隊報告 M-3：ZAP baseline 命中項補齊）。
 *
 * CSP 說明（本 App 特性）：
 * - script-src 需 'unsafe-inline'：index.html 有首屏內聯 script（主題預載），
 *   Google Identity SDK 亦需內聯；先以 'unsafe-inline' 起步，後續可收 nonce。
 * - connect-src 收 http:/https:：前端允許使用者自訂「伺服器地址」
 *   （含 LAN http://），官方伺服器亦需連 Google API；https 站上瀏覽器
 *   的 mixed-content 規則仍會擋 http，故不降低實際安全。
 * - camera/microphone 不禁：QR 掃描與 AI 語音記帳為正式功能。
 * - frame-ancestors 'none' + X-Frame-Options DENY：防點擊劫持。
 */
export const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
        'geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' http: https: data: blob:",
        "worker-src 'self' blob:",
        "frame-src https://accounts.google.com",
        "manifest-src 'self'",
    ].join('; '),
}

/**
 * 建立 JSON 回應
 * @param {object} body  回應 body
 * @param {number} status  HTTP status code
 * @param {Headers} corsHeaders  CORS headers
 * @param {Record<string,string>} [extraHeaders]  額外標頭（如 Retry-After）
 * @returns {Response}
 */
export function jsonResponse(body, status, corsHeaders, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...Object.fromEntries(corsHeaders.entries()),
            ...SECURITY_HEADERS,
            ...(extraHeaders || {}),
            'Content-Type': 'application/json',
            // API 狀態回應不可被瀏覽器 heuristically cache：
            // admin/settings/register PUT 之後的 GET /users 若讀到快取，
            // 前端會顯示過期的 registerEnabled（跨域時尤易發生）。
            'Cache-Control': 'no-store',
        },
    })
}

/**
 * 根據請求 Origin 產生 CORS headers。
 *
 * 安全原則（紅隊報告 H-1）：
 * - 白名單命中 → 原樣反射該 origin（並補 Vary: Origin 防快取投毒）。
 * - 白名單為 '*' → 回.literal '*'，**不再反射任意 Origin**
 *   （反射任意 origin 讓任何網站能針對該 origin 精確比對回應）。
 * - 白名單未命中 → 完全不回 CORS 標頭（瀏覽器自然擋讀取）。
 *
 * @param {Request} request
 * @param {string} allowedOriginsStr  逗號分隔允許的 origin
 * @returns {Headers}
 */
export function getCorsHeaders(request, allowedOriginsStr) {
    const origin = request.headers.get('Origin') || ''
    const allowedOrigins = (allowedOriginsStr || '').split(',').map(o =>
        o.trim()
    )
    const headers = new Headers()

    if (allowedOrigins.includes('*')) {
        // 不反射：一律回 *（本 API 採 Authorization header，非 cookie，
        // 無 credentials 洩漏面；* 與反射對匿名 API 能力相同但資訊更少）
        headers.set('Access-Control-Allow-Origin', '*')
    } else if (origin && allowedOrigins.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin)
        headers.set('Vary', 'Origin')
    }

    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS, DELETE')
    headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    )
    headers.set('Access-Control-Max-Age', '86400')
    return headers
}

/**
 * Easy Accounting Sync Server — Cloudflare Worker
 *
 * 純 OAuth Proxy，僅負責：
 * 1. 用 authorization code 換取 access_token / refresh_token
 * 2. 刷新 access_token
 *
 * 不儲存任何使用者資料，所有同步資料皆存放於 Google Drive appDataFolder。
 *
 * 環境變數 (Secrets):
 *   GOOGLE_CLIENT_ID     — Google OAuth 2.0 Client ID
 *   GOOGLE_CLIENT_SECRET — Google OAuth 2.0 Client Secret
 *
 * 環境變數 (Vars):
 *   ALLOWED_ORIGINS — 逗號分隔允許的 CORS origin 列表
 */

import { jsonResponse, getCorsHeaders, SECURITY_HEADERS } from './http.js'

// re-export 供既有匯入者使用
export { jsonResponse, getCorsHeaders, SECURITY_HEADERS }

// ──────────────────────────────────────────────
// Route Handlers
// ──────────────────────────────────────────────

// Self-hosted sync 路由（純自架、SQLite 儲存；ctx 存在時才啟用）
import { handleSelfHostRoute } from './selfhost.js'

/**
 * 自架同步路由分派。
 * @returns {Promise<Response|null>} null 表示非 self-host 路由或功能未啟用
 */
async function dispatchSelfHostRoute(request, ctx) {
    if (!ctx) return null
    return handleSelfHostRoute(request, ctx)
}

/**
 * POST /api/auth/token
 * 用 Google authorization code 換取 tokens
 *
 * Request body: { code: string, redirect_uri: string }
 * Response:     { access_token, refresh_token, expires_in, token_type, id_token }
 */
async function handleTokenExchange(request, env, corsHeaders) {
    if (
        env?.DISABLE_GOOGLE_OAUTH === '1' ||
        (typeof process !== 'undefined' && process.env?.DISABLE_GOOGLE_OAUTH === '1')
    ) {
        return jsonResponse(
            { error: 'Google OAuth is disabled on this server' },
            403,
            corsHeaders
        )
    }
    try {
        const { code, redirect_uri } = await request.json()

        if (!code) {
            return jsonResponse(
                { error: 'Missing authorization code' },
                400,
                corsHeaders
            )
        }

        const tokenResponse = await fetch(
            'https://oauth2.googleapis.com/token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code,
                    client_id: env.GOOGLE_CLIENT_ID,
                    client_secret: env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirect_uri || 'postmessage',
                    grant_type: 'authorization_code',
                }),
            }
        )

        const data = await tokenResponse.json()

        if (!tokenResponse.ok) {
            return jsonResponse(
                { error: 'Token exchange failed', details: data },
                tokenResponse.status,
                corsHeaders
            )
        }

        return jsonResponse(data, 200, corsHeaders)
    } catch (err) {
        return jsonResponse(
            { error: 'Internal error', message: err.message },
            500,
            corsHeaders
        )
    }
}

/**
 * POST /api/auth/refresh
 * 刷新 Google access_token
 *
 * Request body: { refresh_token: string }
 * Response:     { access_token, expires_in, token_type }
 */
async function handleTokenRefresh(request, env, corsHeaders) {
    if (
        env?.DISABLE_GOOGLE_OAUTH === '1' ||
        (typeof process !== 'undefined' && process.env?.DISABLE_GOOGLE_OAUTH === '1')
    ) {
        return jsonResponse(
            { error: 'Google OAuth is disabled on this server' },
            403,
            corsHeaders
        )
    }
    try {
        const { refresh_token } = await request.json()

        if (!refresh_token) {
            return jsonResponse(
                { error: 'Missing refresh_token' },
                400,
                corsHeaders
            )
        }

        const tokenResponse = await fetch(
            'https://oauth2.googleapis.com/token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    refresh_token,
                    client_id: env.GOOGLE_CLIENT_ID,
                    client_secret: env.GOOGLE_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                }),
            }
        )

        const data = await tokenResponse.json()

        if (!tokenResponse.ok) {
            return jsonResponse(
                { error: 'Token refresh failed', details: data },
                tokenResponse.status,
                corsHeaders
            )
        }

        return jsonResponse(data, 200, corsHeaders)
    } catch (err) {
        return jsonResponse(
            { error: 'Internal error', message: err.message },
            500,
            corsHeaders
        )
    }
}

/**
 * GET /api/health
 * 健康檢查端點
 */
function handleHealth(corsHeaders, ctx) {
    return jsonResponse(
        {
            status: 'ok',
            service: 'easy-accounting-sync',
            selfHosted: !!ctx,
            registerEnabled: !!ctx?.env?.SELF_HOST_ALLOW_REGISTER,
            timestamp: new Date().toISOString(),
        },
        200,
        corsHeaders
    )
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

/**
 * 主路由邏輯，可被 Worker fetch handler 及 standalone server 共用
 * @param {Request} request
 * @param {{ GOOGLE_CLIENT_ID: string, GOOGLE_CLIENT_SECRET: string, ALLOWED_ORIGINS: string }} env
 * @param {{ store: import('./db.js').SqliteStore, env: object }|null} [ctx]
 *   self-hosted sync context（standalone 模式下建立；Worker 模式傳 null 僅走 OAuth Proxy）
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env, ctx = null) {
    const corsHeaders = getCorsHeaders(request, env.ALLOWED_ORIGINS)
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()

    // Self-hosted sync 路由優先（純自架模式；ctx 存在時才啟用）
    const selfHostResponse = await dispatchSelfHostRoute(request, ctx)
    if (selfHostResponse) return selfHostResponse

    // CORS preflight
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...Object.fromEntries(corsHeaders.entries()),
                ...SECURITY_HEADERS,
            },
        })
    }

    // Route matching
    if (method === 'POST' && pathname === '/api/auth/token') {
        return handleTokenExchange(request, env, corsHeaders)
    }

    if (method === 'POST' && pathname === '/api/auth/refresh') {
        return handleTokenRefresh(request, env, corsHeaders)
    }

    if (method === 'GET' && pathname === '/api/health') {
        return handleHealth(corsHeaders, ctx)
    }

    // 404 fallback
    return jsonResponse({ error: 'Not found' }, 404, corsHeaders)
}

// ──────────────────────────────────────────────
// Cloudflare Worker Entry Point
// ──────────────────────────────────────────────

export default {
    /**
     * Cloudflare Worker fetch handler
     * @param {Request} request
     * @param {object} env  Bindings (secrets + vars)
     * @returns {Promise<Response>}
     */
    async fetch(request, env) {
        return handleRequest(request, env)
    },
}

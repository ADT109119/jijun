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

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * 建立 JSON 回應
 * @param {object} body  回應 body
 * @param {number} status  HTTP status code
 * @param {Headers} corsHeaders  CORS headers
 * @returns {Response}
 */
function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...Object.fromEntries(corsHeaders.entries()),
      'Content-Type': 'application/json',
    },
  })
}

/**
 * 根據請求 Origin 產生 CORS headers
 * @param {Request} request
 * @param {string} allowedOriginsStr  逗號分隔允許的 origin
 * @returns {Headers}
 */
function getCorsHeaders(request, allowedOriginsStr) {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigins = (allowedOriginsStr || '').split(',').map(o => o.trim())
  const headers = new Headers()

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

// ──────────────────────────────────────────────
// Route Handlers
// ──────────────────────────────────────────────

/**
 * POST /api/auth/token
 * 用 Google authorization code 換取 tokens
 *
 * Request body: { code: string, redirect_uri: string }
 * Response:     { access_token, refresh_token, expires_in, token_type, id_token }
 */
async function handleTokenExchange(request, env, corsHeaders) {
  try {
    const { code, redirect_uri } = await request.json()

    if (!code) {
      return jsonResponse(
        { error: 'Missing authorization code' },
        400,
        corsHeaders
      )
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect_uri || 'postmessage',
        grant_type: 'authorization_code',
      }),
    })

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
  try {
    const { refresh_token } = await request.json()

    if (!refresh_token) {
      return jsonResponse({ error: 'Missing refresh_token' }, 400, corsHeaders)
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    })

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
function handleHealth(corsHeaders) {
  return jsonResponse(
    {
      status: 'ok',
      service: 'easy-accounting-sync',
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
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env) {
  const corsHeaders = getCorsHeaders(request, env.ALLOWED_ORIGINS)
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method.toUpperCase()

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Route matching
  if (method === 'POST' && pathname === '/api/auth/token') {
    return handleTokenExchange(request, env, corsHeaders)
  }

  if (method === 'POST' && pathname === '/api/auth/refresh') {
    return handleTokenRefresh(request, env, corsHeaders)
  }

  if (method === 'GET' && pathname === '/api/health') {
    return handleHealth(corsHeaders)
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

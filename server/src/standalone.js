/* eslint-env node */
/**
 * Easy Accounting Sync Server — Standalone (Node.js)
 *
 * 使用 Node.js 原生 http 模組，讓同一份 router 邏輯
 * 也可以在 Docker / 自架伺服器上運行。
 *
 * 環境變數：
 *   GOOGLE_CLIENT_ID     — Google OAuth 2.0 Client ID
 *   GOOGLE_CLIENT_SECRET — Google OAuth 2.0 Client Secret
 *   ALLOWED_ORIGINS      — 逗號分隔的允許 CORS origin（預設 *）
 *   PORT                 — 監聽埠號（預設 8787）
 */

import { createServer } from 'node:http'
import { handleRequest } from './index.js'

const PORT = parseInt(process.env.PORT || '8787', 10)

const env = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
}

// ──────────────────────────────────────────────
// Validate required environment variables
// ──────────────────────────────────────────────

if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  console.error('❌ Missing required environment variables:')
  if (!env.GOOGLE_CLIENT_ID) console.error('   - GOOGLE_CLIENT_ID')
  if (!env.GOOGLE_CLIENT_SECRET) console.error('   - GOOGLE_CLIENT_SECRET')
  console.error('\nPlease set them before starting the server.')
  process.exit(1)
}

// ──────────────────────────────────────────────
// Convert Node.js IncomingMessage → Web Request
// ──────────────────────────────────────────────

/**
 * 將 Node.js HTTP request 轉換為 Web API Request 物件
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Request>}
 */
async function toWebRequest(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host || `localhost:${PORT}`
  const url = `${protocol}://${host}${req.url}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  let body = null

  if (hasBody) {
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    body = Buffer.concat(chunks)
  }

  return new Request(url, {
    method: req.method,
    headers,
    body,
  })
}

// ──────────────────────────────────────────────
// HTTP Server
// ──────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    const webRequest = await toWebRequest(req)
    const webResponse = await handleRequest(webRequest, env)

    // Convert Web Response → Node.js response
    res.writeHead(
      webResponse.status,
      Object.fromEntries(webResponse.headers.entries())
    )
    const responseBody = await webResponse.text()
    res.end(responseBody)
  } catch (err) {
    console.error('Server error:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Internal server error' }))
  }
})

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Easy Accounting Sync Server (Standalone)   ║
╠══════════════════════════════════════════════╣
║  🚀 Listening on port ${String(PORT).padEnd(25)}║
║  📋 Health check: http://localhost:${String(PORT).padEnd(10)}║
║     /api/health                              ║
╚══════════════════════════════════════════════╝
  `)
})

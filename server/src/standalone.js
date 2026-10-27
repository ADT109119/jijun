/**
 * Easy Accounting Sync Server — Standalone (Node.js)
 *
 * 使用 Node.js 原生 http 模組，讓同一份 router 邏輯
 * 也可以在 Docker / 自架伺服器上運行。
 *
 * 兩種角色（皆由環境變數控制，可同時啟用）：
 * 1. Google OAuth Proxy（既有功能）
 * 2. 純自架同步伺服器（Self-Hosted Sync，SQLite 儲存，不綁 Google）
 *    - SELF_HOST_ADMIN_TOKEN 設定後即啟用（見 SELF_HOST.md）
 *
 * 環境變數：
 *   GOOGLE_CLIENT_ID     — Google OAuth 2.0 Client ID（僅 OAuth Proxy 需要）
 *   GOOGLE_CLIENT_SECRET — Google OAuth 2.0 Client Secret（僅 OAuth Proxy 需要）
 *   ALLOWED_ORIGINS      — 逗號分隔的允許 CORS origin（預設 *）
 *   PORT                 — 監聽埠號（預設 8080）
 *   SELF_HOST_ADMIN_TOKEN — 純自架模式 bootstrap token（設定後啟用 SQLite 同步）
 *   SELF_HOST_ALLOW_REGISTER — 開放公開註冊 1/0（預設 0 關閉；admin 可 runtime 切換）
 *   SELF_HOST_DB_PATH    — SQLite 資料庫路徑（預設 ./data/jijun.db）
 *   SELF_HOST_STATIC_DIR — 前端 build 靜態目錄（預設 ../dist；設定後同埠提供前端）
 *   BACKUP_RETENTION_COUNT — 每使用者備份保留筆數（預設 100）
 *
 * 注意：Node.js >= 22.5 需要（node:sqlite）。
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { resolve, normalize, extname, join, sep } from 'node:path'
import { handleRequest } from './index.js'
import { SECURITY_HEADERS, getSecurityHeaders } from './http.js'
import { SqliteStore } from './db.js'

const PORT = parseInt(process.env.PORT || '8080', 10)

const env = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
    DISABLE_GOOGLE_OAUTH: process.env.DISABLE_GOOGLE_OAUTH || '',
}

// ──────────────────────────────────────────────
// Self-hosted sync context（SQLite）
// ──────────────────────────────────────────────

let ctx = null
if (process.env.SELF_HOST_ADMIN_TOKEN) {
    const store = new SqliteStore(
        process.env.SELF_HOST_DB_PATH || './data/jijun.db'
    )
    await store.init()

    // Bootstrap：首次啟動（無任何使用者）時，用 SELF_HOST_ADMIN_TOKEN 建立管理員帳號。
    // 讓純自架使用者「開機即可用」，不需額外工具：
    //   帳號: admin
    //   PIN:  SELF_HOST_ADMIN_TOKEN
    const userCount =
        Number(
            store.db
                .prepare('SELECT COUNT(*) AS c FROM users')
                .get().c
        ) || 0
    if (userCount === 0) {
        const { hashPin } = await import('./auth.js')
        const adminToken = process.env.SELF_HOST_ADMIN_TOKEN
        // H-2 防禦：admin token 就是 admin 帳號的 PIN，過短等於給攻擊者
        // 一個公開帳號名（admin）+ 短口令的暴力入口。低於 16 字元明確警告。
        if (adminToken.length < 16) {
            console.warn(
                '[SelfHost] ⚠️ 警告：SELF_HOST_ADMIN_TOKEN 少於 16 字元——' +
                    '請改用長隨機值（例：openssl rand -hex 32）。' +
                    'admin 帳號可直接登入管理面板，短口令極易被暴力破解。'
            )
        }
        // PIN 以 scrypt 派生（含隨機鹽），與一般帳號一致（紅隊報告 H-2）
        await store.createUserAsAdmin('admin', await hashPin(adminToken), true)
        console.log(
            '[SelfHost] Bootstrap: 已建立管理員帳號 admin（PIN = SELF_HOST_ADMIN_TOKEN）'
        )
    }

    // 註冊開關：env 預設（DB 內的 runtime 設定可覆寫，見 admin API）
    const envAllowRegister = process.env.SELF_HOST_ALLOW_REGISTER === '1'
    const dbAllowRegister = await store.getMeta('allow_register')
    const allowRegister =
        dbAllowRegister !== null
            ? dbAllowRegister === '1'
            : envAllowRegister
    if (allowRegister) {
        console.log('[SelfHost] 公開註冊：已啟用')
    }

    ctx = {
        store,
        env: {
            ...env,
            BACKUP_RETENTION_COUNT: parseInt(
                process.env.BACKUP_RETENTION_COUNT || '100',
                10
            ),
            BACKUP_TOTAL_QUOTA_BYTES: parseInt(
                process.env.BACKUP_TOTAL_QUOTA_BYTES || String(500 * 1024 * 1024),
                10
            ),
            SELF_HOST_ALLOW_REGISTER: allowRegister,
        },
    }
    console.log('[SelfHost] SQLite 同步已啟用 (DB: ' + store.dbPath + ')')
}

// ──────────────────────────────────────────────
// 靜態檔案伺服（自架部署時同埠提供前端 build）
// ──────────────────────────────────────────────

const STATIC_DIR = process.env.SELF_HOST_STATIC_DIR
    ? resolve(process.env.SELF_HOST_STATIC_DIR)
    : null

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
}

/**
 * 伺服靜態檔案；SPA fallback 到 index.html。
 * 統一附加安全標頭（紅隊報告 M-3）。
 * 快取策略：HTML 不佔快取（更新即見）；Vite 產物帶 content-hash，
 * 允許長期 immutable 快取。
 * @returns {Promise<Response|null>} null 表示非靜態請求
 */
function processRobotsMeta(htmlStr) {
    const isNoIndex =
        process.env.NO_INDEX !== '0' &&
        process.env.SELF_HOST_NO_INDEX !== '0'
    const metaTagRegex = /<meta\s+name=["']robots["']\s+content=["'][^"']*["']\s*\/?>\s*\n?/gi
    if (isNoIndex) {
        if (!htmlStr.includes('name="robots"')) {
            const metaTag = '    <meta name="robots" content="noindex, nofollow" />\n'
            if (htmlStr.includes('</head>')) {
                return htmlStr.replace('</head>', metaTag + '    </head>')
            } else if (htmlStr.includes('<head>')) {
                return htmlStr.replace('<head>', '<head>\n' + metaTag)
            } else {
                return metaTag + htmlStr
            }
        }
        return htmlStr
    } else {
        // NO_INDEX=0 時動態移除 HTML 內任何寫死的 noindex robots meta 標籤（支援 Docker 執行期切換放行）
        return htmlStr.replace(metaTagRegex, '')
    }
}

async function serveStatic(pathname) {
    if (!STATIC_DIR || !existsSync(STATIC_DIR)) return null

    let decodedPath = pathname
    try {
        decodedPath = decodeURIComponent(pathname)
    } catch (_) {
        return null
    }

    const filePath = normalize(join(STATIC_DIR, decodedPath))
    // 防 directory traversal（含同前綴兄弟目錄如 /app/static-secret）
    if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + sep)) return null

    try {
        if (existsSync(filePath) && statSync(filePath).isFile()) {
            let content = await readFile(filePath)
            const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
            const isHtml = extname(filePath) === '.html'
            if (isHtml) {
                const htmlStr = processRobotsMeta(content.toString('utf-8'))
                content = Buffer.from(htmlStr, 'utf-8')
            }
            // /assets/*-<hash>.js|css 等 Vite 產物 → 長期快取
            const hashed = pathname.startsWith('/assets/') && /-[A-Za-z0-9_]{8,}\.[A-Za-z0-9]+$/.test(pathname)
            return new Response(content, {
                status: 200,
                headers: {
                    'Content-Type': type,
                    ...getSecurityHeaders(),
                    'Cache-Control': isHtml
                        ? 'no-cache'
                        : hashed
                          ? 'public, max-age=31536000, immutable'
                          : 'public, max-age=3600',
                },
            })
        }
    } catch (_) {
        // 讀取失敗 → 落回 SPA fallback
    }

    // 靜態資源未命中時直接回傳 404，不應落入 SPA fallback（防止將 index.html 當作 JS/CSS 載入噴語法錯誤）
    if (
        pathname.startsWith('/assets/') ||
        /\.(js|mjs|css|png|jpg|jpeg|gif|svg|ico|woff2?|wasm|map|json)$/i.test(pathname)
    ) {
        return new Response('Not Found', {
            status: 404,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                ...getSecurityHeaders(),
            },
        })
    }

    // SPA fallback：非 /api 路徑一律回 index.html
    if (pathname.startsWith('/api/')) return null
    const indexFile = join(STATIC_DIR, 'index.html')
    if (existsSync(indexFile)) {
        let content = await readFile(indexFile)
        const htmlStr = processRobotsMeta(content.toString('utf-8'))
        content = Buffer.from(htmlStr, 'utf-8')
        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...getSecurityHeaders(),
                'Cache-Control': 'no-cache',
            },
        })
    }
    return null
}

// ──────────────────────────────────────────────
// Validate required environment variables
// ──────────────────────────────────────────────

// Google OAuth 變數只在未設定 DISABLE_GOOGLE_OAUTH=1 時才是必要的
const needGoogle = !(
    env.DISABLE_GOOGLE_OAUTH === '1' ||
    process.env.DISABLE_GOOGLE_OAUTH === '1'
)
if (needGoogle && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
    console.error('❌ Missing required environment variables:')
    if (!env.GOOGLE_CLIENT_ID) console.error('   - GOOGLE_CLIENT_ID')
    if (!env.GOOGLE_CLIENT_SECRET) console.error('   - GOOGLE_CLIENT_SECRET')
    console.error(
        '\n請設定 Google OAuth 憑證，或改用純自架模式：'
    )
    console.error(
        '   export SELF_HOST_ADMIN_TOKEN=<random-secret> && export DISABLE_GOOGLE_OAUTH=1'
    )
    process.exit(1)
}

// ──────────────────────────────────────────────
// Convert Node.js IncomingMessage → Web Request
// ──────────────────────────────────────────────

const MAX_BACKUP_BODY_BYTES =
    (Number(process.env.MAX_BACKUP_MB) || 50) * 1024 * 1024 + 65536
const MAX_PUSH_BODY_BYTES = 10 * 1024 * 1024 // 10MB 足夠 5000~20000 筆變更
const MAX_AUTH_BODY_BYTES = 64 * 1024 // 64KB 足夠 login/register/devices/admin 請求

function getMaxBodyBytes(urlPath) {
    if (urlPath.startsWith('/api/selfhost/backup')) {
        return MAX_BACKUP_BODY_BYTES
    }
    if (
        urlPath.startsWith('/api/selfhost/push') ||
        urlPath.startsWith('/api/selfhost/shared')
    ) {
        return MAX_PUSH_BODY_BYTES
    }
    return MAX_AUTH_BODY_BYTES
}

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
        if (value)
            headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
    // 底層 TCP Socket 遠端 IP（防標頭未啟用反代時限速器全站共用 local）
    headers.delete('x-socket-remote-address')
    if (req.socket?.remoteAddress) {
        headers.set('x-socket-remote-address', req.socket.remoteAddress)
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    let body = null

    if (hasBody) {
        const urlPath = req.url ? req.url.split('?')[0] : ''
        const maxBytes = getMaxBodyBytes(urlPath)
        const cl = Number(req.headers['content-length'] || 0)
        if (cl > maxBytes) {
            const err = new Error('Payload Too Large')
            err.status = 413
            throw err
        }
        // 🔐 防記憶體耗盡：針對大型 Payload 端點（如 backup、push、shared），
        // 若未帶 Authorization 標頭且長度超過 64KB，在讀取 body 前直接拒絕
        if (maxBytes > 64 * 1024 && (cl > 64 * 1024 || !req.headers['content-length'])) {
            const requiresAuth =
                urlPath.startsWith('/api/selfhost/backup') ||
                urlPath.startsWith('/api/selfhost/push') ||
                urlPath.startsWith('/api/selfhost/shared')
            if (requiresAuth) {
                const authH = req.headers['authorization'] || ''
                const m = authH.match(/^Bearer\s+(.+)$/i)
                const tok = m ? m[1].trim() : ''
                const u = tok && ctx?.store ? await ctx.store.verifyToken(tok) : null
                if (!u) {
                const err = new Error('Unauthorized')
                err.status = 401
                    throw err
                }
            }
        }
        const chunks = []
        let totalBytes = 0
        for await (const chunk of req) {
            totalBytes += chunk.length
            if (totalBytes > maxBytes) {
                const err = new Error('Payload Too Large')
                err.status = 413
                throw err
            }
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

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

const server = createServer(async (req, res) => {
    try {
        // L-2（紅隊報告）：非白名單方法（TRACE/PATCH/...）一律 405，
        // 不再落入後續處理產生 500。
        if (!ALLOWED_METHODS.has((req.method || '').toUpperCase())) {
            res.writeHead(405, {
                'Content-Type': 'application/json',
                Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
                ...getSecurityHeaders(),
            })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
        }

        const rawUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

        // 爬蟲控制：/robots.txt（自架版預設拒絕所有爬蟲，NO_INDEX=0 時放行）
        if (
            (req.method === 'GET' || req.method === 'HEAD') &&
            rawUrl.pathname === '/robots.txt'
        ) {
            const isNoIndex =
                process.env.NO_INDEX !== '0' &&
                process.env.SELF_HOST_NO_INDEX !== '0'
            const robotsTxt = isNoIndex
                ? 'User-agent: *\nDisallow: /\n'
                : 'User-agent: *\nAllow: /\n'
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                ...getSecurityHeaders(),
                'Cache-Control': 'public, max-age=86400',
            })
            if (req.method === 'HEAD') {
                res.end()
            } else {
                res.end(robotsTxt)
            }
            return
        }

        // 靜態請求直接處理（避免 Request body 讀取）
        if (
            (req.method === 'GET' || req.method === 'HEAD') &&
            !rawUrl.pathname.startsWith('/api/')
        ) {
            const staticResponse = await serveStatic(rawUrl.pathname)
            if (staticResponse) {
                res.writeHead(
                    staticResponse.status,
                    Object.fromEntries(staticResponse.headers.entries())
                )
                if (req.method === 'HEAD') {
                    res.end()
                } else {
                    res.end(Buffer.from(await staticResponse.arrayBuffer()))
                }
                return
            }
        }

        const webRequest = await toWebRequest(req)
        const webResponse = await handleRequest(webRequest, env, ctx)

        res.writeHead(
            webResponse.status,
            Object.fromEntries(webResponse.headers.entries())
        )
        const responseBody = await webResponse.text()
        res.end(responseBody)
    } catch (err) {
        if (err && err.status === 401) {
            res.writeHead(401, {
                'Content-Type': 'application/json',
                'Connection': 'close',
                ...getSecurityHeaders(),
            })
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            req.resume()
            return
        }
        if (err && err.status === 413) {
            res.writeHead(413, {
                'Content-Type': 'application/json',
                'Connection': 'close',
                ...getSecurityHeaders(),
            })
            res.end(JSON.stringify({ error: 'Payload Too Large' }))
            req.resume()
            return
        }
        console.error('Server error:', err)
        res.writeHead(500, {
            'Content-Type': 'application/json',
            ...getSecurityHeaders(),
        })
        res.end(JSON.stringify({ error: 'Internal server error' }))
    }
})

function gracefulShutdown(signal) {
    console.log(`\n  [SelfHost] 收到 ${signal}，正在安全關閉伺服器...`)
    server.close(() => {
        if (ctx?.store) {
            try {
                ctx.store.close()
                console.log('  [SelfHost] 資料庫連接已安全關閉')
            } catch (err) {
                console.error('  [SelfHost] 關閉資料庫時發生錯誤:', err)
            }
        }
        process.exit(0)
    })
    setTimeout(() => {
        console.error('  [SelfHost] 強制退出逾時')
        process.exit(1)
    }, 5000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   Easy Accounting Sync Server (Standalone)   ║
╠══════════════════════════════════════════════╣
║  Listening on port ${String(PORT).padEnd(25)}║
║  Health check: http://localhost:${String(PORT).padEnd(10)}║
║     /api/health                              ║
╚══════════════════════════════════════════════╝
  `)
    if (ctx) {
        console.log('  [SelfHost] 純自架同步 API 已啟用：/api/selfhost/*')
        console.log('  [SelfHost] 文件：SEE SELF_HOST.md（本 repo 根目錄）')
    }
    if (STATIC_DIR && existsSync(STATIC_DIR)) {
        console.log(`  [Static] 前端靜態檔案：${STATIC_DIR}`)
    }
})

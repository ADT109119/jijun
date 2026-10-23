/**
 * Easy Accounting Sync Server — 純自架同步 API（Self-Hosted Sync）
 *
 * 為「純自架」（不綁 Google）使用者提供完整的雲端同步功能：
 * 資料存於本機 SQLite（DB 抽象層見 db.js，未來可換 PostgreSQL）。
 *
 * 語意與 Google Drive 端完全一致（前端可無感切換 transport）：
 * - 每裝置一筆 append-only sync log（等同 Drive 端的 sync_log_<deviceId>.json）
 * - 全量 JSON 備份（等同 Drive 端的 backup_*.json）
 *
 * 認證：使用者以 username + PIN 註冊，取得 bearer token（DB 只存 sha256）。
 * 此後所有端點需要 `Authorization: Bearer <token>`。
 *
 * 端點（皆前綴 /api/selfhost）：
 * | Method | Path                    | 說明                              |
 * | ------ | ----------------------- | --------------------------------- |
 * | POST   | /register               | {username, pin} → 建立帳號+裝置   |
 * | POST   | /login                  | {username, pin} → 換 token        |
 * | GET    | /me                     | 目前帳號資訊 + 裝置列表           |
 * | POST   | /devices/register       | {deviceId} → 註冊/更新裝置        |
 * | POST   | /push                   | {changes:[...]} → 合併進裝置 log  |
 * | GET    | /pull?since=            | 所有裝置 log（可時間過濾）        |
 * | POST   | /backup                 | {fileName, content, size} → 存備份|
 * | GET    | /backups                | 備份列表（不含 content）          |
 * | GET    | /backups/:id            | 備份內容                          |
 * | DELETE | /backups/:id            | 刪除備份                          |
 */

import { getCorsHeaders, jsonResponse, SECURITY_HEADERS } from './http.js'
import {
    hashPin,
    loginLimiter,
    lookupLimiter,
    clientIp,
} from './auth.js'

// ──────────────────────────────────────────────
// Validation helpers
// ──────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/
const MAX_CHANGE_BODY_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_BACKUP_BODY_BYTES = 50 * 1024 * 1024 // 50 MB

function isValidUsername(username) {
    return typeof username === 'string' && USERNAME_RE.test(username)
}

function isValidPin(pin) {
    return typeof pin === 'string' && pin.length >= 4 && pin.length <= 64
}

function isValidDeviceId(deviceId) {
    return (
        typeof deviceId === 'string' &&
        deviceId.length >= 8 &&
        deviceId.length <= 128 &&
        /^[a-zA-Z0-9_-]+$/.test(deviceId)
    )
}

/**
 * 從 Authorization header 取出 token 並驗證。
 * @returns {Promise<object|null>} user
 */
async function authenticate(request, store) {
    const header = request.headers.get('Authorization') || ''
    const m = header.match(/^Bearer\s+(.+)$/i)
    if (!m) return null
    return store.verifyToken(m[1].trim())
}

/**
 * 驗證 admin 身份（token 對應的 user 必須 is_admin=1）。
 * @returns {Promise<object|null>} user（是 admin 才回傳）
 */
async function authenticateAdmin(request, store) {
    const user = await authenticate(request, store)
    if (!user) return null
    if (!(await store.getUserIsAdmin(user.id))) return null
    return user
}

class PayloadTooLargeError extends Error {
    constructor() {
        super('Payload too large')
        this.status = 413
    }
}

/**
 * 讀取 request JSON body（含大小上限，無 Content-Length 時亦會串流檢查上限並拋 413）。
 * @returns {Promise<object|null>}
 */
async function readJsonBody(request, maxBytes) {
    const cl = Number(request.headers.get('Content-Length') || 0)
    if (cl > maxBytes) {
        throw new PayloadTooLargeError()
    }
    let text
    if (request.body && typeof request.body.getReader === 'function') {
        const reader = request.body.getReader()
        const chunks = []
        let totalBytes = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
                totalBytes += value.byteLength
                if (totalBytes > maxBytes) {
                    try {
                        await reader.cancel()
                    } catch (_) {}
                    throw new PayloadTooLargeError()
                }
                chunks.push(value)
            }
        }
        text = Buffer.concat(chunks).toString('utf8')
    } else {
        const buf = await request.arrayBuffer()
        if (buf.byteLength > maxBytes) {
            throw new PayloadTooLargeError()
        }
        text = Buffer.from(buf).toString('utf8')
    }
    try {
        return JSON.parse(text)
    } catch (_) {
        return null
    }
}

/** 驗證一筆 change 的結構（與前端 logChange 寫入的格式一致）。 */
function isValidChange(c) {
    return (
        c &&
        typeof c === 'object' &&
        ['add', 'update', 'delete'].includes(c.operation) &&
        typeof c.storeName === 'string' &&
        typeof c.timestamp === 'number' &&
        isFinite(c.timestamp)
    )
}

// ──────────────────────────────────────────────
// Route handlers
// ──────────────────────────────────────────────

/**
 * POST /api/selfhost/register
 * Body: { username, pin, deviceId? }
 * → 201 { token, username, deviceId? }
 */
export async function handleRegister(request, ctx, corsHeaders) {
    // 註冊開關（預設關閉；SELF_HOST_ALLOW_REGISTER=1 或 admin runtime 切換可啟用）
    if (!ctx.env.SELF_HOST_ALLOW_REGISTER) {
        return jsonResponse(
            {
                error:
                    'Registration is disabled on this server. Ask the administrator to create an account for you.',
            },
            403,
            corsHeaders
        )
    }

    const body = await readJsonBody(request, 4096)
    if (!body) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
    }
    const { username, pin, deviceId } = body

    if (!isValidUsername(username)) {
        return jsonResponse(
            {
                error:
                    'Invalid username (2-32 chars, letters/digits/_/- only)',
            },
            400,
            corsHeaders
        )
    }
    if (!isValidPin(pin)) {
        return jsonResponse(
            { error: 'Invalid PIN (4-64 chars)' },
            400,
            corsHeaders
        )
    }
    if (deviceId !== undefined && !isValidDeviceId(deviceId)) {
        return jsonResponse({ error: 'Invalid deviceId' }, 400, corsHeaders)
    }

    // 防暴力：register 兼具 login 語意，同樣受限速保護（H-2）
    const rlKey = `${clientIp(request)}|${username}`
    const blocked = loginLimiter.check(rlKey)
    if (blocked) {
        return jsonResponse(
            { error: 'Too many attempts. Try again later.' },
            429,
            corsHeaders,
            { 'Retry-After': String(blocked.retryAfterSec) }
        )
    }

    const existing = await ctx.store.getUserByUsername(username)
    if (existing) {
        // 已存在 → 直接當 login 處理（token 會換發新值，舊 token 仍有效）
        const ok = await ctx.store.verifyLogin(username, pin)
        if (!ok) {
            // L-1 修正：不洩漏帳號存在性——錯 PIN 與 login 端回傳完全相同的
            // 訊息與狀態碼（存在+錯PIN → 401 Invalid username or PIN）。
            loginLimiter.recordFailure(rlKey)
            return jsonResponse(
                { error: 'Invalid username or PIN' },
                401,
                corsHeaders
            )
        }
        loginLimiter.recordSuccess(rlKey)
        const { token } = await ctx.store.createToken(existing.id)
        return jsonResponse(
            { token, username, alreadyRegistered: true },
            200,
            corsHeaders
        )
    }

    const user = await ctx.store.createUser(username, await hashPin(pin))
    const { token } = await ctx.store.createToken(user.id)

    if (deviceId && isValidDeviceId(deviceId)) {
        await ctx.store.registerDevice(deviceId, user.id, username)
    }

    return jsonResponse(
        { token, username, deviceId: deviceId || null },
        201,
        corsHeaders
    )
}

/**
 * POST /api/selfhost/login
 * Body: { username, pin }
 * → 200 { token, username }
 */
export async function handleLogin(request, ctx, corsHeaders) {
    const body = await readJsonBody(request, 4096)
    if (!body) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
    }
    const { username, pin } = body
    if (!isValidUsername(username) || !isValidPin(pin)) {
        return jsonResponse({ error: 'Invalid username or PIN' }, 400, corsHeaders)
    }
    // 防暴力（紅隊報告 H-2）：每 IP+帳號 10 次失敗/分鐘，超過指數退避鎖定
    const rlKey = `${clientIp(request)}|${username}`
    const blocked = loginLimiter.check(rlKey)
    if (blocked) {
        return jsonResponse(
            { error: 'Too many attempts. Try again later.' },
            429,
            corsHeaders,
            { 'Retry-After': String(blocked.retryAfterSec) }
        )
    }
    const user = await ctx.store.verifyLogin(username, pin)
    if (!user) {
        loginLimiter.recordFailure(rlKey)
        return jsonResponse({ error: 'Invalid username or PIN' }, 401, corsHeaders)
    }
    loginLimiter.recordSuccess(rlKey)
    const { token } = await ctx.store.createToken(user.id)
    return jsonResponse({ token, username: user.username }, 200, corsHeaders)
}

/**
 * GET /api/selfhost/me（需 auth）
 * → 200 { username, devices: [...] }
 */
export async function handleMe(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const devices = await ctx.store.getUserDevices(user.id)
    return jsonResponse(
        {
            username: user.username,
            devices: devices.map(d => ({
                deviceId: d.device_id,
                createdAt: d.created_at,
                lastSeen: d.last_seen,
            })),
        },
        200,
        corsHeaders
    )
}

/**
 * POST /api/selfhost/devices/register（需 auth）
 * Body: { deviceId }
 * → 200 { deviceId }
 */
export async function handleDeviceRegister(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const body = await readJsonBody(request, 1024)
    if (!body || !isValidDeviceId(body.deviceId)) {
        return jsonResponse({ error: 'Invalid deviceId' }, 400, corsHeaders)
    }
    await ctx.store.registerDevice(body.deviceId, user.id, user.username)
    return jsonResponse({ deviceId: body.deviceId }, 200, corsHeaders)
}

/**
 * POST /api/selfhost/push（需 auth）
 * Body: { deviceId, changes: [...] }
 * → 200 { added, total }
 *
 * 合併語意：changes 按 timestamp 排序後批次 append 進裝置 log，
 * 以 5-part key `deviceId|timestamp|operation|storeName|recordIdentifier` 去重（與前端一致）。
 */
export async function handlePush(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const body = await readJsonBody(request, MAX_CHANGE_BODY_BYTES)
    if (!body) {
        return jsonResponse(
            { error: 'Invalid JSON body (or too large)' },
            400,
            corsHeaders
        )
    }
    if (!isValidDeviceId(body.deviceId)) {
        return jsonResponse({ error: 'Invalid deviceId' }, 400, corsHeaders)
    }
    if (!Array.isArray(body.changes) || body.changes.length === 0) {
        return jsonResponse(
            { error: 'changes must be a non-empty array' },
            400,
            corsHeaders
        )
    }
    if (body.changes.length > 5000) {
        return jsonResponse(
            { error: 'Too many changes in one push (max 5000)' },
            400,
            corsHeaders
        )
    }
    for (const c of body.changes) {
        if (!isValidChange(c)) {
            return jsonResponse(
                { error: 'Invalid change entry' },
                400,
                corsHeaders
            )
        }
    }

    // 裝置歸屬檢查（防跨帳號注入）：
    // - 裝置不存在 → 自動註冊為本帳號（前端 login 後會先 register，容忍順序差異）
    // - 裝置已存在但不屬於本帳號 → 拒絕（不能把別人的裝置 log 當自己的寫）
    const device = await ctx.store.getDevice(body.deviceId)
    if (device && device.user_id !== user.id) {
        return jsonResponse(
            { error: 'Device belongs to another account' },
            403,
            corsHeaders
        )
    }
    if (!device) {
        await ctx.store.registerDevice(body.deviceId, user.id, user.username)
    }

    // 排序後批次 append（appendDeviceLogChanges 內部會去重並以單一交易寫入）
    const sorted = [...body.changes].sort((a, b) => a.timestamp - b.timestamp)
    const normalizedChanges = sorted.map(c => ({
        deviceId: body.deviceId,
        operation: c.operation,
        storeName: c.storeName,
        recordId: c.recordId ?? null,
        data: c.data ?? null,
        timestamp: c.timestamp,
    }))
    const { added, total } = await ctx.store.appendDeviceLogChanges(
        body.deviceId,
        normalizedChanges
    )

    return jsonResponse({ added, total }, 200, corsHeaders)
}

/**
 * GET /api/selfhost/pull?since=<ts>&deviceId=<myId>（需 auth）
 * → 200 { devices: [ { deviceId, changes: [...], modifiedAt } ] }
 *
 * - `since`（選填）：只回 timestamp >= since 的變更（全域過濾）
 * - `deviceId`（選填）：排除指定裝置（通常是自己的）
 */
export async function handlePull(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const url = new URL(request.url)
    const since = Number(url.searchParams.get('since') || 0)
    const excludeDevice = url.searchParams.get('deviceId') || null

    const devices = await ctx.store.getUserDevices(user.id)
    const result = []
    for (const d of devices) {
        if (excludeDevice && d.device_id === excludeDevice) continue
        const log = await ctx.store.getDeviceLog(d.device_id)
        if (!log) continue
        let parsed
        try {
            parsed = JSON.parse(log.content)
        } catch (_) {
            continue
        }
        let changes = Array.isArray(parsed?.changes) ? parsed.changes : []
        if (since > 0) {
            changes = changes.filter(c => c.timestamp >= since)
        }
        if (changes.length === 0) continue
        result.push({
            deviceId: d.device_id,
            changes,
            modifiedAt: log.modified_at,
        })
    }
    return jsonResponse({ devices: result }, 200, corsHeaders)
}

/**
 * POST /api/selfhost/backup（需 auth）
 * Body: { fileName, content, size? }
 * → 201 { id, fileName, createdAt }
 *
 * content 為「備份 JSON 字串」（前端 exportDataForSync 序列化的結果），
 * 原樣存入，還原時原樣回傳（前端再用 JSON.parse）。
 * 存檔後自動套用數量保留策略（BACKUP_RETENTION_COUNT，預設 100）。
 */
export async function handleBackupPut(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const body = await readJsonBody(request, MAX_BACKUP_BODY_BYTES)
    if (!body) {
        return jsonResponse(
            { error: 'Invalid JSON body (or too large)' },
            400,
            corsHeaders
        )
    }
    if (
        typeof body.fileName !== 'string' ||
        body.fileName.length > 255 ||
        body.fileName.includes('/') ||
        body.fileName.includes('\\') ||
        body.fileName.includes('..')
    ) {
        return jsonResponse({ error: 'Invalid fileName' }, 400, corsHeaders)
    }
    if (typeof body.content !== 'string' || body.content.length === 0) {
        return jsonResponse({ error: 'content is required' }, 400, corsHeaders)
    }
    // 確保 content 是合法 JSON（備份還原時前端要 parse）
    try {
        JSON.parse(body.content)
    } catch (_) {
        return jsonResponse(
            { error: 'content must be valid JSON' },
            400,
            corsHeaders
        )
    }

    const deviceId =
        typeof body.deviceId === 'string' && isValidDeviceId(body.deviceId)
            ? body.deviceId
            : 'unknown'
    if (body.deviceId !== undefined && body.deviceId !== 'unknown') {
        await ctx.store.registerDevice(deviceId, user.id, user.username)
    }

    const size =
        typeof body.size === 'number' && isFinite(body.size)
            ? body.size
            : Buffer.byteLength(body.content, 'utf8')
    const backup = await ctx.store.putBackup(
        user.id,
        deviceId,
        body.fileName,
        body.content,
        size
    )

    // 數量保留策略
    const retention = ctx.env.BACKUP_RETENTION_COUNT || 100
    await ctx.store.pruneBackups(user.id, retention)

    return jsonResponse(
        {
            id: backup.id,
            fileName: backup.file_name,
            size: backup.size,
            createdAt: backup.created_at,
        },
        201,
        corsHeaders
    )
}

/**
 * GET /api/selfhost/backups（需 auth）
 * → 200 { backups: [ { id, name, size, createdAt, deviceId } ] }
 * （shape 刻意對齊 Drive 端 listBackups 的欄位：id/name/size/createdTime）
 */
export async function handleBackupList(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const rows = await ctx.store.listBackups(user.id)
    return jsonResponse(
        {
            backups: rows.map(r => ({
                id: String(r.id),
                name: r.file_name,
                size: String(r.size),
                createdTime: new Date(r.created_at).toISOString(),
                modifiedTime: new Date(r.created_at).toISOString(),
                deviceId: r.device_id,
            })),
        },
        200,
        corsHeaders
    )
}

/**
 * GET /api/selfhost/backups/:id（需 auth）
 * → 200 備份 JSON 內容（直接回傳，前端可當 restoreFromDrive 的返回值用）
 */
export async function handleBackupGet(
    request,
    ctx,
    corsHeaders,
    id
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const backup = await ctx.store.getBackup(Number(id))
    if (!backup || backup.user_id !== user.id) {
        return jsonResponse({ error: 'Backup not found' }, 404, corsHeaders)
    }
    return new Response(backup.content, {
        status: 200,
        headers: {
            ...Object.fromEntries(corsHeaders.entries()),
            ...SECURITY_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    })
}

/**
 * DELETE /api/selfhost/backups/:id（需 auth）
 * → 200 { deleted: true }
 */
export async function handleBackupDelete(
    request,
    ctx,
    corsHeaders,
    id
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const backup = await ctx.store.getBackup(Number(id))
    if (!backup || backup.user_id !== user.id) {
        return jsonResponse({ error: 'Backup not found' }, 404, corsHeaders)
    }
    await ctx.store.deleteBackup(backup.id)
    return jsonResponse({ deleted: true }, 200, corsHeaders)
}

// ──────────────────────────────────────────────
// Admin（帳號管理，需 is_admin=1 的 token）
// ──────────────────────────────────────────────

/**
 * POST /api/selfhost/admin/users
 * Body: { username, pin }
 * → 201 { username, pin }（pin 僅回傳一次，供告知該使用者）
 */
export async function handleAdminCreateUser(request, ctx, corsHeaders) {
    const admin = await authenticateAdmin(request, ctx.store)
    if (!admin) {
        return jsonResponse({ error: 'Admin required' }, 403, corsHeaders)
    }
    const body = await readJsonBody(request, 4096)
    if (!body) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
    }
    const { username, pin } = body
    if (!isValidUsername(username)) {
        return jsonResponse(
            {
                error:
                    'Invalid username (2-32 chars, letters/digits/_/- only)',
            },
            400,
            corsHeaders
        )
    }
    if (!isValidPin(pin)) {
        return jsonResponse({ error: 'Invalid PIN (4-64 chars)' }, 400, corsHeaders)
    }
    if (await ctx.store.getUserByUsername(username)) {
        return jsonResponse(
            { error: 'Username already exists' },
            409,
            corsHeaders
        )
    }
    const user = await ctx.store.createUserAsAdmin(
        username,
        await hashPin(pin),
        false
    )
    return jsonResponse({ id: user.id, username, pin }, 201, corsHeaders)
}

/**
 * GET /api/selfhost/admin/users
 * → 200 { users: [...], registerEnabled }
 */
export async function handleAdminListUsers(request, ctx, corsHeaders) {
    const admin = await authenticateAdmin(request, ctx.store)
    if (!admin) {
        return jsonResponse({ error: 'Admin required' }, 403, corsHeaders)
    }
    const users = await ctx.store.listUsers()
    return jsonResponse(
        {
            users: users.map(u => ({
                id: u.id,
                username: u.username,
                isAdmin: !!u.is_admin,
                deviceCount: Number(u.device_count) || 0,
                createdAt: u.created_at,
            })),
            registerEnabled: !!ctx.env.SELF_HOST_ALLOW_REGISTER,
        },
        200,
        corsHeaders
    )
}

/**
 * POST /api/selfhost/admin/users/:username/reset-pin
 * Body: { pin }
 * → 200 { username, pin }
 */
export async function handleAdminResetPin(
    request,
    ctx,
    corsHeaders,
    username
) {
    const admin = await authenticateAdmin(request, ctx.store)
    if (!admin) {
        return jsonResponse({ error: 'Admin required' }, 403, corsHeaders)
    }
    const target = await ctx.store.getUserByUsername(username)
    if (!target) {
        return jsonResponse({ error: 'User not found' }, 404, corsHeaders)
    }
    const body = await readJsonBody(request, 4096)
    if (!body || !isValidPin(body.pin)) {
        return jsonResponse({ error: 'Invalid PIN (4-64 chars)' }, 400, corsHeaders)
    }
    await ctx.store.resetUserPin(target.id, await hashPin(body.pin))
    return jsonResponse({ username, pin: body.pin }, 200, corsHeaders)
}

/**
 * DELETE /api/selfhost/admin/users/:username
 * → 200 { deleted: true }
 * 限制：不能刪自己（防手滑）、不能刪 admin bootstrap（保留管理入口）
 */
export async function handleAdminDeleteUser(
    request,
    ctx,
    corsHeaders,
    username
) {
    const admin = await authenticateAdmin(request, ctx.store)
    if (!admin) {
        return jsonResponse({ error: 'Admin required' }, 403, corsHeaders)
    }
    const target = await ctx.store.getUserByUsername(username)
    if (!target) {
        return jsonResponse({ error: 'User not found' }, 404, corsHeaders)
    }
    if (target.id === admin.id) {
        return jsonResponse(
            { error: 'Cannot delete your own account' },
            400,
            corsHeaders
        )
    }
    if ((await ctx.store.getUserIsAdmin(target.id)) && username === 'admin') {
        return jsonResponse(
            { error: 'Cannot delete the bootstrap admin account' },
            400,
            corsHeaders
        )
    }
    await ctx.store.deleteUser(target.id)
    return jsonResponse({ deleted: true, username }, 200, corsHeaders)
}

/**
 * PUT /api/selfhost/admin/settings/register
 * Body: { enabled: boolean }
 * → 200 { registerEnabled }
 * 寫入 DB meta（runtime 持久化，重啟後仍生效，優先於 env 預設）。
 */
export async function handleAdminSetRegister(
    request,
    ctx,
    corsHeaders
) {
    const admin = await authenticateAdmin(request, ctx.store)
    if (!admin) {
        return jsonResponse({ error: 'Admin required' }, 403, corsHeaders)
    }
    const body = await readJsonBody(request, 1024)
    if (!body || typeof body.enabled !== 'boolean') {
        return jsonResponse(
            { error: 'Body must be { enabled: boolean }' },
            400,
            corsHeaders
        )
    }
    await ctx.store.setMeta('allow_register', body.enabled ? '1' : '0')
    ctx.env.SELF_HOST_ALLOW_REGISTER = body.enabled
    return jsonResponse({ registerEnabled: body.enabled }, 200, corsHeaders)
}

// ──────────────────────────────────────────────
// Shared Ledgers（跨帳號共用帳本）
//
// 語意與 Google Drive 版共用帳本一致：
// - content 為「完整比對式 log」{ deviceId, timestamp, changes: [...] }
//   （與 Drive 端 EasyAccounting_Shared_<uuid>.json 同結構）
// - 成員（members）皆可讀寫 content；owner 可增刪成員
// - 隱私邊界：只有該 ledger 的資料會同步，私人帳本不受影響
// ──────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidLedgerUuid(uuid) {
    return typeof uuid === 'string' && UUID_RE.test(uuid)
}

/**
 * GET /api/selfhost/shared
 * → 200 { ledgers: [ { uuid, name, owner, isOwner, memberCount } ] }
 */
export async function handleSharedList(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const rows = await ctx.store.listSharedLedgersForUser(user.id)
    const ledgers = []
    for (const r of rows) {
        const members = await ctx.store.listSharedMembers(r.ledger_uuid)
        ledgers.push({
            uuid: r.ledger_uuid,
            name: r.name,
            owner: r.owner_user_id === user.id,
            memberCount: members.length,
            modifiedAt: r.modified_at,
        })
    }
    return jsonResponse({ ledgers }, 200, corsHeaders)
}

/**
 * GET /api/selfhost/shared/lookup?code=<uuid 或前 8 字>
 * → 200 { found }；**請求者為該帳本成員時**才附 { uuid, name }。
 *
 * 紅隊報告 M-1 修正：舊版對任何已登入使用者回傳 uuid + 帳本名稱，
 * 前綴 LIKE 比對讓全站使用者可掃描讀取他人帳本標題（元資料洩漏）。
 * 現行：非成員僅知「code 是否存在」，成員（加入流程必要身分）才見明細。
 * 另加每帳號 30 次/分鐘限速，抑制前綴空間掃描。
 */
export async function handleSharedLookup(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    // lookup 限速（M-1）
    const rlKey = `lookup|${user.id}`
    const blocked = lookupLimiter.check(rlKey)
    if (blocked) {
        return jsonResponse(
            { error: 'Too many attempts. Try again later.' },
            429,
            corsHeaders,
            { 'Retry-After': String(blocked.retryAfterSec) }
        )
    }
    const url = new URL(request.url)
    const code = (url.searchParams.get('code') || '').trim().toLowerCase()
    if (code.length < 4 || code.length > 36) {
        return jsonResponse({ error: 'Invalid code' }, 400, corsHeaders)
    }
    if (!/^[0-9a-f-]+$/i.test(code)) {
        return jsonResponse({ error: 'Invalid code format' }, 400, corsHeaders)
    }
    const rows =
        code.length === 36
            ? ctx.store.db
                  .prepare('SELECT * FROM shared_ledgers WHERE ledger_uuid = ?')
                  .all(code)
            : ctx.store.db
                  .prepare(
                      "SELECT * FROM shared_ledgers WHERE ledger_uuid LIKE ?"
                  )
                  .all(code + '%')
    if (rows.length === 0) {
        // 未命中 = 前綴掃描探測行為 → 記失敗（配 30 次/分鐘上限，
        // 65536 前綴空間需持續數十分鐘高頻請求，正常使用者不會觸犯）
        lookupLimiter.recordFailure(rlKey)
        return jsonResponse({ found: false }, 200, corsHeaders)
    }
    // 成員才回 uuid + name（M-1：非成員僅知存在性，且不重置限速計數）
    const isMember = await ctx.store.isSharedMember(rows[0].ledger_uuid, user.id)
    if (!isMember) {
        return jsonResponse({ found: true }, 200, corsHeaders)
    }
    lookupLimiter.recordSuccess(rlKey)
    return jsonResponse(
        { found: true, uuid: rows[0].ledger_uuid, name: rows[0].name },
        200,
        corsHeaders
    )
}

/**
 * POST /api/selfhost/shared
 * Body: { ledgerUuid, name, content }
 * → 201 { uuid }
 * 建立共用帳本（owner = 目前使用者，自動成為成員）。
 */
export async function handleSharedCreate(request, ctx, corsHeaders) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const body = await readJsonBody(request, MAX_CHANGE_BODY_BYTES)
    if (!body) {
        return jsonResponse(
            { error: 'Invalid JSON body (or too large)' },
            400,
            corsHeaders
        )
    }
    if (!isValidLedgerUuid(body.ledgerUuid)) {
        return jsonResponse({ error: 'Invalid ledgerUuid' }, 400, corsHeaders)
    }
    const name =
        typeof body.name === 'string' && body.name.length <= 100
            ? body.name
            : '共用帳本'
    if (body.content !== undefined && (typeof body.content !== 'object' || body.content === null)) {
        return jsonResponse({ error: 'content must be an object' }, 400, corsHeaders)
    }
    const existing = await ctx.store.getSharedLedger(body.ledgerUuid)
    if (existing) {
        return jsonResponse(
            { error: 'Shared ledger already exists (use PUT to update)' },
            409,
            corsHeaders
        )
    }
    const content = body.content && Array.isArray(body.content.changes)
        ? body.content
        : { deviceId: user.username, timestamp: Date.now(), changes: [] }
    await ctx.store.createSharedLedger(body.ledgerUuid, user.id, name, content)
    return jsonResponse({ uuid: body.ledgerUuid, name }, 201, corsHeaders)
}

/**
 * GET /api/selfhost/shared/:uuid
 * → 200 { uuid, name, content: {...} }（僅會員）
 */
export async function handleSharedGet(
    request,
    ctx,
    corsHeaders,
    uuid
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (!(await ctx.store.isSharedMember(uuid, user.id))) {
        return jsonResponse(
            { error: 'Not a member of this shared ledger' },
            403,
            corsHeaders
        )
    }
    let content
    try {
        content = JSON.parse(shared.content)
    } catch (_) {
        content = { changes: [] }
    }
    return jsonResponse(
        { uuid, name: shared.name, content },
        200,
        corsHeaders
    )
}

/**
 * PUT /api/selfhost/shared/:uuid
 * Body: { content: {...} }（完整覆寫，與 Drive 版 updateFile 同語意）
 * → 200 { modifiedAt }（僅會員）
 */
export async function handleSharedPut(
    request,
    ctx,
    corsHeaders,
    uuid
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (!(await ctx.store.isSharedMember(uuid, user.id))) {
        return jsonResponse(
            { error: 'Not a member of this shared ledger' },
            403,
            corsHeaders
        )
    }
    const body = await readJsonBody(request, MAX_CHANGE_BODY_BYTES)
    if (!body || typeof body.content !== 'object' || body.content === null) {
        return jsonResponse(
            { error: 'Body must be { content: object }' },
            400,
            corsHeaders
        )
    }
    if (!Array.isArray(body.content.changes)) {
        return jsonResponse(
            { error: 'content.changes must be an array' },
            400,
            corsHeaders
        )
    }
    if (body.content.changes.length > 20000) {
        return jsonResponse(
            { error: 'Too many changes (max 20000 per write)' },
            400,
            corsHeaders
        )
    }
    const modifiedAt = await ctx.store.updateSharedLedgerContent(
        uuid,
        body.content
    )
    return jsonResponse({ modifiedAt }, 200, corsHeaders)
}

/**
 * GET /api/selfhost/shared/:uuid/members
 * → 200 { members: [ { username, joinedAt, isOwner } ], isOwner }（僅會員）
 */
export async function handleSharedListMembers(
    request,
    ctx,
    corsHeaders,
    uuid
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (!(await ctx.store.isSharedMember(uuid, user.id))) {
        return jsonResponse(
            { error: 'Not a member of this shared ledger' },
            403,
            corsHeaders
        )
    }
    const members = await ctx.store.listSharedMembers(uuid)
    return jsonResponse(
        {
            members: members.map(m => ({
                username: m.username,
                joinedAt: m.joined_at,
                isOwner: m.isOwner ?? (m.user_id === shared.owner_user_id),
            })),
            isOwner: shared.owner_user_id === user.id,
        },
        200,
        corsHeaders
    )
}

/**
 * POST /api/selfhost/shared/:uuid/members
 * Body: { username }
 * → 200 { added: true, username }（僅 owner）
 * 邀請使用者加入（該使用者之後可用自己的 token 讀寫此共用帳本）。
 */
export async function handleSharedAddMember(
    request,
    ctx,
    corsHeaders,
    uuid
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (shared.owner_user_id !== user.id) {
        return jsonResponse(
            { error: 'Only the owner can add members' },
            403,
            corsHeaders
        )
    }
    const body = await readJsonBody(request, 1024)
    if (!body || !isValidUsername(body.username)) {
        return jsonResponse({ error: 'Invalid username' }, 400, corsHeaders)
    }
    const target = await ctx.store.getUserByUsername(body.username)
    if (!target) {
        return jsonResponse(
            { error: 'User not found (ask them to register/login first)' },
            404,
            corsHeaders
        )
    }
    await ctx.store.addSharedMember(uuid, target.id, target.username)
    return jsonResponse(
        { added: true, username: target.username },
        200,
        corsHeaders
    )
}

/**
 * DELETE /api/selfhost/shared/:uuid/members/:username
 * → 200 { removed: true }（僅 owner；owner 本人不可移除）
 */
export async function handleSharedRemoveMember(
    request,
    ctx,
    corsHeaders,
    uuid,
    username
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (shared.owner_user_id !== user.id) {
        return jsonResponse(
            { error: 'Only the owner can remove members' },
            403,
            corsHeaders
        )
    }
    if (username === user.username) {
        return jsonResponse(
            { error: 'Cannot remove the owner (delete the shared ledger instead)' },
            400,
            corsHeaders
        )
    }
    const target = await ctx.store.getUserByUsername(username)
    if (!target) {
        return jsonResponse({ error: 'User not found' }, 404, corsHeaders)
    }
    await ctx.store.removeSharedMember(uuid, target.id)
    return jsonResponse({ removed: true, username }, 200, corsHeaders)
}

/**
 * DELETE /api/selfhost/shared/:uuid
 * → 200 { deleted: true }（僅 owner）
 */
export async function handleSharedDelete(
    request,
    ctx,
    corsHeaders,
    uuid
) {
    const user = await authenticate(request, ctx.store)
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const shared = await ctx.store.getSharedLedger(uuid)
    if (!shared) {
        return jsonResponse({ error: 'Shared ledger not found' }, 404, corsHeaders)
    }
    if (shared.owner_user_id !== user.id) {
        return jsonResponse(
            { error: 'Only the owner can delete a shared ledger' },
            403,
            corsHeaders
        )
    }
    await ctx.store.deleteSharedLedger(uuid)
    return jsonResponse({ deleted: true, uuid }, 200, corsHeaders)
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

/**
 * Self-hosted 路由總入口。
 * @param {Request} request
 * @param {{ store: import('./db.js').SqliteStore, env: object }} ctx
 * @returns {Promise<Response|null>} 回傳 null 表示非 self-host 路由（交還主 router）
 */
export async function handleSelfHostRoute(request, ctx) {
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()
    const corsHeaders = getCorsHeaders(request, ctx.env.ALLOWED_ORIGINS)

    if (!pathname.startsWith('/api/selfhost')) return null

    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...Object.fromEntries(corsHeaders.entries()),
                ...SECURITY_HEADERS,
            },
        })
    }

    try {
        if (method === 'POST' && pathname === '/api/selfhost/register') {
            return await handleRegister(request, ctx, corsHeaders)
        }
        if (method === 'POST' && pathname === '/api/selfhost/login') {
            return await handleLogin(request, ctx, corsHeaders)
        }
        if (method === 'GET' && pathname === '/api/selfhost/me') {
            return await handleMe(request, ctx, corsHeaders)
        }
        if (
            method === 'POST' &&
            pathname === '/api/selfhost/devices/register'
        ) {
            return await handleDeviceRegister(request, ctx, corsHeaders)
        }
        if (method === 'POST' && pathname === '/api/selfhost/push') {
            return await handlePush(request, ctx, corsHeaders)
        }
        if (method === 'GET' && pathname === '/api/selfhost/pull') {
            return await handlePull(request, ctx, corsHeaders)
        }
        if (method === 'POST' && pathname === '/api/selfhost/backup') {
            return await handleBackupPut(request, ctx, corsHeaders)
        }
        if (method === 'GET' && pathname === '/api/selfhost/backups') {
            return await handleBackupList(request, ctx, corsHeaders)
        }

        // ── Admin（帳號管理）──
        if (pathname === '/api/selfhost/admin/users') {
            if (method === 'POST') {
                return await handleAdminCreateUser(request, ctx, corsHeaders)
            }
            if (method === 'GET') {
                return await handleAdminListUsers(request, ctx, corsHeaders)
            }
        }
        const adminResetMatch = pathname.match(
            /^\/api\/selfhost\/admin\/users\/([^/]+)\/reset-pin$/
        )
        if (adminResetMatch && method === 'POST') {
            return await handleAdminResetPin(
                request,
                ctx,
                corsHeaders,
                decodeURIComponent(adminResetMatch[1])
            )
        }
        const adminUserMatch = pathname.match(
            /^\/api\/selfhost\/admin\/users\/([^/]+)$/
        )
        if (adminUserMatch && method === 'DELETE') {
            return await handleAdminDeleteUser(
                request,
                ctx,
                corsHeaders,
                decodeURIComponent(adminUserMatch[1])
            )
        }
        if (
            pathname === '/api/selfhost/admin/settings/register' &&
            method === 'PUT'
        ) {
            return await handleAdminSetRegister(request, ctx, corsHeaders)
        }

        // ── Shared Ledgers（跨帳號共用帳本）──
        if (pathname === '/api/selfhost/shared' && method === 'GET') {
            return await handleSharedList(request, ctx, corsHeaders)
        }
        if (pathname === '/api/selfhost/shared' && method === 'POST') {
            return await handleSharedCreate(request, ctx, corsHeaders)
        }
        if (pathname === '/api/selfhost/shared/lookup') {
            return await handleSharedLookup(request, ctx, corsHeaders)
        }
        const sharedMemberRemoveMatch = pathname.match(
            /^\/api\/selfhost\/shared\/([^/]+)\/members\/([^/]+)$/
        )
        if (sharedMemberRemoveMatch && method === 'DELETE') {
            return await handleSharedRemoveMember(
                request,
                ctx,
                corsHeaders,
                sharedMemberRemoveMatch[1],
                decodeURIComponent(sharedMemberRemoveMatch[2])
            )
        }
        const sharedMemberMatch = pathname.match(
            /^\/api\/selfhost\/shared\/([^/]+)\/members$/
        )
        if (sharedMemberMatch) {
            if (method === 'GET') {
                return await handleSharedListMembers(
                    request,
                    ctx,
                    corsHeaders,
                    sharedMemberMatch[1]
                )
            }
            if (method === 'POST') {
                return await handleSharedAddMember(
                    request,
                    ctx,
                    corsHeaders,
                    sharedMemberMatch[1]
                )
            }
        }
        const sharedMatch = pathname.match(/^\/api\/selfhost\/shared\/([^/]+)$/)
        if (sharedMatch) {
            if (method === 'GET') {
                return await handleSharedGet(
                    request,
                    ctx,
                    corsHeaders,
                    sharedMatch[1]
                )
            }
            if (method === 'PUT') {
                return await handleSharedPut(
                    request,
                    ctx,
                    corsHeaders,
                    sharedMatch[1]
                )
            }
            if (method === 'DELETE') {
                return await handleSharedDelete(
                    request,
                    ctx,
                    corsHeaders,
                    sharedMatch[1]
                )
            }
        }

        const backupMatch = pathname.match(/^\/api\/selfhost\/backups\/(\d+)$/)
        if (backupMatch) {
            if (method === 'GET') {
                return await handleBackupGet(request, ctx, corsHeaders, backupMatch[1])
            }
            if (method === 'DELETE') {
                return await handleBackupDelete(
                    request,
                    ctx,
                    corsHeaders,
                    backupMatch[1]
                )
            }
        }
        return jsonResponse(
            { error: 'Not found' },
            404,
            corsHeaders
        )
    } catch (err) {
        if (err?.status === 413) {
            return jsonResponse(
                { error: 'Payload too large' },
                413,
                corsHeaders
            )
        }
        console.error('[SelfHost] error:', err)
        return jsonResponse(
            { error: 'Internal server error' },
            500,
            corsHeaders
        )
    }
}

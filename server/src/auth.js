/**
 * Easy Accounting Sync Server — 認證輔助
 *
 * 1. PIN 派生：scrypt（有鹽、參數入碼、可升級），取代舊版無鹽 SHA-256。
 *    hash 格式：scrypt$N$r$p$salt_b64$hash_b64
 *    舊格式（裸 sha256 hex, 64 chars）仍可驗證，成功後由呼叫端升級。
 * 2. 記憶體限速器：login/register 暴力防撞（滑動窗 + 指數退避）、
 *    lookup 等端點的輕量限速。
 *
 * 防暴力實測基準（2026-10 紅隊報告 H-2）：
 *   4 位數 PIN 舊版 ~200 秒可全枚舉 → 新版每 IP+帳號 10 次/分鐘，
 *   超過鎖 60s 起指數退避（上限 15 分鐘），全枚舉需數天以上。
 */

import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

/** scrypt 參數（N=2^15 → 單次驗證 ~50-100ms、~32MB 記憶體，自架規模合宜） */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 }
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const KEY_LEN = 32

/** 供不存在帳號的登入流程對齊 scrypt 耗時（防止時序枚舉帳號存在性）。 */
export const DUMMY_SCRYPT_HASH =
    'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

/** 產生 PIN 的 scrypt hash（含隨機鹽）。 */
export async function hashPin(pin) {
    const salt = randomBytes(16)
    const key = await scryptAsync(pin, salt, KEY_LEN, {
        ...SCRYPT_PARAMS,
        maxmem: SCRYPT_MAXMEM,
    })
    return [
        'scrypt',
        SCRYPT_PARAMS.N,
        SCRYPT_PARAMS.r,
        SCRYPT_PARAMS.p,
        salt.toString('base64'),
        key.toString('base64'),
    ].join('$')
}

/** 是否為舊版無鹽 sha256 hex hash（可升級標記）。 */
export function isLegacyPinHash(pinHash) {
    return typeof pinHash === 'string' && /^[a-f0-9]{64}$/i.test(pinHash)
}

function timingSafeHexEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * 驗證 PIN 對 pin_hash（支援舊 sha256 相容比對）。
 * @returns {Promise<{ok: boolean, needsUpgrade: boolean}>}
 *   needsUpgrade=true 時呼叫端應以 hashPin(pin) 升級存檔。
 */
export async function verifyPin(pin, pinHash) {
    if (typeof pin !== 'string' || typeof pinHash !== 'string' || !pinHash) {
        return { ok: false, needsUpgrade: false }
    }
    if (isLegacyPinHash(pinHash)) {
        const h = createHash('sha256').update(pin).digest('hex')
        return { ok: timingSafeHexEqual(h, pinHash), needsUpgrade: true }
    }
    const parts = pinHash.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return { ok: false, needsUpgrade: false }
    }
    const [, N, r, p, saltB64, keyB64] = parts
    try {
        const expected = Buffer.from(keyB64, 'base64')
        const key = await scryptAsync(pin, Buffer.from(saltB64, 'base64'), expected.length, {
            N: Number(N),
            r: Number(r),
            p: Number(p),
            maxmem: SCRYPT_MAXMEM,
        })
        const ok = key.length === expected.length && timingSafeEqual(key, expected)
        // 參數低於現行標準 → 一併升級
        const needsUpgrade =
            Number(N) < SCRYPT_PARAMS.N ||
            Number(r) < SCRYPT_PARAMS.r ||
            Number(p) < SCRYPT_PARAMS.p
        return { ok, needsUpgrade }
    } catch (_) {
        return { ok: false, needsUpgrade: false }
    }
}

// ──────────────────────────────────────────────
// 記憶體限速器（單實例自架適用）
// ──────────────────────────────────────────────

/**
 * 每 key 失敗計數限速：滑動窗內失敗達上限即鎖定，
 * 鎖定時間指數退避（lockMs * 2^(超額次數)，上限 maxLockMs）。
 * 成功登入即清零。
 */
export class RateLimiter {
    /**
     * @param {{windowMs?: number, max?: number, lockMs?: number, maxLockMs?: number}} opts
     */
    constructor({
        windowMs = 60_000,
        max = 10,
        lockMs = 60_000,
        maxLockMs = 15 * 60_000,
    } = {}) {
        this.windowMs = windowMs
        this.max = max
        this.lockMs = lockMs
        this.maxLockMs = maxLockMs
        /** @type {Map<string, {fails: number, windowStart: number, lockedUntil: number}>} */
        this._m = new Map()
        this._lastGc = Date.now()
    }

    /**
     * 請求前檢查。
     * @returns {null | {retryAfterSec: number}} null = 放行
     */
    check(key) {
        const now = Date.now()
        this._gc(now)
        const e = this._m.get(key)
        if (!e) return null
        if (e.lockedUntil > now) {
            return { retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000) }
        }
        if (now - Math.max(e.windowStart, e.lockedUntil || 0) >= this.windowMs) {
            // 距離視窗起點與最近一次鎖定結束皆已超過 windowMs → 清掉計數
            this._m.delete(key)
        }
        return null
    }

    /** 記錄一次失敗（回傳目前窗內失敗數，供測試/日誌）。 */
    recordFailure(key) {
        const now = Date.now()
        let e = this._m.get(key)
        if (!e || now - Math.max(e.windowStart, e.lockedUntil || 0) >= this.windowMs) {
            if (!this._m.has(key) && this._m.size >= 10000) {
                this._gc(now, true)
                if (this._m.size >= 10000) {
                    let evicted = false
                    for (const [k, v] of this._m) {
                        if (v.lockedUntil <= now) {
                            this._m.delete(k)
                            evicted = true
                            break
                        }
                    }
                    if (!evicted) {
                        // 所有條目皆處於鎖定期內：絕不強制刪除已鎖定的條目（防攻擊者洗白鎖定狀態）
                        return this.max + 1
                    }
                }
            }
            e = { fails: 0, windowStart: now, lockedUntil: 0 }
        }
        e.fails++
        if (e.fails > this.max) {
            const over = e.fails - this.max
            e.lockedUntil = now + Math.min(this.lockMs * 2 ** (over - 1), this.maxLockMs)
        }
        this._m.set(key, e)
        return e.fails
    }

    /** 認證成功 → 清除此 key 的失敗紀錄。 */
    recordSuccess(key) {
        this._m.delete(key)
    }

    /** 取消前置登記的嘗試（登入成功時僅抵銷前置計數，絕不洗白過往歷史失敗）。 */
    cancelPreRecordedFailure(key) {
        const e = this._m.get(key)
        if (e && e.fails > 0) {
            e.fails--
            if (e.fails <= this.max) {
                e.lockedUntil = 0
            }
        }
    }

    _gc(now, force = false) {
        if (!force && now - this._lastGc < 5 * 60_000) return
        this._lastGc = now
        for (const [k, e] of this._m) {
            if (
                e.lockedUntil <= now &&
                now - Math.max(e.windowStart, e.lockedUntil || 0) >= this.windowMs
            ) {
                this._m.delete(k)
            }
        }
    }
}

/** login/register 共用限速器：每 IP+帳號 10 次失敗/分鐘。 */
export const loginLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 10,
    lockMs: 60_000,
    maxLockMs: 15 * 60_000,
})

/** 帳號全域登入失敗限速器：每帳號 15 次失敗/分鐘（防分散式 IP 暴力攻擊單一帳號）。 */
export const accountLoginLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 15,
    lockMs: 60_000,
    maxLockMs: 15 * 60_000,
})

/** IP 全域登入失敗限速器：每 IP 30 次失敗/分鐘（防掃描隨機帳號名稱消耗 scrypt 資源）。 */
export const ipLoginLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 30,
    lockMs: 60_000,
    maxLockMs: 15 * 60_000,
})

/** 註冊專用 IP 限速器：每 IP 10 次註冊/15 分鐘（防批量註冊與 scrypt 算力 DoS）。 */
export const registerLimiter = new RateLimiter({
    windowMs: 15 * 60_000,
    max: 10,
    lockMs: 15 * 60_000,
    maxLockMs: 60 * 60_000,
})

/** lookup 限速器：每帳號 30 次/分鐘（防 uuid 前綴空間掃描）。 */
export const lookupLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 30,
    lockMs: 60_000,
    maxLockMs: 10 * 60_000,
})

/** 共用帳本成員邀請限速器：每使用者 30 次/分鐘（防探測枚舉現有使用者名稱）。 */
export const memberAddLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 30,
    lockMs: 60_000,
    maxLockMs: 10 * 60_000,
})

/**
 * 檢查 IP 是否為本機迴環或內部私有網路網段（反代伺服器來源）。
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrLoopbackIp(ip) {
    if (!ip) return false
    const cleanIp = ip.replace(/^::ffff:/, '').trim()
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') return true
    if (/^10\./.test(cleanIp)) return true
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)) return true
    if (/^192\.168\./.test(cleanIp)) return true
    if (/^(fc|fd|fe80)/i.test(cleanIp)) return true
    return false
}

/**
 * 取客戶端識別 key（限速用）。
 * 僅在 TRUST_PROXY=1 且底層 Socket 連線確實來自受信任的反向代理（內部私有網段或 Loopback）時，
 * 才採信反代轉發標頭（防攻擊者繞過反代直連公開埠偽造標頭繞過限速）。
 * 若直連公開埠或未啟用反代，直接採用底層真實 TCP Socket 遠端 IP。
 */
export function clientIp(request) {
    const directIp = request.headers.get('x-socket-remote-address')?.trim() || ''
    if (process.env.TRUST_PROXY === '1') {
        if (!directIp || isPrivateOrLoopbackIp(directIp)) {
            const specificHeader = process.env.TRUST_PROXY_HEADER?.toLowerCase().trim()
            if (specificHeader) {
                const val = request.headers.get(specificHeader)
                if (val) {
                    const parts = val.split(',').map(s => s.trim()).filter(Boolean)
                    if (parts.length > 0) return parts[parts.length - 1]
                }
            }
            // 預設標準反代順序：X-Forwarded-For 最右側由最近之受信任反代追加，防偽造優先度最高
            const xff = request.headers.get('x-forwarded-for')
            if (xff) {
                const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
                if (parts.length > 0) return parts[parts.length - 1]
            }
            const realIp = request.headers.get('x-real-ip')
            if (realIp) return realIp.trim()
            const cfIp = request.headers.get('cf-connecting-ip')
            if (cfIp) return cfIp.trim()
        }
    }
    if (directIp) return directIp
    return 'local'
}

/** 測試用：清空所有限速器狀態。 */
export function resetLimitersForTests() {
    loginLimiter._m.clear()
    lookupLimiter._m.clear()
    registerLimiter._m.clear()
    accountLoginLimiter._m.clear()
    ipLoginLimiter._m.clear()
    memberAddLimiter._m.clear()
}

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
                    const oldestKey = this._m.keys().next().value
                    if (oldestKey !== undefined) this._m.delete(oldestKey)
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

/** lookup 限速器：每帳號 30 次/分鐘（防 uuid 前綴空間掃描）。 */
export const lookupLimiter = new RateLimiter({
    windowMs: 60_000,
    max: 30,
    lockMs: 60_000,
    maxLockMs: 10 * 60_000,
})

/**
 * 取客戶端識別 key（限速用）。
 * 僅在明確設定 TRUST_PROXY=1 或提供 x-real-ip-trusted 時才信任反代標頭，
 * 預設回傳 'local'（搭配 `${ip}|${username}` 按帳號限速，防止攻擊者偽造 X-Forwarded-For 繞過限速）。
 */
export function clientIp(request) {
    const trusted = request.headers.get('x-real-ip-trusted')
    if (trusted) return trusted.trim()
    if (process.env.TRUST_PROXY === '1') {
        const cfIp = request.headers.get('cf-connecting-ip')
        if (cfIp) return cfIp.trim()
        const xff = request.headers.get('x-forwarded-for')
        if (xff) return xff.split(',')[0].trim()
        const realIp = request.headers.get('x-real-ip')
        if (realIp) return realIp.trim()
    }
    return 'local'
}

/** 測試用：清空所有限速器狀態。 */
export function resetLimitersForTests() {
    loginLimiter._m.clear()
    lookupLimiter._m.clear()
}

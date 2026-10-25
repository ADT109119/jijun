/**
 * Easy Accounting Sync Server — 資料庫儲存層（DB Abstraction Layer）
 *
 * 目前實作：SQLite（Node.js 內建 node:sqlite，需 Node.js >= 22.5）
 *
 * 設計目標：所有 self-host 路由只依賴本層提供的「抽象 API」，
 * 不直接接觸 SQL。未來要支援 PostgreSQL / 其他 DB 時，
 * 只要再實作一個符合同一介面的 Store（例如 PostgresStore），
 * 並在 standalone.js 依 DB_ENGINE 環境變數選擇載入即可，
 * 路由層與前端完全不需更動。
 *
 * 介面（所有方法皆 async）：
 *   init()
 *   // users & auth
 *   getUserByUsername(username)            → user | null
 *   createUser(username, pinHash)          → user
 *   createToken(userId)                    → { token, tokenHash }
 *   verifyLogin(username, pin)             → user | null
 *   verifyToken(token)                     → user | null
 *   // devices
 *   registerDevice(deviceId, userId, username) → device
 *   getUserDevices(userId)                 → [device]
 *   // sync logs（每裝置一筆 append-only JSON log，與 Drive 檔案語意一致）
 *   getDeviceLog(deviceId)                 → { content, modifiedAt } | null
 *   putDeviceLog(deviceId, content, modifiedAt)
 *   pruneDeviceLogs(userId, keepMs)        → 移除超過保留期的變更
 *   // backups
 *   putBackup(userId, deviceId, fileName, content, size) → backup
 *   listBackups(userId)                    → [backup]
 *   getBackup(id)                          → backup | null
 *   deleteBackup(id)                       → boolean
 *   pruneBackups(userId, keepCount)        → 數量保留策略
 *   // meta
 *   getMeta(key)                           → value | null
 *   setMeta(key, value)
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { verifyPin, hashPin, DUMMY_SCRYPT_HASH } from './auth.js'

export function changeKey(change) {
    const recordIdentifier =
        change?.data?.uuid ??
        (change?.recordId !== undefined && change?.recordId !== null
            ? change.recordId
            : (change?.data?.id ?? (change?.data?.key ?? (change?.id ?? ''))))
    return `${change?.deviceId || 'unknown'}|${change?.timestamp}|${change?.operation}|${change?.storeName}${recordIdentifier ? `|${recordIdentifier}` : ''}`
}

export class SqliteStore {
    /**
     * @param {string} dbPath - SQLite 檔案路徑（`:memory:` 可用於測試）
     */
    constructor(dbPath = './data/jijun.db') {
        this.dbPath = dbPath
        /** @type {import('node:sqlite').DatabaseSync|null} */
        this.db = null
        this._changeKeyStmt = null
        this._changeInsertStmt = null
    }

    // ──────────────────────────────────────────────
    // Init
    // ──────────────────────────────────────────────

    async init() {
        if (this.dbPath !== ':memory:') {
            mkdirSync(dirname(resolve(this.dbPath)), { recursive: true })
        }
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA busy_timeout = 5000')
        // SQLite 預設 foreign_keys=OFF；schema 內的 ON DELETE CASCADE
        // （user_tokens / devices / device_logs / backups → users）不會生效，
        // deleteUser 也需手動清無 FK 的表（shared_ledger_members / sync_changes）。
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                pin_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_user_tokens_hash
                ON user_tokens (token_hash);
            CREATE INDEX IF NOT EXISTS idx_user_tokens_user
                ON user_tokens (user_id);

            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS device_logs (
                device_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '{"changes":[]}',
                modified_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                operation TEXT NOT NULL,
                store_name TEXT NOT NULL,
                record_id TEXT,
                data TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_changes_device_ts
                ON sync_changes (device_id, timestamp);

            CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                content TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backups_user_created
                ON backups (user_id, created_at);

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS shared_ledgers (
                ledger_uuid TEXT PRIMARY KEY,
                owner_user_id INTEGER NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '{}',
                modified_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shared_ledger_members (
                ledger_uuid TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (ledger_uuid, user_id)
            );
        `)

        // Migration：既有 DB 補 is_admin 欄位（CREATE TABLE IF NOT EXISTS 不會改既有表）
        const userCols = this.db
            .prepare('PRAGMA table_info(users)')
            .all()
        if (!userCols.some(c => c.name === 'is_admin')) {
            this.db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
        }

        // 準備常用 prepared statements（node:sqlite 為同步 API，
        // 包裝成 async 方法以符合抽象介面）
        this._changeKeyStmt = this.db.prepare(
            `SELECT timestamp, operation, store_name FROM sync_changes
             WHERE device_id = ?`
        )
        this._changeInsertStmt = this.db.prepare(
            `INSERT INTO sync_changes (device_id, user_id, timestamp, operation, store_name, record_id, data)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
    }

    close() {
        if (this.db) {
            this.db.close()
            this.db = null
        }
    }

    // ──────────────────────────────────────────────
    // Users & Auth
    // ──────────────────────────────────────────────

    /** @returns {Promise<object|null>} */
    async getUserByUsername(username) {
        const row = this.db
            .prepare('SELECT * FROM users WHERE username = ?')
            .get(username)
        return row || null
    }

    /** @returns {Promise<object>} */
    async createUser(username, pinHash) {
        const now = Date.now()
        try {
            const result = this.db
                .prepare(
                    'INSERT INTO users (username, pin_hash, created_at) VALUES (?, ?, ?)'
                )
                .run(username, pinHash, now)
            return {
                id: Number(result.lastInsertRowid),
                username,
                pin_hash: pinHash,
                created_at: now,
            }
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                const conflictErr = new Error('Username already exists')
                conflictErr.code = 'USER_CONFLICT'
                throw conflictErr
            }
            throw err
        }
    }

    /**
     * 原子註冊使用者與其初始裝置（若裝置衝突則交易整體回滾）。
     * @returns {Promise<{user: object, token: string}>}
     */
    async registerUserWithDevice(username, pinHash, deviceId = null) {
        const now = Date.now()
        const token = 'jijun_' + cryptoRandomToken(32)
        const tokenHash = sha256Hex(token)

        this.db.exec('BEGIN IMMEDIATE')
        try {
            if (deviceId) {
                const existingDev = this.db
                    .prepare('SELECT user_id FROM devices WHERE device_id = ?')
                    .get(deviceId)
                if (existingDev) {
                    const err = new Error('Device belongs to another account')
                    err.code = 'DEVICE_CONFLICT'
                    throw err
                }
            }

            const res = this.db
                .prepare('INSERT INTO users (username, pin_hash, created_at) VALUES (?, ?, ?)')
                .run(username, pinHash, now)
            const userId = Number(res.lastInsertRowid)

            this.db
                .prepare('INSERT INTO user_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)')
                .run(userId, tokenHash, now)

            if (deviceId) {
                this.db
                    .prepare(
                        `INSERT INTO devices (device_id, user_id, username, created_at, last_seen)
                         VALUES (?, ?, ?, ?, ?)`
                    )
                    .run(deviceId, userId, username, now, now)
            }

            this.db.exec('COMMIT')
            return {
                user: { id: userId, username, pin_hash: pinHash, created_at: now },
                token,
            }
        } catch (err) {
            try {
                this.db.exec('ROLLBACK')
            } catch (_) {}
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                const conflictErr = new Error('Username already exists')
                conflictErr.code = 'USER_CONFLICT'
                throw conflictErr
            }
            throw err
        }
    }

    /**
     * 產生新 token。
     * @returns {Promise<{token: string, tokenHash: string}>}
     *   token 只回傳一次（給使用者保存），DB 只存 hash。
     */
    async createToken(userId) {
        const token =
            'jijun_' +
            cryptoRandomToken(32)
        const tokenHash = sha256Hex(token)
        const now = Date.now()
        this.db
            .prepare(
                'INSERT INTO user_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)'
            )
            .run(userId, tokenHash, now)
        // 清理單一使用者過多的舊 token（保留最新 20 筆）
        try {
            this.db
                .prepare(
                    `DELETE FROM user_tokens
                     WHERE user_id = ? AND id NOT IN (
                         SELECT id FROM user_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 20
                     )`
                )
                .run(userId, userId)
        } catch (_) {
            /* 清理非阻斷 */
        }
        return { token, tokenHash }
    }

    // ──────────────────────────────────────────────
    // Admin（帳號管理）
    // ──────────────────────────────────────────────

    /**
     * 建立帳號（管理端用，可指定 is_admin）。
     * @returns {Promise<object>} user
     */
    async createUserAsAdmin(username, pinHash, isAdmin = false) {
        const now = Date.now()
        const result = this.db
            .prepare(
                'INSERT INTO users (username, pin_hash, created_at, is_admin) VALUES (?, ?, ?, ?)'
            )
            .run(username, pinHash, now, isAdmin ? 1 : 0)
        return {
            id: Number(result.lastInsertRowid),
            username,
            pin_hash: pinHash,
            is_admin: isAdmin ? 1 : 0,
            created_at: now,
        }
    }

    /** @returns {Promise<Array>} 使用者列表（不含 pin_hash/token） */
    async listUsers() {
        return this.db
            .prepare(
                `SELECT u.id, u.username, u.created_at, u.is_admin,
                        COUNT(DISTINCT d.device_id) AS device_count
                 FROM users u
                 LEFT JOIN devices d ON d.user_id = u.id
                 GROUP BY u.id
                 ORDER BY u.created_at`
            )
            .all()
    }

    /** 重置 PIN 並撤銷該使用者既有 token。@returns {Promise<boolean>} 成功與否 */
    async resetUserPin(userId, newPinHash) {
        const result = this.db
            .prepare('UPDATE users SET pin_hash = ? WHERE id = ?')
            .run(newPinHash, userId)
        if (Number(result.changes) > 0) {
            this.db
                .prepare('DELETE FROM user_tokens WHERE user_id = ?')
                .run(userId)
            return true
        }
        return false
    }

    /** 註銷單一 Token（登出撤銷） */
    async deleteToken(token) {
        if (!token) return false
        const tokenHash = sha256Hex(token)
        const result = this.db
            .prepare('DELETE FROM user_tokens WHERE token_hash = ?')
            .run(tokenHash)
        return Number(result.changes) > 0
    }

    /**
     * 刪除帳號（連帶 token、devices、device_logs、backups、sync_changes、shared_ledgers 與成員關係）。
     * @returns {Promise<boolean>} 成功與否
     */
    async deleteUser(userId) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            // 先在 devices cascade 刪除前清掉該使用者裝置的 device_logs
            this.db
                .prepare(
                    'DELETE FROM device_logs WHERE user_id = ? OR device_id IN (SELECT device_id FROM devices WHERE user_id = ?)'
                )
                .run(userId, userId)
            const result = this.db
                .prepare('DELETE FROM users WHERE id = ?')
                .run(userId)
            if (Number(result.changes) > 0) {
                // 清除該使用者擁有的共用帳本及其成員關係，以及無 FK cascade 的表
                this.db
                    .prepare(
                        'DELETE FROM shared_ledger_members WHERE ledger_uuid IN (SELECT ledger_uuid FROM shared_ledgers WHERE owner_user_id = ?)'
                    )
                    .run(userId)
                this.db
                    .prepare('DELETE FROM shared_ledgers WHERE owner_user_id = ?')
                    .run(userId)
                this.db
                    .prepare('DELETE FROM shared_ledger_members WHERE user_id = ?')
                    .run(userId)
                this.db
                    .prepare('DELETE FROM sync_changes WHERE user_id = ?')
                    .run(userId)
            }
            this.db.exec('COMMIT')
            return Number(result.changes) > 0
        } catch (err) {
            this.db.exec('ROLLBACK')
            throw err
        }
    }

    /** 取得某 username 的 user 是否為 admin */
    async getUserIsAdmin(userId) {
        const row = this.db
            .prepare('SELECT is_admin FROM users WHERE id = ?')
            .get(userId)
        return !!row && row.is_admin === 1
    }

    // ──────────────────────────────────────────────
    // Shared Ledgers（跨帳號共用帳本）
    // ──────────────────────────────────────────────

    /**
     * 建立共用帳本。
     * @param {string} ledgerUuid  帳本 UUID（= 共用 code）
     * @param {number} ownerId      owner user id
     * @param {string} name         顯示名稱
     * @param {object} content      初始內容 { deviceId, timestamp, changes: [...] }
     * @returns {Promise<object>} shared ledger row
     */
    async createSharedLedger(ledgerUuid, ownerId, name, content) {
        const now = Date.now()
        const username = await this._usernameOf(ownerId)
        this.db.exec('BEGIN IMMEDIATE')
        try {
            this.db
                .prepare(
                    `INSERT INTO shared_ledgers (ledger_uuid, owner_user_id, name, content, modified_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`
                )
                .run(ledgerUuid, ownerId, name, JSON.stringify(content), now, now)
            this.db
                .prepare(
                    `INSERT INTO shared_ledger_members (ledger_uuid, user_id, username, joined_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(ledger_uuid, user_id) DO NOTHING`
                )
                .run(ledgerUuid, ownerId, username, now)
            this.db.exec('COMMIT')
        } catch (err) {
            try {
                this.db.exec('ROLLBACK')
            } catch (_) {}
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                const conflictErr = new Error('Shared ledger already exists')
                conflictErr.code = 'LEDGER_CONFLICT'
                throw conflictErr
            }
            throw err
        }
        return {
            ledger_uuid: ledgerUuid,
            owner_user_id: ownerId,
            name,
            content: JSON.stringify(content),
            modified_at: now,
            created_at: now,
        }
    }

    /** @returns {Promise<object|null>} shared ledger（含 content JSON string） */
    async getSharedLedger(ledgerUuid) {
        return (
            this.db
                .prepare('SELECT * FROM shared_ledgers WHERE ledger_uuid = ?')
                .get(ledgerUuid) || null
        )
    }

    /** 依完整 UUID 或前綴查詢共用帳本列表 */
    async findSharedLedgersByPrefix(code) {
        if (!code) return []
        if (code.length === 36) {
            return this.db
                .prepare('SELECT * FROM shared_ledgers WHERE ledger_uuid = ?')
                .all(code)
        }
        return this.db
            .prepare('SELECT * FROM shared_ledgers WHERE ledger_uuid LIKE ?')
            .all(code + '%')
    }

    /** 更新共用帳本內容（合併既有與新進 changes，以 changeKey 去重防併發覆蓋）。始終保留既有歷史。@returns {Promise<number>} modified_at */
    async updateSharedLedgerContent(ledgerUuid, content) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const now = Date.now()
            const existingRow = this.db
                .prepare('SELECT content FROM shared_ledgers WHERE ledger_uuid = ?')
                .get(ledgerUuid)
            let existingParsed = null
            if (existingRow && existingRow.content) {
                try {
                    existingParsed = JSON.parse(existingRow.content)
                } catch (_) {
                    /* 忽略既有非 JSON 內容 */
                }
            }

            const incomingChanges = Array.isArray(content?.changes) ? content.changes : []
            const existingChanges = Array.isArray(existingParsed?.changes) ? existingParsed.changes : []

            let mergedContent
            if (existingChanges.length > 0) {
                const seen = new Set()
                const merged = []
                for (const c of existingChanges) {
                    const k = changeKey(c)
                    if (!seen.has(k)) {
                        seen.add(k)
                        merged.push(c)
                    }
                }
                for (const c of incomingChanges) {
                    const k = changeKey(c)
                    if (!seen.has(k)) {
                        seen.add(k)
                        merged.push(c)
                    }
                }
                mergedContent = {
                    ...(existingParsed || {}),
                    ...(content || {}),
                    changes: merged,
                }
            } else {
                mergedContent = {
                    ...(existingParsed || {}),
                    ...(content || {}),
                    changes: incomingChanges,
                }
            }

            this.db
                .prepare(
                    'UPDATE shared_ledgers SET content = ?, modified_at = ? WHERE ledger_uuid = ?'
                )
                .run(JSON.stringify(mergedContent), now, ledgerUuid)
            this.db.exec('COMMIT')
            return now
        } catch (err) {
            try {
                this.db.exec('ROLLBACK')
            } catch (_) {}
            throw err
        }
    }

    /** 列出使用者參與的所有共用帳本（不含 content） */
    async listSharedLedgersForUser(userId) {
        return this.db
            .prepare(
                `SELECT s.ledger_uuid, s.name, s.owner_user_id, s.modified_at, s.created_at
                 FROM shared_ledgers s
                 JOIN shared_ledger_members m ON m.ledger_uuid = s.ledger_uuid
                 WHERE m.user_id = ?
                 ORDER BY s.created_at DESC`
            )
            .all(userId)
    }

    /** @returns {Promise<Array>} 成員列表 */
    async listSharedMembers(ledgerUuid) {
        const ledger = await this.getSharedLedger(ledgerUuid)
        const ownerId = ledger ? ledger.owner_user_id : null
        const rows = this.db
            .prepare(
                'SELECT * FROM shared_ledger_members WHERE ledger_uuid = ? ORDER BY joined_at'
            )
            .all(ledgerUuid)
        return rows.map(m => ({
            ...m,
            isOwner: ownerId !== null && m.user_id === ownerId,
        }))
    }

    /** 加入成員（重複加入無效）。@returns {Promise<boolean>} 是否新加入 */
    async addSharedMember(ledgerUuid, userId, username) {
        const result = this.db
            .prepare(
                `INSERT INTO shared_ledger_members (ledger_uuid, user_id, username, joined_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(ledger_uuid, user_id) DO NOTHING`
            )
            .run(ledgerUuid, userId, username, Date.now())
        return Number(result.changes) > 0
    }

    /** 移除成員。@returns {Promise<boolean>} 是否移除成功 */
    async removeSharedMember(ledgerUuid, userId) {
        const result = this.db
            .prepare(
                'DELETE FROM shared_ledger_members WHERE ledger_uuid = ? AND user_id = ?'
            )
            .run(ledgerUuid, userId)
        return Number(result.changes) > 0
    }

    /** @returns {Promise<boolean>} 是否為成員 */
    async isSharedMember(ledgerUuid, userId) {
        const row = this.db
            .prepare(
                'SELECT 1 FROM shared_ledger_members WHERE ledger_uuid = ? AND user_id = ?'
            )
            .get(ledgerUuid, userId)
        return !!row
    }

    /** 取得某 user id 的 username */
    async _usernameOf(userId) {
        const row = this.db.prepare('SELECT username FROM users WHERE id = ?').get(userId)
        return row?.username || `user_${userId}`
    }

    /** 刪除共用帳本（含成員關係）。@returns {Promise<boolean>} */
    async deleteSharedLedger(ledgerUuid) {
        const result = this.db
            .prepare('DELETE FROM shared_ledgers WHERE ledger_uuid = ?')
            .run(ledgerUuid)
        this.db
            .prepare('DELETE FROM shared_ledger_members WHERE ledger_uuid = ?')
            .run(ledgerUuid)
        return Number(result.changes) > 0
    }

    /**
     * 驗證 username + PIN。
     * 新版 hash 為 scrypt（auth.js）；舊版無鹽 sha256 仍可驗證，
     * 驗證成功後自動升級為 scrypt 存檔（漸進式遷移，無需停機遷移）。
     * @returns {Promise<object|null>} user 或 null
     */
    async verifyLogin(username, pin) {
        const user = await this.getUserByUsername(username)
        if (!user) {
            await verifyPin(String(pin ?? ''), DUMMY_SCRYPT_HASH)
            return null
        }
        const { ok, needsUpgrade } = await verifyPin(pin, user.pin_hash)
        if (!ok) return null
        if (needsUpgrade) {
            try {
                this.db
                    .prepare('UPDATE users SET pin_hash = ? WHERE id = ?')
                    .run(await hashPin(pin), user.id)
            } catch (_) {
                /* 升級失敗不影響本次登入 */
            }
        }
        return user
    }

    /**
     * 驗證 bearer token。
     * @returns {Promise<object|null>} user 或 null
     */
    async verifyToken(token) {
        if (!token) return null
        const tokenHash = sha256Hex(token)
        const row = this.db
            .prepare(
                `SELECT u.* FROM user_tokens t
                 JOIN users u ON u.id = t.user_id
                 WHERE t.token_hash = ?`
            )
            .get(tokenHash)
        return row || null
    }

    // ──────────────────────────────────────────────
    // Devices
    // ──────────────────────────────────────────────

    /**
     * 註冊/更新裝置（同一 deviceId 重複呼叫只更新 last_seen）。
     * @returns {Promise<object>} device
     */
    async registerDevice(deviceId, userId, username) {
        const now = Date.now()
        const existing = this.db
            .prepare('SELECT * FROM devices WHERE device_id = ?')
            .get(deviceId)
        if (existing) {
            if (existing.user_id !== userId) {
                const err = new Error('Device belongs to another account')
                err.code = 'DEVICE_CONFLICT'
                throw err
            }
            this.db
                .prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?')
                .run(now, deviceId)
            return { ...existing, last_seen: now }
        }
        this.db
            .prepare(
                `INSERT INTO devices (device_id, user_id, username, created_at, last_seen)
                 VALUES (?, ?, ?, ?, ?)`
            )
            .run(deviceId, userId, username, now, now)
        return {
            device_id: deviceId,
            user_id: userId,
            username,
            created_at: now,
            last_seen: now,
        }
    }

    /** @returns {Promise<Array>} */
    async getUserDevices(userId) {
        return this.db
            .prepare(
                'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at'
            )
            .all(userId)
    }

    /** @returns {Promise<object|null>} */
    async getDevice(deviceId) {
        return (
            this.db
                .prepare('SELECT * FROM devices WHERE device_id = ?')
                .get(deviceId) || null
        )
    }

    // ──────────────────────────────────────────────
    // Sync Logs
    // ──────────────────────────────────────────────

    /**
     * 取回裝置的 sync log（JSON string，與 Drive 端 sync_log_<deviceId>.json 同結構：
     * `{ changes: [...], timestamp, deviceId }`）。
     * @returns {Promise<{content: string, modifiedAt: number}|null>}
     */
    async getDeviceLog(deviceId) {
        const log = this.db
            .prepare(
                'SELECT content, modified_at FROM device_logs WHERE device_id = ?'
            )
            .get(deviceId)
        if (log) {
            return { content: log.content, modifiedAt: log.modified_at }
        }
        return null
    }

    /** 整份覆寫裝置的 sync log。 */
    async putDeviceLog(deviceId, content, modifiedAt) {
        this.db
            .prepare(
                `INSERT INTO device_logs (device_id, user_id, content, modified_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(device_id) DO UPDATE SET
                     content = excluded.content,
                     modified_at = excluded.modified_at`
            )
            .run(deviceId, (await this.getDevice(deviceId))?.user_id || 0, content, modifiedAt)
    }

    /**
     * 將多筆變更批次 append 進裝置的 sync log（去重後單次寫入並包進 SQLite transaction）。
     * 去重鍵與前端 SyncService._changeKey 一致（5-part key）。
     * @param {string} deviceId
     * @param {Array<object>} changes
     * @returns {Promise<{added: number, total: number}>}
     */
    async appendDeviceLogChanges(deviceId, changes) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const log = this.db
                .prepare(
                    'SELECT content, modified_at FROM device_logs WHERE device_id = ?'
                )
                .get(deviceId)
            let parsed = null
            if (log && log.content) {
                try {
                    parsed = JSON.parse(log.content)
                } catch (_) {
                    parsed = null
                }
            }
            if (!parsed || !Array.isArray(parsed.changes)) {
                parsed = { changes: [] }
            }

            const existingKeys = new Set(parsed.changes.map(c => changeKey(c)))
            const newlyAdded = []
            for (const change of changes) {
                const key = changeKey(change)
                if (!existingKeys.has(key)) {
                    existingKeys.add(key)
                    parsed.changes.push(change)
                    newlyAdded.push(change)
                }
            }

            if (newlyAdded.length === 0) {
                this.db.exec('COMMIT')
                return { added: 0, total: parsed.changes.length }
            }

            const now = Date.now()
            parsed.timestamp = now
            parsed.deviceId = deviceId

            const deviceRow = this.db
                .prepare('SELECT user_id FROM devices WHERE device_id = ?')
                .get(deviceId)
            const userId = deviceRow?.user_id || 0
            const serialized = JSON.stringify(parsed)

            this.db
                .prepare(
                    `INSERT INTO device_logs (device_id, user_id, content, modified_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(device_id) DO UPDATE SET
                         content = excluded.content,
                         modified_at = excluded.modified_at`
                )
                .run(deviceId, userId, serialized, now)

            for (const change of newlyAdded) {
                this._changeInsertStmt.run(
                    deviceId,
                    userId,
                    change.timestamp,
                    change.operation,
                    change.storeName,
                    change.recordId == null ? null : String(change.recordId),
                    change.data ? JSON.stringify(change.data) : null
                )
            }
            this.db.exec('COMMIT')
            return { added: newlyAdded.length, total: parsed.changes.length }
        } catch (err) {
            try {
                this.db.exec('ROLLBACK')
            } catch (_) {}
            throw err
        }
    }

    /**
     * 將單筆變更 append 進裝置的 sync log（委派給 appendDeviceLogChanges）。
     * @returns {Promise<{added: number, total: number}>}
     */
    async appendDeviceLogChange(deviceId, change) {
        return this.appendDeviceLogChanges(deviceId, [change])
    }

    /**
     * 清理裝置 sync log 中超過保留期的變更。
     * @returns {Promise<number>} 移除筆數
     */
    async pruneDeviceLog(deviceId, keepMs) {
        const existing = await this.getDeviceLog(deviceId)
        if (!existing) return 0
        let parsed
        try {
            parsed = JSON.parse(existing.content)
        } catch (_) {
            return 0
        }
        if (!Array.isArray(parsed.changes)) return 0

        const cutoff = Date.now() - keepMs
        const before = parsed.changes.length
        parsed.changes = parsed.changes.filter(c => c.timestamp >= cutoff)
        const removed = before - parsed.changes.length
        if (removed > 0) {
            await this.putDeviceLog(deviceId, JSON.stringify(parsed), Date.now())
            const userId = (await this.getDevice(deviceId))?.user_id || 0
            this.db
                .prepare(
                    'DELETE FROM sync_changes WHERE device_id = ? AND timestamp < ?'
                )
                .run(deviceId, cutoff)
            void userId
        }
        return removed
    }

    // ──────────────────────────────────────────────
    // Backups
    // ──────────────────────────────────────────────

    /** @returns {Promise<object>} backup row */
    async putBackup(userId, deviceId, fileName, content, size) {
        const now = Date.now()
        const result = this.db
            .prepare(
                `INSERT INTO backups (user_id, device_id, file_name, content, size, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(userId, deviceId, fileName, content, size || content.length, now)
        return {
            id: Number(result.lastInsertRowid),
            user_id: userId,
            device_id: deviceId,
            file_name: fileName,
            size: size || content.length,
            created_at: now,
        }
    }

    /** @returns {Promise<Array>}（不含 content） */
    async listBackups(userId) {
        return this.db
            .prepare(
                `SELECT id, file_name, size, created_at, device_id
                 FROM backups WHERE user_id = ? ORDER BY created_at DESC`
            )
            .all(userId)
    }

    /** @returns {Promise<object|null>}（含 content） */
    async getBackup(id) {
        return (
            this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id) ||
            null
        )
    }

    /** @returns {Promise<boolean>} */
    async deleteBackup(id) {
        const result = this.db
            .prepare('DELETE FROM backups WHERE id = ?')
            .run(id)
        return Number(result.changes) > 0
    }

    /** 取得某使用者目前所有備份之總檔案大小（bytes） */
    async getUserBackupsTotalSize(userId) {
        const row = this.db
            .prepare('SELECT COALESCE(SUM(size), 0) AS total FROM backups WHERE user_id = ?')
            .get(userId)
        return Number(row?.total || 0)
    }

    /**
     * 數量保留策略：每使用者只保留最近 keepCount 筆備份。
     * @returns {Promise<number>} 刪除筆數
     */
    async pruneBackups(userId, keepCount) {
        // SQLite 語法：OFFSET 必須跟在 LIMIT 後面；LIMIT -1 = 不限制
        const rows = this.db
            .prepare(
                `SELECT id FROM backups WHERE user_id = ?
                 ORDER BY created_at DESC LIMIT -1 OFFSET ?`
            )
            .all(userId, keepCount)
        const del = this.db.prepare('DELETE FROM backups WHERE id = ?')
        let removed = 0
        for (const r of rows) {
            if (Number(del.run(r.id).changes) > 0) removed++
        }
        return removed
    }

    // ──────────────────────────────────────────────
    // Meta
    // ──────────────────────────────────────────────

    /** @returns {Promise<string|null>} */
    async getMeta(key) {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
        return row ? row.value : null
    }

    async setMeta(key, value) {
        this.db
            .prepare(
                `INSERT INTO meta (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
            )
            .run(key, String(value))
    }
}

// ──────────────────────────────────────────────
// Crypto helpers
// ──────────────────────────────────────────────

import { createHash, randomBytes } from 'node:crypto'

function sha256Hex(input) {
    return createHash('sha256').update(String(input)).digest('hex')
}

function cryptoRandomToken(bytes) {
    return randomBytes(bytes).toString('base64url')
}

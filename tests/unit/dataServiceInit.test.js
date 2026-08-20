import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataService from '../../src/js/dataService.js'

/**
 * init 失敗保護回歸測試（v2.1.7.4 儲存安全修復）
 *
 * 背景：舊版 init 在 openDB 失敗時靜默降級 localStorage，
 * 資料仍鎖在 IndexedDB 裡但 app 顯示空畫面 → 用戶以為「更新後資料全消失」。
 * 新版：
 *  - 兩階段版本偵測（_probeDbVersion + max 版本開啟）
 *  - blocked（其他分頁鎖定）→ 明確拋錯
 *  - 非「瀏覽器無 IndexedDB」的失敗 → 拋錯而非降級，附 initDiagnostics
 */
describe('DataService — init 失敗保護（不靜默降級）', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('openDB 拋 VersionError 時 init 應拋錯、不降級、記錄診斷', async () => {
        const versionError = new DOMException(
            'The version requested for the database is smaller than the existing one',
            'VersionError'
        )
        vi.resetModules()
        vi.doMock('idb', () => ({
            openDB: () => Promise.reject(versionError),
        }))
        const { default: DS } = await import('../../src/js/dataService.js')
        const ds = new DS()
        await expect(ds.init()).rejects.toThrow('資料庫初始化失敗')
        expect(ds.useLocalStorage).toBe(false)
        expect(ds.db).toBeNull()
        expect(ds.initDiagnostics.ok).toBe(false)
        expect(ds.initDiagnostics.blocked).toBe(false)
        expect(ds.initDiagnostics.error).toContain('VersionError')
        // 診斷資訊持久化到 sessionStorage 供除錯
        const diag = JSON.parse(sessionStorage.getItem('db_init_diagnostics'))
        expect(diag.blocked).toBe(false)
    })

    it('升級被其他分頁鎖定（blocked）時應拋明確錯誤且不降級', async () => {
        vi.resetModules()
        vi.doMock('idb', () => ({
            openDB: (name, version, callbacks) => {
                // 擬真：null 版本偵測（無升級）永遠會 settle
                if (version === null) {
                    return Promise.resolve({ version: 14, close: () => {} })
                }
                // 升級被其他分頁擋住：open promise 永不 settle，
                // 但 blocked 事件會觸發
                const neverSettles = new Promise(() => {})
                if (callbacks && callbacks.blocked) {
                    Promise.resolve().then(() => callbacks.blocked(14, 15))
                }
                return neverSettles
            },
        }))
        const { default: DS } = await import('../../src/js/dataService.js')
        const ds = new DS()
        await expect(ds.init()).rejects.toThrow('其他分頁')
        expect(ds.useLocalStorage).toBe(false)
        expect(ds.db).toBeNull()
        expect(ds.initDiagnostics.blocked).toBe(true)
    })

    it('全新裝置（databases() 查無 DB）時以程式版本建立 DB', async () => {
        // probe 改用 indexedDB.databases()（jsdom 沒有 indexedDB，需 stub）
        globalThis.indexedDB = {
            databases: async () => [],
        }
        vi.resetModules()
        let openedVersion = null
        vi.doMock('idb', () => ({
            openDB: (name, version) => {
                openedVersion = version
                return Promise.resolve({ version, close: () => {} })
            },
        }))
        const { default: DS } = await import('../../src/js/dataService.js')
        const ds = new DS()
        try {
            await ds.init()
            expect(ds.db).not.toBeNull()
            expect(ds.useLocalStorage).toBe(false)
            expect(ds._existingDbVersion).toBe(0)
            // 以程式版本（15）開啟建立新 DB
            expect(openedVersion).toBe(ds.dbVersion)
        } finally {
            delete globalThis.indexedDB
        }
    })

    it('DB 版本高於程式版本（熱升級殘留 v16）時照 DB 版本開啟、不拋 VersionError', async () => {
        // 這正是 R2 根因鏈：舊版熱升級把 DB 推到 v16、程式 dbVersion 仍 15。
        // 舊版 openDB(name, 15) 對 v16 DB 必拋 VersionError → 靜默降級 → 空 app。
        // 新版應偵測到 v16 並照 v16 開啟（唯讀相容），避免升級失敗循環。
        globalThis.indexedDB = {
            databases: async () => [
                { name: 'EasyAccountingDB', version: 16 },
            ],
        }
        vi.resetModules()
        let openedVersion = null
        vi.doMock('idb', () => ({
            openDB: (name, version) => {
                openedVersion = version
                return Promise.resolve({ version, close: () => {} })
            },
        }))
        const { default: DS } = await import('../../src/js/dataService.js')
        const ds = new DS()
        try {
            await ds.init()
            expect(ds._existingDbVersion).toBe(16)
            // 以 DB 實際版本開啟，而非程式版本
            expect(openedVersion).toBe(16)
            expect(ds.useLocalStorage).toBe(false)
            expect(ds.initDiagnostics).toBeNull()
        } finally {
            delete globalThis.indexedDB
        }
    })

    it('databases() 不可用時回退到程式版本開啟（舊版行為）', async () => {
        // 不 stub indexedDB（jsdom 本就不支援 databases()）
        vi.resetModules()
        let openedVersion = null
        vi.doMock('idb', () => ({
            openDB: (name, version) => {
                openedVersion = version
                return Promise.resolve({ version, close: () => {} })
            },
        }))
        const { default: DS } = await import('../../src/js/dataService.js')
        const ds = new DS()
        await ds.init()
        expect(openedVersion).toBe(ds.dbVersion)
        expect(ds.useLocalStorage).toBe(false)
    })

    it('init 成功時不降級且保留 DB 連線', async () => {
        const ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        // 模擬 init 成功路徑：_probeDbVersion 成功 + openDB 成功
        // （使用 setup.js 的 mock，db.version 不存在 → 視為 0）
        expect(ds.db).not.toBeNull()
        expect(ds.useLocalStorage).toBe(false)
    })
})

describe('DataService — migrateFromLocalStorage 救援 localStorage records', () => {
    let ds

    beforeEach(async () => {
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('將 localStorage records 遷移至 IDB 並留備份、清原 key', async () => {
        const oldRecords = [
            {
                id: 1700000000000,
                type: 'expense',
                amount: 50,
                date: '2024-01-15',
                category: '餐飲',
                ledgerId: 1,
            },
            {
                id: 1700000000001,
                type: 'income',
                amount: 200,
                date: '2024-01-16',
                category: '薪資',
                ledgerId: 1,
            },
        ]
        localStorage.setItem('records', JSON.stringify(oldRecords))

        await ds.migrateFromLocalStorage()

        const records = ds.db._storeData['records']
        expect(records).toHaveLength(2)
        // 保留原 id（put 冪等，避免重複）
        expect(records[0].id).toBe(1700000000000)
        // 原 key 清除、備份保留
        expect(localStorage.getItem('records')).toBeNull()
        expect(localStorage.getItem('records_backup')).not.toBeNull()
    })

    it('重複執行不會產生重複紀錄（冪等）', async () => {
        const oldRecords = [
            {
                id: 1700000000000,
                type: 'expense',
                amount: 50,
                date: '2024-01-15',
                category: '餐飲',
                ledgerId: 1,
            },
        ]
        localStorage.setItem('records', JSON.stringify(oldRecords))

        await ds.migrateFromLocalStorage()
        // 模擬「備份未清但 IDB 已有」的邊界：再寫回再遷移
        localStorage.setItem('records', JSON.stringify(oldRecords))
        await ds.migrateFromLocalStorage()

        const records = ds.db._storeData['records']
        expect(records).toHaveLength(1)
    })
})

// 模擬 FileReader 讀取 JSON 內容（與 dataService.test.js 同模式）
function stubFileReader(content) {
    const OriginalFileReader = globalThis.FileReader
    globalThis.FileReader = class {
        readAsText() {
            this.result = content
            if (this.onload) this.onload({ target: this })
        }
    }
    return () => {
        globalThis.FileReader = OriginalFileReader
    }
}

function makeBackupJson() {
    return JSON.stringify({
        version: '2.3.0',
        settings: {
            advancedAccountModeEnabled: false,
            debtManagementEnabled: false,
        },
        activeLedgerId: 1,
        ledgers: [{ id: 1, name: '原帳本', uuid: 'ledger-uuid-1' }],
        records: [
            {
                id: 10,
                type: 'expense',
                amount: 100,
                date: '2024-01-01',
                category: '餐飲',
                ledgerId: 1,
                uuid: 'rec-uuid-1',
            },
        ],
        contacts: [],
        debts: [],
        recurring_transactions: [],
        amortizations: [],
        credit_statements: [],
        groupMeta: [],
    })
}

describe('DataService — importData 緊急快照', () => {
    let ds

    beforeEach(async () => {
        localStorage.clear()
        ds = new DataService()
        ds.db = await globalThis.idb.openDB()
        ds.activeLedgerId = 1
    })

    it('匯入成功時：緊急快照被寫入、成功後清除', async () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
        const restore = stubFileReader(makeBackupJson())
        try {
            const result = await ds.importData({ name: 'backup.json' })
            expect(result.success).toBe(true)
            // 匯入過程有寫入緊急快照
            expect(setItemSpy).toHaveBeenCalledWith(
                'import_emergency_snapshot',
                expect.any(String)
            )
            // 成功後清除
            expect(localStorage.getItem('import_emergency_snapshot')).toBeNull()
        } finally {
            restore()
            setItemSpy.mockRestore()
        }
    })

    it('匯入失敗時：緊急快照保留供手動救援', async () => {
        const restore = stubFileReader(makeBackupJson())
        // 模擬「清除舊資料」階段失敗（快照已寫入、還原走記憶體快照）
        const spy = vi
            .spyOn(ds, 'clearAllRecords')
            .mockRejectedValue(new Error('模擬清除失敗'))
        try {
            await expect(
                ds.importData({ name: 'backup.json' })
            ).rejects.toThrow()
            // 關鍵：跨 session 緊急快照仍在（瀏覽器崩潰時可救）
            const snapshot = localStorage.getItem('import_emergency_snapshot')
            expect(snapshot).not.toBeNull()
            expect(JSON.parse(snapshot).records).toBeDefined()
        } finally {
            restore()
            spy.mockRestore()
        }
    })
})

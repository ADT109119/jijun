import { openDB as idbOpenDB } from 'idb'
import {
    customConfirm,
    formatDateToString,
    clampDayToMonth,
    calculateEffectiveRecordAmount,
    buildDebtLookupMaps,
    findDebtForRecord,
    isDebtSettlementRecord,
} from './utils.js'

const openDB =
    idbOpenDB ||
    (() => {
        console.warn('IndexedDB 不可用，將使用 localStorage')
        return null
    })

class DataService {
    constructor() {
        this.dbName = 'EasyAccountingDB'
        this.dbVersion = 15 // Schema v15: Record Groups (groupMeta store)
        this.db = null
        this.useLocalStorage = false
        this.hookProvider = null // Function to trigger hooks
        this._syncDeviceId = localStorage.getItem('sync_device_id') || 'unknown'

        /** @type {number} 當前啟用的帳本 ID（預設 1 = 預設帳本） */
        this.activeLedgerId = parseInt(
            localStorage.getItem('activeLedgerId') || '1',
            10
        )
    }

    setHookProvider(fn) {
        this.hookProvider = fn
    }

    async triggerHook(hookName, payload) {
        if (this.hookProvider) {
            return await this.hookProvider(hookName, payload)
        }
        return payload
    }

    async init() {
        this.initDiagnostics = null
        this._existingDbVersion = null
        try {
            if (openDB && typeof openDB === 'function') {
                // ── 階段一：無版本偵測（讀 DB 實際版本，不觸發 upgrade）──
                // 修正直接 openDB(name, this.dbVersion) 的三個歷史風險：
                // (1) DB 已被升到更高版本時（例如舊版熱升級把 DB 推到 v16），
                //     直接開 v15 必得 VersionError
                // (2) upgrade 回呼拋例外會中止整筆升級，DB 永久卡舊版，
                //     之後每次啟動都 VersionError → 靜默 fallback → 空 app
                // (3) 其他分頁開啟中時升級被擋（blocked），open promise
                //     會永遠 pending
                const probe = await this._probeDbVersion()
                // probe 回傳 { version }：
                // - DB 存在 → 實際版本
                // - DB 不存在（全新裝置）→ 0，之後以程式版本建立
                // - databases() 不可用 → 程式版本（等同舊版行為）
                const currentVersion = probe.version
                this._existingDbVersion = currentVersion

                // ── 階段二：以 max(程式版本, DB 實際版本) 開啟 ──
                // 若 DB 已比程式新（舊版 JS 曾升級過），照 DB 版本開啟避免
                // VersionError，等下次版本更新時再補升級。
                const targetVersion = Math.max(
                    currentVersion,
                    this.dbVersion,
                    1
                )
                let blockedReject
                const blockedPromise = new Promise((_, reject) => {
                    blockedReject = reject
                })
                const openPromise = openDB(this.dbName, targetVersion, {
                    upgrade: (db, oldVersion, newVersion, transaction) =>
                        this._runUpgrade(
                            db,
                            oldVersion,
                            newVersion,
                            transaction
                        ),
                    // idb 的 blocked 事件：升級被其他分頁擋住時 open promise
                    // 永遠不會 settle，必須用 race 主動 reject，
                    // 否則 init 永久卡死在骨架畫面。
                    blocked: (oldV, newV) =>
                        blockedReject(
                            new Error('db_blocked:' + oldV + '->' + newV)
                        ),
                })
                try {
                    this.db = await Promise.race([openPromise, blockedPromise])
                } catch (e) {
                    this.db = null
                    throw e
                }

                // If it's the first time using the app, try to migrate from localStorage
                await this.migrateFromLocalStorage()
            } else {
                // 瀏覽器根本沒有 IndexedDB（極端環境）：才允許降級
                throw new Error('indexeddb_not_supported')
            }
        } catch (error) {
            const blockedCase =
                error && String(error.message || '').indexOf('db_blocked') === 0
            const notSupported =
                error && error.message === 'indexeddb_not_supported'
            console.error('Database initialization failed:', error)
            // 記錄診斷資訊供 UI 警示與除錯（DevTools 可讀）
            this.initDiagnostics = {
                ok: false,
                error: error
                    ? (error.name || 'Error') +
                      ': ' +
                      (error.message || 'unknown')
                    : 'unknown',
                existingDbVersion: this._existingDbVersion,
                blocked: !!blockedCase,
                timestamp: Date.now(),
            }
            try {
                sessionStorage.setItem(
                    'db_init_diagnostics',
                    JSON.stringify(this.initDiagnostics)
                )
            } catch (e) {
                // sessionStorage 不可用時忽略
            }
            if (blockedCase) {
                // 升級被其他分頁擋住：資料還在 DB 裡，不降級（降級會顯示
                // 空 app 誤導用戶以為資料消失）。明確報錯讓 UI 提示
                // 用戶關閉其他分頁。
                this.db = null
                this.useLocalStorage = false
                throw new Error(
                    '資料庫升級被其他分頁鎖定，請關閉所有分頁後重新載入',
                    { cause: error }
                )
            }
            if (notSupported) {
                // 真的沒有 IndexedDB（老瀏覽器/特殊環境）：才允許降級
                this.useLocalStorage = true
                console.log('IndexedDB 不存在，使用 localStorage 降級')
                return
            }
            // 其他失敗（VersionError、SecurityError、upgrade 拋例外…）：
            // 不靜默降級——降級等於把用戶資料鎖在 IDB 裡卻顯示空 app，
            // 是最糟的「資料看似消失」路徑。明確拋錯讓 UI 顯示警示。
            this.db = null
            this.useLocalStorage = false
            throw new Error(
                '資料庫初始化失敗（' +
                    this.initDiagnostics.error +
                    '），資料可能仍存在資料庫中，請重新載入或從備份還原',
                { cause: error }
            )
        }
    }

    /**
     * 偵測已存在 DB 的實際版本。
     * 使用 IDBFactory.databases()（唯讀查詢，不開啟 DB、不觸發 upgrade）。
     * 支援：Chrome 71+ / Edge / Brave / Firefox 98+ / Safari 14.1+。
     *
     * 注意：不能用 openDB(name, null) 偵測——WebIDL 會把 null 轉成 0，
     * Chromium 直接拋 "The version provided must not be 0"（已實測，
     * 即使 DB 存在也一樣），因此舊版 null 偵測在 Chrome/Brave 上永遠失敗。
     */
    async _probeDbVersion() {
        try {
            if (
                typeof indexedDB !== 'undefined' &&
                typeof indexedDB.databases === 'function'
            ) {
                const dbs = await indexedDB.databases()
                const match = (dbs || []).find(d => d.name === this.dbName)
                // DB 不存在 → 版本 0（全新安裝，之後以程式版本建立）
                return { version: match ? match.version || 0 : 0 }
            }
        } catch (e) {
            // databases() 極罕見失敗：退回假設程式版本（等同舊版行為）
            console.warn(
                '[DataService] databases() 偵測失敗，改用程式版本開啟:',
                e
            )
        }
        return { version: this.dbVersion }
    }

    /**
     * 執行 Schema 升級（從 init 抽出的 upgrade 回呼）。
     * 關鍵保護：升級回呼內的未捕捉例外會中止整筆 upgrade transaction，
     * DB 停留在舊版本，之後每次啟動都 VersionError（資料「消失」主因之一）。
     * 整體包 try/catch：失敗時記錄診斷，DB 仍會提升到目標版本，
     * 避免「升級卡死 → 每次啟動失敗」的鎖死循環。
     */
    async _runUpgrade(db, oldVersion, newVersion, transaction) {
        try {
            // Schema version 1
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains('records')) {
                    const recordStore = db.createObjectStore('records', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    recordStore.createIndex('date', 'date')
                    recordStore.createIndex('type', 'type')
                    recordStore.createIndex('category', 'category')
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', {
                        keyPath: 'key',
                    })
                }
            }
            // Schema version 2
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains('accounts')) {
                    const accountStore = db.createObjectStore('accounts', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    accountStore.createIndex('name', 'name', {
                        unique: true,
                    })
                }
                const recordStore = transaction.objectStore('records')
                if (!recordStore.indexNames.contains('accountId')) {
                    recordStore.createIndex('accountId', 'accountId')
                }
            }
            // Schema version 3
            if (oldVersion < 3) {
                if (!db.objectStoreNames.contains('recurring_transactions')) {
                    const recurringStore = db.createObjectStore(
                        'recurring_transactions',
                        {
                            keyPath: 'id',
                            autoIncrement: true,
                        }
                    )
                    recurringStore.createIndex('nextDueDate', 'nextDueDate')
                }
            }
            // Schema version 4: Debt management system
            if (oldVersion < 4) {
                // Files store for storing blobs (avatars, etc.)
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                }
                // Contacts store for debt management
                if (!db.objectStoreNames.contains('contacts')) {
                    const contactStore = db.createObjectStore('contacts', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    contactStore.createIndex('name', 'name')
                }
                // Debts store for tracking receivables and payables
                if (!db.objectStoreNames.contains('debts')) {
                    const debtStore = db.createObjectStore('debts', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    debtStore.createIndex('contactId', 'contactId')
                    debtStore.createIndex('type', 'type')
                    debtStore.createIndex('settled', 'settled')
                }
            }
            // Schema version 5: Plugin System
            if (oldVersion < 5) {
                if (!db.objectStoreNames.contains('plugins')) {
                    db.createObjectStore('plugins', {
                        keyPath: 'id',
                    })
                    // id: plugin identifier (e.g. 'com.example.myplugin')
                    // name, version, script (blob/string), enabled (bool)
                }
            }
            // Schema version 6: Sync log for multi-device sync
            if (oldVersion < 6) {
                if (!db.objectStoreNames.contains('sync_log')) {
                    const syncStore = db.createObjectStore('sync_log', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    syncStore.createIndex('timestamp', 'timestamp')
                }
            }
            // Schema version 7: UUIDs for sync deduplication
            if (oldVersion < 7) {
                const stores = [
                    'records',
                    'accounts',
                    'contacts',
                    'debts',
                    'recurring_transactions',
                ]
                for (const storeName of stores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName)
                        if (!store.indexNames.contains('uuid')) {
                            store.createIndex('uuid', 'uuid', {
                                unique: true,
                            })
                        }
                        // Iterate and assign UUIDs to existing records
                        let cursor = await store.openCursor()
                        while (cursor) {
                            const updateData = cursor.value
                            if (!updateData.uuid) {
                                // Simple UUID v4 generator
                                updateData.uuid =
                                    self.crypto && self.crypto.randomUUID
                                        ? self.crypto.randomUUID()
                                        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                                              /[xy]/g,
                                              function (c) {
                                                  const r =
                                                          (Math.random() * 16) |
                                                          0,
                                                      v =
                                                          c === 'x'
                                                              ? r
                                                              : (r & 0x3) | 0x8
                                                  return v.toString(16)
                                              }
                                          )
                                await cursor.update(updateData)
                            }
                            cursor = await cursor.continue()
                        }
                    }
                }
            }
            // Schema version 8: Multi-ledger support
            if (oldVersion < 8) {
                // 1. 建立 ledgers object store
                if (!db.objectStoreNames.contains('ledgers')) {
                    const ledgerStore = db.createObjectStore('ledgers', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    ledgerStore.createIndex('uuid', 'uuid', {
                        unique: true,
                    })
                }

                // 2. 為所有資料 store 新增 ledgerId index
                const dataStores = [
                    'records',
                    'accounts',
                    'contacts',
                    'debts',
                    'recurring_transactions',
                ]
                for (const storeName of dataStores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName)
                        if (!store.indexNames.contains('ledgerId')) {
                            store.createIndex('ledgerId', 'ledgerId')
                        }
                    }
                }

                // 3. 插入預設帳本
                const ledgerStore = transaction.objectStore('ledgers')
                const defaultUuid =
                    self.crypto && self.crypto.randomUUID
                        ? self.crypto.randomUUID()
                        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                              /[xy]/g,
                              function (c) {
                                  const r = (Math.random() * 16) | 0,
                                      v = c === 'x' ? r : (r & 0x3) | 0x8
                                  return v.toString(16)
                              }
                          )
                await ledgerStore.add({
                    id: 1,
                    uuid: defaultUuid,
                    name: '預設帳本',
                    icon: 'fa-solid fa-book',
                    color: '#334A52',
                    type: 'personal',
                    createdAt: Date.now(),
                })

                // 4. 為所有現有資料打上 ledgerId = 1
                for (const storeName of dataStores) {
                    if (db.objectStoreNames.contains(storeName)) {
                        const store = transaction.objectStore(storeName)
                        let cursor = await store.openCursor()
                        while (cursor) {
                            const data = cursor.value
                            if (
                                data.ledgerId === undefined ||
                                data.ledgerId === null
                            ) {
                                data.ledgerId = 1
                                await cursor.update(data)
                            }
                            cursor = await cursor.continue()
                        }
                    }
                }
            }
            // Schema version 9: Remove unique constraint on account name
            if (oldVersion < 9) {
                if (db.objectStoreNames.contains('accounts')) {
                    const accountStore = transaction.objectStore('accounts')
                    if (accountStore.indexNames.contains('name')) {
                        accountStore.deleteIndex('name')
                    }
                    accountStore.createIndex('name', 'name', {
                        unique: false,
                    })
                }
            }
            // Schema version 10: Themes Store
            if (oldVersion < 10) {
                if (!db.objectStoreNames.contains('themes')) {
                    db.createObjectStore('themes', {
                        keyPath: 'id',
                    })
                }
            }
            // Schema version 11: Amortizations (攤提/折舊/分期)
            if (oldVersion < 11) {
                if (!db.objectStoreNames.contains('amortizations')) {
                    const aStore = db.createObjectStore('amortizations', {
                        keyPath: 'id',
                        autoIncrement: true,
                    })
                    aStore.createIndex('uuid', 'uuid', {
                        unique: true,
                    })
                    aStore.createIndex('ledgerId', 'ledgerId')
                    aStore.createIndex('status', 'status')
                }
            }
            // Schema version 12: Add amortizationId index to records
            if (oldVersion < 12) {
                if (db.objectStoreNames.contains('records')) {
                    const recordStore = transaction.objectStore('records')
                    if (!recordStore.indexNames.contains('amortizationId')) {
                        recordStore.createIndex(
                            'amortizationId',
                            'amortizationId',
                            { unique: false }
                        )
                    }
                }
            }
            // Schema version 13: Credit card support
            if (oldVersion < 13) {
                if (db.objectStoreNames.contains('accounts')) {
                    const store = transaction.objectStore('accounts')
                    // 為舊資料補上 type = 'wallet'
                    let cursor = await store.openCursor()
                    while (cursor) {
                        const data = cursor.value
                        if (!data.type) {
                            data.type = 'wallet'
                            data.creditLimit = 0
                            data.statementDay = 25
                            data.dueDay = 15
                            await cursor.update(data)
                        }
                        cursor = await cursor.continue()
                    }
                    // 新增 type index
                    if (!store.indexNames.contains('type')) {
                        store.createIndex('type', 'type', {
                            unique: false,
                        })
                    }
                }
                // 新增信用卡帳單 store
                if (!db.objectStoreNames.contains('credit_statements')) {
                    const stmtStore = db.createObjectStore(
                        'credit_statements',
                        {
                            keyPath: 'id',
                            autoIncrement: true,
                        }
                    )
                    stmtStore.createIndex('uuid', 'uuid', {
                        unique: true,
                    })
                    stmtStore.createIndex('accountId', 'accountId')
                    stmtStore.createIndex('ledgerId', 'ledgerId')
                    stmtStore.createIndex('period', 'period')
                    stmtStore.createIndex('status', 'status')
                }
            }
            // Schema version 14: Migrate legacy debt payments to records for correct balances
            if (oldVersion < 14) {
                const debtsStore = transaction.objectStore('debts')
                const recordsStore = transaction.objectStore('records')
                const contactsStore = transaction.objectStore('contacts')
                const accountsStore = transaction.objectStore('accounts')

                // 獲取預設帳戶，做為 fallback 帳戶 ID
                let defaultAccountId = null
                const accCursor = await accountsStore.openCursor()
                if (accCursor) {
                    defaultAccountId = accCursor.value.id
                }

                let cursor = await debtsStore.openCursor()
                while (cursor) {
                    const debt = cursor.value
                    if (debt.payments && debt.payments.length > 0) {
                        let updated = false

                        // 獲取聯絡人名稱
                        let contactName = '未知聯絡人'
                        if (debt.contactId) {
                            const contact = await contactsStore.get(
                                debt.contactId
                            )
                            if (contact) {
                                contactName = contact.name || '未知聯絡人'
                            }
                        }

                        // 獲取原始記帳紀錄的帳戶 ID
                        let originalAccountId = null
                        if (debt.recordId) {
                            const originalRecord = await recordsStore.get(
                                debt.recordId
                            )
                            if (originalRecord) {
                                originalAccountId = originalRecord.accountId
                            }
                        }

                        const updatedPayments = []
                        for (const payment of debt.payments) {
                            if (!payment.recordId && !payment.recordUuid) {
                                const paymentDate =
                                    payment.date ||
                                    formatDateToString(new Date())
                                const recordAccountId =
                                    originalAccountId || defaultAccountId

                                // 建立記帳紀錄
                                const record = {
                                    type:
                                        debt.type === 'receivable'
                                            ? 'income'
                                            : 'expense',
                                    category:
                                        debt.type === 'receivable'
                                            ? 'debt_collection'
                                            : 'debt_repayment',
                                    amount: payment.amount,
                                    date: paymentDate,
                                    description:
                                        debt.type === 'receivable'
                                            ? `收回欠款：${contactName} - ${debt.description || ''}`
                                            : `還款：${contactName} - ${debt.description || ''}`,
                                    ledgerId: debt.ledgerId || 1,
                                    debtId: debt.id,
                                    ...(recordAccountId
                                        ? { accountId: recordAccountId }
                                        : {}),
                                }

                                // 生成 uuid (因為從 version 7 起需要 uuid)
                                record.uuid =
                                    self.crypto && self.crypto.randomUUID
                                        ? self.crypto.randomUUID()
                                        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                                              /[xy]/g,
                                              function (c) {
                                                  const r =
                                                          (Math.random() * 16) |
                                                          0,
                                                      v =
                                                          c === 'x'
                                                              ? r
                                                              : (r & 0x3) | 0x8
                                                  return v.toString(16)
                                              }
                                          )

                                // 寫入 records
                                const newRecordId =
                                    await recordsStore.add(record)
                                payment.recordId = newRecordId
                                payment.recordUuid = record.uuid
                                updated = true
                            }
                            updatedPayments.push(payment)
                        }

                        if (updated) {
                            debt.payments = updatedPayments
                            await cursor.update(debt)
                        }
                    }
                    cursor = await cursor.continue()
                }
            }
            // Schema version 15: Record Groups (groupMeta store)
            if (oldVersion < 15) {
                if (!db.objectStoreNames.contains('groupMeta')) {
                    const groupStore = db.createObjectStore('groupMeta', {
                        keyPath: 'id',
                    })
                    groupStore.createIndex('uuid', 'uuid', {
                        unique: true,
                    })
                    groupStore.createIndex('ledgerId', 'ledgerId', {
                        unique: false,
                    })
                }
            }
        } catch (e) {
            console.error(
                '[DataService] Schema upgrade failed (oldVersion=' +
                    oldVersion +
                    ' newVersion=' +
                    newVersion +
                    '), DB 仍會停留在目標版本，部分遷移可能未完成:',
                e
            )
            try {
                sessionStorage.setItem(
                    'db_upgrade_failures',
                    JSON.stringify({
                        from: oldVersion,
                        to: newVersion,
                        error: String(e),
                        timestamp: Date.now(),
                    })
                )
            } catch (e2) {
                // sessionStorage 不可用時忽略
            }
        }
    }

    // 從舊的 localStorage 遷移資料
    async migrateFromLocalStorage() {
        // 1) 遷移舊版 localStorage 'records'（fallback 模式殘留的記帳紀錄）
        //    舊版在 IDB 開啟失敗時會把新增紀錄寫進 localStorage 'records'；
        //    若 IDB 之後恢復正常（重開 app / 升級修復），這些紀錄會永久
        //    孤立在 localStorage 裡（app 顯示空 app）。在這裡一併遷回 IDB。
        const lsRecordsRaw = localStorage.getItem('records')
        if (lsRecordsRaw && this.db) {
            try {
                const lsRecords = JSON.parse(lsRecordsRaw)
                if (Array.isArray(lsRecords) && lsRecords.length > 0) {
                    const tx = this.db.transaction('records', 'readwrite')
                    const store = tx.objectStore('records')
                    let migrated = 0
                    for (const record of lsRecords) {
                        // 保留原 id（Date.now() 格式）避免重複遷移；
                        // put 是冪等的，重複執行不會產生重複紀錄
                        await store.put(record)
                        migrated++
                    }
                    await tx.done
                    console.log(
                        `從 localStorage 'records' 遷移 ${migrated} 筆紀錄至 IndexedDB`
                    )
                    // 備份後清除（與 AllTheData 同策略）
                    try {
                        localStorage.setItem('records_backup', lsRecordsRaw)
                    } catch (e) {
                        console.warn('localStorage 空間不足，無法留備份:', e)
                    }
                    localStorage.removeItem('records')
                }
            } catch (error) {
                console.error('localStorage records 遷移失敗:', error)
            }
        }

        // 2) 遷移更舊版的 AllTheData 格式
        const oldData = localStorage.getItem('AllTheData')
        if (oldData && this.db) {
            try {
                const parsedData = JSON.parse(oldData)
                const records = this.convertOldDataFormat(parsedData)

                const tx = this.db.transaction('records', 'readwrite')
                const store = tx.objectStore('records')

                for (const record of records) {
                    await store.add(record)
                }

                await tx.done
                console.log('資料遷移完成')

                // 備份舊資料後清除
                localStorage.setItem('AllTheData_backup', oldData)
                localStorage.removeItem('AllTheData')
            } catch (error) {
                console.error('資料遷移失敗:', error)
            }
        }
    }

    // 生成 UUID
    generateUUID() {
        if (self.crypto && self.crypto.randomUUID) {
            return self.crypto.randomUUID()
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
            /[xy]/g,
            function (c) {
                const r = (Math.random() * 16) | 0,
                    v = c === 'x' ? r : (r & 0x3) | 0x8
                return v.toString(16)
            }
        )
    }

    // 透過 UUID 尋找指定 Store 的單一紀錄
    async getByUUID(storeName, uuid) {
        if (this.useLocalStorage || !this.db) return null
        try {
            const tx = this.db.transaction(storeName, 'readonly')
            const store = tx.objectStore(storeName)
            if (store.indexNames.contains('uuid')) {
                const index = store.index('uuid')
                // IndexedDB 的 index 不直接回傳資料，但 get() 在 idb 封裝裡可以
                return await index.get(uuid)
            } else {
                // Fallback for stores without uuid index
                let cursor = await store.openCursor()
                while (cursor) {
                    if (cursor.value.uuid === uuid) return cursor.value
                    cursor = await cursor.continue()
                }
                return null
            }
        } catch (e) {
            console.warn(
                `[DataService] getByUUID failed for ${storeName} with uuid ${uuid}:`,
                e
            )
            return null
        }
    }

    // 轉換舊資料格式
    convertOldDataFormat(oldData) {
        const records = []

        for (const year in oldData) {
            for (const month in oldData[year]) {
                for (const day in oldData[year][month]) {
                    const dayData = oldData[year][month][day]

                    // 處理支出資料
                    if (dayData.OutType) {
                        for (const category in dayData.OutType) {
                            const categoryData = dayData.OutType[category]
                            if (
                                categoryData.money &&
                                categoryData.money.length > 1
                            ) {
                                for (
                                    let i = 1;
                                    i < categoryData.money.length;
                                    i++
                                ) {
                                    records.push({
                                        date: `${year}-${month}-${day}`,
                                        type: 'expense',
                                        category: category,
                                        amount: parseFloat(
                                            categoryData.money[i]
                                        ),
                                        description:
                                            categoryData.description[i] || '',
                                        timestamp: new Date(
                                            `${year}-${month}-${day}`
                                        ).getTime(),
                                    })
                                }
                            }
                        }
                    }

                    // 處理收入資料
                    if (dayData.InType) {
                        for (const category in dayData.InType) {
                            const categoryData = dayData.InType[category]
                            if (
                                categoryData.money &&
                                categoryData.money.length > 1
                            ) {
                                for (
                                    let i = 1;
                                    i < categoryData.money.length;
                                    i++
                                ) {
                                    records.push({
                                        date: `${year}-${month}-${day}`,
                                        type: 'income',
                                        category: category,
                                        amount: parseFloat(
                                            categoryData.money[i]
                                        ),
                                        description:
                                            categoryData.description[i] || '',
                                        timestamp: new Date(
                                            `${year}-${month}-${day}`
                                        ).getTime(),
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }

        return records
    }

    // 新增記錄
    async addRecord(record, skipLog = false) {
        // 補充 accountUuid / debtUuid 以便跨裝置同步時正確解析外鍵
        let resolvedAccountUuid = record.accountUuid || null
        if (record.accountId && !resolvedAccountUuid) {
            try {
                const account = await this.db.get('accounts', record.accountId)
                if (account?.uuid) resolvedAccountUuid = account.uuid
            } catch (_) {
                /* 查不到帳號不影響儲存 */
            }
        }

        let resolvedDebtUuid = record.debtUuid || null
        if (record.debtId && !resolvedDebtUuid) {
            try {
                const debt = await this.db.get('debts', record.debtId)
                if (debt?.uuid) resolvedDebtUuid = debt.uuid
            } catch (_) {
                /* 查不到欠款不影響儲存 */
            }
        }

        const recordWithTimestamp = {
            ...record,
            ledgerId: record.ledgerId ?? this.activeLedgerId,
            timestamp: Date.now(),
            uuid: record.uuid || this.generateUUID(),
            ...(resolvedAccountUuid
                ? { accountUuid: resolvedAccountUuid }
                : {}),
            ...(resolvedDebtUuid ? { debtUuid: resolvedDebtUuid } : {}),
        }

        if (this.useLocalStorage) {
            return this.addRecordToLocalStorage(recordWithTimestamp)
        }

        // 同步接收路徑：移除來源裝置的 integer id，讓 IndexedDB 自動產生新 id
        // 若保留來源 id，接收端可能因 key 衝突而靜默失敗
        if (skipLog) delete recordWithTimestamp.id

        try {
            // Hook: Before Save
            let recordToSave = recordWithTimestamp
            if (!skipLog) {
                recordToSave = await this.triggerHook(
                    'onRecordSaveBefore',
                    recordToSave
                )
                if (!recordToSave) return null // Cancelled
            }

            const tx = this.db.transaction('records', 'readwrite')
            const store = tx.objectStore('records')
            const result = await store.add(recordToSave)
            await tx.done

            // Hook: After Save
            if (!skipLog) {
                await this.triggerHook('onRecordSaveAfter', {
                    ...recordToSave,
                    id: result,
                })
            }

            // Change tracking for sync
            if (!skipLog) {
                await this.logChange('add', 'records', result, {
                    ...recordToSave,
                    id: result,
                })
            }

            return result
        } catch (error) {
            console.error('新增記錄失敗:', error)
            throw error
        }
    }

    // 獲取記錄
    async getRecords(filters = {}) {
        if (this.useLocalStorage) {
            return this.getRecordsFromLocalStorage(filters)
        }

        try {
            const tx = this.db.transaction('records', 'readonly')
            const store = tx.objectStore('records')
            let records = []

            // Performance optimization: use index for amortizationId or date if available
            if (
                filters.amortizationId &&
                store.indexNames.contains('amortizationId')
            ) {
                const index = store.index('amortizationId')
                records = await index.getAll(filters.amortizationId)
            } else if (
                (filters.startDate || filters.endDate) &&
                store.indexNames.contains('date')
            ) {
                const index = store.index('date')
                let range
                if (filters.startDate && filters.endDate) {
                    range = IDBKeyRange.bound(
                        filters.startDate,
                        filters.endDate
                    )
                } else if (filters.startDate) {
                    range = IDBKeyRange.lowerBound(filters.startDate)
                } else {
                    range = IDBKeyRange.upperBound(filters.endDate)
                }
                records = await index.getAll(range)
            } else {
                records = await store.getAll()
            }

            // 帳本篩選（allLedgers = true 時跳過，用於匯出/備份）
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                records = records.filter(r => r.ledgerId === targetLedgerId)
            }

            // 應用篩選器
            if (filters.startDate || filters.endDate) {
                records = records.filter(record => {
                    const recordDate = record.date // 使用字符串比較，格式為 YYYY-MM-DD
                    if (filters.startDate && recordDate < filters.startDate)
                        return false
                    if (filters.endDate && recordDate > filters.endDate)
                        return false
                    return true
                })
            }

            if (filters.type) {
                records = records.filter(record => record.type === filters.type)
            }

            if (filters.category) {
                records = records.filter(
                    record => record.category === filters.category
                )
            }

            if (filters.accountId) {
                records = records.filter(
                    record => record.accountId === filters.accountId
                )
            }

            if (filters.amortizationId) {
                records = records.filter(
                    record => record.amortizationId === filters.amortizationId
                )
            }

            // Multi-level sort: date desc → timestamp desc → id desc
            return records.sort((a, b) => {
                // Primary: date descending
                if (a.date !== b.date)
                    return (b.date || '').localeCompare(a.date || '')
                // Secondary: timestamp descending (missing timestamps sort to bottom)
                const tsDiff = (b.timestamp || 0) - (a.timestamp || 0)
                if (tsDiff !== 0) return tsDiff
                // Tertiary: id descending (newer IDs are larger)
                return (b.id || 0) - (a.id || 0)
            })
        } catch (error) {
            console.error('獲取記錄失敗:', error)
            return []
        }
    }

    async getRecord(id) {
        if (this.useLocalStorage) {
            const records = JSON.parse(localStorage.getItem('records') || '[]')
            return records.find(r => r.id === id)
        }
        try {
            return await this.db.get('records', id)
        } catch (error) {
            console.error('獲取單條記錄失敗:', error)
            return null
        }
    }

    // 更新記錄
    async updateRecord(id, updates, skipLog = false) {
        if (this.useLocalStorage) {
            return this.updateRecordInLocalStorage(id, updates)
        }

        try {
            // 若更新包含 accountId / debtId，同步更新對應 UUID
            const extraUpdates = {}
            if (updates.accountId !== undefined) {
                if (updates.accountId) {
                    try {
                        const account = await this.db.get(
                            'accounts',
                            updates.accountId
                        )
                        if (account?.uuid)
                            extraUpdates.accountUuid = account.uuid
                    } catch (_) {
                        /* 查不到帳號不影響更新 */
                    }
                } else {
                    extraUpdates.accountUuid = null
                }
            }
            if (updates.debtId !== undefined) {
                if (updates.debtId) {
                    try {
                        const debt = await this.db.get('debts', updates.debtId)
                        if (debt?.uuid) extraUpdates.debtUuid = debt.uuid
                    } catch (_) {
                        /* 查不到欠款不影響更新 */
                    }
                } else {
                    extraUpdates.debtUuid = null
                }
            }

            const tx = this.db.transaction('records', 'readwrite')
            const store = tx.objectStore('records')
            const record = await store.get(id)

            if (record) {
                let finalUpdates = { ...updates, ...extraUpdates }
                if (!skipLog) {
                    // Hook: Before Update
                    const updatesWithHook = await this.triggerHook(
                        'onRecordUpdateBefore',
                        { old: record, updates: finalUpdates }
                    )
                    if (!updatesWithHook)
                        throw new Error('Update cancelled by plugin')
                    finalUpdates = updatesWithHook.updates || finalUpdates
                } else {
                    // 同步模式 (skipLog=true): 來自遠端數據，保護本地核心關聯標識
                    delete finalUpdates.id // 防止修改本機 integer key
                    if (record.uuid) finalUpdates.uuid = record.uuid // 鎖定 UUID，避免 Unique Constraint 衝突
                }

                const updatedRecord = { ...record, ...finalUpdates }
                await store.put(updatedRecord)
                await tx.done

                if (!skipLog) {
                    await this.triggerHook('onRecordUpdateAfter', updatedRecord)
                    await this.logChange('update', 'records', id, updatedRecord)
                }

                // 全自動連動重算受影響之 Debt 與 Group 狀態
                const affectedDebtIds = new Set(
                    [record.debtId, updatedRecord.debtId].filter(Boolean)
                )
                const affectedGroupIds = new Set(
                    [record.groupId, updatedRecord.groupId].filter(Boolean)
                )
                for (const dId of affectedDebtIds) {
                    await this.recalculateDebtState(dId)
                }
                for (const gId of affectedGroupIds) {
                    await this.recalculateGroupState(gId)
                }

                return updatedRecord
            }

            throw new Error('記錄不存在')
        } catch (error) {
            console.error('更新記錄失敗:', error)
            throw error
        }
    }

    // 刪除記錄
    async deleteRecord(id, skipLog = false) {
        if (this.useLocalStorage) {
            return this.deleteRecordFromLocalStorage(id)
        }

        try {
            const tx = this.db.transaction('records', 'readwrite')
            const store = tx.objectStore('records')

            // 在刪除前先取得完整紀錄資料，確保 logChange 能拿到 ledgerId/ledgerUuid
            const recordData = await store.get(id)
            if (!skipLog && recordData) {
                const shouldDelete = await this.triggerHook(
                    'onRecordDeleteBefore',
                    { id }
                )
                if (!shouldDelete) throw new Error('Delete cancelled by plugin')
            }

            await store.delete(id)
            await tx.done

            if (!skipLog && recordData) {
                await this.triggerHook('onRecordDeleteAfter', { id })
                // 傳入完整的紀錄資料，讓 logChange 能正確補全 ledgerUuid、accountUuid 等外鍵
                await this.logChange('delete', 'records', id, {
                    uuid: recordData.uuid,
                    ledgerId: recordData.ledgerId,
                    accountId: recordData.accountId,
                })
            }

            if (recordData) {
                if (recordData.debtId) {
                    await this.recalculateDebtState(recordData.debtId)
                }
                if (recordData.groupId) {
                    await this.recalculateGroupState(recordData.groupId)
                }
            }

            return true
        } catch (error) {
            console.error('刪除記錄失敗:', error)
            throw error
        }
    }

    // --- Amortization Methods (攤提/折舊/分期) ---
    async addAmortization(data, skipLog = false) {
        try {
            if (!data.uuid) data.uuid = this.generateUUID()

            // #SYNC-AMORT: 補充 accountUuid 以便跨裝置同步時正確解析 accountId
            // （語意同 addRecurringTransaction；upfront 模式 accountId=信用卡）
            let accountUuid = data.accountUuid || null
            if (data.accountId && !accountUuid) {
                try {
                    const account = await this.db.get(
                        'accounts',
                        data.accountId
                    )
                    if (account?.uuid) accountUuid = account.uuid
                } catch (_) {
                    /* 查不到帳戶不影響儲存 */
                }
            }

            const dataToSave = {
                ...data,
                ledgerId: data.ledgerId ?? this.activeLedgerId,
                chargeMode: data.chargeMode ?? 'periodic',
                createdAt: data.createdAt ?? Date.now(),
                ...(accountUuid ? { accountUuid } : {}),
            }
            if (skipLog) delete dataToSave.id
            const tx = this.db.transaction('amortizations', 'readwrite')
            const id = await tx.store.add(dataToSave)
            await tx.done
            if (!skipLog)
                await this.logChange('add', 'amortizations', id, dataToSave)
            return id
        } catch (error) {
            console.error('Failed to add amortization:', error)
            throw error
        }
    }

    async getAmortizations(filters = {}) {
        try {
            let items = await this.db.getAll('amortizations')
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                items = items.filter(a => a.ledgerId === targetLedgerId)
            }
            if (filters.status) {
                items = items.filter(a => a.status === filters.status)
            }
            return items
        } catch (error) {
            console.error('Failed to get amortizations:', error)
            return []
        }
    }

    async getAmortization(id) {
        try {
            return await this.db.get('amortizations', id)
        } catch (error) {
            console.error(`Failed to get amortization ${id}:`, error)
            return null
        }
    }

    async updateAmortization(id, updates, skipLog = false) {
        try {
            // #SYNC-AMORT: 若更新包含 accountId，同步更新 accountUuid
            // （語意同 updateRecurringTransaction，確保跨裝置解析不外掛）
            const extraUpdates = {}
            if (updates.accountId !== undefined) {
                if (updates.accountId) {
                    try {
                        const account = await this.db.get(
                            'accounts',
                            updates.accountId
                        )
                        if (account?.uuid)
                            extraUpdates.accountUuid = account.uuid
                    } catch (_) {
                        /* 查不到帳戶不影響更新 */
                    }
                } else {
                    extraUpdates.accountUuid = null
                }
            }

            const tx = this.db.transaction('amortizations', 'readwrite')
            const item = await tx.store.get(id)
            if (item) {
                const finalUpdates = { ...updates, ...extraUpdates }
                if (skipLog) {
                    delete finalUpdates.id
                    if (item.uuid) finalUpdates.uuid = item.uuid
                }
                const updated = { ...item, ...finalUpdates }
                await tx.store.put(updated)
                await tx.done
                if (!skipLog)
                    await this.logChange('update', 'amortizations', id, updated)
                return updated
            }
            throw new Error('Amortization not found')
        } catch (error) {
            console.error(`Failed to update amortization ${id}:`, error)
            throw error
        }
    }

    async deleteAmortization(id, skipLog = false) {
        try {
            const tx = this.db.transaction('amortizations', 'readwrite')
            let uuid = null
            if (!skipLog) {
                const item = await tx.store.get(id)
                uuid = item?.uuid
            }
            await tx.store.delete(id)
            await tx.done
            if (!skipLog)
                await this.logChange('delete', 'amortizations', id, { uuid })
            return true
        } catch (error) {
            console.error(`Failed to delete amortization ${id}:`, error)
            throw error
        }
    }

    // --- Recurring Transaction Methods ---
    async addRecurringTransaction(transaction, skipLog = false) {
        try {
            if (!transaction.uuid) transaction.uuid = this.generateUUID()

            // 補充 accountUuid 以便跨裝置同步時正確解析 accountId
            let accountUuid = transaction.accountUuid || null
            if (transaction.accountId && !accountUuid) {
                try {
                    const account = await this.db.get(
                        'accounts',
                        transaction.accountId
                    )
                    if (account?.uuid) accountUuid = account.uuid
                } catch (_) {
                    /* 查不到帳號不影響儲存 */
                }
            }

            const dataToSave = {
                ...transaction,
                ledgerId: transaction.ledgerId ?? this.activeLedgerId,
                ...(accountUuid ? { accountUuid } : {}),
            }
            if (skipLog) delete dataToSave.id

            const tx = this.db.transaction(
                'recurring_transactions',
                'readwrite'
            )
            const id = await tx.store.add(dataToSave)
            await tx.done
            if (!skipLog)
                await this.logChange(
                    'add',
                    'recurring_transactions',
                    id,
                    dataToSave
                )
            return id
        } catch (error) {
            console.error('Failed to add recurring transaction:', error)
            throw error
        }
    }

    async getRecurringTransactions(filters = {}) {
        try {
            let items = await this.db.getAll('recurring_transactions')
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                items = items.filter(t => t.ledgerId === targetLedgerId)
            }
            return items
        } catch (error) {
            console.error('Failed to get recurring transactions:', error)
            return []
        }
    }

    async updateRecurringTransaction(id, updates, skipLog = false) {
        try {
            // 若更新包含 accountId，同步更新 accountUuid
            const extraUpdates = {}
            if (updates.accountId !== undefined) {
                if (updates.accountId) {
                    try {
                        const account = await this.db.get(
                            'accounts',
                            updates.accountId
                        )
                        if (account?.uuid)
                            extraUpdates.accountUuid = account.uuid
                    } catch (_) {
                        /* 查不到帳號不影響更新 */
                    }
                } else {
                    extraUpdates.accountUuid = null
                }
            }

            const tx = this.db.transaction(
                'recurring_transactions',
                'readwrite'
            )
            const transaction = await tx.store.get(id)
            if (transaction) {
                const finalUpdates = { ...updates, ...extraUpdates }
                if (skipLog) {
                    delete finalUpdates.id
                    if (transaction.uuid) finalUpdates.uuid = transaction.uuid
                }
                const updatedTransaction = { ...transaction, ...finalUpdates }
                await tx.store.put(updatedTransaction)
                await tx.done
                if (!skipLog)
                    await this.logChange(
                        'update',
                        'recurring_transactions',
                        id,
                        updatedTransaction
                    )
                return updatedTransaction
            }
            throw new Error('Recurring transaction not found')
        } catch (error) {
            console.error(
                `Failed to update recurring transaction ${id}:`,
                error
            )
            throw error
        }
    }

    async deleteRecurringTransaction(id, skipLog = false) {
        try {
            const tx = this.db.transaction(
                'recurring_transactions',
                'readwrite'
            )
            let itemData = null
            if (!skipLog) {
                itemData = await tx.store.get(id)
            }
            await tx.store.delete(id)
            await tx.done
            if (!skipLog && itemData)
                await this.logChange('delete', 'recurring_transactions', id, {
                    uuid: itemData.uuid,
                    ledgerId: itemData.ledgerId,
                    description: itemData.description,
                    frequency: itemData.frequency,
                    amount: itemData.amount,
                    type: itemData.type,
                })
            return true
        } catch (error) {
            console.error(
                `Failed to delete recurring transaction ${id}:`,
                error
            )
            throw error
        }
    }

    // LocalStorage 備用方法
    addRecordToLocalStorage(record) {
        const records = this.getRecordsFromLocalStorage()
        record.id = Date.now() // 簡單的 ID 生成
        records.push(record)
        localStorage.setItem('records', JSON.stringify(records))
        return record.id
    }

    getRecordsFromLocalStorage(filters = {}) {
        let records = JSON.parse(localStorage.getItem('records') || '[]')

        // 應用篩選器
        if (filters.startDate || filters.endDate) {
            records = records.filter(record => {
                const recordDate = record.date // 使用字符串比較，格式為 YYYY-MM-DD
                if (filters.startDate && recordDate < filters.startDate)
                    return false
                if (filters.endDate && recordDate > filters.endDate)
                    return false
                return true
            })
        }

        if (filters.type) {
            records = records.filter(record => record.type === filters.type)
        }

        if (filters.category) {
            records = records.filter(
                record => record.category === filters.category
            )
        }

        // Multi-level sort: date desc → timestamp desc → id desc
        return records.sort((a, b) => {
            if (a.date !== b.date)
                return (b.date || '').localeCompare(a.date || '')
            const tsDiff = (b.timestamp || 0) - (a.timestamp || 0)
            if (tsDiff !== 0) return tsDiff
            return (b.id || 0) - (a.id || 0)
        })
    }

    updateRecordInLocalStorage(id, updates) {
        const records = this.getRecordsFromLocalStorage()
        const index = records.findIndex(r => r.id === id)
        if (index !== -1) {
            records[index] = { ...records[index], ...updates }
            localStorage.setItem('records', JSON.stringify(records))
            return records[index]
        }
        throw new Error('記錄不存在')
    }

    deleteRecordFromLocalStorage(id) {
        const records = this.getRecordsFromLocalStorage()
        const filteredRecords = records.filter(r => r.id !== id)
        localStorage.setItem('records', JSON.stringify(filteredRecords))
        return true
    }

    // 獲取統計資料
    async getStatistics(
        startDate,
        endDate,
        accountId = null,
        offsetTransfers = false,
        contactId = null
    ) {
        const filters = { startDate, endDate }
        if (accountId) {
            filters.accountId = accountId
        }
        let records = await this.getRecords(filters)

        if (offsetTransfers) {
            records = records.filter(r => r.category !== 'transfer')
        }

        // Exclude debt-related categories & settlements from statistics
        // These are just "moving money" not real income/expense
        records = records.filter(r => !isDebtSettlementRecord(r))

        const stats = {
            totalIncome: 0,
            totalExpense: 0,
            incomeByCategory: {},
            expenseByCategory: {},
            dailyTotals: {},
            records: records, // Include filtered records in result
        }

        // Pre-fetch debts for effective amount calculation（單批查詢，免逐筆 N+1）
        // debtMaps：全向快取（id/uuid/recordId/recordUuid），供 findDebtForRecord
        // 精準取得關聯欠款；debtsMap 為其 byId 別名，供下方對象篩選取 debt.contactId。
        // debts store 為單一 autoIncrement store（id 跨帳本唯一），allLedgers 僅是
        // 略過帳本過濾，不會造成 id 誤配；與 recordsList / calendarCashFlow /
        // comparisonReport 的載入作用域保持一致。
        const allDebts = (await this.getDebts({ allLedgers: true })) || []
        const debtMaps = buildDebtLookupMaps(allDebts)
        const debtsMap = debtMaps.byId

        // 依對象（聯絡人）篩選（#MOZE-TGT，借鏡 MOZE v4.2.7 報表支援「對象」條件）：
        // 紀錄本身不存 contactId，只保留透過 debtId 關聯到該聯絡人欠款（debt.contactId）
        // 的紀錄；無 debtId 的一般紀錄不屬於任何對象。
        if (contactId !== null && contactId !== undefined) {
            const targetContactId = String(contactId)
            records = records.filter(r => {
                const debt = findDebtForRecord(r, debtMaps)
                const cid = debt ? debt.contactId : r.contactId
                return cid !== null && cid !== undefined && String(cid) === targetContactId
            })
        }

        // Let's filter out records with effective amount 0 so they don't show up in lists
        const adjustedRecords = []

        records.forEach(record => {
            const debt = findDebtForRecord(record, debtMaps)
            const isGroupSettled = record.groupStatus === 'settled'
            const effectiveAmount = calculateEffectiveRecordAmount(
                record,
                debt,
                { isGroupSettled }
            )

            if (effectiveAmount === 0) return // Skip 0 amounts to prevent them from showing up

            // create a copy of record to override amount
            const adjustedRecord = { ...record, amount: effectiveAmount }
            adjustedRecords.push(adjustedRecord)

            if (adjustedRecord.type === 'income') {
                stats.totalIncome += effectiveAmount
                stats.incomeByCategory[adjustedRecord.category] =
                    (stats.incomeByCategory[adjustedRecord.category] || 0) +
                    effectiveAmount
            } else {
                stats.totalExpense += effectiveAmount
                stats.expenseByCategory[adjustedRecord.category] =
                    (stats.expenseByCategory[adjustedRecord.category] || 0) +
                    effectiveAmount
            }

            const date = adjustedRecord.date
            if (!stats.dailyTotals[date]) {
                stats.dailyTotals[date] = { income: 0, expense: 0 }
            }
            stats.dailyTotals[date][
                adjustedRecord.type === 'income' ? 'income' : 'expense'
            ] += effectiveAmount
        })

        stats.records = adjustedRecords

        return stats
    }

    /**
     * 批次取得所有帳本的預算設定（用於匯出/雲端備份）
     * 涵蓋 legacy 全域 key 'budget_settings' 與多帳本 per-ledger key
     * 'budget_settings_<ledgerId>'（預算模組多帳本化後預算主要存在後者，
     * 若匯出時只讀全域 key，多帳本預算會從備份中遺失）。
     * @returns {object} { [settingKey]: payload } map（無預算時為空物件）
     */
    async _getBudgetSettingsMap() {
        const map = {}
        let allSettings = []
        try {
            allSettings = await this.db.getAll('settings')
        } catch (e) {
            console.warn('Silenced error:', e)
        }
        for (const s of allSettings) {
            if (
                s &&
                s.key &&
                (s.key === 'budget_settings' ||
                    s.key.startsWith('budget_settings_'))
            ) {
                map[s.key] = s.value
            }
        }
        return map
    }

    // 匯出所有資料
    async exportData(options = {}) {
        // Default options - include all data types
        const {
            includeRecords = true,
            includeAccounts = true,
            includeDebts = true,
            includeCategories = true,
        } = options

        try {
            const ledgers = await this.getLedgers()
            const records = includeRecords
                ? await this.getRecords({ allLedgers: true })
                : []
            const customCategoriesSetting = includeCategories
                ? await this.getCategorySettingsMap()
                : null
            const categoryOrderSetting = includeCategories
                ? await this.getCategorySettingsMap('category_order')
                : null
            const hiddenCategoriesSetting = includeCategories
                ? await this.getCategorySettingsMap('hidden_categories')
                : null
            const customCategoriesMap = customCategoriesSetting || {}
            const categoryOrderMap = categoryOrderSetting || {}
            const hiddenCategoriesMap = hiddenCategoriesSetting || {}

            const budgetSettingsMap = await this._getBudgetSettingsMap()

            const accounts = includeAccounts
                ? await this.getAccounts({ allLedgers: true })
                : []
            const advancedAccountModeEnabled = await this.getSetting(
                'advancedAccountModeEnabled'
            )
            const debtManagementEnabled = await this.getSetting(
                'debtManagementEnabled'
            )
            const groupManagementEnabled = await this.getSetting(
                'groupManagementEnabled'
            )
            const contacts = includeDebts
                ? await this.getContacts({ allLedgers: true })
                : []
            const debts = includeDebts
                ? await this.getDebts({ allLedgers: true })
                : []
            let recurring_transactions = []
            try {
                recurring_transactions = await this.db.getAll(
                    'recurring_transactions'
                )
            } catch (e) {
                console.warn('Silenced error:', e)
            }
            let amortizations = []
            try {
                amortizations = await this.getAmortizations({
                    allLedgers: true,
                })
            } catch (e) {
                console.warn('Silenced error:', e)
            }
            let credit_statements = []
            try {
                credit_statements = await this.getCreditStatements({
                    allLedgers: true,
                })
            } catch (e) {
                console.warn('Silenced error:', e)
            }
            const files = []
            try {
                if (!this.useLocalStorage) {
                    const tx = this.db.transaction('files', 'readonly')
                    let cursor = await tx.store.openCursor()
                    while (cursor) {
                        const fileData = cursor.value
                        let dataUrl = ''
                        try {
                            dataUrl = await new Promise((resolve, reject) => {
                                const reader = new FileReader()
                                reader.onload = () => resolve(reader.result)
                                reader.onerror = reject
                                reader.readAsDataURL(fileData.data)
                            })
                        } catch (e) {
                            console.warn(
                                'Failed to convert file to data URL:',
                                e
                            )
                            cursor = await cursor.continue()
                            continue
                        }
                        files.push({
                            id: cursor.key,
                            name: fileData.name,
                            type: fileData.type,
                            dataUrl: dataUrl,
                            createdAt: fileData.createdAt,
                        })
                        cursor = await cursor.continue()
                    }
                }
            } catch (e) {
                console.warn('Silenced error:', e)
            }

            const exportData = {
                version: '2.3.0',
                exportDate: new Date().toISOString(),
                settings: {
                    advancedAccountModeEnabled:
                        advancedAccountModeEnabled?.value || false,
                    debtManagementEnabled:
                        debtManagementEnabled?.value || false,
                    groupManagementEnabled:
                        groupManagementEnabled?.value || false,
                },
                activeLedgerId: this.activeLedgerId,
                ledgers: ledgers,
                accounts: accounts,
                records: records,
                contacts: contacts,
                debts: debts,
                recurring_transactions: recurring_transactions,
                amortizations: amortizations,
                credit_statements: credit_statements,
                groupMeta: await this.getAllGroupMeta(),
                files: files,
                customCategories: customCategoriesMap,
                categoryOrder: categoryOrderMap,
                hiddenCategories: hiddenCategoriesMap,
                budgetSettingsMap: budgetSettingsMap,
                metadata: {
                    totalRecords: records.length,
                    totalContacts: contacts.length,
                    totalDebts: debts.length,
                    totalLedgers: ledgers.length,
                    dateRange: {
                        start:
                            records.length > 0
                                ? Math.min(
                                      ...records.map(r =>
                                          new Date(r.date).getTime()
                                      )
                                  )
                                : null,
                        end:
                            records.length > 0
                                ? Math.max(
                                      ...records.map(r =>
                                          new Date(r.date).getTime()
                                      )
                                  )
                                : null,
                    },
                },
            }

            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `記帳資料_${formatDateToString(new Date())}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            return true
        } catch (error) {
            console.error('匯出資料失敗:', error)
            throw error
        }
    }

    // 匯入資料（支援舊版格式與進度回報）
    async importData(file, options = {}) {
        const { onProgress = null, skipConfirm = false } = options
        return new Promise((resolve, reject) => {
            const reader = new FileReader()

            if (onProgress) onProgress(5, '正在讀取備份檔案...')

            reader.onload = async event => {
                let backupSnapshot = null
                try {
                    // 確保資料庫連線已就緒
                    if (!this.db && !this.useLocalStorage) {
                        await this.init()
                    }
                    if (onProgress) onProgress(15, '正在解析資料格式...')
                    const data = JSON.parse(event.target.result)

                    // 確認是否要覆蓋現有資料（呼叫端已確認時可透過 skipConfirm 跳過）
                    if (!skipConfirm && (await this.getRecords()).length > 0) {
                        const confirmed = await customConfirm(
                            `匯入新資料將會覆蓋所有現有資料 (包含紀錄、帳戶、分類設定)。\n\n確定要繼續嗎？`
                        )
                        if (!confirmed) {
                            resolve({
                                success: false,
                                message: '使用者取消操作',
                            })
                            return
                        }
                    }

                    // --- 建立備份快照（用於錯誤時還原）---
                    if (onProgress) onProgress(20, '正在建立安全快照...')
                    try {
                        backupSnapshot = await this._exportFullBackup()
                    } catch (e) {
                        console.warn('建立匯入備份失敗，無法提供 undo 功能:', e)
                    }
                    // --- 持久化緊急快照（跨 session 保險）---
                    // 記憶體快照（backupSnapshot）在「清除舊資料」之後才還原，
                    // 若期間瀏覽器崩潰 / 頁面關閉，快照一併消失。
                    // 這裡先寫一份到 localStorage，匯入成功後才刪除；
                    // 即使中斷，下次開機仍能手動救回。
                    if (backupSnapshot) {
                        try {
                            localStorage.setItem(
                                'import_emergency_snapshot',
                                JSON.stringify(backupSnapshot)
                            )
                            localStorage.setItem(
                                'import_emergency_snapshot_at',
                                String(Date.now())
                            )
                        } catch (e) {
                            console.warn(
                                'localStorage 空間不足，無法建立緊急快照:',
                                e
                            )
                        }
                    }

                    // --- 清除所有舊資料 ---
                    if (onProgress) onProgress(30, '正在清理現有資料...')
                    await this.clearAllRecords()
                    await this.clearAllAccounts()
                    await this.clearAllContacts()
                    await this.clearAllDebts()
                    await this.clearAllCreditStatements()
                    await this.clearAllGroupMeta()
                    if (!this.useLocalStorage) {
                        try {
                            const txSync = this.db.transaction(
                                'sync_log',
                                'readwrite'
                            )
                            await txSync.store.clear()
                            await txSync.done
                        } catch (e) {
                            console.warn('Silenced error:', e)
                        }
                        try {
                            const txR = this.db.transaction(
                                'recurring_transactions',
                                'readwrite'
                            )
                            await txR.store.clear()
                            await txR.done
                        } catch (e) {
                            console.warn('Silenced error:', e)
                        }
                        try {
                            const txA = this.db.transaction(
                                'amortizations',
                                'readwrite'
                            )
                            await txA.store.clear()
                            await txA.done
                        } catch (e) {
                            console.warn('Silenced error:', e)
                        }
                    }
                    await this.saveSetting({
                        key: 'advancedAccountModeEnabled',
                        value: false,
                    })
                    await this.saveSetting({
                        key: 'debtManagementEnabled',
                        value: false,
                    })
                    await this.saveSetting({
                        key: 'groupManagementEnabled',
                        value: false,
                    })

                    // --- 開始匯入 ---
                    // 1. 匯入設定
                    const advancedModeEnabled =
                        data.settings?.advancedAccountModeEnabled || false
                    const debtManagementEnabled =
                        data.settings?.debtManagementEnabled || false
                    const groupManagementEnabled =
                        data.settings?.groupManagementEnabled ??
                        (data.groupMeta && data.groupMeta.length > 0
                            ? true
                            : false)
                    await this.saveSetting({
                        key: 'advancedAccountModeEnabled',
                        value: advancedModeEnabled,
                    })
                    await this.saveSetting({
                        key: 'debtManagementEnabled',
                        value: debtManagementEnabled,
                    })
                    await this.saveSetting({
                        key: 'groupManagementEnabled',
                        value: groupManagementEnabled,
                    })

                    // 2. 匯入帳本 (ledgers) 及建立 mapped ID（必須在分類之前）
                    if (onProgress) onProgress(40, '正在匯入帳本與分類...')
                    const oldLedgerIdToNewIdMap = new Map()
                    if (
                        data.ledgers &&
                        Array.isArray(data.ledgers) &&
                        data.ledgers.length > 0
                    ) {
                        if (!this.useLocalStorage) {
                            try {
                                const txL = this.db.transaction(
                                    'ledgers',
                                    'readwrite'
                                )
                                await txL.store.clear()
                                await txL.done
                            } catch (e) {
                                console.warn('Silenced error:', e)
                            }
                        }
                        for (const ledger of data.ledgers) {
                            const oldId = ledger.id
                            const { id, ...ledgerData } = ledger
                            // Ensure UUID for avoid PK collision in sync
                            if (!ledgerData.uuid)
                                ledgerData.uuid = this.generateUUID()
                            const tx = this.db.transaction(
                                'ledgers',
                                'readwrite'
                            )
                            const newId = await tx.store.add(ledgerData)
                            await tx.done
                            oldLedgerIdToNewIdMap.set(oldId, newId)
                        }
                        if (
                            data.activeLedgerId &&
                            oldLedgerIdToNewIdMap.has(data.activeLedgerId)
                        ) {
                            this.setActiveLedger(
                                oldLedgerIdToNewIdMap.get(data.activeLedgerId)
                            )
                        } else {
                            this.setActiveLedger(
                                oldLedgerIdToNewIdMap.values().next().value || 1
                            )
                        }
                    }

                    const getMappedLedgerId = oldLedgerId => {
                        if (
                            oldLedgerId !== undefined &&
                            oldLedgerIdToNewIdMap.has(oldLedgerId)
                        ) {
                            return oldLedgerIdToNewIdMap.get(oldLedgerId)
                        }
                        return this.activeLedgerId
                    }

                    // 3. 匯入自訂分類 (per-ledger) — 在 ledger import 之後，因為需要 ID mapping
                    const _importPerLedgerCategories = async (
                        dataVal,
                        settingKey
                    ) => {
                        if (!dataVal) return
                        /* Detect format: legacy = { expense: [], income: [] }, per-ledger map = { "1": {...}, "2": {...} } */
                        const isLegacyFormat =
                            dataVal.expense !== undefined ||
                            dataVal.income !== undefined
                        if (isLegacyFormat) {
                            await this.saveCategorySetting(settingKey, dataVal)
                            await this.saveSetting({
                                key: settingKey,
                                value: dataVal,
                            })
                            if (settingKey === 'custom_categories') {
                                try {
                                    localStorage.setItem(
                                        'customCategories',
                                        JSON.stringify(dataVal)
                                    )
                                } catch (e) {
                                    console.warn(
                                        'LocalStorage customCategories sync failed:',
                                        e
                                    )
                                }
                            }
                        } else {
                            let matchedActive = false
                            for (const [oldLidStr, val] of Object.entries(
                                dataVal
                            )) {
                                const oldLid = parseInt(oldLidStr)
                                const newLid = oldLedgerIdToNewIdMap.has(oldLid)
                                    ? oldLedgerIdToNewIdMap.get(oldLid)
                                    : this.activeLedgerId
                                await this.saveCategorySetting(
                                    settingKey,
                                    val,
                                    newLid
                                )
                                if (newLid === this.activeLedgerId) {
                                    matchedActive = true
                                    await this.saveSetting({
                                        key: settingKey,
                                        value: val,
                                    })
                                    if (settingKey === 'custom_categories') {
                                        try {
                                            localStorage.setItem(
                                                'customCategories',
                                                JSON.stringify(val)
                                            )
                                        } catch (e) {
                                            console.warn(
                                                'LocalStorage customCategories sync failed:',
                                                e
                                            )
                                        }
                                    }
                                }
                            }
                            if (!matchedActive) {
                                const firstVal = Object.values(dataVal)[0]
                                if (firstVal) {
                                    await this.saveSetting({
                                        key: settingKey,
                                        value: firstVal,
                                    })
                                    if (settingKey === 'custom_categories') {
                                        try {
                                            localStorage.setItem(
                                                'customCategories',
                                                JSON.stringify(firstVal)
                                            )
                                        } catch (e) {
                                            console.warn(
                                                'LocalStorage customCategories sync failed:',
                                                e
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                    await _importPerLedgerCategories(
                        data.customCategories,
                        'custom_categories'
                    )
                    await _importPerLedgerCategories(
                        data.categoryOrder,
                        'category_order'
                    )
                    await _importPerLedgerCategories(
                        data.hiddenCategories,
                        'hidden_categories'
                    )

                    if (data.budgetSettingsMap) {
                        for (const [key, val] of Object.entries(
                            data.budgetSettingsMap
                        )) {
                            // 無效 value（null/undefined）跳過，避免寫入空設定
                            if (val === null || val === undefined) continue
                            let newKey = key
                            let suffix = ''
                            if (newKey !== 'budget_settings') {
                                // rewrite ledger id if it has one
                                // ⚠️ key 格式固定 budget_settings_<ledgerId>，
                                // 取最後一段（不可用固定 parts[2]，key 名稱
                                // 含底線，未來格式變動會解析錯位置）
                                const parts = newKey.split('_')
                                const lId = parseInt(parts[parts.length - 1])
                                if (
                                    !isNaN(lId) &&
                                    oldLedgerIdToNewIdMap.has(lId)
                                ) {
                                    const mappedId =
                                        oldLedgerIdToNewIdMap.get(lId)
                                    newKey = `budget_settings_${mappedId}`
                                    suffix = `_${mappedId}`
                                } else {
                                    // #BUDGET-KEY-M10：帳本 id 解析失敗或未被匯入映射
                                    // → 該鍵是孤兒／外部帳本遺留。若照原 key 寫入，
                                    // 會蓋到本機同號帳本的預算（不相干帳本被污染），
                                    // 且下方 localStorage 同步段會用空 suffix 寫進全域 legacy 鍵。
                                    console.warn(
                                        `匯入預算設定時跳過未對應帳本的鍵：${key}`
                                    )
                                    continue
                                }
                            }
                            await this.saveSetting({ key: newKey, value: val })
                            try {
                                if (val && typeof val === 'object') {
                                    localStorage.setItem(
                                        `monthlyBudget${suffix}`,
                                        (val.monthlyBudget || 0).toString()
                                    )
                                    localStorage.setItem(
                                        `categoryBudgets${suffix}`,
                                        JSON.stringify(
                                            val.categoryBudgets || {}
                                        )
                                    )
                                    localStorage.setItem(
                                        `categoryBudgetOrder${suffix}`,
                                        JSON.stringify(
                                            val.categoryBudgetOrder || []
                                        )
                                    )
                                    localStorage.setItem(
                                        `excludedBudgetCategories${suffix}`,
                                        JSON.stringify(
                                            val.excludedBudgetCategories || []
                                        )
                                    )
                                }
                            } catch (e) {
                                console.warn(
                                    'LocalStorage budget sync failed during import:',
                                    e
                                )
                            }
                        }
                    } else if (data.budgetSettings) {
                        await this.saveSetting({
                            key: 'budget_settings',
                            value: data.budgetSettings,
                        })
                        if (this.activeLedgerId) {
                            await this.saveSetting({
                                key: `budget_settings_${this.activeLedgerId}`,
                                value: data.budgetSettings,
                            })
                        }
                        try {
                            const val = data.budgetSettings
                            const suffix = this.activeLedgerId
                                ? `_${this.activeLedgerId}`
                                : ''
                            if (val && typeof val === 'object') {
                                localStorage.setItem(
                                    'monthlyBudget',
                                    (val.monthlyBudget || 0).toString()
                                )
                                localStorage.setItem(
                                    'categoryBudgets',
                                    JSON.stringify(val.categoryBudgets || {})
                                )
                                localStorage.setItem(
                                    'categoryBudgetOrder',
                                    JSON.stringify(
                                        val.categoryBudgetOrder || []
                                    )
                                )
                                localStorage.setItem(
                                    'excludedBudgetCategories',
                                    JSON.stringify(
                                        val.excludedBudgetCategories || []
                                    )
                                )
                                if (suffix) {
                                    localStorage.setItem(
                                        `monthlyBudget${suffix}`,
                                        (val.monthlyBudget || 0).toString()
                                    )
                                    localStorage.setItem(
                                        `categoryBudgets${suffix}`,
                                        JSON.stringify(
                                            val.categoryBudgets || {}
                                        )
                                    )
                                    localStorage.setItem(
                                        `categoryBudgetOrder${suffix}`,
                                        JSON.stringify(
                                            val.categoryBudgetOrder || []
                                        )
                                    )
                                    localStorage.setItem(
                                        `excludedBudgetCategories${suffix}`,
                                        JSON.stringify(
                                            val.excludedBudgetCategories || []
                                        )
                                    )
                                }
                            }
                        } catch (e) {
                            console.warn(
                                'LocalStorage budget sync failed during legacy import:',
                                e
                            )
                        }
                    }

                    // 4. 匯入帳戶並建立 ID Map（含同帳本同名帳戶分組去重與關聯優先綁定）
                    if (onProgress) onProgress(55, '正在匯入帳戶資料...')
                    const oldAccountIdToNewIdMap = new Map()
                    if (
                        advancedModeEnabled &&
                        data.accounts &&
                        Array.isArray(data.accounts)
                    ) {
                        const refCounts = new Map()
                        if (Array.isArray(data.records)) {
                            for (const r of data.records) {
                                if (r.accountId != null) {
                                    refCounts.set(
                                        r.accountId,
                                        (refCounts.get(r.accountId) || 0) + 1
                                    )
                                }
                            }
                        }
                        if (Array.isArray(data.debts)) {
                            for (const d of data.debts) {
                                if (d.accountId != null) {
                                    refCounts.set(
                                        d.accountId,
                                        (refCounts.get(d.accountId) || 0) + 1
                                    )
                                }
                            }
                        }

                        const accountGroups = new Map()
                        for (const account of data.accounts) {
                            const mappedLid = getMappedLedgerId(
                                account.ledgerId
                            )
                            const normName = (account.name || '')
                                .trim()
                                .toLowerCase()
                            const key = `${mappedLid}:::${normName}`
                            if (!accountGroups.has(key)) {
                                accountGroups.set(key, [])
                            }
                            accountGroups.get(key).push(account)
                        }

                        for (const group of accountGroups.values()) {
                            group.sort((a, b) => {
                                const countA = refCounts.get(a.id) || 0
                                const countB = refCounts.get(b.id) || 0
                                if (countB !== countA) return countB - countA
                                const uuidA = a.uuid ? 1 : 0
                                const uuidB = b.uuid ? 1 : 0
                                if (uuidB !== uuidA) return uuidB - uuidA
                                const balA = Math.abs(a.balance || 0)
                                const balB = Math.abs(b.balance || 0)
                                if (balB !== balA) return balB - balA
                                return (a.id || 0) - (b.id || 0)
                            })

                            const primaryAccount = group[0]
                            const { id: _oldPrimaryId, ...primaryData } =
                                primaryAccount
                            primaryData.ledgerId = getMappedLedgerId(
                                primaryData.ledgerId
                            )

                            if (
                                (!primaryData.balance ||
                                    primaryData.balance === 0) &&
                                group.some(a => a.balance)
                            ) {
                                primaryData.balance =
                                    group.find(a => a.balance)?.balance ||
                                    primaryData.balance
                            }

                            const newId = await this.addAccount(
                                primaryData,
                                true
                            )

                            for (const acc of group) {
                                oldAccountIdToNewIdMap.set(acc.id, newId)
                            }
                        }
                    }

                    // 4.5 匯入檔案 (頭像等) 並建立 ID Map
                    if (onProgress) onProgress(65, '正在處理附件檔案...')
                    const oldFileIdToNewIdMap = new Map()
                    if (
                        !this.useLocalStorage &&
                        data.files &&
                        Array.isArray(data.files)
                    ) {
                        try {
                            const txF = this.db.transaction(
                                'files',
                                'readwrite'
                            )
                            await txF.store.clear()
                            await txF.done
                        } catch (e) {
                            console.warn('Silenced error:', e)
                        }
                        const txF = this.db.transaction('files', 'readwrite')
                        for (const file of data.files) {
                            const oldId = file.id
                            // 略過舊版匯出（無 dataUrl 欄位或資料已損毀）
                            if (
                                !file.dataUrl ||
                                typeof file.dataUrl !== 'string'
                            ) {
                                console.warn(
                                    'Skipping file without dataUrl:',
                                    file.name
                                )
                                continue
                            }
                            let blob
                            try {
                                const parts = file.dataUrl.split(',')
                                const mimeMatch = parts[0].match(/:(.*?);/)
                                if (!mimeMatch)
                                    throw new Error('Invalid data URL')
                                const mime = mimeMatch[1]
                                const bstr = atob(parts[1])
                                const n = bstr.length
                                const u8arr = new Uint8Array(n)
                                for (let i = 0; i < n; i++) {
                                    u8arr[i] = bstr.charCodeAt(i)
                                }
                                blob = new Blob([u8arr], { type: mime })
                            } catch (e) {
                                console.warn(
                                    'Failed to parse imported file data:',
                                    e
                                )
                                continue
                            }
                            const dbFile = {
                                name: file.name,
                                type: file.type,
                                data: blob,
                                createdAt: file.createdAt || Date.now(),
                            }
                            let newId
                            try {
                                newId = await txF.store.add(dbFile)
                            } catch (e) {
                                console.warn('Failed to import file:', e)
                                continue
                            }
                            oldFileIdToNewIdMap.set(oldId, newId)
                        }
                        await txF.done
                    }

                    // 5. 匯入聯絡人並建立 ID Map（含同名分組去重與 skipLog = true）
                    if (onProgress) onProgress(75, '正在匯入欠款與聯絡人...')
                    const oldContactIdToNewIdMap = new Map()
                    if (data.contacts && Array.isArray(data.contacts)) {
                        const contactRefCounts = new Map()
                        if (Array.isArray(data.debts)) {
                            for (const d of data.debts) {
                                if (d.contactId != null) {
                                    contactRefCounts.set(
                                        d.contactId,
                                        (contactRefCounts.get(d.contactId) ||
                                            0) + 1
                                    )
                                }
                            }
                        }

                        const contactGroups = new Map()
                        for (const contact of data.contacts) {
                            const mappedLid = getMappedLedgerId(
                                contact.ledgerId
                            )
                            const normName = (contact.name || '')
                                .trim()
                                .toLowerCase()
                            const key = `${mappedLid}:::${normName}`
                            if (!contactGroups.has(key)) {
                                contactGroups.set(key, [])
                            }
                            contactGroups.get(key).push(contact)
                        }

                        for (const group of contactGroups.values()) {
                            group.sort((a, b) => {
                                const countA = contactRefCounts.get(a.id) || 0
                                const countB = contactRefCounts.get(b.id) || 0
                                if (countB !== countA) return countB - countA
                                const uuidA = a.uuid ? 1 : 0
                                const uuidB = b.uuid ? 1 : 0
                                if (uuidB !== uuidA) return uuidB - uuidA
                                return (a.id || 0) - (b.id || 0)
                            })

                            const primaryContact = group[0]
                            const { id: _oldPrimaryId, ...contactData } =
                                primaryContact
                            contactData.ledgerId = getMappedLedgerId(
                                contactData.ledgerId
                            )
                            if (contactData.avatarFileId) {
                                contactData.avatarFileId =
                                    oldFileIdToNewIdMap.get(
                                        contactData.avatarFileId
                                    ) || null
                            }
                            const newId = await this.addContact(
                                contactData,
                                true
                            )
                            for (const c of group) {
                                oldContactIdToNewIdMap.set(c.id, newId)
                            }
                        }
                    }

                    // 6. 匯入欠款 (Phase 1: Insert & Map IDs)
                    // We use direct DB insertion instead of addDebt to preserve imported state (amounts, payments, etc.)
                    const oldDebtIdToNewIdMap = new Map()

                    // 5.5 匯入 Group Meta (在 debt 之前，因為 groupId 不需要 remap)
                    if (data.groupMeta && Array.isArray(data.groupMeta)) {
                        const txGM = this.db.transaction(
                            'groupMeta',
                            'readwrite'
                        )
                        for (const gm of data.groupMeta) {
                            const { id, ...gmData } = gm
                            gmData.ledgerId = getMappedLedgerId(gmData.ledgerId)
                            if (!gmData.uuid) gmData.uuid = this.generateUUID()
                            await txGM.store.put({ id, ...gmData })
                        }
                        await txGM.done
                    }
                    const debtsToUpdate = [] // Keep track for Phase 2 linking

                    if (data.debts && Array.isArray(data.debts)) {
                        const tx = this.db.transaction('debts', 'readwrite')
                        for (const debt of data.debts) {
                            const oldId = debt.id
                            const { id, ...debtData } = debt

                            // Ensure UUID
                            if (!debtData.uuid)
                                debtData.uuid = this.generateUUID()

                            // Ensure ledgerId
                            debtData.ledgerId = getMappedLedgerId(
                                debtData.ledgerId
                            )

                            // Update contactId
                            if (debtData.contactId) {
                                debtData.contactId = oldContactIdToNewIdMap.get(
                                    debtData.contactId
                                )
                            }

                            // Fix missing amount fields (e.g. from legacy data)
                            if (
                                debtData.remainingAmount === undefined ||
                                debtData.remainingAmount === null
                            ) {
                                debtData.remainingAmount =
                                    debtData.originalAmount ??
                                    debtData.amount ??
                                    0
                            }
                            if (
                                debtData.originalAmount === undefined ||
                                debtData.originalAmount === null
                            ) {
                                debtData.originalAmount =
                                    debtData.amount ??
                                    debtData.remainingAmount ??
                                    0
                            }

                            // Fix potential bug where remainingAmount is 0 but debt is not settled
                            if (
                                debtData.remainingAmount === 0 &&
                                !debtData.settled
                            ) {
                                const paid = (debtData.payments || []).reduce(
                                    (sum, p) => sum + p.amount,
                                    0
                                )
                                if (debtData.originalAmount > paid) {
                                    debtData.remainingAmount =
                                        debtData.originalAmount - paid
                                } else if (
                                    debtData.originalAmount > 0 &&
                                    paid === 0
                                ) {
                                    debtData.remainingAmount =
                                        debtData.originalAmount
                                }
                            }

                            // Insert directly to preserve logical state (amount, payments, settled)
                            const newId = await tx.store.add(debtData)
                            oldDebtIdToNewIdMap.set(oldId, newId)
                            debtsToUpdate.push({ newId, oldData: debt })
                        }
                        await tx.done
                    }

                    // 7. 匯入紀錄
                    if (onProgress) onProgress(85, '正在匯入收支明細...')
                    const oldRecordIdToNewIdMap = new Map()

                    let recordsSource = []
                    if (data.version && data.version.startsWith('2.')) {
                        recordsSource = data.records || []
                    } else {
                        recordsSource = this.convertOldDataFormat(data)
                    }

                    const validRecords = recordsSource.filter(
                        record =>
                            record.date &&
                            record.type &&
                            record.category &&
                            typeof record.amount === 'number'
                    )

                    const txRecords = this.db.transaction(
                        'records',
                        'readwrite'
                    )
                    for (const record of validRecords) {
                        const oldRecordId = record.id
                        const { id, ...recordData } = record

                        // Update accountId
                        if (
                            advancedModeEnabled &&
                            recordData.accountId !== undefined
                        ) {
                            recordData.accountId = oldAccountIdToNewIdMap.get(
                                recordData.accountId
                            )
                        }

                        // Update debtId
                        if (recordData.debtId) {
                            recordData.debtId = oldDebtIdToNewIdMap.get(
                                recordData.debtId
                            )
                        }

                        // Add timestamp if missing or use existing, ensure new ID generation
                        if (!recordData.timestamp)
                            recordData.timestamp = Date.now()

                        // Ensure UUID
                        if (!recordData.uuid)
                            recordData.uuid = this.generateUUID()

                        // Ensure ledgerId
                        recordData.ledgerId = getMappedLedgerId(
                            recordData.ledgerId
                        )

                        const newRecordId =
                            await txRecords.store.add(recordData)
                        if (oldRecordId) {
                            oldRecordIdToNewIdMap.set(oldRecordId, newRecordId)
                        }
                    }
                    await txRecords.done

                    // 8. Update Debts (Phase 2: Link Records)
                    // Now that we have newRecordIds, we can update debt references
                    if (debtsToUpdate.length > 0) {
                        const txUpdate = this.db.transaction(
                            'debts',
                            'readwrite'
                        )
                        for (const item of debtsToUpdate) {
                            const debt = await txUpdate.store.get(item.newId)
                            if (debt) {
                                let changed = false

                                // Link creation record
                                if (item.oldData.recordId) {
                                    const newRecId = oldRecordIdToNewIdMap.get(
                                        item.oldData.recordId
                                    )
                                    if (newRecId) {
                                        debt.recordId = newRecId
                                        changed = true
                                    }
                                }

                                // Link payment records
                                if (
                                    debt.payments &&
                                    Array.isArray(debt.payments)
                                ) {
                                    const newPayments = debt.payments.map(p => {
                                        if (p.recordId) {
                                            const newRecId =
                                                oldRecordIdToNewIdMap.get(
                                                    p.recordId
                                                )
                                            if (newRecId) {
                                                changed = true
                                                return {
                                                    ...p,
                                                    recordId: newRecId,
                                                }
                                            }
                                        }
                                        return p
                                    })
                                    if (changed) {
                                        debt.payments = newPayments
                                    }
                                }

                                if (changed) {
                                    await txUpdate.store.put(debt)
                                }
                            }
                        }
                        await txUpdate.done
                    }

                    // 9. 匯入 Recurring Transactions
                    if (onProgress) onProgress(95, '正在建立定期與分期項目...')
                    if (
                        data.recurring_transactions &&
                        Array.isArray(data.recurring_transactions)
                    ) {
                        const txRecur = this.db.transaction(
                            'recurring_transactions',
                            'readwrite'
                        )
                        for (const rt of data.recurring_transactions) {
                            const { id, ...rtData } = rt
                            if (!rtData.uuid) rtData.uuid = this.generateUUID()
                            rtData.ledgerId = getMappedLedgerId(rtData.ledgerId)

                            if (
                                rtData.accountId !== undefined &&
                                oldAccountIdToNewIdMap.has(rtData.accountId)
                            ) {
                                rtData.accountId = oldAccountIdToNewIdMap.get(
                                    rtData.accountId
                                )
                            }
                            await txRecur.store.add(rtData)
                        }
                        await txRecur.done
                    }

                    // 10. 匯入 Amortizations (攤提/折舊/分期)
                    if (
                        data.amortizations &&
                        Array.isArray(data.amortizations)
                    ) {
                        try {
                            const txAmort = this.db.transaction(
                                'amortizations',
                                'readwrite'
                            )
                            for (const am of data.amortizations) {
                                const { id, ...amData } = am
                                if (!amData.uuid)
                                    amData.uuid = this.generateUUID()
                                amData.ledgerId = getMappedLedgerId(
                                    amData.ledgerId
                                )
                                if (
                                    amData.accountId !== undefined &&
                                    oldAccountIdToNewIdMap.has(amData.accountId)
                                ) {
                                    amData.accountId =
                                        oldAccountIdToNewIdMap.get(
                                            amData.accountId
                                        )
                                }
                                await txAmort.store.add(amData)
                            }
                            await txAmort.done
                        } catch (e) {
                            console.warn('匯入攤提資料時發生錯誤:', e)
                        }
                    }

                    // 11. 匯入 Credit Statements (信用卡帳單)
                    if (
                        data.credit_statements &&
                        Array.isArray(data.credit_statements)
                    ) {
                        try {
                            const txStmt = this.db.transaction(
                                'credit_statements',
                                'readwrite'
                            )
                            for (const stmt of data.credit_statements) {
                                const { id, ...stmtData } = stmt
                                if (!stmtData.uuid)
                                    stmtData.uuid = this.generateUUID()
                                stmtData.ledgerId = getMappedLedgerId(
                                    stmtData.ledgerId
                                )
                                if (
                                    stmtData.accountId !== undefined &&
                                    oldAccountIdToNewIdMap.has(
                                        stmtData.accountId
                                    )
                                ) {
                                    stmtData.accountId =
                                        oldAccountIdToNewIdMap.get(
                                            stmtData.accountId
                                        )
                                }
                                await txStmt.store.add(stmtData)
                            }
                            await txStmt.done
                        } catch (e) {
                            console.warn('匯入信用卡帳單資料時發生錯誤:', e)
                        }
                    }

                    // 執行一次全域帳戶與聯絡人去重整合，確保歷史舊備份或邊界狀態中的同名帳戶/聯絡人乾淨合併
                    try {
                        await this.deduplicateAccounts()
                        await this.deduplicateContacts()
                    } catch (e) {
                        console.warn(
                            '[DataService] post-import deduplicate warning:',
                            e
                        )
                    }

                    // 匯入成功：清除緊急快照（失敗時保留供手動救援）
                    try {
                        localStorage.removeItem('import_emergency_snapshot')
                        localStorage.removeItem('import_emergency_snapshot_at')
                    } catch (e) {
                        // 忽略
                    }

                    if (onProgress) onProgress(100, '資料匯入完成！')
                    resolve({
                        success: true,
                        message: `成功匯入 ${validRecords.length} 筆記錄`,
                    })
                } catch (error) {
                    if (
                        backupSnapshot &&
                        error.message !== '檔案格式錯誤或損壞'
                    ) {
                        console.error('匯入失敗，嘗試從備份還原...', error)
                        try {
                            await this._restoreFromBackup(backupSnapshot)
                            reject(
                                new Error(
                                    `匯入失敗且已自動還原：${error.message}`
                                )
                            )
                        } catch (restoreError) {
                            console.error(
                                '備份還原也失敗了！資料可能已損壞:',
                                restoreError
                            )
                            reject(
                                new Error(
                                    `匯入失敗且無法從備份還原，請手動恢復！原始錯誤：${error.message}`
                                )
                            )
                        }
                    } else {
                        console.error('解析匯入檔案失敗:', error)
                        reject(new Error('檔案格式錯誤或損壞'))
                    }
                }
            }

            reader.onerror = () => {
                reject(new Error('讀取檔案失敗'))
            }

            reader.readAsText(file)
        })
    }

    // --- 匯入備份/還原方法（用於 importData undo）---

    /** 將所有 store 資料序列化為 JSON 物件 */
    async _exportFullBackup() {
        if (this.useLocalStorage) {
            return {
                localStorage: { ...localStorage },
                ledgers: [],
                records: [],
                accounts: [],
                contacts: [],
                debts: [],
                recurring_transactions: [],
                amortizations: [],
                credit_statements: [],
            }
        }
        const backup = {}
        const stores = [
            'ledgers',
            'records',
            'accounts',
            'contacts',
            'debts',
            'recurring_transactions',
            'amortizations',
            'credit_statements',
            'groupMeta',
            // settings store 必須納入快照：預算設定（budget_settings*，
            // 含 excludedBudgetCategories「忽略的類別」）、分類設定、
            // 功能開關等都存在這裡。舊版快照漏掉 settings → 匯入失敗
            // 自動還原時，已被失敗匯入檔覆寫的預算設定救不回來。
            'settings',
        ]
        for (const storeName of stores) {
            try {
                const tx = this.db.transaction(storeName, 'readonly')
                backup[storeName] = await tx.store.toArray()
                await tx.done
            } catch (e) {
                console.warn(`備份 store ${storeName} 失敗:`, e)
            }
        }
        // Also export settings from localStorage
        backup._settings = {}
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key.startsWith('easy_accounting_')) {
                backup._settings[key] = localStorage.getItem(key)
            }
        }
        return backup
    }

    /** 從備份快照還原所有 store */
    async _restoreFromBackup(backup) {
        if (this.useLocalStorage) {
            // Clear and restore localStorage
            const keysToRemove = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key.startsWith('easy_accounting_')) {
                    keysToRemove.push(key)
                }
            }
            for (const key of keysToRemove) {
                localStorage.removeItem(key)
            }
            // Restore settings
            if (backup._settings) {
                for (const [key, val] of Object.entries(backup._settings)) {
                    localStorage.setItem(key, val)
                }
            }
            return
        }

        const stores = [
            'records',
            'accounts',
            'contacts',
            'debts',
            'recurring_transactions',
            'amortizations',
            'credit_statements',
            'ledgers',
            'groupMeta',
            // settings store：與 _exportFullBackup 對應，還原匯入前
            // 的預算/分類/功能開關設定（keyPath='key'，put 保留原 key）。
            'settings',
        ]
        for (const storeName of stores) {
            try {
                // Clear existing data
                const clearTx = this.db.transaction(storeName, 'readwrite')
                await clearTx.store.clear()
                await clearTx.done

                // Restore backed up data
                if (backup[storeName] && backup[storeName].length > 0) {
                    const restoreTx = this.db.transaction(
                        storeName,
                        'readwrite'
                    )
                    for (const item of backup[storeName]) {
                        // 全部 store 一律使用 put 保留原始 id：
                        // 還原前先 clear 過整個 store，所以 put 原始 id
                        // 不會衝突；保留 id 才能維持外鍵完整
                        // （records.accountId / records.debtId /
                        //  amortizations.accountId 等都指向原主鍵）。
                        // 舊版 delete item.id + add 會讓所有 store 拿到
                        // 新自增 ID，外鍵全部斷裂 → 還原「成功」後
                        // 所有紀錄 filter 不到帳本/帳戶 → 看似資料全消失。
                        await restoreTx.store.put(item)
                    }
                    await restoreTx.done
                }
            } catch (e) {
                console.warn(`還原 store ${storeName} 失敗:`, e)
            }
        }

        // Restore settings
        if (backup._settings) {
            for (const [key, val] of Object.entries(backup._settings)) {
                localStorage.setItem(key, val)
            }
        }
    }

    // 清除所有記錄
    async clearAllRecords() {
        if (this.useLocalStorage) {
            localStorage.removeItem('records')
            return true
        }

        try {
            const tx = this.db.transaction('records', 'readwrite')
            const store = tx.objectStore('records')
            await store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('清除記錄失敗:', error)
            throw error
        }
    }

    // 獲取所有記錄（用於匯出，包含所有帳本）
    async getAllRecords() {
        return await this.getRecords({ allLedgers: true })
    }

    // --- Theme Methods ---

    async getInstalledThemes() {
        if (this.useLocalStorage || !this.db) return []
        try {
            return await this.db.getAll('themes')
        } catch (error) {
            console.error('Failed to get installed themes:', error)
            return []
        }
    }

    async installTheme(themeData) {
        if (this.useLocalStorage || !this.db) return
        try {
            const tx = this.db.transaction('themes', 'readwrite')
            await tx.store.put(themeData)
            await tx.done
        } catch (error) {
            console.error('Failed to install theme:', error)
            throw error
        }
    }

    async uninstallTheme(id) {
        if (this.useLocalStorage || !this.db) return
        try {
            const tx = this.db.transaction('themes', 'readwrite')
            await tx.store.delete(id)
            await tx.done
        } catch (error) {
            console.error('Failed to uninstall theme:', error)
            throw error
        }
    }

    async getTheme(id) {
        if (this.useLocalStorage || !this.db) return null
        try {
            return await this.db.get('themes', id)
        } catch (error) {
            console.error(`Failed to get theme ${id}:`, error)
            return null
        }
    }

    // --- Sync Methods ---

    /**
     * 記錄變更到 sync_log（用於多裝置同步）
     * @param {string} operation - 'add', 'update', 'delete'
     * @param {string} storeName - object store 名稱
     * @param {number|string} recordId - 記錄 ID
     * @param {object|null} data - 記錄資料
     */
    async logChange(operation, storeName, recordId, data) {
        if (this.useLocalStorage || !this.db) return
        try {
            const syncData = data ? { ...data } : null

            // 自動補全所有外鍵 UUID，確保跨裝置同步時能正確對應
            if (syncData) {
                // 1. Ledger UUID
                if (syncData.ledgerId && !syncData.ledgerUuid) {
                    const ledger = await this.db.get(
                        'ledgers',
                        syncData.ledgerId
                    )
                    if (ledger?.uuid) syncData.ledgerUuid = ledger.uuid
                }
                // 2. Account UUID
                if (syncData.accountId && !syncData.accountUuid) {
                    const account = await this.db.get(
                        'accounts',
                        syncData.accountId
                    )
                    if (account?.uuid) syncData.accountUuid = account.uuid
                }
                // 3. Contact UUID (for debts)
                if (syncData.contactId && !syncData.contactUuid) {
                    const contact = await this.db.get(
                        'contacts',
                        syncData.contactId
                    )
                    if (contact?.uuid) syncData.contactUuid = contact.uuid
                }
                // 4. Debt UUID (for records)
                if (syncData.debtId && !syncData.debtUuid) {
                    const debt = await this.db.get('debts', syncData.debtId)
                    if (debt?.uuid) syncData.debtUuid = debt.uuid
                }
                // 5. Record UUID (for debt payments)
                if (syncData.recordId && !syncData.recordUuid) {
                    const record = await this.db.get(
                        'records',
                        syncData.recordId
                    )
                    if (record?.uuid) syncData.recordUuid = record.uuid
                }
                // 6. Amortization UUID (for records)
                if (syncData.amortizationId && !syncData.amortizationUuid) {
                    const amort = await this.db.get(
                        'amortizations',
                        syncData.amortizationId
                    )
                    if (amort?.uuid) syncData.amortizationUuid = amort.uuid
                }
            }

            const tx = this.db.transaction('sync_log', 'readwrite')
            await tx.store.add({
                operation,
                storeName,
                recordId,
                data: syncData,
                timestamp: Date.now(),
                deviceId: this._syncDeviceId,
            })
            await tx.done
        } catch (err) {
            console.warn('[DataService] logChange error:', err)
        }
    }

    /**
     * 檢查並將既有未同步之歷史資料補齊至 sync_log（用於初次同步或自其他同步通道/Google Drive 遷移至新伺服器時）。
     * 拓撲順序：ledgers -> accounts -> contacts -> debts -> amortizations -> records -> recurring_transactions -> groupMeta
     */
    async seedAllDataToSyncLog() {
        if (this.useLocalStorage || !this.db) return
        const stores = [
            'ledgers',
            'accounts',
            'contacts',
            'debts',
            'amortizations',
            'records',
            'recurring_transactions',
            'groupMeta',
        ]
        try {
            const existingSyncLogs = await this.db.getAll('sync_log')
            const loggedSet = new Set(
                existingSyncLogs.map(l => `${l.storeName}|${l.recordId}`)
            )
            for (const storeName of stores) {
                if (!this.db.objectStoreNames.contains(storeName)) continue
                const items = await this.db.getAll(storeName)
                for (const item of items) {
                    if (!item || item.id === undefined) continue
                    const key = `${storeName}|${item.id}`
                    if (!loggedSet.has(key)) {
                        await this.logChange('add', storeName, item.id, item)
                        loggedSet.add(key)
                    }
                }
            }
        } catch (err) {
            console.warn('[DataService] seedAllDataToSyncLog error:', err)
        }
    }

    /**
     * 取得指定時間戳之後的所有變更
     * @param {number} sinceTimestamp - 起始時間戳
     * @returns {Promise<Array>}
     */
    async getChangesSince(sinceTimestamp, options = {}) {
        if (this.useLocalStorage || !this.db) return []
        try {
            const isSharedSync = !!options.sharedLedgerUuid
            const targetUuid = options.sharedLedgerUuid

            const allLedgers = await this.db.getAll('ledgers')
            const sharedUuids = new Set(
                allLedgers.filter(l => l.isShared).map(l => l.uuid)
            )

            const tx = this.db.transaction('sync_log', 'readonly')
            const index = tx.store.index('timestamp')
            // 使用 false (即 >=) 避免漏掉同毫秒的變更
            // 去重邏輯由 SyncService 的 pushSharedLedgerChanges 負責
            const range = IDBKeyRange.lowerBound(sinceTimestamp, false)
            const allChanges = await index.getAll(range)

            return allChanges.filter(log => {
                let logLedgerUuid = log.data?.ledgerUuid
                if (!logLedgerUuid && log.storeName === 'ledgers') {
                    logLedgerUuid = log.data?.uuid || null
                }

                if (isSharedSync) {
                    return logLedgerUuid === targetUuid
                } else {
                    // For personal sync, filter OUT if it belongs to any shared ledger
                    // 但是「帳本(ledgers)」本身的變更日誌必須放行，否則其他裝置永遠不會知道該帳本變成了共用帳本！
                    if (logLedgerUuid && log.storeName !== 'ledgers') {
                        return !sharedUuids.has(logLedgerUuid)
                    }
                    return true // global stuff (settings) and ledgers synced personally
                }
            })
        } catch (err) {
            console.error('[DataService] getChangesSince error:', err)
            return []
        }
    }

    /**
     * 清除指定時間戳之前的同步日誌
     * @param {number} beforeTimestamp
     */
    async clearSyncLog(beforeTimestamp) {
        if (this.useLocalStorage || !this.db) return
        try {
            const tx = this.db.transaction('sync_log', 'readwrite')
            const index = tx.store.index('timestamp')
            const range = IDBKeyRange.upperBound(beforeTimestamp)
            let cursor = await index.openCursor(range)
            while (cursor) {
                await cursor.delete()
                cursor = await cursor.continue()
            }
            await tx.done
        } catch (err) {
            console.error('[DataService] clearSyncLog error:', err)
        }
    }

    /**
     * 依據具體 ID 清除已成功推送的同步日誌
     * @param {Array<number>} ids - sync_log 主鍵 ID 陣列
     * @returns {Promise<boolean>}
     */
    async deleteSyncLogsByIds(ids) {
        if (
            this.useLocalStorage ||
            !this.db ||
            !Array.isArray(ids) ||
            ids.length === 0
        )
            return true
        const validIds = ids.filter(
            id => typeof id === 'number' && Number.isInteger(id)
        )
        if (validIds.length === 0) return true
        try {
            const tx = this.db.transaction('sync_log', 'readwrite')
            for (const id of validIds) {
                tx.store.delete(id)
            }
            await tx.done
            return true
        } catch (err) {
            console.error('[DataService] deleteSyncLogsByIds error:', err)
            return false
        }
    }

    /**
     * 匯出資料用於同步（回傳物件而非下載檔案）
     * @returns {Promise<object>}
     */
    async exportDataForSync(options = {}) {
        const isSharedSync = !!options.sharedLedgerUuid
        const targetUuid = options.sharedLedgerUuid

        let ledgers = await this.getLedgers()
        if (isSharedSync) {
            ledgers = ledgers.filter(l => l.uuid === targetUuid)
        } else {
            ledgers = ledgers.filter(l => !l.isShared)
        }

        const validLedgerIds = new Set(ledgers.map(l => l.id))

        // 建立 UUID 查找表，用於補全所有外鍵 UUID
        const ledgerUuidMap = new Map(ledgers.map(l => [l.id, l.uuid]))

        // Filter all relevant object stores based on validLedgerIds
        const rawRecords = (await this.getRecords({ allLedgers: true })).filter(
            r => validLedgerIds.has(r.ledgerId)
        )
        const rawAccounts = (
            await this.getAccounts({ allLedgers: true })
        ).filter(a => validLedgerIds.has(a.ledgerId))
        const rawContacts = (
            await this.getContacts({ allLedgers: true })
        ).filter(c => validLedgerIds.has(c.ledgerId))
        const rawDebts = (await this.getDebts({ allLedgers: true })).filter(d =>
            validLedgerIds.has(d.ledgerId)
        )
        const recurring_transactions = (
            await this.getRecurringTransactions({ allLedgers: true })
        ).filter(r => validLedgerIds.has(r.ledgerId))
        const amortizations = (
            await this.getAmortizations({ allLedgers: true })
        ).filter(a => validLedgerIds.has(a.ledgerId))
        const credit_statements = (
            await this.getCreditStatements({ allLedgers: true })
        ).filter(s => validLedgerIds.has(s.ledgerId))
        const groupMetaList = (await this.getAllGroupMeta()).filter(g =>
            validLedgerIds.has(g.ledgerId)
        )

        // 建立帳戶/聯絡人/欠款/群組 UUID 查找表
        const accountUuidMap = new Map(rawAccounts.map(a => [a.id, a.uuid]))
        const contactUuidMap = new Map(rawContacts.map(c => [c.id, c.uuid]))
        const debtUuidMap = new Map(rawDebts.map(d => [d.id, d.uuid]))
        const groupUuidMap = new Map(groupMetaList.map(g => [g.id, g.uuid]))

        // 補全所有外鍵 UUID，確保跨裝置同步時能正確對應
        const records = rawRecords.map(r => ({
            ...r,
            ledgerUuid: r.ledgerUuid || ledgerUuidMap.get(r.ledgerId) || null,
            accountUuid:
                r.accountUuid || accountUuidMap.get(r.accountId) || null,
            debtUuid: r.debtUuid || debtUuidMap.get(r.debtId) || null,
            groupUuid: r.groupUuid || groupUuidMap.get(r.groupId) || null,
        }))
        const accounts = rawAccounts.map(a => ({
            ...a,
            ledgerUuid: a.ledgerUuid || ledgerUuidMap.get(a.ledgerId) || null,
        }))
        const contacts = rawContacts.map(c => ({
            ...c,
            ledgerUuid: c.ledgerUuid || ledgerUuidMap.get(c.ledgerId) || null,
        }))
        const debts = rawDebts.map(d => ({
            ...d,
            ledgerUuid: d.ledgerUuid || ledgerUuidMap.get(d.ledgerId) || null,
            contactUuid:
                d.contactUuid || contactUuidMap.get(d.contactId) || null,
        }))

        let customCategories = null
        let categoryOrder = null
        let hiddenCategories = null
        const budgetSettingsMap = {}
        let budgetSettings = null

        if (!isSharedSync) {
            customCategories =
                await this.getCategorySettingsMap('custom_categories')
            categoryOrder = await this.getCategorySettingsMap('category_order')
            hiddenCategories =
                await this.getCategorySettingsMap('hidden_categories')

            let allSettings = []
            if (!this.useLocalStorage && this.db) {
                try {
                    allSettings = await this.db.getAll('settings')
                } catch (e) {
                    console.warn('Failed to get settings from IndexedDB:', e)
                }
            } else {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i)
                    if (
                        k &&
                        (k === 'budget_settings' ||
                            k.startsWith('budget_settings_'))
                    ) {
                        try {
                            const val = JSON.parse(localStorage.getItem(k))
                            allSettings.push({
                                key: k,
                                value:
                                    val?.value !== undefined ? val.value : val,
                            })
                        } catch (_) {}
                    }
                }
            }

            allSettings.forEach(s => {
                if (
                    s.key &&
                    (s.key === 'budget_settings' ||
                        s.key.startsWith('budget_settings_'))
                ) {
                    if (s.key === 'budget_settings') {
                        budgetSettingsMap[s.key] = s.value
                        if (!budgetSettings) budgetSettings = s.value
                    } else {
                        const parts = s.key.split('_')
                        const lId = parseInt(parts[2])
                        if (
                            isNaN(lId) ||
                            validLedgerIds.size === 0 ||
                            validLedgerIds.has(lId)
                        ) {
                            budgetSettingsMap[s.key] = s.value
                        }
                    }
                }
            })

            if (
                !budgetSettings &&
                budgetSettingsMap[`budget_settings_${this.activeLedgerId}`]
            ) {
                budgetSettings =
                    budgetSettingsMap[`budget_settings_${this.activeLedgerId}`]
            }
        }

        const advancedAccountModeEnabled = await this.getSetting(
            'advancedAccountModeEnabled'
        )
        const debtManagementEnabled = await this.getSetting(
            'debtManagementEnabled'
        )
        const groupManagementEnabled = await this.getSetting(
            'groupManagementEnabled'
        )

        return {
            version: '2.3.0',
            exportDate: new Date().toISOString(),
            settings: {
                advancedAccountModeEnabled:
                    advancedAccountModeEnabled?.value || false,
                debtManagementEnabled: debtManagementEnabled?.value || false,
                groupManagementEnabled: groupManagementEnabled?.value || false,
            },
            activeLedgerId: this.activeLedgerId,
            ledgers,
            accounts,
            records,
            contacts,
            debts,
            recurring_transactions,
            amortizations,
            credit_statements,
            groupMeta: groupMetaList,
            ...(isSharedSync
                ? {}
                : {
                      customCategories,
                      categoryOrder,
                      hiddenCategories,
                      budgetSettingsMap,
                      budgetSettings,
                  }),
            metadata: {
                totalRecords: records.length,
                totalContacts: contacts.length,
                totalDebts: debts.length,
                totalLedgers: ledgers.length,
            },
        }
    }

    // --- Category Settings Methods (per-ledger) ---
    /**
     * 批次取得所有帳本的分類設定（用於匯出）
     * Returns { [ledgerId]: value } map
     */
    async getCategorySettingsMap(baseKey = 'custom_categories') {
        const ledgers = await this.getLedgers()
        const result = {}

        for (const ledger of ledgers) {
            const val = await this.getCategorySetting(baseKey, ledger.id)
            if (val && val.value !== undefined) {
                result[ledger.id] = val.value
            }
        }

        // Also check legacy global key as fallback for ledger 1
        if (!result[ledgers[0]?.id]) {
            const globalVal = await this.getSetting(baseKey)
            if (globalVal && globalVal.value !== undefined) {
                result[ledgers[0].id] = globalVal.value
            }
        }

        return Object.keys(result).length > 0 ? result : null
    }

    /**
     * 取得指定帳本的分類設定（custom_categories / category_order / hidden_categories）
     * Key 格式: `${key}_${ledgerId}`
     * 如果 per-ledger 不存在，會嘗試從全域 key 遷移一次
     */
    async getCategorySetting(key, ledgerId = null) {
        const targetLedgerId = ledgerId ?? this.activeLedgerId
        const scopedKey = `${key}_${targetLedgerId}`

        if (this.useLocalStorage) {
            let val = JSON.parse(localStorage.getItem(scopedKey) || 'null')
            // Migration: 如果 per-ledger key 不存在，從全域 key 遷移
            if (!val) {
                const globalVal = JSON.parse(
                    localStorage.getItem(key) || 'null'
                )
                if (globalVal) {
                    localStorage.setItem(scopedKey, JSON.stringify(globalVal))
                    val = globalVal
                }
            }
            return val
        }

        try {
            let val = await this.db.get('settings', scopedKey)
            // Migration: 如果 per-ledger key 不存在，從全域 key 遷移
            if (!val) {
                const globalVal = await this.db.get('settings', key)
                if (globalVal) {
                    await this.db.put('settings', {
                        ...globalVal,
                        key: scopedKey,
                    })
                    val = globalVal
                }
            }
            return val
        } catch (error) {
            console.error(
                `Failed to get category setting '${scopedKey}':`,
                error
            )
            return null
        }
    }

    /**
     * 儲存指定帳本的分類設定
     */
    async saveCategorySetting(key, value, ledgerId = null) {
        const targetLedgerId = ledgerId ?? this.activeLedgerId
        const scopedKey = `${key}_${targetLedgerId}`
        return await this.saveSetting({ key: scopedKey, value })
    }

    // --- Settings Methods ---
    async getSetting(key) {
        if (this.useLocalStorage) {
            return JSON.parse(localStorage.getItem(key) || 'null')
        }
        try {
            return await this.db.get('settings', key)
        } catch (error) {
            console.error(`Failed to get setting '${key}':`, error)
            return null
        }
    }

    async saveSetting(setting) {
        if (this.useLocalStorage) {
            localStorage.setItem(setting.key, JSON.stringify(setting))
            return
        }
        try {
            const tx = this.db.transaction('settings', 'readwrite')
            await tx.store.put(setting)
            await tx.done
        } catch (error) {
            console.error(`Failed to save setting '${setting.key}':`, error)
            throw error
        }
    }

    // --- Account Methods ---
    async addAccount(account, skipLog = false) {
        try {
            if (!account.uuid) account.uuid = this.generateUUID()
            // 同步接收路徑：移除來源裝置的 integer id，讓 IndexedDB 自動產生新 id
            const { id: _rid, ...accountWithoutId } = account
            const dataToAdd = skipLog ? accountWithoutId : account
            dataToAdd.ledgerId = dataToAdd.ledgerId ?? this.activeLedgerId
            // 信用卡欄位預設值
            if (!dataToAdd.type) dataToAdd.type = 'wallet'
            if (dataToAdd.type === 'credit_card') {
                if (dataToAdd.creditLimit === undefined)
                    dataToAdd.creditLimit = 0
                if (dataToAdd.statementDay === undefined)
                    dataToAdd.statementDay = 25
                if (dataToAdd.dueDay === undefined) dataToAdd.dueDay = 15
            }
            const tx = this.db.transaction('accounts', 'readwrite')
            const id = await tx.store.add(dataToAdd)
            await tx.done
            if (!skipLog)
                await this.logChange('add', 'accounts', id, {
                    ...dataToAdd,
                    id,
                })
            return id
        } catch (error) {
            console.error('Failed to add account:', error)
            throw error
        }
    }

    async getAccount(id) {
        try {
            return await this.db.get('accounts', id)
        } catch (error) {
            console.error(`Failed to get account ${id}:`, error)
            return null
        }
    }

    async getAccounts(filters = {}) {
        try {
            let accounts = await this.db.getAll('accounts')
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                accounts = accounts.filter(a => a.ledgerId === targetLedgerId)
            }
            return accounts
        } catch (error) {
            console.error('Failed to get accounts:', error)
            return []
        }
    }

    async updateAccount(id, updates, skipLog = false) {
        try {
            const tx = this.db.transaction('accounts', 'readwrite')
            const account = await tx.store.get(id)
            if (account) {
                const finalUpdates = { ...updates }
                if (skipLog) {
                    delete finalUpdates.id
                    if (account.uuid) finalUpdates.uuid = account.uuid
                }
                const updatedAccount = { ...account, ...finalUpdates }
                await tx.store.put(updatedAccount)
                await tx.done
                if (!skipLog)
                    await this.logChange(
                        'update',
                        'accounts',
                        id,
                        updatedAccount
                    )
                return updatedAccount
            }
            throw new Error('Account not found')
        } catch (error) {
            console.error(`Failed to update account ${id}:`, error)
            throw error
        }
    }

    async deleteAccount(id, skipLog = false) {
        try {
            const tx = this.db.transaction(
                ['accounts', 'credit_statements'],
                'readwrite'
            )
            const accStore = tx.objectStore('accounts')
            const stmtStore = tx.objectStore('credit_statements')

            let itemData = null
            if (!skipLog) {
                itemData = await accStore.get(id)
            }

            // 1. 刪除帳戶本身
            await accStore.delete(id)

            // 2. 蒐集需要刪除的帳單元數據，並在事務中刪除它們
            const deletedStatements = []
            if (stmtStore.indexNames.contains('accountId')) {
                const index = stmtStore.index('accountId')
                let cursor = await index.openCursor(IDBKeyRange.only(id))
                while (cursor) {
                    const stmtData = cursor.value
                    if (stmtData) {
                        deletedStatements.push({
                            id: stmtData.id,
                            uuid: stmtData.uuid,
                            ledgerId: stmtData.ledgerId,
                        })
                    }
                    await cursor.delete()
                    cursor = await cursor.continue()
                }
            }

            // 3. 提交事務
            await tx.done

            // 4. 事務提交後，記錄變更日誌
            if (!skipLog) {
                if (itemData) {
                    await this.logChange('delete', 'accounts', id, {
                        uuid: itemData.uuid,
                        ledgerId: itemData.ledgerId,
                        name: itemData.name,
                    })
                }
                for (const stmt of deletedStatements) {
                    await this.logChange(
                        'delete',
                        'credit_statements',
                        stmt.id,
                        { uuid: stmt.uuid, ledgerId: stmt.ledgerId }
                    )
                }
            }
            return true
        } catch (error) {
            console.error(`Failed to delete account ${id}:`, error)
            throw error
        }
    }

    /**
     * 自動清理並合併資料庫中重複的帳戶（同帳本且同名稱）
     * 將所有關聯的 records, debts, recurring_transactions, amortizations, credit_statements 轉移至主帳戶，
     * 並安全刪除冗餘的同名帳戶。
     * @returns {Promise<{ mergedCount: number, groupsProcessed: number }>}
     */
    async deduplicateAccounts() {
        if (!this.db || this.useLocalStorage) {
            return { mergedCount: 0, groupsProcessed: 0 }
        }
        try {
            const allAccounts = await this.getAccounts({ allLedgers: true })
            if (!allAccounts || allAccounts.length <= 1) {
                return { mergedCount: 0, groupsProcessed: 0 }
            }

            // 分組：依 ledgerId + ':::' + name.trim().toLowerCase()
            const groups = new Map()
            for (const acc of allAccounts) {
                const normName = (acc.name || '').trim().toLowerCase()
                if (!normName) continue
                const key = `${acc.ledgerId || 1}:::${normName}`
                if (!groups.has(key)) {
                    groups.set(key, [])
                }
                groups.get(key).push(acc)
            }

            const duplicateGroups = [...groups.values()].filter(
                g => g.length > 1
            )
            if (duplicateGroups.length === 0) {
                return { mergedCount: 0, groupsProcessed: 0 }
            }

            const allRecords = await this.getRecords({ allLedgers: true })
            const allDebts = await this.getDebts({ allLedgers: true })
            const allRecurring = await this.getRecurringTransactions({
                allLedgers: true,
            })
            const allAmortizations = await this.getAmortizations({
                allLedgers: true,
            })
            const allStatements = await this.getCreditStatements({
                allLedgers: true,
            })

            // 統計各 accountId 的關聯紀錄數量
            const recordCountMap = new Map()
            for (const r of allRecords) {
                if (r.accountId != null) {
                    recordCountMap.set(
                        r.accountId,
                        (recordCountMap.get(r.accountId) || 0) + 1
                    )
                }
            }
            const debtCountMap = new Map()
            for (const d of allDebts) {
                if (d.accountId != null) {
                    debtCountMap.set(
                        d.accountId,
                        (debtCountMap.get(d.accountId) || 0) + 1
                    )
                }
            }

            let mergedCount = 0

            for (const group of duplicateGroups) {
                // 評分排序：record 權重 10，debt 權重 5
                group.sort((a, b) => {
                    const scoreA =
                        (recordCountMap.get(a.id) || 0) * 10 +
                        (debtCountMap.get(a.id) || 0) * 5
                    const scoreB =
                        (recordCountMap.get(b.id) || 0) * 10 +
                        (debtCountMap.get(b.id) || 0) * 5
                    if (scoreB !== scoreA) return scoreB - scoreA
                    const uuidA = a.uuid ? 1 : 0
                    const uuidB = b.uuid ? 1 : 0
                    if (uuidB !== uuidA) return uuidB - uuidA
                    const balA = Math.abs(a.balance || 0)
                    const balB = Math.abs(b.balance || 0)
                    if (balB !== balA) return balB - balA
                    return (a.id || 0) - (b.id || 0)
                })

                const primary = group[0]
                const redundants = group.slice(1)

                // 若主帳戶初始餘額為 0，而冗餘帳戶有非零餘額，繼承之
                if (
                    (!primary.balance || primary.balance === 0) &&
                    redundants.some(r => r.balance)
                ) {
                    const foundBal = redundants.find(r => r.balance)?.balance
                    if (foundBal !== undefined) {
                        await this.updateAccount(
                            primary.id,
                            { balance: foundBal },
                            true
                        )
                        primary.balance = foundBal
                    }
                }

                // 批次轉移關聯資料
                for (const redundant of redundants) {
                    const redId = redundant.id

                    // 1. 轉移 records
                    const recordsToUpdate = allRecords.filter(
                        r => r.accountId === redId
                    )
                    for (const rec of recordsToUpdate) {
                        await this.updateRecord(
                            rec.id,
                            {
                                accountId: primary.id,
                                accountUuid: primary.uuid || null,
                            },
                            true
                        )
                        rec.accountId = primary.id
                        rec.accountUuid = primary.uuid || null
                    }

                    // 2. 轉移 debts
                    const debtsToUpdate = allDebts.filter(
                        d => d.accountId === redId
                    )
                    for (const debt of debtsToUpdate) {
                        await this.updateDebt(
                            debt.id,
                            {
                                accountId: primary.id,
                            },
                            true
                        )
                        debt.accountId = primary.id
                    }

                    // 3. 轉移 recurring_transactions
                    const recurringsToUpdate = allRecurring.filter(
                        rt => rt.accountId === redId
                    )
                    for (const rt of recurringsToUpdate) {
                        await this.updateRecurringTransaction(
                            rt.id,
                            {
                                accountId: primary.id,
                                accountUuid: primary.uuid || null,
                            },
                            true
                        )
                        rt.accountId = primary.id
                        rt.accountUuid = primary.uuid || null
                    }

                    // 4. 轉移 amortizations
                    const amortizationsToUpdate = allAmortizations.filter(
                        am => am.accountId === redId
                    )
                    for (const am of amortizationsToUpdate) {
                        await this.updateAmortization(
                            am.id,
                            {
                                accountId: primary.id,
                                accountUuid: primary.uuid || null,
                            },
                            true
                        )
                        am.accountId = primary.id
                        am.accountUuid = primary.uuid || null
                    }

                    // 5. 轉移 credit_statements
                    const stmtsToUpdate = allStatements.filter(
                        s => s.accountId === redId
                    )
                    for (const stmt of stmtsToUpdate) {
                        await this.updateCreditStatement(
                            stmt.id,
                            {
                                accountId: primary.id,
                            },
                            true
                        )
                        stmt.accountId = primary.id
                    }

                    // 6. 轉移 其他帳戶的 autoPayAccountId
                    for (const acc of allAccounts) {
                        if (acc.autoPayAccountId === redId) {
                            await this.updateAccount(
                                acc.id,
                                {
                                    autoPayAccountId: primary.id,
                                },
                                true
                            )
                            acc.autoPayAccountId = primary.id
                        }
                    }

                    // 7. 刪除冗餘帳戶 (帶 skipLog = true)
                    await this.deleteAccount(redId, true)
                    mergedCount++
                }
            }

            console.log(
                `[DataService] deduplicateAccounts: 合併了 ${mergedCount} 個重複帳戶`
            )
            await this.deduplicateCreditCardPayments()
            return { mergedCount, groupsProcessed: duplicateGroups.length }
        } catch (error) {
            console.error('[DataService] deduplicateAccounts error:', error)
            return { mergedCount: 0, groupsProcessed: 0, error }
        }
    }

    /**
     * 清理重複的卡費扣繳記錄 (防禦歷史 autoPay 重複生成的扣繳記錄)
     */
    async deduplicateCreditCardPayments() {
        if (!this.db || this.useLocalStorage) return
        try {
            const records = await this.db.getAll('records')
            const seen = new Set()
            let removedCount = 0

            for (const r of records) {
                if (r.description && r.description.startsWith('[卡費扣繳]')) {
                    const key = [
                        r.accountId,
                        r.type,
                        r.date,
                        r.description,
                        r.amount,
                    ].join('|')
                    if (seen.has(key)) {
                        await this.deleteRecord(r.id)
                        removedCount++
                    } else {
                        seen.add(key)
                    }
                }
            }
            if (removedCount > 0) {
                console.log(
                    `[DataService] deduplicateCreditCardPayments: 清理了 ${removedCount} 筆重複的卡費扣繳記錄`
                )
            }
        } catch (err) {
            console.warn(
                '[DataService] deduplicateCreditCardPayments failed:',
                err
            )
        }
    }

    /**
     * 全域聯絡人自動去重與關聯安全移轉（Contact Deduplication）
     * 掃描所有帳本中的同名聯絡人，智慧評估關聯活躍度選出主聯絡人，
     * 將所有關聯的 debts (欠款) 與 records (記帳明細) 安全移轉至主聯絡人，
     * 並安全刪除冗餘的同名聯絡人。
     * @returns {Promise<{ mergedCount: number, groupsProcessed: number }>}
     */
    async deduplicateContacts() {
        if (!this.db || this.useLocalStorage) {
            return { mergedCount: 0, groupsProcessed: 0 }
        }
        try {
            const allContacts = await this.getContacts({ allLedgers: true })
            if (!allContacts || allContacts.length <= 1) {
                return { mergedCount: 0, groupsProcessed: 0 }
            }

            // 分組：依 (contact.ledgerId || 1) + ':::' + normName
            const groups = new Map()
            for (const contact of allContacts) {
                const normName = (contact.name || '').trim().toLowerCase()
                if (!normName) continue
                const key = `${contact.ledgerId || 1}:::${normName}`
                if (!groups.has(key)) {
                    groups.set(key, [])
                }
                groups.get(key).push(contact)
            }

            const duplicateGroups = [...groups.values()].filter(
                g => g.length > 1
            )
            if (duplicateGroups.length === 0) {
                return { mergedCount: 0, groupsProcessed: 0 }
            }

            const allDebts = await this.getDebts({ allLedgers: true })
            const allRecords = await this.getRecords({ allLedgers: true })

            // 統計各 contactId 的關聯紀錄數量
            const debtCountMap = new Map()
            for (const d of allDebts) {
                if (d.contactId != null) {
                    debtCountMap.set(
                        d.contactId,
                        (debtCountMap.get(d.contactId) || 0) + 1
                    )
                }
            }
            const recordCountMap = new Map()
            for (const r of allRecords) {
                if (r.contactId != null) {
                    recordCountMap.set(
                        r.contactId,
                        (recordCountMap.get(r.contactId) || 0) + 1
                    )
                }
            }

            let mergedCount = 0

            for (const group of duplicateGroups) {
                // 評分排序：debt 權重 10，record 權重 5，有頭像優先，有 UUID 優先，建立時間早（ID小）優先
                group.sort((a, b) => {
                    const scoreA =
                        (debtCountMap.get(a.id) || 0) * 10 +
                        (recordCountMap.get(a.id) || 0) * 5
                    const scoreB =
                        (debtCountMap.get(b.id) || 0) * 10 +
                        (recordCountMap.get(b.id) || 0) * 5
                    if (scoreB !== scoreA) return scoreB - scoreA
                    const avatarA = a.avatarFileId ? 1 : 0
                    const avatarB = b.avatarFileId ? 1 : 0
                    if (avatarB !== avatarA) return avatarB - avatarA
                    const uuidA = a.uuid ? 1 : 0
                    const uuidB = b.uuid ? 1 : 0
                    if (uuidB !== uuidA) return uuidB - uuidA
                    return (a.id || 0) - (b.id || 0)
                })

                const primary = group[0]
                const redundants = group.slice(1)

                // 若主聯絡人無頭像，冗餘聯絡人有頭像，繼承之
                if (
                    !primary.avatarFileId &&
                    redundants.some(r => r.avatarFileId)
                ) {
                    const foundAvatar = redundants.find(
                        r => r.avatarFileId
                    )?.avatarFileId
                    if (foundAvatar) {
                        await this.updateContact(
                            primary.id,
                            { avatarFileId: foundAvatar },
                            true
                        )
                        primary.avatarFileId = foundAvatar
                    }
                }

                // 批次轉移關聯資料
                for (const redundant of redundants) {
                    const redId = redundant.id

                    // 1. 轉移 debts
                    const debtsToUpdate = allDebts.filter(
                        d => d.contactId === redId
                    )
                    for (const debt of debtsToUpdate) {
                        await this.updateDebt(
                            debt.id,
                            {
                                contactId: primary.id,
                                contactUuid: primary.uuid || null,
                            },
                            true
                        )
                        debt.contactId = primary.id
                        debt.contactUuid = primary.uuid || null
                    }

                    // 2. 轉移 records (例如群組分帳或欠款紀錄的 contactId)
                    const recordsToUpdate = allRecords.filter(
                        r => r.contactId === redId
                    )
                    for (const rec of recordsToUpdate) {
                        await this.updateRecord(
                            rec.id,
                            {
                                contactId: primary.id,
                            },
                            true
                        )
                        rec.contactId = primary.id
                    }

                    // 3. 刪除冗餘聯絡人 (帶 skipLog = true 避免產生刪除日誌)
                    await this.deleteContact(redId, true)
                    mergedCount++
                }
            }

            console.log(
                `[DataService] deduplicateContacts: 合併了 ${mergedCount} 個重複聯絡人`
            )
            return { mergedCount, groupsProcessed: duplicateGroups.length }
        } catch (error) {
            console.error('[DataService] deduplicateContacts error:', error)
            return { mergedCount: 0, groupsProcessed: 0, error }
        }
    }

    /**
     * 主動對齊帳戶 UUID（UUID Alignment），並同步更新關聯 records, recurring_transactions, amortizations 的 accountUuid
     * @param {number} accountId
     * @param {string} targetUuid
     * @param {string|null} [oldUuid=null]
     */
    async alignAccountUuid(accountId, targetUuid, oldUuid = null) {
        if (!this.db || this.useLocalStorage || !accountId || !targetUuid)
            return
        try {
            const tx = this.db.transaction('accounts', 'readwrite')
            const store = tx.objectStore('accounts')
            const acc = await store.get(accountId)
            if (!acc) return
            const actualOldUuid = oldUuid || acc.uuid || null
            if (acc.uuid === targetUuid) return // 已經一致

            acc.uuid = targetUuid
            await store.put(acc)
            await tx.done

            // 批次對齊關聯 records
            const records = await this.getRecords({ allLedgers: true })
            for (const r of records) {
                if (
                    r.accountId === accountId ||
                    (actualOldUuid && r.accountUuid === actualOldUuid)
                ) {
                    if (r.accountUuid !== targetUuid) {
                        await this.updateRecord(
                            r.id,
                            { accountUuid: targetUuid },
                            true
                        )
                    }
                }
            }

            // 批次對齊關聯 recurring_transactions
            const recurringTxs = await this.getRecurringTransactions({
                allLedgers: true,
            })
            for (const rt of recurringTxs) {
                if (
                    rt.accountId === accountId ||
                    (actualOldUuid && rt.accountUuid === actualOldUuid)
                ) {
                    if (rt.accountUuid !== targetUuid) {
                        await this.updateRecurringTransaction(
                            rt.id,
                            { accountUuid: targetUuid },
                            true
                        )
                    }
                }
            }

            // 批次對齊關聯 amortizations
            const amortizations = await this.getAmortizations({
                allLedgers: true,
            })
            for (const am of amortizations) {
                if (
                    am.accountId === accountId ||
                    (actualOldUuid && am.accountUuid === actualOldUuid)
                ) {
                    if (am.accountUuid !== targetUuid) {
                        await this.updateAmortization(
                            am.id,
                            { accountUuid: targetUuid },
                            true
                        )
                    }
                }
            }
        } catch (error) {
            console.error('[DataService] alignAccountUuid error:', error)
        }
    }

    /**
     * 主動對齊聯絡人 UUID（UUID Alignment），並同步更新關聯 debts 的 contactUuid
     * @param {number} contactId
     * @param {string} targetUuid
     * @param {string|null} [oldUuid=null]
     */
    async alignContactUuid(contactId, targetUuid, oldUuid = null) {
        if (!this.db || this.useLocalStorage || !contactId || !targetUuid)
            return
        try {
            const tx = this.db.transaction('contacts', 'readwrite')
            const store = tx.objectStore('contacts')
            const contact = await store.get(contactId)
            if (!contact) return
            const actualOldUuid = oldUuid || contact.uuid || null
            if (contact.uuid === targetUuid) return // 已經一致

            contact.uuid = targetUuid
            await store.put(contact)
            await tx.done

            // 批次對齊關聯 debts
            const debts = await this.getDebts({ allLedgers: true })
            for (const d of debts) {
                if (
                    d.contactId === contactId ||
                    (actualOldUuid && d.contactUuid === actualOldUuid)
                ) {
                    if (d.contactUuid !== targetUuid) {
                        await this.updateDebt(
                            d.id,
                            { contactUuid: targetUuid },
                            true
                        )
                    }
                }
            }
        } catch (error) {
            console.error('[DataService] alignContactUuid error:', error)
        }
    }

    /**
     * 主動對齊週期交易 UUID（UUID Alignment）
     * @param {number} rtId
     * @param {string} targetUuid
     */
    async alignRecurringTransactionUuid(rtId, targetUuid) {
        if (!this.db || this.useLocalStorage || !rtId || !targetUuid) return
        try {
            const tx = this.db.transaction(
                'recurring_transactions',
                'readwrite'
            )
            const store = tx.objectStore('recurring_transactions')
            const rt = await store.get(rtId)
            if (!rt) return
            if (rt.uuid === targetUuid) return
            rt.uuid = targetUuid
            await store.put(rt)
            await tx.done
        } catch (error) {
            console.error(
                '[DataService] alignRecurringTransactionUuid error:',
                error
            )
        }
    }

    // 清除所有信用卡帳單
    async clearAllCreditStatements() {
        if (!this.db && !this.useLocalStorage) {
            await this.init()
        }
        if (!this.db) return true
        try {
            const tx = this.db.transaction('credit_statements', 'readwrite')
            await tx.store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('Failed to clear credit statements:', error)
            throw error
        }
    }

    // --- Credit Card Statement Methods ---
    // 信用卡帳單為各裝置本機由 records/accounts 自動運算產物，不寫入 sync_log，避免多裝置獨立生成衝突與雙重扣款
    async addCreditStatement(stmt, skipLog = false) {
        try {
            if (!stmt.uuid) stmt.uuid = this.generateUUID()
            const dataToSave = {
                ...stmt,
                ledgerId: stmt.ledgerId ?? this.activeLedgerId,
            }
            if (skipLog) delete dataToSave.id
            const tx = this.db.transaction('credit_statements', 'readwrite')
            const id = await tx.store.add(dataToSave)
            await tx.done
            return id
        } catch (error) {
            console.error('Failed to add credit statement:', error)
            throw error
        }
    }

    async getCreditStatement(id) {
        try {
            return await this.db.get('credit_statements', id)
        } catch (error) {
            console.error(`Failed to get credit statement ${id}:`, error)
            return null
        }
    }

    async getCreditStatements(filters = {}) {
        try {
            let statements = await this.db.getAll('credit_statements')
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                statements = statements.filter(
                    s => s.ledgerId === targetLedgerId
                )
            }
            if (filters.accountId) {
                statements = statements.filter(
                    s => s.accountId === filters.accountId
                )
            }
            if (filters.status) {
                statements = statements.filter(s => s.status === filters.status)
            }
            if (filters.period) {
                statements = statements.filter(s => s.period === filters.period)
            }
            return statements
        } catch (error) {
            console.error('Failed to get credit statements:', error)
            return []
        }
    }

    async updateCreditStatement(id, updates, skipLog = false) {
        try {
            const tx = this.db.transaction('credit_statements', 'readwrite')
            const stmt = await tx.store.get(id)
            if (stmt) {
                const finalUpdates = { ...updates }
                if (skipLog) {
                    delete finalUpdates.id
                    if (stmt.uuid) finalUpdates.uuid = stmt.uuid
                }
                const updated = { ...stmt, ...finalUpdates }
                await tx.store.put(updated)
                await tx.done
                return updated
            }
            throw new Error('Credit statement not found')
        } catch (error) {
            console.error(`Failed to update credit statement ${id}:`, error)
            throw error
        }
    }

    async deleteCreditStatement(id, _skipLog = false) {
        try {
            const tx = this.db.transaction('credit_statements', 'readwrite')
            await tx.store.delete(id)
            await tx.done
            return true
        } catch (error) {
            console.error(`Failed to delete credit statement ${id}:`, error)
            throw error
        }
    }

    // --- Credit Card Balance Calculation ---
    /**
     * 計算信用卡本期欠款（效能優化版：只查詢相關帳戶的記錄）
     * @param {number} accountId - 信用卡帳戶 ID
     * @param {Date} startDate - 帳單週期開始日
     * @param {Date} endDate - 帳單週期結束日
    /**
     * 取得交易日期所屬的自然帳單期別
     * @param {object} account - 信用卡帳戶物件
     * @param {string} dateStr - 交易日期 (YYYY-MM-DD)
     * @returns {string} 帳單期別 (如 '2026-09')
     */
    getNaturalStatementPeriod(account, dateStr) {
        if (!account || !dateStr) return ''
        const statementDay = account.statementDay || 25
        const [y, m, d] = dateStr.split('-').map(Number)
        let targetYear = y
        let targetMonth = m
        if (d <= statementDay) {
            targetMonth = m - 1
            if (targetMonth <= 0) {
                targetMonth = 12
                targetYear -= 1
            }
        }
        return `${targetYear}-${String(targetMonth).padStart(2, '0')}`
    }

    /**
     * 取得下一個帳單期別
     * @param {string} period - 當前帳單期別 (YYYY-MM)
     * @returns {string}
     */
    getNextPeriod(period) {
        if (!period) return ''
        let [y, m] = period.split('-').map(Number)
        m += 1
        if (m > 12) {
            m = 1
            y += 1
        }
        return `${y}-${String(m).padStart(2, '0')}`
    }

    /**
     * 取得上一個帳單期別
     * @param {string} period - 當前帳單期別 (YYYY-MM)
     * @returns {string}
     */
    getPreviousPeriod(period) {
        if (!period) return ''
        let [y, m] = period.split('-').map(Number)
        m -= 1
        if (m < 1) {
            m = 12
            y -= 1
        }
        return `${y}-${String(m).padStart(2, '0')}`
    }

    /**
     * 計算信用卡特定期間的消費與還款金額
     * @param {number} accountId - 信用卡帳戶 ID
     * @param {Date} [startDate] - 開始日期
     * @param {Date} [endDate] - 結束日期
     * @param {string} [targetPeriod] - 指定帳單期別 (如 '2026-09')
     * @returns {Promise<{ totalExpense: number, totalRepayment: number, currentBalance: number, availableCredit: number, creditLimit: number, recordCount: number }>}
     */
    async calculateCreditCardBalance(
        accountId,
        startDate,
        endDate,
        targetPeriod = null
    ) {
        const account =
            typeof accountId === 'object' && accountId !== null
                ? accountId
                : await this.getAccount(accountId)
        if (!account || account.type !== 'credit_card') {
            return {
                totalExpense: 0,
                totalRepayment: 0,
                currentBalance: 0,
                availableCredit: 0,
                creditLimit: 0,
                recordCount: 0,
            }
        }

        // 支援 (accountId, 'YYYY-MM') 簡寫調用
        if (
            typeof startDate === 'string' &&
            !endDate &&
            !targetPeriod &&
            /^\d{4}-\d{2}$/.test(startDate)
        ) {
            targetPeriod = startDate
            startDate = null
        }

        // 只查詢該帳戶的記錄，避免載入全部 records
        const records = await this.db.getAllFromIndex(
            'records',
            'accountId',
            account.id
        )

        // 轉為字串 YYYY-MM-DD 比較以不受時區解析影響
        const toDateStr = d => {
            if (!d) return null
            if (typeof d?.getFullYear === 'function') {
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            }
            return String(d)
        }
        const period =
            targetPeriod ||
            (endDate
                ? this.getNaturalStatementPeriod(account, toDateStr(endDate))
                : null)
        const startStr = startDate ? toDateStr(startDate) : null
        const endStr = endDate ? toDateStr(endDate) : null

        const periodRecords = records.filter(r => {
            // 排除卡費還款/扣繳/平帳紀錄（還款不屬於當期消費明細，不可扣減新一期消費出帳金額）
            if (
                r.category === 'debt_repayment' ||
                r.category === 'transfer' ||
                r.category === 'balance_adjustment' ||
                r.description?.startsWith('[卡費扣繳]') ||
                r.description?.startsWith('[自動扣款]')
            ) {
                return false
            }

            if (period) {
                const rPeriod =
                    r.statementPeriod ||
                    this.getNaturalStatementPeriod(account, r.date)
                return rPeriod === period
            } else if (startStr && endStr) {
                return r.date >= startStr && r.date <= endStr
            }
            return true
        })

        let totalExpense = 0
        let totalRepayment = 0

        for (const record of periodRecords) {
            // 信用卡消費：type='expense' 且 account 為該信用卡
            if (record.type === 'expense') {
                totalExpense += record.amount
            }
            // 商家退款/刷退：type='income' 且為一般非還款分類
            else if (record.type === 'income') {
                totalRepayment += record.amount
            }
        }

        const currentBalance = Math.max(0, totalExpense - totalRepayment)
        const creditLimit = account.creditLimit || 0
        const availableCredit = Math.max(0, creditLimit - currentBalance)

        return {
            totalExpense,
            totalRepayment,
            currentBalance,
            availableCredit,
            creditLimit,
            recordCount: periodRecords.length,
        }
    }

    /**
     * 計算帳戶「目前餘額」（單一真相源）。
     *
     * 語意與 accountsPage 的顯示一致：
     *  - currentBalance = 初始餘額 + 該帳戶所有記錄的淨現金流
     *    （income 記正、其他記負）。
     *  - 信用卡的「欠款」= max(0, -currentBalance)（負值代表額度佔用），
     *    此方法回傳原始淨現金流，由呼叫端決定解讀方式。
     *  - 「我欠別人」(payable) 欠款的原始紀錄不計入餘額（建立欠款當下不扣款，
     *    還款時才扣），排除規則：debtId 存在、屬 payable 欠款、且
     *    category 不是 debt_repayment。
     *
     * @param {number} accountId - 帳戶 ID
     * @returns {Promise<number>} 帳戶目前餘額（找不到帳戶時回傳 0）
     */
    async calculateAccountCurrentBalance(accountId) {
        const account = await this.getAccount(accountId)
        if (!account) return 0
        // 初始餘額（一般帳戶與信用卡皆以此為起點）
        let balance =
            typeof account.balance === 'number' ? account.balance : 0
        // 該帳戶所有記錄（效能：走 accountId index，避免載入全部 records）
        // 注意：index 查詢不分帳本，需手動補 activeLedgerId 過濾（與本類別其他方法一致）
        let records
        try {
            const targetLedgerId = this.activeLedgerId
            const all = await this.db.getAllFromIndex(
                'records',
                'accountId',
                accountId
            )
            records = all.filter(r => r.ledgerId === targetLedgerId)
        } catch (_) {
            records = []
        }
        // 「我欠別人」(payable) 欠款 id 集合，用於排除其原始欠款紀錄
        let debts
        try {
            debts = await this.getDebts()
        } catch (_) {
            debts = []
        }
        const payableDebtIds = new Set(
            debts.filter(d => d.type === 'payable').map(d => String(d.id))
        )
        for (const r of records) {
            if (
                r.debtId !== null &&
                r.debtId !== undefined &&
                payableDebtIds.has(String(r.debtId)) &&
                r.category !== 'debt_repayment'
            ) {
                continue // 排除 payable 欠款的原始紀錄
            }
            balance += r.type === 'income' ? r.amount || 0 : -(r.amount || 0)
        }
        return balance
    }

    /**
     * 取得信用卡帳單週期的開始和結束日期
     * @param {object} account - 信用卡帳戶物件
     * @param {string} period - 帳單期間 (格式: 'YYYY-MM')
     * @returns {{ startDate: Date, endDate: Date }}
     */
    getStatementPeriod(account, period) {
        const [year, month] = period.split('-').map(Number)
        const rawStatementDay = account.statementDay || 25

        // 月底收斂：statementDay 可設 1-31，但非每月都有該日（如 2 月遇 31 日）。
        // 直接 new Date() 會溢出到下月（2026-02-31 → 3/3）並讓整期週期錯亂，
        // 故起訖日各自收斂到該月最後一天（與 calendarCashFlow 繳款圓點同款慣例）。
        // period 'YYYY-MM' 的約定：起 = period 當月的 (出帳日隔天)，訖 = 下個月的出帳日。
        const startMonthDay = clampDayToMonth(
            year,
            month - 1,
            rawStatementDay,
            25
        )
        const startDate = new Date(year, month - 1, startMonthDay)
        startDate.setDate(startDate.getDate() + 1) // 上期結帳日隔天（跨月自動進位）
        // 到下個月的帳單日
        const endMonthDay = clampDayToMonth(year, month, rawStatementDay, 25)
        const endDate = new Date(year, month, endMonthDay)

        return { startDate, endDate }
    }

    /**
     * 自動產生信用卡帳單（每月執行）
     */
    async autoGenerateCreditStatements() {
        const accounts = await this.getAccounts({ allLedgers: true })
        const creditCards = accounts.filter(a => a.type === 'credit_card')

        for (const card of creditCards) {
            const now = new Date()
            const statementDay = card.statementDay || 25
            const dueDay = card.dueDay || 15
            // 比較基準同步收斂：31 日出帳遇小月（如 2 月）時，以該月月底日為準，
            // 讓「今天是否已過結帳日」的判斷與 getStatementPeriod 的收斂週期一致
            const effectiveStatementDay = clampDayToMonth(
                now.getFullYear(),
                now.getMonth(),
                statementDay,
                25
            )

            let targetYear = now.getFullYear()
            let targetMonth = now.getMonth() + 1 // 1-indexed

            // 原代碼 getStatementPeriod 的期別約定：
            // 'YYYY-MM' 的結束日是下個月的 statementDay (例如 '2026-05' 的結束日是 6月25日)
            // 如果今天是 6月28日，大於 25日，代表最近已結帳的期別是 '2026-05' (5/26 ~ 6/25)
            // 如果今天是 6月20日，小於 25日，代表最近已結帳的期別是 '2026-04' (4/26 ~ 5/25)
            if (now.getDate() >= effectiveStatementDay) {
                targetMonth -= 1
            } else {
                targetMonth -= 2
            }

            if (targetMonth <= 0) {
                targetMonth += 12
                targetYear -= 1
            }

            const targetPeriod = `${targetYear}-${String(targetMonth).padStart(2, '0')}`

            // 漏期補生成：舊版每輪只產生「最近一期已結帳帳單」，用戶若長時間
            // 未打開 app（例如出差兩個月），中間已結帳的期別會被永久漏掉——
            // 該期消費不會出帳、不會被自動扣繳，與真實信用卡帳單語意不符。
            // 修正：自本卡最新既有帳單期的下一期起，逐期補到 targetPeriod；
            // 完全無帳單的卡（新卡/剛清除）只補最近一期，維持既有「不回填全部
            // 歷史」語意，避免新卡一次生成一整年虛假帳單。
            const existingStmts = await this.getCreditStatements({
                accountId: card.id,
                allLedgers: true,
            })
            // 既有帳單期集合：一次載入取代逐期查 DB（補生成最多 24 期，避免 N 次 getAll）
            const existingPeriods = new Set(
                existingStmts.map(s => s.period)
            )
            let startPeriod = targetPeriod
            const validPeriods = existingStmts
                .map(s => s.period)
                .filter(p => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p))
            if (validPeriods.length > 0) {
                const latestPeriod = validPeriods.sort().at(-1)
                const [ly, lm] = latestPeriod.split('-').map(Number)
                // lm 為 1-indexed，Date(year, lm) 恰為該期的下一個月
                const next = new Date(ly, lm, 1)
                // 補生成上限 24 期：既有最新期與 targetPeriod 差距過大時
                // （如多年未用的舊卡重新啟用），只補最近 24 期，避免一次性
                // 回填大量遠期歷史帳單拖慢啟動與製造垃圾資料。
                // monthsBehind = next 到 targetPeriod 的月份距離（生成期數 = 距離 + 1，
                // 含 next 與 targetPeriod 兩端），超過 24 期才截尾。
                const monthsBehind =
                    (Number(targetPeriod.slice(0, 4)) - next.getFullYear()) *
                        12 +
                    (Number(targetPeriod.slice(5, 7)) -
                        (next.getMonth() + 1))
                if (monthsBehind >= 24) {
                    const floorMonth = new Date(
                        next.getFullYear(),
                        next.getMonth() + (monthsBehind - 23),
                        1
                    )
                    startPeriod = `${floorMonth.getFullYear()}-${String(floorMonth.getMonth() + 1).padStart(2, '0')}`
                } else {
                    startPeriod = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
                }
            }

            // 逐期生成：'YYYY-MM' 為定寬零填補格式，字典序比較即時間序。
            // 既有最新期已等於/晚於 targetPeriod 時迴圈不進入（冪等）。
            for (let period = startPeriod; period <= targetPeriod; ) {
                // 該期間已有帳單則跳過（改查預載的既有期集合，免逐期打 DB）
                if (!existingPeriods.has(period)) {
                    // 計算本期消費
                    const { startDate, endDate } = this.getStatementPeriod(
                        card,
                        period
                    )

                    // 防禦：如果今天還沒到該週期的結束日，不要產生帳單
                    if (now >= endDate) {
                        // 傳入明確 period：calculateCreditCardBalance 優先採紀錄上的
                        // statementPeriod（使用者手動「遞延下期」的覆寫欄位），而非只靠
                        // endDate 反推自然期別，否則遞延過期別的消費會被漏計/錯期。
                        const balance = await this.calculateCreditCardBalance(
                            card.id,
                            startDate,
                            endDate,
                            period
                        )

                        // 繳款日計算：若 dueDay > statementDay，繳款日落在結帳日
                        // 同月（例如 5日結帳、25日繳款）；否則落在下個月
                        // （例如 25日結帳、次月10日繳款）。
                        const dueMonth =
                            dueDay > statementDay
                                ? endDate.getMonth()
                                : endDate.getMonth() + 1
                        // 先經 Date 正規化（dueMonth 可為 12 → 隔年 1 月），再取
                        // 該月實際月份索引收斂月底日（dueDay 可設 1-31，如 31 日
                        // 遇 2 月），避免 new Date() 溢出到再下個月致繳款日錯開。
                        const dueAnchor = new Date(
                            endDate.getFullYear(),
                            dueMonth,
                            1
                        )
                        const clampedDueDay = clampDayToMonth(
                            dueAnchor.getFullYear(),
                            dueAnchor.getMonth(),
                            dueDay,
                            15
                        )
                        const dueDate = new Date(
                            dueAnchor.getFullYear(),
                            dueAnchor.getMonth(),
                            clampedDueDay
                        )
                        dueDate.setHours(0, 0, 0, 0)

                        // 結帳日正規化為當天 0 點，與繳款日同一基準比較
                        const normalizedStatementDate = new Date(
                            endDate.getFullYear(),
                            endDate.getMonth(),
                            endDate.getDate()
                        ).getTime()

                        await this.addCreditStatement({
                            accountId: card.id,
                            period,
                            statementDate: normalizedStatementDate,
                            dueDate: dueDate.getTime(),
                            amount: balance.currentBalance,
                            status:
                                balance.currentBalance > 0
                                    ? 'unpaid'
                                    : 'zero',
                            recordCount: balance.recordCount || 0,
                            ledgerId: card.ledgerId,
                            createdAt: Date.now(),
                        })
                    }
                }

                // period 前進一個月（經 Date 正規化，12 月自動進位到隔年 1 月）
                const [py, pm] = period.split('-').map(Number)
                const nextMonth = new Date(py, pm, 1) // pm 為 1-indexed，+0 即下一月
                period = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`
            }
        }
    }

    /**
     * 取得信用卡當前的即時消費（未出帳）與已出帳帳單（準備繳納金額）資訊
     * @param {number} accountId - 信用卡帳戶 ID
     * @param {Date} [referenceDate=new Date()] - 參考時間 (預設今日)
     * @returns {Promise<object|null>}
     */
    async getCreditCardBillingInfo(accountId, referenceDate = new Date()) {
        const account = await this.getAccount(accountId)
        if (!account || account.type !== 'credit_card') return null

        const statementDay = account.statementDay || 25
        const dueDay = account.dueDay || 15
        const creditLimit = account.creditLimit || 0

        const now =
            referenceDate instanceof Date
                ? referenceDate
                : new Date(referenceDate)
        const currentYear = now.getFullYear()
        const currentMonth = now.getMonth() // 0-indexed
        const currentDate = now.getDate()

        // 判斷最近一次已結帳日與當前未出帳週期。
        // 月底收斂（同 autoGenerateCreditStatements 的 effectiveStatementDay 慣例）：
        // statementDay 可設 1-31，直接 new Date(y, m, statementDay) 遇小月會溢出到下月
        // （31 日遇 2 月 → 3/3），使未出帳週期與已生成帳單（getStatementPeriod 已收斂）
        // 整段錯開——區間內消費會同時出現在「準備繳納」與「即時未出帳」兩個數字裡。
        // 判斷基準與上／本／下三個錨點月各自收斂到該月實際月底。
        const effectiveStatementDay = clampDayToMonth(
            currentYear,
            currentMonth,
            statementDay,
            25
        )
        let unbilledStartDate, unbilledEndDate, lastStatementEndDate
        // 今天已過（含當天）結帳日 → 本期未出帳從本月結帳日隔天起，到下月結帳日（收斂）結束；
        // 尚未結帳 → 從上月結帳日隔天起，到本月結帳日（收斂）結束。
        // 用 >=（含結帳日當天）與 autoGenerateCreditStatements 的 now.getDate() >= 基準一致：
        // 結帳日當天該期帳單已生成（含當日消費），當日消費不再同時列於即時未出帳。
        if (currentDate >= effectiveStatementDay) {
            lastStatementEndDate = new Date(
                currentYear,
                currentMonth,
                effectiveStatementDay
            )
            // 結帳日隔天：月底結帳時 setDate(+1) 自然進位到下月 1 日
            unbilledStartDate = new Date(
                currentYear,
                currentMonth,
                effectiveStatementDay
            )
            unbilledStartDate.setDate(unbilledStartDate.getDate() + 1)
            unbilledEndDate = new Date(
                currentYear,
                currentMonth + 1,
                clampDayToMonth(
                    currentYear,
                    currentMonth + 1,
                    statementDay,
                    25
                )
            )
        } else {
            lastStatementEndDate = new Date(
                currentYear,
                currentMonth - 1,
                clampDayToMonth(
                    currentYear,
                    currentMonth - 1,
                    statementDay,
                    25
                )
            )
unbilledStartDate = new Date(lastStatementEndDate)
            unbilledStartDate.setDate(unbilledStartDate.getDate() + 1)
            unbilledEndDate = new Date(
                currentYear,
                currentMonth,
                effectiveStatementDay
            )
        }

        const toDateStr = d =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const startStr = toDateStr(unbilledStartDate)
        const endStr = toDateStr(unbilledEndDate)
        const lastStatementEndStr = toDateStr(lastStatementEndDate)

        // 計算距結帳日剩餘天數
        const diffTime =
            unbilledEndDate.getTime() -
            new Date(currentYear, currentMonth, currentDate).getTime()
        const daysUntilStatement = Math.max(
            0,
            Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        )

        // 取得該卡所有 records
        const allRecords = await this.db.getAllFromIndex(
            'records',
            'accountId',
            account.id
        )

        // 排除 payable 欠款原始紀錄（與 accountsPage 現有邏輯一致）
        const debts = await this.getDebts({ allLedgers: true })
        const payableDebtIds = new Set(
            debts.filter(d => d.type === 'payable').map(d => String(d.id))
        )
        const isBalanceExempt = r =>
            r.debtId !== null &&
            payableDebtIds.has(String(r.debtId)) &&
            r.category !== 'debt_repayment'

        const validRecords = allRecords.filter(r => !isBalanceExempt(r))
        // 未出帳「期別名」以未出帳週期的**結束日**反推，而非以今天反推：
        // getNaturalStatementPeriod 的約定是「d <= statementDay → 歸前一期」，
        // 因此在結帳日「當天」以今天反推會得到**剛結帳的那一期**（其帳單已生成），
        // 使當日消費同時出現在「準備繳納」與「即時未出帳」兩個數字裡
        // （#CREDIT-UNBILLED 邊界語意）。改由 endStr 反推後，期別名與
        // unbilledPeriod 起訖區間永恆一致。
        const unbilledPeriodName =
            this.getNaturalStatementPeriod(account, endStr)

        // 本期未出帳明細 (排除卡費還款/扣繳，且有效所屬期別為未出帳期別)
        const unbilledRecords = validRecords
            .filter(r => {
                if (
                    r.category === 'debt_repayment' ||
                    r.category === 'transfer' ||
                    r.category === 'balance_adjustment' ||
                    r.description?.startsWith('[卡費扣繳]') ||
                    r.description?.startsWith('[自動扣款]')
                ) {
                    return false
                }
                // 所屬期別優先採手動覆寫（遞延下期），否則自然期別。
                // 日期兜底僅保留給「不早於未出帳期」的紀錄（遞延而來、日期仍落在
                // 前期者）；早期已結帳期別的紀錄不得因日期 >= 未出帳起日就重複列示
                // （結帳日當天消費已屬該期帳單，#CREDIT-UNBILLED 邊界語意）。
                const rPeriod =
                    r.statementPeriod ||
                    this.getNaturalStatementPeriod(account, r.date)
                if (rPeriod === unbilledPeriodName) return true
                if (rPeriod >= unbilledPeriodName && r.date >= startStr) return true
                return false
            })
            .sort(
                (a, b) =>
                    b.date.localeCompare(a.date) ||
                    (b.createdAt || 0) - (a.createdAt || 0)
            )

        let unbilledExpense = 0
        let unbilledRepayment = 0
        for (const r of unbilledRecords) {
            if (r.type === 'expense') {
                unbilledExpense += r.amount
            } else if (r.type === 'income') {
                unbilledRepayment += r.amount
            }
        }
        const unbilledTotal = Math.max(0, unbilledExpense - unbilledRepayment)

        // 取得帳單
        const statements = await this.getCreditStatements({
            accountId: account.id,
            allLedgers: true,
        })
        statements.sort((a, b) =>
            (b.period || '').localeCompare(a.period || '')
        )

        // 重新同步/核算未繳帳單的金額（修復歷史還款被誤扣或遞延明細）
        for (const s of statements) {
            if (s.status === 'unpaid' || s.status === 'partial') {
                const refreshed = await this.recalculateStatement(s.id)
                if (refreshed) {
                    s.amount = refreshed.amount
                    s.recordCount = refreshed.recordCount
                    s.status = refreshed.status
                }
            }
        }

        const unpaidStatements = statements.filter(
            s => s.status === 'unpaid' || s.status === 'partial'
        )
        const billedDueTotal = unpaidStatements.reduce(
            (sum, s) =>
                sum +
                Math.max(
                    0,
                    (s.amount || 0) -
                        (s.status === 'partial' ? s.paidAmount || 0 : 0)
                ),
            0
        )

        // 下一次繳款截止日
        let nextDueDate = null
        if (unpaidStatements.length > 0) {
            nextDueDate = Math.min(
                ...unpaidStatements.map(s => s.dueDate || Infinity)
            )
            if (nextDueDate === Infinity) nextDueDate = null
        } else if (statements.length > 0 && statements[0].dueDate) {
            nextDueDate = statements[0].dueDate
        }

        // 計算整體歷史欠款與可用額度 (欠款至少應包含所有待繳出帳帳單與未出帳即時消費)
        const balance = validRecords.reduce((bal, r) => {
            return bal + (r.type === 'income' ? r.amount : -r.amount)
        }, account.balance || 0)
        const netCashDebt = Math.max(0, -balance)
        const totalDebt = Math.max(billedDueTotal + unbilledTotal, netCashDebt)
        const availableCredit = Math.max(0, creditLimit - totalDebt)

        return {
            account,
            statementDay,
            dueDay,
            creditLimit,
            totalDebt,
            availableCredit,
            unbilledPeriod: {
                startDate: unbilledStartDate,
                endDate: unbilledEndDate,
                startStr,
                endStr,
                lastStatementEndStr,
            },
            daysUntilStatement,
            unbilledRecords,
            unbilledExpense,
            unbilledRepayment,
            unbilledTotal,
            statements,
            unpaidStatements,
            billedDueTotal,
            nextDueDate,
        }
    }

    /**
     * 取得指定期別帳單所涵蓋的交易明細
     * @param {object|number} accountOrId - 信用卡帳戶或帳戶 ID
     * @param {string} period - 帳單期間 (如 '2026-05')
     * @returns {Promise<Array>}
     */
    async getStatementRecords(accountOrId, period) {
        const account =
            typeof accountOrId === 'object'
                ? accountOrId
                : await this.getAccount(accountOrId)
        if (!account || !period) return []

        const records = await this.db.getAllFromIndex(
            'records',
            'accountId',
            account.id
        )

        return records
            .filter(r => {
                // 排除卡費還款/扣繳/平帳紀錄（還款不屬於消費明細）
                if (
                    r.category === 'debt_repayment' ||
                    r.category === 'transfer' ||
                    r.category === 'balance_adjustment' ||
                    r.description?.startsWith('[卡費扣繳]') ||
                    r.description?.startsWith('[自動扣款]')
                ) {
                    return false
                }

                // 判斷期別：優先採用手動指定 statementPeriod，否則採用自然期別
                const rPeriod =
                    r.statementPeriod ||
                    this.getNaturalStatementPeriod(account, r.date)
                return rPeriod === period
            })
            .sort(
                (a, b) =>
                    b.date.localeCompare(a.date) ||
                    (b.createdAt || 0) - (a.createdAt || 0)
            )
    }

    /**
     * 將指定的信用卡消費明細遞延至下一期帳單（商家延遲請款）
     * @param {number} recordId - 消費紀錄 ID
     * @param {number} [currentStatementId] - 當前帳單 ID (可選)
     * @returns {Promise<object>}
     */
    async deferRecordToNextStatement(recordId, currentStatementId = null) {
        const record = await this.getRecord(recordId)
        if (!record) throw new Error('找不到該筆紀錄')
        const card = await this.getAccount(record.accountId)
        if (!card || card.type !== 'credit_card') {
            throw new Error('該紀錄不屬於信用卡帳戶')
        }

        let currentPeriod =
            record.statementPeriod ||
            this.getNaturalStatementPeriod(card, record.date)
        if (currentStatementId) {
            const stmt = await this.getCreditStatement(currentStatementId)
            if (stmt && stmt.period) currentPeriod = stmt.period
        }

        const nextPeriod = this.getNextPeriod(currentPeriod)

        // 更新該筆紀錄的帳單期別為下一期
        await this.updateRecord(record.id, {
            statementPeriod: nextPeriod,
            deferredFromPeriod: currentPeriod,
        })

        // 重新計算原帳單金額 (若有)
        if (currentStatementId) {
            await this.recalculateStatement(currentStatementId)
        } else {
            const stmts = await this.getCreditStatements({
                accountId: card.id,
                period: currentPeriod,
                allLedgers: true,
            })
            if (stmts.length > 0) {
                await this.recalculateStatement(stmts[0].id)
            }
        }

        // 若下一期帳單已存在，重新計算下一期帳單金額
        const nextStmts = await this.getCreditStatements({
            accountId: card.id,
            period: nextPeriod,
            allLedgers: true,
        })
        if (nextStmts.length > 0) {
            await this.recalculateStatement(nextStmts[0].id)
        }

        return {
            recordId: record.id,
            fromPeriod: currentPeriod,
            toPeriod: nextPeriod,
        }
    }

    /**
     * 取消信用卡消費明細的遞延，移回自然帳單期別
     * @param {number} recordId - 消費紀錄 ID
     * @param {number} [currentStatementId] - 當前帳單 ID (可選)
     * @returns {Promise<object>}
     */
    async undeferRecord(recordId, currentStatementId = null) {
        const record = await this.getRecord(recordId)
        if (!record) throw new Error('找不到該筆紀錄')
        const card = await this.getAccount(record.accountId)
        if (!card || card.type !== 'credit_card') {
            throw new Error('該紀錄不屬於信用卡帳戶')
        }

        const oldPeriod = record.statementPeriod
        const naturalPeriod = this.getNaturalStatementPeriod(card, record.date)

        await this.updateRecord(record.id, {
            statementPeriod: null,
            deferredFromPeriod: null,
        })

        if (currentStatementId) {
            await this.recalculateStatement(currentStatementId)
        } else if (oldPeriod) {
            const stmts = await this.getCreditStatements({
                accountId: card.id,
                period: oldPeriod,
                allLedgers: true,
            })
            if (stmts.length > 0) await this.recalculateStatement(stmts[0].id)
        }

        const natStmts = await this.getCreditStatements({
            accountId: card.id,
            period: naturalPeriod,
            allLedgers: true,
        })
        if (natStmts.length > 0) await this.recalculateStatement(natStmts[0].id)

        return { recordId: record.id, restoredPeriod: naturalPeriod }
    }

    /**
     * 重新計算指定帳單的金額與筆數
     * @param {number} statementId - 帳單 ID
     * @returns {Promise<object|null>}
     */
    async recalculateStatement(statementId) {
        const stmt = await this.getCreditStatement(statementId)
        if (!stmt) return null
        const card = await this.getAccount(stmt.accountId)
        if (!card) return null

        const records = await this.getStatementRecords(card, stmt.period)
        let totalExp = 0
        let totalRepay = 0
        for (const r of records) {
            if (r.type === 'expense') totalExp += r.amount
            else if (r.type === 'income') totalRepay += r.amount
        }
        const newAmount = Math.max(0, totalExp - totalRepay)

        const updateData = {
            amount: newAmount,
            recordCount: records.length,
        }
        if (stmt.status === 'unpaid' || stmt.status === 'zero') {
            updateData.status = newAmount > 0 ? 'unpaid' : 'zero'
        } else if (stmt.status === 'partial') {
            if (newAmount <= 0) {
                updateData.status = 'zero'
            } else if (newAmount <= (stmt.paidAmount || 0)) {
                updateData.status = 'paid'
            }
        }

        await this.updateCreditStatement(stmt.id, updateData)
        return { ...stmt, ...updateData }
    }

    /**
     * 執行信用卡的自動扣款（於繳款日當天或之後自動還款，不計入生活支出但調整帳戶餘額以達平帳）
     */
    async autoPayCreditStatements() {
        const accounts = await this.getAccounts({ allLedgers: true })
        const creditCards = accounts.filter(
            a => a.type === 'credit_card' && a.autoPayEnabled
        )

        const processedRecords = []

        for (const card of creditCards) {
            if (!card.autoPayAccountId) continue

            // 檢查扣款帳戶是否存在
            const debitAccount = accounts.find(
                a => a.id === card.autoPayAccountId
            )
            if (!debitAccount) continue

            // 找出該信用卡所有未清帳單（unpaid 全額 + partial 剩額）。
            // partial 必須納入：其繳款日到期後剩額仍屬應繳金額，且扣繳時
            // 只能扣「帳單額 − 已繳額」，若按全額扣繳即對同一帳單重複扣款。
            const openStatements = (
                await this.getCreditStatements({
                    accountId: card.id,
                    allLedgers: true,
                })
            ).filter(
                s => s.status === 'unpaid' || s.status === 'partial'
            )

            const now = new Date()
            // 將時間設定為當天 0 點以便比較
            const today = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
            ).getTime()

            for (const stmt of openStatements) {
                // 正規化繳款日時間為 0 點比較
                const stmtDue = new Date(stmt.dueDate).setHours(0, 0, 0, 0)

                // 如果今天大於或等於繳款截止日，且尚未繳清
                if (today >= stmtDue) {
                    // 防重複扣款：檢查是否已有此帳單期別的扣款記錄
                    const allCardRecords = await this.db.getAllFromIndex(
                        'records',
                        'accountId',
                        card.id
                    )
                    const paidForPeriod = allCardRecords
                        .filter(
                            r =>
                                r.type === 'income' &&
                                r.description?.includes(`${stmt.period} 期`)
                        )
                        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)

                    // partial 帳單只扣「帳單額 − 已繳額」剩額，防止對同一帳單重複全額扣款
                    const effectivePaid = Math.max(
                        stmt.status === 'partial' ? stmt.paidAmount || 0 : 0,
                        paidForPeriod
                    )
                    const amountToPay = Math.max(0, stmt.amount - effectivePaid)

                    if (
                        amountToPay <= 0 ||
                        (stmt.status === 'unpaid' && paidForPeriod > 0) ||
                        (stmt.status === 'partial' &&
                            paidForPeriod >= stmt.amount)
                    ) {
                        await this.updateCreditStatement(stmt.id, {
                            status: 'paid',
                        })
                        continue
                    }

                    // 扣款日期以帳單繳款日記帳，維持與銀行實際扣繳日一致
                    const payDateObj = new Date(stmt.dueDate)
                    const payDateStr = `${payDateObj.getFullYear()}-${String(payDateObj.getMonth() + 1).padStart(2, '0')}-${String(payDateObj.getDate()).padStart(2, '0')}`

                    const expenseRecord = {
                        type: 'expense',
                        category: 'debt_repayment',
                        amount: amountToPay,
                        date: payDateStr,
                        description: `[卡費扣繳] 繳納信用卡費 (${card.name} ${stmt.period} 期)`,
                        accountId: debitAccount.id,
                        ledgerId: card.ledgerId,
                        createdAt: Date.now(),
                    }

                    const incomeRecord = {
                        type: 'income',
                        category: 'debt_repayment',
                        amount: amountToPay,
                        date: payDateStr,
                        description: `[卡費扣繳] 從 ${debitAccount.name} 扣款繳費 (${stmt.period} 期)`,
                        accountId: card.id,
                        ledgerId: card.ledgerId,
                        createdAt: Date.now(),
                    }

                    const expId = await this.addRecord(expenseRecord)
                    const incId = await this.addRecord(incomeRecord)

                    // 立即更新帳單狀態為 paid
                    await this.updateCreditStatement(stmt.id, {
                        status: 'paid',
                    })

                    processedRecords.push({
                        card,
                        debitAccount,
                        statement: stmt,
                        amount: amountToPay,
                        expenseId: expId,
                        incomeId: incId,
                    })
                }
            }
        }

        // 自動執行沖銷以維持狀態一致
        await this.updateCreditStatementsStatus()
        return processedRecords
    }

    /**
     * 執行單筆信用卡帳單繳款 / 卡費扣繳平帳
     * 產生還款記錄（扣款帳戶支出、信用卡帳戶收入，類別 debt_repayment），不計入日常支出但調整帳戶餘額以達平帳
     * 若信用卡欠款已為 0 或指定 deductOnly，則僅扣款帳戶平帳，不重複增加信用卡餘額
     * @param {number} statementId - 帳單 ID
     * @param {number} debitAccountId - 扣款/還款帳戶 ID
     * @param {number} [customAmount] - 自訂金額 (未填則預設帳單全額)
     * @param {string} [customDate] - 記帳日期 (未填則預設今日或繳款日)
     * @param {object} [options] - 其他選項 { deductOnly?: boolean, skipCardIncome?: boolean }
     * @returns {Promise<object>}
     */
    async payCreditStatement(
        statementId,
        debitAccountId,
        customAmount = null,
        customDate = null,
        options = {}
    ) {
        const stmt = await this.getCreditStatement(statementId)
        if (!stmt) throw new Error('找不到該筆帳單')

        const card = await this.getAccount(stmt.accountId)
        if (!card) throw new Error('找不到該信用卡帳戶')

        const debitAccount = await this.getAccount(debitAccountId)
        if (!debitAccount) throw new Error('找不到扣款帳戶')

        const amountToPay =
            customAmount !== null ? customAmount : stmt.amount || 0
        if (amountToPay <= 0) throw new Error('扣繳金額必須大於 0')

        const now = new Date()
        const toDateStr = d =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const dateStr = customDate || toDateStr(now)

        // 若明確指定 deductOnly/skipCardIncome，則僅扣款帳戶平帳
        const shouldSkipCardIncome =
            options?.deductOnly === true || options?.skipCardIncome === true

        const expenseRecord = {
            type: 'expense',
            category: 'debt_repayment',
            amount: amountToPay,
            date: dateStr,
            description: shouldSkipCardIncome
                ? `[卡費扣繳平帳] 扣除 ${card.name} 卡費 (${stmt.period || ''} 期) (信用卡已歸零)`
                : `[卡費扣繳] 繳納信用卡費 (${card.name} ${stmt.period || ''} 期)`,
            accountId: debitAccount.id,
            ledgerId: card.ledgerId,
            createdAt: Date.now(),
        }

        const expId = await this.addRecord(expenseRecord)
        let incId = null

        if (!shouldSkipCardIncome) {
            const incomeRecord = {
                type: 'income',
                category: 'debt_repayment',
                amount: amountToPay,
                date: dateStr,
                description: `[卡費扣繳] 從 ${debitAccount.name} 扣款繳費 (${stmt.period || ''} 期)`,
                accountId: card.id,
                ledgerId: card.ledgerId,
                createdAt: Date.now(),
            }
            incId = await this.addRecord(incomeRecord)
        }

        // 若繳足帳單金額，標記為 paid
        if (amountToPay >= (stmt.amount || 0)) {
            await this.updateCreditStatement(stmt.id, {
                status: 'paid',
            })
        }

        await this.updateCreditStatementsStatus()

        return {
            expenseId: expId,
            incomeId: incId,
            amount: amountToPay,
            statement: stmt,
            deductOnly: shouldSkipCardIncome,
        }
    }

    /**
     * 自動更新所有未繳信用卡帳單的繳款狀態 (先進先出 FIFO 沖銷)
     */
    async updateCreditStatementsStatus() {
        const accounts = await this.getAccounts({ allLedgers: true })
        const creditCards = accounts.filter(a => a.type === 'credit_card')

        for (const card of creditCards) {
            // 1. 找出該卡片所有未清帳單（unpaid + partial），按 period 排序（從舊到新）。
            //    注意：partial 也必須納入沖銷掃描——若只抓 unpaid，部分繳款後基準
            //    statementDate 會跳到後一期，已沖銷的還款紀錄落在掃描視窗外，
            //    狀態會在 partial/unpaid 間來回震盪（閃爍）。
            const allStatements = await this.getCreditStatements({
                accountId: card.id,
                allLedgers: true,
            })
            const openStatements = allStatements
                .filter(
                    s => s.status === 'unpaid' || s.status === 'partial'
                )
                .sort((a, b) => a.period.localeCompare(b.period))

            if (openStatements.length === 0) continue

            // 2. 獲取最舊未清帳單的出帳日
            const oldestStatementDate = openStatements[0].statementDate
            const toDateStr = d =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            const oldestStatementDateStr = toDateStr(
                new Date(oldestStatementDate)
            )

            // 3. 獲取在最舊出帳日之後的所有還款紀錄 (type === 'income' 且日期 >= 最舊出帳日)
            const records = await this.db.getAllFromIndex(
                'records',
                'accountId',
                card.id
            )
            const repaymentRecords = records.filter(r => {
                return (
                    r.type === 'income' &&
                    r.date >= oldestStatementDateStr &&
                    r.category !== 'refund' &&
                    !r.description?.includes('退款') &&
                    !r.description?.includes('刷退')
                )
            })

            // 4. 計算出帳日後所有的累計還款總額（沖銷可用池 pool）
            const totalRepaid = repaymentRecords.reduce(
                (sum, r) => sum + r.amount,
                0
            )
            let pool = totalRepaid

            // 5. 按先進先出 (FIFO) 順序沖銷未清帳單（狀態只升不降）：
            //    以視窗內還款總額 pool 依序「足額覆蓋整張帳單」推进：
            //    ① pool ≥ 帳單額 → paid（paidAmount 對齊帳單額，pool 扣減）
            //    ② 0 < pool < 帳單額 → partial + paidAmount=pool（只升不降，
            //       新舊值取大；舊版此情境直接 break 全額留 unpaid，導致繳款 UI
            //       重複提示全額、自動扣繳對已部分繳款的帳單再次全額扣款）
            //    ③ pool = 0 → 不動（不降回 unpaid：還款紀錄可能落在視窗外，
            //       降格會遺忘真實已繳款項；滯留 partial 比誤降 unpaid 安全）
            //    注意：partial 的既有 paidAmount 本就由同一視窗推導，故以「帳單
            //    全額」而非「剩額」消耗 pool，否則會把舊分配重複計入下一期。
            for (const stmt of openStatements) {
                if (pool >= stmt.amount) {
                    pool -= stmt.amount
                    await this.updateCreditStatement(stmt.id, {
                        status: 'paid',
                        paidAmount: stmt.amount,
                    })
                } else if (pool > 0) {
                    const already =
                        stmt.status === 'partial'
                            ? stmt.paidAmount || 0
                            : 0
                    const newPaid = Math.max(already, pool)
                    await this.updateCreditStatement(stmt.id, {
                        status: 'partial',
                        paidAmount: newPaid,
                    })
                    // 池已全數分配至本期（不足額），後續期別無款可沖，直接結束
                    break
                } else {
                    break
                }
            }
        }
    }

    // 清除所有信用卡帳單（注意：此方法在 class 頂部已有定義，此處不重複）

    // 清除所有帳戶
    async clearAllAccounts() {
        if (!this.db && !this.useLocalStorage) {
            await this.init()
        }
        if (!this.db) return true
        try {
            const tx = this.db.transaction('accounts', 'readwrite')
            await tx.store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('Failed to clear accounts:', error)
            throw error
        }
    }

    // 清除所有聯絡人
    async clearAllContacts() {
        if (!this.db && !this.useLocalStorage) {
            await this.init()
        }
        if (!this.db) return true
        try {
            const tx = this.db.transaction('contacts', 'readwrite')
            await tx.store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('Failed to clear contacts:', error)
            throw error
        }
    }

    // 清除所有欠款
    async clearAllDebts() {
        if (!this.db && !this.useLocalStorage) {
            await this.init()
        }
        if (!this.db) return true
        try {
            const tx = this.db.transaction('debts', 'readwrite')
            await tx.store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('Failed to clear debts:', error)
            throw error
        }
    }

    // --- Group Meta Methods ---
    // 【已廢除熱升級】
    // 舊版會在此偵測「groupMeta store 不存在」時執行 hot-upgrade：
    // close 現行 DB → 以 nextVersion = max(db.version+1, dbVersion+1) 重開。
    // 這是「更新後資料看似消失」的根因鏈之一：
    //   熱升級把 DB 推到 v16，但程式碼 dbVersion 仍是 15 →
    //   下次啟動 openDB(name, 15) 對 v16 的 DB 拋 VersionError →
    //   舊版 init 靜默降級 localStorage → 用戶看到空 app。
    // 現已改由 init 的兩階段偵測（_probeDbVersion + max 版本開啟）
    // 處理版本不一致；groupMeta 的建立一律走 v15 的正式 upgrade 路徑。
    // 此方法保留為 no-op，避免影響 5 個呼叫點；未來版本可移除。
    async _ensureGroupMetaStore() {
        return
    }

    // --- Group Meta Methods ---
    async getGroupMeta(groupId) {
        try {
            await this._ensureGroupMetaStore()
            return await this.db.get('groupMeta', groupId)
        } catch (error) {
            console.error(`Failed to get groupMeta ${groupId}:`, error)
            return null
        }
    }

    async getAllGroupMeta(ledgerId = null) {
        try {
            await this._ensureGroupMetaStore()
            if (ledgerId !== null) {
                const tx = this.db.transaction('groupMeta', 'readonly')
                const index = tx.objectStore('groupMeta').index('ledgerId')
                return await index.getAll(ledgerId)
            }
            return await this.db.getAll('groupMeta')
        } catch (error) {
            console.error('Failed to get all groupMeta:', error)
            return []
        }
    }

    async saveGroupMeta(groupMeta, skipLog = false) {
        try {
            await this._ensureGroupMetaStore()
            const uuid = groupMeta.uuid || this.generateUUID()
            const data = {
                id: groupMeta.id || uuid,
                uuid,
                name: groupMeta.name || '',
                createdAt: groupMeta.createdAt || Date.now(),
                settled: groupMeta.settled || false,
                settledAt: groupMeta.settledAt || null,
                ledgerId: groupMeta.ledgerId || this.activeLedgerId,
            }
            const tx = this.db.transaction('groupMeta', 'readwrite')
            const id = await tx.store.put(data)
            await tx.done
            if (!skipLog) {
                await this.logChange('update', 'groupMeta', id, {
                    uuid: data.uuid,
                    ledgerId: data.ledgerId,
                })
            }
            return id
        } catch (error) {
            console.error('Failed to save groupMeta:', error)
            throw error
        }
    }

    async deleteGroupMeta(id, skipLog = false) {
        try {
            await this._ensureGroupMetaStore()
            // 先 unlink records，避免 meta 已刪但 records 仍指向孤立 group
            await this.unlinkRecordsFromGroup(id)
            const tx = this.db.transaction('groupMeta', 'readwrite')
            let itemData = null
            if (!skipLog) itemData = await tx.store.get(id)
            await tx.store.delete(id)
            await tx.done
            if (!skipLog && itemData)
                await this.logChange('delete', 'groupMeta', id, {
                    uuid: itemData.uuid,
                    ledgerId: itemData.ledgerId,
                })
            return true
        } catch (error) {
            console.error(`Failed to delete groupMeta ${id}:`, error)
            throw error
        }
    }

    async clearAllGroupMeta() {
        if (!this.db && !this.useLocalStorage) {
            await this.init()
        }
        if (!this.db) return true
        try {
            await this._ensureGroupMetaStore()
            const records = await this.getRecords({ allLedgers: true })
            const needsUnlink = records.some(r => r.groupId)
            if (needsUnlink) {
                const txR = this.db.transaction('records', 'readwrite')
                const store = txR.store
                for (const r of records) {
                    if (r.groupId) {
                        r.groupId = null
                        r.groupStatus = null
                        await store.put(r)
                    }
                }
                await txR.done
            }
            const tx = this.db.transaction('groupMeta', 'readwrite')
            await tx.store.clear()
            await tx.done
            return true
        } catch (error) {
            console.error('Failed to clear groupMeta:', error)
            throw error
        }
    }

    // --- Private helpers ---

    /**
    /**
     * 計算群組淨額 (精確累計總應收 totalReceivable 與總應付 totalPayable)
     * - 被欠支出 (代墊) & 被欠收入 (拖欠薪水/貨款) 均屬於「別人欠我」(totalReceivable)
     * - 欠別人支出 (別人代墊) & 欠別人收入 (預領) 均屬於「我欠別人」(totalPayable)
     * @param {Array} groupRecords
     * @param {Array} [allDebts]
     * @returns {{totalExpense: number, totalIncome: number, netAmount: number, totalReceivable: number, totalPayable: number}}
     */
    _calculateGroupNet(groupRecords, allDebts = null) {
        const nonSettlement = groupRecords.filter(
            r => r.groupStatus !== 'settled'
        )
        const totalExpense = nonSettlement
            .filter(r => r.type === 'expense')
            .reduce((s, r) => s + (r.amount || 0), 0)
        const totalIncome = nonSettlement
            .filter(r => r.type === 'income')
            .reduce((s, r) => s + (r.amount || 0), 0)

        const debtsMap = new Map()
        if (allDebts) {
            allDebts.forEach(d => debtsMap.set(d.id, d))
        }

        let totalReceivable = 0 // 別人欠我 (代墊支出 + 拖欠收入)
        let totalPayable = 0 // 我欠別人 (別人代墊支出 + 預領收入)

        nonSettlement.forEach(r => {
            if (r.debtId && debtsMap.has(r.debtId)) {
                const debt = debtsMap.get(r.debtId)
                if (!debt.settled) {
                    const rem =
                        debt.remainingAmount !== undefined
                            ? debt.remainingAmount
                            : debt.amount
                    if (debt.type === 'receivable') {
                        totalReceivable += rem // 被欠款 (被欠支出代墊 或 被欠收入拖欠薪水)
                    } else if (debt.type === 'payable') {
                        totalPayable += rem // 欠別人 (別人代墊支出 或 預領收入)
                    }
                }
            } else if (
                r.groupStatus === 'active' ||
                r.isDebt ||
                (r.debtId === undefined && r.groupStatus === undefined)
            ) {
                if (r.type === 'expense') {
                    totalReceivable += r.amount || 0 // 代墊支出 -> 我出的錢，別人欠我
                } else if (r.type === 'income') {
                    totalPayable += r.amount || 0 // 普通群組收入 -> 我收到的錢，抵銷代墊
                }
            }
        })

        const netAmount = totalReceivable - totalPayable
        return {
            totalExpense,
            totalIncome,
            netAmount,
            totalReceivable,
            totalPayable,
        }
    }

    async _calculateGroupNetAsync(groupRecords) {
        const debts = await this.getDebts({ allLedgers: true })
        return this._calculateGroupNet(groupRecords, debts)
    }

    async unlinkRecordsFromGroup(groupId) {
        try {
            const records = await this.getRecords({ allLedgers: true })
            const tx = this.db.transaction('records', 'readwrite')
            for (const r of records) {
                if (r.groupId === groupId) {
                    r.groupId = null
                    r.groupStatus = null
                    await tx.store.put(r)
                }
            }
            await tx.done
        } catch (error) {
            console.error(
                `Failed to unlink records from group ${groupId}:`,
                error
            )
        }
    }

    // --- Group Aggregation Methods ---
    async getGroupRecords(groupId, ledgerId = null) {
        try {
            const records = await this.getRecords({ ledgerId })
            if (groupId === undefined) {
                // Return all records that belong to any group
                return records.filter(r => r.groupId)
            }
            return records.filter(r => r.groupId === groupId)
        } catch (e) {
            return []
        }
    }

    async getGroups(ledgerId = null) {
        try {
            const metas = await this.getAllGroupMeta(ledgerId)
            const allRecords = await this.getRecords({
                ledgerId,
            })
            const allDebts = await this.getDebts({ allLedgers: true })

            // O(n) Map 預先分群，避免 metas.map() 內層 filter 造成 O(n×m)
            const byGroup = new Map()
            allRecords
                .filter(r => r.groupId)
                .forEach(r => {
                    if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, [])
                    byGroup.get(r.groupId).push(r)
                })

            return metas.map(meta => {
                const groupRecs = byGroup.get(meta.id) || []
                const {
                    totalExpense,
                    totalIncome,
                    netAmount,
                    totalReceivable,
                    totalPayable,
                } = this._calculateGroupNet(groupRecs, allDebts)
                const dates = groupRecs.map(r => r.date).filter(Boolean)
                const sorted = [...dates].sort()
                return {
                    ...meta,
                    recordCount: groupRecs.length,
                    totalExpense,
                    totalIncome,
                    netAmount,
                    totalReceivable,
                    totalPayable,
                    settled: meta.settled,
                    dateFrom: sorted[0] || null,
                    dateTo:
                        sorted.length > 0 ? sorted[sorted.length - 1] : null,
                    recordIds: groupRecs.map(r => r.id),
                }
            })
        } catch (e) {
            console.error('Failed to get groups:', e)
            return []
        }
    }

    async settleGroup(groupId, settleAmount, accountId, date, _note) {
        try {
            const meta = await this.getGroupMeta(groupId)
            if (!meta) throw new Error('Group not found')

            const groupRecords = await this.getGroupRecords(groupId)
            const allDebts = await this.getDebts({ allLedgers: true })
            const debtsMap = new Map(allDebts.map(d => [d.id, d]))

            const _currentDate = date || formatDateToString(new Date())

            // 逐筆清查群組內未結清的紀錄與欠款
            for (const r of groupRecords) {
                if (r.groupStatus !== 'settled') {
                    if (r.debtId) {
                        const debt = debtsMap.get(r.debtId)
                        if (debt && !debt.settled && debt.remainingAmount > 0) {
                            await this.settleDebt(
                                debt.id,
                                debt.remainingAmount,
                                {
                                    accountId: accountId || null,
                                    forceCreate: true,
                                }
                            )
                        }
                    }
                    await this.updateRecord(r.id, { groupStatus: 'settled' })
                }
            }

            // 標記群組結清
            await this.saveGroupMeta(
                { ...meta, settled: true, settledAt: Date.now() },
                true
            )

            return { meta }
        } catch (e) {
            console.error('Failed to settle group:', e)
            throw e
        }
    }

    async partialSettleGroup(
        groupId,
        amount,
        accountId,
date,
        note,
        direction = null
    ) {
        try {
            const meta = await this.getGroupMeta(groupId)
            if (!meta) throw new Error('Group not found')

            // M01: 金額驗證
            if (
                amount === null ||
                amount === undefined ||
                typeof amount !== 'number' ||
                !isFinite(amount) ||
                amount <= 0
            ) {
                throw new Error(`部分退款金額無效: ${amount}`)
            }

            const groupRecords = await this.getGroupRecords(groupId)
            const allDebts = await this.getDebts({ allLedgers: true })
            const debtsMap = new Map(allDebts.map(d => [String(d.id), d]))

            // 決定結清方向：顯式指定優先，若無則依群組未結清淨額推斷（向後相容）
            let targetDirection = direction
            if (
                targetDirection !== 'receivable' &&
                targetDirection !== 'payable'
            ) {
                const { netAmount, totalReceivable, totalPayable } =
                    this._calculateGroupNet(groupRecords, allDebts)
                if (netAmount > 0) {
                    targetDirection = 'receivable'
                } else if (netAmount < 0) {
                    targetDirection = 'payable'
                } else {
                    targetDirection =
                        totalReceivable > 0
                            ? 'receivable'
                            : totalPayable > 0
                              ? 'payable'
                              : 'receivable'
                }
            }

            // 僅篩選同方向且未結清的欠款紀錄，對向欠款分毫不動
            const candidates = []
            for (const r of groupRecords) {
                if (r.groupStatus !== 'settled' && r.debtId) {
                    const debt = debtsMap.get(String(r.debtId))
                    if (
                        debt &&
                        !debt.settled &&
                        (debt.remainingAmount > 0 ||
                            (debt.remainingAmount === undefined &&
                                debt.amount > 0))
                    ) {
                        if (debt.type === targetDirection) {
                            candidates.push({ record: r, debt })
                        }
                    }
                }
            }

            // 確定性 FIFO 排序：日期升序 → id 升序，同輸入必得同結果、擺脫 DB 落庫物理順序影響
            candidates.sort((a, b) => {
                const dateA = a.record.date || ''
                const dateB = b.record.date || ''
                if (dateA !== dateB) return dateA.localeCompare(dateB)
                return (Number(a.record.id) || 0) - (Number(b.record.id) || 0)
            })

            let remainingPaymentToDistribute = amount
            let appliedAmount = 0

            for (const { record: r, debt } of candidates) {
                if (remainingPaymentToDistribute <= 0) break
                const currentRemaining =
                    debt.remainingAmount !== undefined
                        ? debt.remainingAmount
                        : debt.amount
                if (currentRemaining <= 0) continue

                const payAmt = Math.min(
                    remainingPaymentToDistribute,
                    currentRemaining
                )
                await this.settleDebt(debt.id, payAmt, {
                    accountId: accountId || null,
                    forceCreate: true,
                })
                remainingPaymentToDistribute -= payAmt
                appliedAmount += payAmt

                if (payAmt >= currentRemaining) {
                    await this.updateRecord(r.id, { groupStatus: 'settled' })
                }
            }

            // 檢查是否全數完成
            const remainingRecords = await this.getGroupRecords(groupId)
            const activeCount = remainingRecords.filter(
                r => r.groupStatus !== 'settled'
            ).length
            if (activeCount === 0) {
                await this.saveGroupMeta(
                    { ...meta, settled: true, settledAt: Date.now() },
                    true
                )
            }

            // 回傳擴充物件：回報實際沖銷與剩餘金額，且多餘剩額絕不退灌對向欠款
            return {
                amount,
                direction: targetDirection,
                applied: appliedAmount,
                remaining: remainingPaymentToDistribute,
            }
        } catch (e) {
            console.error('Failed to partial settle group:', e)
            throw e
        }
    }

    async settleGroupRecord(recordId, accountId, _date, _note) {
        try {
            const records = await this.getRecords({ allLedgers: true })
            const targetRecord = records.find(r => r.id === recordId)
            if (!targetRecord) throw new Error('Record not found')
            if (!targetRecord.groupId)
                throw new Error('Record does not belong to any group')
            if (targetRecord.groupStatus === 'settled')
                throw new Error('Record already settled')

            if (targetRecord.debtId) {
                const debt = await this.getDebt(targetRecord.debtId)
                if (debt && !debt.settled && debt.remainingAmount > 0) {
                    await this.settleDebt(debt.id, debt.remainingAmount, {
                        accountId: accountId || null,
                        forceCreate: true,
                    })
                }
            }

            await this.updateRecord(targetRecord.id, { groupStatus: 'settled' })

            const groupRecords = await this.getGroupRecords(
                targetRecord.groupId
            )
            const remainingActive = groupRecords.filter(
                r => r.groupStatus !== 'settled'
            )

            if (remainingActive.length === 0) {
                const meta = await this.getGroupMeta(targetRecord.groupId)
                if (meta && !meta.settled) {
                    await this.saveGroupMeta(
                        { ...meta, settled: true, settledAt: Date.now() },
                        true
                    )
                }
            }
        } catch (e) {
            console.error('Failed to settle group record:', e)
            throw e
        }
    }

    /**
     * 動態重新計算欠款之剩餘金額與 settled 結清狀態
     * @param {number|string} debtId
     */
    async recalculateDebtState(debtId) {
        if (!debtId) return null
        try {
            const debt = await this.getDebt(debtId)
            if (!debt) return null

            const allRecords = await this.getRecords({ allLedgers: true })
            const repaymentRecords = allRecords.filter(
                r =>
                    String(r.debtId) === String(debtId) &&
                    (r.category === 'debt_repayment' ||
                        r.category === 'debt_collection')
            )

            // ── Record-as-Truth：同步修剪與回寫 payments ──
            const oldPayments = Array.isArray(debt.payments)
                ? debt.payments
                : []
            const recordByIdMap = new Map()
            const recordByUuidMap = new Map()
            for (const r of repaymentRecords) {
                if (r.id !== undefined && r.id !== null) {
                    recordByIdMap.set(String(r.id), r)
                }
                if (r.uuid) {
                    recordByUuidMap.set(r.uuid, r)
                }
            }

            const matchedRecordIds = new Set()
            const newPayments = []

            for (const payment of oldPayments) {
                if (!payment) continue

                // 孤兒付款（無 recordId 且無 recordUuid）或舊形態付款（recordId 指向原始借貸紀錄而非還款明細）：
                // 此類付款為歷史資料或操作中斷未補建明細者，保留給 repairOrphanedDebtRecords 處理，不得誤刪
                const isOrphan = !payment.recordId && !payment.recordUuid
                const isLegacyToOriginalRecord =
                    debt.recordId &&
                    String(payment.recordId) === String(debt.recordId)
                if (isOrphan || isLegacyToOriginalRecord) {
                    newPayments.push(payment)
                    continue
                }

                // 嘗試依 recordId 或 recordUuid 尋找對應的現存記帳明細
                let matchedRecord = null
                if (
                    payment.recordId !== undefined &&
                    payment.recordId !== null
                ) {
                    matchedRecord = recordByIdMap.get(String(payment.recordId))
                }
                if (!matchedRecord && payment.recordUuid) {
                    matchedRecord = recordByUuidMap.get(payment.recordUuid)
                }

                if (matchedRecord) {
                    // 命中現存紀錄：保留並回寫最新 amount 與 date（若在明細頁被編輯）
                    matchedRecordIds.add(String(matchedRecord.id))
                    const updatedPayment = {
                        ...payment,
                        amount:
                            typeof matchedRecord.amount === 'number'
                                ? matchedRecord.amount
                                : payment.amount,
                        date: matchedRecord.date || payment.date,
                        recordId:
                            matchedRecord.id !== undefined
                                ? matchedRecord.id
                                : payment.recordId,
                        ...(matchedRecord.uuid
                            ? { recordUuid: matchedRecord.uuid }
                            : {}),
                    }
                    newPayments.push(updatedPayment)
                }
                // 未命中紀錄者：紀錄已在明細頁被刪除（或被改隸/解除欠款綁定），此為幽靈付款，主動予以修剪剔除
            }

            // 補齊未被舊 payments 涵蓋的合法還款紀錄（例如手動新增或匯入未登記進 payments 的還款）
            for (const r of repaymentRecords) {
                if (r.id !== undefined && !matchedRecordIds.has(String(r.id))) {
                    newPayments.push({
                        amount: r.amount || 0,
                        date: r.date || formatDateToString(new Date()),
                        recordId: r.id,
                        ...(r.uuid ? { recordUuid: r.uuid } : {}),
                    })
                }
            }

            // 計算實質已還款總額（以現存還款明細為準；若有保留之孤兒付款亦納入累計）
            const orphanTotal = newPayments
                .filter(
                    p =>
                        (!p.recordId && !p.recordUuid) ||
                        (debt.recordId &&
                            String(p.recordId) === String(debt.recordId))
                )
                .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
            const paidAmountFromRecords = repaymentRecords.reduce(
                (sum, r) => sum + (Number(r.amount) || 0),
                0
            )
            const totalPaid = paidAmountFromRecords + orphanTotal

            const originalAmount = debt.originalAmount || debt.amount || 0
// 「既有款項登記」基線（initialPaidAmount）計入已還總額：
            // 基線無對應記帳明細，重算時若漏計會把基線視為未付（remaining 變大、誤撤結清狀態）
            const baseline = Number(debt.initialPaidAmount) || 0
            const newRemainingAmount = Math.max(0, originalAmount - totalPaid - baseline)
            const isSettled = newRemainingAmount <= 0

            const updates = {
                remainingAmount: newRemainingAmount,
                settled: isSettled,
            }

            if (!isSettled) {
                updates.settledAt = null
            } else if (!debt.settledAt) {
                updates.settledAt = Date.now()
            }

            // 零震盪（No-op if unchanged）：比對 payments 是否有實質差異，有差異才寫入
            const paymentsChanged =
                newPayments.length !== oldPayments.length ||
                newPayments.some((p, i) => {
                    const oldP = oldPayments[i]
                    if (!oldP) return true
                    return (
                        Number(p.amount) !== Number(oldP.amount) ||
                        p.date !== oldP.date ||
                        String(p.recordId ?? '') !==
                            String(oldP.recordId ?? '') ||
                        (p.recordUuid || '') !== (oldP.recordUuid || '')
                    )
                })

            if (paymentsChanged) {
                updates.payments = newPayments
            }

            const updatedDebt = await this.updateDebt(debtId, updates, true)

            // 自動尋找綁定該欠款的所有群組，觸發群組狀態重算
            const affectedGroupIds = new Set(
                allRecords
                    .filter(
                        r => String(r.debtId) === String(debtId) && r.groupId
                    )
                    .map(r => r.groupId)
            )
            for (const gId of affectedGroupIds) {
                await this.recalculateGroupState(gId)
            }

            return updatedDebt
        } catch (error) {
            console.error(
                `Failed to recalculate debt state for ${debtId}:`,
                error
            )
            return null
        }
    }

    async recalculateGroupState(groupId) {
        if (!groupId) return null
        try {
            const meta = await this.getGroupMeta(groupId)
            if (!meta) return null

            const groupRecords = await this.getGroupRecords(groupId)
            const allDebts = await this.getDebts({ allLedgers: true })
            const debtsMap = new Map(allDebts.map(d => [String(d.id), d]))

            let activeCount = 0

            for (const r of groupRecords) {
                if (r.debtId) {
                    const debt = debtsMap.get(String(r.debtId))
                    const isDebtSettled = debt ? debt.settled === true : false

                    if (!isDebtSettled && r.groupStatus === 'settled') {
                        r.groupStatus = 'active'
                        await this.updateRecord(
                            r.id,
                            { groupStatus: 'active' },
                            true
                        )
                    } else if (isDebtSettled && r.groupStatus !== 'settled') {
                        r.groupStatus = 'settled'
                        await this.updateRecord(
                            r.id,
                            { groupStatus: 'settled' },
                            true
                        )
                    }
                }

                if (r.groupStatus !== 'settled') {
                    activeCount++
                }
            }

            const isGroupSettled = activeCount === 0 && groupRecords.length > 0
            const metaUpdates = {
                settled: isGroupSettled,
            }

            if (!isGroupSettled) {
                metaUpdates.settledAt = null
            } else if (!meta.settledAt) {
                metaUpdates.settledAt = Date.now()
            }

            await this.saveGroupMeta({ ...meta, ...metaUpdates }, true)
            return { ...meta, ...metaUpdates }
        } catch (error) {
            console.error(
                `Failed to recalculate group state for ${groupId}:`,
                error
            )
            return null
        }
    }
    // --- File Methods (for storing avatars, etc.) ---
    async addFile(file) {
        try {
            const fileData = {
                name: file.name || 'file',
                type: file.type || 'application/octet-stream',
                data: file.data, // Blob
                createdAt: Date.now(),
            }
            const tx = this.db.transaction('files', 'readwrite')
            const id = await tx.store.add(fileData)
            await tx.done
            return id
        } catch (error) {
            console.error('Failed to add file:', error)
            throw error
        }
    }

    async getFile(id) {
        try {
            return await this.db.get('files', id)
        } catch (error) {
            console.error(`Failed to get file ${id}:`, error)
            return null
        }
    }

    async deleteFile(id) {
        try {
            const tx = this.db.transaction('files', 'readwrite')
            await tx.store.delete(id)
            await tx.done
            return true
        } catch (error) {
            console.error(`Failed to delete file ${id}:`, error)
            throw error
        }
    }

    // --- Contact Methods ---
    async addContact(contact, skipLog = false) {
        try {
            let contactData
            if (skipLog) {
                // 同步接收路徑：保留所有傳入欄位
                contactData = {
                    ...contact,
                    uuid: contact.uuid || this.generateUUID(),
                }
            } else {
                // 正規新建路徑：使用明確欄位結構
                contactData = {
                    name: contact.name,
                    avatarFileId: contact.avatarFileId || null,
                    createdAt: Date.now(),
                    uuid: contact.uuid || this.generateUUID(),
                }
            }
            contactData.ledgerId = contactData.ledgerId ?? this.activeLedgerId
            delete contactData.id // 讓 IndexedDB 自動產生，避免 key 衝突
            const tx = this.db.transaction('contacts', 'readwrite')
            const id = await tx.store.add(contactData)
            await tx.done
            if (!skipLog)
                await this.logChange('add', 'contacts', id, {
                    ...contactData,
                    id,
                })
            return id
        } catch (error) {
            console.error('Failed to add contact:', error)
            throw error
        }
    }

    async getContact(id) {
        try {
            return await this.db.get('contacts', id)
        } catch (error) {
            console.error(`Failed to get contact ${id}:`, error)
            return null
        }
    }

    async getContacts(filters = {}) {
        try {
            let contacts = await this.db.getAll('contacts')
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                contacts = contacts.filter(c => c.ledgerId === targetLedgerId)
            }
            return contacts
        } catch (error) {
            console.error('Failed to get contacts:', error)
            return []
        }
    }

    async updateContact(id, updates, skipLog = false) {
        try {
            const tx = this.db.transaction('contacts', 'readwrite')
            const contact = await tx.store.get(id)
            if (contact) {
                const finalUpdates = { ...updates }
                if (skipLog) {
                    delete finalUpdates.id
                    if (contact.uuid) finalUpdates.uuid = contact.uuid
                }
                const updatedContact = { ...contact, ...finalUpdates }
                await tx.store.put(updatedContact)
                await tx.done
                if (!skipLog)
                    await this.logChange(
                        'update',
                        'contacts',
                        id,
                        updatedContact
                    )
                return updatedContact
            }
            throw new Error('Contact not found')
        } catch (error) {
            console.error(`Failed to update contact ${id}:`, error)
            throw error
        }
    }

    async deleteContact(id, skipLog = false) {
        try {
            const tx = this.db.transaction('contacts', 'readwrite')
            let itemData = null
            if (!skipLog) {
                itemData = await tx.store.get(id)
            }
            await tx.store.delete(id)
            await tx.done
            if (!skipLog && itemData)
                await this.logChange('delete', 'contacts', id, {
                    uuid: itemData.uuid,
                    ledgerId: itemData.ledgerId,
                    name: itemData.name,
                })
            return true
        } catch (error) {
            console.error(`Failed to delete contact ${id}:`, error)
            throw error
        }
    }

    // --- Debt Methods ---
    async addDebt(debt, skipLog = false) {
        try {
            // 補充 contactUuid / recordUuid 以便跨裝置同步時正確解析外鍵
            let contactUuid = debt.contactUuid || null
            if (debt.contactId && !contactUuid) {
                try {
                    const contact = await this.db.get(
                        'contacts',
                        debt.contactId
                    )
                    if (contact?.uuid) contactUuid = contact.uuid
                } catch (_) {
                    /* 查不到聯絡人不影響儲存 */
                }
            }

            let recordUuid = debt.recordUuid || null
            if (debt.recordId && !recordUuid) {
                try {
                    const rec = await this.db.get('records', debt.recordId)
                    if (rec?.uuid) recordUuid = rec.uuid
                } catch (_) {
                    /* 查不到紀錄不影響儲存 */
                }
            }

            let debtData

            if (skipLog) {
                // ── 同步接收路徑：保留所有傳入欄位（含 settled、payments、金額等）──
                const amount =
                    debt.amount ??
                    debt.originalAmount ??
                    debt.remainingAmount ??
                    0
                debtData = {
                    ...debt,
                    contactUuid,
                    ...(recordUuid ? { recordUuid } : {}),
                    originalAmount: debt.originalAmount ?? amount,
                    remainingAmount: debt.remainingAmount ?? amount,
                    uuid: debt.uuid || this.generateUUID(),
                }
            } else {
                // ── 正規新建路徑：使用明確初始化的欄位結構 ──
                const amount = debt.amount
                // 「既有款項登記」基線：建立前已還/已收的金額（借鏡 MOZE 既有款項語意）。
                // 基線不產生記帳明細、不影響資金帳戶，僅從剩餘金額開始追蹤。
                // recalculateDebtState 與結清判定都必須把基線計入已還總額。
                let initialPaid = Number(debt.initialPaidAmount) || 0
                if (!isFinite(initialPaid) || initialPaid < 0) initialPaid = 0
                if (initialPaid > amount) initialPaid = amount
                const newRemaining = Math.max(0, amount - initialPaid)
                const bornSettled = newRemaining <= 0
                debtData = {
                    type: debt.type, // 'receivable' | 'payable'
                    contactId: debt.contactId,
                    contactUuid,
                    originalAmount: amount,
                    remainingAmount: newRemaining,
                    recordId: debt.recordId || null,
                    ...(recordUuid ? { recordUuid } : {}),
                    date: debt.date,
                    description: debt.description || '',
                    settled: bornSettled,
                    settledAt: bornSettled ? Date.now() : null,
                    payments: [],
                    // 基線欄位僅在 > 0 時寫入，舊資料與一般新建零污染
                    ...(initialPaid > 0 ? { initialPaidAmount: initialPaid } : {}),
                    createdAt: Date.now(),
                    uuid: debt.uuid || this.generateUUID(),
                }
            }

            debtData.ledgerId = debtData.ledgerId ?? this.activeLedgerId
            // 移除 id（讓 IndexedDB 自動產生），避免 key 衝突
            delete debtData.id

            const tx = this.db.transaction('debts', 'readwrite')
            const id = await tx.store.add(debtData)
            await tx.done
            if (!skipLog)
                await this.logChange('add', 'debts', id, { ...debtData, id })
            return id
        } catch (error) {
            console.error('Failed to add debt:', error)
            throw error
        }
    }

    async getDebt(id) {
        try {
            return await this.db.get('debts', id)
        } catch (error) {
            console.error(`Failed to get debt ${id}:`, error)
            return null
        }
    }

    async getDebts(filters = {}) {
        try {
            let debts = await this.db.getAll('debts')

            // 帳本篩選
            if (!filters.allLedgers) {
                const targetLedgerId = filters.ledgerId ?? this.activeLedgerId
                debts = debts.filter(d => d.ledgerId === targetLedgerId)
            }

            if (filters.contactId !== undefined) {
                debts = debts.filter(
                    d => String(d.contactId) === String(filters.contactId)
                )
            }
            if (filters.type) {
                debts = debts.filter(d => d.type === filters.type)
            }
            if (filters.settled !== undefined) {
                debts = debts.filter(d => d.settled === filters.settled)
            }

            return debts.sort((a, b) => b.createdAt - a.createdAt)
        } catch (error) {
            console.error('Failed to get debts:', error)
            return []
        }
    }

    async updateDebt(id, updates, skipLog = false) {
        try {
            // 若更新包含 contactId / recordId，同步更新對應 UUID
            const extraUpdates = {}
            if (updates.contactId !== undefined) {
                if (updates.contactId) {
                    try {
                        const contact = await this.db.get(
                            'contacts',
                            updates.contactId
                        )
                        if (contact?.uuid)
                            extraUpdates.contactUuid = contact.uuid
                    } catch (_) {
                        /* 查不到聯絡人不影響更新 */
                    }
                } else {
                    extraUpdates.contactUuid = null
                }
            }
            if (updates.recordId !== undefined) {
                if (updates.recordId) {
                    try {
                        const record = await this.db.get(
                            'records',
                            updates.recordId
                        )
                        if (record?.uuid) extraUpdates.recordUuid = record.uuid
                    } catch (_) {
                        /* 查不到紀錄不影響更新 */
                    }
                } else {
                    extraUpdates.recordUuid = null
                }
            }

            const tx = this.db.transaction('debts', 'readwrite')
            const debt = await tx.store.get(id)
            if (debt) {
                // 同步路徑時 (skipLog=true)，數據來自遠端，可能包含遠端 ID 或 UUID
                // 必須確保本地 UUID 不被意外覆蓋，除非遠端 UUID 確定是正確的關聯標識
                // 通常同步時我們會根據 UUID 找到本地 ID，所以傳入的 updates.uuid 理應與本地相同
                // 但為了保險起見，保護本地 uuid 與 id 不被 `...updates` 覆蓋
                const finalUpdates = { ...updates, ...extraUpdates }
                if (skipLog) {
                    delete finalUpdates.id
                    // 確保不覆蓋本地 UUID
                    if (debt.uuid) {
                        finalUpdates.uuid = debt.uuid
                    }
                }

                const updatedDebt = { ...debt, ...finalUpdates }
                await tx.store.put(updatedDebt)
                await tx.done
                if (!skipLog)
                    await this.logChange('update', 'debts', id, updatedDebt)
                return updatedDebt
            }
            throw new Error('Debt not found')
        } catch (error) {
            console.error(`Failed to update debt ${id}:`, error)
            throw error
        }
    }

    async deleteDebt(id, skipLog = false) {
        try {
            const tx = this.db.transaction('debts', 'readwrite')
            let itemData = null
            if (!skipLog) {
                itemData = await tx.store.get(id)
            }
            await tx.store.delete(id)
            await tx.done
            if (!skipLog && itemData)
                await this.logChange('delete', 'debts', id, {
                    uuid: itemData.uuid,
                    ledgerId: itemData.ledgerId,
                })
            return true
        } catch (error) {
            console.error(`Failed to delete debt ${id}:`, error)
            throw error
        }
    }

    /**
     * 解析還款/結清的預設帳戶。
     * 商業規則：朋友還款無法「存入信用卡」（無法轉帳進信用卡帳戶）。
     * 當偏好帳戶是信用卡時（例如原始刷卡紀錄的帳戶），依序轉導：
     *   1. 該信用卡綁定的自動扣繳帳戶
     *   2. 名稱含「現金」的帳戶
     *   3. 第一個非信用卡帳戶
     *   4. 僅有信用卡時回傳 null（不強塞不合理預設，由 UI 層再兜底）
     * @param {number|null} preferredId - 偏好帳戶 ID（通常是原始欠款紀錄的帳戶）
     * @returns {Promise<number|null>}
     */
    async resolveDefaultSettleAccountId(preferredId = null) {
        const accounts = await this.getAccounts()
        if (!accounts || accounts.length === 0) return null

        const isCard = acc => acc && acc.type === 'credit_card'

        const preferred = preferredId
            ? accounts.find(a => a.id === preferredId)
            : null

        // 偏好帳戶存在且非信用卡 → 直接沿用
        if (preferred && !isCard(preferred)) return preferred.id

        // 偏好帳戶是信用卡 → 轉導到其自動扣繳帳戶
        if (preferred && isCard(preferred) && preferred.autoPayAccountId) {
            const debit = accounts.find(
                a => a.id === preferred.autoPayAccountId
            )
            if (debit && !isCard(debit)) return debit.id
        }

        // 預設回現金帳戶
        const cash = accounts.find(
            a => !isCard(a) && (a.name || '').includes('現金')
        )
        if (cash) return cash.id

        // 兜底：第一個非信用卡帳戶
        const firstNonCard = accounts.find(a => !isCard(a))
        return firstNonCard ? firstNonCard.id : null
    }

    async settleDebt(id, paymentAmount = null, accountIdOrOptions = null) {
        try {
            const debt = await this.getDebt(id)
            if (!debt) throw new Error('Debt not found')
            if (debt.settled) return debt // Already settled

            // 相容舊呼叫 (第 3 參數為 accountId) 與新呼叫 (物件包含選項)
            let accountId = null
            let createDetail = true
            let forceCreate = false
            if (accountIdOrOptions && typeof accountIdOrOptions === 'object') {
                ;({
                    accountId = null,
                    createDetail = true,
                    forceCreate = false,
                } = accountIdOrOptions)
            } else {
                accountId = accountIdOrOptions || null
            }

            // Determine payment amount (full or partial)
            const amount = paymentAmount || debt.remainingAmount
            const newRemainingAmount = debt.remainingAmount - amount
            const isFullySettled = newRemainingAmount <= 0

            // 原始欠款紀錄所屬帳戶（用於判斷是否強制建立還款明細）
            let debtRecordAccountId = null
            if (debt.recordId) {
                const mainRecord = await this.getRecord(debt.recordId)
                if (mainRecord && mainRecord.accountId) {
                    debtRecordAccountId = mainRecord.accountId
                }
            }

            // 若還款帳戶與原始欠款紀錄帳戶不同，強制建立還款明細以維持帳款平衡
            if (
                forceCreate ||
                (accountId !== null &&
                    debtRecordAccountId !== null &&
                    accountId !== debtRecordAccountId)
            ) {
                createDetail = true
            }

            // Create payment record in history
            const paymentRecord = {
                amount,
                date: formatDateToString(new Date()),
                recordId: null,
            }

            // 是否建立「還款 / 欠款回收」記帳明細：
            // - 若欠款未連結任何記帳紀錄（純欠款），預設建立
            // - 若已連結，則依 createDetail 決定；跨帳戶還款時已強制建立
            let newRecordId = null
            if (createDetail || !debt.recordId) {
                const contact = await this.getContact(debt.contactId)
                const contactName = contact?.name || '未知聯絡人'

                // 決定還款紀錄所屬帳戶
                let recordAccountId = accountId
                if (!recordAccountId && debtRecordAccountId) {
                    // 原始紀錄帳戶若為信用卡，轉導到自動扣繳帳戶/現金（朋友無法還款進信用卡）
                    recordAccountId =
                        await this.resolveDefaultSettleAccountId(
                            debtRecordAccountId
                        )
                }
                if (!recordAccountId) {
                    recordAccountId =
                        await this.resolveDefaultSettleAccountId(null)
                }

                const record = {
                    type: debt.type === 'receivable' ? 'income' : 'expense',
                    category:
                        debt.type === 'receivable'
                            ? 'debt_collection'
                            : 'debt_repayment',
                    amount: amount,
                    date: formatDateToString(new Date()),
                    description:
                        debt.type === 'receivable'
                            ? `收回欠款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`
                            : `還款：${contactName} - ${debt.description}${!isFullySettled ? ` (部分)` : ''}`,
                    ledgerId: debt.ledgerId,
                    debtId: id,
                    ...(recordAccountId ? { accountId: recordAccountId } : {}),
                }

                newRecordId = await this.addRecord(record)
            }

            paymentRecord.recordId = newRecordId
            if (newRecordId) {
                const newRecord = await this.getRecord(newRecordId)
                if (newRecord?.uuid) {
                    paymentRecord.recordUuid = newRecord.uuid
                }
            } else if (debt.recordUuid) {
                // If linked to original record, use original record's UUID for identification in payments array
                paymentRecord.recordUuid = debt.recordUuid
                paymentRecord.recordId = debt.recordId
            }

            // Update debt with new payment
            const updatedPayments = [...(debt.payments || []), paymentRecord]
            const updates = {
                remainingAmount: Math.max(0, newRemainingAmount),
                payments: updatedPayments,
            }

            if (isFullySettled) {
                updates.settled = true
                updates.settledAt = Date.now()
            }

            const updatedDebt = await this.updateDebt(id, updates)
            return updatedDebt
        } catch (error) {
            console.error(`Failed to settle debt ${id}:`, error)
            throw error
        }
    }

    // Add partial payment to a debt
    async addPartialPayment(debtId, amount, accountIdOrOptions = null) {
        return this.settleDebt(debtId, amount, accountIdOrOptions)
    }

    // ==================== 欠款紀錄完整性修復 ====================
    // 快速判斷是否需要執行欠款紀錄修復（不建立任何紀錄，僅掃描）。
    // 用於決定是否需要在啟動時顯示轉換提示 Modal。
    async needsDebtRepair() {
        try {
            const debts = await this.getDebts({ allLedgers: true })
            return debts.some(d =>
                (d.payments || []).some(
                    p =>
                        (!p.recordId && !p.recordUuid) ||
                        (d.recordId && p.recordId === d.recordId)
                )
            )
        } catch (error) {
            console.error('檢查欠款紀錄完整性失敗:', error)
            return false
        }
    }

    // 修復因操作中斷（例如結清/收款途中關閉應用程式）而殘留的
    // 「付款已寫入 debt.payments，但對應記帳紀錄卻未建立」的欠款資料。
    // 同時也修復舊版（行為變更前）連結欠款中指向原始借貸紀錄而非還款明細的付款。
    // 每筆 payment 若缺少 recordId / recordUuid，或 recordId 仍指向原始欠款紀錄，
    // debt_repayment / debt_collection 記帳明細。
    //
    // 注意：目前由 main.js 於每次啟動時呼叫，以確保歷史中斷資料能被修復；
    // 未來版本可改為僅在特定 DB 版本升級（如 v14 移轉）時執行，避免每次掃描。
    //
    // @param {(progress: {current:number,total:number,repairedCount:number,phase:string}) => void} [onProgress]
    // @returns {Promise<{repairedCount:number, scanned:number}>}
    async repairOrphanedDebtRecords(onProgress) {
        try {
            const debts = await this.getDebts({ allLedgers: true })
            const allContacts = await this.getContacts()
            const allRecords = await this.getRecords({ allLedgers: true })
            const allAccounts = await this.getAccounts({ allLedgers: true })

            const contactMap = new Map(allContacts.map(c => [c.id, c]))
            const recordMap = new Map(allRecords.map(r => [r.id, r]))
            const accountMap = new Map()
            for (const acc of allAccounts) {
                if (!accountMap.has(acc.ledgerId))
                    accountMap.set(acc.ledgerId, [])
                accountMap.get(acc.ledgerId).push(acc)
            }
for (const accounts of accountMap.values()) {
                accounts.sort((a, b) => a.id - b.id)
            }

            const total = debts.length
            let current = 0
            let repairedCount = 0

            // UUID 快取：同一 debt / account 的多筆付款共用解析結果，
            // 避免 addRecord 內部逐筆重複查詢（N+1 優化，2026-08-19）
            const debtUuidCache = new Map()
            const accountUuidCache = new Map()
            const resolveUuid = async (storeName, cache, id) => {
                if (id === null || id === undefined) return null
                if (cache.has(id)) return cache.get(id)
                let uuid = null
                try {
                    const item = await this.db.get(storeName, id)
                    uuid = item?.uuid || null
                } catch (_) {
                    /* 查不到 uuid 不影響修復 */
                }
                cache.set(id, uuid)
                return uuid
            }

            for (const debt of debts) {
                current++
                const payments = debt.payments || []

                let updated = false
                const updatedPayments = []

                // 聯絡人名稱
                let contactName = '未知聯絡人'
                if (debt.contactId) {
                    const contact = contactMap.get(debt.contactId)
                    if (contact) contactName = contact.name || '未知聯絡人'
                }

                // 原始欠款紀錄所屬帳戶
                let originalAccountId = null
                if (debt.recordId) {
                    const originalRecord = recordMap.get(debt.recordId)
                    if (originalRecord)
                        originalAccountId = originalRecord.accountId
                }

                // 帳本預設帳戶
                let defaultAccountId = null
                const accounts = accountMap.get(debt.ledgerId)
                if (accounts && accounts.length > 0) {
                    defaultAccountId = accounts[0].id
                }

                // 批次預先解析本筆欠款與目標帳戶的 UUID（每 debt 各 1 次查詢，含快取），
                // 後續補建紀錄時直接帶入 uuid/accountUuid，避免 addRecord 逐筆重查
                const recordAccountId = originalAccountId || defaultAccountId
                const preResolvedDebtUuid = await resolveUuid(
                    'debts',
                    debtUuidCache,
                    debt.id
                )
                const preResolvedAccountUuid = await resolveUuid(
                    'accounts',
                    accountUuidCache,
                    recordAccountId
                )

                for (const payment of payments) {
                    if (
                        (!payment.recordId && !payment.recordUuid) ||
                        (debt.recordId && payment.recordId === debt.recordId)
                    ) {
                        const record = {
                            type:
                                debt.type === 'receivable'
                                    ? 'income'
                                    : 'expense',
                            category:
                                debt.type === 'receivable'
                                    ? 'debt_collection'
                                    : 'debt_repayment',
                            amount: payment.amount,
                            date:
                                payment.date || formatDateToString(new Date()),
                            description:
                                debt.type === 'receivable'
                                    ? `收回欠款：${contactName} - ${debt.description || ''}`
                                    : `還款：${contactName} - ${debt.description || ''}`,
                            ledgerId: debt.ledgerId || this.activeLedgerId,
                            debtId: debt.id,
                            // 預先產生 uuid，addRecord 沿用，免於補建後再查回紀錄
                            uuid: this.generateUUID(),
                            ...(recordAccountId
                                ? {
                                      accountId: recordAccountId,
                                      accountUuid: preResolvedAccountUuid,
                                  }
                                : {}),
                            // debtUuid 預先解析，避免 addRecord 內部重查
                            ...(preResolvedDebtUuid
                                ? { debtUuid: preResolvedDebtUuid }
                                : {}),
                        }

                        const newRecordId = await this.addRecord(record)
                        if (newRecordId !== null && newRecordId !== undefined) {
                            payment.recordId = newRecordId
                            payment.recordUuid = record.uuid
                            updated = true
                            repairedCount++
                        } else {
                            // Hook 取消建立紀錄（onRecordSaveBefore 回傳 null）：
                            // 保持 payment 原狀待下次修復，不標記為已修復
                            console.warn(
                                `修復欠款付款時紀錄建立被取消 (debt ${debt.id})`
                            )
                        }
                    }
                    updatedPayments.push(payment)
                }

                if (updated) {
                    await this.updateDebt(debt.id, {
                        payments: updatedPayments,
                    })
                }

                if (onProgress)
                    onProgress({
                        current,
                        total,
                        repairedCount,
                        phase: 'repair',
                    })
            }

            return { repairedCount, scanned: total }
        } catch (error) {
            console.error('修復欠款紀錄失敗:', error)
            throw error
        }
    }

    // Get debt summary by contact
    async getDebtSummary() {
        try {
            const debts = await this.getDebts({ settled: false })
            const contacts = await this.getContacts()

            let totalReceivable = 0
            let totalPayable = 0
            const byContact = {}

            for (const debt of debts) {
                // Use remainingAmount for calculations, fallback to originalAmount for backward compatibility
                const amount =
                    debt.remainingAmount ??
                    debt.originalAmount ??
                    debt.amount ??
                    0

                if (debt.type === 'receivable') {
                    totalReceivable += amount
                } else {
                    totalPayable += amount
                }

                if (!byContact[debt.contactId]) {
                    const contact = contacts.find(
                        c => String(c.id) === String(debt.contactId)
                    )
                    byContact[debt.contactId] = {
                        contact: contact || {
                            id: debt.contactId,
                            name: '未知聯絡人',
                        },
                        receivable: 0,
                        payable: 0,
                        debts: [],
                    }
                }

                if (debt.type === 'receivable') {
                    byContact[debt.contactId].receivable += amount
                } else {
                    byContact[debt.contactId].payable += amount
                }
                byContact[debt.contactId].debts.push(debt)
            }

            return {
                totalReceivable,
                totalPayable,
                byContact: Object.values(byContact),
            }
        } catch (error) {
            console.error('Failed to get debt summary:', error)
            return { totalReceivable: 0, totalPayable: 0, byContact: [] }
        }
    }

    // ==================== 帳本管理 ====================

    /**
     * 切換當前帳本
     * @param {number} ledgerId
     */
    setActiveLedger(ledgerId) {
        this.activeLedgerId = ledgerId
        localStorage.setItem('activeLedgerId', String(ledgerId))
    }

    /**
     * 新增帳本
     * @param {object} ledger { name, icon, color, type }
     * @returns {Promise<number>} 新帳本 ID
     */
    async addLedger(ledger, skipLog = false) {
        try {
            const data = {
                name: ledger.name,
                icon: ledger.icon || 'fa-solid fa-book',
                color: ledger.color || '#334A52',
                type: ledger.type || 'personal',
                uuid: ledger.uuid || this.generateUUID(),
                createdAt: Date.now(),
            }
            const tx = this.db.transaction('ledgers', 'readwrite')
            const id = await tx.store.add(data)
            await tx.done
            if (!skipLog)
                await this.logChange('add', 'ledgers', id, { ...data, id })
            return id
        } catch (error) {
            console.error('Failed to add ledger:', error)
            throw error
        }
    }

    /**
     * 取得單一帳本
     * @param {number} id
     */
    async getLedger(id) {
        try {
            return await this.db.get('ledgers', id)
        } catch (error) {
            console.error(`Failed to get ledger ${id}:`, error)
            return null
        }
    }

    /**
     * 取得所有帳本
     * @returns {Promise<Array>}
     */
    async getLedgers() {
        try {
            return await this.db.getAll('ledgers')
        } catch (error) {
            console.error('Failed to get ledgers:', error)
            return []
        }
    }

    /**
     * 更新帳本
     * @param {number} id
     * @param {object} updates
     */
    async updateLedger(id, updates, skipLog = false) {
        try {
            const tx = this.db.transaction('ledgers', 'readwrite')
            const ledger = await tx.store.get(id)
            if (!ledger) throw new Error('Ledger not found')
            const finalUpdates = { ...updates }
            if (skipLog) {
                delete finalUpdates.id
                if (ledger.uuid) finalUpdates.uuid = ledger.uuid
            }
            const updated = { ...ledger, ...finalUpdates }
            await tx.store.put(updated)
            await tx.done
            if (!skipLog) await this.logChange('update', 'ledgers', id, updated)
            return updated
        } catch (error) {
            console.error(`Failed to update ledger ${id}:`, error)
            throw error
        }
    }

    /**
     * 刪除帳本 + 連帶刪除所有歸屬該帳本的資料
     * @param {number} id 帳本 ID（不可刪除預設帳本 id=1）
     */
    async deleteLedger(id, skipLog = false) {
        if (id === 1) throw new Error('不可刪除預設帳本')
        try {
            // 連帶刪除歸屬此帳本的所有資料
            const dataStores = [
                'records',
                'accounts',
                'contacts',
                'debts',
                'recurring_transactions',
                'amortizations',
                'credit_statements',
                'groupMeta',
            ]
            for (const storeName of dataStores) {
                const tx = this.db.transaction(storeName, 'readwrite')
                const index = tx.store.index('ledgerId')
                let cursor = await index.openCursor(IDBKeyRange.only(id))
                while (cursor) {
                    await cursor.delete()
                    cursor = await cursor.continue()
                }
                await tx.done
            }

            const tx = this.db.transaction('ledgers', 'readwrite')
            let uuid = null
            let sharedManifestId = null
            const ledger = await tx.store.get(id)
            if (ledger) {
                uuid = ledger.uuid
                sharedManifestId = ledger.sharedManifestId
            }
            await tx.store.delete(id)
            await tx.done

            // 清理共用帳本之設定與快取旗標，防止殘留造成殭屍狀態
            if (uuid) {
                const devLogKey = `sync_shared_devlog_${uuid}`
                const devLogSetting = await this.getSetting(devLogKey)
                const devLogId = devLogSetting?.value
                await this.saveSetting({ key: devLogKey, value: null })
                await this.saveSetting({
                    key: `shared_migrated_${uuid}`,
                    value: null,
                })
                await this.saveSetting({
                    key: `sync_shared_member_checked_${uuid}`,
                    value: null,
                })
                await this.saveSetting({
                    key: `sync_shared_incomplete_${uuid}`,
                    value: null,
                })
                await this.saveSetting({
                    key: `sync_shared_granted_${uuid}`,
                    value: null,
                })
                if (devLogId) {
                    await this.saveSetting({
                        key: `sync_shared_granted_${uuid}_${devLogId}`,
                        value: null,
                    })
                }
            }
            if (sharedManifestId) {
                await this.saveSetting({
                    key: `sync_manifest_pending_${sharedManifestId}`,
                    value: null,
                })
            }

            // #BUDGET-KEY-H6：一併清除該帳本的預算設定（IndexedDB + localStorage 快取）。
            // ledgers store 為 autoIncrement，若不時時清除，刪除帳本 2 後新建的帳本
            // 可能再次取得 id 2，直接繼承前朝帳本的預算變成「殭屍預算」。
            await this.saveSetting({ key: `budget_settings_${id}`, value: null })
            try {
                localStorage.removeItem(`monthlyBudget_${id}`)
                localStorage.removeItem(`categoryBudgets_${id}`)
                localStorage.removeItem(`categoryBudgetOrder_${id}`)
                localStorage.removeItem(`excludedBudgetCategories_${id}`)
            } catch (_) {
                /* localStorage 不可用時忽略，IndexedDB 已是唯一真相源 */
            }

            if (!skipLog)
                await this.logChange('delete', 'ledgers', id, { uuid })

            // 若當前帳本被刪除，切回預設帳本
            if (this.activeLedgerId === id) {
                this.setActiveLedger(1)
            }
            return true
        } catch (error) {
            console.error(`Failed to delete ledger ${id}:`, error)
            throw error
        }
    }
}

export default DataService

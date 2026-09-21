// ==================== 帳本管理器 ====================
// 負責帳本的商業邏輯：建立、切換、刪除

import { showToast } from './utils.js'

// 預設帳本顏色選項
const LEDGER_COLORS = [
    '#334A52',
    '#4F46E5',
    '#059669',
    '#D97706',
    '#DC2626',
    '#7C3AED',
    '#2563EB',
    '#DB2777',
    '#0891B2',
    '#65A30D',
    '#EA580C',
    '#6366F1',
]

// 預設帳本圖示選項
const LEDGER_ICONS = [
    'fa-solid fa-book',
    'fa-solid fa-briefcase',
    'fa-solid fa-house',
    'fa-solid fa-heart',
    'fa-solid fa-car',
    'fa-solid fa-plane',
    'fa-solid fa-gamepad',
    'fa-solid fa-graduation-cap',
    'fa-solid fa-piggy-bank',
    'fa-solid fa-store',
    'fa-solid fa-baby',
    'fa-solid fa-utensils',
    'fa-solid fa-gift',
    'fa-solid fa-paw',
    'fa-solid fa-building',
    'fa-solid fa-users',
]

export class LedgerManager {
    /**
     * @param {import('./dataService.js').default} dataService
     * @param {object} app  主應用程式實例
     */
    constructor(dataService, app) {
        this.dataService = dataService
        this.app = app
        this.ledgers = []
    }

    /** 初始化：載入所有帳本清單 */
    async init() {
        this.ledgers = await this.dataService.getLedgers()
    }

    /** 取得當前帳本物件 */
    getActiveLedger() {
        return (
            this.ledgers.find(l => l.id === this.dataService.activeLedgerId) ||
            this.ledgers[0]
        )
    }

    /** 取得所有帳本 */
    getAllLedgers() {
        return this.ledgers
    }

    /**
     * 切換帳本 → 更新 DataService.activeLedgerId，重新載入頁面
     * @param {number} ledgerId
     */
    async switchLedger(ledgerId) {
        const ledger = await this.dataService.getLedger(ledgerId)
        if (!ledger) {
            showToast('帳本不存在', 'error')
            return
        }
        this.dataService.setActiveLedger(ledgerId)

        // 重新載入帳戶清單（因為帳戶歸屬帳本）
        if (this.app.advancedModeEnabled) {
            this.app.accounts = await this.dataService.getAccounts()
            // 只有個人帳本在沒有帳戶時才自動建立預設現金帳戶
            // 共用帳本的帳戶應透過同步機制從擁有者取得，避免 UUID 不一致
            if (this.app.accounts.length === 0 && !ledger.isShared) {
                await this.dataService.addAccount({
                    name: '現金',
                    balance: 0,
                    type: 'cash',
                    icon: 'fa-solid fa-money-bill-wave',
                    color: 'bg-green-500',
                    ledgerId: ledgerId,
                })
                this.app.accounts = await this.dataService.getAccounts()
            }
        }

        if (this.app.budgetManager) {
            await this.app.budgetManager.loadBudget()
        }

        // 重新載入分類設定（因為分類現在是 per-ledger）
        if (this.app.categoryManager) {
            await this.app.categoryManager.init()
        }

        // 導航回首頁並強制重新渲染
        if (this.app.updateSidebarLedger) {
            this.app.updateSidebarLedger()
        }

        const currentHash = window.location.hash || '#home'

        if (this.app.router) {
            this.app.router.currentHash = null // 清除 currentHash 強制重新渲染
        }
        this.app.currentHash = null // 舊的備用清除

        if (currentHash === '#home') {
            // 如果已經在首頁，指派 location.hash 不會觸發 change 事件
            if (this.app.router) {
                await this.app.router.handleRouteChange()
            } else {
                window.dispatchEvent(new HashChangeEvent('hashchange'))
            }
        } else {
            window.location.hash = '#home'
        }

        showToast(`已切換至「${ledger.name}」`, 'success')
    }

    /**
     * 新增帳本
     * @param {{ name: string, icon?: string, color?: string }} data
     * @returns {Promise<number>} 新帳本 ID
     */
    async createLedger(data) {
        // 檢查名稱不重複
        const existing = this.ledgers.find(l => l.name === data.name)
        if (existing) throw new Error('已存在同名帳本')

        const id = await this.dataService.addLedger({
            name: data.name,
            icon: data.icon || 'fa-solid fa-book',
            color:
                data.color ||
                LEDGER_COLORS[this.ledgers.length % LEDGER_COLORS.length],
            type: 'personal',
        })

        // 為新帳本建立預設現金帳戶
        await this.dataService.addAccount({
            name: '現金',
            balance: 0,
            type: 'cash',
            icon: 'fa-solid fa-money-bill-wave',
            color: 'bg-green-500',
            ledgerId: id,
        })

        await this.init() // 重新載入
        return id
    }

    /**
     * 更新帳本
     * @param {number} id
     * @param {object} updates
     */
    async updateLedger(id, updates) {
        await this.dataService.updateLedger(id, updates)
        await this.init()
    }

    /**
     * 刪除帳本（預設帳本不可刪除）
     * @param {number} id
     */
    async deleteLedger(id) {
        await this.dataService.deleteLedger(id)
        await this.init()
    }

    /**
     * 將指定的帳本轉為共用，並邀請外部 Email
     * @param {number} ledgerId
     * @param {string} email
     * @returns {Promise<string>}
     */
    async shareLedger(ledgerId, email) {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            throw new Error('請先在設定中登入 Google 同步功能')
        }

        const ledger = await this.dataService.getLedger(ledgerId)
        if (!ledger) throw new Error('帳本不存在')

        let fileId = ledger.sharedFileId

        if (ledger.isShared && (fileId || ledger.sharedManifestId)) {
            const isOwner = await this.isLedgerOwner(ledgerId)
            if (!isOwner) {
                throw new Error('只有帳本擁有者可以分享或邀請成員')
            }
            // 已共用帳本：對舊檔、manifest 與自己的日誌檔補授權
            if (fileId) {
                await this.app.syncService.grantFilePermission(fileId, email)
            }
            if (ledger.sharedManifestId) {
                await this.app.syncService.grantFilePermission(
                    ledger.sharedManifestId,
                    email
                )
                try {
                    await this.app.syncService.unblockManifestMember(
                        ledger.sharedManifestId,
                        email
                    )
                } catch (_) {}
            }
            const devLogKey = `sync_shared_devlog_${ledger.uuid}`
            let devLogId = null
            if (typeof this.dataService?.getSetting === 'function') {
                devLogId = (await this.dataService.getSetting(devLogKey))?.value
            }
            if (devLogId) {
                await this.app.syncService.grantFilePermission(
                    devLogId,
                    email,
                    'reader'
                )
                try {
                    const grantedKey = `sync_shared_granted_${ledger.uuid}_${devLogId}`
                    const grantedSetting =
                        await this.dataService.getSetting(grantedKey)
                    const grantedList = Array.isArray(grantedSetting?.value)
                        ? grantedSetting.value
                        : []
                    if (
                        !grantedList.some(
                            e => e?.toLowerCase() === email.toLowerCase()
                        )
                    ) {
                        await this.dataService.saveSetting({
                            key: grantedKey,
                            value: [...grantedList, email],
                        })
                    }
                } catch (_) {}
            }
            return ledger.sharedManifestId || fileId
        }

        // 1. 先建立一個空的雲端共用檔案以取得 fileId
        const fileName = `EasyAccounting_Shared_${ledger.uuid}.json`
        const res = await this.app.syncService._createSharedFile(fileName, '{}')
        fileId = res.id

        // 2. 授權 Google Drive 檔案
        await this.app.syncService.grantFilePermission(fileId, email)

        // 3. 先更新本地帳本狀態為共用（這樣 export 出來的資料才會戴上正確的 isShared 和 sharedFileId）
        await this.dataService.updateLedger(ledgerId, {
            isShared: true,
            sharedFileId: fileId,
            type: 'shared',
        })
        await this.init()

        // 4. 匯出完整帳本資料作為雲端共享檔案的初始內容
        const exported = await this.dataService.exportDataForSync({
            sharedLedgerUuid: ledger.uuid,
        })
        const changes = []

        const deviceId = this.app.syncService.deviceId
        const now = Date.now()
        // 依固定拓撲順序建立所有資料 store 的初始 changes，
        // 與 applyRemoteChanges 的 topoOrder 保持一致（groupMeta 在 records 之前）。
        // 使用迴圈遍歷避免新增 store 時遺漏（曾遺漏 groupMeta）。
        const storeOrder = [
            'ledgers',
            'groupMeta',
            'accounts',
            'contacts',
            'debts',
            'recurring_transactions',
            'amortizations',
            'credit_statements',
            'records',
        ]
        for (const storeName of storeOrder) {
            const items = exported[storeName]
            if (!Array.isArray(items)) continue
            items.forEach(item =>
                changes.push({
                    deviceId,
                    operation: 'add',
                    storeName,
                    data: item,
                    timestamp: now,
                })
            )
        }

        const initSyncData = {
            deviceId,
            timestamp: now,
            changes,
        }

        // 5. 將初始內容寫入已準備好的雲端檔案中
        await this.app.syncService._updateFile(
            fileId,
            JSON.stringify(initSyncData)
        )

        // 6. 建立新架構基礎設施（manifest + 自己的裝置日誌檔）
        //    _ensureSharedInfra 會把剛寫入舊檔的初始變更併入自己的日誌，
        //    並把 manifest 指標寫回舊檔
        const updatedLedger = await this.dataService.getLedger(ledgerId)
        const infra =
            await this.app.syncService._ensureSharedInfra(updatedLedger)

        // 7. 同時對受邀者授權 manifest 與自己的日誌檔，避免權限死鎖
        if (infra?.manifestId) {
            await this.app.syncService.grantFilePermission(
                infra.manifestId,
                email
            )
            try {
                await this.app.syncService.unblockManifestMember(
                    infra.manifestId,
                    email
                )
            } catch (_) {}
        }
        if (infra?.devLogId) {
            await this.app.syncService.grantFilePermission(
                infra.devLogId,
                email,
                'reader'
            )
        }

        // 確保共用帳本同步已啟動
        await this.app.syncService.ensureSharedSync()

        return infra?.manifestId || fileId
    }

    /**
     * 加入共用帳本
     * @param {string} fileId
     */
    async joinSharedLedger(fileId) {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            throw new Error('請先在設定中登入 Google 同步功能')
        }

        const res = await this.app.syncService._downloadFile(fileId)
        const fileData = res?.data

        // ── 新架構：manifest 成員清單檔 ──
        if (fileData?.members) {
            const uuid = await this.app.syncService.joinViaManifest(fileId)
            await this.init()
            const ledger = this.ledgers.find(l => l.uuid === uuid)
            if (!ledger) throw new Error('無法從共用資料解析帳本')
            await this.dataService.updateLedger(ledger.id, {
                isShared: true,
                sharedManifestId: fileId,
                sharedFileId: fileData.legacySharedFileId || null,
                type: 'shared',
            })
            await this.init()
            await this.app.syncService.ensureSharedSync()
            return ledger.id
        }

        // ── 舊架構：單一共用變更檔 ──
        if (!fileData || !fileData.changes) {
            throw new Error('無效的共用帳本檔案或無讀取權限')
        }

        // Apply shared data changes
        await this.app.syncService.applyRemoteChanges(fileData.changes)

        // Find the ledger added from changes
        const ledgerChanges = fileData.changes.filter(
            c =>
                c.storeName === 'ledgers' &&
                (c.operation === 'add' || c.operation === 'update')
        )
        if (ledgerChanges.length > 0) {
            const uuid = ledgerChanges[0].data.uuid
            await this.init()
            const ledger = this.ledgers.find(l => l.uuid === uuid)
            if (ledger) {
                // Mark local copy as shared and store fileId
                await this.dataService.updateLedger(ledger.id, {
                    isShared: true,
                    sharedFileId: fileId,
                    sharedManifestId: fileData.manifestFileId || null,
                    type: 'shared',
                })
                await this.init()

                // 確保共用帳本同步已啟動
                await this.app.syncService.ensureSharedSync()

                return ledger.id
            }
        }
        throw new Error('無法從共用檔案解析帳本資訊')
    }

    /**
     * 取得共用帳本的所有授權對象
     * @param {number} ledgerId
     * @returns {Promise<Array>}
     */
    async getSharedUsers(ledgerId) {
        const ledger = await this.dataService.getLedger(ledgerId)
        if (!ledger || (!ledger.sharedFileId && !ledger.sharedManifestId)) {
            throw new Error('此帳本尚未共用')
        }
        if (ledger?.sharedManifestId) {
            let drivePerms = []
            try {
                drivePerms =
                    (await this.app.syncService.getFilePermissions(
                        ledger.sharedManifestId
                    )) || []
            } catch (_) {}

            const driveOwner = Array.isArray(drivePerms)
                ? drivePerms.find(p => p.role === 'owner')
                : null
            const verifiedOwnerEmail = driveOwner?.emailAddress

            let manifest = null
            try {
                manifest = (
                    await this.app.syncService._downloadFile(
                        ledger.sharedManifestId
                    )
                )?.data
            } catch (_) {}

            const effectiveOwnerEmail =
                verifiedOwnerEmail || manifest?.ownerEmail

            const memberList = (manifest?.members || []).map((m, i) => ({
                id: m.deviceId,
                emailAddress: m.ownerEmail,
                displayName: '',
                // 優先以 Drive 伺服器端驗證的 owner 判定；否則頂層 ownerEmail；否則退回位置判定
                role: effectiveOwnerEmail
                    ? m.ownerEmail &&
                      m.ownerEmail.toLowerCase() ===
                          effectiveOwnerEmail.toLowerCase()
                        ? 'owner'
                        : 'writer'
                    : i === 0
                      ? 'owner'
                      : 'writer',
            }))

            // 合併 Google Drive 尚未註冊進 manifest 的已邀請使用者（如受邀但尚未開啟 App 加入者）
            const knownEmails = new Set(
                memberList.map(m => m.emailAddress?.toLowerCase()).filter(Boolean)
            )
            for (const perm of drivePerms || []) {
                if (
                    perm.emailAddress &&
                    !knownEmails.has(perm.emailAddress.toLowerCase())
                ) {
                    memberList.push({
                        id: perm.id,
                        emailAddress: perm.emailAddress,
                        displayName: perm.displayName || '',
                        role: perm.role === 'owner' ? 'owner' : 'writer',
                    })
                    knownEmails.add(perm.emailAddress.toLowerCase())
                }
            }

            return memberList
        }
        return await this.app.syncService.getFilePermissions(
            ledger.sharedFileId
        )
    }

    /**
     * 移除共用帳本的某個授權對象
     * @param {number} ledgerId
     * @param {string} memberId
     */
    async removeSharedUser(ledgerId, memberId) {
        const ledger = await this.dataService.getLedger(ledgerId)
        if (!ledger || (!ledger.sharedFileId && !ledger.sharedManifestId)) {
            throw new Error('此帳本尚未共用')
        }
        const isOwner = await this.isLedgerOwner(ledgerId)
        if (!isOwner) {
            throw new Error('只有帳本擁有者可以移除成員')
        }
        if (ledger?.sharedManifestId) {
            let removedEmail = null
            try {
                const manifest = (
                    await this.app.syncService._downloadFile(
                        ledger.sharedManifestId
                    )
                )?.data
                const target = manifest?.members?.find(
                    m => m.deviceId === memberId
                )
                if (target?.ownerEmail) {
                    removedEmail = target.ownerEmail
                }
            } catch (_) {}

            if (!removedEmail) {
                try {
                    const manifestPerms =
                        await this.app.syncService.getFilePermissions(
                            ledger.sharedManifestId
                        )
                    const p = manifestPerms.find(
                        x => x.id === memberId || x.emailAddress === memberId
                    )
                    if (p?.emailAddress) {
                        removedEmail = p.emailAddress
                    }
                } catch (_) {}
            }

            const removed = await this.app.syncService.removeManifestMember(
                ledger.sharedManifestId,
                memberId,
                removedEmail
            )
            if (!removed) {
                throw new Error('移除成員失敗，可能是並行衝突或網路錯誤')
            }
            if (removedEmail) {
                // 撤銷該成員在 Google Drive Manifest、舊檔案及本地 devLog 上的權限
                try {
                    const manifestPerms =
                        await this.app.syncService.getFilePermissions(
                            ledger.sharedManifestId
                        )
                    const p = manifestPerms.find(
                        x => x.emailAddress === removedEmail
                    )
                    if (p) {
                        await this.app.syncService.removeFilePermission(
                            ledger.sharedManifestId,
                            p.id
                        )
                    }
                } catch (e) {
                    console.warn('[LedgerManager] 撤銷 Manifest 權限失敗:', e)
                }

                if (ledger.sharedFileId) {
                    try {
                        const filePerms =
                            await this.app.syncService.getFilePermissions(
                                ledger.sharedFileId
                            )
                        const p = filePerms.find(
                            x => x.emailAddress === removedEmail
                        )
                        if (p) {
                            await this.app.syncService.removeFilePermission(
                                ledger.sharedFileId,
                                p.id
                            )
                        }
                    } catch (e) {
                        console.warn('[LedgerManager] 撤銷共用舊檔權限失敗:', e)
                    }
                }

                try {
                    const devLogKey = `sync_shared_devlog_${ledger.uuid}`
                    const devLogId = (
                        await this.dataService.getSetting(devLogKey)
                    )?.value
                    if (devLogId) {
                        const devLogPerms =
                            await this.app.syncService.getFilePermissions(
                                devLogId
                            )
                        const p = devLogPerms.find(
                            x => x.emailAddress === removedEmail
                        )
                        if (p) {
                            await this.app.syncService.removeFilePermission(
                                devLogId,
                                p.id
                            )
                        }
                    }
                } catch (e) {
                    console.warn('[LedgerManager] 撤銷日誌檔權限失敗:', e)
                }

                // 清理本機已授權快取，確保日後重新邀請/加入時能正確重新授予 DevLog 讀取權限
                try {
                    const devLogKey = `sync_shared_devlog_${ledger.uuid}`
                    const devLogId = (
                        await this.dataService.getSetting(devLogKey)
                    )?.value
                    const keysToClean = [
                        `sync_shared_granted_${ledger.uuid}`,
                    ]
                    if (devLogId) {
                        keysToClean.push(
                            `sync_shared_granted_${ledger.uuid}_${devLogId}`
                        )
                    }
                    for (const k of keysToClean) {
                        const setting = await this.dataService.getSetting(k)
                        if (setting?.value && Array.isArray(setting.value)) {
                            const updated = setting.value.filter(
                                e =>
                                    e?.toLowerCase() !==
                                    removedEmail.toLowerCase()
                            )
                            await this.dataService.saveSetting({
                                key: k,
                                value: updated,
                            })
                        }
                    }
                } catch (cleanErr) {
                    console.warn(
                        '[LedgerManager] 清理已授權快取失敗:',
                        cleanErr
                    )
                }
            } else {
                // 如果在 manifest 沒找到對應 deviceId，嘗試當作 Drive permissionId 撤銷
                try {
                    await this.app.syncService.removeFilePermission(
                        ledger.sharedManifestId,
                        memberId
                    )
                } catch (_) {}
            }
            return
        }
        await this.app.syncService.removeFilePermission(
            ledger.sharedFileId,
            memberId
        )
    }

    /**
     * 判斷當前使用者是否為該共用帳本的擁有者
     * @param {number} ledgerId
     * @returns {Promise<boolean>}
     */
    async isLedgerOwner(ledgerId) {
        try {
            const myEmail = this.app.syncService.userInfo?.email
            if (!myEmail) return false

            const ledger = await this.dataService.getLedger(ledgerId)
            if (!ledger) return false

            const targetFileId =
                ledger.sharedManifestId || ledger.sharedFileId
            if (targetFileId) {
                // 優先使用 Google Drive 伺服器端授權 (writer 無法竄改 role === 'owner')
                try {
                    const drivePerms =
                        await this.app.syncService.getFilePermissions(
                            targetFileId
                        )
                    if (Array.isArray(drivePerms) && drivePerms.length > 0) {
                        const driveOwner = drivePerms.find(
                            p => p.role === 'owner'
                        )
                        if (driveOwner?.emailAddress) {
                            return (
                                driveOwner.emailAddress.toLowerCase() ===
                                myEmail.toLowerCase()
                            )
                        }
                    }
                    return false
                } catch (e) {
                    console.warn(
                        '[LedgerManager] 取得雲端權限失敗，採用 Fail-Closed 拒絕判定:',
                        e
                    )
                    return false
                }
            }

            return false
        } catch {
            return false
        }
    }

    /**
     * 取消共用帳本（擁有者專用）
     * 刪除雲端共享檔案並將帳本還原為個人帳本
     * @param {number} ledgerId
     */
    async unshareLedger(ledgerId) {
        const ledger = await this.dataService.getLedger(ledgerId)
        if (!ledger || (!ledger.sharedFileId && !ledger.sharedManifestId)) {
            throw new Error('此帳本尚未共用')
        }

        // 確認是擁有者
        const isOwner = await this.isLedgerOwner(ledgerId)
        if (!isOwner) throw new Error('只有擁有者才能取消共用')

        // 清理新架構檔案：自己的日誌檔 + manifest（擁有者才有 manifest 刪除權）
        try {
            const devLogKey = `sync_shared_devlog_${ledger.uuid}`
            const devLogId = (
                await this.dataService.getSetting(devLogKey)
            )?.value
            if (devLogId) {
                await this.app.syncService.deleteFile(devLogId)
                await this.dataService.saveSetting({
                    key: devLogKey,
                    value: null,
                })
            }
            if (ledger.sharedManifestId) {
                await this.app.syncService.deleteFile(ledger.sharedManifestId)
            }
            await this.dataService.saveSetting({
                key: `shared_migrated_${ledger.uuid}`,
                value: null,
            })
        } catch (e) {
            console.warn('[LedgerManager] 清理共用基礎設施失敗:', e)
        }

        // 刪除雲端檔案（若有）
        if (ledger.sharedFileId) {
            try {
                await this.app.syncService.deleteFile(ledger.sharedFileId)
            } catch (e) {
                console.warn('[LedgerManager] 刪除共用舊檔失敗:', e)
            }
        }

        // 將本地帳本還原為個人帳本
        await this.dataService.updateLedger(ledgerId, {
            isShared: false,
            sharedFileId: null,
            sharedManifestId: null,
            type: 'personal',
        })
        await this.init()
    }

    /** 取得可用的顏色選項 */
    getColorOptions() {
        return LEDGER_COLORS
    }

    /** 取得可用的圖示選項 */
    getIconOptions() {
        return LEDGER_ICONS
    }
}

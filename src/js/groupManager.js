import { showToast } from './utils.js'

/**
 * 產生不重複的群組名稱，若已有同名群組則自動加上 (2), (3) 等後綴
 * @param {string} rawName - 原始輸入名稱
 * @param {Array<string>} existingNames - 已存在的群組名稱集合
 * @returns {string} 處理後不重複的名稱
 */
export function getUniqueGroupName(rawName, existingNames = []) {
    const trimmed = (rawName || '').trim()
    if (!trimmed) return '未命名群組'

    let base = trimmed
    const match = trimmed.match(/^(.*?)\s*\((\d+)\)$/)
    if (match) {
        base = match[1].trim()
    }

    const nameSet = new Set(existingNames.map(n => (n || '').trim()))

    if (!nameSet.has(trimmed)) {
        return trimmed
    }

    let counter = 2
    let candidate = `${base} (${counter})`
    while (nameSet.has(candidate)) {
        counter++
        candidate = `${base} (${counter})`
    }

    return candidate
}

export class GroupManager {
    constructor(dataService, appRef = null) {
        this.dataService = dataService
        this.appRef = appRef // reference to EasyAccountingApp (for UI callbacks)
    }

    /**
     * 建立新群組 (自動對重複名稱加上 (2), (3) 編號後綴)
     * @param {string} name - 群組名稱
     * @param {number} [ledgerId] - 帳本 ID，預設為當前帳本
     * @returns {Promise<string>} groupId
     */
    async createGroup(name, ledgerId = null) {
        const targetLedgerId = ledgerId || this.dataService.activeLedgerId
        const existingMetas = await this.dataService.getAllGroupMeta(targetLedgerId)
        const existingNames = existingMetas.map(g => g.name)
        const uniqueName = getUniqueGroupName(name, existingNames)

        const id = crypto.randomUUID()
        const meta = {
            id,
            name: uniqueName,
            createdAt: Date.now(),
            settled: false,
            settledAt: null,
            ledgerId: targetLedgerId,
        }
        await this.dataService.saveGroupMeta(meta)
        return id
    }

    /**
     * 刪除群組（groupMeta 刪除，records 的 groupId 設為 null）
     * @param {string} groupId
     * @returns {Promise<boolean>}
     */
    async deleteGroup(groupId) {
        await this.dataService.deleteGroupMeta(groupId)
        return true
    }

    /**
     * 重新命名群組 (自動對重複名稱加上 (2), (3) 編號後綴)
     * @param {string} groupId
     * @param {string} newName
     * @returns {Promise<boolean>}
     */
    async renameGroup(groupId, newName) {
        const meta = await this.dataService.getGroupMeta(groupId)
        if (!meta) return false

        const existingMetas = await this.dataService.getAllGroupMeta(meta.ledgerId)
        const existingNames = existingMetas.filter(g => g.id !== groupId).map(g => g.name)
        const uniqueName = getUniqueGroupName(newName, existingNames)

        await this.dataService.saveGroupMeta({
            ...meta,
            name: uniqueName,
        })
        return true
    }

    /**
     * 取得未結清群組列表
     * @param {number} [ledgerId]
     * @returns {Promise<Array>}
     */
    async getUnsettledGroups(ledgerId = null) {
        const groups = await this.dataService.getGroups(ledgerId)
        return groups.filter(g => !g.settled && g.netAmount !== 0)
    }

    /**
     * 取得已結清群組列表
     * @param {number} [ledgerId]
     * @returns {Promise<Array>}
     */
    async getSettledGroups(ledgerId = null) {
        const groups = await this.dataService.getGroups(ledgerId)
        return groups.filter(g => g.settled)
    }

    /**
     * 取得群組即時統計摘要
     * @param {string} groupId
     * @returns {Promise<Object|null>}
     */
    async getGroupSummary(groupId) {
        const groups = await this.dataService.getGroups()
        return groups.find(g => g.id === groupId) || null
    }

    /**
     * 加入紀錄到群組
     * @param {number|string} recordId
     * @param {string} groupId
     * @returns {Promise<boolean>}
     */
    async addRecordToGroup(recordId, groupId) {
        const meta = await this.dataService.getGroupMeta(groupId)
        if (!meta) return false
        if (meta.settled) {
            showToast('已結清的群組無法加入新紀錄')
            return false
        }
        const records = await this.dataService.getRecords()
        const record = records.find(r => r.id === recordId)
        if (!record) return false

        record.groupId = groupId
        record.groupStatus = 'active'
        record.ledgerId = meta.ledgerId
        await this.dataService.updateRecord(record)
        return true
    }

    /**
     * 從群組移除紀錄
     * @param {number|string} recordId
     * @returns {Promise<boolean>}
     */
    async removeRecordFromGroup(recordId) {
        const records = await this.dataService.getRecords()
        const record = records.find(r => r.id === recordId)
        if (!record || !record.groupId) return false

        record.groupId = null
        record.groupStatus = null
        await this.dataService.updateRecord(record)
        return true
    }

    /**
     * 結清群組（產生結清紀錄 + 標記群組 settled）
     * @param {string} groupId
     * @param {number} [settleAmount] - 結清金額（可覆蓋自動計算）
     * @param {number} accountId
     * @param {string} date
     * @param {string} [note]
     * @returns {Promise<Object>}
     */
    async settleGroup(groupId, settleAmount, accountId, date, note) {
        return await this.dataService.settleGroup(
            groupId,
            settleAmount,
            accountId,
            date,
            note
        )
    }

    /**
     * 部分退款
     * @param {string} groupId
     * @param {number} amount
     * @param {number} accountId
     * @param {string} date
     * @param {string} [note]
     * @returns {Promise<Object>}
     */
    /**
     * 部分退款
     * @param {string} groupId
     * @param {number} amount
     * @param {number} accountId
     * @param {string} date
     * @param {string} [note]
     * @returns {Promise<Object>}
     */
    async partialSettleGroup(groupId, amount, accountId, date, note) {
        return await this.dataService.partialSettleGroup(
            groupId,
            amount,
            accountId,
            date,
            note
        )
    }

    /**
     * 單筆紀錄個別還款/結清
     * @param {number|string} recordId
     * @param {number} [accountId]
     * @param {string} [date]
     * @param {string} [note]
     * @returns {Promise<Object>}
     */
    async settleGroupRecord(recordId, accountId, date, note) {
        return await this.dataService.settleGroupRecord(
            recordId,
            accountId,
            date,
            note
        )
    }
}
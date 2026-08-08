// 群組管理模組
import { formatCurrency, formatDate, showToast } from './utils.js'

export class GroupManager {
    constructor(dataService, appRef = null) {
        this.dataService = dataService
        this.appRef = appRef // reference to EasyAccountingApp (for UI callbacks)
    }

    /**
     * 建立新群組
     * @param {string} name - 群組名稱
     * @param {number} [ledgerId] - 帳本 ID，預設為當前帳本
     * @returns {Promise<string>} groupId
     */
    async createGroup(name, ledgerId = null) {
        const id = crypto.randomUUID()
        const meta = {
            id,
            name: name.trim(),
            createdAt: Date.now(),
            settled: false,
            settledAt: null,
            ledgerId: ledgerId || this.dataService.activeLedgerId,
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
     * 重新命名群組
     * @param {string} groupId
     * @param {string} newName
     * @returns {Promise<boolean>}
     */
    async renameGroup(groupId, newName) {
        const meta = await this.dataService.getGroupMeta(groupId)
        if (!meta) return false
        await this.dataService.saveGroupMeta({
            ...meta,
            name: newName.trim(),
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
        return groups.filter(g => !g.settled)
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
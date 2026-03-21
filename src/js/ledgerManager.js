// ==================== 帳本管理器 ====================
// 負責帳本的商業邏輯：建立、切換、刪除

import { showToast } from './utils.js';

// 預設帳本顏色選項
const LEDGER_COLORS = [
    '#334A52', '#4F46E5', '#059669', '#D97706',
    '#DC2626', '#7C3AED', '#2563EB', '#DB2777',
    '#0891B2', '#65A30D', '#EA580C', '#6366F1',
];

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
];

export class LedgerManager {
    /**
     * @param {import('./dataService.js').default} dataService
     * @param {object} app  主應用程式實例
     */
    constructor(dataService, app) {
        this.dataService = dataService;
        this.app = app;
        this.ledgers = [];
    }

    /** 初始化：載入所有帳本清單 */
    async init() {
        this.ledgers = await this.dataService.getLedgers();
    }

    /** 取得當前帳本物件 */
    getActiveLedger() {
        return this.ledgers.find(l => l.id === this.dataService.activeLedgerId) || this.ledgers[0];
    }

    /** 取得所有帳本 */
    getAllLedgers() {
        return this.ledgers;
    }

    /**
     * 切換帳本 → 更新 DataService.activeLedgerId，重新載入頁面
     * @param {number} ledgerId
     */
    async switchLedger(ledgerId) {
        const ledger = await this.dataService.getLedger(ledgerId);
        if (!ledger) {
            showToast('帳本不存在', 'error');
            return;
        }
        this.dataService.setActiveLedger(ledgerId);

        // 重新載入帳戶清單（因為帳戶歸屬帳本）
        if (this.app.advancedModeEnabled) {
            this.app.accounts = await this.dataService.getAccounts();
            if (this.app.accounts.length === 0) {
                await this.dataService.addAccount({
                    name: '現金',
                    balance: 0,
                    type: 'cash',
                    icon: 'fa-solid fa-money-bill-wave',
                    color: 'bg-green-500',
                    ledgerId: ledgerId
                });
                this.app.accounts = await this.dataService.getAccounts();
            }
        }

        if (this.app.budgetManager) {
            await this.app.budgetManager.loadBudget();
        }

        // 導航回首頁並強制重新渲染
        if (this.app.updateSidebarLedger) {
            this.app.updateSidebarLedger();
        }

        const currentHash = window.location.hash || '#home';
        
        if (this.app.router) {
            this.app.router.currentHash = null; // 清除 currentHash 強制重新渲染
        }
        this.app.currentHash = null; // 舊的備用清除

        if (currentHash === '#home') {
            // 如果已經在首頁，指派 location.hash 不會觸發 change 事件
            if (this.app.router) {
                await this.app.router.handleRouteChange();
            } else {
                window.dispatchEvent(new HashChangeEvent("hashchange"));
            }
        } else {
            window.location.hash = '#home';
        }

        showToast(`已切換至「${ledger.name}」`, 'success');
    }

    /**
     * 新增帳本
     * @param {{ name: string, icon?: string, color?: string }} data
     * @returns {Promise<number>} 新帳本 ID
     */
    async createLedger(data) {
        // 檢查名稱不重複
        const existing = this.ledgers.find(l => l.name === data.name);
        if (existing) throw new Error('已存在同名帳本');

        const id = await this.dataService.addLedger({
            name: data.name,
            icon: data.icon || 'fa-solid fa-book',
            color: data.color || LEDGER_COLORS[this.ledgers.length % LEDGER_COLORS.length],
            type: 'personal',
        });

        // 為新帳本建立預設現金帳戶
        await this.dataService.addAccount({
            name: '現金',
            balance: 0,
            type: 'cash',
            icon: 'fa-solid fa-money-bill-wave',
            color: 'bg-green-500',
            ledgerId: id
        });

        await this.init(); // 重新載入
        return id;
    }

    /**
     * 更新帳本
     * @param {number} id
     * @param {object} updates
     */
    async updateLedger(id, updates) {
        await this.dataService.updateLedger(id, updates);
        await this.init();
    }

    /**
     * 刪除帳本（預設帳本不可刪除）
     * @param {number} id
     */
    async deleteLedger(id) {
        await this.dataService.deleteLedger(id);
        await this.init();
    }

    /**
     * 將指定的帳本轉為共用，並邀請外部 Email
     * @param {number} ledgerId 
     * @param {string} email 
     * @returns {Promise<string>}
     */
    async shareLedger(ledgerId, email) {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            throw new Error('請先在設定中登入 Google 同步功能');
        }
        
        const ledger = await this.dataService.getLedger(ledgerId);
        if (!ledger) throw new Error('帳本不存在');

        let fileId = ledger.sharedFileId;

        if (ledger.isShared && fileId) {
            // Already shared, just add permission
            await this.app.syncService.grantFilePermission(fileId, email);
            return fileId;
        }

        // 首次轉為共用帳本，產生初始備份
        const exported = await this.dataService.exportDataForSync({ sharedLedgerUuid: ledger.uuid });
        const changes = [];
        
        exported.ledgers.forEach(l => changes.push({ operation: 'add', storeName: 'ledgers', data: l, timestamp: Date.now() }));
        exported.accounts.forEach(a => changes.push({ operation: 'add', storeName: 'accounts', data: a, timestamp: Date.now() }));
        exported.contacts.forEach(c => changes.push({ operation: 'add', storeName: 'contacts', data: c, timestamp: Date.now() }));
        exported.debts.forEach(d => changes.push({ operation: 'add', storeName: 'debts', data: d, timestamp: Date.now() }));
        exported.recurring_transactions.forEach(r => changes.push({ operation: 'add', storeName: 'recurring_transactions', data: r, timestamp: Date.now() }));
        exported.records.forEach(r => changes.push({ operation: 'add', storeName: 'records', data: r, timestamp: Date.now() }));
        
        const initSyncData = {
            deviceId: this.app.syncService.deviceId,
            timestamp: Date.now(),
            changes: changes
        };

        const fileName = `EasyAccounting_Shared_${ledger.uuid}.json`;
        const res = await this.app.syncService._createSharedFile(fileName, JSON.stringify(initSyncData));
        fileId = res.id;

        // 授權
        await this.app.syncService.grantFilePermission(fileId, email);

        // 更新本地帳本狀態
        await this.dataService.updateLedger(ledgerId, { isShared: true, sharedFileId: fileId, type: 'shared' });
        await this.init();

        return fileId;
    }

    /**
     * 加入共用帳本
     * @param {string} fileId 
     */
    async joinSharedLedger(fileId) {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            throw new Error('請先在設定中登入 Google 同步功能');
        }

        const fileData = await this.app.syncService._downloadFile(fileId);
        if (!fileData || !fileData.changes) {
            throw new Error('無效的共用帳本檔案或無讀取權限');
        }

        // Apply shared data changes
        await this.app.syncService.applyRemoteChanges(fileData.changes);

        // Find the ledger added from changes
        const ledgerChanges = fileData.changes.filter(c => c.storeName === 'ledgers' && (c.operation === 'add' || c.operation === 'update'));
        if (ledgerChanges.length > 0) {
            const uuid = ledgerChanges[0].data.uuid;
            await this.init();
            const ledger = this.ledgers.find(l => l.uuid === uuid);
            if (ledger) {
                // Mark local copy as shared and store fileId
                await this.dataService.updateLedger(ledger.id, { isShared: true, sharedFileId: fileId, type: 'shared' });
                await this.init();
                
                // Set last pull timestamp so we don't redownload the same logs
                const lastPull = await this.dataService.getSetting('sync_last_pull_timestamps') || { value: {} };
                lastPull.value[`shared_${fileId}`] = Date.now();
                await this.dataService.saveSetting({ key: 'sync_last_pull_timestamps', value: lastPull.value });
                
                return ledger.id;
            }
        }
        throw new Error('無法從共用檔案解析帳本資訊');
    }

    /**
     * 取得共用帳本的所有授權對象
     * @param {number} ledgerId 
     * @returns {Promise<Array>}
     */
    async getSharedUsers(ledgerId) {
        const ledger = await this.dataService.getLedger(ledgerId);
        if (!ledger || !ledger.sharedFileId) throw new Error('此帳本尚未共用');
        return await this.app.syncService.getFilePermissions(ledger.sharedFileId);
    }

    /**
     * 移除共用帳本的某個授權對象
     * @param {number} ledgerId 
     * @param {string} permissionId 
     */
    async removeSharedUser(ledgerId, permissionId) {
        const ledger = await this.dataService.getLedger(ledgerId);
        if (!ledger || !ledger.sharedFileId) throw new Error('此帳本尚未共用');
        await this.app.syncService.removeFilePermission(ledger.sharedFileId, permissionId);
    }

    /** 取得可用的顏色選項 */
    getColorOptions() {
        return LEDGER_COLORS;
    }

    /** 取得可用的圖示選項 */
    getIconOptions() {
        return LEDGER_ICONS;
    }
}

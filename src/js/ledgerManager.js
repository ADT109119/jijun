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

    /** 取得可用的顏色選項 */
    getColorOptions() {
        return LEDGER_COLORS;
    }

    /** 取得可用的圖示選項 */
    getIconOptions() {
        return LEDGER_ICONS;
    }
}

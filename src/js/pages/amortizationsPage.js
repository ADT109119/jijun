// ==================== 攤提/折舊/分期管理頁面 ====================
import { showToast, escapeHTML, calculateAmortizationDetails, customConfirm } from '../utils.js';
import { showAmortizationModal } from '../amortizationModal.js';

// ==================== 常數 ====================
const TYPE_LABELS = {
    installment: { name: '分期付款', icon: 'fa-solid fa-credit-card', color: 'bg-blue-500' },
    depreciation: { name: '折舊', icon: 'fa-solid fa-building', color: 'bg-amber-500' },
    amortization: { name: '攤提', icon: 'fa-solid fa-chart-gantt', color: 'bg-purple-500' },
};

const STATUS_LABELS = {
    active: { name: '進行中', class: 'bg-green-100 text-green-700 border-green-200' },
    paused: { name: '已暫停', class: 'bg-amber-100 text-amber-700 border-amber-200' },
    completed: { name: '已完成', class: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export class AmortizationsPage {
    constructor(app) {
        this.app = app;
        this.statusFilter = 'active';
    }

    // ==================== 頁面渲染 ====================
    async render() {
        const items = await this.app.dataService.getAmortizations();

        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">攤提/分期管理</h2>
                    <button id="add-amort-btn" class="text-wabi-primary hover:text-wabi-accent">
                        <i class="fa-solid fa-plus text-xl"></i>
                    </button>
                </div>
                <div class="p-4 space-y-3 pb-24">
                    <p class="text-xs text-wabi-text-secondary mb-2">
                        <i class="fa-solid fa-circle-info mr-1"></i>
                        管理分期付款、資產折舊、費用攤提，系統會依設定自動記帳。
                    </p>
                    <div class="flex gap-2 mb-3 overflow-x-auto">
                        ${['all', 'active', 'paused', 'completed'].map(s => `
                            <button class="status-filter-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                                ${this.statusFilter === s ? 'bg-wabi-primary text-wabi-surface' : 'bg-wabi-surface text-wabi-text-secondary border border-wabi-border hover:bg-wabi-bg'}"
                                data-status="${s}">
                                ${s === 'all' ? '全部' : STATUS_LABELS[s].name}
                            </button>
                        `).join('')}
                    </div>
                    <div id="amort-list" class="space-y-3">
                        ${await this._renderList(items)}
                    </div>
                </div>
            </div>
        `;
        this._setupListeners();
    }

    // ==================== 清單渲染 ====================
    async _renderList(items) {
        const filtered = this.statusFilter === 'all' ? items : items.filter(a => a.status === this.statusFilter);
        if (filtered.length === 0) {
            return `<div class="text-center py-12 text-wabi-text-secondary">
                <i class="fa-solid fa-receipt text-4xl mb-3 opacity-30"></i>
                <p class="text-sm">尚無攤提/分期項目</p>
            </div>`;
        }
        
        const htmls = await Promise.all(filtered.map(async item => {
            const type = TYPE_LABELS[item.type] || TYPE_LABELS.installment;
            const status = STATUS_LABELS[item.status] || STATUS_LABELS.active;
            const progress = item.periods > 0 ? Math.round((item.completedPeriods / item.periods) * 100) : 0;
            const remaining = item.periods - item.completedPeriods;
            const category = this.app.categoryManager.getCategoryById(item.recordType || 'expense', item.category);
            
            // Check overpaid
            let overpaidWarning = '';
            if (item.status !== 'completed') {
                const historyRecords = await this.app.dataService.getRecords({ amortizationId: item.id, allLedgers: true });
                const actualPaidSoFar = historyRecords.reduce((sum, r) => sum + r.amount, 0);
                const principal = Math.max(0, item.totalAmount - (item.downPayment || 0));
                const { exactTotalToPay } = calculateAmortizationDetails(
                    principal, 
                    item.periods, 
                    item.interestRate || 0, 
                    item.frequency || 'monthly', 
                    item.decimalStrategy || 'round'
                );
                
                if (actualPaidSoFar > exactTotalToPay) {
                    overpaidWarning = `<span class="text-[10px] px-2 py-0.5 rounded-full border shrink-0 bg-red-100 text-red-600 border-red-200"><i class="fa-solid fa-triangle-exclamation"></i> 已溢繳</span>`;
                }
            }

            return `
                <div class="bg-wabi-surface rounded-xl p-4 border border-wabi-border" data-amort-id="${item.id}">
                    <div class="flex items-start gap-3">
                        <div class="flex items-center justify-center rounded-xl text-white shrink-0 size-11 text-lg ${type.color}">
                            <i class="${type.icon}"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1 flex-wrap">
                                <p class="font-bold text-wabi-text-primary truncate">${escapeHTML(item.name)}</p>
                                <span class="text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${status.class}">${status.name}</span>
                                ${overpaidWarning}
                            </div>
                            <div class="flex items-center gap-2 text-xs text-wabi-text-secondary mb-2">
                                <span>${type.name}</span><span>·</span>
                                <span>${category?.name || '未分類'}</span>
                                ${item.interestRate ? `<span>· 利率 ${item.interestRate}%</span>` : ''}
                            </div>
                            <div class="w-full bg-wabi-bg rounded-full h-2 mb-1.5">
                                <div class="h-2 rounded-full transition-all ${item.status === 'completed' ? 'bg-green-500' : 'bg-wabi-primary'}" style="width: ${progress}%"></div>
                            </div>
                            <div class="flex justify-between text-[11px] text-wabi-text-secondary">
                                <span>已完成 ${item.completedPeriods}/${item.periods} 期</span>
                                <span>每期 $${this._formatAmount(item.amountPerPeriod)}</span>
                            </div>
                            <div class="mt-2 flex items-center gap-3 text-xs">
                                <span class="text-wabi-text-secondary">總額 <strong class="text-wabi-text-primary">$${this._formatAmount(item.totalAmount)}</strong></span>
                                ${item.downPayment ? `<span class="text-wabi-text-secondary">首付 <strong class="text-wabi-text-primary">$${this._formatAmount(item.downPayment)}</strong></span>` : ''}
                                ${remaining > 0 && item.status === 'active' ? `<span class="text-wabi-text-secondary">下期 <strong class="text-wabi-primary">${item.nextDueDate}</strong></span>` : ''}
                            </div>
                        </div>
                        <div class="flex flex-col gap-1 shrink-0">
                            ${item.status !== 'completed' ? `
                                <button class="toggle-pause-btn p-1.5 text-wabi-text-secondary hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors" data-id="${item.id}" title="${item.status === 'paused' ? '恢復' : '暫停'}">
                                    <i class="fa-solid ${item.status === 'paused' ? 'fa-play' : 'fa-pause'} text-sm"></i>
                                </button>` : ''}
                            <button class="edit-amort-btn p-1.5 text-wabi-text-secondary hover:text-wabi-primary hover:bg-wabi-primary/10 rounded-lg transition-colors" data-id="${item.id}" title="編輯">
                                <i class="fa-solid fa-pen text-sm"></i>
                            </button>
                            <button class="delete-amort-btn p-1.5 text-wabi-text-secondary hover:text-wabi-expense hover:bg-wabi-expense/10 rounded-lg transition-colors" data-id="${item.id}" title="刪除">
                                <i class="fa-solid fa-trash text-sm"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }));
        return htmls.join('');
    }

    // ==================== 事件綁定 ====================
    _setupListeners() {
        document.getElementById('add-amort-btn')?.addEventListener('click', () => {
            showAmortizationModal(this.app, null, {}, () => this.render());
        });
        document.querySelectorAll('.status-filter-btn').forEach(btn => {
            btn.addEventListener('click', async () => { this.statusFilter = btn.dataset.status; await this.render(); });
        });
        document.querySelectorAll('.edit-amort-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = await this.app.dataService.getAmortization(parseInt(btn.dataset.id));
                if (item) showAmortizationModal(this.app, item, {}, () => this.render());
            });
        });
        document.querySelectorAll('.toggle-pause-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = await this.app.dataService.getAmortization(parseInt(btn.dataset.id));
                if (!item) return;
                const newStatus = item.status === 'paused' ? 'active' : 'paused';
                await this.app.dataService.updateAmortization(parseInt(btn.dataset.id), { status: newStatus });
                showToast(newStatus === 'paused' ? '已暫停' : '已恢復', 'success');
                await this.render();
            });
        });
        document.querySelectorAll('.delete-amort-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = await this.app.dataService.getAmortization(parseInt(btn.dataset.id));
                if (!item) return;
                if (!(await customConfirm(`確定要刪除「${item.name}」嗎？\n\n⚠️ 已產生的記帳紀錄不會被刪除。`))) return;
                await this.app.dataService.deleteAmortization(parseInt(btn.dataset.id));
                showToast('已刪除', 'success');
                await this.render();
            });
        });
    }

    _formatAmount(num) {
        if (num === undefined || num === null || isNaN(num)) return '0';
        return num.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
}

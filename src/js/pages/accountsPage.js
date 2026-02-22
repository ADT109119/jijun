import { formatCurrency, showToast, escapeHTML, formatDateToString } from '../utils.js';

export class AccountsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const advancedMode = await this.app.dataService.getSetting('advancedAccountModeEnabled');
        if (!advancedMode?.value) {
            window.location.hash = '#settings';
            return;
        }

        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">帳戶管理</h1>
                    <div class="w-6"></div> <!-- Placeholder for alignment -->
                </div>

                <!-- Total Assets -->
                <div class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8 text-center">
                    <p class="text-wabi-text-secondary text-base font-medium">總資產</p>
                    <p id="total-assets" class="text-wabi-primary text-4xl font-bold tracking-tight mt-1">$0</p>
                </div>

                <!-- Account List -->
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold text-wabi-primary">帳戶列表</h3>
                    <div class="flex gap-2">
                        <button id="transfer-btn" class="bg-wabi-income text-white rounded-full w-8 h-8 flex items-center justify-center">
                            <i class="fa-solid fa-money-bill-transfer"></i>
                        </button>
                        <button id="add-account-btn" class="bg-wabi-primary text-white rounded-full w-8 h-8 flex items-center justify-center">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>
                <div id="accounts-list-container" class="space-y-2"></div>
            </div>
        `;
        this.setupAccountsPageListeners();
    }

    async setupAccountsPageListeners() {
        const accounts = await this.app.dataService.getAccounts();
        const allRecords = await this.app.dataService.getRecords(); // Get all records once
        const container = document.getElementById('accounts-list-container');
        const totalAssetsEl = document.getElementById('total-assets');

        let totalAssets = 0;
        container.innerHTML = '';

        if (accounts.length === 0) {
            container.innerHTML = `<p class="text-center text-wabi-text-secondary py-8">尚未建立任何帳戶</p>`;
        }

        for (const account of accounts) {
            const recordsForAccount = allRecords.filter(r => r.accountId === account.id);
            const currentBalance = recordsForAccount.reduce((balance, record) => {
                return balance + (record.type === 'income' ? record.amount : -record.amount);
            }, account.balance); // Start with initial balance

            totalAssets += currentBalance;

            const accountEl = document.createElement('div');
            accountEl.className = 'flex items-center justify-between bg-wabi-surface p-4 rounded-lg border border-wabi-border';
            accountEl.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="flex items-center justify-center rounded-lg ${account.color} text-white shrink-0 size-12">
                        <i class="${account.icon} text-2xl"></i>
                    </div>
                    <div>
                        <p class="font-medium text-wabi-text-primary">${account.name}</p>
                        <p class="text-sm text-wabi-text-secondary">餘額: ${formatCurrency(currentBalance)}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button class="edit-account-btn" data-id="${account.id}"><i class="fa-solid fa-pen text-wabi-text-secondary"></i></button>
                    <button class="delete-account-btn" data-id="${account.id}"><i class="fa-solid fa-trash-can text-wabi-expense"></i></button>
                </div>
            `;
            container.appendChild(accountEl);
        }

        totalAssetsEl.textContent = formatCurrency(totalAssets);

        document.getElementById('add-account-btn').addEventListener('click', () => {
            this.showAccountModal();
        });

        document.getElementById('transfer-btn').addEventListener('click', () => {
            this.showTransferModal();
        });

        container.querySelectorAll('.edit-account-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10);
                const account = await this.app.dataService.getAccount(accountId);
                this.showAccountModal(account);
            });
        });

        container.querySelectorAll('.delete-account-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const accountId = parseInt(e.currentTarget.dataset.id, 10);
                const records = await this.app.dataService.getRecords({ accountId });
                if (records.length > 0) {
                    alert('此帳戶尚有交易紀錄，無法刪除。');
                    return;
                }
                if (confirm('確定要刪除此帳戶嗎？')) {
                    await this.app.dataService.deleteAccount(accountId);
                    showToast('帳戶已刪除');
                    this.render(); // Re-render the page
                }
            });
        });
    }

    showAccountModal(accountToEdit = null) {
        const isEdit = !!accountToEdit;
        const modal = document.createElement('div');
        modal.id = 'account-form-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">${isEdit ? '編輯帳戶' : '新增帳戶'}</h3>
                <div>
                    <label class="text-sm text-wabi-text-secondary">帳戶名稱</label>
                    <input type="text" id="account-name-input" value="${escapeHTML(accountToEdit?.name || '')}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface" required>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">初始餘額</label>
                    <input type="number" id="account-balance-input" value="${accountToEdit?.balance || 0}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface" ${isEdit ? 'disabled' : ''}>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">圖示 (Font Awesome)</label>
                    <input type="text" id="account-icon-input" value="${accountToEdit?.icon || 'fa-solid fa-wallet'}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">顏色 (Tailwind CSS)</label>
                    <input type="text" id="account-color-input" value="${accountToEdit?.color || 'bg-blue-500'}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="save-account-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">儲存</button>
                    <button id="cancel-account-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => modal.remove();

        modal.querySelector('#cancel-account-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        modal.querySelector('#save-account-btn').addEventListener('click', async () => {
            const name = document.getElementById('account-name-input').value;
            if (!name) {
                showToast('請輸入帳戶名稱', 'error');
                return;
            }

            const accountData = {
                name: name,
                balance: parseFloat(document.getElementById('account-balance-input').value) || 0,
                icon: document.getElementById('account-icon-input').value || 'fa-solid fa-wallet',
                color: document.getElementById('account-color-input').value || 'bg-blue-500',
            };

            if (isEdit) {
                await this.app.dataService.updateAccount(accountToEdit.id, { ...accountToEdit, ...accountData });
                showToast('帳戶已更新');
            } else {
                await this.app.dataService.addAccount(accountData);
                showToast('帳戶已新增');
            }
            this.render(); // Re-render the page
            closeModal();
        });
    }

    async showTransferModal() {

        const accounts = await this.app.dataService.getAccounts();
        if (accounts.length < 2) {
            showToast('你需要至少兩個帳戶才能轉帳', 'warning');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'transfer-form-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

        const accountOptions = accounts.map(acc => `<option value="${acc.id}">${escapeHTML(acc.name)}</option>`).join('');

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">建立轉帳</h3>
                <div>
                    <label class="text-sm text-wabi-text-secondary">從</label>
                    <select id="transfer-from-account" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">至</label>
                    <select id="transfer-to-account" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">${accountOptions}</select>
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">金額</label>
                    <input type="number" id="transfer-amount" placeholder="0.00" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">日期</label>
                    <input type="date" id="transfer-date" value="${formatDateToString(new Date())}" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div>
                    <label class="text-sm text-wabi-text-secondary">備註</label>
                    <input type="text" id="transfer-note" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface">
                </div>
                <div class="flex gap-2 mt-6">
                    <button id="save-transfer-btn" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">儲存</button>
                    <button id="cancel-transfer-btn" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Set default selection to different accounts
        const fromSelect = modal.querySelector('#transfer-from-account');
        const toSelect = modal.querySelector('#transfer-to-account');
        if (accounts.length > 1) {
            toSelect.value = accounts[1].id;
        }

        const closeModal = () => modal.remove();

        modal.querySelector('#cancel-transfer-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        modal.querySelector('#save-transfer-btn').addEventListener('click', async () => {
            const fromId = parseInt(fromSelect.value, 10);
            const toId = parseInt(toSelect.value, 10);
            const amount = parseFloat(document.getElementById('transfer-amount').value);
            const date = document.getElementById('transfer-date').value;
            const note = document.getElementById('transfer-note').value;

            if (fromId === toId) {
                showToast('不能在同一個帳戶內轉帳', 'error');
                return;
            }
            if (!amount || amount <= 0) {
                showToast('請輸入有效的金額', 'error');
                return;
            }

            const fromAccount = accounts.find(a => a.id === fromId);
            const toAccount = accounts.find(a => a.id === toId);

            const expenseRecord = {
                type: 'expense',
                category: 'transfer', // Special category
                amount: amount,
                date: date,
                description: `${note || ''} (轉出至 ${toAccount.name})`.trim(),
                accountId: fromId,
            };

            const incomeRecord = {
                type: 'income',
                category: 'transfer', // Special category
                amount: amount,
                date: date,
                description: `${note || ''} (從 ${fromAccount.name} 轉入)`.trim(),
                accountId: toId,
            };

            await this.app.dataService.addRecord(expenseRecord);
            await this.app.dataService.addRecord(incomeRecord);
            showToast('轉帳成功！');
            this.render(); // Re-render to show updated balances
            closeModal();
        });
    }
}

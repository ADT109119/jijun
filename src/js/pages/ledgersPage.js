// ==================== 帳本管理頁面 ====================
import { showToast } from '../utils.js';

export class LedgersPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const ledgers = this.app.ledgerManager.getAllLedgers();
        const activeLedgerId = this.app.dataService.activeLedgerId;

        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">帳本管理(Beta)</h2>
                    <button id="add-ledger-btn" class="text-wabi-primary hover:text-wabi-accent">
                        <i class="fa-solid fa-plus text-xl"></i>
                    </button>
                </div>
                <div class="p-4 space-y-3 pb-24">
                    <p class="text-xs text-wabi-text-secondary mb-2">
                        <i class="fa-solid fa-circle-info mr-1"></i>
                        建立多個帳本分開管理不同用途的帳務（如公司、家庭、個人等）。
                    </p>
                    ${ledgers.map(ledger => this._renderLedgerCard(ledger, ledger.id === activeLedgerId)).join('')}
                </div>
            </div>
        `;
        this._setupListeners();
    }

    _renderLedgerCard(ledger, isActive) {
        const isDefault = ledger.id === 1;
        return `
            <div class="bg-wabi-surface rounded-xl p-4 border-2 transition-colors ${isActive ? 'border-wabi-primary shadow-md' : 'border-wabi-border'}" data-ledger-id="${ledger.id}">
                <div class="flex items-center gap-4">
                    <div class="flex items-center justify-center rounded-xl text-white shrink-0 size-12" style="background-color: ${ledger.color || '#334A52'}">
                        <i class="${ledger.icon || 'fa-solid fa-book'} text-xl"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <p class="font-bold text-wabi-text-primary truncate">${ledger.name}</p>
                            ${isActive ? '<span class="text-xs px-2 py-0.5 bg-wabi-primary/10 text-wabi-primary rounded-full font-medium shrink-0">使用中</span>' : ''}
                            ${isDefault ? '<span class="text-xs px-2 py-0.5 bg-gray-100 text-wabi-text-secondary rounded-full shrink-0">預設</span>' : ''}
                        </div>
                        <p class="text-xs text-wabi-text-secondary mt-0.5">
                            ${ledger.type === 'shared' ? '<i class="fa-solid fa-users mr-1"></i>共用帳本' : '<i class="fa-solid fa-user mr-1"></i>個人帳本'}
                        </p>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        ${!isActive ? `<button class="switch-ledger-btn p-2 text-wabi-primary hover:bg-wabi-primary/10 rounded-lg transition-colors" data-id="${ledger.id}" title="切換到此帳本"><i class="fa-solid fa-arrow-right-to-bracket"></i></button>` : ''}
                        <button class="edit-ledger-btn p-2 text-wabi-text-secondary hover:text-wabi-primary hover:bg-wabi-primary/10 rounded-lg transition-colors" data-id="${ledger.id}" title="編輯"><i class="fa-solid fa-pen"></i></button>
                        ${!isDefault ? `<button class="delete-ledger-btn p-2 text-wabi-text-secondary hover:text-wabi-expense hover:bg-wabi-expense/10 rounded-lg transition-colors" data-id="${ledger.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    _setupListeners() {
        // 新增帳本
        document.getElementById('add-ledger-btn')?.addEventListener('click', () => this._showEditModal(null));

        // 切換帳本
        document.querySelectorAll('.switch-ledger-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                await this.app.ledgerManager.switchLedger(id);
            });
        });

        // 編輯帳本
        document.querySelectorAll('.edit-ledger-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                const ledger = this.app.ledgerManager.getAllLedgers().find(l => l.id === id);
                if (ledger) this._showEditModal(ledger);
            });
        });

        // 刪除帳本
        document.querySelectorAll('.delete-ledger-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                const ledger = this.app.ledgerManager.getAllLedgers().find(l => l.id === id);
                if (!ledger) return;
                if (!confirm(`確定要刪除「${ledger.name}」帳本嗎？\n\n⚠️ 此操作不可復原，帳本內的所有記帳資料、帳戶、欠款等都會一併刪除。`)) return;
                try {
                    await this.app.ledgerManager.deleteLedger(id);
                    showToast(`已刪除「${ledger.name}」`, 'success');
                    await this.render();
                } catch (e) {
                    showToast('刪除失敗：' + e.message, 'error');
                }
            });
        });
    }

    /**
     * 帳本新增/編輯 Modal
     * @param {object|null} ledger  null = 新增
     */
    _showEditModal(ledger) {
        const isEdit = !!ledger;
        const colors = this.app.ledgerManager.getColorOptions();
        const icons = this.app.ledgerManager.getIconOptions();
        const selectedColor = ledger?.color || colors[0];
        const selectedIcon = ledger?.icon || icons[0];

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-[2px]';
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-xl max-w-sm w-full p-6 shadow-xl max-h-[85vh] overflow-y-auto">
                <h3 class="text-lg font-bold text-wabi-primary mb-4">${isEdit ? '編輯帳本' : '新增帳本'}</h3>

                <!-- 名稱 -->
                <div class="mb-4">
                    <label class="text-sm font-medium text-wabi-text-primary block mb-1">帳本名稱</label>
                    <input type="text" id="ledger-name-input" maxlength="20"
                        class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-white text-sm focus:ring-wabi-primary focus:border-wabi-primary outline-none"
                        value="${isEdit ? ledger.name : ''}" placeholder="例如：公司帳本" />
                </div>

                <!-- 顏色 -->
                <div class="mb-4">
                    <label class="text-sm font-medium text-wabi-text-primary block mb-2">主題色</label>
                    <div id="color-picker" class="flex flex-wrap gap-2">
                        ${colors.map(c => `
                            <button class="color-option size-8 rounded-full border-2 transition-all ${c === selectedColor ? 'border-wabi-primary scale-110 ring-2 ring-wabi-primary/30' : 'border-transparent hover:scale-110'}" data-color="${c}" style="background-color: ${c}"></button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="ledger-color-input" value="${selectedColor}" />
                </div>

                <!-- 圖示 -->
                <div class="mb-6">
                    <label class="text-sm font-medium text-wabi-text-primary block mb-2">圖示</label>
                    <div id="icon-picker" class="grid grid-cols-8 gap-2">
                        ${icons.map(ic => `
                            <button class="icon-option size-10 rounded-lg flex items-center justify-center text-lg transition-all
                                ${ic === selectedIcon ? 'bg-wabi-primary text-white shadow-sm' : 'bg-gray-100 text-wabi-text-secondary hover:bg-gray-200'}"
                                data-icon="${ic}">
                                <i class="${ic}"></i>
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="ledger-icon-input" value="${selectedIcon}" />
                </div>

                <!-- Preview -->
                <div class="mb-6 p-3 bg-gray-50 rounded-lg">
                    <p class="text-xs text-wabi-text-secondary mb-2">預覽</p>
                    <div class="flex items-center gap-3">
                        <div id="preview-icon" class="flex items-center justify-center rounded-xl text-white shrink-0 size-12" style="background-color: ${selectedColor}">
                            <i class="${selectedIcon} text-xl"></i>
                        </div>
                        <p id="preview-name" class="font-bold text-wabi-text-primary">${isEdit ? ledger.name : '新帳本'}</p>
                    </div>
                </div>

                <!-- 按鈕 -->
                <div class="flex space-x-3">
                    <button id="ledger-save-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors shadow-sm">
                        ${isEdit ? '儲存' : '建立'}
                    </button>
                    <button id="ledger-cancel-btn" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-gray-100 text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const nameInput = modal.querySelector('#ledger-name-input');
        const colorInput = modal.querySelector('#ledger-color-input');
        const iconInput = modal.querySelector('#ledger-icon-input');
        const previewIcon = modal.querySelector('#preview-icon');
        const previewName = modal.querySelector('#preview-name');

        // 更新預覽
        const updatePreview = () => {
            previewIcon.style.backgroundColor = colorInput.value;
            previewIcon.innerHTML = `<i class="${iconInput.value} text-xl"></i>`;
            previewName.textContent = nameInput.value || '新帳本';
        };

        nameInput.addEventListener('input', updatePreview);

        // 顏色選擇
        modal.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.color-option').forEach(b => b.classList.remove('border-wabi-primary', 'scale-110', 'ring-2', 'ring-wabi-primary/30'));
                btn.classList.add('border-wabi-primary', 'scale-110', 'ring-2', 'ring-wabi-primary/30');
                colorInput.value = btn.dataset.color;
                updatePreview();
            });
        });

        // 圖示選擇
        modal.querySelectorAll('.icon-option').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.icon-option').forEach(b => {
                    b.classList.remove('bg-wabi-primary', 'text-white', 'shadow-sm');
                    b.classList.add('bg-gray-100', 'text-wabi-text-secondary');
                });
                btn.classList.remove('bg-gray-100', 'text-wabi-text-secondary');
                btn.classList.add('bg-wabi-primary', 'text-white', 'shadow-sm');
                iconInput.value = btn.dataset.icon;
                updatePreview();
            });
        });

        // 儲存
        modal.querySelector('#ledger-save-btn').addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) { showToast('請輸入帳本名稱', 'error'); return; }

            try {
                if (isEdit) {
                    await this.app.ledgerManager.updateLedger(ledger.id, {
                        name,
                        color: colorInput.value,
                        icon: iconInput.value,
                    });
                    showToast('帳本已更新', 'success');
                } else {
                    await this.app.ledgerManager.createLedger({
                        name,
                        color: colorInput.value,
                        icon: iconInput.value,
                    });
                    showToast(`「${name}」帳本已建立`, 'success');
                }
                modal.remove();
                await this.render();
            } catch (e) {
                showToast(e.message, 'error');
            }
        });

        // 取消
        modal.querySelector('#ledger-cancel-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // 自動聚焦
        nameInput.focus();
    }
}

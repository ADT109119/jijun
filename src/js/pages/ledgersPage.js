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
                    <button id="join-ledger-btn" class="w-full py-3 bg-wabi-primary/10 text-wabi-primary font-medium rounded-xl border border-wabi-primary/30 hover:bg-wabi-primary/20 transition-colors mb-4">
                        <i class="fa-solid fa-cloud-arrow-down mr-2"></i>加入共用帳本
                    </button>
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
                        <i class="${ledger.icon || 'fa-solid fa-book'} text-2xl"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <p class="font-bold text-wabi-text-primary truncate">${ledger.name}</p>
                            ${isActive ? '<span class="text-xs px-2 py-0.5 bg-wabi-primary/10 text-wabi-primary rounded-full font-medium shrink-0">使用中</span>' : ''}
                            ${isDefault ? '<span class="text-xs px-2 py-0.5 bg-wabi-bg text-wabi-text-secondary rounded-full shrink-0">預設</span>' : ''}
                        </div>
                        <p class="text-xs text-wabi-text-secondary mt-0.5">
                            ${ledger.isShared ? '<i class="fa-solid fa-users mr-1"></i>共用帳本' : '<i class="fa-solid fa-user mr-1"></i>個人帳本'}
                        </p>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        ${!isActive ? `<button class="switch-ledger-btn p-2 text-wabi-primary hover:bg-wabi-primary/10 rounded-lg transition-colors" data-id="${ledger.id}" title="切換到此帳本"><i class="fa-solid fa-arrow-right-to-bracket"></i></button>` : ''}
                        ${!isDefault ? `<button class="share-ledger-btn p-2 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 rounded-lg transition-colors" data-id="${ledger.id}" title="分享此帳本"><i class="fa-solid fa-share-nodes"></i></button>` : ''}
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

        // 加入共用帳本
        document.getElementById('join-ledger-btn')?.addEventListener('click', () => {
            if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
                showToast('請登入 Google 帳號', 'error');
                return;
            }
            this._showJoinModal();
        });

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

        // 分享帳本
        document.querySelectorAll('.share-ledger-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                const ledger = this.app.ledgerManager.getAllLedgers().find(l => l.id === id);
                if (ledger) this._showShareModal(ledger);
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
                    const wasActive = this.app.dataService.activeLedgerId === id;
                    await this.app.ledgerManager.deleteLedger(id);
                    if (wasActive) {
                        await this.app.ledgerManager.switchLedger(1);
                    }
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
                        class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary outline-none"
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
                                ${ic === selectedIcon ? 'bg-wabi-primary text-wabi-surface shadow-sm' : 'bg-wabi-bg text-wabi-text-secondary hover:bg-wabi-bg'}"
                                data-icon="${ic}">
                                <i class="${ic}"></i>
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="ledger-icon-input" value="${selectedIcon}" />
                </div>

                <!-- Preview -->
                <div class="mb-6 p-3 bg-wabi-bg rounded-lg">
                    <p class="text-xs text-wabi-text-secondary mb-2">預覽</p>
                    <div class="flex items-center gap-3">
                        <div id="preview-icon" class="flex items-center justify-center rounded-xl text-white shrink-0 size-12" style="background-color: ${selectedColor}">
                            <i class="${selectedIcon} text-2xl"></i>
                        </div>
                        <p id="preview-name" class="font-bold text-wabi-text-primary">${isEdit ? ledger.name : '新帳本'}</p>
                    </div>
                </div>

                <!-- 按鈕 -->
                <div class="flex space-x-3">
                    <button id="ledger-save-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        ${isEdit ? '儲存' : '建立'}
                    </button>
                    <button id="ledger-cancel-btn" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
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
                    b.classList.remove('bg-wabi-primary', 'text-wabi-surface', 'shadow-sm');
                    b.classList.add('bg-wabi-bg', 'text-wabi-text-secondary');
                });
                btn.classList.remove('bg-wabi-bg', 'text-wabi-text-secondary');
                btn.classList.add('bg-wabi-primary', 'text-wabi-surface', 'shadow-sm');
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

    /**
     * 分享帳本 Modal
     * @param {object} ledger 
     */
    async _showShareModal(ledger) {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            showToast('請登入 Google 帳號', 'error');
            return;
        }

        // 先判斷是否為擁有者（已共用帳本才需要）
        let isOwner = true;
        if (ledger.sharedFileId) {
            try {
                isOwner = await this.app.ledgerManager.isLedgerOwner(ledger.id);
            } catch { isOwner = false; }
        }

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-[2px]';
        
        const contentHtml = `
            <div class="bg-wabi-bg rounded-xl max-w-sm w-full p-6 shadow-xl relative max-h-[85vh] overflow-y-auto">
                <button class="close-btn absolute top-4 right-4 text-wabi-text-secondary hover:text-wabi-primary p-2">
                    <i class="fa-solid fa-times"></i>
                </button>
                <h3 class="text-lg font-bold text-wabi-primary mb-2">共用帳本：${ledger.name}</h3>
                
                <!-- 權限提示 -->
                <div class="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p class="text-[11px] text-amber-700 leading-relaxed">
                        <i class="fa-solid fa-triangle-exclamation mr-1"></i>
                        <strong>權限提示：</strong>共用功能需讀寫檔案權限。若操作失敗或您是從舊版升級，請前往 <a href="#settings" class="underline font-bold">設定</a> 重新登入以授權。
                    </p>
                </div>

                ${isOwner ? `
                <div class="mb-4">
                    <p class="text-sm text-wabi-text-secondary mb-3">請輸入對方的 Google Email 進行授權。只要產生了共用代碼，對方即可透過代碼連結您的帳本。</p>
                    <label class="text-sm font-medium text-wabi-text-primary block mb-1">受邀人 Email</label>
                    <input type="email" id="share-email-input" 
                        class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary outline-none"
                        placeholder="例如：friend@gmail.com" />
                </div>
                <div class="flex space-x-3 mt-6">
                    <button id="share-submit-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm flex justify-center items-center">
                        產生並授權
                    </button>
                </div>
                ` : `
                <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p class="text-sm text-blue-700"><i class="fa-solid fa-circle-info mr-1"></i>您是此共用帳本的參與者，只有擁有者可以管理分享權限。</p>
                </div>
                `}
                
                ${ledger.sharedFileId ? `
                <div class="mt-6 p-4 bg-wabi-bg rounded-lg border border-wabi-border">
                    <p class="text-xs text-wabi-text-secondary mb-1">現有共用代碼（已啟用）：</p>
                    <div class="flex items-center gap-2 mb-3">
                        <input type="text" readonly value="${ledger.sharedFileId}" class="flex-1 bg-wabi-surface border border-wabi-border rounded px-2 py-1 text-xs text-wabi-text-primary outline-none" />
                        <button class="copy-code-btn px-3 py-1 bg-wabi-bg hover:bg-wabi-border rounded text-xs transition-colors shrink-0">複製</button>
                    </div>
                    
                    <div class="flex justify-center mb-4">
                        <div id="qrcode-container" class="bg-wabi-surface p-2 border border-wabi-border rounded-lg shadow-sm"></div>
                    </div>

                    <p class="text-xs font-bold text-wabi-text-primary mb-2">授權名單：</p>
                    <div id="shared-users-list" class="space-y-2 max-h-40 overflow-y-auto pr-1">
                        <div class="text-center text-gray-400 py-3 text-xs"><i class="fa-solid fa-spinner fa-spin"></i> 載入中...</div>
                    </div>

                    ${isOwner ? `
                    <div class="mt-4 pt-4 border-t border-wabi-border">
                        <button id="unshare-btn" class="w-full py-2.5 bg-red-50 text-red-600 font-medium rounded-lg border border-red-200 hover:bg-red-100 transition-colors text-sm flex items-center justify-center gap-2">
                            <i class="fa-solid fa-link-slash"></i> 取消共用
                        </button>
                        <p class="text-[10px] text-gray-400 mt-1 text-center">取消後雲端共享檔案將被刪除，此帳本將轉回個人帳本。</p>
                    </div>
                    ` : ''}
                </div>
                ` : ''}
            </div>
        `;
        
        modal.innerHTML = contentHtml;
        document.body.appendChild(modal);

        modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        if (ledger.sharedFileId) {
            // == 複製代碼 ==
            modal.querySelector('.copy-code-btn')?.addEventListener('click', () => {
                navigator.clipboard.writeText(ledger.sharedFileId).then(() => {
                    showToast('已複製共用代碼', 'success');
                }).catch(() => {
                    showToast('複製失敗，請手動選取複製', 'error');
                });
            });

            // == QR Code ==
            const qrContainer = modal.querySelector('#qrcode-container');
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrContainer, {
                    text: ledger.sharedFileId,
                    width: 120,
                    height: 120,
                    colorDark : "#2D3748",
                    colorLight : "#ffffff",
                });
            } else {
                qrContainer.innerHTML = '<span class="text-xs text-gray-400 p-2">QRCode 載入失敗</span>';
            }

            // == 讀取分享名單 ==
            const usersListEl = modal.querySelector('#shared-users-list');
            this.app.ledgerManager.getSharedUsers(ledger.id).then(users => {
                usersListEl.innerHTML = '';
                users.forEach(u => {
                    const el = document.createElement('div');
                    el.className = 'flex justify-between items-center bg-wabi-surface p-2 rounded-lg border border-wabi-border shadow-sm';
                    el.innerHTML = `
                        <div class="truncate flex-1 min-w-0 mr-2">
                            <p class="text-sm font-medium text-wabi-text-primary truncate">${u.displayName || '未知使用者'}</p>
                            <p class="text-xs text-gray-500 truncate">${u.emailAddress || '---'}</p>
                        </div>
                        ${u.role === 'owner' ? '<span class="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded shrink-0">擁有者</span>' : 
                          (isOwner ? '<button class="remove-user-btn text-red-500 hover:bg-red-50 size-7 flex items-center justify-center rounded transition-colors shrink-0" title="移除授權"><i class="fa-solid fa-user-minus"></i></button>' :
                          '<span class="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded shrink-0">參與者</span>')}
                    `;
                    
                    if (isOwner && u.role !== 'owner') {
                        el.querySelector('.remove-user-btn')?.addEventListener('click', async () => {
                            if (!confirm(`確定要移除「${u.emailAddress || u.displayName}」的共用權限嗎？`)) return;
                            try {
                                el.style.opacity = '0.5';
                                await this.app.ledgerManager.removeSharedUser(ledger.id, u.id);
                                el.remove();
                                showToast('已移除該使用者的共用權限', 'success');
                            } catch (e) {
                                showToast('移除失敗：' + e.message, 'error');
                                el.style.opacity = '1';
                            }
                        });
                    }
                    usersListEl.appendChild(el);
                });
            }).catch(e => {
                usersListEl.innerHTML = `<div class="text-red-500 text-center py-2 text-xs">無法載入名單：${e.message}</div>`;
            });

            // == 取消共用 (擁有者專用) ==
            if (isOwner) {
                modal.querySelector('#unshare-btn')?.addEventListener('click', async () => {
                    if (!confirm(`⚠️ 確定要取消共用「${ledger.name}」嗎？\n\n所有參與者將失去存取權限，雲端共享檔案將被永久刪除。帳本資料仍會保留在您本地。`)) return;
                    
                    const btn = modal.querySelector('#unshare-btn');
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>處理中...';
                    btn.disabled = true;

                    try {
                        await this.app.ledgerManager.unshareLedger(ledger.id);
                        showToast('已取消共用，帳本已還原為個人帳本', 'success');
                        modal.remove();
                        await this.render();
                    } catch (e) {
                        showToast('取消共用失敗：' + e.message, 'error');
                        btn.innerHTML = '<i class="fa-solid fa-link-slash"></i> 取消共用';
                        btn.disabled = false;
                    }
                });
            }
        }

        // == 擁有者才可邀請新成員 ==
        if (isOwner) {
            const submitBtn = modal.querySelector('#share-submit-btn');
            const emailInput = modal.querySelector('#share-email-input');

            submitBtn?.addEventListener('click', async () => {
                const email = emailInput.value.trim();
                if (!email || !email.includes('@')) {
                    showToast('請輸入有效的 Email', 'error');
                    return;
                }

                const originalHTML = submitBtn.innerHTML;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>處理中...';
                submitBtn.disabled = true;

                try {
                    const fileId = await this.app.ledgerManager.shareLedger(ledger.id, email);
                    showToast('共用授權成功！請將代碼傳給對方', 'success');
                    modal.remove();
                    this._showShareModal(await this.app.dataService.getLedger(ledger.id));
                } catch (e) {
                    showToast('授權失敗：' + e.message, 'error');
                    submitBtn.innerHTML = originalHTML;
                    submitBtn.disabled = false;
                }
            });
        }
    }

    /**
     * 加入共用帳本 Modal
     */
    _showJoinModal() {
        if (!this.app.syncService || !this.app.syncService.isSignedIn()) {
            showToast('請先登入 Google 帳號才能加入共用帳本', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-[2px]';
        
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-xl max-w-sm w-full p-6 shadow-xl relative">
                <button class="close-btn absolute top-4 right-4 text-wabi-text-secondary hover:text-wabi-primary p-2">
                    <i class="fa-solid fa-times"></i>
                </button>
                <h3 class="text-lg font-bold text-wabi-primary mb-2">加入共用帳本</h3>
                
                <!-- 權限提示 -->
                <div class="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p class="text-[11px] text-amber-700 leading-relaxed">
                        <i class="fa-solid fa-triangle-exclamation mr-1"></i>
                        <strong>權限提示：</strong>加入功能需讀寫檔案權限。若操作失敗或您是從舊版升級，請前往 <a href="#settings" class="underline font-bold">設定</a> 重新登入以授權。
                    </p>
                </div>

                <div class="mb-4">
                    <p class="text-sm text-wabi-text-secondary mb-3">
                        為確保雲端讀寫權限，<strong class="text-wabi-primary">極度建議透過 Google 雲端選擇器載入</strong>。
                    </p>
                    
                    <button id="picker-btn" class="w-full py-2.5 mb-4 bg-blue-50 text-blue-600 font-medium rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors flex justify-center items-center gap-2">
                        <i class="fa-brands fa-google-drive"></i> 從「與我共用」選擇檔案
                    </button>

                    <div class="flex items-center gap-2 mb-4">
                        <div class="h-px bg-wabi-bg flex-1"></div>
                        <span class="text-xs text-gray-400">或輸入代碼</span>
                        <div class="h-px bg-wabi-bg flex-1"></div>
                    </div>

                    <label class="text-sm font-medium text-wabi-text-primary block mb-1">共用代碼 (File ID)</label>
                    <div class="flex gap-2">
                        <input type="text" id="join-code-input" 
                            class="flex-1 px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm focus:ring-wabi-primary focus:border-wabi-primary outline-none"
                            placeholder="手動貼上代碼..." />
                        <button id="scan-qr-btn" class="bg-wabi-bg w-11 hover:bg-wabi-bg text-wabi-text-primary rounded-lg flex items-center justify-center transition-colors" title="掃描 QR Code">
                            <i class="fa-solid fa-qrcode text-lg"></i>
                        </button>
                    </div>

                    <!-- 隱藏的掃描區塊 -->
                    <div id="qr-reader-container" class="hidden mt-3 rounded-lg overflow-hidden border border-wabi-border w-full">
                        <div id="qr-reader" class="w-full bg-black"></div>
                        <button id="close-scanner-btn" class="w-full py-2 bg-wabi-bg text-wabi-text-primary text-sm font-medium hover:bg-wabi-bg transition-colors">
                            關閉相機
                        </button>
                    </div>
                </div>

                <div class="flex space-x-3 mt-6">
                    <button id="join-submit-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm flex justify-center items-center">
                        加入帳本
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);

        let html5QrCode = null;
        const closeScanner = async () => {
            if (html5QrCode) {
                try {
                    await html5QrCode.stop();
                } catch(e) {}
                html5QrCode = null;
            }
            modal.querySelector('#qr-reader-container').classList.add('hidden');
        };

        const closeModal = async () => {
            await closeScanner();
            modal.remove();
        };

        modal.querySelector('.close-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        const submitBtn = modal.querySelector('#join-submit-btn');
        const codeInput = modal.querySelector('#join-code-input');
        const pickerBtn = modal.querySelector('#picker-btn');
        const scanBtn = modal.querySelector('#scan-qr-btn');
        const scannerContainer = modal.querySelector('#qr-reader-container');
        const closeScannerBtn = modal.querySelector('#close-scanner-btn');

        let authorizedCode = null;

        // ==== 掃描 QR Code 邏輯 ====
        scanBtn.addEventListener('click', () => {
            if (typeof Html5Qrcode === 'undefined') {
                showToast('掃描套件載入失敗', 'error');
                return;
            }
            
            if (scannerContainer.classList.contains('hidden')) {
                scannerContainer.classList.remove('hidden');
                
                Html5Qrcode.getCameras().then(devices => {
                    if (devices && devices.length) {
                        // 優先尋找後置鏡頭，沒有就預設最後一顆（通常是主鏡頭），如果只有一顆就用第一顆
                        const backCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment') || d.label.toLowerCase().includes('rear'));
                        const cameraId = backCamera ? backCamera.id : devices[devices.length - 1].id;

                        html5QrCode = new Html5Qrcode("qr-reader");
                        html5QrCode.start(
                            cameraId,
                            {
                                fps: 10,
                                qrbox: { width: 250, height: 250 }
                            },
                            (decodedText) => {
                                codeInput.value = decodedText;
                                showToast('掃描成功！', 'success');
                                closeScanner();
                            },
                            (errorMessage) => {
                                // ignore background scan errors
                            }
                        ).catch((err) => {
                            showToast("無法存取相機，請確認瀏覽器權限設定", "error");
                            closeScanner();
                        });
                    } else {
                        showToast("找不到任何相機設備", "error");
                        closeScanner();
                    }
                }).catch(err => {
                    showToast("相機存取失敗或未授權", "error");
                    closeScanner();
                });
            } else {
                closeScanner();
            }
        });

        closeScannerBtn.addEventListener('click', closeScanner);

        // ==== Picker 邏輯 ====
        pickerBtn.addEventListener('click', async () => {
            const originalHTML = pickerBtn.innerHTML;
            pickerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>載入視窗...';
            pickerBtn.disabled = true;

            try {
                const selectedFileId = await this.app.syncService.openSharedLedgerPicker();
                codeInput.value = selectedFileId;
                authorizedCode = selectedFileId;
                showToast('成功選擇檔案，正在載入...', 'success');
                // 自動觸發送出
                submitBtn.click();
            } catch (err) {
                if (err.message !== '使用者取消選擇') {
                    showToast(err.message, 'error');
                }
            } finally {
                pickerBtn.innerHTML = originalHTML;
                pickerBtn.disabled = false;
            }
        });

        // ==== 提交邏輯 ====
        submitBtn.addEventListener('click', async () => {
            let code = codeInput.value.trim();
            if (!code) {
                showToast('請輸入或選擇共用代碼', 'error');
                return;
            }

            const originalHTML = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>正在處理...';
            submitBtn.disabled = true;

            try {
                // 如果是手動輸入，強制透過 Picker 確認一次授權
                if (code !== authorizedCode) {
                    showToast('請在接下來的視窗中確認授權檔案...', 'info');
                    code = await this.app.syncService.openSharedLedgerPicker(code);
                    authorizedCode = code;
                    codeInput.value = code;
                }

                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>正在同步...';
                
                const newLedgerId = await this.app.ledgerManager.joinSharedLedger(code);
                showToast('成功加入共用帳本！', 'success');
                modal.remove();
                await this.app.ledgerManager.switchLedger(newLedgerId); // 自動切換過去
            } catch (e) {
                if (e.message !== '使用者取消選擇') {
                    showToast('加入失敗：' + e.message, 'error');
                }
                submitBtn.innerHTML = originalHTML;
                submitBtn.disabled = false;
            }
        });
        
        codeInput.focus();
    }
}

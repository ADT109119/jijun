import { formatDate, formatDateToString, formatCurrency, showToast, escapeHTML } from '../utils.js';

export class AddPage {
    constructor(app) {
        this.app = app;
        this._keypadListener = null;
    }

    async render(params) {
        const recordId = params.get('id');
        const isEditMode = !!recordId;
        const debtEnabled = await this.app.dataService.getSetting('debtManagementEnabled');
        const showDebtBtn = !!debtEnabled?.value;

        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-48 md:pb-8 max-w-3xl mx-auto"> <!-- Add padding-bottom to avoid overlap with fixed keypad -->
                <!-- Header -->
                <div class="flex items-center pb-2 justify-between">
                    <button id="add-page-close-btn" class="flex size-12 shrink-0 items-center justify-center">
                        <i class="fa-solid fa-xmark text-2xl text-wabi-text-primary"></i>
                    </button>
                    <h2 class="text-lg font-bold flex-1 text-center">${isEditMode ? '編輯紀錄' : '新增紀錄'}</h2>
                    <div class="flex items-center gap-2">
                        ${showDebtBtn ? `
                            <button id="toggle-debt-btn" class="size-10 flex items-center justify-center rounded-full text-wabi-text-secondary hover:bg-gray-100" title="標記為欠款">
                                <i class="fa-solid fa-handshake text-lg"></i>
                            </button>
                        ` : ''}
                        ${isEditMode ? '<button id="delete-record-btn" class="text-wabi-expense"><i class="fa-solid fa-trash-can"></i></button>' : ''}
                    </div>
                </div>

                <!-- Debt Panel (hidden by default) -->
                <div id="debt-panel" class="hidden bg-wabi-primary/10 rounded-lg p-4 mb-4 border border-wabi-primary/30">
                    <div class="flex items-center justify-between mb-3">
                        <span class="font-medium text-wabi-primary"><i class="fa-solid fa-handshake mr-2"></i>欠款標記</span>
                        <button id="close-debt-panel" class="text-wabi-text-secondary hover:text-wabi-primary">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                    <div class="flex h-9 w-full items-center justify-center rounded-lg bg-white/80 p-1 mb-3">
                        <button id="debt-type-receivable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium bg-wabi-income text-white">別人欠我</button>
                        <button id="debt-type-payable-add" class="debt-add-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium text-wabi-text-secondary">我欠別人</button>
                    </div>
                    <select id="debt-contact-select" class="w-full p-2 bg-white border border-wabi-border rounded-lg text-sm">
                        <option value="">選擇聯絡人...</option>
                    </select>
                    <p class="text-xs text-wabi-text-secondary mt-2">儲存時將同時建立欠款記錄</p>
                </div>

                <!-- Type Switcher & Amount -->
                <div class="px-4">
                    <div class="flex h-11 w-full items-center justify-center rounded-lg bg-gray-200/80 p-1 mb-4">
                        <button id="add-type-expense" class="flex-1 h-full rounded-md text-sm font-medium">支出</button>
                        <button id="add-type-income" class="flex-1 h-full rounded-md text-sm font-medium">收入</button>
                    </div>
                    <div class="flex items-center justify-between py-4">
                        <div id="add-selected-category" class="flex items-center gap-4">
                            <div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12">
                                <i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i>
                            </div>
                            <p class="text-lg font-medium">選擇分類</p>
                        </div>
                        <div id="add-amount-display" class="text-wabi-expense tracking-light text-5xl font-bold">$0</div>
                    </div>
                </div>

                <!-- Categories -->
                <div id="add-category-grid" class="px-4 mt-2 grid grid-cols-4 gap-4"></div>
            </div>
            <!-- Note, Date, and Keypad -->
            <div id="keypad-container" class="fixed bottom-20 md:bottom-0 left-0 md:left-64 right-0 md:max-w-3xl md:mx-auto md:border-x md:border-t md:border-wabi-border md:rounded-t-xl md:shadow-[0_0_15px_rgba(0,0,0,0.05)] bg-gray-200/80 text-wabi-primary z-20 transform translate-y-full transition-transform duration-300 ease-in-out">
                <!-- Account Selector & Quick Select Container -->
                <div class="flex items-start px-4 pt-2 gap-2">
                    <div id="account-selector-container" class="w-1/4 shrink-0"></div>
                    <div id="quick-select-container" class="w-3/4 grow hidden"></div>
                </div>

                <div class="flex items-center px-4 py-2 gap-2">
                    <label class="relative flex items-center gap-2 p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-calendar-days text-wabi-text-secondary"></i>
                        <span id="add-date-display" class="text-sm font-medium">${formatDate(formatDateToString(new Date()), 'short')}</span>
                        <input type="date" id="add-date-input" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                    </label>
                    <input id="add-note-input" class="w-full rounded-lg border-gray-300 bg-white/80 placeholder:text-wabi-text-secondary focus:border-wabi-primary focus:ring-wabi-primary" placeholder="新增備註" type="text"/>
                    <button id="keypad-toggle-btn" class="p-2 rounded-lg bg-white/50">
                        <i class="fa-solid fa-keyboard"></i>
                    </button>
                </div>
                <div id="keypad-grid" class="grid grid-cols-4 gap-px bg-gray-200/80">
                    ${['1', '2', '3', 'backspace', '4', '5', '6', 'ac', '7', '8', '9', 'save', '00', '0', '.', ''].map(k => this.createKeypadButton(k, isEditMode)).join('')}
                </div>
            </div>
        `;
        await this.setupAddPageListeners(recordId);
    }

    async setupAddPageListeners(recordId) {
        const isEditMode = !!recordId;
        let recordToEdit = null;

        const advancedMode = await this.app.dataService.getSetting('advancedAccountModeEnabled');
        const advancedModeEnabled = !!advancedMode?.value;


        let currentType = 'expense';
        let currentAmount = '0';
        let selectedCategory = null;
        let selectedAccountId = null; // New state for multi-account mode
        let currentDate = formatDateToString(new Date());
        let keypadGridOpen = true;

        // Debt panel state
        let debtEnabled = false;
        let debtType = 'receivable';
        let debtContactId = null;

        const amountDisplay = document.getElementById('add-amount-display');
        const categoryGrid = document.getElementById('add-category-grid');

        // Back Button Logic
        document.getElementById('add-page-close-btn').addEventListener('click', () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.hash = '#home';
            }
        });
        const selectedCategoryUI = document.getElementById('add-selected-category');
        const noteInput = document.getElementById('add-note-input');
        const dateInput = document.getElementById('add-date-input');
        const dateDisplay = document.getElementById('add-date-display');
        const keypadContainer = document.getElementById('keypad-container');
        const keypadGrid = document.getElementById('keypad-grid');
        const keypadToggleBtn = document.getElementById('keypad-toggle-btn');
        const expenseBtn = document.getElementById('add-type-expense');
        const incomeBtn = document.getElementById('add-type-income');
        const quickSelectContainer = document.getElementById('quick-select-container');
        const debtPanel = document.getElementById('debt-panel');
        const toggleDebtBtn = document.getElementById('toggle-debt-btn');

        // Plugin Support: Pre-fill from Session Storage
        if (!recordId) {
            const tempDataStr = sessionStorage.getItem('temp_add_data');
            if (tempDataStr) {
                try {
                    const tempData = JSON.parse(tempDataStr);
                    if (tempData.type) currentType = tempData.type;
                    if (tempData.amount) currentAmount = tempData.amount.toString();
                    if (tempData.category) selectedCategory = tempData.category;
                    if (tempData.description && noteInput) noteInput.value = tempData.description;
                    if (amountDisplay) amountDisplay.textContent = formatCurrency(currentAmount);
                    sessionStorage.removeItem('temp_add_data');
                } catch(e) {
                    console.error('Error applying temp data:', e);
                }
            }
        }

        // Setup debt panel if available
        if (toggleDebtBtn && debtPanel) {
            const loadContacts = async () => {
                const contacts = await this.app.dataService.getContacts();
                const select = document.getElementById('debt-contact-select');
                if (select) {
                    select.innerHTML = `<option value="">選擇聯絡人...</option>` +
                        contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
                }
            };

            toggleDebtBtn.addEventListener('click', async () => {
                debtEnabled = !debtEnabled;
                debtPanel.classList.toggle('hidden', !debtEnabled);
                toggleDebtBtn.classList.toggle('text-wabi-primary', debtEnabled);
                toggleDebtBtn.classList.toggle('bg-wabi-primary/10', debtEnabled);
                toggleDebtBtn.classList.toggle('text-wabi-text-secondary', !debtEnabled);
                if (debtEnabled) {
                    await loadContacts();
                }
            });

            document.getElementById('close-debt-panel')?.addEventListener('click', () => {
                debtEnabled = false;
                debtPanel.classList.add('hidden');
                toggleDebtBtn.classList.remove('text-wabi-primary', 'bg-wabi-primary/10');
                toggleDebtBtn.classList.add('text-wabi-text-secondary');
            });

            document.querySelectorAll('.debt-add-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    debtType = btn.id === 'debt-type-receivable-add' ? 'receivable' : 'payable';
                    document.querySelectorAll('.debt-add-type-btn').forEach(b => {
                        b.classList.remove('bg-wabi-income', 'bg-wabi-expense', 'text-white');
                        b.classList.add('text-wabi-text-secondary');
                    });
                    if (debtType === 'receivable') {
                        btn.classList.add('bg-wabi-income', 'text-white');
                    } else {
                        btn.classList.add('bg-wabi-expense', 'text-white');
                    }
                    btn.classList.remove('text-wabi-text-secondary');
                });
            });

            document.getElementById('debt-contact-select')?.addEventListener('change', (e) => {
                debtContactId = e.target.value ? parseInt(e.target.value) : null;
            });
        }

        // --- Account Selector Logic ---
        const accountSelectorContainer = document.getElementById('account-selector-container');
        let accounts = [];

        const updateAccountSelectorUI = () => {
            if (!advancedModeEnabled || !accountSelectorContainer) return;
            const selectedAccount = accounts.find(a => a.id === selectedAccountId);
            if (selectedAccount) {
                accountSelectorContainer.innerHTML = `
                    <label class="text-sm text-wabi-text-secondary">帳戶</label>
                    <button id="account-selector-btn" class="w-full flex items-center justify-between bg-wabi-surface py-1 px-2 mt-1 rounded-lg border border-wabi-border">
                        <div class="flex items-center gap-3 truncate">
                            <i class="${selectedAccount.icon} text-lg"></i>
                            <span class="font-medium">${selectedAccount.name}</span>
                        </div>
                        <i class="fa-solid fa-chevron-down text-xs text-wabi-text-secondary"></i>
                    </button>
                `;
                document.getElementById('account-selector-btn').addEventListener('click', () => {
                    this.showAccountSelectionModal(accounts, selectedAccountId, (newAccountId) => {
                        selectedAccountId = newAccountId;
                        updateAccountSelectorUI();
                    });
                });
            } else if (accounts.length > 0) {
                // If no account is selected (e.g. from a quick select without one), default to the first
                selectedAccountId = accounts[0].id;
                updateAccountSelectorUI();
            }
        };

        if (advancedModeEnabled) {
            accounts = await this.app.dataService.getAccounts();
            if (accounts.length > 0) {
                selectedAccountId = accounts[0].id; // Default to first account
            } else {
                accountSelectorContainer.innerHTML = `<p class="text-center text-red-500">請先至「設定」頁面建立一個帳戶</p>`;
            }
        }

        const toggleKeypadGrid = (force) => {
            const shouldOpen = force === undefined ? !keypadGridOpen : force;
            if (shouldOpen) {
                keypadGrid.style.display = 'grid';
                keypadToggleBtn.classList.add('bg-wabi-accent', 'text-wabi-primary');
            } else {
                keypadGrid.style.display = 'none';
                keypadToggleBtn.classList.remove('bg-wabi-accent', 'text-wabi-primary');
            }
            keypadGridOpen = shouldOpen;
        };

        keypadContainer.classList.remove('translate-y-full');

        const updateTypeUI = () => {
            if (currentType === 'expense') {
                expenseBtn.classList.add('bg-wabi-expense', 'text-white', 'shadow-sm');
                incomeBtn.classList.remove('bg-wabi-income', 'text-white', 'shadow-sm');
                amountDisplay.classList.remove('text-wabi-income');
                amountDisplay.classList.add('text-wabi-expense');
            } else {
                incomeBtn.classList.add('bg-wabi-income', 'text-white', 'shadow-sm');
                expenseBtn.classList.remove('bg-wabi-expense', 'text-white', 'shadow-sm');
                amountDisplay.classList.remove('text-wabi-expense');
                amountDisplay.classList.add('text-wabi-income');
            }
            renderCategories();
            const category = this.app.categoryManager.getCategoryById(currentType, selectedCategory);
            updateSelectedCategoryUI(category);
        };

        const renderCategories = () => {
            categoryGrid.innerHTML = '';
            const categories = this.app.categoryManager.getAllCategories(currentType);
            categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'category-button flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-transparent';
                btn.dataset.categoryId = cat.id;
                if (cat.id === selectedCategory) {
                    btn.classList.add(currentType === 'income' ? 'active-income' : 'active');
                }

                const colorStyle = cat.color.startsWith('#') ? `style="background-color: ${cat.color}"` : '';
                const colorClass = !cat.color.startsWith('#') ? cat.color : '';

                btn.innerHTML = `
                    <div class="flex size-14 items-center justify-center rounded-full ${colorClass} text-white" ${colorStyle}>
                        <i class="${cat.icon} text-3xl"></i>
                    </div>
                    <p class="text-xs text-center text-wabi-text-secondary">${cat.name}</p>
                `;
                btn.addEventListener('click', () => {
                    selectedCategory = cat.id;
                    updateSelectedCategoryUI(cat);
                    document.querySelectorAll('.category-button').forEach(b => b.classList.remove('active', 'active-income'));
                    btn.classList.add(currentType === 'income' ? 'active-income' : 'active');
                });
                categoryGrid.appendChild(btn);
            });
            const manageBtn = document.createElement('button');
            manageBtn.className = 'flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-dashed border-wabi-border hover:border-wabi-primary';
            manageBtn.innerHTML = `<div class="flex size-14 items-center justify-center rounded-full bg-wabi-bg"><i class="fa-solid fa-gear text-3xl text-wabi-text-secondary"></i></div><p class="text-xs text-center text-wabi-text-secondary">管理</p>`;
            manageBtn.addEventListener('click', () => this.app.categoryManager.showManageCategoriesModal(currentType, renderCategories));
            categoryGrid.appendChild(manageBtn);
        };

        const updateSelectedCategoryUI = (category) => {
            if (category) {
                const colorStyle = category.color.startsWith('#') ? `style="background-color: ${category.color}"` : '';
                const colorClass = !category.color.startsWith('#') ? category.color : '';
                selectedCategoryUI.innerHTML = `
                    <div class="flex items-center justify-center rounded-full ${colorClass} text-white shrink-0 size-12" ${colorStyle}>
                        <i class="${category.icon} text-3xl"></i>
                    </div>
                    <p class="text-lg font-medium flex-1 truncate">${category.name}</p>
                `;
            } else {
                selectedCategoryUI.innerHTML = `<div class="flex items-center justify-center rounded-full bg-gray-200 shrink-0 size-12"><i class="fa-solid fa-question text-3xl text-wabi-text-secondary"></i></div><p class="text-lg font-medium">選擇分類</p>`;
            }
        };

        const handleKeypad = async (key) => {
            if (key >= '0' && key <= '9' || key === '00') {
                if (currentAmount === '0') currentAmount = '';
                if (currentAmount.replace('.', '').length < 9) currentAmount += key;
            } else if (key === '.') {
                if (!currentAmount.includes('.')) currentAmount += '.';
            } else if (key === 'backspace') {
                currentAmount = currentAmount.slice(0, -1) || '0';
            } else if (key === 'ac') {
                currentAmount = '0';
            } else if (key === 'done') {
                toggleKeypadGrid(false);
            } else if (key === 'save') {
                const amount = parseFloat(currentAmount);
                if (advancedModeEnabled && !selectedAccountId) {
                    showToast('請先建立一個帳戶', 'error');
                    return;
                }
                if (debtEnabled && !debtContactId) {
                    showToast('請選擇欠款聯絡人', 'error');
                    return;
                }
                if (amount > 0 && selectedCategory) {
                    const recordData = {
                        type: currentType,
                        category: selectedCategory,
                        amount: amount,
                        description: noteInput.value,
                        date: currentDate,
                        accountId: advancedModeEnabled ? selectedAccountId : null
                    };

                    let newRecordId = null;
                    if (isEditMode) {
                        try {
                            const numericId = parseInt(recordId, 10);
                            await this.app.dataService.updateRecord(numericId, recordData);

                        // If record has existing debt, check if amount changed and update
                        if (recordToEdit.debtId && recordToEdit.amount !== amount) {
                            const debt = await this.app.dataService.getDebt(recordToEdit.debtId);
                            if (debt && !debt.settled) {
                                // Update debt amount proportionally
                                const oldOriginal = debt.originalAmount ?? debt.amount ?? 0;
                                const oldRemaining = debt.remainingAmount ?? oldOriginal;
                                const paidAmount = oldOriginal - oldRemaining;
                                const newRemaining = Math.max(0, amount - paidAmount);
                                await this.app.dataService.updateDebt(recordToEdit.debtId, {
                                    originalAmount: amount,
                                    remainingAmount: newRemaining
                                });
                            }
                        }

                        // If record doesn't have debt but user enabled debt, create one
                        if (debtEnabled && debtContactId && !recordToEdit.debtId) {
                            const debtId = await this.app.dataService.addDebt({
                                type: debtType,
                                contactId: debtContactId,
                                amount: amount,
                                date: currentDate,
                                description: noteInput.value || selectedCategory,
                                recordId: numericId
                            });
                            await this.app.dataService.updateRecord(numericId, { debtId: debtId });
                            showToast('更新成功並建立欠款記錄！');
                        } else {
                            showToast('更新成功！');
                        }

                        // Proceed to navigation only on success
                        window.location.hash = 'records';

                    } catch (e) {
                        console.error('Update failed or cancelled:', e);
                        // Stay on page
                        return;
                    }
                    } else {
                        newRecordId = await this.app.dataService.addRecord(recordData);
                        if (!newRecordId) return; // Cancelled by plugin or error
                        this.app.quickSelectManager.addRecord(recordData.type, recordData.category, recordData.description, recordData.accountId);

                        // Create debt record if enabled
                        if (debtEnabled && debtContactId) {
                            const debtId = await this.app.dataService.addDebt({
                                type: debtType,
                                contactId: debtContactId,
                                amount: amount,
                                date: currentDate,
                                description: noteInput.value || selectedCategory,
                                recordId: newRecordId
                            });
                            // Update record with debtId to create bidirectional link
                            await this.app.dataService.updateRecord(newRecordId, { debtId: debtId });
                            showToast('儲存成功並建立欠款記錄！');
                        } else {
                            showToast('儲存成功！');
                        }
                        window.location.hash = 'records';
                    }
                } else {
                    showToast('請輸入金額並選擇分類', 'error');
                }
            }
            amountDisplay.textContent = formatCurrency(currentAmount);
        };

        if (isEditMode) {
            const numericRecordId = parseInt(recordId, 10);
            const records = await this.app.dataService.getRecords();
            recordToEdit = records.find(r => r.id === numericRecordId);
            if (recordToEdit) {
                currentType = recordToEdit.type;
                currentAmount = String(recordToEdit.amount);
                selectedCategory = recordToEdit.category;
                currentDate = recordToEdit.date;
                noteInput.value = recordToEdit.description;
                if (advancedModeEnabled) {
                    selectedAccountId = recordToEdit.accountId;
                }
                amountDisplay.textContent = formatCurrency(currentAmount);
                dateDisplay.textContent = formatDate(currentDate, 'short');
                dateInput.value = currentDate;

                // Load associated debt if exists
                if (recordToEdit.debtId) {
                    const debt = await this.app.dataService.getDebt(recordToEdit.debtId);
                    if (debt) {
                        const contacts = await this.app.dataService.getContacts();
                        const contact = contacts.find(c => c.id === debt.contactId);
                        const contactName = contact?.name || '未知聯絡人';
                        const isReceivable = debt.type === 'receivable';
                        const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
                        const originalAmount = debt.originalAmount ?? debt.amount ?? 0;
                        const paidPercent = originalAmount > 0 ? Math.round(((originalAmount - remainingAmount) / originalAmount) * 100) : 0;

                        // Store debt info for later use
                        debtContactId = debt.contactId;
                        debtType = debt.type;
                        debtEnabled = true;

                        // Build contact options for edit
                        const contactOptions = contacts.map(c =>
                            `<option value="${c.id}" ${c.id === debt.contactId ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
                        ).join('');

                        // Show debt info panel
                        const debtInfoPanel = document.createElement('div');
                        debtInfoPanel.id = 'debt-info-panel';
                        debtInfoPanel.className = 'bg-orange-50 rounded-lg p-4 mb-4 border border-orange-200';
                        debtInfoPanel.innerHTML = `
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-medium text-orange-700">
                                    <i class="fa-solid fa-handshake mr-2"></i>關聯欠款
                                </span>
                                ${debt.settled ? '<span class="text-xs bg-wabi-income/20 text-wabi-income px-2 py-1 rounded">已還清</span>' : ''}
                            </div>
                            ${!debt.settled ? `
                                <!-- Editable debt info -->
                                <div class="space-y-2 mb-3">
                                    <div class="flex gap-2">
                                        <button id="debt-type-receivable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${isReceivable ? 'bg-wabi-income text-white border-wabi-income' : 'border-orange-300 text-orange-600'}">
                                            別人欠我
                                        </button>
                                        <button id="debt-type-payable-edit" class="flex-1 py-1.5 text-xs font-medium rounded-lg border ${!isReceivable ? 'bg-wabi-expense text-white border-wabi-expense' : 'border-orange-300 text-orange-600'}">
                                            我欠別人
                                        </button>
                                    </div>
                                    <select id="debt-contact-edit" class="w-full p-2 border border-orange-300 rounded-lg text-sm bg-white">
                                        ${contactOptions}
                                    </select>
                                </div>
                                <!-- Progress bar -->
                                <div class="mb-3">
                                    <div class="flex justify-between text-xs text-orange-600 mb-1">
                                        <span>剩餘：${formatCurrency(remainingAmount)}</span>
                                        <span>${paidPercent}% 已還</span>
                                    </div>
                                    <div class="w-full bg-orange-200 rounded-full h-2">
                                        <div class="bg-wabi-income h-2 rounded-full" style="width: ${paidPercent}%"></div>
                                    </div>
                                </div>
                                <!-- Action buttons -->
                                <div class="flex gap-2">
                                    <button id="partial-pay-btn" class="flex-1 py-2 text-sm font-medium text-white bg-wabi-primary rounded-lg">
                                        <i class="fa-solid fa-coins mr-1"></i>還款
                                    </button>
                                    <button id="remove-debt-link-btn" class="py-2 px-3 text-sm font-medium text-red-600 border border-red-300 rounded-lg bg-white">
                                        <i class="fa-solid fa-unlink"></i>
                                    </button>
                                </div>
                            ` : `
                                <div class="text-sm text-orange-600">
                                    <p><strong>聯絡人：</strong>${contactName}</p>
                                    <p><strong>類型：</strong>${isReceivable ? '別人欠我' : '我欠別人'}</p>
                                    <p><strong>原始金額：</strong>${formatCurrency(originalAmount)}</p>
                                </div>
                            `}
                        `;

                        // Insert after header
                        const header = this.app.appContainer.querySelector('.page .flex.items-center.pb-2');
                        if (header && header.nextElementSibling) {
                            header.parentNode.insertBefore(debtInfoPanel, header.nextElementSibling);
                        }

                        // Hide the toggle debt button since this record already has a debt
                        if (toggleDebtBtn) {
                            toggleDebtBtn.classList.add('hidden');
                        }
                        if (debtPanel) {
                            debtPanel.classList.add('hidden');
                        }

                        const refresh = async () => {
                            const params = new URLSearchParams();
                            if(recordId) params.append('id', recordId);
                            await this.render(params);
                        };

                        // Bind debt type edit buttons
                        document.getElementById('debt-type-receivable-edit')?.addEventListener('click', async () => {
                            await this.app.dataService.updateDebt(debt.id, { type: 'receivable' });
                            showToast('欠款類型已更新');
                            await refresh();
                        });
                        document.getElementById('debt-type-payable-edit')?.addEventListener('click', async () => {
                            await this.app.dataService.updateDebt(debt.id, { type: 'payable' });
                            showToast('欠款類型已更新');
                            await refresh();
                        });

                        // Bind contact edit
                        document.getElementById('debt-contact-edit')?.addEventListener('change', async (e) => {
                            const newContactId = parseInt(e.target.value);
                            if (newContactId) {
                                await this.app.dataService.updateDebt(debt.id, { contactId: newContactId });
                                showToast('欠款人已更新');
                            }
                        });

                        // Bind partial payment button - show custom modal
                        const partialPayBtn = document.getElementById('partial-pay-btn');
                        if (partialPayBtn) {
                            partialPayBtn.addEventListener('click', () => {
                                this.showPaymentModal(debt, recordId, remainingAmount);
                            });
                        }

                        // Bind remove debt link button
                        const removeDebtBtn = document.getElementById('remove-debt-link-btn');
                        if (removeDebtBtn) {
                            removeDebtBtn.addEventListener('click', async () => {
                                if (confirm('確定要取消此記錄與欠款的關聯嗎？欠款記錄將被刪除。')) {
                                    await this.app.dataService.deleteDebt(debt.id);
                                    await this.app.dataService.updateRecord(numericRecordId, { debtId: null });
                                    showToast('已取消欠款關聯');
                                    await refresh();
                                }
                            });
                        }
                    }
                }
            }
        }

        const handleQuickSelect = (type, categoryId, description, accountId) => {
            if (isEditMode) return;

            currentType = type;
            selectedCategory = categoryId;
            noteInput.value = description;

            if (advancedModeEnabled && accountId !== null) {
                selectedAccountId = accountId;
                updateAccountSelectorUI();
            }

            updateTypeUI();
        };

        if (!isEditMode) {
            this.app.quickSelectManager.render(quickSelectContainer, handleQuickSelect, this.app.categoryManager, advancedModeEnabled);
        }

        keypadToggleBtn.addEventListener('click', () => toggleKeypadGrid());
        dateInput.addEventListener('change', (e) => {
            currentDate = e.target.value;
            dateDisplay.textContent = formatDate(currentDate, 'short');
        });
        document.querySelectorAll('.keypad-btn').forEach(btn => {
            btn.addEventListener('click', () => handleKeypad(btn.dataset.key));
        });

        // Add physical keyboard listener for the add page
        if (this._keypadListener) {
            document.removeEventListener('keydown', this._keypadListener);
        }
        this._keypadListener = (e) => {
            if (this.app.router.currentHash && !this.app.router.currentHash.startsWith('#add')) return;
            if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const keyMap = {
                '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
                '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
                '.': '.', 'Backspace': 'backspace', 'Enter': 'save', 'Delete': 'ac', 'Escape': 'ac'
            };
            if (keyMap[e.key]) {
                e.preventDefault();
                handleKeypad(keyMap[e.key]);
            }
        };
        document.addEventListener('keydown', this._keypadListener);

        expenseBtn.addEventListener('click', () => { if (!isEditMode) { currentType = 'expense'; updateTypeUI(); } });
        incomeBtn.addEventListener('click', () => { if (!isEditMode) { currentType = 'income'; updateTypeUI(); } });

        if (isEditMode) {
            document.getElementById('delete-record-btn').addEventListener('click', async () => {
                if (confirm('確定要刪除這筆紀錄嗎？')) {
                    await this.app.dataService.deleteRecord(parseInt(recordId, 10));
                    showToast('紀錄已刪除');
                    window.location.hash = 'records';
                }
            });
        }

        updateTypeUI();
        updateAccountSelectorUI();
        toggleKeypadGrid(true);
    }

    createKeypadButton(key, isEditMode = false) {
        let content = key;
        if (key === 'ac') content = 'AC';
        if (key === 'backspace') content = '<i class="fa-solid fa-delete-left"></i>';
        if (key === 'save') content = isEditMode ? '<span class="font-bold">更新</span>' : '<span class="font-bold">儲存</span>';

        const specialClasses = {
            'save': 'row-span-2 bg-wabi-accent text-wabi-primary',
            'ac': 'bg-gray-300/80',
            '': 'bg-transparent'
        }[key] || '';

        if (key === '') return `<div class="${specialClasses}"></div>`;

        return `
            <button data-key="${key}" class="keypad-btn text-xl py-3 text-center rounded-none transition-colors touch-manipulation duration-200 ease-in-out ${specialClasses} hover:bg-gray-300/80">
                ${content}
            </button>
        `;
    }

    showAccountSelectionModal(accounts, currentAccountId, onSelect) {
        const modal = document.createElement('div');
        modal.id = 'account-selection-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

        const accountListHtml = accounts.map(account => `
            <button data-id="${account.id}" class="account-select-item w-full flex items-center gap-4 p-4 rounded-lg text-left ${account.id === currentAccountId ? 'bg-wabi-accent/20' : 'hover:bg-wabi-surface'}">
                <div class="flex items-center justify-center rounded-lg ${account.color} text-white shrink-0 size-10">
                    <i class="${account.icon} text-xl"></i>
                </div>
                <span class="font-medium text-wabi-text-primary">${account.name}</span>
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 space-y-4">
                <h3 class="text-lg font-bold text-wabi-primary">選擇帳戶</h3>
                <div class="space-y-2 max-h-60 overflow-y-auto">
                    ${accountListHtml}
                </div>
                <button id="cancel-account-select-btn" class="w-full py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => modal.remove();

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        modal.querySelector('#cancel-account-select-btn').addEventListener('click', closeModal);

        modal.querySelectorAll('.account-select-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const newAccountId = parseInt(btn.dataset.id, 10);
                onSelect(newAccountId);
                closeModal();
            });
        });
    }

    showPaymentModal(debt, recordId, remainingAmount) {
        const isReceivable = debt.type === 'receivable';

        const modal = document.createElement('div');
        modal.id = 'payment-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
                <h3 class="text-lg font-semibold mb-4 text-wabi-primary">
                    <i class="fa-solid fa-coins mr-2"></i>${isReceivable ? '登記收款' : '登記還款'}
                </h3>
                <p class="text-sm text-wabi-text-secondary mb-4">
                    剩餘金額：<span class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${formatCurrency(remainingAmount)}</span>
                </p>

                <div class="mb-4">
                    <label class="text-sm font-medium text-wabi-text-primary mb-2 block">還款金額</label>
                    <input type="number" id="payment-amount-input" value="" min="1" max="${remainingAmount}" step="1" placeholder="輸入金額"
                           class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary text-lg">
                </div>

                <div class="flex gap-2 mb-4">
                    <button id="pay-full-btn" class="flex-1 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg bg-wabi-primary/10">
                        <i class="fa-solid fa-check-double mr-1"></i>全額還清
                    </button>
                </div>

                <div class="flex gap-3">
                    <button id="confirm-payment-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
                        確認
                    </button>
                    <button id="cancel-payment-btn" class="px-6 bg-wabi-border hover:bg-gray-300/80 text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();
        const amountInput = modal.querySelector('#payment-amount-input');

        modal.querySelector('#cancel-payment-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Focus input
        setTimeout(() => amountInput.focus(), 100);

        // Pay full amount button
        modal.querySelector('#pay-full-btn').addEventListener('click', () => {
            amountInput.value = remainingAmount;
        });

        // Confirm payment
        modal.querySelector('#confirm-payment-btn').addEventListener('click', async () => {
            const amount = parseFloat(amountInput.value);

            if (!amount || amount <= 0) {
                showToast('請輸入有效金額', 'error');
                return;
            }

            if (amount > remainingAmount) {
                showToast(`金額不能超過剩餘金額 ${formatCurrency(remainingAmount)}`, 'error');
                return;
            }

            await this.app.dataService.settleDebt(debt.id, amount);
            closeModal();
            showToast('還款成功！');
            // Re-render
            const params = new URLSearchParams();
            if(recordId) params.append('id', recordId);
            await this.render(params);
        });
    }
}

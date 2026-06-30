export default {
    meta: {
        id: 'com.walkingfish.bill_splitter',
        name: '分帳神器',
        version: '1.3',
        description: '聚餐旅遊分帳助手，支援非平分模式，即時顯示剩餘金額。',
        author: 'The walking fish 步行魚',
        icon: 'fa-file-invoice-dollar',
        permissions: [
            'data:read',
            'data:write',
            'ui'
        ]
    },

    init(context) {
        this.ctx = context;
        this.ctx.ui.registerPage('split-bill', '分帳神器', (container) => this.render(container));

        this.ctx.ui.registerHomeWidget('com.walkingfish.bill_splitter', (container) => {
            container.innerHTML = `
                <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex items-center justify-between cursor-pointer hover:bg-indigo-100 transition-colors" id="open-splitter-widget">
                    <div class="flex items-center gap-3">
                        <div class="bg-indigo-500 text-wabi-surface rounded-lg size-10 flex items-center justify-center">
                             <i class="fa-solid fa-calculator"></i>
                        </div>
                        <div>
                            <p class="font-bold text-indigo-900">分帳神器</p>
                            <p class="text-xs text-indigo-700">聚餐結帳好幫手</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-indigo-300"></i>
                </div>
            `;
            container.querySelector('#open-splitter-widget').addEventListener('click', () => {
                this.ctx.ui.navigateTo('#split-bill');
            });
        });
    },

    async render(container) {
        const contacts = await this.ctx.data.getContacts();
        const expenseCategories = await this.ctx.data.getCategories('expense');
        const defaultCategory = expenseCategories.find(c => c.id === 'food') ||
                              expenseCategories.find(c => c.id === 'others') ||
                              expenseCategories[0];
        const defaultCategoryId = defaultCategory ? defaultCategory.id : 'others';

        container.innerHTML = `
            <div class="px-4 pb-24 pt-4 space-y-4">
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div class="flex bg-gray-100 rounded-lg p-1 mb-6">
                        <button id="mode-i-paid" class="flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all">我先墊付</button>
                        <button id="mode-friend-paid" class="flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all">朋友先付</button>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">總金額</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                                <input type="number" id="split-amount" class="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xl font-bold text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="0">
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">備註</label>
                            <input type="text" id="split-note" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="例如: 晚餐、KTV">
                        </div>

                        <div>
                             <label class="block text-sm font-medium text-gray-700 mb-1">記帳分類</label>
                             <select id="split-category" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 outline-none">
                                ${expenseCategories.map(c => `<option value="${c.id}" ${c.id === defaultCategoryId ? 'selected' : ''}>${c.name}</option>`).join('')}
                             </select>
                        </div>

                        <!-- Split Mode Toggle -->
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">分帳模式</label>
                            <div class="flex bg-gray-100 rounded-lg p-1">
                                <button id="split-equal" class="flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all">平均分攤</button>
                                <button id="split-custom" class="flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all">自訂金額</button>
                            </div>
                        </div>

                        <!-- Equal Split: Contact Selector -->
                        <div id="contact-section">
                            <label class="block text-sm font-medium text-gray-700 mb-2">分攤對象</label>
                            <div class="space-y-2 max-h-48 overflow-y-auto mb-3 custom-scrollbar">
                                ${contacts.length > 0 ? contacts.map(c => `
                                    <label class="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                                        <input type="checkbox" name="split-contact" value="${c.id}" class="size-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                                        <span class="ml-3 font-medium text-gray-700">${c.name}</span>
                                    </label>
                                `).join('') : '<div class="text-center text-gray-400 py-2">尚無聯絡人，請先新增</div>'}
                            </div>
                            <div class="flex gap-2">
                                <input type="text" id="new-contact-name" class="flex-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm" placeholder="新聯絡人名稱">
                                <button id="add-contact-btn" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-300">新增</button>
                            </div>
                        </div>

                        <!-- Custom Split: Per-person amount inputs -->
                        <div id="custom-section" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 mb-2">各人應付金額</label>
                            <div id="custom-list" class="space-y-2 mb-3"></div>
                            <button id="add-person-btn" class="w-full py-2 border-2 border-dashed border-indigo-200 text-indigo-600 rounded-lg text-sm font-bold hover:bg-indigo-50 transition-colors">
                                <i class="fa-solid fa-plus mr-1"></i> 新增一筆
                            </button>
                        </div>

                        <!-- Remaining Amount Display (custom mode only) -->
                        <div id="remaining-display" class="hidden">
                            <div class="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                                <span class="text-sm font-medium text-amber-800">剩餘未分</span>
                                <span id="remaining-amount" class="text-xl font-bold text-amber-600">$0</span>
                            </div>
                            <div id="remaining-ok" class="hidden">
                                <div class="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                                    <span class="text-sm font-medium text-green-800"><i class="fa-solid fa-check-circle mr-1"></i> 分帳完成</span>
                                    <span class="text-lg font-bold text-green-600">$0</span>
                                </div>
                            </div>
                        </div>

                        <!-- Friend Paid Specific UI -->
                        <div id="payer-section" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 mb-2">誰付的錢？</label>
                            <select id="payer-select" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-800">
                                 ${contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Inclusion (equal mode only) -->
                        <div id="include-me-section" class="flex items-center justify-between py-2">
                             <label class="flex items-center cursor-pointer">
                                <input type="checkbox" id="include-me" class="size-4 text-indigo-600 rounded" checked>
                                <span class="ml-2 text-sm text-gray-600">包含我自己</span>
                            </label>
                            <span id="split-count-display" class="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">1 人分攤</span>
                        </div>
                    </div>
                </div>

                <!-- Result Preview -->
                <div id="result-card" class="bg-indigo-600 rounded-xl shadow-lg p-5 text-wabi-surface transition-all opacity-50 grayscale">
                    <div class="flex justify-between items-end mb-4">
                        <div>
                            <p class="text-indigo-200 text-sm mb-1" id="result-title">每人應付</p>
                            <p class="text-4xl font-bold tracking-tight" id="result-amount">$0</p>
                        </div>
                         <div class="text-right">
                            <p class="text-indigo-200 text-xs">總金額</p>
                            <p class="text-lg font-medium" id="preview-total">$0</p>
                        </div>
                    </div>

                    <button id="create-debt-btn" class="w-full py-3 bg-white text-indigo-600 font-bold rounded-lg shadow-md hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                        建立欠款與記帳紀錄
                    </button>
                </div>
            </div>
        `;

        this.bindEvents(contacts, defaultCategoryId);
    },

    bindEvents(initialContacts, defaultCategoryId) {
        const contacts = [...initialContacts];
        const modeIPaidBtn = document.getElementById('mode-i-paid');
        const modeFriendPaidBtn = document.getElementById('mode-friend-paid');
        const payerSection = document.getElementById('payer-section');
        const contactSection = document.getElementById('contact-section');
        const customSection = document.getElementById('custom-section');
        const includeMeSection = document.getElementById('include-me-section');
        const remainingDisplay = document.getElementById('remaining-display');
        const amountInput = document.getElementById('split-amount');
        const includeMeCb = document.getElementById('include-me');
        const resultCard = document.getElementById('result-card');
        const createBtn = document.getElementById('create-debt-btn');
        const payerSelect = document.getElementById('payer-select');
        const addContactBtn = document.getElementById('add-contact-btn');
        const newContactInput = document.getElementById('new-contact-name');
        const categorySelect = document.getElementById('split-category');
        const splitEqualBtn = document.getElementById('split-equal');
        const splitCustomBtn = document.getElementById('split-custom');
        const customList = document.getElementById('custom-list');
        const addPersonBtn = document.getElementById('add-person-btn');

        let mode = 'i-paid';
        let splitMode = 'equal';

        // Mode switching (i-paid vs friend-paid)
        const switchMode = (m) => {
            mode = m;
            if (m === 'i-paid') {
                modeIPaidBtn.className = 'flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all';
                modeFriendPaidBtn.className = 'flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
                payerSection.classList.add('hidden');
                contactSection.classList.remove('hidden');
                customSection.classList.remove('hidden');
            } else {
                modeFriendPaidBtn.className = 'flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all';
                modeIPaidBtn.className = 'flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
                payerSection.classList.remove('hidden');
                contactSection.classList.remove('hidden');
                customSection.classList.remove('hidden');
            }
            calculateResult();
        };
        modeIPaidBtn.addEventListener('click', () => switchMode('i-paid'));
        modeFriendPaidBtn.addEventListener('click', () => switchMode('friend-paid'));

        // Split mode switching (equal vs custom)
        splitEqualBtn.addEventListener('click', () => {
            splitMode = 'equal';
            splitEqualBtn.className = 'flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all';
            splitCustomBtn.className = 'flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
            contactSection.classList.remove('hidden');
            includeMeSection.classList.remove('hidden');
            customSection.classList.add('hidden');
            remainingDisplay.classList.add('hidden');
            calculateResult();
        });
        splitCustomBtn.addEventListener('click', () => {
            splitMode = 'custom';
            splitCustomBtn.className = 'flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all';
            splitEqualBtn.className = 'flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
            contactSection.classList.add('hidden');
            includeMeSection.classList.add('hidden');
            customSection.classList.remove('hidden');
            remainingDisplay.classList.remove('hidden');
            // Initialize custom list with selected contacts
            initCustomList();
        });

        // Add contact
        addContactBtn.addEventListener('click', () => {
            const name = newContactInput.value.trim();
            if (!name) return;
            const id = 'c-' + Date.now();
            contacts.push({ id, name });
            this.ctx.data.addContact({ id, name });
            // Re-render contact list
            renderContacts();
            newContactInput.value = '';
        });

        const renderContacts = () => {
            const container = contactSection.querySelector('.space-y-2.max-h-48');
            container.innerHTML = contacts.map(c => `
                <label class="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                    <input type="checkbox" name="split-contact" value="${c.id}" class="size-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                    <span class="ml-3 font-medium text-gray-700">${c.name}</span>
                </label>
            `).join('');
            container.querySelectorAll('input[name="split-contact"]').forEach(cb => {
                cb.addEventListener('change', calculateResult);
            });
        };

        // Custom split: init list
        let customEntries = [];
        const initCustomList = () => {
            if (customEntries.length > 0) return;
            customEntries = [];
            // Pre-populate from checked contacts
            document.querySelectorAll('input[name="split-contact"]:checked').forEach(cb => {
                const contact = contacts.find(c => c.id === cb.value);
                if (contact) {
                    customEntries.push({ id: contact.id, name: contact.name, amount: '' });
                }
            });
            // If none selected, add "我" as first entry
            if (customEntries.length === 0) {
                customEntries.push({ id: '__me__', name: '我', amount: '' });
            }
            renderCustomList();
        };

        const renderCustomList = () => {
            customList.innerHTML = customEntries.map((entry, idx) => `
                <div class="flex items-center gap-2">
                    <select class="custom-person-name flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none" data-idx="${idx}">
                        <option value="__me__" ${entry.id === '__me__' ? 'selected' : ''}>我</option>
                        ${contacts.map(c => `<option value="${c.id}" ${c.id === entry.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                    <div class="relative flex-1">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input type="number" class="custom-person-amount w-full pl-7 pr-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none" data-idx="${idx}" value="${entry.amount}" placeholder="0">
                    </div>
                    <button class="remove-person p-2 text-gray-400 hover:text-red-500" data-idx="${idx}">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            `).join('');

            // Bind events
            customList.querySelectorAll('.custom-person-amount').forEach(input => {
                input.addEventListener('input', calculateRemaining);
            });
            customList.querySelectorAll('.remove-person').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx);
                    customEntries.splice(idx, 1);
                    renderCustomList();
                    calculateRemaining();
                });
            });
        };

        addPersonBtn.addEventListener('click', () => {
            customEntries.push({ id: '__me__', name: '我', amount: '' });
            renderCustomList();
        });

        // Remaining calculation
        const calculateRemaining = () => {
            const total = parseFloat(amountInput.value) || 0;
            let assigned = 0;
            customEntries.forEach(entry => {
                assigned += parseFloat(entry.amount) || 0;
            });
            // Re-read from DOM for live updates
            customList.querySelectorAll('.custom-person-amount').forEach(input => {
                const idx = parseInt(input.dataset.idx);
                customEntries[idx].amount = input.value;
            });
            let assignedLive = 0;
            customEntries.forEach(e => assignedLive += parseFloat(e.amount) || 0);
            const remaining = total - assignedLive;
            document.getElementById('remaining-amount').textContent = '$' + remaining.toFixed(0);
            const okDiv = document.getElementById('remaining-ok');
            if (remaining === 0) {
                okDiv.classList.remove('hidden');
            } else {
                okDiv.classList.add('hidden');
            }
            updateResultCard();
        };

        // Core calculation
        const calculateResult = () => {
            const total = parseFloat(amountInput.value) || 0;
            const checked = document.querySelectorAll('input[name="split-contact"]:checked');
            let count = checked.length;
            if (includeMeCb.checked) count += 1;

            document.getElementById('split-count-display').textContent = count + ' 人分攤';
            document.getElementById('preview-total').textContent = '$' + total.toFixed(0);

            if (count > 0) {
                const perPerson = total / count;
                document.getElementById('result-amount').textContent = '$' + perPerson.toFixed(0);
                document.getElementById('result-title').textContent = '每人應付';
                resultCard.classList.remove('opacity-50', 'grayscale');
                createBtn.disabled = false;
            } else {
                document.getElementById('result-amount').textContent = '$0';
                resultCard.classList.add('opacity-50', 'grayscale');
                createBtn.disabled = true;
            }
        };

        const updateResultCard = () => {
            const total = parseFloat(amountInput.value) || 0;
            document.getElementById('preview-total').textContent = '$' + total.toFixed(0);
            if (splitMode === 'custom') {
                let assigned = 0;
                customEntries.forEach(e => assigned += parseFloat(e.amount) || 0);
                const remaining = total - assigned;
                document.getElementById('result-amount').textContent = '$' + remaining.toFixed(0);
                document.getElementById('result-title').textContent = '剩餘未分';
                if (customEntries.length > 0 && remaining === 0) {
                    resultCard.classList.remove('opacity-50', 'grayscale');
                    createBtn.disabled = false;
                } else {
                    resultCard.classList.add('opacity-50', 'grayscale');
                    createBtn.disabled = true;
                }
            }
        };

        amountInput.addEventListener('input', () => {
            if (splitMode === 'equal') calculateResult();
            else calculateRemaining();
        });
        includeMeCb.addEventListener('change', calculateResult);

        // Create debts
        createBtn.addEventListener('click', async () => {
            const totalAmount = parseFloat(amountInput.value) || 0;
            const note = document.getElementById('split-note').value.trim();
            const category = categorySelect.value;
            const ledgerId = this.ctx.activeLedgerId();

            if (splitMode === 'equal') {
                await this.handleEqualSplit(totalAmount, note, category, ledgerId);
            } else {
                await this.handleCustomSplit(totalAmount, note, category, ledgerId);
            }
        });
    },

    async handleEqualSplit(totalAmount, note, categoryId, ledgerId) {
        const contacts = await this.ctx.data.getContacts();
        const checked = document.querySelectorAll('input[name="split-contact"]:checked');
        const includeMe = document.getElementById('include-me').checked;
        const mode = document.getElementById('mode-i-paid').classList.contains('bg-white') ? 'i-paid' : 'friend-paid';

        const splitContacts = [];
        checked.forEach(cb => {
            const c = contacts.find(x => x.id === cb.value);
            if (c) splitContacts.push(c);
        });
        if (includeMe) splitContacts.push({ id: '__me__', name: '我' });

        const count = splitContacts.length;
        const perPerson = Math.round(totalAmount / count);

        // Create expense record
        const expense = {
            type: 'expense',
            category: categoryId,
            amount: totalAmount,
            description: note || '聚餐分帳',
            date: new Date().toISOString().split('T')[0]
        };
        await this.ctx.data.addRecord(expense);

        // Create debts
        if (mode === 'i-paid') {
            for (const contact of splitContacts.filter(c => c.id !== '__me__')) {
                await this.ctx.data.addDebt({
                    type: 'receivable',
                    contactId: contact.id,
                    amount: perPerson,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳'
                });
            }
        } else {
            const payerId = document.getElementById('payer-select').value;
            for (const contact of splitContacts.filter(c => c.id !== '__me__' && c.id !== payerId)) {
                await this.ctx.data.addDebt({
                    type: 'payable',
                    contactId: contact.id,
                    amount: perPerson,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳'
                });
            }
            const totalOwed = (count - (includeMe ? 1 : 0)) * perPerson;
            if (totalOwed !== 0) {
                await this.ctx.data.addDebt({
                    type: 'receivable',
                    contactId: payerId,
                    amount: totalOwed,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳 (代付)'
                });
            }
        }

        this.ctx.ui.showToast('分帳成功！', 'success');
        this.ctx.ui.navigateTo('#home');
    },

    async handleCustomSplit(totalAmount, note, categoryId, ledgerId) {
        const contacts = await this.ctx.data.getContacts();
        const mode = document.getElementById('mode-i-paid').classList.contains('bg-white') ? 'i-paid' : 'friend-paid';

        // Read custom entries from DOM
        const entries = [];
        const customList = document.getElementById('custom-list');
        customList.querySelectorAll('.custom-person-amount').forEach(input => {
            const idx = input.dataset.idx;
            const nameSelect = customList.querySelector(`.custom-person-name[data-idx="${idx}"]`);
            const contactId = nameSelect.value;
            const amount = parseFloat(input.value) || 0;
            entries.push({ contactId, amount });
        });

        // Create expense record
        const expense = {
            type: 'expense',
            category: categoryId,
            amount: totalAmount,
            description: note || '聚餐分帳',
            date: new Date().toISOString().split('T')[0]
        };
        await this.ctx.data.addRecord(expense);

        // Create debts based on custom split
        if (mode === 'i-paid') {
            for (const entry of entries) {
                if (entry.contactId === '__me__' || entry.amount === 0) continue;
                await this.ctx.data.addDebt({
                    ledgerId,
                    contactId: entry.contactId,
                    amount: entry.amount,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳',
                    type: 'receivable'
                });
            }
        } else {
            const payerId = document.getElementById('payer-select').value;
            for (const entry of entries) {
                if (entry.amount === 0) continue;
                if (entry.contactId === payerId) continue;
                await this.ctx.data.addDebt({
                    ledgerId,
                    contactId: entry.contactId,
                    amount: entry.amount,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳',
                    type: 'payable'
                });
            }
            const payerEntry = entries.find(e => e.contactId === payerId);
            const payerShare = payerEntry ? payerEntry.amount : 0;
            const owedToPayer = totalAmount - payerShare;
            if (owedToPayer > 0) {
                await this.ctx.data.addDebt({
                    ledgerId,
                    contactId: payerId,
                    amount: owedToPayer,
                    date: new Date().toISOString().split('T')[0],
                    description: note || '聚餐分帳 (代付)',
                    type: 'receivable'
                });
            }
        }

        this.ctx.ui.showToast('分帳成功！', 'success');
        this.ctx.ui.navigateTo('#home');
    },
};

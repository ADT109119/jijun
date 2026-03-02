export default {
    meta: {
        id: 'com.walkingfish.bill_splitter',
        name: '分帳神器',
        version: '1.1',
        description: '聚餐旅遊分帳助手，自動計算並建立欠款紀錄。',
        author: 'The walking fish 步行魚',
        icon: 'fa-file-invoice-dollar'
    },
    
    init(context) {
        this.ctx = context;
        this.ctx.ui.registerPage('split-bill', '分帳神器', (container) => this.render(container));
        
        // Add home widget entry
        this.ctx.ui.registerHomeWidget('com.walkingfish.bill_splitter', (container) => {
            container.innerHTML = `
                <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex items-center justify-between cursor-pointer hover:bg-indigo-100 transition-colors" id="open-splitter-widget">
                    <div class="flex items-center gap-3">
                        <div class="bg-indigo-500 text-white rounded-lg size-10 flex items-center justify-center">
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
                    <!-- Mode Switcher -->
                    <div class="flex bg-gray-100 rounded-lg p-1 mb-6">
                        <button id="mode-i-paid" class="flex-1 py-2 text-sm font-bold rounded-md bg-white text-indigo-600 shadow-sm transition-all">我先墊付</button>
                        <button id="mode-friend-paid" class="flex-1 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-all">朋友先付</button>
                    </div>

                    <!-- Input Section -->
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

                        <!-- Contact Selector -->
                        <div id="contact-section">
                            <label class="block text-sm font-medium text-gray-700 mb-2">分攤對象</label>
                            
                            <!-- Contact List (Checkboxes) -->
                            <div class="space-y-2 max-h-48 overflow-y-auto mb-3 custom-scrollbar">
                                ${contacts.length > 0 ? contacts.map(c => `
                                    <label class="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                                        <input type="checkbox" name="split-contact" value="${c.id}" class="size-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                                        <span class="ml-3 font-medium text-gray-700">${c.name}</span>
                                    </label>
                                `).join('') : '<div class="text-center text-gray-400 py-2">尚無聯絡人，請先新增</div>'}
                            </div>
                            
                            <!-- Add New Contact -->
                            <div class="flex gap-2">
                                <input type="text" id="new-contact-name" class="flex-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm" placeholder="新聯絡人名稱">
                                <button id="add-contact-btn" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-300">新增</button>
                            </div>
                        </div>

                        <!-- Friend Paid Specific UI (Hidden by default) -->
                        <div id="payer-section" class="hidden">
                            <label class="block text-sm font-medium text-gray-700 mb-2">誰付的錢？</label>
                            <select id="payer-select" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-800">
                                 ${contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Inclusion -->
                        <div class="flex items-center justify-between py-2">
                             <label class="flex items-center cursor-pointer">
                                <input type="checkbox" id="include-me" class="size-4 text-indigo-600 rounded" checked>
                                <span class="ml-2 text-sm text-gray-600">包含我自己</span>
                            </label>
                            <span id="split-count-display" class="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">1 人分攤</span>
                        </div>

                    </div>
                </div>

                <!-- Result Preview -->
                <div id="result-card" class="bg-indigo-600 rounded-xl shadow-lg p-5 text-white transition-all opacity-50 grayscale">
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
        const amountInput = document.getElementById('split-amount');
        const includeMeCb = document.getElementById('include-me');
        const resultCard = document.getElementById('result-card');
        const createBtn = document.getElementById('create-debt-btn');
        const payerSelect = document.getElementById('payer-select');
        const addContactBtn = document.getElementById('add-contact-btn');
        const newContactInput = document.getElementById('new-contact-name');
        const categorySelect = document.getElementById('split-category');

        let mode = 'i-paid'; // or 'friend-paid'

        const updateUI = () => {
            const amount = parseFloat(amountInput.value) || 0;
            const selectedContacts = [...document.querySelectorAll('input[name="split-contact"]:checked')];
            let count = selectedContacts.length;
            if (includeMeCb.checked) count++;
            
            if (count > 0 && amount > 0) {
                const perPerson = Math.ceil(amount / count); // Use ceil to avoid decimals issues
                document.getElementById('result-amount').textContent = `$${perPerson}`;
                document.getElementById('preview-total').textContent = `$${amount}`;
                resultCard.classList.remove('opacity-50', 'grayscale');
                createBtn.disabled = false;
                document.getElementById('split-count-display').textContent = `${count} 人分攤`;
            } else {
                resultCard.classList.add('opacity-50', 'grayscale');
                createBtn.disabled = true;
                document.getElementById('split-count-display').textContent = `${count} 人分攤`;
            }
        };

        const switchMode = (newMode) => {
            mode = newMode;
            if (mode === 'i-paid') {
                modeIPaidBtn.classList.add('bg-white', 'text-indigo-600', 'shadow-sm', 'font-bold');
                modeIPaidBtn.classList.remove('text-gray-500', 'font-medium');
                modeFriendPaidBtn.classList.remove('bg-white', 'text-indigo-600', 'shadow-sm', 'font-bold');
                modeFriendPaidBtn.classList.add('text-gray-500', 'font-medium');
                
                payerSection.classList.add('hidden');
                contactSection.classList.remove('hidden'); 
                document.getElementById('result-title').textContent = '每人應付給您';
                createBtn.textContent = '建立欠款與記帳紀錄';
            } else {
                modeFriendPaidBtn.classList.add('bg-white', 'text-indigo-600', 'shadow-sm', 'font-bold');
                modeFriendPaidBtn.classList.remove('text-gray-500', 'font-medium');
                modeIPaidBtn.classList.remove('bg-white', 'text-indigo-600', 'shadow-sm', 'font-bold');
                modeIPaidBtn.classList.add('text-gray-500', 'font-medium');

                payerSection.classList.remove('hidden');
                contactSection.classList.remove('hidden'); 
                document.getElementById('result-title').textContent = '您應付給對方';
                createBtn.textContent = '建立欠款紀錄';
            }
            updateUI();
        };

        modeIPaidBtn.addEventListener('click', () => switchMode('i-paid'));
        modeFriendPaidBtn.addEventListener('click', () => switchMode('friend-paid'));

        amountInput.addEventListener('input', updateUI);
        includeMeCb.addEventListener('change', updateUI);
        document.addEventListener('change', (e) => {
            if (e.target.name === 'split-contact') updateUI();
        });

        // Add Contact Logic
        addContactBtn.addEventListener('click', async () => {
             const name = newContactInput.value.trim();
             if (name) {
                 const newId = await this.ctx.data.addContact({ name });
                 const newContact = { id: newId, name };
                 contacts.push(newContact);
                 
                 // Refresh list (Quick hack: append label)
                 const wrapper = document.querySelector('.custom-scrollbar');
                 const label = document.createElement('label');
                 label.className = 'flex items-center p-3 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors';
                 label.innerHTML = `
                      <input type="checkbox" name="split-contact" value="${newId}" class="size-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" checked>
                      <span class="ml-3 font-medium text-gray-700">${name}</span>
                 `;
                 wrapper.appendChild(label);
                 
                 // Also update select if exists
                 const option = document.createElement('option');
                 option.value = newId;
                 option.textContent = name;
                 payerSelect.appendChild(option);

                 newContactInput.value = '';
                 updateUI();
             }
        });

        createBtn.addEventListener('click', async () => {
            const amount = parseFloat(amountInput.value);
            const note = document.getElementById('split-note').value;
            const categoryId = categorySelect.value || defaultCategoryId;
            const selectedContacts = [...document.querySelectorAll('input[name="split-contact"]:checked')];
            let count = selectedContacts.length;
            if (includeMeCb.checked) count++;
            
            if (count === 0) return;

            const perPerson = Math.ceil(amount / count);

            if (mode === 'i-paid') {
                 // 1. Create Expense Record for ME (Total Amount)
                 await this.ctx.data.addRecord({
                     amount: amount,
                     type: 'expense',
                     category: categoryId,
                     date: new Date().toISOString().split('T')[0],
                     description: `${note || '分帳'} (總額 $${amount}, ${count}人分)`
                 });

                 // 2. Create Debts (Receivable) for selected contacts
                 for (const cb of selectedContacts) {
                     const contactId = parseInt(cb.value);
                     await this.ctx.data.addDebt({
                         contactId,
                         type: 'receivable',
                         amount: perPerson,
                         date: new Date().toISOString().split('T')[0],
                         description: `${note || '分帳'} (應付 $${perPerson})`
                     });
                 }
                 this.ctx.ui.showToast(`已建立記帳與 ${selectedContacts.length} 筆欠款`);
            } else {
                // Friend Paid
                // I owe Friend X.
                // My Expense = perPerson (My Share).
                
                const payerId = parseInt(payerSelect.value);
                const payerName = payerSelect.options[payerSelect.selectedIndex].text;
                
                const debtId = await this.ctx.data.addDebt({
                    contactId: payerId,
                    type: 'payable',
                    amount: perPerson,
                    date: new Date().toISOString().split('T')[0],
                    description: `${note || '分帳'} (欠 ${payerName})`
                });

                await this.ctx.data.addRecord({
                    amount: perPerson,
                    type: 'expense',
                    category: categoryId,
                    date: new Date().toISOString().split('T')[0],
                    description: `${note || '分帳'} (欠 ${payerName})`,
                    debtId: debtId
                });
                
                this.ctx.ui.showToast(`已建立記帳與欠款紀錄`);
            }
            
            this.ctx.ui.navigateTo('#records');
        });
    }
}

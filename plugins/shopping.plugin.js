export default {
    meta: {
        id: 'com.walkingfish.shopping_list',
        name: '待辦購物清單',
        version: '1.0',
        description: '在首頁顯示購物清單，買完直接記帳！',
        author: 'The walking fish 步行魚',
        icon: 'fa-list-check'
    },
    init(context) {
        this.context = context;
        this.items = JSON.parse(localStorage.getItem('shopping_list_items') || '[]');
        
        // Register Home Widget
        context.ui.registerHomeWidget((container) => this.renderWidget(container));
    },

    save() {
        localStorage.setItem('shopping_list_items', JSON.stringify(this.items));
    },

    addItem(name) {
        if (!name.trim()) return;
        this.items.push({ id: Date.now(), name: name.trim(), checked: false });
        this.save();
        this.renderList();
    },

    async checkItem(id) {
        const item = this.items.find(i => i.id === id);
        if (!item) return;

        // Confirm purchase
        const confirmed = await this.context.ui.showConfirm('已購買？', `是否將 "${item.name}" 加入支出紀錄？`);
        
        if (confirmed) {
            // Remove from list
            this.items = this.items.filter(i => i.id !== id);
            this.save();
            this.renderList();

            // Navigate to Add Page with pre-filled data
            this.context.ui.openAddPage({
                type: 'expense',
                description: item.name,
                category: 'shopping' // Or let user choose
            });
        }
    },

    deleteItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        this.save();
        this.renderList();
    },

    renderWidget(container) {
        this.container = container; 
        container.innerHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-wabi-border p-4">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold text-wabi-primary flex items-center gap-2">
                        <i class="fa-solid fa-cart-shopping"></i> 購物清單
                    </h3>
                    <span class="text-xs text-wabi-text-secondary bg-gray-100 px-2 py-1 rounded-full count-badge">${this.items.length}</span>
                </div>
                
                <div class="flex gap-2 mb-3">
                    <input type="text" id="shop-add-input" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-wabi-primary transition-colors" placeholder="新增項目 (例如: 衛生紙)">
                    <button id="shop-add-btn" class="bg-wabi-primary text-white rounded-lg w-10 shrink-0 flex items-center justify-center hover:bg-opacity-90">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>

                <ul id="shop-list" class="space-y-2 max-h-40 overflow-y-auto">
                    <!-- Items -->
                </ul>
                ${this.items.length === 0 ? '<p class="text-xs text-center text-gray-400 py-2">清單是空的，太棒了！</p>' : ''}
            </div>
        `;

        this.listEl = container.querySelector('#shop-list');
        this.inputEl = container.querySelector('#shop-add-input');
        
        // Bind Events
        container.querySelector('#shop-add-btn').addEventListener('click', () => {
            this.addItem(this.inputEl.value);
            this.inputEl.value = '';
        });

        // Enter key
        this.inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addItem(this.inputEl.value);
                this.inputEl.value = '';
            }
        });

        this.renderList();
    },

    renderList() {
        if (!this.listEl) return;
        
        this.container.querySelector('.count-badge').textContent = this.items.length;
        
        this.listEl.innerHTML = this.items.map(item => `
            <li class="flex items-center justify-between group p-2 hover:bg-gray-50 rounded-lg transition-colors">
                <div class="flex items-center gap-3 cursor-pointer item-click-area" data-id="${item.id}">
                    <div class="w-5 h-5 rounded border border-gray-300 flex items-center justify-center hover:border-wabi-primary transition-colors">
                        <i class="fa-solid fa-check text-wabi-primary opacity-0 scale-50 transition-all"></i>
                    </div>
                    <span class="text-sm text-gray-700">${item.name}</span>
                </div>
                <button class="text-gray-300 hover:text-red-500 delete-btn opacity-0 group-hover:opacity-100 transition-opacity px-2" data-id="${item.id}">
                    <i class="fa-solid fa-times"></i>
                </button>
            </li>
        `).join('');

        // Bind Item Events
        this.listEl.querySelectorAll('.item-click-area').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id, 10);
                this.checkItem(id);
            });
        });

        this.listEl.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id, 10);
                this.deleteItem(id);
            });
        });
    }
};

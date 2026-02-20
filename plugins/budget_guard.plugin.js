export default {
    meta: {
        id: 'com.walkingfish.budget_guard',
        name: '預算阻擋者',
        version: '1.3',
        description: '設定單筆支出上限，防止衝動消費！',
        author: 'The walking fish 步行魚',
        icon: 'fa-shield-halved'
    },
    init(context) {
        this.context = context;
        this.limit = context.storage.getItem('limit') || 1000;
        this.mode = context.storage.getItem('mode') || 'block'; // 'block' or 'warn'

        // Register Settings Page
        context.ui.registerPage('budget-guard', '預算阻擋者設定', (container) => this.renderSettings(container));
        
        // Register Hook
        context.events.on('onRecordSaveBefore', async (record) => {
            if (record.type === 'expense') {
                const limit = parseInt(this.limit, 10);
                if (record.amount > limit) {
                    if (this.mode === 'block') {
                        // Show Blocking Modal
                        await context.ui.showAlert('⚠️ 預算阻擋', `該筆消費 $${record.amount} 超過單筆上限 $${limit}！\n\n請調整金額。`);
                        return null; // Cancel save
                    } else {
                        // Show Warning Modal and Confirm
                        const confirmed = await context.ui.showConfirm('⚠️ 預算提醒', `該筆消費 $${record.amount} 超過單筆上限 $${limit}！\n\n確定要繼續儲存嗎？`);
                        if (!confirmed) {
                            return null; // Cancel save if user says No
                        }
                        // Proceed with save if Yes
                    }
                }
            }
            return record;
        });

        console.log('Budget Guard initialized with limit:', this.limit, 'mode:', this.mode);
    },

    renderSettings(container) {
        container.innerHTML = `
            <div class="page active flex flex-col h-full bg-wabi-bg p-4">
                <header class="flex items-center gap-3 mb-6">
                    <button id="bg-back-btn" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </button>
                    <h1 class="text-xl font-bold text-gray-800">預算阻擋者設定</h1>
                </header>

                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <div class="flex items-center justify-center mb-6 text-wabi-primary text-5xl">
                        <i class="fa-solid fa-shield-halved"></i>
                    </div>
                    
                    <p class="text-gray-600 mb-6 text-center">當單筆支出超過設定金額時，系統可以阻止儲存或發出提醒。</p>

                    <div class="mb-6">
                        <label class="block text-sm font-bold text-gray-700 mb-2">單筆支出上限</label>
                        <div class="relative">
                            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                            <input type="number" id="budget-limit" value="${this.limit}" class="w-full pl-8 p-3 border rounded-lg focus:ring-2 focus:ring-wabi-primary outline-none text-lg">
                        </div>
                    </div>

                    <div class="mb-8">
                         <label class="block text-sm font-bold text-gray-700 mb-2">阻擋模式</label>
                         <div class="flex gap-4">
                            <label class="flex-1 flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-wabi-primary has-[:checked]:bg-wabi-primary/5">
                                <span class="flex items-center gap-2">
                                    <i class="fa-solid fa-ban text-red-500"></i>
                                    <span>強制阻擋</span>
                                </span>
                                <input type="radio" name="budget-mode" value="block" class="accent-wabi-primary w-5 h-5" ${this.mode === 'block' ? 'checked' : ''}>
                            </label>
                            <label class="flex-1 flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-wabi-primary has-[:checked]:bg-wabi-primary/5">
                                <span class="flex items-center gap-2">
                                    <i class="fa-solid fa-bell text-yellow-500"></i>
                                    <span>僅提醒</span>
                                </span>
                                <input type="radio" name="budget-mode" value="warn" class="accent-wabi-primary w-5 h-5" ${this.mode === 'warn' ? 'checked' : ''}>
                            </label>
                         </div>
                    </div>

                    <button id="bg-save-btn" class="w-full bg-wabi-primary text-white py-3 rounded-xl font-bold text-lg hover:bg-opacity-90 transition-colors">
                        儲存設定
                    </button>
                </div>
            </div>
        `;

        container.querySelector('#bg-back-btn').addEventListener('click', () => {
             window.location.hash = '#plugins';
        });

        container.querySelector('#bg-save-btn').addEventListener('click', () => {
            const val = container.querySelector('#budget-limit').value;
            const mode = container.querySelector('input[name="budget-mode"]:checked').value;
            
            if (val && !isNaN(val)) {
                this.limit = val;
                this.mode = mode;
                this.context.storage.setItem('limit', val);
                this.context.storage.setItem('mode', mode);
                
                this.context.ui.showToast('設定已儲存', 'success');
                setTimeout(() => window.location.hash = '#plugins', 1000);
            } else {
                this.context.ui.showToast('請輸入有效的金額', 'error');
            }
        });
    }
};

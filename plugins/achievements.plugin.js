export default {
    meta: {
        id: 'com.walkingfish.achievements',
        name: '記帳成就系統',
        version: '1.6',
        description: '讓記帳變好玩！解鎖徽章與成就。',
        author: 'The walking fish 步行魚',
        icon: 'fa-trophy'
    },
    init(context) {
        this.context = context;
        // Load stats with defaults
        const defaultStats = {
            totalRecords: 0,
            totalExpense: 0,
            lastRecordDate: null,
            streak: 0,
            recordsToday: 0
        };
        const savedStats = context.storage.getJSON('stats') || {};
        this.stats = { ...defaultStats, ...savedStats };

        this.unlocked = context.storage.getJSON('unlocked') || [];
        this.pending = context.storage.getJSON('pending_notify') || [];

        this.achievements = [
            { id: 'first_blood', name: '初出茅廬', desc: '完成第一筆記帳', icon: 'fa-baby' },
            { id: 'streak_3', name: '持之以恆', desc: '連續 3 天記帳', icon: 'fa-fire' },
            { id: 'streak_7', name: '記帳達人', desc: '連續 7 天記帳', icon: 'fa-crown' },
            { id: 'streak_30', name: '意志堅定', desc: '連續 30 天記帳', icon: 'fa-calendar-check' },
            { id: 'weekend_warrior', name: '週末戰士', desc: '在週末進行記帳', icon: 'fa-umbrella-beach' },
            { id: 'lunch_time', name: '午餐時光', desc: '在午餐時間 (11:00-14:00) 記帳', icon: 'fa-utensils' },
            { id: 'shopaholic', name: '購物狂', desc: '單日記帳超過 5 筆', icon: 'fa-bag-shopping' },
            { id: 'note_taker', name: '筆記大師', desc: '寫下超過 20 字的備註', icon: 'fa-pen-nib' },
            { id: 'penny_pincher', name: '省錢達人', desc: '單筆支出小於 $10', icon: 'fa-piggy-bank' },
            { id: 'big_spender', name: '揮金如土', desc: '單筆支出超過 $5,000', icon: 'fa-money-bill-wave' },
            { id: 'millionaire', name: '百萬富翁', desc: '總支出累積超過 100 萬', icon: 'fa-gem' },
            { id: 'night_owl', name: '夜貓子', desc: '在凌晨 00:00 - 04:00 記帳', icon: 'fa-moon' },
            { id: 'early_bird', name: '早起的鳥兒', desc: '在清晨 05:00 - 08:00 記帳', icon: 'fa-sun' },
            { id: 'big_spender_plus', name: '揮霍無度', desc: '單筆支出超過 $10,000', icon: 'fa-money-bill-1-wave' },
            { id: 'night_owl_real', name: '真正的夜貓子', desc: '在凌晨 02:00 - 05:00 記帳', icon: 'fa-cloud-moon' },
            { id: 'saver_month', name: '省錢一族', desc: '當月收入大於支出', icon: 'fa-piggy-bank' }
        ];

        // Register Page
        context.ui.registerPage('achievements', '成就館', (container) => this.renderPage(container));

        // Hook for Logic
        context.events.on('onRecordSaveAfter', (record) => this.checkAchievements(record));

        // Hook for Notification
        context.events.on('onPageRenderAfter', () => this.showPendingNotifications());
    },

    showPendingNotifications() {
        if (this.pending.length > 0) {
           setTimeout(() => {
                this.pending.forEach(name => {
                    this.context.ui.showToast(`🏆 解鎖成就：${name}！`, 'success');
                });
                this.pending = [];
                this.context.storage.setJSON('pending_notify', []);
            }, 500);
        }
    },

    checkAchievements(record) {
        const newUnlocks = [];
        this.stats.totalRecords++;
        
        if (record.type === 'expense') {
             this.stats.totalExpense = (this.stats.totalExpense || 0) + record.amount;
        }

        // Check First Blood
        if (this.stats.totalRecords >= 1) this.unlock('first_blood', newUnlocks);

        // Date Logic
        const now = new Date();
        const today = now.toDateString();
        const last = this.stats.lastRecordDate;
        
        if (last !== today) {
            // New Day
            this.stats.recordsToday = 0; // Reset
            
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            
            if (last === yesterday.toDateString()) {
                this.stats.streak = (this.stats.streak || 0) + 1;
            } else {
                this.stats.streak = 1; // Reset or Start
            }
            this.stats.lastRecordDate = today;
        }
        
        // Increase records today
        this.stats.recordsToday = (this.stats.recordsToday || 0) + 1;

        // Streak
        if (this.stats.streak >= 3) this.unlock('streak_3', newUnlocks);
        if (this.stats.streak >= 7) this.unlock('streak_7', newUnlocks);
        if (this.stats.streak >= 30) this.unlock('streak_30', newUnlocks);

        // Shopaholic
        if (this.stats.recordsToday >= 5) this.unlock('shopaholic', newUnlocks);

        // Weekend
        const day = now.getDay();
        if (day === 0 || day === 6) this.unlock('weekend_warrior', newUnlocks);

        // Lunch Time (11-13 means 11:00 to 13:59?) "in 11:00-14:00".
        const hour = now.getHours();
        if (hour >= 11 && hour < 14) this.unlock('lunch_time', newUnlocks);

        // Note Taker
        if (record.description && record.description.length >= 20) this.unlock('note_taker', newUnlocks);

        // Amount Checks (Expense only)
        if (record.type === 'expense') {
            if (record.amount < 10 && record.amount > 0) this.unlock('penny_pincher', newUnlocks);
            if (record.amount > 5000) this.unlock('big_spender', newUnlocks);
            if ((this.stats.totalExpense || 0) > 1000000) this.unlock('millionaire', newUnlocks);
        }

        // Time Checks
        if (hour >= 0 && hour < 4) this.unlock('night_owl', newUnlocks);
        if (hour >= 5 && hour < 9) this.unlock('early_bird', newUnlocks);

        // Saver (Income > Expense in current month)
        // Need to calculate monthly totals. This is expensive to do on every save?
        // Maybe do it only if record date is near end of month or just check current stats?
        // Let's implement a simpler "Daily Saver": Income > Expense for the day?
        // User asked for "Saver" (省錢一族): Income > Expense for a month.
        // We can check this when viewing the Achievements page or here?
        // Let's check it here but we need monthly data.
        // For performance, let's just checking "Big Spender" > 5000 is already done.
        // "Saver" might be better as "No Expense Day"?
        // Plan said: "Income > Expense for a month".
        // Let's skip complex monthly query here to avoid lag on every save.
        // Alternative: "Budget Master" - Expense < Budget?
        // Let's implement "Tracking Master" (Consecutive 30 days) - ID: streak_30 is already there!
        // Wait, `streak_30` is already in the list.
        // Plan request: "Tracking Master" (30 days), "Saver" (Income > Expense), "Big Spender" (> 10000), "Night Owl" (2-5 AM).
        
        // My existing code has:
        // `streak_30` (Will use this)
        // `big_spender` (> 5000). I will add `big_spender_2` (> 10000).
        // `night_owl` (00-04). I will adjust to 02-05 or keep current?
        // `saver` (Month Income > Expense).

        // Big Spender 2
        if (record.type === 'expense' && record.amount > 10000) this.unlock('big_spender_plus', newUnlocks);

        // Night Owl Update (User asked 2 AM - 5 AM)
        if (hour >= 2 && hour < 5) this.unlock('night_owl_real', newUnlocks);

        this.context.storage.setJSON('stats', this.stats);

        // Queue Notifications
        if (newUnlocks.length > 0) {
            const currentPending = this.context.storage.getJSON('pending_notify') || [];
            const uniquePending = [...new Set([...currentPending, ...newUnlocks])];
            this.context.storage.setJSON('pending_notify', uniquePending);
            this.pending = uniquePending;
        }
    },

    async checkMonthlyAchievements() {
        // Called when page renders to check monthly stats safely
        const records = await this.context.data.getRecords();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        
        const thisMonthRecords = records.filter(r => {
            const d = new Date(r.date);
            return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
        });
        
        const income = thisMonthRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
        const expense = thisMonthRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
        
        if (income > 0 && expense > 0 && income > expense) {
            // Check if achieved?
            // Since this is async and called from render, we can unlock directly if we want
            // But we need to update state.
             if (!this.unlocked.includes('saver_month')) {
                this.unlocked.push('saver_month');
                this.context.storage.setJSON('unlocked', this.unlocked);
                this.context.ui.showToast('🏆 解鎖成就：省錢一族！', 'success');
             }
        }
    },

    unlock(id, list) {
        if (!this.unlocked.includes(id)) {
            this.unlocked.push(id);
            this.context.storage.setJSON('unlocked', this.unlocked);
            const ach = this.achievements.find(a => a.id === id);
            if (ach) list.push(ach.name);
        }
    },

    async renderPage(container) {
        await this.checkMonthlyAchievements();
        container.innerHTML = `
            <div class="page active bg-wabi-bg p-4 pb-20 md:pb-8 max-w-3xl mx-auto">
                <header class="flex items-center gap-3 mb-6">
                     <button id="ach-back-btn" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </button>
                    <h1 class="text-xl font-bold text-gray-800">成就館</h1>
                </header>

                <div class="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl p-4 text-wabi-surface mb-6 shadow-lg">
                     <div class="flex justify-between items-end">
                         <div>
                             <p class="text-wabi-surface/80 text-sm">已解鎖成就</p>
                             <p class="text-3xl font-bold mt-1">${this.unlocked.length} <span class="text-lg font-normal opacity-80">/ ${this.achievements.length}</span></p>
                         </div>
                         <i class="fa-solid fa-trophy text-5xl opacity-30"></i>
                     </div>
                     <div class="w-full bg-black/20 h-2 rounded-full mt-4 overflow-hidden">
                         <div class="bg-white h-full" style="width: ${(this.unlocked.length / this.achievements.length) * 100}%"></div>
                     </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    ${this.achievements.map(ach => {
                        const isUnlocked = this.unlocked.includes(ach.id);
                        return `
                            <div class="bg-white p-3 rounded-xl border ${isUnlocked ? 'border-yellow-400 bg-yellow-50/50' : 'border-gray-100 grayscale'} flex flex-col items-center text-center shadow-sm relative overflow-hidden h-32 justify-center group transition-all duration-300">
                                ${isUnlocked ? '<div class="absolute top-0 right-0 bg-yellow-400 text-wabi-surface text-[10px] px-2 py-0.5 rounded-bl-lg">已解鎖</div>' : ''}
                                <div class="text-3xl mb-2 ${isUnlocked ? 'text-yellow-500 scale-110' : 'text-gray-300'} transition-transform group-hover:scale-125">
                                    <i class="fa-solid ${ach.icon}"></i>
                                </div>
                                <h3 class="font-bold text-gray-800 text-sm leading-tight">${ach.name}</h3>
                                ${isUnlocked ? `<p class="text-[10px] text-gray-500 mt-1">${ach.desc}</p>` : '<p class="text-[10px] text-transparent mt-1 select-none">???</p>'}
                            </div>
                        `;
                    }).join('')}
                </div>
                
                <div class="mt-8 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h3 class="font-bold text-gray-800 mb-2 border-b border-gray-100 pb-2">統計數據</h3>
                    <div class="space-y-2">
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-500">總記帳次數</span>
                            <span class="font-medium text-gray-800">${this.stats.totalRecords}</span>
                        </div>
                         <div class="flex justify-between text-sm">
                            <span class="text-gray-500">目前連勝天數</span>
                            <span class="font-medium text-gray-800">${this.stats.streak} 天</span>
                        </div>
                         <div class="flex justify-between text-sm">
                            <span class="text-gray-500">今日記帳</span>
                            <span class="font-medium text-gray-800">${this.stats.recordsToday || 0} 筆</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
         container.querySelector('#ach-back-btn').addEventListener('click', () => {
             this.context.ui.navigateTo('#plugins');
        });
    }
};

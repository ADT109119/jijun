export default {
    meta: {
        id: 'com.example.wheel',
        name: '命運大轉盤',
        version: '1.0',
        description: '做不出決定嗎？讓轉盤來幫你！支援自訂多個轉盤。'
    },
    init(context) {
        this.context = context;
        this.STORAGE_KEY = 'wheel_plugin_data';
        
        // Register the full page
        context.ui.registerPage('wheel', '命運大轉盤', (container) => this.render(container));
        
        // Optional: Show toast on load
        // context.ui.showToast('轉盤插件已就緒', 'success');
    },

    getData() {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        return raw ? JSON.parse(raw) : { wheels: [] };
    },

    saveData(data) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    },

    render(container) {
        this.container = container;
        // Basic Layout
        container.innerHTML = `
            <div class="page active flex flex-col h-full bg-wabi-bg">
                <!-- Header -->
                <header class="flex items-center justify-between p-4 bg-white border-b border-gray-200">
                    <div class="flex items-center gap-3">
                        <button id="wheel-back-btn" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600">
                            <i class="fa-solid fa-chevron-left text-xl"></i>
                        </button>
                        <h1 class="text-xl font-bold text-gray-800">命運大轉盤</h1>
                    </div>
                    <button id="wheel-add-btn" class="text-wabi-primary font-medium px-3 py-1 rounded hover:bg-blue-50">
                        <i class="fa-solid fa-plus mr-1"></i>新增
                    </button>
                </header>

                <!-- Content Area -->
                <main id="wheel-content" class="flex-1 overflow-y-auto p-4 relative">
                    <!-- Views will be injected here -->
                </main>
            </div>
        `;

        container.querySelector('#wheel-back-btn').addEventListener('click', () => {
            // Check if we are in sub-view (Play/Edit) or Root
            if (this.currentView === 'list') {
                window.location.hash = '#plugins'; // Go back to settings/plugins
            } else {
                this.renderList(); // Go back to list
            }
        });

        container.querySelector('#wheel-add-btn').addEventListener('click', () => {
            this.renderEdit();
        });

        this.renderList();
    },

    renderList() {
        this.currentView = 'list';
        const data = this.getData();
        const content = this.container.querySelector('#wheel-content');
        this.container.querySelector('#wheel-add-btn').classList.remove('hidden');
        this.container.querySelector('#wheel-back-btn').innerHTML = '<i class="fa-solid fa-chevron-left text-xl"></i>'; // Reset icon if needed

        if (data.wheels.length === 0) {
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-gray-400">
                    <i class="fa-solid fa-dharmachakra text-6xl mb-4 opacity-50"></i>
                    <p class="text-lg">還沒有轉盤喔</p>
                    <p class="text-sm">點擊右上角「新增」建立第一個轉盤</p>
                </div>
            `;
            return;
        }

        content.innerHTML = `
            <div class="grid gap-4">
                ${data.wheels.map(w => `
                    <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:border-wabi-primary transition-colors wheel-item" data-id="${w.id}">
                        <div class="flex-1">
                            <h3 class="font-bold text-lg text-gray-800">${w.name}</h3>
                            <p class="text-sm text-gray-500">${w.items.length} 個選項</p>
                        </div>
                        <div class="flex gap-2">
                             <button class="wheel-play-btn p-3 bg-wabi-primary/10 text-wabi-primary rounded-full hover:bg-wabi-primary/20" data-id="${w.id}" title="開始轉">
                                <i class="fa-solid fa-play"></i>
                            </button>
                            <button class="wheel-edit-btn p-3 text-gray-400 hover:text-gray-600" data-id="${w.id}" title="編輯">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="wheel-delete-btn p-3 text-gray-400 hover:text-red-500" data-id="${w.id}" title="刪除">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Event Listeners
        content.querySelectorAll('.wheel-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    this.renderPlay(el.dataset.id);
                }
            });
        });

        content.querySelectorAll('.wheel-play-btn').forEach(btn => 
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renderPlay(btn.dataset.id);
            })
        );
        content.querySelectorAll('.wheel-edit-btn').forEach(btn => 
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renderEdit(btn.dataset.id);
            })
        );
        content.querySelectorAll('.wheel-delete-btn').forEach(btn => 
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if(confirm('確定要刪除這個轉盤嗎？')) {
                    this.deleteWheel(btn.dataset.id);
                    this.renderList();
                }
            })
        );
    },

    renderEdit(id = null) {
        this.currentView = 'edit';
        const data = this.getData();
        const wheel = id ? data.wheels.find(w => w.id === id) : { name: '', items: [] };
        
        const content = this.container.querySelector('#wheel-content');
        this.container.querySelector('#wheel-add-btn').classList.add('hidden'); // Hide add button

        content.innerHTML = `
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 max-w-lg mx-auto">
                <h2 class="text-xl font-bold mb-4">${id ? '編輯轉盤' : '新增轉盤'}</h2>
                
                <div class="mb-4">
                    <label class="block text-sm font-bold text-gray-700 mb-1">轉盤名稱</label>
                    <input type="text" id="wheel-name" value="${wheel.name}" class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-wabi-primary outline-none" placeholder="例如：午餐吃什麼">
                </div>

                <div class="mb-6">
                    <label class="block text-sm font-bold text-gray-700 mb-1">選項 (每行一個)</label>
                    <textarea id="wheel-items" rows="8" class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-wabi-primary outline-none" placeholder="雞腿便當&#10;牛肉麵&#10;麥當勞">${wheel.items.join('\n')}</textarea>
                    <p class="text-xs text-gray-500 mt-1">至少輸入兩個選項</p>
                </div>

                <div class="flex gap-4">
                    <button id="wheel-save-btn" class="flex-1 bg-wabi-primary text-white py-2 rounded-lg font-bold hover:bg-opacity-90">儲存</button>
                    <button id="wheel-cancel-btn" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-200">取消</button>
                </div>
            </div>
        `;

        content.querySelector('#wheel-cancel-btn').addEventListener('click', () => this.renderList());
        
        content.querySelector('#wheel-save-btn').addEventListener('click', () => {
            const name = content.querySelector('#wheel-name').value.trim();
            const itemsStr = content.querySelector('#wheel-items').value.trim();
            const items = itemsStr.split('\n').map(i => i.trim()).filter(i => i);

            if (!name) return alert('請輸入名稱');
            if (items.length < 2) return alert('請至少輸入兩個選項');

            if (id) {
                // Update
                const idx = data.wheels.findIndex(w => w.id === id);
                if (idx !== -1) {
                    data.wheels[idx] = { ...data.wheels[idx], name, items };
                }
            } else {
                // Create
                data.wheels.push({
                    id: Date.now().toString(),
                    name,
                    items
                });
            }
            this.saveData(data);
            this.renderList();
        });
    },

    deleteWheel(id) {
        const data = this.getData();
        data.wheels = data.wheels.filter(w => w.id !== id);
        this.saveData(data);
    },

    renderPlay(id) {
        this.currentView = 'play';
        const data = this.getData();
        const wheel = data.wheels.find(w => w.id === id);
        if (!wheel) return this.renderList();

        const content = this.container.querySelector('#wheel-content');
        this.container.querySelector('#wheel-add-btn').classList.add('hidden');

        content.innerHTML = `
            <div class="flex flex-col items-center h-full">
                <h2 class="text-2xl font-bold text-wabi-primary mb-6">${wheel.name}</h2>
                
                <div class="relative mb-8 w-[320px] mx-auto">
                    <canvas id="wheel-canvas" width="320" height="320"></canvas>
                    <!-- Pointer -->
                    <div class="absolute -top-8 left-1/2 -translate-x-1/2 text-red-500 text-5xl drop-shadow-md z-10 filter drop-shadow-lg">
                        <i class="fa-solid fa-location-dot"></i>
                    </div>
                </div>

                <button id="spin-btn" class="bg-wabi-primary text-white px-12 py-3 rounded-full text-xl font-bold shadow-lg hover:bg-opacity-90 active:scale-95 transition-transform flex items-center gap-2">
                    <i class="fa-solid fa-rotate"></i> 開始轉動！
                </button>
                
                <div id="result-display" class="mt-6 text-xl font-bold text-gray-800 h-8"></div>
            </div>
        `;

        this.initCanvas(content.querySelector('#wheel-canvas'), wheel.items);
        
        const spinBtn = content.querySelector('#spin-btn');
        spinBtn.addEventListener('click', () => {
            if (this.isSpinning) return;
            this.spin(wheel.items);
        });
    },

    initCanvas(canvas, items) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.items = items;
        this.arc = Math.PI * 2 / items.length;
        this.angle = 0;
        this.colors = ['#FFC107', '#FF5722', '#4CAF50', '#03A9F4', '#9C27B0', '#E91E63', '#3F51B5', '#009688'];
        
        this.draw();
    },

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const center = width / 2;
        const radius = width / 2 - 10;

        ctx.clearRect(0, 0, width, width);

        // Draw segments
        this.items.forEach((item, i) => {
            const angle = this.angle + i * this.arc;
            ctx.beginPath();
            ctx.fillStyle = this.colors[i % this.colors.length];
            ctx.moveTo(center, center);
            ctx.arc(center, center, radius, angle, angle + this.arc);
            ctx.lineTo(center, center);
            ctx.fill();

            // Text
            ctx.save();
            ctx.translate(center, center);
            ctx.rotate(angle + this.arc / 2);
            ctx.textAlign = "right";
            ctx.fillStyle = "#fff";
            ctx.font = "bold 16px Arial";
            ctx.fillText(item, radius - 20, 6);
            ctx.restore();
        });
        
        // Draw center circle
        ctx.beginPath();
        ctx.arc(center, center, 30, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.shadowBlur = 5;
        ctx.shadowColor = "rgba(0,0,0,0.2)";
    },

    spin(items) {
        this.isSpinning = true;
        this.container.querySelector('#result-display').textContent = '';
        
        // Random spin amount (at least 5 full spins)
        const spinAngle = Math.random() * 10 + 10 * Math.PI; 
        const duration = 3000; // 3 seconds
        let start = null;
        
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            
            if (progress < duration) {
                // Ease out cubic
                const t = 1 - Math.pow(1 - progress / duration, 3);
                this.angle += (spinAngle * (1 - t)) * 0.1; // Simple deceleration simulation isn't quite right with fixed target, but for visual spin:
                
                // Let's implement ease-out to a target? 
                // Simpler: Just add speed that decays.
            }
            
            // Better Spin Logic:
            // Calculate a target angle.
            // Target = Current + MinSpins + RandomOffset
            if (!this.targetAngle) {
                 this.targetAngle = this.angle + (Math.PI * 2 * 5) + (Math.random() * Math.PI * 2);
                 this.startAngle = this.angle;
            }
            
            const p = progress / duration;
            const ease = 1 - Math.pow(1 - p, 4); // Quartic ease out
            
            if (p < 1) {
                this.angle = this.startAngle + (this.targetAngle - this.startAngle) * ease;
                this.draw();
                requestAnimationFrame(animate);
            } else {
                this.isSpinning = false;
                this.targetAngle = null;
                this.angle = this.angle % (Math.PI * 2);
                this.draw();
                this.showResult(items);
            }
        };
        requestAnimationFrame(animate);
    },

    showResult(items) {
         // Calculate which item is at the top (angle 270 deg or -90 deg)
         // Our "Pointer" is at Top (1.5 PI or -0.5 PI)
         // But we draw from 0 (Right).
         // So Top is 270deg (3*PI/2)
         
         // Current angle is the offset of the first item (index 0).
         // Item i starts at angle + i*arc
         
         // We want to find i such that: angle + i*arc includes 270deg (normalized)
         
         const normalizedAngle = this.angle % (Math.PI * 2);
         // The pointer is at 3PI/2.
         // We need to find the segment that overlaps 3PI/2.
         
         // Let's reverse: Where is the pointer relative to the wheel?
         // PointerAngle = 3PI/2
         // RelativePointer = PointerAngle - normalizedAngle
         
         let relativePointer = (3 * Math.PI / 2) - normalizedAngle;
         while (relativePointer < 0) relativePointer += Math.PI * 2;
         while (relativePointer >= Math.PI * 2) relativePointer -= Math.PI * 2;
         
         const index = Math.floor(relativePointer / this.arc);
         const winner = items[index];
         
         this.container.querySelector('#result-display').textContent = `🎉 結果：${winner}`;
         
         // Optional: Confetti or sound
    }
};

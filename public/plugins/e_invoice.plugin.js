export default {
    meta: {
        id: 'com.walkingfish.e_invoice',
        name: '電子發票掃描 (Beta 版)',
        version: '1.1',
        description: '開啟相機掃描電子發票 QR Code，自動帶入金額與號碼，並提供自動對獎功能。',
        author: 'The walking fish 步行魚',
        icon: 'fa-qrcode',
        permissions: ['camera', 'storage', 'data:write', 'ui', 'network']
    },

    init(context) {
        this.context = context;

        // 當頁面渲染後觸發
        context.events.on('onPageRenderAfter', (page) => {
            if (page === 'add') {
                this.injectScannerButton();
            }
        });

        // 註冊發票清單頁面與首頁 Widget
        this.registerInvoiceListPage();
        this.registerWidget();

        // 背景檢查中獎
        setTimeout(() => this.initBackgroundCheck(), 5000);
    },

    injectScannerButton() {
        const categoryContainer = document.getElementById('add-selected-category');
        if (!categoryContainer) return;

        if (document.getElementById('einvoice-scan-btn')) return;

        const row = categoryContainer.parentElement;
        const parent = row.parentElement;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'mt-1 flex px-1'; 

        const btn = document.createElement('button');
        btn.id = 'einvoice-scan-btn';
        btn.className = 'text-sm text-wabi-primary bg-wabi-primary/10 px-3 py-1.5 rounded-lg hover:bg-wabi-primary/20 transition-colors flex items-center gap-2 mr-2';
        btn.innerHTML = '<i class="fa-solid fa-qrcode"></i> 掃描發票 <span class="text-[10px] bg-wabi-primary text-wabi-surface px-1 rounded">Beta</span>';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            this.openScannerModal();
        });

        btnContainer.appendChild(btn);

        const existingContainer = row.nextElementSibling;
        if (existingContainer && existingContainer.querySelector('#currency-open-btn')) {
            existingContainer.insertBefore(btn, existingContainer.firstChild);
        } else {
            if (row.nextSibling) {
                parent.insertBefore(btnContainer, row.nextSibling);
            } else {
                parent.appendChild(btnContainer);
            }
        }
    },

    async openScannerModal() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-80 z-[80] flex flex-col items-center justify-center p-4 animation-fade-in';
        modal.id = 'einvoice-scanner-modal';

        modal.innerHTML = `
            <div class="bg-white rounded-xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl relative">
                <div class="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-200">
                    <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <i class="fa-solid fa-qrcode text-wabi-primary"></i> 掃描發票 <span class="text-xs font-normal text-gray-500">(Beta)</span>
                    </h3>
                    <button id="einvoice-close-btn" class="text-gray-400 hover:text-gray-600 focus:outline-none">
                        <i class="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <div class="p-5 flex flex-col items-center w-full">
                    <div class="relative w-full max-w-[320px] aspect-[4/5] bg-black rounded-lg overflow-hidden shadow-inner">
                        <div id="reader" class="w-full h-full border-none"></div>
                        <div id="reader-loading" class="absolute inset-0 flex flex-col items-center justify-center text-wabi-surface text-sm bg-black z-10 transition-opacity duration-300">
                            <i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                            <p class="mt-2 tracking-wider">正在啟動高畫質相機...</p>
                        </div>
                    </div>
                    
                    <div class="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100 w-full max-w-[280px]">
                        <i class="fa-solid fa-circle-info text-gray-400"></i>
                        <span>請保持 10~15 公分距離以利對焦</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#einvoice-close-btn');
        let html5QrCode = null; 

        const closeModal = async () => {
            if (html5QrCode) {
                try {
                    if (html5QrCode.isScanning) await html5QrCode.stop();
                    html5QrCode.clear();
                } catch(e) { console.error("Failed to clear scanner", e); }
            }
            modal.remove();
        };

        closeBtn.addEventListener('click', closeModal);

        if (!window.Html5Qrcode) {
            try {
                await this.loadScript('https://unpkg.com/html5-qrcode');
            } catch (error) {
                this.context.ui.showToast('無法載入掃描模組，請檢查網路連線', 'error');
                closeModal();
                return;
            }
        }

        try {
            html5QrCode = new window.Html5Qrcode("reader");
            
            const cameraConfig = { facingMode: "environment" };
            const scannerConfig = { 
                fps: 15, 
                qrbox: { width: 250, height: 250 },
                useBarCodeDetectorIfSupported: true,
                videoConstraints: {
                    facingMode: "environment",
                    advanced: [{ focusMode: "continuous" }]
                }
            };

            if (window.Html5QrcodeSupportedFormats && window.Html5QrcodeSupportedFormats.QR_CODE !== undefined) {
                scannerConfig.formatsToSupport = [ window.Html5QrcodeSupportedFormats.QR_CODE ];
            }

            await html5QrCode.start(
                cameraConfig, 
                scannerConfig,
                (decodedText) => { this.handleScanResult(decodedText, html5QrCode, closeModal); },
                () => { /* 忽略幀錯誤 */ }
            );

            const loadingEl = document.getElementById('reader-loading');
            if (loadingEl) {
                loadingEl.style.opacity = '0';
                setTimeout(() => { loadingEl.style.display = 'none'; }, 300);
            }
        } catch (e) {
            console.error('啟動失敗詳細錯誤:', e);
            const loadingEl = document.getElementById('reader-loading');
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <div class="text-red-400 text-center px-4">
                        <i class="fa-solid fa-triangle-exclamation text-3xl mb-3"></i><br>
                        無法啟動相機<br>
                        <span class="text-xs text-gray-300 mt-2 block">請確認權限或使用 HTTPS 連線</span>
                    </div>`;
            }
        }
    },

    loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    async handleScanResult(qrData, scanner, closeModal) {
        if (!qrData || qrData.length < 37) return;

        // 檢查是否為左側發票 QR Code (前兩碼大寫英文 + 8碼數字發票號碼 + 7碼數字日期)
        if (!/^[A-Z]{2}\d{15}/.test(qrData.substring(0, 17))) {
            // 如果掃到右側明細或其他不符格式的條碼，靜默忽略並繼續掃描
            return;
        }

        // 1. 成功掃描到內容，立刻關閉掃描視窗，讓後續的 Modal 可以正常顯示在最上層
        await closeModal();

        try {
            const invNum = qrData.substring(0, 10);
            const dateStr = qrData.substring(10, 17);
            const totalAmountHex = qrData.substring(29, 37);

            const totalAmount = parseInt(totalAmountHex, 16);
            const rocYear = parseInt(dateStr.substring(0, 3), 10);
            const month = parseInt(dateStr.substring(3, 5), 10);

            if (isNaN(rocYear)) throw new Error('Invalid year');

            const startMonth = month % 2 === 0 ? month - 1 : month;
            const endMonth = startMonth + 1;
            const periodStr = `${rocYear}年${String(startMonth).padStart(2, '0')}-${String(endMonth).padStart(2, '0')}月`;

            // 2. 檢查是否為重複發票
            let invoices = [];
            try {
                const stored = await this.context.storage.getItem('invoices');
                if (stored) invoices = JSON.parse(stored);
            } catch (e) { console.warn('Failed to parse invoices', e); }

            const isDuplicate = invoices.some(inv => inv.number === invNum);

            if (isDuplicate) {
                // 相機 Modal 已關閉，Confirm 視窗現在能完美呈現在最上層
                const wantToRecordAgain = await this.context.ui.showConfirm(
                    '發票已掃描過', 
                    `這張發票 (${invNum}) 已經存在掃描紀錄中。<br><br>請問您是要重新將金額帶入記帳頁面嗎？`
                );
                
                if (wantToRecordAgain) {
                    // 若是重複掃描，為了避免覆蓋舊紀錄，直接建構簡易假資料帶入表單即可
                    this.fillAddForm({ number: invNum, amount: totalAmount });
                }
                return;
            }

            // 3. 嘗試取得店家名稱 (發票格式第 45-52 碼為賣方統編)
            const sellerBan = qrData.length >= 53 ? qrData.substring(45, 53) : '';
            let storeName = '';

            if (sellerBan && sellerBan !== '00000000' && /^\d{8}$/.test(sellerBan)) {
                try {
                    // 為了避免網路卡頓影響體驗，加上 2 秒的逾時限制
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000); 
                    
                    const res = await fetch(`https://company.g0v.ronny.tw/api/show/${sellerBan}`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.data) {
                            storeName = data.data['公司名稱'] || data.data['商業名稱'] || '';
                            // 過濾常見的長尾後綴，讓名稱更簡潔乾淨 (例如: 統一超商股份有限公司 -> 統一超商)
                            storeName = storeName.replace(/股份有限公司|有限公司|企業行|實業|商行/g, '').trim();
                        }
                    }
                } catch (e) {
                    // 逾時或無網路，則靜默忽略，單純顯示發票號碼
                }
            }

            const invoiceData = {
                number: invNum,
                amount: totalAmount,
                date: dateStr,
                period: periodStr,
                storeName: storeName,
                sellerBan: sellerBan,
                scannedAt: Date.now(),
                isWinning: null 
            };

            // 全新發票：儲存並帶入表單
            await this.saveInvoice(invoiceData, invoices);
            this.context.ui.showToast(`成功掃描發票: ${invNum}`, 'success');
            this.fillAddForm(invoiceData);

        } catch (e) {
            this.context.ui.showToast('發票解析失敗，請重新掃描', 'error');
        }
    },

    async saveInvoice(invoiceData, currentInvoices) {
        currentInvoices.push(invoiceData);
        await this.context.storage.setItem('invoices', JSON.stringify(currentInvoices));
        return true;
    },

    fillAddForm(invoiceData) {
        const noteInput = document.getElementById('add-note-input');
        const currentNote = noteInput ? noteInput.value.trim() : '';
        
        // 將店家名稱帶入備註最前方，格式為：[店家名稱] 既有備註 (發票號碼)
        const storeText = invoiceData.storeName ? `[${invoiceData.storeName}] ` : '';
        const newNote = currentNote 
            ? `${storeText}${currentNote} (發票:${invoiceData.number})` 
            : `${storeText}發票號碼: ${invoiceData.number}`;

        this.context.ui.openAddPage({
            amount: invoiceData.amount,
            description: newNote,
            type: 'expense'
        });
    },

    // ===== 對獎核心邏輯 =====

    async initBackgroundCheck(force = false) {
        let invoices = [];
        try {
            const stored = await this.context.storage.getItem('invoices');
            if (stored) invoices = JSON.parse(stored);
        } catch (e) {
            console.warn('Failed to parse invoices for background check', e);
            return;
        }

        if (invoices.length === 0 && !force) return;

        const lastSync = await this.context.storage.getItem('last_sync_winning_numbers') || 0;
        const now = Date.now();
        let winningData = null;

        if (force || now - lastSync > 24 * 60 * 60 * 1000) {
            winningData = await this.fetchWinningNumbers();
            if (winningData) {
                let existingWin = {};
                try {
                    const storedWin = await this.context.storage.getItem('winning_numbers');
                    if (storedWin) existingWin = JSON.parse(storedWin);
                } catch(e) { console.warn('Failed to parse existing winning numbers', e); }
                
                winningData = { ...existingWin, ...winningData };
                await this.context.storage.setItem('winning_numbers', JSON.stringify(winningData));
                await this.context.storage.setItem('last_sync_winning_numbers', now);
            }
        } else {
            const storedWinning = await this.context.storage.getItem('winning_numbers');
            if (storedWinning) winningData = JSON.parse(storedWinning);
        }

        if (!winningData) return;

        let hasChanges = false;
        let newWinningCount = 0;

        for (const inv of invoices) {
            if (inv.isWinning !== true) { 
                const result = this.checkInvoiceWinning(inv.number, inv.period, winningData);
                if (result !== null && result !== inv.isWinning) {
                    inv.isWinning = result;
                    hasChanges = true;
                    if (result === true) newWinningCount++;
                }
            }
        }

        if (hasChanges) {
            await this.context.storage.setItem('invoices', JSON.stringify(invoices));
            if (newWinningCount > 0) {
                this.context.ui.showAlert('🎉 恭喜中獎！', `您有 ${newWinningCount} 張掃描的發票中獎了！請至「發票清單」查看。`);
            }
        }
    },

    async fetchWinningNumbers() {
        try {
            const res = await fetch('https://api.invoice.tw/api/v1/invoice/latest'); 
            if (!res.ok) throw new Error('Network response was not ok');
            return await res.json();
        } catch (e) {
            console.warn('API 連線失敗，載入內建備用中獎號碼');
            return {
                "114年11-12月": {
                    super: "97023797",
                    special: "00507588",
                    first: ["92377231", "05232592", "78125249"]
                },
                "114年09-10月": {
                    super: "25834483",
                    special: "46587380",
                    first: ["41016094", "98081574", "07309261"]
                }
            };
        }
    },

    checkInvoiceWinning(invoiceNumber, period, winningData) {
        const periodData = winningData[period];
        if (!periodData) return null;

        const { super: superNum, special, first } = periodData;

        if (invoiceNumber === superNum) return true;
        if (invoiceNumber === special) return true;

        for (const f of first) {
            for (let i = 0; i <= 5; i++) { 
                const targetMatch = f.substring(i);
                const myMatch = invoiceNumber.substring(i);
                if (myMatch === targetMatch) return true;
            }
        }
        return false; 
    },

    // ===== UI 註冊邏輯 =====

    registerWidget() {
        this.context.ui.registerHomeWidget('e_invoice_widget', async (container) => {
            container.innerHTML = `
                <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors" onclick="window.location.hash='#invoice_list'">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-wabi-primary/10 text-wabi-primary flex items-center justify-center">
                            <i class="fa-solid fa-qrcode text-lg"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">發票管理 <span class="text-[10px] font-normal text-gray-400 border border-gray-200 px-1 rounded ml-1">Beta</span></div>
                            <div class="text-xs text-gray-500">掃描與自動對獎</div>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300"></i>
                </div>
            `;
        });
    },

    registerInvoiceListPage() {
        this.context.ui.registerPage('invoice_list', '發票清單 (Beta)', async (container) => {
            container.innerHTML = `
                <div class="p-4 flex flex-col h-full pb-20">
                    <div class="flex justify-between items-center mb-4 shrink-0">
                        <h2 class="text-xl font-bold text-gray-800">發票管理 <span class="text-sm font-normal text-gray-500">(Beta)</span></h2>
                        <button id="einvoice-sync-btn" class="text-sm text-wabi-primary px-3 py-1.5 bg-wabi-primary/10 rounded-lg hover:bg-wabi-primary/20 transition-colors flex items-center gap-2">
                            <i class="fa-solid fa-rotate"></i> 更新對獎
                        </button>
                    </div>

                    <div class="flex items-center justify-between bg-white rounded-xl shadow-sm border border-gray-100 p-2 mb-4 shrink-0">
                        <button id="prev-period-btn" class="p-2 w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-wabi-primary hover:bg-gray-50 transition-colors disabled:opacity-30"><i class="fa-solid fa-chevron-left"></i></button>
                        <div class="font-bold text-gray-700 tracking-widest" id="period-display">載入中...</div>
                        <button id="next-period-btn" class="p-2 w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-wabi-primary hover:bg-gray-50 transition-colors disabled:opacity-30"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>

                    <div id="winning-numbers-container" class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 mb-4 border border-blue-100 shadow-sm shrink-0 hidden">
                         <div class="text-sm font-bold text-blue-800 mb-3 flex items-center gap-2">
                            <i class="fa-solid fa-trophy text-yellow-500 text-lg"></i> 本期中獎號碼
                         </div>
                         <div class="grid grid-cols-2 gap-3 text-sm" id="winning-numbers-content"></div>
                    </div>

                    <div id="einvoice-list-container" class="space-y-3 flex-1 overflow-y-auto">
                        <div class="text-center text-gray-500 py-8"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><br>載入中...</div>
                    </div>
                </div>
            `;

            let invoices = [];
            let winningData = {};
            let availablePeriods = [];
            let currentPeriodIndex = 0;

            const loadData = async () => {
                try {
                    const storedInv = await this.context.storage.getItem('invoices');
                    if (storedInv) invoices = JSON.parse(storedInv);
                    const storedWin = await this.context.storage.getItem('winning_numbers');
                    if (storedWin) winningData = JSON.parse(storedWin);
                } catch(e) { console.warn('Failed to parse storage data', e); }

                const periodsSet = new Set();
                invoices.forEach(i => periodsSet.add(i.period));
                Object.keys(winningData).forEach(p => periodsSet.add(p));

                if (periodsSet.size === 0) {
                    const now = new Date();
                    const rocYear = now.getFullYear() - 1911;
                    const month = now.getMonth() + 1;
                    const startM = month % 2 === 0 ? month - 1 : month;
                    const endM = startM + 1;
                    periodsSet.add(`${rocYear}年${String(startM).padStart(2, '0')}-${String(endM).padStart(2, '0')}月`);
                }

                availablePeriods = Array.from(periodsSet).sort((a, b) => b.localeCompare(a));
            };

            const renderUI = () => {
                if (availablePeriods.length === 0) return;
                
                const currentPeriod = availablePeriods[currentPeriodIndex];
                
                container.querySelector('#period-display').innerText = currentPeriod;
                container.querySelector('#prev-period-btn').disabled = (currentPeriodIndex >= availablePeriods.length - 1); 
                container.querySelector('#next-period-btn').disabled = (currentPeriodIndex <= 0); 

                const winData = winningData[currentPeriod];
                const winContainer = container.querySelector('#winning-numbers-container');
                const winContent = container.querySelector('#winning-numbers-content');
                
                if (winData) {
                    winContent.innerHTML = `
                        <div class="bg-white/70 p-2.5 rounded-lg border border-white"><span class="text-gray-500 text-xs block mb-1">特別獎 (1000萬)</span> <span class="font-bold text-red-500 font-mono tracking-wider">${winData.super}</span></div>
                        <div class="bg-white/70 p-2.5 rounded-lg border border-white"><span class="text-gray-500 text-xs block mb-1">特獎 (200萬)</span> <span class="font-bold text-red-500 font-mono tracking-wider">${winData.special}</span></div>
                        <div class="col-span-2 bg-white/70 p-2.5 rounded-lg border border-white"><span class="text-gray-500 text-xs block mb-1">頭獎 (20萬)</span> <span class="font-bold text-gray-700 font-mono tracking-wider">${winData.first.join(' , ')}</span></div>
                    `;
                    winContainer.classList.remove('hidden');
                } else {
                    winContainer.classList.add('hidden');
                }

                const listContainer = container.querySelector('#einvoice-list-container');
                const periodInvoices = invoices.filter(inv => inv.period === currentPeriod);
                periodInvoices.sort((a, b) => b.scannedAt - a.scannedAt);

                if (periodInvoices.length === 0) {
                    listContainer.innerHTML = '<div class="text-center text-gray-400 py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 mt-2"><i class="fa-solid fa-receipt text-3xl mb-3 text-gray-300"></i><br>此月份尚無掃描發票</div>';
                    return;
                }

                listContainer.innerHTML = periodInvoices.map((inv) => {
                    let statusHtml = '<span class="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">尚未開獎</span>';
                    let borderClass = 'border-gray-100';

                    if (inv.isWinning === true) {
                        statusHtml = '<span class="text-xs text-red-600 bg-red-50 font-bold px-2.5 py-1 rounded-full border border-red-200 flex items-center gap-1 shadow-sm"><i class="fa-solid fa-gift"></i> 恭喜中獎</span>';
                        borderClass = 'border-red-200 bg-red-50/20';
                    } else if (inv.isWinning === false) {
                        statusHtml = '<span class="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">未中獎</span>';
                    }

                    const y = inv.date.substring(0, 3);
                    const m = inv.date.substring(3, 5);
                    const d = inv.date.substring(5, 7);
                    
                    // 若有紀錄店家名稱，也顯示在清單上
                    const storeBadge = inv.storeName ? `<span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded ml-2">${inv.storeName}</span>` : '';

                    return `
                        <div class="bg-white p-4 rounded-xl shadow-sm border ${borderClass} flex justify-between items-center transition-all hover:shadow-md">
                            <div>
                                <div class="font-bold text-gray-800 text-lg tracking-widest font-mono flex items-center">${inv.number} ${storeBadge}</div>
                                <div class="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                                    <i class="fa-regular fa-calendar-check opacity-70"></i> ${y}/${m}/${d}
                                </div>
                            </div>
                            <div class="text-right flex flex-col items-end gap-2">
                                <div class="font-bold text-gray-700 text-lg">$${inv.amount.toLocaleString()}</div>
                                ${statusHtml}
                            </div>
                        </div>
                    `;
                }).join('');
            };

            container.querySelector('#prev-period-btn').addEventListener('click', () => {
                if (currentPeriodIndex < availablePeriods.length - 1) {
                    currentPeriodIndex++; 
                    renderUI();
                }
            });

            container.querySelector('#next-period-btn').addEventListener('click', () => {
                if (currentPeriodIndex > 0) {
                    currentPeriodIndex--; 
                    renderUI();
                }
            });

            container.querySelector('#einvoice-sync-btn').addEventListener('click', async () => {
                const btn = container.querySelector('#einvoice-sync-btn');
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 對獎中...';
                btn.disabled = true;

                await this.initBackgroundCheck(true); 
                await loadData();
                renderUI();

                btn.innerHTML = originalHtml;
                btn.disabled = false;
                this.context.ui.showToast('對獎更新完成', 'success');
            });

            await loadData();
            renderUI();
        });
    }
};

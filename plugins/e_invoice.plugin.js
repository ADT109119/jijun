export default {
    meta: {
        id: 'com.walkingfish.e_invoice',
        name: '電子發票掃描',
        version: '1.0',
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

        // 背景檢查中獎 (延遲 5 秒執行避免影響首頁載入)
        setTimeout(() => this.initBackgroundCheck(), 5000);
    },

    injectScannerButton() {
        const categoryContainer = document.getElementById('add-selected-category');
        if (!categoryContainer) return;

        // 如果已經加入過了就略過
        if (document.getElementById('einvoice-scan-btn')) return;

        const row = categoryContainer.parentElement;
        const parent = row.parentElement;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'mt-1 flex px-1'; 

        const btn = document.createElement('button');
        btn.id = 'einvoice-scan-btn';
        btn.className = 'text-sm text-wabi-primary bg-wabi-primary/10 px-3 py-1.5 rounded-lg hover:bg-wabi-primary/20 transition-colors flex items-center gap-2 mr-2';
        btn.innerHTML = '<i class="fa-solid fa-qrcode"></i> 掃描發票';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            this.openScannerModal();
        });

        btnContainer.appendChild(btn);

        // 將按鈕加進適合的位置
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
                        <i class="fa-solid fa-qrcode text-wabi-primary"></i> 掃描發票 QR Code
                    </h3>
                    <button id="einvoice-close-btn" class="text-gray-400 hover:text-gray-600 focus:outline-none">
                        <i class="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <div class="p-4 flex-1 flex flex-col items-center">
                    <div id="reader" class="w-full h-64 bg-black rounded-lg overflow-hidden relative flex items-center justify-center text-white text-sm">
                        <div class="text-center">
                            <i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                            <p class="mt-2">正在要求相機權限...</p>
                        </div>
                    </div>
                    <p class="text-xs text-gray-500 mt-4 text-center">請將鏡頭對準電子發票左側的 QR Code。<br>若無法掃描，請確認已在瀏覽器設定中授予相機權限。</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#einvoice-close-btn');
        let html5QrCode = null; 

        const closeModal = async () => {
            if (html5QrCode) {
                try {
                    if (html5QrCode.isScanning) {
                        await html5QrCode.stop();
                    }
                    html5QrCode.clear();
                } catch(e) { console.error("Failed to clear scanner", e); }
            }
            modal.remove();
        };

        closeBtn.addEventListener('click', closeModal);

        // 動態載入 html5-qrcode 函式庫
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
            // 初始化底層 Html5Qrcode API
            html5QrCode = new window.Html5Qrcode("reader");

            // 強制使用後置鏡頭並啟動，這會立即觸發瀏覽器原生的權限請求
            await html5QrCode.start(
                { facingMode: "environment" }, 
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                (decodedText) => {
                    this.handleScanResult(decodedText, html5QrCode, closeModal);
                },
                (/* errorMessage */) => {
                    // 掃描過程中的幀錯誤通常直接忽略，避免洗版
                }
            );
        } catch (e) {
            console.error('相機啟動失敗:', e);
            document.getElementById('reader').innerHTML = `
                <div class="text-red-500 text-center p-4">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><br>
                    無法啟動相機。<br>請確認是否允許權限，或網頁是否在安全連線 (HTTPS) 下執行。
                </div>`;
        }
    },

    loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    async handleScanResult(qrData, scanner, closeModal) {
        // 發票左側 QR Code 格式範例:
        // AA1234567810810301999999990000006400000000000000000...
        // 1-10碼: 發票號碼
        // 11-17碼: 發票日期 (民國年月)
        // 30-37碼: 總金額 (16進位)

        if (!qrData || qrData.length < 37) {
            return;
        }

        // 停止掃描器資源
        if (scanner && scanner.isScanning) {
            try {
                await scanner.stop();
                scanner.clear();
            } catch(e) { console.error("Error stopping scanner", e); }
        }

        try {
            const invNum = qrData.substring(0, 10);
            const dateStr = qrData.substring(10, 17);
            const totalAmountHex = qrData.substring(29, 37);

            const totalAmount = parseInt(totalAmountHex, 16);

            // 解析民國年為西元年
            const rocYearStr = dateStr.substring(0, 3);
            const rocYear = parseInt(rocYearStr, 10);
            if (isNaN(rocYear)) throw new Error('Invalid year');

            const monthStr = dateStr.substring(3, 5);
            const month = parseInt(monthStr, 10);

            // 計算發票期別 (如: 113年01-02月)
            const startMonth = month % 2 === 0 ? month - 1 : month;
            const endMonth = startMonth + 1;
            const periodStr = `${rocYear}年${String(startMonth).padStart(2, '0')}-${String(endMonth).padStart(2, '0')}月`;

            const invoiceData = {
                number: invNum,
                amount: totalAmount,
                date: dateStr,
                period: periodStr,
                scannedAt: Date.now(),
                isWinning: null 
            };

            const isSaved = await this.saveInvoice(invoiceData);
            if (isSaved) {
                this.context.ui.showToast(`成功掃描發票: ${invNum}`, 'success');
                this.fillAddForm(invoiceData);
            }

            closeModal();

        } catch (e) {
            console.error('發票解析錯誤:', e);
            this.context.ui.showToast('發票解析失敗，請重新掃描', 'error');
            closeModal();
        }
    },

    async saveInvoice(invoiceData) {
        let invoices = [];
        try {
            const stored = await this.context.storage.getItem('invoices');
            if (stored) {
                invoices = JSON.parse(stored);
            }
        } catch (e) { /* ignore */ }

        if (invoices.some(inv => inv.number === invoiceData.number)) {
            this.context.ui.showToast('這張發票已經掃描過囉！', 'warning');
            return false;
        }

        invoices.push(invoiceData);
        await this.context.storage.setItem('invoices', JSON.stringify(invoices));
        return true;
    },

    fillAddForm(invoiceData) {
        const noteInput = document.getElementById('add-note-input');
        const currentNote = noteInput ? noteInput.value.trim() : '';
        const newNote = currentNote ? `${currentNote} (發票:${invoiceData.number})` : `發票號碼: ${invoiceData.number}`;

        this.context.ui.openAddPage({
            amount: invoiceData.amount,
            description: newNote,
            type: 'expense'
        });
    },

    async initBackgroundCheck() {
        let invoices = [];
        try {
            const stored = await this.context.storage.getItem('invoices');
            if (stored) {
                invoices = JSON.parse(stored);
            }
        } catch (e) { return; }

        if (invoices.length === 0) return;

        const lastSync = await this.context.storage.getItem('last_sync_winning_numbers') || 0;
        const now = Date.now();
        let winningData = null;

        if (now - lastSync > 24 * 60 * 60 * 1000) {
            winningData = await this.fetchWinningNumbers();
            if (winningData) {
                await this.context.storage.setItem('winning_numbers', JSON.stringify(winningData));
                await this.context.storage.setItem('last_sync_winning_numbers', now);
            }
        } else {
            const storedWinning = await this.context.storage.getItem('winning_numbers');
            if (storedWinning) {
                winningData = JSON.parse(storedWinning);
            }
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
            const data = await res.json();
            return data;
        } catch (e) {
            console.warn('無法取得發票中獎號碼:', e);
            return null;
        }
    },

    checkInvoiceWinning(/* invoiceNumber, period, winningData */) {
        // TODO: 需實作比對演算法
        return null;
    },

    registerWidget() {
        this.context.ui.registerHomeWidget('e_invoice_widget', async (container) => {
            container.innerHTML = `
                <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors" onclick="window.location.hash='#invoice_list'">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-wabi-primary/10 text-wabi-primary flex items-center justify-center">
                            <i class="fa-solid fa-qrcode text-lg"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">發票管理</div>
                            <div class="text-xs text-gray-500">點擊查看已掃描的電子發票</div>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300"></i>
                </div>
            `;
        });
    },

    registerInvoiceListPage() {
        this.context.ui.registerPage('invoice_list', '發票清單', async (container) => {
            container.innerHTML = `
                <div class="p-4">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold text-gray-800">已掃描發票</h2>
                        <button id="einvoice-sync-btn" class="text-sm text-wabi-primary px-3 py-1 bg-wabi-primary/10 rounded hover:bg-wabi-primary/20 transition-colors">
                            <i class="fa-solid fa-rotate"></i> 更新中獎號碼
                        </button>
                    </div>
                    <div id="einvoice-list-container" class="space-y-3">
                        <div class="text-center text-gray-500 py-8"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><br>載入中...</div>
                    </div>
                </div>
            `;

            const listContainer = container.querySelector('#einvoice-list-container');

            const renderList = async () => {
                let invoices = [];
                try {
                    const stored = await this.context.storage.getItem('invoices');
                    if (stored) {
                        invoices = JSON.parse(stored);
                    }
                } catch (e) { /* ignore */ }

                if (invoices.length === 0) {
                    listContainer.innerHTML = '<div class="text-center text-gray-500 py-8">尚無已掃描的發票紀錄</div>';
                    return;
                }

                invoices.sort((a, b) => b.scannedAt - a.scannedAt);

                listContainer.innerHTML = invoices.map((inv) => {
                    let statusHtml = '<span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">未開獎</span>';
                    if (inv.isWinning === true) {
                        statusHtml = '<span class="text-xs text-red-500 bg-red-50 font-bold px-2 py-1 rounded border border-red-200"><i class="fa-solid fa-gift"></i> 中獎</span>';
                    } else if (inv.isWinning === false) {
                        statusHtml = '<span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">未中獎</span>';
                    }

                    const dateStr = inv.date; 
                    const y = dateStr.substring(0, 3);
                    const m = dateStr.substring(3, 5);
                    const d = dateStr.substring(5, 7);

                    return `
                        <div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                            <div>
                                <div class="font-bold text-gray-800 text-lg tracking-wider">${inv.number}</div>
                                <div class="text-xs text-gray-500 mt-1">
                                    <i class="fa-regular fa-calendar mr-1"></i> ${y}/${m}/${d} (${inv.period})
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="font-bold text-gray-700 mb-1">$${inv.amount.toLocaleString()}</div>
                                ${statusHtml}
                            </div>
                        </div>
                    `;
                }).join('');
            };

            await renderList();

            container.querySelector('#einvoice-sync-btn').addEventListener('click', async () => {
                const btn = container.querySelector('#einvoice-sync-btn');
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 更新中...';
                btn.disabled = true;

                await this.initBackgroundCheck(); 
                await renderList();

                btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 更新中獎號碼';
                btn.disabled = false;
                this.context.ui.showToast('更新完成', 'success');
            });
        });
    }
};

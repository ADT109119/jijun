import { showToast, escapeHTML, formatDateToString, calculateAmortizationDetails } from './utils.js';

const TYPE_LABELS = {
    installment: { name: '分期付款', icon: 'fa-solid fa-credit-card', color: 'bg-blue-500' },
    depreciation: { name: '折舊', icon: 'fa-solid fa-building', color: 'bg-amber-500' },
    amortization: { name: '攤提', icon: 'fa-solid fa-chart-gantt', color: 'bg-purple-500' },
};

/**
 * 開啟攤提/分期新增或編輯 Modal
 * @param {object} app          - 主應用程式實例
 * @param {object|null} item    - 要編輯的資料，null = 新增
 * @param {object} prefill      - 預填資料 { type, category, totalAmount, recordType }
 * @param {Function} onSaved    - 儲存成功後的回呼（可選）
 */
export function showAmortizationModal(app, item = null, prefill = {}, onSaved = null) {
    const isEdit = !!item;
    const today = formatDateToString(new Date());

    // 合併預填與現有資料
    const defaults = {
        name: item?.name || prefill.name || '',
        type: item?.type || prefill.type || 'installment',
        recordType: item?.recordType || prefill.recordType || 'expense',
        category: item?.category || prefill.category || '',
        totalAmount: item?.totalAmount || prefill.totalAmount || '',
        downPayment: item?.downPayment || '',
        interestRate: item?.interestRate || '',
        periods: item?.periods || '',
        frequency: item?.frequency || 'monthly',
        startDate: item?.startDate || today,
    };

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]';
    modal.innerHTML = `
        <div class="bg-wabi-bg rounded-xl max-w-sm w-full p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 class="text-lg font-bold text-wabi-primary mb-4">${isEdit ? '編輯項目' : '新增攤提/分期'}</h3>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">名稱</label>
                <input type="text" id="amort-name" maxlength="40"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${escapeHTML(defaults.name)}" placeholder="例如：MacBook Pro 分期" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">類型</label>
                <div class="grid grid-cols-3 gap-2">
                    ${Object.entries(TYPE_LABELS).map(([key, val]) => `
                        <button class="type-option flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-xs
                            ${defaults.type === key ? 'border-wabi-primary bg-wabi-primary/5 text-wabi-primary font-bold' : 'border-wabi-border text-wabi-text-secondary hover:border-wabi-primary/30'}"
                            data-type="${key}">
                            <i class="${val.icon} text-lg"></i>
                            <span>${val.name}</span>
                        </button>
                    `).join('')}
                </div>
                <input type="hidden" id="amort-type" value="${defaults.type}" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">記帳類型</label>
                <select id="amort-record-type" class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary appearance-none">
                    <option value="expense" ${defaults.recordType === 'expense' ? 'selected' : ''}>支出</option>
                    <option value="income" ${defaults.recordType === 'income' ? 'selected' : ''}>收入</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">分類</label>
                <select id="amort-category" class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary appearance-none">
                    <option value="">-- 選擇分類 --</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">總金額</label>
                <input type="number" id="amort-total" min="0" step="0.01"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${defaults.totalAmount}" placeholder="輸入總金額" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">首付金額 <span class="text-xs text-wabi-text-secondary">(選填)</span></label>
                <input type="number" id="amort-downpayment" min="0" step="0.01"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${defaults.downPayment}" placeholder="0" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">年利率 % <span class="text-xs text-wabi-text-secondary">(選填，0 = 免息)</span></label>
                <input type="number" id="amort-interest" min="0" max="100" step="0.01"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${defaults.interestRate}" placeholder="0" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">總期數</label>
                <input type="number" id="amort-periods" min="1" max="600"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${defaults.periods}" placeholder="例如：12" />
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">扣款頻率</label>
                <select id="amort-frequency" class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary appearance-none">
                    <option value="monthly" ${defaults.frequency === 'monthly' ? 'selected' : ''}>每月</option>
                    <option value="weekly" ${defaults.frequency === 'weekly' ? 'selected' : ''}>每週</option>
                    <option value="yearly" ${defaults.frequency === 'yearly' ? 'selected' : ''}>每年</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">每期小數點處理 <span class="text-xs text-wabi-text-secondary">(差額會在最後一期補齊)</span></label>
                <select id="amort-decimal-strategy" class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary appearance-none">
                    <option value="round" ${item?.decimalStrategy === 'round' || !item?.decimalStrategy ? 'selected' : ''}>四捨五入 (至整數)</option>
                    <option value="ceil" ${item?.decimalStrategy === 'ceil' ? 'selected' : ''}>無條件進位 (至整數)</option>
                    <option value="floor" ${item?.decimalStrategy === 'floor' ? 'selected' : ''}>無條件捨去 (至整數)</option>
                    <option value="keep" ${item?.decimalStrategy === 'keep' ? 'selected' : ''}>保留小數 (至小數第二位)</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">開始日期</label>
                <input type="date" id="amort-start-date"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${defaults.startDate}" />
            </div>
            <div id="amort-preview" class="mb-4 p-3 bg-wabi-bg rounded-lg">
                <p class="text-xs text-wabi-text-secondary mb-1">每期金額（自動計算）</p>
                <p id="amort-per-period" class="text-xl font-bold text-wabi-primary">--</p>
                <p id="amort-total-with-interest" class="text-xs text-wabi-text-secondary mt-1"></p>
            </div>
            ${isEdit ? `
            <div class="mb-4">
                <label class="text-sm font-medium text-wabi-text-primary block mb-1">已完成期數</label>
                <input type="number" id="amort-completed" min="0"
                    class="w-full px-3 py-2.5 rounded-lg border border-wabi-border bg-wabi-surface text-sm outline-none focus:border-wabi-primary"
                    value="${item.completedPeriods || 0}" />
            </div>` : ''}
            <div class="flex space-x-3">
                <button id="amort-save-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                    ${isEdit ? '儲存' : '建立'}
                </button>
                <button id="amort-cancel-btn" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                    取消
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // ==================== 分類選項 ====================
    const categorySelect = modal.querySelector('#amort-category');
    const recordTypeSelect = modal.querySelector('#amort-record-type');
    const populateCategories = () => {
        const type = recordTypeSelect.value;
        const categories = app.categoryManager.getAllCategories(type);
        categorySelect.innerHTML = '<option value="">-- 選擇分類 --</option>' +
            categories.map(c => `<option value="${c.id}" ${defaults.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    };
    populateCategories();
    recordTypeSelect.addEventListener('change', populateCategories);

    // ==================== 類型選擇 ====================
    const typeInput = modal.querySelector('#amort-type');
    modal.querySelectorAll('.type-option').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.querySelectorAll('.type-option').forEach(b => {
                b.classList.remove('border-wabi-primary', 'bg-wabi-primary/5', 'text-wabi-primary', 'font-bold');
                b.classList.add('border-wabi-border', 'text-wabi-text-secondary');
            });
            btn.classList.remove('border-wabi-border', 'text-wabi-text-secondary');
            btn.classList.add('border-wabi-primary', 'bg-wabi-primary/5', 'text-wabi-primary', 'font-bold');
            typeInput.value = btn.dataset.type;
        });
    });

    // ==================== 每期金額計算 ====================
    const totalInput = modal.querySelector('#amort-total');
    const periodsInput = modal.querySelector('#amort-periods');
    const downPaymentInput = modal.querySelector('#amort-downpayment');
    const interestInput = modal.querySelector('#amort-interest');
    const perPeriodDisplay = modal.querySelector('#amort-per-period');
    const totalWithInterestDisplay = modal.querySelector('#amort-total-with-interest');

    const fmt = (num) => {
        if (num === undefined || num === null || isNaN(num)) return '0';
        return num.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    const updateCalculation = async () => {
        const total = parseFloat(totalInput.value) || 0;
        const periods = parseInt(periodsInput.value) || 0;
        const downPayment = parseFloat(downPaymentInput.value) || 0;
        const annualRate = parseFloat(interestInput.value) || 0;
        if (total <= 0 || periods <= 0) { perPeriodDisplay.textContent = '--'; totalWithInterestDisplay.innerHTML = ''; return; }
        const principal = Math.max(0, total - downPayment);
        const decimalStrategy = modal.querySelector('#amort-decimal-strategy').value;
        const frequency = modal.querySelector('#amort-frequency').value;

        const { amountPerPeriod, exactTotalToPay } = calculateAmortizationDetails(principal, periods, annualRate, frequency, decimalStrategy);

        perPeriodDisplay.textContent = `$${fmt(amountPerPeriod)}`;
        
        let message = '';
        if (annualRate > 0) {
            const totalPayment = exactTotalToPay + downPayment;
            message = `含息總額 $${fmt(Math.round(totalPayment))} (利息 $${fmt(Math.round(totalPayment - total))})`;
        } else {
            message = downPayment > 0 ? `首付 $${fmt(downPayment)} + ${periods} 期` : '';
        }

        if (isEdit && item && item.id) {
            const historyRecords = await app.dataService.getRecords({ amortizationId: item.id, allLedgers: true });
            const actualPaidSoFar = historyRecords.reduce((sum, r) => sum + r.amount, 0);
            if (actualPaidSoFar > exactTotalToPay) {
                message += ` <span class="text-red-500 font-bold ml-2"><i class="fa-solid fa-triangle-exclamation"></i> 已溢繳</span>`;
            }
        }
        
        totalWithInterestDisplay.innerHTML = message;
    };
    [totalInput, periodsInput, downPaymentInput, interestInput].forEach(el => el.addEventListener('input', updateCalculation));
    modal.querySelector('#amort-frequency').addEventListener('change', updateCalculation);
    modal.querySelector('#amort-decimal-strategy').addEventListener('change', updateCalculation);
    updateCalculation();

    // ==================== 儲存 ====================
    modal.querySelector('#amort-save-btn').addEventListener('click', async () => {
        const name = modal.querySelector('#amort-name').value.trim();
        if (!name) { showToast('請輸入名稱', 'error'); return; }
        const total = parseFloat(totalInput.value);
        const periods = parseInt(periodsInput.value);
        if (!total || total <= 0) { showToast('請輸入有效的總金額', 'error'); return; }
        if (!periods || periods <= 0) { showToast('請輸入有效的期數', 'error'); return; }

        const downPayment = parseFloat(downPaymentInput.value) || 0;
        const annualRate = parseFloat(interestInput.value) || 0;
        const principal = Math.max(0, total - downPayment);
        const frequency = modal.querySelector('#amort-frequency').value;
        const decimalStrategy = modal.querySelector('#amort-decimal-strategy').value;

        const { amountPerPeriod } = calculateAmortizationDetails(principal, periods, annualRate, frequency, decimalStrategy);

        const startDate = modal.querySelector('#amort-start-date').value;
        const data = {
            name, type: typeInput.value, recordType: recordTypeSelect.value,
            category: categorySelect.value, totalAmount: total,
            downPayment: downPayment || 0, interestRate: annualRate || 0,
            periods, completedPeriods: isEdit ? (parseInt(modal.querySelector('#amort-completed')?.value) || 0) : 0,
            amountPerPeriod, frequency, decimalStrategy, startDate,
            nextDueDate: isEdit ? (item.nextDueDate || startDate) : startDate,
            status: isEdit ? item.status : 'active', description: '',
        };

        try {
            if (isEdit) {
                if (data.completedPeriods >= data.periods) data.status = 'completed';
                await app.dataService.updateAmortization(item.id, data);
                showToast('已更新', 'success');
            } else {
                await app.dataService.addAmortization(data);
                showToast(`「${name}」已建立`, 'success');
            }
            modal.remove();
            if (onSaved) onSaved();
        } catch (e) {
            showToast('操作失敗：' + e.message, 'error');
        }
    });

    modal.querySelector('#amort-cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#amort-name').focus();
}

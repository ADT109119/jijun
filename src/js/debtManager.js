// 欠款管理模組
import { formatCurrency, formatDate, formatDateToString, showToast } from './utils.js';

export class DebtManager {
  constructor(dataService) {
    this.dataService = dataService;
    this.container = null;
    this.currentFilter = 'unsettled'; // 'unsettled' | 'settled' | 'all'
    this.currentContactFilter = null; // null means all contacts
    this.currentPage = 1;
    this.pageSize = 10;
  }

  // 渲染欠款管理頁面
  async renderDebtsPage(container) {
    this.container = container;
    
    // Reset filters on page load
    this.currentContactFilter = null;
    this.currentFilter = 'unsettled';
    this.currentPage = 1;
    
    const contacts = await this.dataService.getContacts();

    container.innerHTML = `
      <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
            <i class="fa-solid fa-chevron-left text-xl"></i>
          </a>
          <h1 class="text-xl font-bold text-wabi-primary">欠款管理</h1>
          <button id="add-debt-btn" class="bg-wabi-primary text-white rounded-full w-8 h-8 flex items-center justify-center">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>

        <!-- Summary Cards (dynamic) -->
        <div id="summary-cards-container" class="grid grid-cols-2 gap-4 mb-4"></div>

        <!-- Contact Summary Table Button -->
        <div class="mb-4">
          <button id="show-summary-table-btn" class="w-full flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border hover:bg-wabi-bg">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-table-list text-wabi-primary"></i>
              <span class="text-wabi-text-primary font-medium">聯絡人欠款總表</span>
            </div>
            <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
          </button>
        </div>

        <!-- Filter Tabs -->
        <div class="flex h-10 w-full items-center justify-center rounded-lg bg-wabi-bg/50 p-1 mb-4">
          <button data-filter="unsettled" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'unsettled' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary'}">未結清</button>
          <button data-filter="settled" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'settled' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary'}">已結清</button>
          <button data-filter="all" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'all' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary'}">全部</button>
        </div>

        <!-- Contact Filter -->
        <div class="mb-4">
          <select id="contact-filter-select" class="w-full p-3 bg-wabi-surface rounded-lg border border-wabi-border text-wabi-text-primary">
            <option value="">👤 所有聯絡人</option>
            ${contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>

        <!-- Contacts Link -->
        <div class="mb-4">
          <a href="#contacts" class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border hover:bg-wabi-bg">
            <div class="flex items-center gap-3">
              <i class="fa-solid fa-address-book text-wabi-primary"></i>
              <span class="text-wabi-text-primary">聯絡人管理</span>
            </div>
            <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
          </a>
        </div>

        <!-- Debt List -->
        <div id="debt-list-container" class="space-y-3"></div>
      </div>
    `;

    this.setupEventListeners();
    await this.updateSummaryCards();
    await this.loadDebtList();
  }

  // Update summary cards based on current contact filter
  async updateSummaryCards() {
    const container = this.container.querySelector('#summary-cards-container');
    const allDebts = await this.dataService.getDebts({ settled: false });
    
    let filteredDebts = allDebts;
    if (this.currentContactFilter) {
      filteredDebts = allDebts.filter(d => d.contactId === this.currentContactFilter);
    }
    
    let totalReceivable = 0;
    let totalPayable = 0;
    
    filteredDebts.forEach(debt => {
      const amount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
      if (debt.type === 'receivable') {
        totalReceivable += amount;
      } else {
        totalPayable += amount;
      }
    });
    
    const contacts = await this.dataService.getContacts();
    const selectedContact = this.currentContactFilter 
      ? contacts.find(c => c.id === this.currentContactFilter)?.name || '聯絡人' 
      : null;
    
    container.innerHTML = `
      <div class="bg-wabi-income/10 rounded-xl p-4 text-center border border-wabi-income/20">
        <p class="text-sm text-wabi-income font-medium">${selectedContact ? selectedContact + ' 欠我' : '別人欠我'}</p>
        <p class="text-2xl font-bold text-wabi-income">${formatCurrency(totalReceivable)}</p>
      </div>
      <div class="bg-wabi-expense/10 rounded-xl p-4 text-center border border-wabi-expense/20">
        <p class="text-sm text-wabi-expense font-medium">${selectedContact ? '我欠 ' + selectedContact : '我欠別人'}</p>
        <p class="text-2xl font-bold text-wabi-expense">${formatCurrency(totalPayable)}</p>
      </div>
    `;
  }

  // Show contact summary table as modal
  async showContactSummaryModal() {
    const allDebts = await this.dataService.getDebts({ settled: false });
    const contacts = await this.dataService.getContacts();
    
    // Build summary per contact
    const contactSummary = {};
    allDebts.forEach(debt => {
      const contactId = debt.contactId;
      if (!contactSummary[contactId]) {
        contactSummary[contactId] = { receivable: 0, payable: 0 };
      }
      const amount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
      if (debt.type === 'receivable') {
        contactSummary[contactId].receivable += amount;
      } else {
        contactSummary[contactId].payable += amount;
      }
    });
    
    const rows = contacts.map(contact => {
      const summary = contactSummary[contact.id] || { receivable: 0, payable: 0 };
      const net = summary.receivable - summary.payable;
      if (summary.receivable === 0 && summary.payable === 0) return '';
      
      return `
        <tr class="border-b border-wabi-border last:border-b-0 hover:bg-wabi-bg cursor-pointer" data-contact-id="${contact.id}">
          <td class="px-4 py-3 text-sm text-wabi-text-primary font-medium">${contact.name}</td>
          <td class="px-4 py-3 text-sm text-wabi-income text-right">${summary.receivable > 0 ? formatCurrency(summary.receivable) : '-'}</td>
          <td class="px-4 py-3 text-sm text-wabi-expense text-right">${summary.payable > 0 ? formatCurrency(summary.payable) : '-'}</td>
          <td class="px-4 py-3 text-sm font-bold text-right ${net > 0 ? 'text-wabi-income' : net < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'}">${net > 0 ? '+' : ''}${formatCurrency(net)}</td>
        </tr>
      `;
    }).filter(Boolean).join('');
    
    const tableContent = !rows 
      ? `<p class="p-8 text-center text-wabi-text-secondary">目前沒有未結清的欠款</p>`
      : `
        <table class="w-full text-left">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium">聯絡人</th>
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium text-right">欠我</th>
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium text-right">我欠</th>
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium text-right">淨額</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    
    const modal = document.createElement('div');
    modal.id = 'contact-summary-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-wabi-border">
          <h3 class="text-lg font-semibold text-wabi-primary">
            <i class="fa-solid fa-table-list mr-2"></i>聯絡人欠款總表
          </h3>
          <button id="close-summary-modal" class="text-wabi-text-secondary hover:text-wabi-primary">
            <i class="fa-solid fa-times text-xl"></i>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          ${tableContent}
        </div>
        <div class="p-3 border-t border-wabi-border text-center text-xs text-wabi-text-secondary">
          點擊任一行可篩選該聯絡人的欠款
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close button
    modal.querySelector('#close-summary-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    
    // Click on row to filter by contact
    modal.querySelectorAll('tr[data-contact-id]').forEach(row => {
      row.addEventListener('click', () => {
        const contactId = parseInt(row.dataset.contactId);
        this.currentContactFilter = contactId;
        this.currentPage = 1;
        const select = this.container.querySelector('#contact-filter-select');
        if (select) select.value = contactId;
        this.updateSummaryCards();
        this.loadDebtList();
        modal.remove();
      });
    });
  }

  setupEventListeners() {
    // Add debt button
    this.container.querySelector('#add-debt-btn').addEventListener('click', () => {
      this.showAddDebtModal();
    });

    // Show summary table modal
    this.container.querySelector('#show-summary-table-btn')?.addEventListener('click', () => {
      this.showContactSummaryModal();
    });

    // Filter buttons
    this.container.querySelectorAll('.debt-filter-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        this.currentFilter = e.target.dataset.filter;
        // Update UI
        this.container.querySelectorAll('.debt-filter-btn').forEach(b => {
          b.classList.remove('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
          b.classList.add('text-wabi-text-secondary');
        });
        e.target.classList.add('bg-wabi-surface', 'text-wabi-primary', 'shadow-sm');
        e.target.classList.remove('text-wabi-text-secondary');
        this.currentPage = 1; // Reset to first page when filter changes
        await this.loadDebtList();
      });
    });

    // Contact filter select
    this.container.querySelector('#contact-filter-select')?.addEventListener('change', async (e) => {
      this.currentContactFilter = e.target.value ? parseInt(e.target.value) : null;
      this.currentPage = 1; // Reset to first page when filter changes
      await this.updateSummaryCards();
      await this.loadDebtList();
    });
  }

  async loadDebtList() {
    const listContainer = this.container.querySelector('#debt-list-container');
    const filters = {};
    
    if (this.currentFilter === 'unsettled') {
      filters.settled = false;
    } else if (this.currentFilter === 'settled') {
      filters.settled = true;
    }

    let allDebts = await this.dataService.getDebts(filters);
    const contacts = await this.dataService.getContacts();

    // Apply contact filter
    if (this.currentContactFilter) {
      allDebts = allDebts.filter(d => d.contactId === this.currentContactFilter);
    }

    // Pagination
    const totalDebts = allDebts.length;
    const totalPages = Math.ceil(totalDebts / this.pageSize);
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const debts = allDebts.slice(startIndex, startIndex + this.pageSize);

    if (allDebts.length === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-8 text-wabi-text-secondary">
          <i class="fa-solid fa-receipt text-4xl mb-3"></i>
          <p>目前沒有${this.currentFilter === 'unsettled' ? '未結清的' : this.currentFilter === 'settled' ? '已結清的' : ''}欠款記錄</p>
        </div>
      `;
      return;
    }

    let html = debts.map(debt => {
      const contact = contacts.find(c => c.id === debt.contactId);
      const contactName = contact?.name || '未知聯絡人';
      const isReceivable = debt.type === 'receivable';
      // Use remainingAmount for display, fallback for backward compatibility
      const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
      const originalAmount = debt.originalAmount ?? debt.amount ?? remainingAmount;
      const paidAmount = originalAmount - remainingAmount;
      const progressPercent = originalAmount > 0 ? ((paidAmount / originalAmount) * 100).toFixed(0) : 0;
      const hasPartialPayments = paidAmount > 0 && remainingAmount > 0;
      const hasPaymentHistory = debt.payments && debt.payments.length > 0;
      
      return `
        <div class="bg-wabi-surface rounded-lg border border-wabi-border p-4 ${debt.settled ? 'opacity-60' : ''}" data-debt-id="${debt.id}">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-full ${isReceivable ? 'bg-wabi-income/20 text-wabi-income' : 'bg-wabi-expense/20 text-wabi-expense'} size-10">
                <i class="fa-solid fa-user"></i>
              </div>
              <div>
                <p class="font-medium text-wabi-text-primary">${contactName}</p>
                <p class="text-sm text-wabi-text-secondary">${isReceivable ? '欠我' : '我欠'}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${isReceivable ? '+' : '-'}${formatCurrency(remainingAmount)}</p>
              ${hasPartialPayments ? `<p class="text-xs text-wabi-text-secondary line-through">${formatCurrency(originalAmount)}</p>` : ''}
              <p class="text-xs text-wabi-text-secondary">${formatDate(debt.date, 'short')}</p>
            </div>
          </div>
          ${debt.description ? `<p class="text-sm text-wabi-text-secondary mt-2 pl-13">${debt.description}</p>` : ''}
          ${hasPartialPayments ? `
            <div class="mt-2">
              <div class="flex justify-between text-xs text-wabi-text-secondary mb-1">
                <span>已${isReceivable ? '收款' : '還款'} ${formatCurrency(paidAmount)}</span>
                <span>${progressPercent}%</span>
              </div>
              <div class="w-full bg-wabi-bg rounded-full h-1.5">
                <div class="${isReceivable ? 'bg-wabi-income' : 'bg-wabi-expense'} h-1.5 rounded-full" style="width: ${progressPercent}%"></div>
              </div>
            </div>
          ` : ''}
          ${hasPaymentHistory ? `
            <button class="view-history-btn w-full mt-2 py-1 text-xs text-wabi-primary border border-wabi-primary/30 rounded bg-wabi-primary/5" data-id="${debt.id}">
              <i class="fa-solid fa-clock-rotate-left mr-1"></i>查看還款歷程 (${debt.payments.length} 筆)
            </button>
          ` : ''}
          ${!debt.settled ? `
            <div class="flex gap-2 mt-3 pt-3 border-t border-wabi-border">
              <button class="settle-debt-btn flex-1 py-2 text-sm font-medium text-white bg-wabi-primary rounded-lg" data-id="${debt.id}">
                ${isReceivable ? '全額收款' : '全額還款'}
              </button>
              <button class="partial-payment-btn px-4 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg" data-id="${debt.id}">
                部分
              </button>
              <button class="edit-debt-btn px-4 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg" data-id="${debt.id}">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="remind-debt-btn px-4 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg" data-id="${debt.id}">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
              <button class="delete-debt-btn px-4 py-2 text-sm font-medium text-wabi-expense border border-wabi-expense rounded-lg" data-id="${debt.id}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          ` : `
            <div class="flex items-center justify-between mt-3 pt-3 border-t border-wabi-border">
              <div class="flex items-center gap-2 text-sm text-wabi-text-secondary">
                <i class="fa-solid fa-check-circle text-wabi-income"></i>
                <span>已於 ${formatDate(new Date(debt.settledAt).toISOString().split('T')[0], 'short')} 結清</span>
              </div>
              <div class="flex gap-2">
                <button class="edit-debt-btn px-3 py-1 text-xs font-medium text-wabi-primary border border-wabi-primary rounded-lg" data-id="${debt.id}">
                  編輯
                </button>
                <button class="delete-debt-btn px-3 py-1 text-xs font-medium text-wabi-expense border border-wabi-expense rounded-lg" data-id="${debt.id}">
                  刪除
                </button>
              </div>
            </div>
          `}
        </div>
      `;
    }).join('');

    // Add pagination controls
    if (totalPages > 1) {
      html += `
        <div class="flex items-center justify-center gap-4 mt-4 py-3">
          <button id="prev-page-btn" class="px-4 py-2 text-sm font-medium rounded-lg ${this.currentPage === 1 ? 'bg-wabi-bg text-wabi-text-secondary cursor-not-allowed' : 'bg-wabi-primary text-white'}" ${this.currentPage === 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-left mr-1"></i>上一頁
          </button>
          <span class="text-sm text-wabi-text-secondary">${this.currentPage} / ${totalPages}</span>
          <button id="next-page-btn" class="px-4 py-2 text-sm font-medium rounded-lg ${this.currentPage === totalPages ? 'bg-wabi-bg text-wabi-text-secondary cursor-not-allowed' : 'bg-wabi-primary text-white'}" ${this.currentPage === totalPages ? 'disabled' : ''}>
            下一頁<i class="fa-solid fa-chevron-right ml-1"></i>
          </button>
        </div>
      `;
    }

    listContainer.innerHTML = html;

    // Bind settle buttons
    listContainer.querySelectorAll('.settle-debt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        if (confirm('確定要標記此欠款為全額結清嗎？系統將自動產生對應的收支記錄。')) {
          await this.dataService.settleDebt(debtId);
          showToast('已結清欠款並產生記帳紀錄', 'success');
          // Maintain current filter state instead of full re-render
          await this.updateSummaryCards();
          await this.loadDebtList();
        }
      });
    });

    // Bind partial payment buttons
    listContainer.querySelectorAll('.partial-payment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        await this.showPartialPaymentModal(debtId);
      });
    });

    // Bind remind buttons
    listContainer.querySelectorAll('.remind-debt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        await this.showReminderModal(debtId);
      });
    });

    // Bind delete buttons
    listContainer.querySelectorAll('.delete-debt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        const debt = await this.dataService.getDebt(debtId);
        
        if (confirm('確定要刪除此欠款記錄嗎？')) {
          const recordId = debt?.recordId;
          await this.dataService.deleteDebt(debtId);
          
          if (recordId) {
              if (confirm('此欠款有關聯的記帳紀錄，是否也要一併刪除該紀錄？')) {
                  await this.dataService.deleteRecord(recordId);
                  showToast('欠款與關聯紀錄已刪除', 'success');
              } else {
                  // 清除紀錄上的反向引用，避免留下孤立指標
                  await this.dataService.updateRecord(recordId, { debtId: null });
                  showToast('已刪除欠款紀錄', 'success');
              }
          } else {
              showToast('已刪除欠款紀錄', 'success');
          }
          
          await this.updateSummaryCards();
          await this.loadDebtList();
        }
      });
    });

    // Bind view history buttons
    listContainer.querySelectorAll('.view-history-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        await this.showPaymentHistoryModal(debtId);
      });
    });

    // Bind edit buttons
    listContainer.querySelectorAll('.edit-debt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        const debt = await this.dataService.getDebt(debtId);
        await this.showAddDebtModal(debt);
      });
    });

    // Bind pagination buttons
    const prevBtn = listContainer.querySelector('#prev-page-btn');
    const nextBtn = listContainer.querySelector('#next-page-btn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', async () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          await this.loadDebtList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', async () => {
        if (this.currentPage < totalPages) {
          this.currentPage++;
          await this.loadDebtList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
  }

  async showPartialPaymentModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '未知聯絡人';
    const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
    const isReceivable = debt.type === 'receivable';

    const modal = document.createElement('div');
    modal.id = 'partial-payment-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">部分${isReceivable ? '收款' : '還款'}</h3>
        <p class="text-sm text-wabi-text-secondary mb-4">${contactName} - ${debt.description || '無備註'}</p>
        <p class="text-sm text-wabi-text-secondary mb-2">剩餘金額：<span class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${formatCurrency(remainingAmount)}</span></p>
        
        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${isReceivable ? '收款' : '還款'}金額</label>
          <input type="number" id="partial-amount" value="" min="1" max="${remainingAmount}" step="1" placeholder="輸入金額"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <div class="flex space-x-3">
          <button id="confirm-partial-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
            確認
          </button>
          <button id="cancel-partial-btn" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    modal.querySelector('#cancel-partial-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Focus input
    setTimeout(() => {
      modal.querySelector('#partial-amount').focus();
    }, 100);

    modal.querySelector('#confirm-partial-btn').addEventListener('click', async () => {
      const amount = parseFloat(modal.querySelector('#partial-amount').value);

      if (!amount || amount <= 0) {
        alert('請輸入有效金額');
        return;
      }

      if (amount > remainingAmount) {
        alert(`金額不能超過剩餘金額 ${formatCurrency(remainingAmount)}`);
        return;
      }

      await this.dataService.addPartialPayment(debtId, amount);
      closeModal();
      // Maintain current filter state instead of full re-render
      await this.updateSummaryCards();
      await this.loadDebtList();
    });
  }

  async showPaymentHistoryModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '未知聯絡人';
    const isReceivable = debt.type === 'receivable';
    const payments = debt.payments || [];

    const modal = document.createElement('div');
    modal.id = 'payment-history-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6 max-h-[80vh] overflow-y-auto">
        <h3 class="text-lg font-semibold mb-2 text-wabi-primary">${isReceivable ? '收款' : '還款'}歷程</h3>
        <p class="text-sm text-wabi-text-secondary mb-4">${contactName} - ${debt.description || '無備註'}</p>
        
        <div class="space-y-3 mb-4">
          ${payments.length === 0 ? `
            <p class="text-center py-4 text-wabi-text-secondary">尚無還款記錄</p>
          ` : payments.map((payment, index) => `
            <div class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border">
              <div class="flex items-center gap-3">
                <div class="flex items-center justify-center rounded-full ${isReceivable ? 'bg-wabi-income/20 text-wabi-income' : 'bg-wabi-expense/20 text-wabi-expense'} size-8 text-sm">
                  ${index + 1}
                </div>
                <div>
                  <p class="font-medium ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">
                    ${isReceivable ? '+' : '-'}${formatCurrency(payment.amount)}
                  </p>
                  <p class="text-xs text-wabi-text-secondary">${formatDate(payment.date, 'short')}</p>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="border-t border-wabi-border pt-3">
          <div class="flex justify-between text-sm mb-2">
            <span class="text-wabi-text-secondary">原始金額</span>
            <span class="font-medium">${formatCurrency(debt.originalAmount || debt.amount)}</span>
          </div>
          <div class="flex justify-between text-sm mb-2">
            <span class="text-wabi-text-secondary">已${isReceivable ? '收款' : '還款'}</span>
            <span class="font-medium ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">
              ${formatCurrency(payments.reduce((sum, p) => sum + p.amount, 0))}
            </span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-wabi-text-secondary">剩餘金額</span>
            <span class="font-bold">${formatCurrency(debt.remainingAmount || 0)}</span>
          </div>
        </div>

        <button id="close-history-btn" class="w-full mt-4 py-3 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary rounded-lg transition-colors">
          關閉
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    modal.querySelector('#close-history-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  async showAddDebtModal(debtToEdit = null) {
    const isEdit = !!debtToEdit;
    const contacts = await this.dataService.getContacts();

    if (contacts.length === 0) {
      alert('請先新增聯絡人');
      window.location.hash = '#contacts';
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'add-debt-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    const contactOptions = contacts.map(c => 
      `<option value="${c.id}" ${debtToEdit?.contactId === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">${isEdit ? '編輯欠款' : '新增欠款記錄'}</h3>
        
        <!-- Type Selector -->
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">類型</label>
          <div class="flex h-10 w-full items-center justify-center rounded-lg bg-wabi-bg/50 p-1">
            <button id="debt-type-receivable" class="debt-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${(!isEdit || debtToEdit?.type === 'receivable') ? 'bg-wabi-income text-white' : 'text-wabi-text-secondary'}">別人欠我</button>
            <button id="debt-type-payable" class="debt-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${(isEdit && debtToEdit?.type === 'payable') ? 'bg-wabi-expense text-white' : 'text-wabi-text-secondary'}">我欠別人</button>
          </div>
        </div>

        <!-- Contact -->
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">聯絡人</label>
          <select id="debt-contact" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${contactOptions}
          </select>
        </div>

        <!-- Amount -->
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">金額</label>
          <input type="number" id="debt-amount" value="${debtToEdit?.originalAmount ?? debtToEdit?.amount ?? ''}" min="0" step="1" placeholder="輸入金額"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <!-- Date -->
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">日期</label>
          <input type="date" id="debt-date" value="${debtToEdit?.date || formatDateToString(new Date())}"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <!-- Description -->
        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">備註</label>
          <input type="text" id="debt-description" value="${debtToEdit?.description || ''}" placeholder="例如：午餐代墊"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <!-- Buttons -->
        <div class="flex space-x-3">
          <button id="save-debt-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
            ${isEdit ? '儲存' : '新增'}
          </button>
          <button id="cancel-debt-btn" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let selectedType = debtToEdit?.type || 'receivable';

    // Type toggle
    modal.querySelectorAll('.debt-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        selectedType = btn.id === 'debt-type-receivable' ? 'receivable' : 'payable';
        modal.querySelectorAll('.debt-type-btn').forEach(b => {
          b.classList.remove('bg-wabi-income', 'bg-wabi-expense', 'text-white');
          b.classList.add('text-wabi-text-secondary');
        });
        if (selectedType === 'receivable') {
          btn.classList.add('bg-wabi-income', 'text-white');
        } else {
          btn.classList.add('bg-wabi-expense', 'text-white');
        }
        btn.classList.remove('text-wabi-text-secondary');
      });
    });

    const closeModal = () => modal.remove();

    modal.querySelector('#cancel-debt-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector('#save-debt-btn').addEventListener('click', async () => {
      const contactId = parseInt(modal.querySelector('#debt-contact').value);
      const amount = parseFloat(modal.querySelector('#debt-amount').value);
      const date = modal.querySelector('#debt-date').value;
      const description = modal.querySelector('#debt-description').value;

      if (!contactId || !amount || amount <= 0 || !date) {
        alert('請填寫完整資料');
        return;
      }

      const debtData = {
        type: selectedType,
        contactId,
        amount,
        date,
        description
      };

      if (isEdit) {
        // 編輯模式下，同步更新 originalAmount 並根據已還金額重新計算 remainingAmount
        debtData.originalAmount = amount;
        const paidAmount = (debtToEdit.payments || []).reduce((sum, p) => sum + p.amount, 0);
        const newRemaining = Math.max(0, amount - paidAmount);
        debtData.remainingAmount = newRemaining;
        
        // 如果金額調整後導致餘額為 0，改為已結清；若餘額 > 0 且原本已結清則恢復為未結清
        if (newRemaining === 0 && !debtToEdit.settled) {
          debtData.settled = true;
          debtData.settledAt = Date.now();
        } else if (newRemaining > 0 && debtToEdit.settled) {
          debtData.settled = false;
          debtData.settledAt = null;
        }

        await this.dataService.updateDebt(debtToEdit.id, debtData);
        showToast('已更新欠款紀錄', 'success');
      } else {
        await this.dataService.addDebt(debtData);
        showToast('已新增欠款紀錄', 'success');
      }

      closeModal();
      // Maintain current filter state instead of full re-render
      await this.updateSummaryCards();
      await this.loadDebtList();
    });
  }

  async showReminderModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '朋友';

    const isReceivable = debt.type === 'receivable';
    // Use remainingAmount for reminder message
    const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
    let message = '';

    if (isReceivable) {
      message = `嗨 ${contactName}，提醒一下之前${debt.date}${debt.description ? `「${debt.description}」` : ''}的 ${formatCurrency(remainingAmount)} 還沒收到喔！方便的話再麻煩你轉給我，謝謝！`;
    } else {
      message = `嗨 ${contactName}，我還欠你${debt.date}${debt.description ? `「${debt.description}」` : ''} ${formatCurrency(remainingAmount)}，我會盡快還你的！`;
    }

    const modal = document.createElement('div');
    modal.id = 'reminder-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">提醒訊息</h3>
        <textarea id="reminder-text" class="w-full h-32 p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary resize-none mb-4">${message}</textarea>
        <div class="flex space-x-3">
          <button id="copy-reminder-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
            <i class="fa-solid fa-copy mr-2"></i>複製
          </button>
          <button id="share-reminder-btn" class="flex-1 bg-wabi-income hover:bg-wabi-income/90 text-white font-bold py-3 rounded-lg transition-colors">
            <i class="fa-solid fa-share-nodes mr-2"></i>分享
          </button>
          <button id="close-reminder-btn" class="px-4 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
            關閉
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    modal.querySelector('#close-reminder-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector('#copy-reminder-btn').addEventListener('click', async () => {
      const text = modal.querySelector('#reminder-text').value;
      try {
        await navigator.clipboard.writeText(text);
        alert('訊息已複製到剪貼簿！');
        closeModal();
      } catch (err) {
        // Fallback for older browsers
        modal.querySelector('#reminder-text').select();
        document.execCommand('copy');
        alert('訊息已複製！');
        closeModal();
      }
    });

    modal.querySelector('#share-reminder-btn')?.addEventListener('click', async () => {
      const text = modal.querySelector('#reminder-text').value;
      
      if (navigator.share) {
        try {
          await navigator.share({
            title: '欠款提醒',
            text: text
          });
          closeModal();
        } catch (err) {
          // User cancelled or share failed
          if (err.name !== 'AbortError') {
            alert('分享失敗，請使用複製功能');
          }
        }
      } else {
        // Fallback: copy to clipboard
        try {
          await navigator.clipboard.writeText(text);
          alert('您的瀏覽器不支援分享功能，訊息已複製到剪貼簿！');
        } catch (err) {
          alert('分享功能不支援，請使用複製功能');
        }
      }
    });
  }

  // 渲染聯絡人管理頁面
  async renderContactsPage(container) {
    this.container = container;
    const contacts = await this.dataService.getContacts();

    container.innerHTML = `
      <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <a href="#debts" class="text-wabi-text-secondary hover:text-wabi-primary">
            <i class="fa-solid fa-chevron-left text-xl"></i>
          </a>
          <h1 class="text-xl font-bold text-wabi-primary">聯絡人管理</h1>
          <button id="add-contact-btn" class="bg-wabi-primary text-white rounded-full w-8 h-8 flex items-center justify-center">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>

        <!-- Contact List -->
        <div id="contact-list-container" class="space-y-2">
          ${contacts.length === 0 ? `
            <div class="text-center py-8 text-wabi-text-secondary">
              <i class="fa-solid fa-user-plus text-4xl mb-3"></i>
              <p>尚未新增任何聯絡人</p>
            </div>
          ` : contacts.map(contact => `
            <div class="flex items-center justify-between bg-wabi-surface p-4 rounded-lg border border-wabi-border" data-contact-id="${contact.id}">
              <div class="flex items-center gap-3">
                <div class="contact-avatar flex items-center justify-center rounded-full bg-wabi-primary/20 text-wabi-primary size-10 overflow-hidden" data-avatar-id="${contact.avatarFileId || ''}">
                  <i class="fa-solid fa-user"></i>
                </div>
                <span class="font-medium text-wabi-text-primary">${contact.name}</span>
              </div>
              <div class="flex gap-2">
                <button class="edit-contact-btn p-2" data-id="${contact.id}">
                  <i class="fa-solid fa-pen text-wabi-text-secondary"></i>
                </button>
                <button class="delete-contact-btn p-2" data-id="${contact.id}">
                  <i class="fa-solid fa-trash-can text-wabi-expense"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Async load avatars
    this.loadContactAvatars();

    // Add contact button
    container.querySelector('#add-contact-btn').addEventListener('click', () => {
      this.showContactModal();
    });

    // Edit buttons
    container.querySelectorAll('.edit-contact-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const contactId = parseInt(btn.dataset.id);
        const contact = await this.dataService.getContact(contactId);
        this.showContactModal(contact);
      });
    });

    // Delete buttons
    container.querySelectorAll('.delete-contact-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const contactId = parseInt(btn.dataset.id);
        // Check if contact has debts
        const debts = await this.dataService.getDebts({ contactId });
        if (debts.length > 0) {
          alert('此聯絡人尚有關聯的欠款記錄，無法刪除。');
          return;
        }
        if (confirm('確定要刪除此聯絡人嗎？')) {
          await this.dataService.deleteContact(contactId);
          await this.renderContactsPage(container);
        }
      });
    });
  }

  async showContactModal(contactToEdit = null) {
    const isEdit = !!contactToEdit;
    const avatarFileId = contactToEdit?.avatarFileId || null;
    let avatarPreviewUrl = null;

    // Load existing avatar if editing
    if (avatarFileId) {
      const file = await this.dataService.getFile(avatarFileId);
      if (file && file.data) {
        avatarPreviewUrl = URL.createObjectURL(file.data);
      }
    }

    const modal = document.createElement('div');
    modal.id = 'contact-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">${isEdit ? '編輯聯絡人' : '新增聯絡人'}</h3>
        
        <!-- Avatar Upload -->
        <div class="flex justify-center mb-4">
          <label class="cursor-pointer">
            <div id="avatar-preview" class="relative size-20 rounded-full bg-wabi-primary/20 flex items-center justify-center overflow-hidden border-2 border-dashed border-wabi-primary/50 hover:border-wabi-primary">
              ${avatarPreviewUrl 
                ? `<img src="${avatarPreviewUrl}" class="w-full h-full object-cover">`
                : `<i class="fa-solid fa-camera text-2xl text-wabi-primary/50"></i>`}
              <div class="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <i class="fa-solid fa-pen text-white"></i>
              </div>
            </div>
            <input type="file" id="avatar-input" accept="image/*" class="hidden">
          </label>
        </div>
        <p class="text-xs text-center text-wabi-text-secondary mb-4">點擊上傳頭像</p>
        
        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">名稱</label>
          <input type="text" id="contact-name" value="${contactToEdit?.name || ''}" placeholder="輸入聯絡人名稱"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <div class="flex space-x-3">
          <button id="save-contact-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-white font-bold py-3 rounded-lg transition-colors">
            ${isEdit ? '儲存' : '新增'}
          </button>
          <button id="cancel-contact-btn" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let newAvatarBlob = null;

    // Handle avatar file input
    const avatarInput = modal.querySelector('#avatar-input');
    const avatarPreview = modal.querySelector('#avatar-preview');
    
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        newAvatarBlob = file;
        const url = URL.createObjectURL(file);
        avatarPreview.innerHTML = `
          <img src="${url}" class="w-full h-full object-cover">
          <div class="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <i class="fa-solid fa-pen text-white"></i>
          </div>
        `;
      }
    });

    const closeModal = () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      modal.remove();
    };

    modal.querySelector('#cancel-contact-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Focus input
    setTimeout(() => {
      modal.querySelector('#contact-name').focus();
    }, 100);

    modal.querySelector('#save-contact-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#contact-name').value.trim();

      if (!name) {
        alert('請輸入聯絡人名稱');
        return;
      }

      let newAvatarFileId = avatarFileId;

      // Upload new avatar if selected
      if (newAvatarBlob) {
        newAvatarFileId = await this.dataService.addFile({
          name: newAvatarBlob.name,
          type: newAvatarBlob.type,
          data: newAvatarBlob
        });

        // Delete old avatar if exists
        if (avatarFileId && avatarFileId !== newAvatarFileId) {
          await this.dataService.deleteFile(avatarFileId);
        }
      }

      if (isEdit) {
        await this.dataService.updateContact(contactToEdit.id, { 
          name, 
          avatarFileId: newAvatarFileId 
        });
      } else {
        await this.dataService.addContact({ 
          name, 
          avatarFileId: newAvatarFileId 
        });
      }

      closeModal();
      await this.renderContactsPage(this.container);
    });
  }

  // Helper to get avatar URL for a contact
  async getContactAvatarUrl(contact) {
    if (contact.avatarFileId) {
      const file = await this.dataService.getFile(contact.avatarFileId);
      if (file && file.data) {
        return URL.createObjectURL(file.data);
      }
    }
    return null;
  }

  // Async load avatars for contact list
  async loadContactAvatars() {
    const avatarElements = this.container.querySelectorAll('.contact-avatar[data-avatar-id]');
    for (const el of avatarElements) {
      const avatarId = el.dataset.avatarId;
      if (avatarId) {
        const file = await this.dataService.getFile(parseInt(avatarId));
        if (file && file.data) {
          const url = URL.createObjectURL(file.data);
          el.innerHTML = `<img src="${url}" class="w-full h-full object-cover" style="dynamic-range-limit: standard;">`;
        }
      }
    }
  }
}

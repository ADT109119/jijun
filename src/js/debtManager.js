// 欠款管理模組
import { formatCurrency, formatDate, formatDateToString, showToast, customConfirm, customAlert, escapeHTML } from './utils.js';
import { getCategoryById } from './categories.js';

export class DebtManager {
  constructor(dataService, app = null) {
    this.dataService = dataService;
    this.app = app;
    this.appRef = app;
    this.container = null;
    this.currentFilter = 'unsettled'; // 'unsettled' | 'settled' | 'all'
    this.currentContactFilter = null; // null means all contacts
    this.currentPage = 1;
    this.pageSize = 10;
    this.showGroups = true; // Whether to show group entries in debt list
  }

  // 渲染欠款管理頁面
  async renderDebtsPage(container, params = null) {
    this.container = container;
    
    // Reset filters on page load
    this.currentContactFilter = null;
    this.currentFilter = 'unsettled';
    this.currentPage = 1;
    this.highlightDebtId = null;
    this.highlightGroupId = null;

    if (params) {
      const contactIdParam = params.get('contactId');
      if (contactIdParam) {
        this.currentContactFilter = parseInt(contactIdParam);
      }
      const filterParam = params.get('filter');
      if (filterParam) {
        this.currentFilter = filterParam;
      }
      const debtIdParam = params.get('debtId');
      if (debtIdParam) {
        const debtId = parseInt(debtIdParam);
        const debt = await this.dataService.getDebt(debtId);
        if (debt) {
          this.currentFilter = debt.settled ? 'settled' : 'unsettled';
          this.currentContactFilter = debt.contactId;
          this.highlightDebtId = debt.id;
        }
      }
      const groupIdParam = params.get('groupId');
      if (groupIdParam) {
        this.highlightGroupId = groupIdParam;
        const groupMeta = await this.dataService.getGroupMeta(groupIdParam);
        if (groupMeta) {
          this.currentFilter = groupMeta.settled ? 'settled' : 'unsettled';
        }
      }
    }
    
    const contacts = await this.dataService.getContacts();

    container.innerHTML = `
      <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
            <i class="fa-solid fa-chevron-left text-xl"></i>
          </a>
          <h1 class="text-xl font-bold text-wabi-primary">欠款管理</h1>
          <button id="add-debt-btn" class="bg-wabi-primary text-wabi-surface rounded-full w-8 h-8 flex items-center justify-center">
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
        <div class="flex h-10 w-full items-center justify-center rounded-lg bg-wabi-bg border border-wabi-border p-1 mb-4">
          <button data-filter="unsettled" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'unsettled' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary hover:text-wabi-text-primary'}">未結清</button>
          <button data-filter="settled" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'settled' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary hover:text-wabi-text-primary'}">已結清</button>
          <button data-filter="all" class="debt-filter-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${this.currentFilter === 'all' ? 'bg-wabi-surface text-wabi-primary shadow-sm' : 'text-wabi-text-secondary hover:text-wabi-text-primary'}">全部</button>
        </div>

        <!-- Contact Filter -->
        <div class="mb-4">
          <select id="contact-filter-select" class="w-full p-3 bg-wabi-surface rounded-lg border border-wabi-border text-wabi-text-primary">
            <option value="">👤 所有聯絡人</option>
            ${contacts.map(c => `<option value="${c.id}" ${this.currentContactFilter === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
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
    if (!this.container) return;
    const container = this.container.querySelector('#summary-cards-container');
    if (!container) return;

    const allDebts = await this.dataService.getDebts({ settled: false });

    // 過濾掉屬於群組的個人欠款（若該欠款已在群組中，只呈現群組卡片）
    const allRecords = await this.dataService.getRecords();
    const recordsMap = new Map(allRecords.map(r => [r.id, r]));
    const groupFilteredDebts = allDebts.filter(d => {
      if (d.groupId) return false;
      if (d.recordId) {
        const rec = recordsMap.get(d.recordId);
        if (rec && rec.groupId) return false;
      }
      return true;
    });

    let filteredDebts = groupFilteredDebts;
    if (this.currentContactFilter) {
      filteredDebts = groupFilteredDebts.filter(d => d.contactId === this.currentContactFilter);
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
    
    // Load group summary (filtered by contact if contact filter is active)
    let groupCardHtml = '';
    try {
      const groups = await this.dataService.getGroups();
      let unsettledGroups = groups.filter(g => !g.settled && g.netAmount !== 0);

      if (this.currentContactFilter) {
        const contactGroupIds = new Set();
        allDebts.forEach(d => {
          if (d.contactId === this.currentContactFilter && !d.settled) {
            if (d.groupId) contactGroupIds.add(d.groupId);
            if (d.recordId) {
              const rec = recordsMap.get(d.recordId);
              if (rec && rec.groupId) contactGroupIds.add(rec.groupId);
            }
          }
        });
        allRecords.forEach(r => {
          if (r.groupId && r.contactId === this.currentContactFilter && r.groupStatus !== 'settled') {
            contactGroupIds.add(r.groupId);
          }
        });
        unsettledGroups = unsettledGroups.filter(g => contactGroupIds.has(g.id));
      }

      const totalGroupNet = unsettledGroups.reduce((s, g) => s + g.netAmount, 0);
      groupCardHtml = `
        <div class="bg-emerald-500/10 rounded-xl p-4 text-center border border-emerald-500/20">
          <p class="text-sm text-emerald-600 font-medium">未結清群組</p>
          <p class="text-lg font-bold text-emerald-600">${unsettledGroups.length} 個</p>
          <p class="text-xs text-emerald-600/70 mt-1">淨額 ${formatCurrency(totalGroupNet)}</p>
        </div>
      `;
    } catch (e) {
      console.warn('Failed to load group summary:', e);
    }
    
    container.innerHTML = `
      <div class="bg-wabi-income/10 rounded-xl p-4 text-center border border-wabi-income/20">
        <p class="text-sm text-wabi-income font-medium">${selectedContact ? '應收 ' + selectedContact : '總應收 (待收)'}</p>
        <p class="text-2xl font-bold text-wabi-income">${formatCurrency(totalReceivable)}</p>
      </div>
      <div class="bg-wabi-expense/10 rounded-xl p-4 text-center border border-wabi-expense/20">
        <p class="text-sm text-wabi-expense font-medium">${selectedContact ? '應付 ' + selectedContact : '總應付 (待付)'}</p>
        <p class="text-2xl font-bold text-wabi-expense">${formatCurrency(totalPayable)}</p>
      </div>
      ${groupCardHtml}
    `;
  }

  // Show contact summary table as modal
  async showContactSummaryModal() {
    const allDebts = await this.dataService.getDebts({ settled: false });
    const contacts = await this.dataService.getContacts();

    // 過濾掉屬於群組的個人欠款（群組欠款由群組卡片/總結呈現，避免雙重計數）
    const allRecords = await this.dataService.getRecords();
    const recordsMap = new Map(allRecords.map(r => [r.id, r]));
    const personalDebts = allDebts.filter(d => {
      if (d.groupId) return false;
      if (d.recordId) {
        const rec = recordsMap.get(d.recordId);
        if (rec && rec.groupId) return false;
      }
      return true;
    });

    // Build summary per contact
    const contactSummary = {};
    personalDebts.forEach(debt => {
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
          <td class="px-4 py-3 text-sm text-wabi-text-primary font-medium">${escapeHTML(contact.name)}</td>
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
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium text-right">應收</th>
              <th class="px-4 py-2 text-xs text-wabi-text-secondary font-medium text-right">應付</th>
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
    if (!this.container) return;
    const listContainer = this.container.querySelector('#debt-list-container');
    if (!listContainer) return;

    const filters = {};
    
    if (this.currentFilter === 'unsettled') {
      filters.settled = false;
    } else if (this.currentFilter === 'settled') {
      filters.settled = true;
    }

    let allDebts = await this.dataService.getDebts(filters);
    const contacts = await this.dataService.getContacts();
    const allRecords = await this.dataService.getRecords();
    const recordsMap = new Map(allRecords.map(r => [r.id, r]));

    // 過濾掉屬於群組的個人欠款（若該欠款已在群組中，只呈現群組卡片）
    allDebts = allDebts.filter(d => {
      if (d.groupId) return false;
      if (d.recordId) {
        const rec = recordsMap.get(d.recordId);
        if (rec && rec.groupId) return false;
      }
      return true;
    });

    // Apply contact filter (for personal debts)
    if (this.currentContactFilter) {
      allDebts = allDebts.filter(d => d.contactId === this.currentContactFilter);
    }

    // Load groups if enabled
    let groups = [];
    if (this.showGroups && typeof this.dataService.getGroups === 'function') {
      try {
        const allGroups = await this.dataService.getGroups();

        // Filter groups by settled status and netAmount
        if (this.currentFilter === 'unsettled') {
          groups = allGroups.filter(g => !g.settled && g.netAmount !== 0);
        } else if (this.currentFilter === 'settled') {
          groups = allGroups.filter(g => g.settled);
        } else {
          groups = allGroups.filter(g => g.netAmount !== 0 || g.settled);
        }

        // Apply contact filter to groups: only show groups containing debts/records of this contact
        if (this.currentContactFilter) {
          const allDebtsInDb = await this.dataService.getDebts({ allLedgers: true });
          let targetDebts = allDebtsInDb.filter(d => d.contactId === this.currentContactFilter);
          if (this.currentFilter === 'unsettled') {
            targetDebts = targetDebts.filter(d => !d.settled);
          } else if (this.currentFilter === 'settled') {
            targetDebts = targetDebts.filter(d => d.settled);
          }

          const matchedGroupIds = new Set();
          targetDebts.forEach(d => {
            if (d.groupId) matchedGroupIds.add(d.groupId);
            if (d.recordId) {
              const rec = recordsMap.get(d.recordId);
              if (rec && rec.groupId) matchedGroupIds.add(rec.groupId);
            }
          });

          allRecords.forEach(r => {
            if (r.groupId && r.contactId === this.currentContactFilter) {
              if (this.currentFilter === 'unsettled' && r.groupStatus !== 'settled') {
                matchedGroupIds.add(r.groupId);
              } else if (this.currentFilter === 'settled' && r.groupStatus === 'settled') {
                matchedGroupIds.add(r.groupId);
              } else if (this.currentFilter === 'all') {
                matchedGroupIds.add(r.groupId);
              }
            }
          });

          groups = groups.filter(g => matchedGroupIds.has(g.id));
        }
      } catch (e) {
        console.warn('Failed to load groups for debt list:', e);
      }
    }

    // Pagination
    if (this.highlightDebtId) {
      const debtIndex = allDebts.findIndex(d => d.id === this.highlightDebtId);
      if (debtIndex !== -1) {
        this.currentPage = Math.floor(debtIndex / this.pageSize) + 1;
      }
    }

    // Merge debts and groups, sorted by date (newest first)
    const allItems = [
      ...allDebts.map(d => ({ ...d, _sortDate: d.date, _isGroup: false })),
      ...groups.map(g => ({ ...g, _sortDate: g.dateTo, _isGroup: true }))
    ];
    allItems.sort((a, b) => new Date(b._sortDate) - new Date(a._sortDate));

    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / this.pageSize);
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const items = allItems.slice(startIndex, startIndex + this.pageSize);
    const debts = items.filter(i => !i._isGroup);
    const pageGroups = items.filter(i => i._isGroup);

    if (totalItems === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-8 text-wabi-text-secondary">
          <i class="fa-solid fa-receipt text-4xl mb-3"></i>
          <p>目前沒有${this.currentFilter === 'unsettled' ? '未結清的' : this.currentFilter === 'settled' ? '已結清的' : ''}欠款記錄</p>
        </div>
      `;
      return;
    }

    // Render debts
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
      const isHighlighted = this.highlightDebtId === debt.id;
      
      return `
        <div id="debt-item-${debt.id}" class="bg-wabi-surface rounded-lg border ${isHighlighted ? 'border-wabi-primary ring-2 ring-wabi-primary/20' : 'border-wabi-border'} p-4 ${debt.settled ? 'opacity-60' : ''}" data-debt-id="${debt.id}">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="contact-avatar flex items-center justify-center rounded-full ${isReceivable ? 'bg-wabi-income/20 text-wabi-income ring-2 ring-wabi-income' : 'bg-wabi-expense/20 text-wabi-expense ring-2 ring-wabi-expense'} size-10 overflow-hidden" data-avatar-id="${contact?.avatarFileId || ''}">
                <i class="fa-solid fa-user"></i>
              </div>
              <div>
                <p class="font-medium text-wabi-text-primary">${escapeHTML(contactName)}</p>
                <p class="text-sm text-wabi-text-secondary">${isReceivable ? '應收' : '應付'}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${isReceivable ? '+' : '-'}${formatCurrency(remainingAmount)}</p>
              ${hasPartialPayments ? `<p class="text-xs text-wabi-text-secondary line-through">${formatCurrency(originalAmount)}</p>` : ''}
              <p class="text-xs text-wabi-text-secondary">${formatDate(debt.date, 'short')}</p>
            </div>
          </div>
          ${debt.description ? `<p class="text-sm text-wabi-text-secondary mt-2 pl-13">${escapeHTML(debt.description)}</p>` : ''}
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
              <button class="settle-debt-btn flex-1 py-2 text-sm font-medium text-wabi-surface bg-wabi-primary rounded-lg" data-id="${debt.id}">
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
                <span>已於 ${formatDate(formatDateToString(new Date(debt.settledAt)), 'short')} 結清</span>
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

    // Render group cards (inserted at their sorted positions)
    // Rebuild the full sorted HTML by interleaving debts and groups
    let fullHtml = '';
    let debtIdx;
    let groupIdx;
    const sortedDebtIds = new Set(debts.map(d => d.id));
    const sortedGroupIds = new Set(pageGroups.map(g => g.id));
    const debtHtmlMap = {};
    // Re-render debts individually for interleaving
    debts.forEach(debt => {
      const contact = contacts.find(c => c.id === debt.contactId);
      const contactName = contact?.name || '未知聯絡人';
      const isReceivable = debt.type === 'receivable';
      const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
      const originalAmount = debt.originalAmount ?? debt.amount ?? remainingAmount;
      const paidAmount = originalAmount - remainingAmount;
      const progressPercent = originalAmount > 0 ? ((paidAmount / originalAmount) * 100).toFixed(0) : 0;
      const hasPartialPayments = paidAmount > 0 && remainingAmount > 0;
      const hasPaymentHistory = debt.payments && debt.payments.length > 0;
      const isHighlighted = this.highlightDebtId === debt.id;
      
      const record = debt.recordId ? recordsMap.get(debt.recordId) : null;
      const catId = record?.category || debt.category || debt.description;
      const recType = record?.type || (debt.type === 'receivable' ? 'expense' : 'income');
      const categoryObj = catId ? (getCategoryById(recType, catId) || getCategoryById(recType === 'expense' ? 'income' : 'expense', catId)) : null;
      const hasCustomDescription = debt.description && debt.description !== catId && (!categoryObj || debt.description !== categoryObj.id);

      debtHtmlMap[debt.id] = `
        <div id="debt-item-${debt.id}" class="bg-wabi-surface rounded-lg border ${isHighlighted ? 'border-wabi-primary ring-2 ring-wabi-primary/20' : 'border-wabi-border'} p-4 ${debt.settled ? 'opacity-60' : ''}" data-debt-id="${debt.id}">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="contact-avatar flex items-center justify-center rounded-full ${isReceivable ? 'bg-wabi-income/20 text-wabi-income ring-2 ring-wabi-income' : 'bg-wabi-expense/20 text-wabi-expense ring-2 ring-wabi-expense'} size-10 overflow-hidden" data-avatar-id="${contact?.avatarFileId || ''}">
                <i class="fa-solid fa-user"></i>
              </div>
              <div>
                <p class="font-medium text-wabi-text-primary">${escapeHTML(contactName)}</p>
                <div class="flex items-center gap-2 mt-0.5">
                  <p class="text-sm text-wabi-text-secondary">${isReceivable ? '應收' : '應付'}</p>
                  ${categoryObj ? `
                    <span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-wabi-bg border border-wabi-border text-wabi-text-primary font-medium">
                      <i class="${categoryObj.icon} text-[10px]"></i>
                      <span>${escapeHTML(categoryObj.name)}</span>
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="text-right">
              <p class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${isReceivable ? '+' : '-'}${formatCurrency(remainingAmount)}</p>
              ${hasPartialPayments ? `<p class="text-xs text-wabi-text-secondary line-through">${formatCurrency(originalAmount)}</p>` : ''}
              <p class="text-xs text-wabi-text-secondary">${formatDate(debt.date, 'short')}</p>
            </div>
          </div>
          ${hasCustomDescription ? `<p class="text-sm text-wabi-text-secondary mt-2 pl-13">${escapeHTML(debt.description)}</p>` : ''}
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
              <button class="settle-debt-btn flex-1 py-2 text-sm font-medium text-wabi-surface bg-wabi-primary rounded-lg" data-id="${debt.id}">
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
                <span>已於 ${formatDate(formatDateToString(new Date(debt.settledAt)), 'short')} 結清</span>
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
    });

    // Build group card HTML
    const groupCardHtml = (group) => {
      const netClass = group.netAmount > 0 ? 'text-wabi-income' : group.netAmount < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary';
      const isGroupHighlighted = this.highlightGroupId === group.id;
      return `
        <div class="group-card bg-wabi-surface rounded-lg border p-4 ${group.settled ? 'opacity-60' : ''} ${isGroupHighlighted ? 'border-emerald-600 ring-2 ring-emerald-600/20' : 'border-emerald-500/30'}" data-group-id="${group.id}">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="flex items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500 size-10 shrink-0">
                <i class="fa-solid fa-layer-group"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 min-w-0">
                  <p class="font-medium text-wabi-text-primary truncate">${escapeHTML(group.name)}</p>
                  <span class="text-xs text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">群組</span>
                </div>
                <p class="text-sm text-wabi-text-secondary mt-0.5 truncate">${group.recordCount}筆明細 · ${formatDate(group.dateFrom, 'short')} ~ ${formatDate(group.dateTo, 'short')}</p>
              </div>
            </div>
            <div class="text-right shrink-0">
              <p class="font-bold ${netClass}">${group.netAmount > 0 ? '+' : group.netAmount < 0 ? '-' : ''}${formatCurrency(Math.abs(group.netAmount))}</p>
              <p class="text-xs text-wabi-text-secondary">支 ${formatCurrency(group.totalExpense)} ｜ 收 ${formatCurrency(group.totalIncome)}</p>
            </div>
          </div>
          ${!group.settled ? `
            <div class="flex gap-2 mt-3 pt-3 border-t border-wabi-border">
              <button class="settle-group-btn flex-1 py-2 text-sm font-medium text-wabi-surface bg-emerald-600 rounded-lg" data-id="${group.id}">
                一鍵結清
              </button>
              <button class="partial-settle-group-btn px-4 py-2 text-sm font-medium text-emerald-600 border border-emerald-600 rounded-lg" data-id="${group.id}">
                ${group.netAmount > 0 ? '部分收款' : group.netAmount < 0 ? '部分付款' : '部分結清'}
              </button>
              <button class="view-group-records-btn px-4 py-2 text-sm font-medium text-wabi-primary border border-wabi-primary rounded-lg" data-id="${group.id}">
                查看明細
              </button>
            </div>
          ` : `
            <div class="flex items-center gap-2 mt-3 pt-3 border-t border-wabi-border text-sm text-wabi-text-secondary">
              <i class="fa-solid fa-check-circle text-wabi-income"></i>
              <span>已於 ${group.settledAt ? formatDate(new Date(group.settledAt), 'short') : '未知'} 結清</span>
            </div>
          `}
        </div>
      `;
    };

    // Interleave debts and groups by sorted order
    const debtHtmlList = [];
    const groupHtmlList = [];
    debts.forEach(d => debtHtmlList.push({ ...d, _sortDate: d.date }));
    pageGroups.forEach(g => groupHtmlList.push({ ...g, _sortDate: g.dateTo }));
    const merged = [...debtHtmlList, ...groupHtmlList].sort((a, b) => new Date(b._sortDate) - new Date(a._sortDate));
    
    fullHtml = merged.map(item => {
      if (item._isGroup) {
        return groupCardHtml(item);
      } else {
        return debtHtmlMap[item.id] || '';
      }
    }).join('');

    // Use fullHtml instead of html
    html = fullHtml;

    // Add pagination controls
    if (totalPages > 1) {
      html += `
        <div class="flex items-center justify-center gap-4 mt-4 py-3">
          <button id="prev-page-btn" class="px-4 py-2 text-sm font-medium rounded-lg ${this.currentPage === 1 ? 'bg-wabi-bg text-wabi-text-secondary cursor-not-allowed' : 'bg-wabi-primary text-wabi-surface'}" ${this.currentPage === 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-left mr-1"></i>上一頁
          </button>
          <span class="text-sm text-wabi-text-secondary">${this.currentPage} / ${totalPages}</span>
          <button id="next-page-btn" class="px-4 py-2 text-sm font-medium rounded-lg ${this.currentPage === totalPages ? 'bg-wabi-bg text-wabi-text-secondary cursor-not-allowed' : 'bg-wabi-primary text-wabi-surface'}" ${this.currentPage === totalPages ? 'disabled' : ''}>
            下一頁<i class="fa-solid fa-chevron-right ml-1"></i>
          </button>
        </div>
      `;
    }

    listContainer.innerHTML = html;

    // 非同步載入聯絡人頭像
    this.loadContactAvatars();

    // Bind settle buttons
    listContainer.querySelectorAll('.settle-debt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const debtId = parseInt(btn.dataset.id);
        const debt = await this.dataService.getDebt(debtId);
        if (!debt) return;

        const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
        const isAdvancedMode = !!advancedModeSetting?.value;

        let hasAssociatedAccount = false;
        if (debt.recordId) {
          const mainRecord = await this.dataService.getRecord(debt.recordId);
          if (mainRecord && mainRecord.accountId) {
            hasAssociatedAccount = true;
          }
        }

        if (isAdvancedMode && !hasAssociatedAccount) {
          // Guide user to select account
          await this.showSettleDebtModal(debtId);
        } else {
          // Standard confirmation
          if (await customConfirm('確定要標記此欠款為全額結清嗎？系統將自動產生對應的收支記錄。')) {
            await this.dataService.settleDebt(debtId);
            showToast('已結清欠款並產生記帳紀錄', 'success');
            await this.updateSummaryCards();
            await this.loadDebtList();
          }
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
        
        if (await customConfirm('確定要刪除此欠款記錄嗎？')) {
          const recordId = debt?.recordId;
          await this.dataService.deleteDebt(debtId);
          
          if (recordId) {
              if (await customConfirm('此欠款有關聯的記帳紀錄，是否也要一併刪除該紀錄？')) {
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

    // Bind view group records buttons
    listContainer.querySelectorAll('.view-group-records-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = btn.dataset.id;
        await this.showGroupDetailsModal(groupId);
      });
    });

    // Bind group card click to view details modal
    listContainer.querySelectorAll('.group-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;
        const groupId = card.dataset.groupId;
        if (groupId) {
          await this.showGroupDetailsModal(groupId);
        }
      });
    });

    // Bind settle group buttons
    listContainer.querySelectorAll('.settle-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = btn.dataset.id;
        await this.showSettleGroupModal(groupId);
      });
    });

    // Bind partial settle group buttons
    listContainer.querySelectorAll('.partial-settle-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = btn.dataset.id;
        await this.showPartialSettleGroupModal(groupId);
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

    if (this.highlightDebtId) {
      const targetId = this.highlightDebtId;
      setTimeout(() => {
        const el = this.container.querySelector(`#debt-item-${targetId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
      this.highlightDebtId = null; // Clear to prevent repeated scrolls
    }

    if (this.highlightGroupId) {
      const targetId = this.highlightGroupId;
      setTimeout(() => {
        const el = this.container.querySelector(`.group-card[data-group-id="${targetId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
      this.highlightGroupId = null; // Clear to prevent repeated scrolls
    }
  }

  async showPartialPaymentModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '未知聯絡人';
    const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
    const isReceivable = debt.type === 'receivable';

    const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
    const isAdvancedMode = !!advancedModeSetting?.value;
    let accounts = [];
    let defaultAccountId = null;

    if (isAdvancedMode) {
      accounts = await this.dataService.getAccounts();
      if (debt.recordId) {
        const mainRecord = await this.dataService.getRecord(debt.recordId);
        if (mainRecord && mainRecord.accountId) {
          defaultAccountId = mainRecord.accountId;
        }
      }
      if (!defaultAccountId && accounts.length > 0) {
        defaultAccountId = accounts[0].id;
      }
    }

    const modal = document.createElement('div');
    modal.id = 'partial-payment-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">部分${isReceivable ? '收款' : '還款'}</h3>
        <p class="text-sm text-wabi-text-secondary mb-4">${escapeHTML(contactName)} - ${escapeHTML(debt.description || '無備註')}</p>
        <p class="text-sm text-wabi-text-secondary mb-2">剩餘金額：<span class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${formatCurrency(remainingAmount)}</span></p>
        
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${isReceivable ? '收款' : '還款'}金額</label>
          <input type="number" id="partial-amount" value="" min="1" max="${remainingAmount}" step="1" placeholder="輸入金額"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        ${isAdvancedMode ? `
        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${isReceivable ? '入帳' : '出帳'}帳戶</label>
          <select id="partial-account-select" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
          </select>
          <p class="text-xs text-wabi-text-secondary mt-1">還款將建立「${isReceivable ? '欠款回收' : '還款'}」明細並調整此帳戶餘額；若與欠款紀錄帳戶不同，亦會據此維持帳款平衡。</p>
        </div>
        ` : ''}

        <div class="flex space-x-3">
          <button id="confirm-partial-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
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
      const btn = modal.querySelector('#confirm-partial-btn');
      if (btn.disabled) return;
      const originalText = btn.textContent.trim();
      btn.disabled = true;
      btn.textContent = '處理中...';
      btn.style.opacity = '0.6';

      const amount = parseFloat(modal.querySelector('#partial-amount').value);

      if (!amount || amount <= 0) {
        customAlert('請輸入有效金額');
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
        return;
      }

      if (amount > remainingAmount) {
        customAlert(`金額不能超過剩餘金額 ${formatCurrency(remainingAmount)}`);
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
        return;
      }

      const accountSelect = modal.querySelector('#partial-account-select');
      const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;

      try {
        await this.dataService.addPartialPayment(debtId, amount, {
          accountId: selectedAccountId,
        });
        closeModal();
        // Maintain current filter state instead of full re-render
        await this.updateSummaryCards();
        await this.loadDebtList();
      } catch (e) {
        console.error('Failed to add partial payment:', e);
        customAlert('操作失敗，請稍後再試');
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
      }
    });
  }

  async showSettleDebtModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    if (!debt) return;
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '未知聯絡人';
    const remainingAmount = debt.remainingAmount ?? debt.originalAmount ?? debt.amount ?? 0;
    const isReceivable = debt.type === 'receivable';

    const accounts = await this.dataService.getAccounts();
    const defaultAccountId = accounts.length > 0 ? accounts[0].id : null;

    const modal = document.createElement('div');
    modal.id = 'settle-debt-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">
          <i class="fa-solid fa-handshake mr-2"></i>全額結清
        </h3>
        <p class="text-sm text-wabi-text-secondary mb-2">${escapeHTML(contactName)} - ${escapeHTML(debt.description || '無備註')}</p>
        <p class="text-sm text-wabi-text-secondary mb-4">
          結清金額：<span class="font-bold ${isReceivable ? 'text-wabi-income' : 'text-wabi-expense'}">${formatCurrency(remainingAmount)}</span>
        </p>

        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${isReceivable ? '入帳' : '出帳'}帳戶</label>
          <select id="settle-account-select" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
          </select>
          <p class="text-xs text-wabi-text-secondary mt-1">結清將建立「${isReceivable ? '欠款回收' : '還款'}」明細並調整此帳戶餘額；若與欠款紀錄帳戶不同，亦會據此維持帳款平衡。</p>
        </div>

        <div class="flex space-x-3">
          <button id="confirm-settle-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
            確認
          </button>
          <button id="cancel-settle-btn" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">
            取消
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    modal.querySelector('#cancel-settle-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector('#confirm-settle-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('#confirm-settle-btn');
      if (btn.disabled) return;
      const originalText = btn.textContent.trim();
      btn.disabled = true;
      btn.textContent = '處理中...';
      btn.style.opacity = '0.6';

      const accountSelect = modal.querySelector('#settle-account-select');
      const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;

      try {
        await this.dataService.settleDebt(debtId, null, {
          accountId: selectedAccountId,
        });
        closeModal();
        showToast('已結清欠款並產生記帳紀錄', 'success');
        await this.updateSummaryCards();
        await this.loadDebtList();
      } catch (e) {
        console.error('Failed to settle debt:', e);
        customAlert('結清失敗，請稍後再試');
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
      }
    });
  }

  async showPaymentHistoryModal(debtId) {
    const debt = await this.dataService.getDebt(debtId);
    const contact = await this.dataService.getContact(debt.contactId);
    const contactName = contact?.name || '未知聯絡人';
    const isReceivable = debt.type === 'receivable';
    const payments = debt.payments || [];
    const originalRecordId = debt.recordId || null;

    const modal = document.createElement('div');
    modal.id = 'payment-history-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    const originalRecordHtml = originalRecordId ? `
      <div class="flex items-center justify-between p-3 bg-wabi-primary/10 rounded-lg border border-wabi-primary/30 debt-record-link cursor-pointer hover:bg-wabi-primary/20 transition-colors" data-record-id="${originalRecordId}">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center rounded-full bg-wabi-primary/20 text-wabi-primary size-8 text-sm">
            <i class="fa-solid fa-file-invoice-dollar"></i>
          </div>
          <div>
            <p class="font-medium text-wabi-primary">原始欠款明細</p>
            <p class="text-xs text-wabi-text-secondary">${formatDate(debt.date, 'short')}</p>
          </div>
        </div>
        <span class="text-xs text-wabi-primary flex items-center gap-1">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> 檢視
        </span>
      </div>
    ` : '';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6 max-h-[80vh] overflow-y-auto">
        <h3 class="text-lg font-semibold mb-2 text-wabi-primary">${isReceivable ? '收款' : '還款'}歷程</h3>
        <p class="text-sm text-wabi-text-secondary mb-4">${escapeHTML(contactName)} - ${escapeHTML(debt.description || '無備註')}</p>

        <div class="space-y-3 mb-4">
          ${originalRecordHtml}
          ${payments.length === 0 ? `
            <p class="text-center py-4 text-wabi-text-secondary">尚無還款記錄</p>
          ` : payments.map((payment, index) => {
            const hasRecord = !!payment.recordId;
            const clickableClass = hasRecord
              ? 'debt-record-link cursor-pointer hover:bg-wabi-border/60 transition-colors'
              : '';
            return `
              <div class="flex items-center justify-between p-3 bg-wabi-surface rounded-lg border border-wabi-border ${clickableClass}" ${hasRecord ? `data-record-id="${payment.recordId}"` : ''}>
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
                ${hasRecord ? `
                  <span class="text-xs text-wabi-primary flex items-center gap-1">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> 檢視
                  </span>
                ` : ''}
              </div>
            `;
          }).join('')}
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

    // 點擊明細跳轉到對應的記帳紀錄
    modal.querySelectorAll('.debt-record-link').forEach(el => {
      el.addEventListener('click', () => {
        const recordId = el.dataset.recordId;
        if (recordId) {
          window.location.hash = `#add?id=${recordId}`;
          closeModal();
        }
      });
    });
  }

  async showAddDebtModal(debtToEdit = null) {
    const isEdit = !!debtToEdit;
    const contacts = await this.dataService.getContacts();

    if (contacts.length === 0) {
      customAlert('請先新增聯絡人');
      window.location.hash = '#contacts';
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'add-debt-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    const contactOptions = contacts.map(c => 
      `<option value="${c.id}" ${debtToEdit?.contactId === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
    ).join('');

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">${isEdit ? '編輯欠款' : '新增欠款記錄'}</h3>
        
        <!-- Type Selector -->
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">類型</label>
          <div class="flex h-10 w-full items-center justify-center rounded-lg bg-wabi-bg/50 p-1">
            <button id="debt-type-receivable" class="debt-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${(!isEdit || debtToEdit?.type === 'receivable') ? 'bg-wabi-income text-wabi-surface' : 'text-wabi-text-secondary'}">應收款項</button>
            <button id="debt-type-payable" class="debt-type-btn flex-1 h-full rounded-md px-3 py-1 text-sm font-medium ${(isEdit && debtToEdit?.type === 'payable') ? 'bg-wabi-expense text-wabi-surface' : 'text-wabi-text-secondary'}">應付款項</button>
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
          <button id="save-debt-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
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
          b.classList.remove('bg-wabi-income', 'bg-wabi-expense', 'text-wabi-surface');
          b.classList.add('text-wabi-text-secondary');
        });
        if (selectedType === 'receivable') {
          btn.classList.add('bg-wabi-income', 'text-wabi-surface');
        } else {
          btn.classList.add('bg-wabi-expense', 'text-wabi-surface');
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
        customAlert('請填寫完整資料');
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
      message = `嗨 ${escapeHTML(contactName)}，提醒一下之前${debt.date}${debt.description ? `「${escapeHTML(debt.description)}」` : ''}的 ${formatCurrency(remainingAmount)} 還沒收到喔！方便的話再麻煩你轉給我，謝謝！`;
    } else {
      message = `嗨 ${escapeHTML(contactName)}，我還欠你${debt.date}${debt.description ? `「${escapeHTML(debt.description)}」` : ''} ${formatCurrency(remainingAmount)}，我會盡快還你的！`;
    }

    const modal = document.createElement('div');
    modal.id = 'reminder-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-wabi-primary">提醒訊息</h3>
        <textarea id="reminder-text" class="w-full h-32 p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary resize-none mb-4">${message}</textarea>
        <div class="flex space-x-3">
          <button id="copy-reminder-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
            <i class="fa-solid fa-copy mr-2"></i>複製
          </button>
          <button id="share-reminder-btn" class="flex-1 bg-wabi-income hover:bg-wabi-income/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
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
        customAlert('訊息已複製到剪貼簿！');
        closeModal();
      } catch (err) {
        // Fallback for older browsers
        modal.querySelector('#reminder-text').select();
        document.execCommand('copy');
        customAlert('訊息已複製！');
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
            customAlert('分享失敗，請使用複製功能');
          }
        }
      } else {
        // Fallback: copy to clipboard
        try {
          await navigator.clipboard.writeText(text);
          customAlert('您的瀏覽器不支援分享功能，訊息已複製到剪貼簿！');
        } catch (err) {
          customAlert('分享功能不支援，請使用複製功能');
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
          <button id="add-contact-btn" class="bg-wabi-primary text-wabi-surface rounded-full w-8 h-8 flex items-center justify-center">
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
                <span class="font-medium text-wabi-text-primary">${escapeHTML(contact.name)}</span>
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
          customAlert('此聯絡人尚有關聯的欠款記錄，無法刪除。');
          return;
        }
        if (await customConfirm('確定要刪除此聯絡人嗎？')) {
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
                <i class="fa-solid fa-pen text-wabi-surface"></i>
              </div>
            </div>
            <input type="file" id="avatar-input" accept="image/*" class="hidden">
          </label>
        </div>
        <p class="text-xs text-center text-wabi-text-secondary mb-4">點擊上傳頭像</p>
        
        <div class="mb-6">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">名稱</label>
          <input type="text" id="contact-name" value="${escapeHTML(contactToEdit?.name || '')}" placeholder="輸入聯絡人名稱"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>

        <div class="flex space-x-3">
          <button id="save-contact-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary/90 text-wabi-surface font-bold py-3 rounded-lg transition-colors">
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
            <i class="fa-solid fa-pen text-wabi-surface"></i>
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
        customAlert('請輸入聯絡人名稱');
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

  async refreshCurrentView() {
    try {
      if (this.container && this.container.querySelector('#summary-cards-container')) {
        await this.updateSummaryCards();
      }
      if (this.container && this.container.querySelector('#debt-list-container')) {
        await this.loadDebtList();
      }

      if (window.location.hash.startsWith('#groups')) {
        const groupsPage = this.appRef?.router?.routes?.groups;
        if (groupsPage && typeof groupsPage.render === 'function') {
          await groupsPage.render();
        }
      }
    } catch (e) {
      console.warn('Failed to refresh current view:', e);
    }
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

  // Async load avatars for contact list with parallel loading and URL revoking to prevent memory leaks
  async loadContactAvatars() {
    // Revoke URLs created by a previous render so re-renders (filter/settle)
    // that happen before images load don't leak the pending object URLs
    if (this._avatarUrls) {
      this._avatarUrls.forEach((url) => URL.revokeObjectURL(url))
      this._avatarUrls.clear()
    } else {
      this._avatarUrls = new Set()
    }

    const avatarElements = this.container.querySelectorAll('.contact-avatar[data-avatar-id]');
    const promises = Array.from(avatarElements).map(async (el) => {
      const avatarId = el.dataset.avatarId;
      if (!avatarId) return;
      try {
        const file = await this.dataService.getFile(parseInt(avatarId));
        if (file && file.data) {
          const url = URL.createObjectURL(file.data);
          this._avatarUrls.add(url);
          el.innerHTML = `<img src="${url}" class="w-full h-full object-cover" style="dynamic-range-limit: standard;">`;
          const img = el.querySelector('img');
          if (img) {
            const handleRevoke = () => {
              URL.revokeObjectURL(url);
              this._avatarUrls.delete(url);
              img.removeEventListener('load', handleRevoke);
              img.removeEventListener('error', handleRevoke);
            };
            img.addEventListener('load', handleRevoke);
            img.addEventListener('error', handleRevoke);
          }
        }
      } catch (e) {
        console.warn('Failed to load avatar:', avatarId, e);
      }
    });
    await Promise.all(promises);
  }

  // ==================== Group Settlement Methods ====================

  async showSettleGroupModal(groupId) {
    const groupMeta = await this.dataService.getGroupMeta(groupId);
    if (!groupMeta) return;
    const groupRecords = await this.dataService.getGroupRecords(groupId);
    const { netAmount, totalExpense, totalIncome } = this.dataService._calculateGroupNet(groupRecords);
    // netAmount > 0: 群組欠我 (应收/代墊支出多) → 結清產生收入
    // netAmount < 0: 我欠群組 (應付/收入多) → 結清產生支出
    const netDirection = netAmount > 0 ? `${escapeHTML(groupMeta.name)}欠我` : netAmount < 0 ? `我欠${escapeHTML(groupMeta.name)}` : '已平衡';

    const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
    const isAdvancedMode = !!advancedModeSetting?.value;
    let accounts = [];
    let defaultAccountId = null;
    if (isAdvancedMode) {
      accounts = await this.dataService.getAccounts();
      if (accounts.length > 0) defaultAccountId = accounts[0].id;
    }

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-emerald-600">
          <i class="fa-solid fa-layer-group mr-2"></i>群組一鍵結清
        </h3>
        <p class="text-sm text-wabi-text-secondary mb-2">${escapeHTML(groupMeta.name)}</p>
        <div class="bg-wabi-bg rounded-lg p-3 mb-4 space-y-1">
          <div class="flex justify-between text-sm"><span class="text-wabi-text-secondary">支出總額</span><span class="font-medium text-wabi-expense">${formatCurrency(totalExpense)}</span></div>
          <div class="flex justify-between text-sm"><span class="text-wabi-text-secondary">收入總額</span><span class="font-medium text-wabi-income">${formatCurrency(totalIncome)}</span></div>
          <div class="flex justify-between text-sm border-t border-wabi-border pt-1"><span class="text-wabi-text-secondary font-medium">淨額</span><span class="font-bold ${netAmount > 0 ? 'text-wabi-income' : netAmount < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'}">${netDirection} ${formatCurrency(Math.abs(netAmount))}</span></div>
        </div>
        ${isAdvancedMode ? `
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${netAmount > 0 ? '入帳' : '出帳'}帳戶</label>
          <select id="group-settle-account" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        <div class="flex space-x-3">
          <button id="confirm-settle-group" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors">確認結清</button>
          <button id="cancel-settle-group" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('#cancel-settle-group').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#confirm-settle-group').addEventListener('click', async () => {
      const btn = modal.querySelector('#confirm-settle-group');
      if (btn.disabled) return;
      const originalText = btn.textContent.trim();
      btn.disabled = true;
      btn.textContent = '處理中...';
      btn.style.opacity = '0.6';

      const accountSelect = modal.querySelector('#group-settle-account');
      const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;
      try {
        await this.dataService.settleGroup(groupId, netAmount, selectedAccountId, new Date().toISOString().split('T')[0], '一鍵結清');
        closeModal();
        showToast('群組已結清並產生結清紀錄', 'success');
        await this.updateSummaryCards();
        await this.loadDebtList();
      } catch (e) {
        console.error('Failed to settle group:', e);
        customAlert('結清失敗，請稍後再試');
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
      }
    });
  }

  async showPartialSettleGroupModal(groupId) {
    const groupMeta = await this.dataService.getGroupMeta(groupId);
    if (!groupMeta) return;
    const groupRecords = await this.dataService.getGroupRecords(groupId);
    const { netAmount } = await this.dataService._calculateGroupNetAsync(groupRecords);
    // netAmount > 0: 群組欠我 (應收) → 部分收款
    // netAmount < 0: 我欠群組 (應付) → 部分還/退款
    const isRefund = netAmount < 0;
    const netDirection = netAmount > 0 ? `應收 ${escapeHTML(groupMeta.name)}` : netAmount < 0 ? `應付 ${escapeHTML(groupMeta.name)}` : '已平衡';

    const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
    const isAdvancedMode = !!advancedModeSetting?.value;
    let accounts = [];
    let defaultAccountId = null;
    if (isAdvancedMode) {
      accounts = await this.dataService.getAccounts();
      if (accounts.length > 0) defaultAccountId = accounts[0].id;
    }

    const actionLabel = netAmount > 0 ? '收款' : '付款';
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-emerald-600">
          <i class="fa-solid fa-layer-group mr-2"></i>群組部分${actionLabel}
        </h3>
        <p class="text-sm text-wabi-text-secondary mb-2">${escapeHTML(groupMeta.name)}</p>
        <div class="bg-wabi-bg rounded-lg p-3 mb-4 space-y-1">
          <div class="flex justify-between text-sm"><span class="text-wabi-text-secondary">淨額方向</span><span class="font-medium">${netDirection}</span></div>
          <div class="flex justify-between text-sm"><span class="text-wabi-text-secondary">待結清</span><span class="font-bold">${formatCurrency(Math.abs(netAmount))}</span></div>
        </div>
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">${actionLabel}金額</label>
          <input type="number" id="group-partial-amount" min="1" max="${Math.abs(netAmount)}" step="1" placeholder="輸入金額"
                 class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
        </div>
        ${isAdvancedMode ? `
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">帳戶</label>
          <select id="group-partial-account" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        <div class="flex space-x-3">
          <button id="confirm-partial-settle-group" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors">確認</button>
          <button id="cancel-partial-settle-group" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('#cancel-partial-settle-group').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    setTimeout(() => modal.querySelector('#group-partial-amount').focus(), 100);

    modal.querySelector('#confirm-partial-settle-group').addEventListener('click', async () => {
      const btn = modal.querySelector('#confirm-partial-settle-group');
      if (btn.disabled) return;
      const originalText = btn.textContent.trim();
      btn.disabled = true;
      btn.textContent = '處理中...';
      btn.style.opacity = '0.6';

      const amount = parseFloat(modal.querySelector('#group-partial-amount').value);
      if (!amount || amount <= 0) { customAlert('請輸入有效金額'); btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1'; return; }
      if (amount > Math.abs(netAmount)) { customAlert(`金額不能超過淨額 ${formatCurrency(Math.abs(netAmount))}`); btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1'; return; }
      const accountSelect = modal.querySelector('#group-partial-account');
      const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;
      try {
        await this.dataService.partialSettleGroup(groupId, amount, selectedAccountId, new Date().toISOString().split('T')[0], `部分${actionLabel}`);
        closeModal();
        showToast(`部分${actionLabel}已記錄`, 'success');
        await this.refreshCurrentView();
      } catch (e) {
        console.error('Failed to partial settle group:', e);
        customAlert('操作失敗，請稍後再試');
        btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1';
      }
    });
  }

  async showGroupDetailsModal(groupId) {
    const groupMeta = await this.dataService.getGroupMeta(groupId);
    if (!groupMeta) return;

    const groupRecords = await this.dataService.getGroupRecords(groupId);
    const { netAmount, totalExpense, totalIncome } = await this.dataService._calculateGroupNetAsync(groupRecords);
    const allDebts = await this.dataService.getDebts({ allLedgers: true });
    const debtsMap = new Map(allDebts.map(d => [d.id, d]));

    const netDirection = netAmount > 0 ? `應收 ` : netAmount < 0 ? `應付 ` : '已平衡';

    const modal = document.createElement('div');
    modal.id = 'group-details-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    const recordItemsHtml = groupRecords.length === 0 ? `
      <p class="text-center py-6 text-wabi-text-secondary">此群組尚無交易明細</p>
    ` : groupRecords.map(r => {
      const cat = getCategoryById(r.type || 'expense', r.category) || { name: r.category || '未分類', icon: 'fa-regular fa-note-sticky', color: 'bg-gray-500' };
      const isSettled = r.groupStatus === 'settled';
      const isIncome = r.type === 'income';
      const isHexColor = cat.color && cat.color.startsWith('#');
      const colorStyle = isHexColor ? `style="background-color: ${cat.color};"` : '';
      const colorClass = isHexColor ? '' : (cat.color || 'bg-gray-500');

      // 判定是否有實際欠款 & 債務方向標籤 (專業用語)
      let hasDebt = false;
      let debtTagHtml = '';

      if (r.debtId && debtsMap.has(r.debtId)) {
        hasDebt = true;
        const debt = debtsMap.get(r.debtId);
        if (debt.type === 'receivable') {
          const label = isIncome ? '待收收入' : '墊付款 (應收)';
          debtTagHtml = `<span class="text-[10px] whitespace-nowrap bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20 shrink-0">${label}</span>`;
        } else {
          const label = isIncome ? '預收款項 (應付)' : '他人代墊 (應付)';
          debtTagHtml = `<span class="text-[10px] whitespace-nowrap bg-rose-500/10 text-rose-600 px-1.5 py-0.5 rounded font-medium border border-rose-500/20 shrink-0">${label}</span>`;
        }
      } else if (r.groupStatus === 'active' || r.isDebt) {
        hasDebt = true;
        if (isIncome) {
          debtTagHtml = `<span class="text-[10px] whitespace-nowrap bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20 shrink-0">待收收入</span>`;
        } else {
          debtTagHtml = `<span class="text-[10px] whitespace-nowrap bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20 shrink-0">墊付款 (應收)</span>`;
        }
      } else {
        debtTagHtml = `<span class="text-[10px] whitespace-nowrap bg-wabi-text-secondary/10 text-wabi-text-secondary/70 px-1.5 py-0.5 rounded font-normal border border-wabi-border/60 shrink-0">一般消費</span>`;
      }

      return `
        <div class="flex items-center justify-between p-3 bg-wabi-surface rounded-xl border border-wabi-border gap-2">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="flex items-center justify-center rounded-full size-9 shrink-0 text-white text-sm ${colorClass}" ${colorStyle}>
              <i class="${cat.icon || 'fa-solid fa-receipt'}"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                <p class="font-medium text-wabi-text-primary text-sm truncate max-w-[130px] sm:max-w-[180px]">${escapeHTML(r.description || cat.name)}</p>
                ${debtTagHtml}
                ${isSettled ? `<span class="text-[10px] whitespace-nowrap bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium shrink-0">已結清</span>` : ''}
              </div>
              <p class="text-xs text-wabi-text-secondary mt-0.5 truncate">${formatDate(r.date, 'short')} · ${cat.name}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 ml-1">
            <div class="text-right">
              <p class="font-bold text-sm whitespace-nowrap ${isIncome ? 'text-wabi-income' : 'text-wabi-expense'}">
                ${isIncome ? '+' : '-'}${formatCurrency(r.amount)}
              </p>
            </div>
            ${!isSettled && hasDebt ? `
              <button class="settle-record-btn px-2.5 py-1 text-xs font-medium text-emerald-600 border border-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors whitespace-nowrap shrink-0" data-record-id="${r.id}">
                個別還
              </button>
            ` : !isSettled && !hasDebt ? `
              <button disabled class="px-2.5 py-1 text-xs font-medium text-wabi-text-secondary/40 border border-wabi-border bg-wabi-surface/50 rounded-lg cursor-not-allowed opacity-50 whitespace-nowrap shrink-0" title="此項目非待結算欠款，無需還款">
                個別還
              </button>
            ` : ''}
            ${isSettled ? `
              <button class="unsettle-record-btn px-2.5 py-1 text-xs font-medium text-amber-600 border border-amber-600 rounded-lg hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0" data-record-id="${r.id}">
                還原
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-2xl max-w-lg w-full p-4 sm:p-6 max-h-[88vh] flex flex-col shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-wabi-border mb-3">
          <div>
            <h3 class="text-lg font-bold text-wabi-primary flex items-center gap-2">
              <i class="fa-solid fa-layer-group text-emerald-600"></i>
              ${escapeHTML(groupMeta.name)}
            </h3>
            <p class="text-xs text-wabi-text-secondary mt-0.5">群組明細細部內容 (${groupRecords.length} 筆)</p>
          </div>
          <button id="close-group-details" class="text-wabi-text-secondary hover:text-wabi-primary p-1">
            <i class="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div class="bg-wabi-surface rounded-xl p-3.5 mb-3 border border-wabi-border space-y-1.5 shadow-sm">
          <div class="flex justify-between items-baseline gap-2">
            <span class="text-xs text-wabi-text-secondary font-medium shrink-0">待結清淨額</span>
            <span class="font-bold text-sm sm:text-base ${netAmount > 0 ? 'text-wabi-income' : netAmount < 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary'} truncate text-right">${netDirection} ${formatCurrency(Math.abs(netAmount))}</span>
          </div>
          <div class="flex justify-between items-center text-xs text-wabi-text-secondary pt-1.5 border-t border-wabi-border/50">
            <span>總支出: <strong class="text-wabi-expense font-semibold">${formatCurrency(totalExpense)}</strong></span>
            <span>總收入: <strong class="text-wabi-income font-semibold">${formatCurrency(totalIncome)}</strong></span>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto space-y-2 pr-1 mb-4">
          ${recordItemsHtml}
        </div>

        <div class="pt-3 border-t border-wabi-border flex gap-2">
          ${!groupMeta.settled ? `
            <button id="modal-settle-group-btn" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors shadow-sm whitespace-nowrap">
              一鍵結清整組
            </button>
            <button id="modal-partial-settle-btn" class="px-3 sm:px-4 py-2.5 border border-emerald-600 text-emerald-600 font-medium text-xs sm:text-sm rounded-xl hover:bg-emerald-50 transition-colors whitespace-nowrap shrink-0">
              ${netAmount > 0 ? '部分收款' : netAmount < 0 ? '部分付款' : '部分結清'}
            </button>
          ` : `
            <div class="flex-1 text-center py-2 text-xs sm:text-sm text-wabi-income font-medium bg-wabi-income/10 rounded-xl flex items-center justify-center">
              <i class="fa-solid fa-check-circle mr-1"></i>此群組已全部結清
            </div>
            <button id="modal-unsettle-group-btn" class="px-3 sm:px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs sm:text-sm rounded-xl transition-colors whitespace-nowrap shrink-0">
              還原全組
            </button>
          `}
          <button id="modal-close-group-btn" class="px-4 sm:px-5 py-2.5 bg-wabi-surface text-wabi-text-secondary hover:bg-wabi-bg border border-wabi-border text-xs sm:text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0">
            關閉
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#close-group-details').addEventListener('click', closeModal);
    modal.querySelector('#modal-close-group-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelectorAll('.settle-record-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const recordId = parseInt(btn.dataset.recordId) || btn.dataset.recordId;
        await this.showSettleGroupRecordModal(recordId, groupId, modal);
      });
    });

    modal.querySelectorAll('.unsettle-record-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const recordId = parseInt(btn.dataset.recordId) || btn.dataset.recordId;
        const targetRec = groupRecords.find(r => r.id === recordId);
        if (targetRec) {
          if (targetRec.debtId) {
            const allRecords = await this.dataService.getRecords({ allLedgers: true });
            const debtRepayments = allRecords.filter(r => String(r.debtId) === String(targetRec.debtId) && (r.category === 'debt_repayment' || r.category === 'debt_collection'));
            for (const repRec of debtRepayments) {
              await this.dataService.deleteRecord(repRec.id);
            }
          }
          await this.dataService.updateRecord(targetRec.id, { groupStatus: 'active' });
          await this.dataService.recalculateGroupState(groupId);
          if (typeof showToast === 'function') showToast('已還原該筆明細之結清狀態');
          closeModal();
          await this.refreshCurrentView();
          await this.showGroupDetailsModal(groupId);
        }
      });
    });

    modal.querySelector('#modal-settle-group-btn')?.addEventListener('click', async () => {
      closeModal();
      await this.showSettleGroupModal(groupId);
    });

    modal.querySelector('#modal-partial-settle-btn')?.addEventListener('click', async () => {
      closeModal();
      await this.showPartialSettleGroupModal(groupId);
    });

    modal.querySelector('#modal-unsettle-group-btn')?.addEventListener('click', async () => {
      for (const r of groupRecords) {
        if (r.debtId) {
          const allRecords = await this.dataService.getRecords({ allLedgers: true });
          const debtRepayments = allRecords.filter(rec => String(rec.debtId) === String(r.debtId) && (rec.category === 'debt_repayment' || rec.category === 'debt_collection'));
          for (const repRec of debtRepayments) {
            await this.dataService.deleteRecord(repRec.id);
          }
        }
        await this.dataService.updateRecord(r.id, { groupStatus: 'active' });
      }
      await this.dataService.recalculateGroupState(groupId);
      if (typeof showToast === 'function') showToast('已還原全組結清狀態');
      closeModal();
      await this.refreshCurrentView();
      await this.showGroupDetailsModal(groupId);
    });
  }

  async showSettleGroupRecordModal(recordId, groupId, parentModal = null) {
    const records = await this.dataService.getRecords({ allLedgers: true });
    const record = records.find(r => r.id === recordId);
    if (!record) return;

    const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
    const isAdvancedMode = !!advancedModeSetting?.value;
    let accounts = [];
    let defaultAccountId = null;
    if (isAdvancedMode) {
      accounts = await this.dataService.getAccounts();
      if (accounts.length > 0) defaultAccountId = accounts[0].id;
    }

    const isExpense = record.type === 'expense';
    const actionText = isExpense ? '收回款項 (入帳)' : '退還款項 (出帳)';

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
        <h3 class="text-lg font-semibold mb-3 text-emerald-600">
          <i class="fa-solid fa-handshake mr-2"></i>單筆明細個別還款
        </h3>
        <div class="bg-wabi-surface p-3 rounded-lg border border-wabi-border mb-4">
          <p class="font-medium text-wabi-text-primary text-sm">${escapeHTML(record.description || '單筆紀錄')}</p>
          <p class="text-xs text-wabi-text-secondary mt-1">${formatDate(record.date, 'short')} · 金額：<span class="font-bold ${isExpense ? 'text-wabi-expense' : 'text-wabi-income'}">${formatCurrency(record.amount)}</span></p>
        </div>
        <p class="text-xs text-wabi-text-secondary mb-4">這將建立一筆「${actionText}」沖銷紀錄，並標記此明細為已結清。</p>
        ${isAdvancedMode ? `
        <div class="mb-4">
          <label class="text-sm font-medium text-wabi-text-primary mb-2 block">結清帳戶</label>
          <select id="record-settle-account" class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary">
            ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === defaultAccountId ? 'selected' : ''}>${escapeHTML(acc.name)}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        <div class="flex space-x-3">
          <button id="confirm-settle-record" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors">確認還款</button>
          <button id="cancel-settle-record" class="px-6 bg-wabi-border hover:bg-wabi-border text-wabi-text-primary py-3 rounded-lg transition-colors">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('#cancel-settle-record').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#confirm-settle-record').addEventListener('click', async () => {
      const accountSelect = modal.querySelector('#record-settle-account');
      const selectedAccountId = accountSelect ? parseInt(accountSelect.value) : null;
      try {
        await this.dataService.settleGroupRecord(recordId, selectedAccountId);
        closeModal();
        if (parentModal) parentModal.remove();
        showToast('該筆明細已完成個別還款並產生結清紀錄', 'success');

        await this.refreshCurrentView();
        await this.showGroupDetailsModal(groupId);
      } catch (e) {
        console.error('Failed to settle group record:', e);
        customAlert('個別還款失敗，請稍後再試');
      }
    });
  }
}

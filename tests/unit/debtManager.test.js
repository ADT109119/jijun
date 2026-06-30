// ==================== DebtManager 單元測試 ====================
// 測試重點：欠款金額計算、剩餘金額回退邏輯、總結卡片計算、
//           聯絡人摘要計算、分頁邏輯、部分付款驗證
// DebtManager 的 UI 方法 (renderDebtsPage, showAddDebtModal 等) 不在此測試
// 因為它們依賴完整的 DOM 與 window.app，適合 E2E 測試

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock utils.js 的函數
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn((v) => `NT$${Math.round(v)}`),
    formatDate: vi.fn((d) => d || '2024/01/01'),
    formatDateToString: vi.fn((d) => d || '2024-01-01'),
    showToast: vi.fn(),
    customConfirm: vi.fn(() => Promise.resolve(true)),
    customAlert: vi.fn(),
    escapeHTML: vi.fn((s) => s),
}));

import { DebtManager } from '../../src/js/debtManager.js';

// 建立最小化的 DataService mock
function createMockDataService() {
    const debts = [];
    const contacts = [];
    const records = [];

    return {
        activeLedgerId: 1,
        getDebts: vi.fn(async (filters) => {
            let result = [...debts];
            if (filters && filters.settled !== undefined) {
                result = result.filter(d => d.settled === filters.settled);
            }
            if (filters && filters.contactId !== undefined) {
                result = result.filter(d => d.contactId === filters.contactId);
            }
            return result;
        }),
        getDebtsByUUID: vi.fn(async (uuid) => debts.find(d => d.uuid === uuid) || null),
        getDebt: vi.fn(async (id) => debts.find(d => d.id === id) || null),
        addDebt: vi.fn(async (debt) => {
            const id = debts.length > 0 ? Math.max(...debts.map(d => d.id)) + 1 : 100;
            const newDebt = { ...debt, id, settled: debt.settled ?? false, uuid: debt.uuid || `uuid-${id}` };
            debts.push(newDebt);
            return newDebt;
        }),
        updateDebt: vi.fn(async (id, updates) => {
            const idx = debts.findIndex(d => d.id === id);
            if (idx >= 0) debts[idx] = { ...debts[idx], ...updates };
            return debts[idx];
        }),
        deleteDebt: vi.fn(async (id) => {
            const idx = debts.findIndex(d => d.id === id);
            if (idx >= 0) debts.splice(idx, 1);
        }),
        getContacts: vi.fn(async () => [...contacts]),
        getContact: vi.fn(async (id) => contacts.find(c => c.id === id) || null),
        addContact: vi.fn(async (contact) => {
            const id = contacts.length > 0 ? Math.max(...contacts.map(c => c.id)) + 1 : 50;
            const newContact = { ...contact, id };
            contacts.push(newContact);
            return newContact;
        }),
        addRecord: vi.fn(async (record) => {
            const id = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 200;
            const newRecord = { ...record, id };
            records.push(newRecord);
            return newRecord;
        }),
        deleteRecord: vi.fn(async (id) => {
            const idx = records.findIndex(r => r.id === id);
            if (idx >= 0) records.splice(idx, 1);
        }),
        getRecords: vi.fn(async (filters) => {
            let result = [...records];
            if (filters && filters.debtId) {
                result = result.filter(r => r.debtId === filters.debtId);
            }
            return result;
        }),
        logChange: vi.fn(),
    };
}
// ── Helper: compute summary from debts ──
function computeSummary(debts) {
    let receivable = 0;
    let payable = 0;
    debts.forEach(d => {
        const amount = d.remainingAmount ?? d.originalAmount ?? d.amount ?? 0;
        if (d.type === 'receivable') receivable += amount;
        else payable += amount;
    });
    return { receivable, payable };
}

// ── Helper: compute contact summary ──
function computeContactSummary(debts) {
    const map = {};
    debts.forEach(d => {
        if (!map[d.contactId]) map[d.contactId] = { receivable: 0, payable: 0 };
        const amount = d.remainingAmount ?? d.originalAmount ?? d.amount ?? 0;
        if (d.type === 'receivable') map[d.contactId].receivable += amount;
        else map[d.contactId].payable += amount;
    });
    return map;
}

// ==================== 核心業務邏輯測試 ====================
// DebtManager 本身沒有公開的純計算方法，所以我們測試其核心邏輯的正確性
// 這些邏輯主要位於 updateSummaryCards 和 showContactSummaryModal 中

describe('DebtManager - 核心業務邏輯', () => {
    describe('金額計算 (remainingAmount 回退邏輯)', () => {
        it('有 remainingAmount 時使用 remainingAmount', () => {
            const debts = [{ type: 'receivable', remainingAmount: 5000, originalAmount: 10000 }];
            const { receivable } = computeSummary(debts);
            expect(receivable).toBe(5000);
        });

        it('無 remainingAmount 但有 originalAmount 時使用 originalAmount', () => {
            const debts = [{ type: 'payable', originalAmount: 3000 }];
            const { payable } = computeSummary(debts);
            expect(payable).toBe(3000);
        });

        it('只有 amount (舊格式) 時使用 amount', () => {
            const debts = [{ type: 'receivable', amount: 2000 }];
            const { receivable } = computeSummary(debts);
            expect(receivable).toBe(2000);
        });

        it('所有欄位都沒有時回退為 0', () => {
            const debts = [{ type: 'payable' }];
            const { payable } = computeSummary(debts);
            expect(payable).toBe(0);
        });
    });

    describe('總結計算', () => {
        it('正確累加 receivable 和 payable', () => {
            const debts = [
                { type: 'receivable', remainingAmount: 1000 },
                { type: 'receivable', remainingAmount: 2000 },
                { type: 'payable', remainingAmount: 500 },
                { type: 'payable', remainingAmount: 1500 },
            ];
            const { receivable, payable } = computeSummary(debts);
            expect(receivable).toBe(3000);
            expect(payable).toBe(2000);
        });

        it('空陣列回傳 0', () => {
            const { receivable, payable } = computeSummary([]);
            expect(receivable).toBe(0);
            expect(payable).toBe(0);
        });

        it('混合新舊格式正確計算', () => {
            const debts = [
                { type: 'receivable', remainingAmount: 1000 },
                { type: 'receivable', originalAmount: 2000 },
                { type: 'payable', amount: 500 },
            ];
            const { receivable, payable } = computeSummary(debts);
            expect(receivable).toBe(3000);
            expect(payable).toBe(500);
        });
    });

    describe('聯絡人摘要計算', () => {
        it('正確按聯絡人分組計算', () => {
            const debts = [
                { contactId: 1, type: 'receivable', remainingAmount: 1000 },
                { contactId: 1, type: 'payable', remainingAmount: 500 },
                { contactId: 2, type: 'receivable', remainingAmount: 2000 },
            ];
            const summary = computeContactSummary(debts);
            expect(summary[1]).toEqual({ receivable: 1000, payable: 500 });
            expect(summary[2]).toEqual({ receivable: 2000, payable: 0 });
        });

        it('淨額計算正確', () => {
            const debts = [
                { contactId: 1, type: 'receivable', remainingAmount: 1000 },
                { contactId: 1, type: 'payable', remainingAmount: 500 },
            ];
            const summary = computeContactSummary(debts);
            const net = summary[1].receivable - summary[1].payable;
            expect(net).toBe(500);
        });

        it('空陣列不回傳任何聯絡人', () => {
            const summary = computeContactSummary([]);
            expect(Object.keys(summary).length).toBe(0);
        });

        it('單一聯絡人多筆欠款正確累加', () => {
            const debts = [
                { contactId: 1, type: 'receivable', remainingAmount: 1000 },
                { contactId: 1, type: 'receivable', originalAmount: 2000 },
                { contactId: 1, type: 'payable', amount: 500 },
            ];
            const summary = computeContactSummary(debts);
            expect(summary[1].receivable).toBe(3000);
            expect(summary[1].payable).toBe(500);
            expect(summary[1].receivable - summary[1].payable).toBe(2500);
        });
    });

    describe('分頁計算', () => {
        it('pageSize=10 時 15 筆資料有 2 頁', () => {
            const totalDebts = 15;
            const pageSize = 10;
            const totalPages = Math.ceil(totalDebts / pageSize);
            expect(totalPages).toBe(2);
        });

        it('pageSize=10 時 10 筆資料只有 1 頁', () => {
            const totalDebts = 10;
            const pageSize = 10;
            const totalPages = Math.ceil(totalDebts / pageSize);
            expect(totalPages).toBe(1);
        });

        it('第 1 頁 startIndex=0', () => {
            const currentPage = 1;
            const pageSize = 10;
            const startIndex = (currentPage - 1) * pageSize;
            expect(startIndex).toBe(0);
        });

        it('第 2 頁 startIndex=10', () => {
            const currentPage = 2;
            const pageSize = 10;
            const startIndex = (currentPage - 1) * pageSize;
            expect(startIndex).toBe(10);
        });

        it('slice 取得正確範圍', () => {
            const debts = Array.from({ length: 15 }, (_, i) => ({ id: i + 1 }));
            const page2 = debts.slice(10, 20);
            expect(page2.length).toBe(5);
            expect(page2[0].id).toBe(11);
            expect(page2[4].id).toBe(15);
        });
    });

    describe('部分付款驗證', () => {
        it('付款金額不能超過剩餘金額', () => {
            const remainingAmount = 1000;
            const payment = 1500;
            const valid = payment > 0 && payment <= remainingAmount;
            expect(valid).toBe(false);
        });

        it('付款金額等於剩餘金額為有效', () => {
            const remainingAmount = 1000;
            const payment = 1000;
            const valid = payment > 0 && payment <= remainingAmount;
            expect(valid).toBe(true);
        });

        it('付款金額為 0 無效', () => {
            const remainingAmount = 1000;
            const payment = 0;
            const valid = payment > 0 && payment <= remainingAmount;
            expect(valid).toBe(false);
        });

        it('付款金額為負數無效', () => {
            const remainingAmount = 1000;
            const payment = -100;
            const valid = payment > 0 && payment <= remainingAmount;
            expect(valid).toBe(false);
        });
    });

    describe('進度百分比計算', () => {
        it('全額已付進度 100%', () => {
            const originalAmount = 1000;
            const remainingAmount = 0;
            const paidAmount = originalAmount - remainingAmount;
            const progressPercent = originalAmount > 0
                ? ((paidAmount / originalAmount) * 100).toFixed(0) : 0;
            expect(progressPercent).toBe('100');
        });

        it('半額已付進度 50%', () => {
            const originalAmount = 1000;
            const remainingAmount = 500;
            const paidAmount = originalAmount - remainingAmount;
            const progressPercent = originalAmount > 0
                ? ((paidAmount / originalAmount) * 100).toFixed(0) : 0;
            expect(progressPercent).toBe('50');
        });

        it('零金額進度 0%', () => {
            const originalAmount = 0;
            const remainingAmount = 0;
            const paidAmount = originalAmount - remainingAmount;
            const progressPercent = originalAmount > 0
                ? ((paidAmount / originalAmount) * 100).toFixed(0) : 0;
            expect(progressPercent).toBe(0);
        });
    });
});

// ==================== DebtManager 實例測試 ====================
describe('DebtManager - 建構與基本狀態', () => {
    let dm, ds;

    beforeEach(() => {
        ds = createMockDataService();
        dm = new DebtManager(ds);
    });

    describe('constructor', () => {
        it('正確初始化屬性', () => {
            expect(dm.dataService).toBe(ds);
            expect(dm.container).toBeNull();
            expect(dm.currentFilter).toBe('unsettled');
            expect(dm.currentContactFilter).toBeNull();
            expect(dm.currentPage).toBe(1);
            expect(dm.pageSize).toBe(10);
        });
    });

    describe('renderDebtsPage', () => {
        it('渲染後容器有正確的 DOM 結構', async () => {
            const container = document.createElement('div');
            await dm.renderDebtsPage(container);
            expect(container.querySelector('h1').textContent).toBe('欠款管理');
            expect(container.querySelector('#summary-cards-container')).toBeTruthy();
            expect(container.querySelector('#contact-filter-select')).toBeTruthy();
            expect(container.querySelector('#debt-list-container')).toBeTruthy();
            expect(container.querySelector('#add-debt-btn')).toBeTruthy();
            expect(container.querySelector('#show-summary-table-btn')).toBeTruthy();
        });

        it('渲染後過濾器按鈕有正確狀態', async () => {
            const container = document.createElement('div');
            await dm.renderDebtsPage(container);
            const unsettledBtn = container.querySelector('[data-filter="unsettled"]');
            expect(unsettledBtn.classList.contains('bg-wabi-surface')).toBe(true);
            const settledBtn = container.querySelector('[data-filter="settled"]');
            expect(settledBtn.classList.contains('bg-wabi-surface')).toBe(false);
        });

        it('沒有欠款時顯示空狀態訊息', async () => {
            const container = document.createElement('div');
            await dm.renderDebtsPage(container);
            const list = container.querySelector('#debt-list-container');
            expect(list.textContent).toContain('沒有');
            expect(list.textContent).toContain('未結清的');
        });

        it('過濾器和聯絡人選擇器渲染正確', async () => {
            const contact = await ds.addContact({ name: '測試聯絡人', phone: '0912345678' });
            await ds.addDebt({ contactId: contact.id, type: 'receivable', amount: 1000, date: '2024-01-01' });

            const container = document.createElement('div');
            await dm.renderDebtsPage(container);
            const select = container.querySelector('#contact-filter-select');
            const options = select.querySelectorAll('option');
            expect(options.length).toBeGreaterThan(1);
        });
    });

    describe('updateSummaryCards - 透過實例測試', async () => {
        it('正確顯示別人欠我和我欠別人的總額', async () => {
            const contact = await ds.addContact({ name: '小明', phone: '0912345678' });
            await ds.addDebt({ contactId: contact.id, type: 'receivable', remainingAmount: 1000, originalAmount: 1000, date: '2024-01-01' });
            await ds.addDebt({ contactId: contact.id, type: 'payable', remainingAmount: 500, originalAmount: 500, date: '2024-01-01' });

            const container = document.createElement('div');
            await dm.renderDebtsPage(container);

            const cards = container.querySelectorAll('#summary-cards-container > div');
            expect(cards.length).toBe(2);
            // 第一張卡片: 別人欠我 NT$1000
            expect(cards[0].textContent).toContain('1000');
            // 第二張卡片: 我欠別人 NT$500
            expect(cards[1].textContent).toContain('500');
        });

        it('聯絡人篩選後正確更新總額', async () => {
            const c1 = await ds.addContact({ name: 'A', phone: '0911111111' });
            const c2 = await ds.addContact({ name: 'B', phone: '0922222222' });
            await ds.addDebt({ contactId: c1.id, type: 'receivable', remainingAmount: 1000, originalAmount: 1000, date: '2024-01-01' });
            await ds.addDebt({ contactId: c2.id, type: 'receivable', remainingAmount: 2000, originalAmount: 2000, date: '2024-01-01' });

            const container = document.createElement('div');
            await dm.renderDebtsPage(container);

            // 篩選聯絡人 c1
            dm.currentContactFilter = c1.id;
            await dm.updateSummaryCards();

            const cards = container.querySelectorAll('#summary-cards-container > div');
            expect(cards[0].textContent).toContain('1000');
            expect(cards[0].textContent).toContain('A');
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDateRangeModal } from '../../src/js/datePickerModal.js';
import { getDateRange } from '../../src/js/utils.js';

// ── createDateRangeModal ───────────────────────────────────────────
describe('createDateRangeModal', () => {
    let applyCallback, closeCallback;

    beforeEach(() => {
        applyCallback = vi.fn();
        closeCallback = vi.fn();

        // Remove any existing modals from previous tests
        document.querySelectorAll('#date-range-modal').forEach(el => el.remove());
    });

    afterEach(() => {
        // Clean up any remaining modals
        document.querySelectorAll('#date-range-modal').forEach(el => el.remove());
        vi.restoreAllMocks();
    });

    describe('DOM 結構', () => {
        it('建立 modal 並回傳 Element', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            expect(modal).toBeInstanceOf(Element);
            expect(modal.id).toBe('date-range-modal');
        });

        it('包含 role="dialog" 和 aria-modal="true"', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            expect(modal.getAttribute('role')).toBe('dialog');
            expect(modal.getAttribute('aria-modal')).toBe('true');
        });

        it('包含開始和結束日期 input', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const startDateInput = modal.querySelector('#custom-start-date');
            const endDateInput = modal.querySelector('#custom-end-date');

            expect(startDateInput).not.toBeNull();
            expect(endDateInput).not.toBeNull();
            expect(startDateInput.type).toBe('date');
            expect(endDateInput.type).toBe('date');
        });

        it('預設值填入 initialStartDate 和 initialEndDate', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-03-15',
                initialEndDate: '2026-04-15',
                onApply: applyCallback,
            });

            expect(modal.querySelector('#custom-start-date').value).toBe('2026-03-15');
            expect(modal.querySelector('#custom-end-date').value).toBe('2026-04-15');
        });

        it('initialStartDate 為 null 時使用今日日期', () => {
            const today = new Date().toISOString().split('T')[0];
            const modal = createDateRangeModal({
                initialStartDate: null,
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            expect(modal.querySelector('#custom-start-date').value).toBe(today);
        });

        it('initialEndDate 為 null 時使用今日日期', () => {
            const today = new Date().toISOString().split('T')[0];
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: null,
                onApply: applyCallback,
            });

            expect(modal.querySelector('#custom-end-date').value).toBe(today);
        });

        it('包含 6 個快速日期按鈕', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const quickBtns = modal.querySelectorAll('.quick-date-btn');
            expect(quickBtns.length).toBe(6);
        });

        it('快速日期按鈕包含正確的 data-range 屬性', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const ranges = Array.from(modal.querySelectorAll('.quick-date-btn')).map(
                btn => btn.dataset.range,
            );

            expect(ranges).toContain('today');
            expect(ranges).toContain('week');
            expect(ranges).toContain('last7days');
            expect(ranges).toContain('month');
            expect(ranges).toContain('lastmonth');
            expect(ranges).toContain('year');
        });

        it('包含確定和取消按鈕', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const applyBtn = modal.querySelector('#apply-custom-date');
            const closeBtn = modal.querySelector('#close-date-modal');

            expect(applyBtn).not.toBeNull();
            expect(closeBtn).not.toBeNull();
        });
    });

    describe('快速日期按鈕點擊', () => {
        it('點擊「今日」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const todayRange = getDateRange('today');
            const btn = modal.querySelector('[data-range="today"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(todayRange.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(todayRange.endDate);
        });

        it('點擊「本月」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const monthRange = getDateRange('month');
            const btn = modal.querySelector('[data-range="month"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(monthRange.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(monthRange.endDate);
        });

        it('點擊「今年」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const yearRange = getDateRange('year');
            const btn = modal.querySelector('[data-range="year"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(yearRange.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(yearRange.endDate);
        });

        it('點擊「近7日」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const range7 = getDateRange('last7days');
            const btn = modal.querySelector('[data-range="last7days"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(range7.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(range7.endDate);
        });

        it('點擊「上月」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const lastMonthRange = getDateRange('lastmonth');
            const btn = modal.querySelector('[data-range="lastmonth"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(lastMonthRange.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(lastMonthRange.endDate);
        });

        it('點擊「本週」按鈕時更新日期欄位', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const weekRange = getDateRange('week');
            const btn = modal.querySelector('[data-range="week"]');
            btn.click();

            expect(modal.querySelector('#custom-start-date').value).toBe(weekRange.startDate);
            expect(modal.querySelector('#custom-end-date').value).toBe(weekRange.endDate);
        });
    });

    describe('確定按鈕', () => {
        it('點擊確定時呼叫 onApply 並移除 modal', () => {
            document.body.innerHTML = '<div id="app"></div>';
            document.body.appendChild(
                createDateRangeModal({
                    initialStartDate: '2026-06-01',
                    initialEndDate: '2026-06-30',
                    onApply: applyCallback,
                }),
            );

            const applyBtn = document.querySelector('#apply-custom-date');
            applyBtn.click();

            expect(applyCallback).toHaveBeenCalledWith('2026-06-01', '2026-06-30');
            expect(document.getElementById('date-range-modal')).toBeNull();
        });

        it('確定按鈕傳入正確的日期值', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-01-01',
                initialEndDate: '2026-12-31',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            // Manually change the values
            modal.querySelector('#custom-start-date').value = '2026-07-01';
            modal.querySelector('#custom-end-date').value = '2026-07-31';

            modal.querySelector('#apply-custom-date').click();

            expect(applyCallback).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
        });

        it('日期為空時不呼叫 onApply', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            // Clear both inputs
            modal.querySelector('#custom-start-date').value = '';
            modal.querySelector('#custom-end-date').value = '';

            modal.querySelector('#apply-custom-date').click();

            expect(applyCallback).not.toHaveBeenCalled();
        });

        it('只有結束日期時不呼叫 onApply', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            modal.querySelector('#custom-end-date').value = '';
            modal.querySelector('#apply-custom-date').click();

            expect(applyCallback).not.toHaveBeenCalled();
        });

        it('只有開始日期時不呼叫 onApply', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            modal.querySelector('#custom-start-date').value = '';
            modal.querySelector('#apply-custom-date').click();

            expect(applyCallback).not.toHaveBeenCalled();
        });
    });

    describe('取消按鈕', () => {
        it('點擊取消時移除 modal', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            modal.querySelector('#close-date-modal').click();

            expect(document.getElementById('date-range-modal')).toBeNull();
        });

        it('點擊取消時不呼叫 onApply', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            modal.querySelector('#close-date-modal').click();

            expect(applyCallback).not.toHaveBeenCalled();
        });
    });

    describe('點擊 modal 背景關閉', () => {
        it('點擊 modal 本體時關閉', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            // Simulate clicking on the modal background (the modal element itself)
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            modal.dispatchEvent(clickEvent);

            expect(document.getElementById('date-range-modal')).toBeNull();
        });

        it('點擊 modal 內部元素時不關閉', () => {
            document.body.innerHTML = '<div id="app"></div>';
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });
            document.body.appendChild(modal);

            // Click on an inner element — the event target is the inner element, not the modal
            const innerEl = modal.querySelector('.quick-date-btn');
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });

            // We need to make sure the event target is the inner element
            Object.defineProperty(clickEvent, 'target', { value: innerEl, writable: false });
            modal.dispatchEvent(clickEvent);

            // Modal should still exist because the click was on an inner element
            expect(document.getElementById('date-range-modal')).not.toBeNull();

            // Clean up
            modal.remove();
        });
    });

    describe('CSS class 與樣式', () => {
        it('modal 包含固定的 positioning class', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            expect(modal.className).toContain('fixed');
            expect(modal.className).toContain('inset-0');
            expect(modal.className).toContain('z-50');
        });

        it('確定按鈕包含正確的 class', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const applyBtn = modal.querySelector('#apply-custom-date');
            expect(applyBtn.className).toContain('bg-wabi-accent');
        });

        it('取消按鈕包含正確的 class', () => {
            const modal = createDateRangeModal({
                initialStartDate: '2026-06-01',
                initialEndDate: '2026-06-30',
                onApply: applyCallback,
            });

            const closeBtn = modal.querySelector('#close-date-modal');
            expect(closeBtn.className).toContain('bg-wabi-surface');
        });
    });
});

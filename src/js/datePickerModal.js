import { getDateRange } from './utils.js'

export function createDateRangeModal({
  initialStartDate,
  initialEndDate,
  onApply,
}) {
  const today = new Date().toISOString().split('T')[0]

  const modal = document.createElement('div')
  modal.id = 'date-range-modal'
  modal.className =
    'fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  modal.innerHTML = `
    <div class="bg-wabi-bg w-full max-w-sm rounded-2xl shadow-xl p-6">
        <h3 class="text-lg font-bold text-wabi-primary mb-4">自訂日期範圍</h3>
        
        <!-- Quick Select Buttons -->
        <div class="grid grid-cols-3 gap-2 mb-4">
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="today">今日</button>
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="week">本週</button>
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="last7days">近7日</button>
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="month">本月</button>
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="lastmonth">上月</button>
            <button class="quick-date-btn text-sm p-2 rounded-lg bg-wabi-surface border border-wabi-border" data-range="year">今年</button>
        </div>

        <!-- Date Inputs -->
        <div class="space-y-4">
            <div>
                <label for="custom-start-date" class="text-sm text-wabi-text-secondary">開始日期</label>
                <input type="date" id="custom-start-date" value="${
                  initialStartDate || today
                }" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-wabi-accent focus:border-wabi-accent">
            </div>
            <div>
                <label for="custom-end-date" class="text-sm text-wabi-text-secondary">結束日期</label>
                <input type="date" id="custom-end-date" value="${
                  initialEndDate || today
                }" class="w-full mt-1 p-2 rounded-lg border-wabi-border bg-wabi-surface focus:ring-wabi-accent focus:border-wabi-accent">
            </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2 mt-6">
            <button id="apply-custom-date" class="flex-1 py-3 bg-wabi-accent text-wabi-primary font-bold rounded-lg">確定</button>
            <button id="close-date-modal" class="flex-1 py-3 bg-wabi-surface border border-wabi-border text-wabi-text-primary rounded-lg">取消</button>
        </div>
    </div>
  `

  const startDateInput = modal.querySelector('#custom-start-date')
  const endDateInput = modal.querySelector('#custom-end-date')

  const closeModal = () => modal.remove()

  modal.querySelectorAll('.quick-date-btn').forEach(button => {
    button.addEventListener('click', () => {
      const { startDate, endDate } = getDateRange(button.dataset.range)
      startDateInput.value = startDate
      endDateInput.value = endDate
    })
  })

  modal.querySelector('#apply-custom-date').addEventListener('click', () => {
    const start = startDateInput.value
    const end = endDateInput.value
    if (start && end) {
      onApply(start, end)
      closeModal()
    }
  })

  modal.querySelector('#close-date-modal').addEventListener('click', closeModal)
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      closeModal()
    }
  })

  return modal
}

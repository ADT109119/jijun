export default {
  meta: {
    id: 'com.walkingfish.currency_helper',
    name: '簡易匯率換算',
    version: '1.4',
    description: '在記帳頁面新增換算按鈕，開啟視窗後即時計算各國匯率。',
    author: 'The walking fish 步行魚',
    icon: 'fa-sack-dollar',
  },
  init(context) {
    this.context = context
    this.currencies = [
      { code: 'USD', name: '美金', icon: 'fa-dollar-sign' },
      { code: 'JPY', name: '日圓', icon: 'fa-yen-sign' },
      { code: 'EUR', name: '歐元', icon: 'fa-euro-sign' },
      { code: 'CNY', name: '人民幣', icon: 'fa-yen-sign' },
      { code: 'KRW', name: '韓元', icon: 'fa-won-sign' },
      { code: 'GBP', name: '英鎊', icon: 'fa-sterling-sign' },
      { code: 'THB', name: '泰銖', icon: 'fa-baht-sign' },
      { code: 'HKD', name: '港幣', icon: 'fa-dollar-sign' },
    ]
    this.rates = null

    context.events.on('onPageRenderAfter', page => {
      if (page === 'add') {
        this.injectButton()
      }
    })
  },

  injectButton() {
    const categoryContainer = document.getElementById('add-selected-category')
    if (!categoryContainer) return

    // Ensure we don't duplicate
    if (document.getElementById('currency-open-btn')) return

    const row = categoryContainer.parentElement
    const parent = row.parentElement

    // Container for the button
    const btnContainer = document.createElement('div')
    btnContainer.className = 'mt-1 flex justify-end px-1' // Right aligned below category/amount row?
    // User said "Left side category display... below".
    // Actually "Below Category Display" (which is on the left).

    // Let's create a full-width container below the row.
    // And align the button to the left (under category).
    btnContainer.className = 'mt-1 flex px-1'

    const btn = document.createElement('button')
    btn.id = 'currency-open-btn'
    btn.className =
      'text-sm text-wabi-primary bg-wabi-primary/10 px-3 py-1.5 rounded-lg hover:bg-wabi-primary/20 transition-colors flex items-center gap-2'
    btn.innerHTML = '<i class="fa-solid fa-calculator"></i> 匯率換算'

    btn.addEventListener('click', () => this.openConverter())

    btnContainer.appendChild(btn)

    if (row.nextSibling) {
      parent.insertBefore(btnContainer, row.nextSibling)
    } else {
      parent.appendChild(btnContainer)
    }
  },

  async openConverter() {
    // Fetch Rates first or in parallel?
    // Improve UX: Open Modal first (loading state), then update.

    const modal = document.createElement('div')
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-[70] flex items-center justify-center p-4 animation-fade-in'
    modal.innerHTML = `
            <div class="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl transform transition-all scale-100 flex flex-col max-h-[90vh]">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <i class="fa-solid fa-earth-americas text-blue-500"></i> 匯率換算器
                    </h3>
                    <button id="curr-close-top" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times text-xl"></i></button>
                </div>
                
                <div class="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100">
                    <label class="block text-xs text-gray-500 mb-1 font-bold tracking-wide">外幣金額</label>
                    <div class="flex items-end gap-2">
                        <input type="number" id="curr-input-amount" class="w-full bg-transparent text-3xl font-bold text-gray-800 outline-none placeholder-gray-300" placeholder="0" autofocus>
                        <span class="text-gray-400 font-medium mb-1.5">Foreign</span>
                    </div>
                </div>

                <div id="curr-loading" class="text-center py-4 text-blue-500 text-sm">
                    <i class="fa-solid fa-circle-notch fa-spin"></i> 正在更新匯率...
                </div>
                
                <div id="curr-grid" class="grid grid-cols-2 gap-3 overflow-y-auto hidden pb-2">
                    <!-- Buttons go here -->
                </div>
                
                <div class="mt-4 pt-3 border-t border-gray-100 text-center">
                    <p class="text-[10px] text-gray-400">匯率來源: ExchangeRate-API (TWD Based)</p>
                </div>
            </div>
        `
    document.body.appendChild(modal)

    const input = modal.querySelector('#curr-input-amount')
    const grid = modal.querySelector('#curr-grid')
    const loading = modal.querySelector('#curr-loading')

    // Focus input
    setTimeout(() => input.focus(), 100)

    const close = () => modal.remove()
    modal.querySelector('#curr-close-top').addEventListener('click', close)

    // Fetch Rates
    if (!this.rates) {
      try {
        const res = await fetch(
          'https://api.exchangerate-api.com/v4/latest/TWD'
        )
        const data = await res.json()
        this.rates = data.rates
      } catch (e) {
        loading.textContent = '❌ 無法取得匯率'
        loading.classList.add('text-red-500')
        return
      }
    }

    // Render Buttons
    loading.classList.add('hidden')
    grid.classList.remove('hidden')

    const renderButtons = () => {
      const val = parseFloat(input.value)
      grid.innerHTML = ''

      this.currencies.forEach(c => {
        const rate = this.rates[c.code]
        if (!rate) return

        // If input is empty, show Rate. If input has value, show Converted TWD.
        // User wants: "Real-time display converted TWD".

        let mainText = ''
        let subText = ''

        if (!val || val === 0) {
          mainText = c.code
          subText = `1 TWD ≈ ${rate.toFixed(3)}`
        } else {
          // Convert: Foreign / Rate = TWD
          const twd = Math.round(val / rate)
          mainText = `$${twd.toLocaleString()}`
          subText = `${c.code}`
        }

        const btn = document.createElement('button')
        btn.className =
          'border border-gray-200 rounded-xl p-3 hover:bg-blue-50 hover:border-blue-300 transition-all text-left group active:scale-95'
        btn.innerHTML = `
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded group-hover:bg-white transition-colors">${c.code}</span>
                        <i class="fa-solid ${c.icon} text-gray-300 group-hover:text-blue-400"></i>
                    </div>
                    <div class="text-xl font-bold text-gray-800 group-hover:text-blue-600 truncate tracking-tight">
                        ${!val ? '--' : '$' + Math.round(val / rate).toLocaleString()}
                    </div>
                    <div class="text-[10px] text-gray-400 mt-1">
                         ≈ ${val || 0} ${c.name}
                    </div>
                 `

        btn.addEventListener('click', () => {
          if (!val) return
          const twd = Math.round(val / rate)
          this.applyAmount(twd, c.code, val)
          close()
        })

        grid.appendChild(btn)
      })
    }

    renderButtons()

    input.addEventListener('input', renderButtons)
  },

  applyAmount(twd, code, foreign) {
    // Read Check Type
    let type = 'expense'
    if (
      document
        .getElementById('add-type-income')
        ?.classList.contains('bg-wabi-income')
    ) {
      type = 'income'
    }

    // Read Note
    const noteInput = document.getElementById('add-note-input')
    const currentNote = noteInput ? noteInput.value : ''
    const note = currentNote
      ? `${currentNote} (${foreign} ${code})`
      : `${foreign} ${code}`

    // Apply
    this.context.ui.openAddPage({
      amount: twd,
      description: note,
      type: type,
    })
  },
}

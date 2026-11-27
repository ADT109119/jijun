// src/js/quickSelectManager.js

import {
    escapeHTML,
    getSafeIconClass,
    getSafeBgColorStyle,
} from './utils.js'

const QUICK_SELECT_STORAGE_KEY = 'quickSelectRecords'
const MAX_TOTAL_RECORDS = 20
const MAX_DISPLAY_RECORDS = 5

/**
 * 將 accountId 正規化為整數或 null（#QSM-ATTR）：
 * 統一 addRecord / deleteRecord / click / loadRecords 對 null / undefined / 'null' / 'undefined' /
 * 空字串 / 數字字串 / 非法髒字串的語意，避免 parseInt(null) 變 NaN 導致膠囊比對與刪除失配。
 * @param {*} accountId
 * @returns {number|null}
 */
function normalizeAccountId(accountId) {
    if (
        accountId === null ||
        accountId === undefined ||
        accountId === '' ||
        accountId === 'null' ||
        accountId === 'undefined'
    ) {
        return null
    }
    if (typeof accountId === 'number') {
        return Number.isInteger(accountId) ? accountId : null
    }
    if (typeof accountId === 'string') {
        const trimmed = accountId.trim()
        if (/^-?\d+$/.test(trimmed)) {
            const parsed = parseInt(trimmed, 10)
            return Number.isSafeInteger(parsed) ? parsed : null
        }
    }
    return null
}

/**
 * 正規化描述字串（null/undefined → ''，CRLF/CR → LF，與 HTML 屬性解析對齊防止比對失配）
 * @param {*} description
 * @returns {string}
 */
function normalizeDescription(description) {
    if (description === null || description === undefined) return ''
    return String(description).replace(/\r\n?/g, '\n')
}

export class QuickSelectManager {
    constructor() {
        this.records = this.loadRecords()
    }

    loadRecords() {
        try {
            const storedData = localStorage.getItem(QUICK_SELECT_STORAGE_KEY)
            const parsed = storedData ? JSON.parse(storedData) : []
            return Array.isArray(parsed) ? parsed : []
        } catch (error) {
            console.error('Failed to load quick select records:', error)
            return []
        }
    }

    saveRecords() {
        try {
            localStorage.setItem(
                QUICK_SELECT_STORAGE_KEY,
                JSON.stringify(this.records)
            )
        } catch (error) {
            console.error('Failed to save quick select records:', error)
        }
    }

    /**
     * 判斷快選紀錄是否與目標鍵值一致（addRecord / deleteRecord 共用單一比對邏輯，#QSM-ATTR）
     * @private
     */
    _matchesRecord(record, type, categoryId, description, accountId) {
        if (!record || typeof record !== 'object') return false
        const targetDesc = normalizeDescription(description)
        const targetAccId = normalizeAccountId(accountId)
        const recordDesc = normalizeDescription(record.description)
        const recordAccId = normalizeAccountId(record.accountId)
        return (
            String(record.type ?? '') === String(type ?? '') &&
            String(record.categoryId ?? '') === String(categoryId ?? '') &&
            recordDesc === targetDesc &&
            recordAccId === targetAccId
        )
    }

    /**
     * Adds or updates a record based on its category, description, and account.
     * @param {string} type - 'income' or 'expense'
     * @param {string} categoryId
     * @param {string} description
     * @param {number|null} accountId
     */
    addRecord(type, categoryId, description, accountId) {
        const normalizedDescription = normalizeDescription(description)
        const normalizedAccountId = normalizeAccountId(accountId)

        const existingRecordIndex = this.records.findIndex(r =>
            this._matchesRecord(
                r,
                type,
                categoryId,
                normalizedDescription,
                normalizedAccountId
            )
        )

        if (existingRecordIndex > -1) {
            this.records[existingRecordIndex].count++
            this.records[existingRecordIndex].lastUsed = Date.now()
            this.records[existingRecordIndex].description = normalizedDescription
            this.records[existingRecordIndex].accountId = normalizedAccountId
        } else {
            this.records.push({
                type,
                categoryId,
                description: normalizedDescription,
                accountId: normalizedAccountId,
                count: 1,
                lastUsed: Date.now(),
            })
        }

        this.records.sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count
            }
            return b.lastUsed - a.lastUsed
        })

        if (this.records.length > MAX_TOTAL_RECORDS) {
            this.records = this.records.slice(0, MAX_TOTAL_RECORDS)
        }

        this.saveRecords()
    }

    /**
     * Deletes a specific quick select record.
     * @param {string} type
     * @param {string} categoryId
     * @param {string} description
     * @param {string|number|null} accountId - Accepts null, undefined, numeric ID, or dataset string
     */
    deleteRecord(type, categoryId, description, accountId) {
        const normalizedDescription = normalizeDescription(description)
        const normalizedAccountId = normalizeAccountId(accountId)

        this.records = this.records.filter(
            r =>
                !this._matchesRecord(
                    r,
                    type,
                    categoryId,
                    normalizedDescription,
                    normalizedAccountId
                )
        )

        this.saveRecords()
    }

    getQuickSelects() {
        return this.records.slice(0, MAX_DISPLAY_RECORDS)
    }

    /**
     * Renders the quick select capsules into a container.
     * @param {HTMLElement} container - The DOM element to render into.
     * @param {Function} onSelect - Callback function when a capsule is clicked. (type, categoryId, description, accountId) => {}
     * @param {Object} categoryManager - The main category manager instance to get category details.
     * @param {boolean} advancedModeEnabled - Whether multi-account mode is on.
     */
    render(container, onSelect, categoryManager, advancedModeEnabled) {
        const quickSelects = this.getQuickSelects()

        if (quickSelects.length === 0) {
            container.innerHTML = ''
            container.classList.add('hidden')
            return
        }

        const renderItems = []
        for (const record of quickSelects) {
            if (!record || typeof record !== 'object') continue
            const category = categoryManager?.getCategoryById?.(
                record.type,
                record.categoryId
            )
            if (!category) continue
            renderItems.push({ record, category })
        }

        if (renderItems.length === 0) {
            container.innerHTML = ''
            container.classList.add('hidden')
            return
        }

        container.classList.remove('hidden')
        container.innerHTML = `
            <div class="px-2">
                <label class="text-sm text-wabi-text-secondary">最近紀錄</label>
                <div class="flex gap-2 overflow-x-auto pb-2">
                    ${renderItems
                        .map(({ record, category }) => {
                            const normalizedDesc = normalizeDescription(
                                record.description
                            )
                            const normalizedAccId = normalizeAccountId(
                                record.accountId
                            )
                            const accountIdAttr =
                                normalizedAccId === null
                                    ? 'null'
                                    : String(normalizedAccId)
                            const descriptionText = normalizedDesc
                                ? normalizedDesc
                                : category.name
                            // #SEC05：歷史髒 color 走全站白名單（hex 或 bg-* class，髒值雙空→不輸出屬性）
                            const safeBg = getSafeBgColorStyle(category.color)
                            const colorStyle = safeBg.style
                                ? `style="${safeBg.style}"`
                                : ''
                            const colorClass = safeBg.className

                            // #QSM-ATTR：四個 data-* 屬性一律經 escapeHTML 跳脫，
                            // 阻斷雙引號／尖括號 XSS attribute breakout，同時確保瀏覽器
                            // 解析回 button.dataset 時與原始記錄逐字一致（解決膠囊比對與刪除失配）。
                            return `
                            <button type="button" class="quick-select-capsule flex-shrink-0 flex items-center gap-2 bg-wabi-surface border border-wabi-border rounded-full pl-2 pr-3 py-1 mt-1 text-sm"
                                data-type="${escapeHTML(record.type)}"
                                data-category-id="${escapeHTML(record.categoryId)}"
                                data-description="${escapeHTML(normalizedDesc)}"
                                data-account-id="${escapeHTML(accountIdAttr)}"
                            >
                                <div class="flex items-center justify-center rounded-full ${colorClass} text-white shrink-0 size-6" ${colorStyle}>
                                    <i class="${getSafeIconClass(category.icon, 'fa-solid fa-question')} text-xs"></i>
                                </div>
                                <span class="text-wabi-text-primary font-medium truncate max-w-[100px]">${escapeHTML(descriptionText)}</span>
                            </button>
                        `
                        })
                        .join('')}
                </div>
            </div>
        `

        container.querySelectorAll('.quick-select-capsule').forEach(button => {
            button.addEventListener('click', () => {
                const { type, categoryId, description, accountId } =
                    button.dataset
                if (onSelect) {
                    const numericAccountId = normalizeAccountId(accountId)
                    onSelect(type, categoryId, description, numericAccountId)
                }
            })

            // Long-press and context menu for deletion
            let pressTimer
            button.addEventListener('mousedown', e => {
                if (e.button === 2) return // Ignore right-clicks for timer
                pressTimer = window.setTimeout(() => {
                    this.showDeleteMenu(
                        button,
                        container,
                        onSelect,
                        categoryManager,
                        advancedModeEnabled
                    )
                }, 500) // 500ms for long press
            })
            button.addEventListener('mouseup', () => clearTimeout(pressTimer))
            button.addEventListener('mouseleave', () =>
                clearTimeout(pressTimer)
            )
            button.addEventListener('contextmenu', e => {
                e.preventDefault()
                this.showDeleteMenu(
                    button,
                    container,
                    onSelect,
                    categoryManager,
                    advancedModeEnabled
                )
            })
        })
    }

    showDeleteMenu(
        button,
        container,
        onSelect,
        categoryManager,
        advancedModeEnabled
    ) {
        // Remove any existing menus
        const existingMenu = document.getElementById(
            'quick-select-context-menu'
        )
        if (existingMenu) existingMenu.remove()

        const rect = button.getBoundingClientRect()
        const menu = document.createElement('div')
        menu.id = 'quick-select-context-menu'
        menu.className =
            'absolute bg-wabi-surface rounded-md shadow-lg py-1 z-50'
        menu.style.top = `${rect.bottom + 5}px`
        menu.style.left = `${rect.left}px`
        menu.innerHTML = `<button id="delete-quick-select-btn" class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100">刪除</button>`

        document.body.appendChild(menu)

        document
            .getElementById('delete-quick-select-btn')
            .addEventListener('click', e => {
                e.stopPropagation() // Prevent the document click listener from firing immediately
                const { type, categoryId, description, accountId } =
                    button.dataset
                this.deleteRecord(type, categoryId, description, accountId)
                menu.remove()
                // Re-render the capsules
                this.render(
                    container,
                    onSelect,
                    categoryManager,
                    advancedModeEnabled
                )
            })

        // Click outside to close
        const closeListener = e => {
            if (!menu.contains(e.target)) {
                menu.remove()
                document.removeEventListener('click', closeListener)
            }
        }
        setTimeout(() => document.addEventListener('click', closeListener), 10)
    }
}

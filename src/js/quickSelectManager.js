// src/js/quickSelectManager.js

const QUICK_SELECT_STORAGE_KEY = 'quickSelectRecords';
const MAX_TOTAL_RECORDS = 20;
const MAX_DISPLAY_RECORDS = 5;

export class QuickSelectManager {
    constructor() {
        this.records = this.loadRecords();
    }

    loadRecords() {
        try {
            const storedData = localStorage.getItem(QUICK_SELECT_STORAGE_KEY);
            return storedData ? JSON.parse(storedData) : [];
        } catch (error) {
            console.error('Failed to load quick select records:', error);
            return [];
        }
    }

    saveRecords() {
        try {
            localStorage.setItem(QUICK_SELECT_STORAGE_KEY, JSON.stringify(this.records));
        } catch (error) {
            console.error('Failed to save quick select records:', error);
        }
    }

    /**
     * Adds or updates a record based on its category, description, and account.
     * @param {string} type - 'income' or 'expense'
     * @param {string} categoryId 
     * @param {string} description 
     * @param {number|null} accountId 
     */
    addRecord(type, categoryId, description, accountId) {
        const normalizedDescription = description || '';
        // Treat undefined accountId as null for consistent matching
        const normalizedAccountId = accountId === undefined ? null : accountId;

        const existingRecordIndex = this.records.findIndex(r => 
            r.type === type && 
            r.categoryId === categoryId && 
            r.description === normalizedDescription &&
            (r.accountId === normalizedAccountId || (r.accountId === undefined && normalizedAccountId === null))
        );

        if (existingRecordIndex > -1) {
            this.records[existingRecordIndex].count++;
            this.records[existingRecordIndex].lastUsed = Date.now();
        } else {
            this.records.push({
                type,
                categoryId,
                description: normalizedDescription,
                accountId: normalizedAccountId,
                count: 1,
                lastUsed: Date.now()
            });
        }

        this.records.sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count;
            }
            return b.lastUsed - a.lastUsed;
        });

        if (this.records.length > MAX_TOTAL_RECORDS) {
            this.records = this.records.slice(0, MAX_TOTAL_RECORDS);
        }

        this.saveRecords();
    }

    /**
     * Deletes a specific quick select record.
     * @param {string} type 
     * @param {string} categoryId 
     * @param {string} description 
     * @param {string} accountId - Note: dataset converts null to "null" string
     */
    deleteRecord(type, categoryId, description, accountId) {
        console.log('Attempting to delete:', { type, categoryId, description, accountId });
        const normalizedDescription = description || '';
        const normalizedAccountId = (accountId === 'null' || accountId === 'undefined') ? null : parseInt(accountId, 10);
        console.log('Normalized accountId for deletion:', normalizedAccountId);

        const initialCount = this.records.length;

        this.records = this.records.filter(r => {
            const match = (
                r.type === type && 
                r.categoryId === categoryId && 
                r.description === normalizedDescription &&
                r.accountId === normalizedAccountId
            );
            if (match) {
                console.log('Found matching record to delete:', r);
            }
            return !match;
        });

        console.log(`Record count before: ${initialCount}, after: ${this.records.length}`);
        this.saveRecords();
    }

    getQuickSelects() {
        return this.records.slice(0, MAX_DISPLAY_RECORDS);
    }

    /**
     * Renders the quick select capsules into a container.
     * @param {HTMLElement} container - The DOM element to render into.
     * @param {Function} onSelect - Callback function when a capsule is clicked. (type, categoryId, description, accountId) => {}
     * @param {Object} categoryManager - The main category manager instance to get category details.
     * @param {boolean} advancedModeEnabled - Whether multi-account mode is on.
     */
    render(container, onSelect, categoryManager, advancedModeEnabled) {
        const quickSelects = this.getQuickSelects();
        
        if (quickSelects.length === 0) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }
        
        container.classList.remove('hidden');
        container.innerHTML = `
            <div class="px-2">
                <label class="text-sm text-wabi-text-secondary">最近紀錄</label>
                <div class="flex gap-2 overflow-x-auto pb-2">
                    ${quickSelects.map(record => {
                        const category = categoryManager.getCategoryById(record.type, record.categoryId);
                        if (!category) return '';

                        const descriptionText = record.description ? record.description : category.name;
                        const colorStyle = category.color.startsWith('#') ? `style="background-color: ${category.color}"` : '';
                        const colorClass = !category.color.startsWith('#') ? category.color : '';

                        return `
                            <button class="quick-select-capsule flex-shrink-0 flex items-center gap-2 bg-wabi-surface border border-wabi-border rounded-full pl-2 pr-3 py-1 mt-1 text-sm"
                                data-type="${record.type}"
                                data-category-id="${record.categoryId}"
                                data-description="${record.description}"
                                data-account-id="${record.accountId}"
                            >
                                <div class="flex items-center justify-center rounded-full ${colorClass} text-white shrink-0 size-6" ${colorStyle}>
                                    <i class="${category.icon} text-xs"></i>
                                </div>
                                <span class="text-wabi-text-primary font-medium truncate max-w-[100px]">${descriptionText}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        container.querySelectorAll('.quick-select-capsule').forEach(button => {
            button.addEventListener('click', () => {
                const { type, categoryId, description, accountId } = button.dataset;
                if (onSelect) {
                    const numericAccountId = (accountId === 'null' || accountId === 'undefined') ? null : parseInt(accountId, 10);
                    onSelect(type, categoryId, description, numericAccountId);
                }
            });

            // Long-press and context menu for deletion
            let pressTimer;
            button.addEventListener('mousedown', (e) => {
                if (e.button === 2) return; // Ignore right-clicks for timer
                pressTimer = window.setTimeout(() => {
                    this.showDeleteMenu(button, container, onSelect, categoryManager, advancedModeEnabled);
                }, 500); // 500ms for long press
            });
            button.addEventListener('mouseup', () => clearTimeout(pressTimer));
            button.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            button.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showDeleteMenu(button, container, onSelect, categoryManager, advancedModeEnabled);
            });
        });
    }

    showDeleteMenu(button, container, onSelect, categoryManager, advancedModeEnabled) {
        // Remove any existing menus
        const existingMenu = document.getElementById('quick-select-context-menu');
        if (existingMenu) existingMenu.remove();

        const rect = button.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.id = 'quick-select-context-menu';
        menu.className = 'absolute bg-white rounded-md shadow-lg py-1 z-50';
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left}px`;
        menu.innerHTML = `<button id="delete-quick-select-btn" class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100">刪除</button>`;
        
        document.body.appendChild(menu);

        document.getElementById('delete-quick-select-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the document click listener from firing immediately
            const { type, categoryId, description, accountId } = button.dataset;
            this.deleteRecord(type, categoryId, description, accountId);
            menu.remove();
            // Re-render the capsules
            this.render(container, onSelect, categoryManager, advancedModeEnabled);
        });

        // Click outside to close
        const closeListener = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeListener);
            }
        };
        setTimeout(() => document.addEventListener('click', closeListener), 10);
    }
}
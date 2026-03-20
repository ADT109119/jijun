/**
 * PluginStorage.js
 * Provides a sandboxed storage wrapper for plugins.
 * Keys are prefixed with the plugin ID to prevent collisions and unauthorized access.
 */
export class PluginStorage {
    /**
     * @param {string} pluginId - The unique ID of the plugin.
     * @param {object} dataService - The DataService instance for DB access.
     */
    constructor(pluginId, dataService) {
        if (!pluginId) {
            throw new Error('PluginStorage requires a pluginId.');
        }
        if (!dataService) {
            throw new Error('PluginStorage requires a DataService instance.');
        }
        // 驗證 pluginId 格式：僅允許英數字、點、底線、連字號 (降級為警告以維持向後相容)
        if (!/^[a-zA-Z0-9._-]+$/.test(pluginId)) {
            console.warn(`PluginStorage: Sub-optimal pluginId format: "${pluginId}". Only alphanumeric, dots, underscores, and hyphens are recommended.`);
        }
        this.pluginId = pluginId;
        this.dataService = dataService;
        this.prefix = `plugin_${pluginId}_`;
        this.cache = Object.create(null); // Memory cache (no prototype for safe key access)
        this.saveTimeout = null;
        this.savePromiseResolve = null;
        this.savePromise = null;
    }

    /**
     * Initializes the storage by loading data from IndexedDB and migrating
     * existing localStorage data if necessary.
     */
    async init() {
        // 1. Load existing data from IndexedDB
        let pluginData = null;
        try {
            const tx = this.dataService.db.transaction('plugins', 'readonly');
            pluginData = await tx.store.get(this.pluginId);
        } catch (e) {
            console.error(`[PluginStorage] Failed to read plugin data from DB for ${this.pluginId}`, e);
        }

        if (pluginData && pluginData.storage) {
            this.cache = Object.assign(Object.create(null), pluginData.storage);
        } else {
            this.cache = Object.create(null);
        }

        // 2. Migrate from localStorage to the cache
        let migrated = false;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const lsKey = localStorage.key(i);
            if (lsKey && lsKey.startsWith(this.prefix)) {
                const originalKey = lsKey.substring(this.prefix.length);
                const value = localStorage.getItem(lsKey);

                // Only migrate if it doesn't already exist in DB to prevent overwriting newer DB data
                // Or overwrite if you prefer localStorage to win during the first migration.
                // We'll let localStorage win for initial migration, but typically it only happens once.
                if (!(originalKey in this.cache)) {
                    this.cache[originalKey] = value;
                    migrated = true;
                }
                keysToRemove.push(lsKey);
            }
        }

        // 3. Remove migrated keys from localStorage
        if (keysToRemove.length > 0) {
            keysToRemove.forEach(k => localStorage.removeItem(k));
        }

        // 4. Save to DB immediately if we migrated data
        if (migrated) {
            await this._saveToDB();
        }
    }

    /**
     * Get a prefixed key (Deprecated, kept for internal or backward reference if needed).
     * @param {string} key 
     * @returns {string} The full key.
     */
    _getKey(key) {
        return this.prefix + key;
    }

    /**
     * Debounced save to IndexedDB
     */
    async _saveToDB() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        // Return the same promise if already pending, otherwise create a new one
        if (!this.savePromise) {
            this.savePromise = new Promise((resolve) => {
                this.savePromiseResolve = resolve;
            });
        }

        // 保存當前 Promise 的 resolve 引用
        const currentResolve = this.savePromiseResolve;

        // Use a small delay to batch rapid consecutive writes
        this.saveTimeout = setTimeout(async () => {
            // 切斷類別全域狀態，讓新來的寫入能產出下一輪的 Promise
            this.saveTimeout = null;
            this.savePromise = null;
            this.savePromiseResolve = null;

            try {
                const tx = this.dataService.db.transaction('plugins', 'readwrite');
                const pluginData = await tx.store.get(this.pluginId);

                if (pluginData) {
                    pluginData.storage = { ...this.cache };
                    await tx.store.put(pluginData);
                    await tx.done;
                }
            } catch (e) {
                console.error(`[PluginStorage] Failed to save storage to DB for ${this.pluginId}`, e);
            } finally {
                // 呼叫該週期專屬的 Resolve
                if (currentResolve) {
                    currentResolve();
                }
            }
        }, 50);

        return this.savePromise;
    }

    /**
     * Save a value to storage.
     * @param {string} key 
     * @param {string} value 
     */
    setItem(key, value) {
        // Ensure string representation to match localStorage behavior
        this.cache[key] = String(value);
        this._saveToDB();
    }

    /**
     * Get a value from storage.
     * @param {string} key 
     * @returns {string|null}
     */
    getItem(key) {
        return key in this.cache ? this.cache[key] : null;
    }

    /**
     * Remove a value from storage.
     * @param {string} key 
     */
    removeItem(key) {
        if (key in this.cache) {
            delete this.cache[key];
            this._saveToDB();
        }
    }

    /**
     * Clear all storage for this plugin.
     */
    clear() {
        this.cache = Object.create(null);
        this._saveToDB();
    }

    /**
     * Save a JSON object.
     * @param {string} key 
     * @param {any} value 
     */
    setJSON(key, value) {
        try {
            this.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error(`[PluginStorage] Error saving JSON for ${key}:`, e);
        }
    }

    /**
     * Get a JSON object.
     * @param {string} key 
     * @returns {any|null}
     */
    getJSON(key) {
        const value = this.getItem(key);
        if (value === null) return null;
        try {
            return JSON.parse(value);
        } catch (e) {
            console.error(`[PluginStorage] Error parsing JSON for ${key}:`, e);
            return null;
        }
    }
}

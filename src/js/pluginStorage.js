/**
 * PluginStorage.js
 * Provides a sandboxed storage wrapper for plugins.
 * Keys are prefixed with the plugin ID to prevent collisions and unauthorized access.
 */
export class PluginStorage {
    /**
     * @param {string} pluginId - The unique ID of the plugin.
     */
    constructor(pluginId) {
        if (!pluginId) {
            throw new Error('PluginStorage requires a pluginId.');
        }
        // 驗證 pluginId 格式：僅允許英數字、點、底線、連字號
        if (!/^[a-zA-Z0-9._-]+$/.test(pluginId)) {
            throw new Error(`PluginStorage: Invalid pluginId format: "${pluginId}". Only alphanumeric, dots, underscores, and hyphens are allowed.`);
        }
        this.pluginId = pluginId;
        this.prefix = `plugin_${pluginId}_`;
    }

    /**
     * Get a prefixed key.
     * @param {string} key 
     * @returns {string} The full key used in localStorage.
     */
    _getKey(key) {
        return this.prefix + key;
    }

    /**
     * Save a value to storage.
     * @param {string} key 
     * @param {string} value 
     */
    setItem(key, value) {
        localStorage.setItem(this._getKey(key), value);
    }

    /**
     * Get a value from storage.
     * @param {string} key 
     * @returns {string|null}
     */
    getItem(key) {
        return localStorage.getItem(this._getKey(key));
    }

    /**
     * Remove a value from storage.
     * @param {string} key 
     */
    removeItem(key) {
        localStorage.removeItem(this._getKey(key));
    }

    /**
     * Clear all storage for this plugin.
     */
    clear() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
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

import { showToast } from './utils.js';

export class PluginManager {
  constructor(dataService, app) {
    this.dataService = dataService;
    this.app = app;
    this.plugins = new Map(); // id -> pluginModule
    this.customPages = new Map(); // routeId -> { title, renderFn }
    this.hooks = new Map(); // hookName -> Set<callback>
    this.context = this.createPluginContext();
  }

  createPluginContext() {
    return {
      appName: 'Easy Accounting',
      version: '2.1.1.1',
      ui: {
        showToast: (msg, type) => showToast(msg, type),
        registerPage: (routeId, title, renderFn) => this.registerPage(routeId, title, renderFn),
        navigateTo: (hash) => { window.location.hash = hash; },
        // Future hooks:
        // addSidebarItem: ...
        // addSettingItem: ...
      },
      events: {
        on: (hookName, callback) => this.registerHook(hookName, callback),
        off: (hookName, callback) => this.unregisterHook(hookName, callback)
      },
      hooks: {
          // Event listeners or interceptors can be added here
      }
    };
  }

  async init() {
    await this.loadInstalledPlugins();
  }

  async loadInstalledPlugins() {
    try {
        const tx = this.dataService.db.transaction('plugins', 'readonly');
        const store = tx.objectStore('plugins');
        const plugins = await store.getAll();
        
        for (const pluginData of plugins) {
            if (pluginData.enabled) {
                await this.loadPlugin(pluginData);
            }
        }
    } catch (e) {
        // If store doesn't exist (schema not upgraded yet?), ignore
        console.warn('Plugins store access failed (might be first run with new version):', e);
    }
  }

  async loadPlugin(pluginData) {
    try {
        const blob = new Blob([pluginData.script], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        
        const module = await import(url);
        if (module.default && typeof module.default.init === 'function') {
            module.default.init(this.context);
            this.plugins.set(pluginData.id, module.default);
            console.log(`Plugin loaded: ${pluginData.name}`);
        } else {
            console.warn(`Plugin ${pluginData.name} has no init function.`);
        }
        
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(`Error loading plugin ${pluginData.name}:`, e);
        showToast(`插件 ${pluginData.name} 載入失敗`, 'error');
    }
  }

  async installPlugin(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const scriptContent = e.target.result;
            
            // Validate by trying to import
             const blob = new Blob([scriptContent], { type: 'text/javascript' });
             const url = URL.createObjectURL(blob);
             let meta = {};
             try {
                 // @ts-ignore
        /* @vite-ignore */
        const module = await import(url);
                 meta = module.default?.meta || {};
             } catch(err) {
                 URL.revokeObjectURL(url);
                 reject(new Error('無法解析插件檔案'));
                 return;
             }
             URL.revokeObjectURL(url);

            const pluginData = {
                id: meta.id || `plugin-${Date.now()}`,
                name: meta.name || file.name,
                version: meta.version || '1.0',
                description: meta.description || '',
                script: scriptContent,
                enabled: true,
                installedAt: Date.now()
            };

            const tx = this.dataService.db.transaction('plugins', 'readwrite');
            await tx.store.put(pluginData);
            await tx.done;
            
            await this.loadPlugin(pluginData);
            resolve(pluginData);
        };
        reader.onerror = () => reject(new Error('讀取失敗'));
        reader.readAsText(file);
    });
  }

  async uninstallPlugin(id) {
      const tx = this.dataService.db.transaction('plugins', 'readwrite');
      await tx.store.delete(id);
      await tx.done;
      this.plugins.delete(id);
      showToast('插件已移除，請重新整理頁面');
  }
    
  async getInstalledPlugins() {
      const tx = this.dataService.db.transaction('plugins', 'readonly');
      return await tx.store.getAll();
  }

  registerPage(routeId, title, renderFn) {
      if (this.customPages.has(routeId)) {
          console.warn(`Plugin page route '${routeId}' already exists. Overwriting.`);
      }
      this.customPages.set(routeId, { title, renderFn });
      console.log(`Registered custom page: #${routeId}`);
  }

  getCustomPage(routeId) {
      return this.customPages.get(routeId);
  }

  registerHook(hookName, callback) {
      if (!this.hooks.has(hookName)) {
          this.hooks.set(hookName, new Set());
      }
      this.hooks.get(hookName).add(callback);
      console.log(`Hook registered: ${hookName}`);
  }

  unregisterHook(hookName, callback) {
      if (this.hooks.has(hookName)) {
          this.hooks.get(hookName).delete(callback);
      }
  }

  async triggerHook(hookName, payload) {
      if (!this.hooks.has(hookName)) return payload;
      
      let currentPayload = payload;
      for (const callback of this.hooks.get(hookName)) {
          try {
              // Hooks can modify payload by returning new value (for 'before' hooks)
              // Or just execute side effects (for 'after' hooks)
              const result = await callback(currentPayload);
              if (result !== undefined && result !== null) {
                  currentPayload = result;
              }
          } catch (e) {
              console.error(`Error in hook ${hookName}:`, e);
          }
      }
      return currentPayload;
  }

  /**
   * Compare two version strings.
   * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
   */
  compareVersions(v1, v2) {
      if (!v1 || !v2) return 0;
      const p1 = v1.split('.').map(Number);
      const p2 = v2.split('.').map(Number);
      const len = Math.max(p1.length, p2.length);
      
      for (let i = 0; i < len; i++) {
          const num1 = p1[i] || 0;
          const num2 = p2[i] || 0;
          if (num1 > num2) return 1;
          if (num1 < num2) return -1;
      }
      return 0;
  }
}

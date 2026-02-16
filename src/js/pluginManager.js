import { showToast } from './utils.js';
import Chart from 'chart.js/auto';
import { PluginStorage } from './pluginStorage.js';

export class PluginManager {
  constructor(dataService, app) {
    this.dataService = dataService;
    this.app = app;
    this.plugins = new Map(); // id -> pluginModule
    this.customPages = new Map(); // routeId -> { title, renderFn }
    this.homeWidgets = new Map(); // id -> renderFn
    this.widgetOrder = []; 
    this.hooks = new Map(); // hookName -> Set<callback>
    // Context creation is now per-plugin, so strictly speaking consistent single context is tricky if we want unique storage.
    // However, for backward compatibility or general generic context, we can keep a base one or create deeply on load.
    // We will change createPluginContext to accept an ID.
  }

  createPluginContext(pluginId) {
    const storage = pluginId ? new PluginStorage(pluginId) : null;
    
    return {
      appName: 'Easy Accounting',
      version: '2.1.1.1',
      lib: {
        Chart: Chart
      },
      storage: storage, // Expose sandboxed storage
      data: {
        getRecords: () => this.dataService.getRecords(),
        addRecord: (record) => this.dataService.addRecord(record),
        // ... (rest of data methods)
        getDebts: () => this.dataService.getDebts(),
        addDebt: (debt) => this.dataService.addDebt(debt),
        getContacts: () => this.dataService.getContacts(),
        addContact: (contact) => this.dataService.addContact(contact),
        getAccounts: () => this.dataService.getAccounts(),
        getCategories: (type) => this.app.categoryManager.getAllCategories(type),
        getCategory: (type, id) => this.app.categoryManager.getCategoryById(type, id)
      },
      ui: {
        showToast: (msg, type) => showToast(msg, type),
        registerPage: (routeId, title, renderFn) => this.registerPage(routeId, title, renderFn),
        registerHomeWidget: (id, renderFn) => this.registerHomeWidget(id, renderFn),
        navigateTo: (hash) => { window.location.hash = hash; },
        openAddPage: (data) => {
             if (data) sessionStorage.setItem('temp_add_data', JSON.stringify(data));
             // Append timestamp to force hashchange event even if already on #add
             window.location.hash = `#add?t=${Date.now()}`;
        },
        showConfirm: (title, message) => this.showConfirmModal(title, message),
        showAlert: (title, message) => this.showAlertModal(title, message)
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
    const savedOrder = await this.dataService.getSetting('widgetOrder');
    this.widgetOrder = savedOrder ? savedOrder.value : [];
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
        // Sandboxing: Shadow global storage objects
        const sandboxedScript = `
          const localStorage = {
            getItem: () => { throw new Error("Access Denied: Please use context.storage.getItem()") },
            setItem: () => { throw new Error("Access Denied: Please use context.storage.setItem()") },
            removeItem: () => { throw new Error("Access Denied: Please use context.storage.removeItem()") },
            clear: () => { throw new Error("Access Denied: Please use context.storage.clear()") },
            key: () => { throw new Error("Access Denied: Please use context.storage") },
            length: 0
          };
          const sessionStorage = {
            getItem: () => { throw new Error("Access Denied: Please use context.storage") },
            setItem: () => { throw new Error("Access Denied: Please use context.storage") },
            removeItem: () => { throw new Error("Access Denied: Please use context.storage") },
            clear: () => { throw new Error("Access Denied: Please use context.storage") }
          };
          const indexedDB = {
            open: () => { throw new Error("Access Denied: IndexedDB is not allowed in plugins.") },
            deleteDatabase: () => { throw new Error("Access Denied: IndexedDB is not allowed in plugins.") }
          };
          
          // Enhanced Sandboxing: Shadow window and self
          const _windowProxyHandler = {
            get(target, prop) {
               if (prop === 'localStorage' || prop === 'sessionStorage' || prop === 'indexedDB') {
                   throw new Error("Access Denied: Please use context.storage");
               }
               
               // Get value from original window
               let value = Reflect.get(target, prop);
               
               // Bind functions to original target (critical for methods like cancelAnimationFrame, fetch, etc.)
               if (typeof value === 'function') {
                  const bound = value.bind(target);
                  return bound;
               }
               return value;
            },
            set(target, prop, value) {
               if (prop === 'localStorage' || prop === 'sessionStorage' || prop === 'indexedDB') {
                    throw new Error("Access Denied: Cannot overwrite global storage");
               }
               return Reflect.set(target, prop, value);
            }
          };

          // Fix: Capture real global object preventing TDZ with shadowed variables below
          const _realGlobal = (new Function("return this"))();

          const window = new Proxy(_realGlobal, _windowProxyHandler);
          const self = window;
          const globalThis = window; 
          
          // Prevent window.localStorage access if possible (non-configurable in some browsers, but we try)
          // In module scope, 'this' is undefined, and we are shadowing globals.
          
          ${pluginData.script}
        `;

        const blob = new Blob([sandboxedScript], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        
        const module = await import(url);
        if (module.default && typeof module.default.init === 'function') {
            const context = this.createPluginContext(pluginData.id);
            module.default.init(context);
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

  registerHomeWidget(id, renderFn) {
      if (typeof id !== 'string') {
          console.warn('registerHomeWidget now expects (id, renderFn). Ignoring registration.');
          return;
      }
      this.homeWidgets.set(id, renderFn);
      
      // If not in order list, append
      if (!this.widgetOrder.includes(id)) {
          this.widgetOrder.push(id);
      }
      console.log(`Plugin home widget registered: ${id}`);
  }

  renderHomeWidgets(container) {
      if (!container || this.homeWidgets.size === 0) return;
      container.innerHTML = ''; // Clear container first

      // 1. Render based on order
      this.widgetOrder.forEach(id => {
          const renderFn = this.homeWidgets.get(id);
          if (renderFn) {
              this.renderSingleWidget(container, id, renderFn);
          }
      });

      // 2. Render any active widgets NOT in widgetOrder (cleanup/fallback)
      this.homeWidgets.forEach((renderFn, id) => {
          if (!this.widgetOrder.includes(id)) {
              this.renderSingleWidget(container, id, renderFn);
          }
      });
  }

  renderSingleWidget(container, id, renderFn) {
      const widget = document.createElement('div');
      widget.className = 'plugin-widget mb-4';
      widget.dataset.pluginId = id;
      try {
          renderFn(widget);
          container.appendChild(widget);
      } catch (e) {
          console.error(`Error rendering plugin widget ${id}:`, e);
      }
  }

  async moveWidget(id, direction) {
      const index = this.widgetOrder.indexOf(id);
      if (index === -1) return;
      
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.widgetOrder.length) return;
      
      // Swap
      [this.widgetOrder[index], this.widgetOrder[newIndex]] = [this.widgetOrder[newIndex], this.widgetOrder[index]];
      await this.saveWidgetOrder();
  }

  async saveWidgetOrder() {
      await this.dataService.saveSetting({ key: 'widgetOrder', value: this.widgetOrder });
  }

  getCustomPage(routeId) {
      return this.customPages.get(routeId);
  }

  getPluginName(id) {
      const plugin = this.plugins.get(id);
      return plugin ? plugin.meta.name : null;
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
              
              // If hook returns null explicitly, it means "cancel" or "stop"
              if (result === null) {
                  return null;
              }

              if (result !== undefined) {
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

  createModalBase(title, message, buttons) {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 animation-fade-in';
      modal.innerHTML = `
          <div class="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl transform transition-all scale-100">
              <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
              <p class="text-gray-600 mb-6">${message}</p>
              <div class="flex gap-3 justify-end">
                  ${buttons}
              </div>
          </div>
      `;
      document.body.appendChild(modal);
      return modal;
  }

  showConfirmModal(title, message) {
      return new Promise((resolve) => {
          const btns = `
              <button class="px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100 font-medium transition-colors" id="pm-modal-cancel">取消</button>
              <button class="px-4 py-2 rounded-lg bg-wabi-primary text-white hover:bg-opacity-90 font-medium transition-colors" id="pm-modal-confirm">確定</button>
          `;
          const modal = this.createModalBase(title, message, btns);
          
          const close = (result) => {
              modal.remove();
              resolve(result);
          };

          modal.querySelector('#pm-modal-cancel').addEventListener('click', () => close(false));
          modal.querySelector('#pm-modal-confirm').addEventListener('click', () => close(true));
      });
  }

  showAlertModal(title, message) {
      return new Promise((resolve) => {
          const btns = `
              <button class="px-4 py-2 rounded-lg bg-wabi-primary text-white hover:bg-opacity-90 font-medium transition-colors" id="pm-modal-ok">確定</button>
          `;
          const modal = this.createModalBase(title, message, btns);
          
          modal.querySelector('#pm-modal-ok').addEventListener('click', () => {
              modal.remove();
              resolve(true);
          });
      });
  }
}

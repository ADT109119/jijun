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
  }

  // ==================== 安全工具 ====================

  /** 防止 XSS：將 HTML 特殊字元轉義 */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== 權限強制工具 ====================

  /** 建立拒絕存取的 Proxy 替身 */
  _denied(group, permNeeded) {
    const label = PluginManager.PERMISSION_LABELS[permNeeded]?.label || permNeeded;
    return new Proxy({}, {
      get: (_, prop) => () => {
        throw new Error(`Permission Denied: 此插件未取得「${label}」權限，無法呼叫 context.${group}.${prop}()`);
      }
    });
  }

  createPluginContext(pluginId, permissions = []) {
    const has = (perm) => permissions.includes(perm);

    // ---- storage ----
    const storage = has('storage') && pluginId
      ? new PluginStorage(pluginId)
      : this._denied('storage', 'storage');

    // ---- data ----
    const dataRead = has('data:read') ? {
      getRecords: () => this.dataService.getRecords(),
      getDebts: () => this.dataService.getDebts(),
      getContacts: () => this.dataService.getContacts(),
      getAccounts: () => this.dataService.getAccounts(),
      getCategories: (type) => this.app.categoryManager.getAllCategories(type),
      getCategory: (type, id) => this.app.categoryManager.getCategoryById(type, id)
    } : {};

    const dataWrite = has('data:write') ? {
      addRecord: (record) => this.dataService.addRecord(record),
      addDebt: (debt) => this.dataService.addDebt(debt),
      addContact: (contact) => this.dataService.addContact(contact),
    } : {};

    // 合併讀寫，未授權的方法以 Proxy 攔截
    const dataApi = (has('data:read') || has('data:write'))
      ? { ...dataRead, ...dataWrite }
      : this._denied('data', 'data:read');

    // 如果只有其中一種權限，補上另一種的拒絕訊息
    if (has('data:read') && !has('data:write')) {
      const writeDenied = this._denied('data', 'data:write');
      dataApi.addRecord = writeDenied.addRecord;
      dataApi.addDebt = writeDenied.addDebt;
      dataApi.addContact = writeDenied.addContact;
    }
    if (has('data:write') && !has('data:read')) {
      const readDenied = this._denied('data', 'data:read');
      dataApi.getRecords = readDenied.getRecords;
      dataApi.getDebts = readDenied.getDebts;
      dataApi.getContacts = readDenied.getContacts;
      dataApi.getAccounts = readDenied.getAccounts;
      dataApi.getCategories = readDenied.getCategories;
      dataApi.getCategory = readDenied.getCategory;
    }

    // ---- ui ----
    const uiApi = has('ui') ? {
      showToast: (msg, type) => showToast(msg, type),
      registerPage: (routeId, title, renderFn) => this.registerPage(routeId, title, renderFn),
      registerHomeWidget: (id, renderFn) => this.registerHomeWidget(id, renderFn),
      navigateTo: (hash) => { window.location.hash = hash; },
      openAddPage: (data) => {
           if (data) sessionStorage.setItem('temp_add_data', JSON.stringify(data));
           window.location.hash = `#add?t=${Date.now()}`;
      },
      showConfirm: (title, message) => this.showConfirmModal(title, message),
      showAlert: (title, message) => this.showAlertModal(title, message)
    } : this._denied('ui', 'ui');

    // ---- events（始終允許，為基礎能力）----
    const eventsApi = {
      on: (hookName, callback) => this.registerHook(hookName, callback),
      off: (hookName, callback) => this.unregisterHook(hookName, callback)
    };

    return {
      appName: 'Easy Accounting',
      version: __APP_VERSION__,
      lib: { Chart: Chart },
      storage,
      data: dataApi,
      ui: uiApi,
      events: eventsApi,
      hooks: {}
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

  // ==================== 沙盒包裝器 ====================

  /** 生成沙盒前綴程式碼，根據權限阻擋全域儲存、危險 API 與網路存取 */
  _getSandboxWrapper(permissions = []) {
    const hasNetwork = permissions.includes('network');

    // 網路 API 阻擋（僅在無 network 權限時生成）
    const networkBlock = hasNetwork ? '' : `
      const fetch = () => { throw new Error("Permission Denied: 此插件未取得「網路存取」權限，無法使用 fetch()") };
      const XMLHttpRequest = function() { throw new Error("Permission Denied: 此插件未取得「網路存取」權限，無法使用 XMLHttpRequest") };
      const WebSocket = function() { throw new Error("Permission Denied: 此插件未取得「網路存取」權限，無法使用 WebSocket") };
      const EventSource = function() { throw new Error("Permission Denied: 此插件未取得「網路存取」權限，無法使用 EventSource") };
    `;

    // Proxy 中要阻擋的網路屬性清單
    const networkProxyBlock = hasNetwork ? '' : `
           if (prop === 'fetch' || prop === 'XMLHttpRequest' || prop === 'WebSocket' || prop === 'EventSource') {
               throw new Error("Permission Denied: 此插件未取得「網路存取」權限");
           }
    `;

    return `
      // ===== Plugin Sandbox =====
      // 最先取得真正的全域物件（必須在 Function 被覆蓋前執行）
      const _realGlobal = (new Function("return this"))();

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

      // 網路 API 阻擋（根據權限動態生成）
      ${networkBlock}

      // 注意：Function/eval 透過 Proxy 攔截 window.Function / window.eval

      const _windowProxyHandler = {
        get(target, prop) {
           if (prop === 'localStorage' || prop === 'sessionStorage' || prop === 'indexedDB') {
               throw new Error("Access Denied: Please use context.storage");
           }
           if (prop === 'Function') {
               throw new Error("Access Denied: Function constructor is not allowed in plugins.");
           }
           if (prop === 'eval') {
               throw new Error("Access Denied: eval() is not allowed in plugins.");
           }
           ${networkProxyBlock}
           let value = Reflect.get(target, prop);
           if (typeof value === 'function') {
              return value.bind(target);
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

      const window = new Proxy(_realGlobal, _windowProxyHandler);
      const self = window;
      const globalThis = window;
      // ===== End Sandbox =====
    `;
  }

  async loadPlugin(pluginData) {
    try {
        const perms = pluginData.permissions || [];
        const sandboxedScript = `
          ${this._getSandboxWrapper(perms)}
          ${pluginData.script}
        `;

        const blob = new Blob([sandboxedScript], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        
        const module = await import(url);
        if (module.default && typeof module.default.init === 'function') {
            const context = this.createPluginContext(pluginData.id, pluginData.permissions || []);
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

  // ==================== 權限同意 ====================

  /** 權限標籤對照表 */
  static PERMISSION_LABELS = {
    'storage':    { icon: 'fa-database',       label: '儲存空間',     desc: '允許在本機存取插件專屬的儲存空間' },
    'data:read':  { icon: 'fa-eye',            label: '讀取帳務資料', desc: '允許讀取記帳紀錄、帳戶、欠款、分類等資料' },
    'data:write': { icon: 'fa-pen-to-square',  label: '寫入帳務資料', desc: '允許新增或修改記帳紀錄、欠款、聯絡人' },
    'ui':         { icon: 'fa-window-maximize', label: '使用者介面',   desc: '允許註冊頁面、顯示通知、首頁小工具' },
    'network':    { icon: 'fa-globe',           label: '網路存取',     desc: '允許與外部伺服器通訊（如匯率查詢）' },
  };

  /**
   * 顯示權限同意對話框
   * @param {object} meta - 插件的 meta 資訊
   * @param {string[]} permissions - 權限列表
   * @returns {Promise<boolean>} 使用者是否同意
   */
  showPermissionConsent(meta, permissions = [], isUpdate = false) {
    return new Promise((resolve) => {
      const safeName = this._escapeHTML(meta.name || '未知插件');
      const safeAuthor = this._escapeHTML(meta.author || '未知作者');
      const safeDesc = this._escapeHTML(meta.description || '');

      const permListHtml = permissions.length > 0
        ? permissions.map(p => {
            const info = PluginManager.PERMISSION_LABELS[p] || { icon: 'fa-question', label: p, desc: '未知權限' };
            return `
              <div class="flex items-start gap-3 py-2">
                <div class="text-wabi-primary shrink-0 mt-0.5"><i class="fa-solid ${info.icon}"></i></div>
                <div>
                  <p class="text-sm font-medium text-gray-800">${this._escapeHTML(info.label)}</p>
                  <p class="text-xs text-gray-500">${this._escapeHTML(info.desc)}</p>
                </div>
              </div>
            `;
          }).join('')
        : '<p class="text-sm text-gray-500 py-2">此插件未聲明任何特殊權限。</p>';

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 animation-fade-in';
      modal.innerHTML = `
        <div class="bg-white rounded-xl max-w-sm w-full shadow-xl transform transition-all scale-100 overflow-hidden">
          <div class="p-5">
            <div class="flex items-center gap-3 mb-4">
              <div class="bg-wabi-primary/10 text-wabi-primary rounded-lg size-12 flex items-center justify-center text-xl">
                <i class="fa-solid ${meta.icon || 'fa-puzzle-piece'}"></i>
              </div>
              <div>
                <h3 class="text-lg font-bold text-gray-800">${safeName}</h3>
                <p class="text-xs text-gray-500">${safeAuthor}</p>
              </div>
            </div>
            ${safeDesc ? `<p class="text-sm text-gray-600 mb-4">${safeDesc}</p>` : ''}
            <div class="bg-gray-50 rounded-lg p-3 mb-4">
              <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">${isUpdate ? '此更新新增了以下權限' : '此插件將要求以下權限'}</h4>
              <div class="divide-y divide-gray-100">${permListHtml}</div>
            </div>
          </div>
          <div class="flex border-t border-gray-200">
            <button id="pm-perm-cancel" class="flex-1 py-3 text-gray-500 font-medium hover:bg-gray-50 transition-colors">取消</button>
            <button id="pm-perm-accept" class="flex-1 py-3 text-white font-medium bg-wabi-primary hover:bg-wabi-primary/90 transition-colors">${isUpdate ? '同意並更新' : '安裝'}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = (result) => { modal.remove(); resolve(result); };
      modal.querySelector('#pm-perm-cancel').addEventListener('click', () => close(false));
      modal.querySelector('#pm-perm-accept').addEventListener('click', () => close(true));
    });
  }

  async installPlugin(file, storePluginInfo = null) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const scriptContent = e.target.result;
            
            // 驗證時也套用沙盒（驗證階段全面封鎖網路）
             const sandboxedValidation = `
               ${this._getSandboxWrapper([])}
               ${scriptContent}
             `;
             const blob = new Blob([sandboxedValidation], { type: 'text/javascript' });
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

            // 取得權限清單（優先從商店資訊，否則從 meta）
            const permissions = storePluginInfo?.permissions || meta.permissions || [];

            // 檢查是否為更新，並比對權限差異
            let existingPlugin = null;
            try {
                const tx = this.dataService.db.transaction('plugins', 'readonly');
                existingPlugin = await tx.store.get(meta.id);
            } catch(e) { /* ignore */ }

            if (existingPlugin) {
                // 更新：比對新增的權限
                const oldPerms = new Set(existingPlugin.permissions || []);
                const newPerms = permissions.filter(p => !oldPerms.has(p));

                if (newPerms.length > 0) {
                    // 有新增權限，需要使用者同意
                    const accepted = await this.showPermissionConsent(
                      { ...meta, icon: storePluginInfo?.icon },
                      newPerms,
                      true // isUpdate flag
                    );
                    if (!accepted) {
                        reject(new Error('使用者取消更新'));
                        return;
                    }
                }
            } else {
                // 首次安裝：顯示完整權限同意
                const accepted = await this.showPermissionConsent(
                  { ...meta, icon: storePluginInfo?.icon },
                  permissions
                );
                if (!accepted) {
                    reject(new Error('使用者取消安裝'));
                    return;
                }
            }

            const pluginData = {
                id: meta.id || `plugin-${Date.now()}`,
                name: meta.name || file.name,
                version: meta.version || '1.0',
                description: meta.description || '',
                permissions: permissions,
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
      // 防止 XSS：轉義來自插件的 title 與 message
      const safeTitle = this._escapeHTML(title);
      const safeMessage = this._escapeHTML(message);

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 animation-fade-in';
      modal.innerHTML = `
          <div class="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl transform transition-all scale-100">
              <h3 class="text-xl font-bold text-gray-800 mb-2">${safeTitle}</h3>
              <p class="text-gray-600 mb-6">${safeMessage}</p>
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

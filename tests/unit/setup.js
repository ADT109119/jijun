// ==================== 全域 Mock（Vitest jsdom setup）====================

// ── localStorage 預設值 ────────────────────────────────
globalThis.localStorage.setItem('adFreeUntil', '');
globalThis.localStorage.setItem('easy_accounting_settings', JSON.stringify({}));

// ── IndexedDB Mock 狀態 ────────────────────────────────
let nextId = 100;

// 模擬 idb.openDB 的 API（所有 transaction 共用同一份 store data）
const mockDb = {
    // 預先建立每個 store 的資料陣列，所有 transaction 共享
    _storeData: {},

    initStore(name) {
        if (!this._storeData[name]) {
            this._storeData[name] = [];
        }
        return this._storeData[name];
    },

    // 支援 DataService.logChange() 需要的 db.get() API
    async get(keyPath, key) {
        const storeName = typeof keyPath === 'string' ? keyPath : 'records';
        const data = this.initStore(storeName);
        return Promise.resolve(data.find(item => item.id === key) || null);
    },

    transaction(stores, mode) {
        const storeNames = typeof stores === 'string' ? [stores] : stores;
        const storeName = storeNames[0];
        const data = this.initStore(storeName);

        // 每個 store name 只建立一次 sharedStore，確保所有 transaction 共用同一份資料
        if (!this._sharedStores) {
            this._sharedStores = {};
        }
        if (!this._sharedStores[storeName]) {
            this._sharedStores[storeName] = {
                add: (itemData) => {
                    const id = nextId++;
                    data.push({ ...itemData, id });
                    return Promise.resolve(id);
                },
                put: (itemData) => {
                    const idx = data.findIndex(item => item.id === itemData.id);
                    if (idx >= 0) {
                        data[idx] = { ...itemData };
                    }
                    return Promise.resolve();
                },
                get: (id) => {
                    const item = data.find(i => i.id === id);
                    return Promise.resolve(item || null);
                },
                getAll: () => {
                    return Promise.resolve([...data]);
                },
                delete: (id) => {
                    const idx = data.findIndex(i => i.id === id);
                    if (idx >= 0) {
                        data.splice(idx, 1);
                    }
                    return Promise.resolve();
                },
                clear: () => {
                    data.length = 0;
                    return Promise.resolve();
                },
                count: () => {
                    return Promise.resolve(data.length);
                },
                toArray: () => {
                    return Promise.resolve([...data]);
                }
            };
        }

        const sharedStore = this._sharedStores[storeName];

        return {
            store: sharedStore, // 支援 tx.store API
            objectStore(name) {
                return sharedStore; // 支援 tx.objectStore('records') API
            },
            done: Promise.resolve(),
            onerror: null,
            onabort: null,
            oncomplete: null
        };
    }
};

// 初始化所有 store
for (const name of ['ledgers', 'records', 'accounts', 'contacts', 'debts', 'recurring_transactions', 'amortizations']) {
    mockDb.initStore(name);
}

// 覆蓋 idb.openDB（dataService 使用 window.idb?.openDB）
globalThis.window = globalThis;
if (!globalThis.idb) {
    globalThis.idb = { openDB: () => Promise.resolve(mockDb) };
}

// ── GPT / googletag Mock ───────────────────────────────
const gptListeners = [];
globalThis.googletag = {
    cmd: { push: (fn) => fn() },
    pubads: () => ({
        addEventListener(type, handler) {
            gptListeners.push({ type, handler });
            return { remove: () => {} };
        },
        removeEventListener(type, handler) {
            const idx = gptListeners.findIndex(l => l.type === type && l.handler === handler);
            if (idx >= 0) gptListeners.splice(idx, 1);
        },
        enableServices: vi.fn(),
        destroySlots: vi.fn(() => {}),
    }),
    enums: { OutOfPageFormat: { REWARDED: 'rewarded' } }
};

vi.mock('idb', () => ({ openDB: () => Promise.resolve(mockDb) }));

// ── Capacitor Mock（非原生平台）──────────────────────────
globalThis.Capacitor = { isNativePlatform: () => false };

// ── beforeEach / afterEach 清理 ────────────────────────
beforeEach(() => {
    // 清空所有 store 資料（使用 mockDb._storeData）
    if (mockDb && mockDb._storeData) {
        for (const name of Object.keys(mockDb._storeData)) {
            mockDb._storeData[name].length = 0;
        }
    }
    // 重置 sharedStores 確保每個測試獲得全新狀態
    if (mockDb) {
        mockDb._sharedStores = {};
    }
    nextId = 100;
    gptListeners.length = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    // 移除可能殘留的 DOM
    document.body.innerHTML = '';
});

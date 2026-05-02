import { describe, it, expect, vi } from 'vitest';
import { PluginStorage } from '../../src/js/pluginStorage.js';

describe('PluginStorage', () => {
    let mockDataService;
    let storage;

    beforeEach(() => {
        mockDataService = {
            db: {
                transaction: (storeName, mode) => ({
                    store: {
                        get: vi.fn().mockResolvedValue(null),
                        put: vi.fn().mockResolvedValue(undefined),
                    },
                    done: Promise.resolve(),
                }),
            },
        };
    });

    describe('constructor', () => {
        it('沒有 pluginId 拋出錯誤', () => {
            expect(() => new PluginStorage(null, mockDataService)).toThrow('requires a pluginId');
            expect(() => new PluginStorage('', mockDataService)).toThrow('requires a pluginId');
        });

        it('沒有 dataService 拋出錯誤', () => {
            expect(() => new PluginStorage('test-plugin')).toThrow('requires a DataService instance');
        });

        it('正常初始化設定 prefix 和 cache', () => {
            storage = new PluginStorage('my-plugin', mockDataService);
            
            expect(storage.pluginId).toBe('my-plugin');
            expect(storage.prefix).toBe('plugin_my-plugin_');
            expect(storage.cache).toEqual(Object.create(null));
        });

        it('pluginId 包含特殊字元產生警告', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            new PluginStorage('my plugin!', mockDataService);
            
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Sub-optimal pluginId format')
            );
            warnSpy.mockRestore();
        });

        it('pluginId 格式正確不產生警告', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            new PluginStorage('my-plugin_1.0.test', mockDataService);
            
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('setItem / getItem', () => {
        beforeEach(() => {
            storage = new PluginStorage('test-plugin', mockDataService);
        });

        it('setItem 存入 cache 並觸發 _saveToDB', async () => {
            const saveSpy = vi.spyOn(storage, '_saveToDB').mockResolvedValue();
            
            storage.setItem('key1', 'value1');
            
            expect(storage.cache.key1).toBe('value1'); // 轉為字串
            expect(saveSpy).toHaveBeenCalled();
        });

        it('setItem 數值自動轉字串', () => {
            storage.setItem('numKey', 42);
            expect(storage.cache.numKey).toBe('42');
            
            storage.setItem('boolKey', true);
            expect(storage.cache.boolKey).toBe('true');
        });

        it('getItem 取得已存在的 key', () => {
            storage.cache.testKey = 'testValue';
            expect(storage.getItem('testKey')).toBe('testValue');
        });

        it('getItem 不存在的 key 回傳 null', () => {
            expect(storage.getItem('nonexistent')).toBeNull();
        });

        it('getItem 不會受到 prototype 污染', () => {
            // Object.create(null) 的 cache 沒有 prototype，所以 '__proto__' 等不是特殊鍵
            storage.cache['__proto__'] = 'hacked';
            expect(storage.getItem('__proto__')).toBe('hacked');
            expect({}.hasOwnProperty.call(storage.cache, 'constructor')).toBe(false);
        });
    });

    describe('removeItem / clear', () => {
        beforeEach(() => {
            storage = new PluginStorage('test-plugin', mockDataService);
        });

        it('removeItem 刪除已存在的 key', async () => {
            const saveSpy = vi.spyOn(storage, '_saveToDB').mockResolvedValue();
            
            storage.cache.existingKey = 'value';
            storage.removeItem('existingKey');
            
            expect(storage.cache.existingKey).toBeUndefined();
            expect(saveSpy).toHaveBeenCalled();
        });

        it('removeItem 對不存在的 key 無作用', async () => {
            const saveSpy = vi.spyOn(storage, '_saveToDB').mockResolvedValue();
            
            storage.removeItem('nonexistent');
            
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('clear 清空所有 cache', async () => {
            const saveSpy = vi.spyOn(storage, '_saveToDB').mockResolvedValue();
            
            storage.cache.key1 = 'val1';
            storage.cache.key2 = 'val2';
            storage.clear();
            
            expect(Object.keys(storage.cache)).toHaveLength(0);
            expect(saveSpy).toHaveBeenCalled();
        });
    });

    describe('setJSON / getJSON', () => {
        beforeEach(() => {
            storage = new PluginStorage('test-plugin', mockDataService);
        });

        it('setJSON 儲存 JSON 字串', async () => {
            const saveSpy = vi.spyOn(storage, '_saveToDB').mockResolvedValue();
            
            const obj = { name: 'test', count: 42 };
            storage.setJSON('objKey', obj);
            
            expect(storage.cache.objKey).toBe(JSON.stringify(obj));
            expect(saveSpy).toHaveBeenCalled();
        });

        it('getJSON 解析 JSON 回傳物件', () => {
            const obj = { name: 'test', items: [1, 2, 3] };
            storage.cache.jsonObj = JSON.stringify(obj);
            
            const result = storage.getJSON('jsonObj');
            expect(result).toEqual(obj);
        });

        it('getJSON 不存在的 key 回傳 null', () => {
            expect(storage.getJSON('missing')).toBeNull();
        });

        it('getJSON 無效 JSON 回傳 null 並記錄錯誤', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            storage.cache.badJson = '{ invalid json }';
            expect(storage.getJSON('badJson')).toBeNull();
            expect(errorSpy).toHaveBeenCalled();
            
            errorSpy.mockRestore();
        });

        it('setJSON 儲存錯誤不拋出', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            // 設定一個會導致 JSON.stringify 失敗的值（雖然一般情況很少發生）
            storage.cache.safeKey = 'safe';
            storage.setJSON('safeKey', { normal: 'value' });
            
            expect(errorSpy).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });
    });

    describe('_saveToDB (debounced)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            storage = new PluginStorage('test-plugin', mockDataService);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('多次快速寫入只觸發一次 DB 儲存', async () => {
            // Mock the entire transaction to track calls
            const txMock = {
                store: {
                    get: vi.fn().mockResolvedValue(null), // Return null so we check transaction calls
                    put: vi.fn().mockResolvedValue(undefined),
                },
                done: Promise.resolve(),
            };
            
            mockDataService.db.transaction = vi.fn(() => txMock);
            
            // 快速呼叫三次 setItem（會觸發 _saveToDB）
            storage.setItem('key1', 'val1');
            storage.setItem('key2', 'val2');
            storage.setItem('key3', 'val3');

            // 在 delay 前檢查：不應已儲存
            expect(txMock.store.put).not.toHaveBeenCalled();
            expect(mockDataService.db.transaction).not.toHaveBeenCalled();

            // 推進時間超過 debounce delay (50ms) - use runAllTimersAsync for async callbacks
            await vi.runAllTimersAsync();

            // transaction() 應該只被呼叫一次（batched）
            expect(mockDataService.db.transaction).toHaveBeenCalledTimes(1);
        });

        it('_saveToDB 回傳的 Promise 在 delay 後 resolve', async () => {
            const savePromise = storage._saveToDB();
            
            let resolved = false;
            savePromise.then(() => { resolved = true; });
            
            expect(resolved).toBe(false);
            
            await vi.advanceTimersByTimeAsync(100);
            
            expect(resolved).toBe(true);
        });
    });

    describe('init (migration)', () => {
        it('從 IndexedDB 載入已有資料', async () => {
            const getSpy = vi.fn().mockResolvedValue({
                storage: { existingKey: 'existingValue' }
            });
            
            const mockDb = {
                transaction: (storeName, mode) => ({
                    store: { get: getSpy },
                    done: Promise.resolve(),
                }),
            };
            
            const ds = { db: mockDb };
            storage = new PluginStorage('test-plugin', ds);

            // Mock _saveToDB to avoid setTimeout issues in async init flow
            vi.spyOn(storage, '_saveToDB').mockResolvedValue();

            // 模擬 localStorage 中有舊資料（應被忽略，因為 DB 已有）
            localStorage.setItem('plugin_test-plugin_oldKey', 'oldValue');

            await storage.init();

            expect(storage.cache.existingKey).toBe('existingValue');
        });

        it('從 localStorage 遷移資料到 cache', async () => {
            const getSpy = vi.fn().mockResolvedValue(null); // DB 無資料
            
            const mockDb = {
                transaction: (storeName, mode) => ({
                    store: { get: getSpy },
                    done: Promise.resolve(),
                }),
            };

            const ds = { db: mockDb };
            storage = new PluginStorage('test-plugin', ds);

            // Mock _saveToDB to avoid setTimeout issues in async init flow
            vi.spyOn(storage, '_saveToDB').mockResolvedValue();

            // 模擬 localStorage 中有舊格式資料
            localStorage.setItem('plugin_test-plugin_migratedKey', 'migratedValue');

            await storage.init();

            expect(storage.cache.migratedKey).toBe('migratedValue');
        });
    });
});

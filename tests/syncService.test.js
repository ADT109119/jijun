import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SyncService from '../src/js/syncService.js';

describe('SyncService', () => {
    let mockDataService;
    let syncService;

    beforeEach(() => {
        // Mock global scope implementations
        globalThis.localStorage = {
            store: {},
            getItem(key) { return this.store[key] || null; },
            setItem(key, value) { this.store[key] = String(value); },
            removeItem(key) { delete this.store[key]; },
            clear() { this.store = {}; }
        };

        globalThis.fetch = vi.fn();

        // Create a mocked DataService
        mockDataService = {
            getSetting: vi.fn(),
            saveSetting: vi.fn(),
            getChangesSince: vi.fn().mockResolvedValue([]),
            exportDataForSync: vi.fn().mockResolvedValue({}),
            getByUUID: vi.fn(),
            addLedger: vi.fn(),
            addRecord: vi.fn(),
            addAccount: vi.fn(),
            addContact: vi.fn(),
            addDebt: vi.fn(),
            addRecurringTransaction: vi.fn(),
            updateLedger: vi.fn(),
            updateRecord: vi.fn(),
            updateAccount: vi.fn(),
            updateContact: vi.fn(),
            updateDebt: vi.fn(),
            updateRecurringTransaction: vi.fn(),
            deleteLedger: vi.fn(),
            deleteRecord: vi.fn(),
            deleteAccount: vi.fn(),
            deleteContact: vi.fn(),
            deleteDebt: vi.fn(),
            deleteRecurringTransaction: vi.fn(),
            getLedgers: vi.fn().mockResolvedValue([]),
            getAccounts: vi.fn().mockResolvedValue([]),
            getContacts: vi.fn().mockResolvedValue([]),
            getDebts: vi.fn().mockResolvedValue([]),
            getRecords: vi.fn().mockResolvedValue([]),
            activeLedgerId: 1
        };

        syncService = new SyncService(mockDataService);

        // Mock token for methods that require auth
        syncService.accessToken = 'mock-access-token';
        syncService.refreshToken = 'mock-refresh-token';
        syncService.tokenExpiresAt = Date.now() + 3600000;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Initialization & Auth', () => {
        it('should initialize with stored tokens', async () => {
            // Provide a mock fetch to avoid undefined errors in init() if token expires
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'new-access', expires_in: 3600 })
            });

            mockDataService.getSetting.mockImplementation(async (key) => {
                if (key === 'sync_tokens') return { value: { access_token: 'stored-access', refresh_token: 'stored-refresh', expires_at: Date.now() + 1000000 } }; // Future expiration to avoid triggering refresh
                if (key === 'sync_server_url') return { value: 'https://custom.server.com' };
                return null;
            });

            const freshService = new SyncService(mockDataService);
            await freshService.init();

            expect(freshService.accessToken).toBe('stored-access');
            expect(freshService.serverUrl).toBe('https://custom.server.com');
            expect(freshService.isSignedIn()).toBe(true);
        });

        it('should refresh token if expiring soon during init', async () => {
            mockDataService.getSetting.mockImplementation(async (key) => {
                if (key === 'sync_tokens') return { value: { access_token: 'old-access', refresh_token: 'valid-refresh', expires_at: Date.now() - 1000 } }; // Expired
                return null;
            });

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'new-access', expires_in: 3600 })
            });

            const freshService = new SyncService(mockDataService);
            await freshService.init();

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            expect(freshService.accessToken).toBe('new-access');
        });

        it('should handle signOut correctly', async () => {
            await syncService.signOut();
            expect(syncService.accessToken).toBeNull();
            expect(syncService.refreshToken).toBeNull();
            expect(syncService.isSignedIn()).toBe(false);
            expect(mockDataService.saveSetting).toHaveBeenCalledWith({ key: 'sync_tokens', value: null });
        });
    });

    describe('Drive Backup', () => {
        it('should backup to drive', async () => {
            // Mock cleanupOldBackups to prevent extra fetch calls in this test
            vi.spyOn(syncService, 'cleanupOldBackups').mockResolvedValue();

            mockDataService.exportDataForSync.mockResolvedValue({ records: [{ id: 1 }] });

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'new-file-id' })
            });

            const result = await syncService.backupToDrive();

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            const fetchArgs = globalThis.fetch.mock.calls[0];
            expect(fetchArgs[0]).toContain('uploadType=multipart');
            expect(fetchArgs[1].method).toBe('POST');

            expect(mockDataService.saveSetting).toHaveBeenCalledWith(expect.objectContaining({
                key: 'sync_last_backup'
            }));
            expect(result.id).toBe('new-file-id');
        });

        it('should list backups', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ files: [{ id: 'f1', name: 'backup_1.json' }] })
            });

            const files = await syncService.listBackups();
            expect(files).toHaveLength(1);
            expect(files[0].id).toBe('f1');
        });
    });

    describe('Multi-device Sync (Push/Pull)', () => {
        it('should push local changes to drive', async () => {
            const mockChanges = [{ operation: 'add', storeName: 'records', timestamp: 12345, data: { id: 1 } }];
            mockDataService.getChangesSince.mockResolvedValue(mockChanges);
            mockDataService.getSetting.mockResolvedValue({ value: 0 }); // last push = 0

            // Mock finding existing file (null = no file)
            vi.spyOn(syncService, '_findFile').mockResolvedValue(null);
            vi.spyOn(syncService, '_createFile').mockResolvedValue({ id: 'new-sync-log' });

            await syncService.pushChanges();

            expect(syncService._findFile).toHaveBeenCalled();
            expect(syncService._createFile).toHaveBeenCalled();
            expect(mockDataService.saveSetting).toHaveBeenCalledWith({ key: 'sync_last_push_timestamp', value: 12345 });
        });

        it('should pull and apply remote changes', async () => {
            // Mock listing files
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    files: [{ id: 'file-remote', name: 'sync_log_remote.json', modifiedTime: new Date(Date.now() + 1000).toISOString() }]
                })
            });

            // Mock downloading file content
            vi.spyOn(syncService, '_downloadFile').mockResolvedValue({
                changes: [
                    { operation: 'add', storeName: 'accounts', timestamp: 100, data: { id: 1, name: 'Remote Acc', uuid: 'acc-uuid' } },
                    { operation: 'add', storeName: 'records', timestamp: 200, data: { id: 1, amount: 50, accountUuid: 'acc-uuid', uuid: 'rec-uuid' } },
                    { operation: 'update', storeName: 'records', timestamp: 300, data: { uuid: 'rec-uuid', amount: 100 } }
                ]
            });

            vi.spyOn(syncService, '_applyAdd').mockResolvedValue();
            vi.spyOn(syncService, '_applyUpdate').mockResolvedValue();

            await syncService.pullChanges();

            // applyRemoteChanges logic check
            expect(syncService._applyAdd).toHaveBeenCalledTimes(2);
            expect(syncService._applyUpdate).toHaveBeenCalledTimes(1);

            // Accounts should be applied before records (topoOrder logic)
            expect(syncService._applyAdd.mock.calls[0][0]).toBe('accounts');
            expect(syncService._applyAdd.mock.calls[1][0]).toBe('records');

            expect(mockDataService.saveSetting).toHaveBeenCalledWith(expect.objectContaining({ key: 'sync_last_sync' }));
        });
    });

    describe('applyRemoteChanges Conflict Resolution & Ordering', () => {
        it('should enforce topological sorting during add phase', async () => {
            const changes = [
                { operation: 'add', storeName: 'records', timestamp: 100, data: { uuid: 'rec-1' } },
                { operation: 'add', storeName: 'ledgers', timestamp: 200, data: { uuid: 'ledg-1' } }, // newer but should be created first
            ];

            const appliedOrder = [];
            vi.spyOn(syncService, '_applyAdd').mockImplementation(async (store) => {
                appliedOrder.push(store);
            });

            await syncService.applyRemoteChanges(changes);

            expect(appliedOrder[0]).toBe('ledgers');
            expect(appliedOrder[1]).toBe('records');
        });

        it('should update locally mapped UUIDs', async () => {
            const updateChange = [
                { operation: 'update', storeName: 'records', timestamp: 100, data: { uuid: 'rec-1', amount: 999 } }
            ];

            mockDataService.getByUUID.mockResolvedValue({ id: 55, uuid: 'rec-1' }); // Mock local DB finding the record

            await syncService.applyRemoteChanges(updateChange);

            expect(mockDataService.getByUUID).toHaveBeenCalledWith('records', 'rec-1');
            expect(mockDataService.updateRecord).toHaveBeenCalledWith(55, expect.objectContaining({ amount: 999 }), true);
        });

        it('should ignore legacy updates without UUID to prevent corruption', async () => {
            const legacyUpdate = [
                { operation: 'update', storeName: 'records', timestamp: 100, data: { amount: 999 } } // No UUID
            ];

            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await syncService.applyRemoteChanges(legacyUpdate);

            expect(mockDataService.updateRecord).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledWith('[SyncService] Legacy update without UUID ignored:', 'records');
            consoleWarnSpy.mockRestore();
        });
    });

    describe('Foreign Key Resolution (_resolveAllForeignKeys)', () => {
        it('should resolve accountUuid to local accountId for a record', async () => {
            const data = { accountUuid: 'target-uuid' };

            mockDataService.getAccounts.mockResolvedValue([
                { id: 99, uuid: 'target-uuid' }
            ]);

            const resolved = await syncService._resolveRecordAccountId(data);
            expect(resolved.accountId).toBe(99);
            expect(resolved.accountUuid).toBe('target-uuid'); // preserve original
        });

        it('should set accountId to null if UUID is not found', async () => {
            const data = { accountUuid: 'missing-uuid' };

            mockDataService.getAccounts.mockResolvedValue([]);

            const resolved = await syncService._resolveRecordAccountId(data);
            expect(resolved.accountId).toBeNull();
        });
    });
});

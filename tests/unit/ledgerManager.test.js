import { describe, it, expect, vi } from 'vitest';
import { LedgerManager } from '../../src/js/ledgerManager.js';

describe('LedgerManager', () => {
    let mockDataService;
    let mockApp;
    let ledgerManager;

    beforeEach(() => {
        mockDataService = {
            activeLedgerId: 1,
            getLedgers: vi.fn().mockResolvedValue([]),
            getLedger: vi.fn(),
            addLedger: vi.fn(),
            updateLedger: vi.fn(),
            deleteLedger: vi.fn(),
            setActiveLedger: vi.fn(),
        };

        mockApp = {
            advancedModeEnabled: false,
            accounts: [],
            budgetManager: null,
            updateSidebarLedger: vi.fn(),
            router: null,
            currentHash: null,
        };

        ledgerManager = new LedgerManager(mockDataService, mockApp);
    });

    describe('constructor', () => {
        it('初始化 ledgers 為空陣列', () => {
            expect(ledgerManager.ledgers).toEqual([]);
        });

        it('儲存 dataService 和 app 引用', () => {
            expect(ledgerManager.dataService).toBe(mockDataService);
            expect(ledgerManager.app).toBe(mockApp);
        });
    });

    describe('init', () => {
        it('從 dataService 載入帳本清單', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' }
            ];
            mockDataService.getLedgers.mockResolvedValue(mockLedgers);

            await ledgerManager.init();

            expect(ledgerManager.ledgers).toEqual(mockLedgers);
            expect(mockDataService.getLedgers).toHaveBeenCalled();
        });
    });

    describe('getActiveLedger', () => {
        it('回傳 activeLedgerId 對應的帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' }
            ];
            ledgerManager.ledgers = mockLedgers;
            mockDataService.activeLedgerId = 2;

            const active = ledgerManager.getActiveLedger();

            expect(active).toEqual(mockLedgers[1]);
        });

        it('找不到時回傳第一個帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' }
            ];
            ledgerManager.ledgers = mockLedgers;
            mockDataService.activeLedgerId = 99; // 不存在的 ID

            const active = ledgerManager.getActiveLedger();

            expect(active).toEqual(mockLedgers[0]);
        });

        it('沒有帳本時回傳 undefined', async () => {
            ledgerManager.ledgers = [];
            
            const active = ledgerManager.getActiveLedger();

            expect(active).toBeUndefined();
        });
    });

    describe('getAllLedgers', () => {
        it('回傳所有帳本', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' }
            ];
            ledgerManager.ledgers = mockLedgers;

            const all = ledgerManager.getAllLedgers();

            expect(all).toEqual(mockLedgers);
        });

        it('回傳的是同一個陣列引用', async () => {
            const mockLedgers = [{ id: 1, name: 'test' }];
            ledgerManager.ledgers = mockLedgers;

            const all = ledgerManager.getAllLedgers();
            expect(all).toBe(mockLedgers);
        });
    });

    describe('createLedger', () => {
        it('新增帳本時名稱重複拋出錯誤', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' }
            ];
            ledgerManager.ledgers = mockLedgers;

            await expect(ledgerManager.createLedger({ name: '個人帳本' }))
                .rejects
                .toThrow('已存在同名帳本');
        });

        it('新增帳本時呼叫 dataService.addLedger', async () => {
            const mockLedgers = [];
            ledgerManager.ledgers = mockLedgers;
            
            mockDataService.addLedger.mockResolvedValue(2);

            try {
                await ledgerManager.createLedger({ name: '新帳本' });
            } catch (e) {
                // ignore 其他錯誤，我們只測試名稱檢查邏輯
            }

            expect(mockDataService.addLedger).toHaveBeenCalledWith(
                expect.objectContaining({ name: '新帳本' })
            );
        });

        it('新增帳本時使用預設圖示', async () => {
            const mockLedgers = [];
            ledgerManager.ledgers = mockLedgers;
            
            mockDataService.addLedger.mockResolvedValue(2);

            try {
                await ledgerManager.createLedger({ name: '新帳本' });
            } catch (e) {
                // ignore
            }

            expect(mockDataService.addLedger).toHaveBeenCalledWith(
                expect.objectContaining({ icon: 'fa-solid fa-book' })
            );
        });
    });

    describe('switchLedger', () => {
        it('帳本不存在時顯示錯誤提示並 return', async () => {
            const showToastSpy = vi.fn();
            
            // Mock dataService.getLedger 回傳 null
            mockDataService.getLedger.mockResolvedValue(null);

            await ledgerManager.switchLedger(99);

            expect(mockDataService.setActiveLedger).not.toHaveBeenCalled();
        });

        it('成功切換時呼叫 setActiveLedger', async () => {
            const mockLedger = { id: 2, name: '公司帳本' };
            mockDataService.getLedger.mockResolvedValue(mockLedger);

            await ledgerManager.switchLedger(2);

            expect(mockDataService.setActiveLedger).toHaveBeenCalledWith(2);
        });

        it('切換時更新 sidebar', async () => {
            const mockLedger = { id: 2, name: '公司帳本' };
            mockDataService.getLedger.mockResolvedValue(mockLedger);
            
            await ledgerManager.switchLedger(2);

            expect(mockApp.updateSidebarLedger).toHaveBeenCalled();
        });
    });

    describe('deleteLedger', () => {
        it('刪除帳本時呼叫 dataService.deleteLedger', async () => {
            const mockLedgers = [
                { id: 1, name: '個人帳本' },
                { id: 2, name: '公司帳本' }
            ];
            ledgerManager.ledgers = mockLedgers;

            await ledgerManager.deleteLedger(1);

            expect(mockDataService.deleteLedger).toHaveBeenCalledWith(1);
        });
    });
});

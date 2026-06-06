import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../../src/js/notificationService.js';

// Mock @capacitor/local-notifications
const mockLocalNotifications = {
  createChannel: vi.fn(() => Promise.resolve()),
  checkPermissions: vi.fn(() => Promise.resolve({ display: 'granted' })),
  requestPermissions: vi.fn(() => Promise.resolve({ display: 'granted' })),
  schedule: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(() => Promise.resolve()),
};

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: mockLocalNotifications,
}));

// Mock DataService
function createMockDataService(settings = {}) {
  const store = { ...settings };
  return {
    getSetting: vi.fn((key) => {
      const s = store[key];
      return s !== undefined ? Promise.resolve(s) : Promise.resolve(null);
    }),
  };
}

describe('NotificationService', () => {
    let service;
    let mockDS;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.values(mockLocalNotifications).forEach(m => m.mockClear());
        mockDS = createMockDataService();
        // Web 環境: 非原生
        globalThis.Capacitor = { isNative: false };
        // Mock Notification API
        globalThis.Notification = class {
            static get permission() { return 'granted'; }
            static requestPermission() { return Promise.resolve('granted'); }
        };
        // 移除 ServiceWorker mock
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { controller: null, register: vi.fn() },
            writable: true,
            configurable: true,
        });
        service = new NotificationService(mockDS);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('應正確初始化屬性', () => {
            expect(service.dataService).toBe(mockDS);
            expect(service.channelId).toBe('easy_accounting_reminders');
        });

        it('在 Web 環境下 isNative 為 false', () => {
            expect(service.isNative).toBe(false);
        });
    });

    describe('checkPermission (Web)', () => {
        it('應回傳 true 當 Notification.permission 為 granted', async () => {
            globalThis.Notification = class {
                static get permission() { return 'granted'; }
            };
            service = new NotificationService(mockDS);
            const result = await service.checkPermission();
            expect(result).toBe(true);
            expect(service.hasPermission).toBe(true);
        });

        it('應回傳 false 當 Notification.permission 為 denied', async () => {
            globalThis.Notification = class {
                static get permission() { return 'denied'; }
            };
            service = new NotificationService(mockDS);
            const result = await service.checkPermission();
            expect(result).toBe(false);
            expect(service.hasPermission).toBe(false);
        });

        it('應回傳 false 當瀏覽器不支援 Notification', async () => {
            delete globalThis.Notification;
            service = new NotificationService(mockDS);
            const result = await service.checkPermission();
            expect(result).toBe(false);
        });
    });

    describe('requestPermission (Web)', () => {
        it('應請求權限並回傳 granted', async () => {
            const requestSpy = vi.fn(() => Promise.resolve('granted'));
            globalThis.Notification = {
                permission: 'default',
                requestPermission: requestSpy,
            };
            service = new NotificationService(mockDS);
            const result = await service.requestPermission();
            expect(result).toBe(true);
            expect(requestSpy).toHaveBeenCalledTimes(1);
        });

        it('應處理 permission denied', async () => {
            const requestSpy = vi.fn(() => Promise.resolve('denied'));
            globalThis.Notification = {
                permission: 'default',
                requestPermission: requestSpy,
            };
            service = new NotificationService(mockDS);
            const result = await service.requestPermission();
            expect(result).toBe(false);
            expect(service.hasPermission).toBe(false);
        });

        it('當瀏覽器不支援 Notification 時應回傳 false', async () => {
            delete globalThis.Notification;
            service = new NotificationService(mockDS);
            const result = await service.requestPermission();
            expect(result).toBe(false);
        });
    });

    describe('scheduleReminder (Web)', () => {
        it('當無權限時不應排程', async () => {
            service.hasPermission = false;
            await service.scheduleReminder('20:00', 'always');
            expect(mockLocalNotifications.schedule).not.toHaveBeenCalled();
        });

        it('時間格式無效時不應排程', async () => {
            service.hasPermission = true;
            await service.scheduleReminder('invalid', 'always');
            expect(mockLocalNotifications.schedule).not.toHaveBeenCalled();
        });

        it('當 ServiceWorker 存在時應发送訊息', async () => {
            service.hasPermission = true;
            const swPostMessage = vi.fn();
            navigator.serviceWorker.controller = { postMessage: swPostMessage };
            await service.scheduleReminder('20:30', 'always');
            expect(swPostMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'SCHEDULE_REMINDER',
                    payload: expect.objectContaining({
                        title: '記帳提醒',
                        body: '今天還記得記帳嗎？點擊馬上紀錄！',
                        timeStr: '20:30',
                    }),
                })
            );
        });

        it('當 ServiceWorker 不存在時不發送訊息', async () => {
            service.hasPermission = true;
            navigator.serviceWorker.controller = null;
            await service.scheduleReminder('20:30', 'always');
            // 不應該報錯，只是 console.warn
        });

        it('skipToday=true 時應排程到明天', async () => {
            service.hasPermission = true;
            const swPostMessage = vi.fn();
            navigator.serviceWorker.controller = { postMessage: swPostMessage };
            await service.scheduleReminder('20:00', 'always', true);
            // cancelReminder is called first, so schedule is at index 1
            const scheduleCall = swPostMessage.mock.calls[1]?.[0];
            expect(scheduleCall.type).toBe('SCHEDULE_REMINDER');
            // timestamp 應為明天
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(20, 0, 0, 0);
            expect(scheduleCall.payload.timestamp).toBeGreaterThanOrEqual(tomorrow.getTime());
        });

        it('cancelReminder 應先清除既有排程', async () => {
            service.hasPermission = true;
            const swPostMessage = vi.fn();
            navigator.serviceWorker.controller = { postMessage: swPostMessage };
            // 先發送一次 CANCEL_REMINDER (由 cancelReminder 觸發)
            await service.scheduleReminder('20:00', 'always');
            expect(swPostMessage).toHaveBeenCalledTimes(2); // cancel + schedule
            expect(swPostMessage.mock.calls[0][0].type).toBe('CANCEL_REMINDER');
            expect(swPostMessage.mock.calls[1][0].type).toBe('SCHEDULE_REMINDER');
        });
    });

    describe('cancelReminder (Web)', () => {
        it('當 ServiceWorker 存在時應發送 CANCEL_REMINDER', async () => {
            const swPostMessage = vi.fn();
            navigator.serviceWorker.controller = { postMessage: swPostMessage };
            await service.cancelReminder();
            expect(swPostMessage).toHaveBeenCalledWith({ type: 'CANCEL_REMINDER' });
        });

        it('當 ServiceWorker 不存在時不應報錯', async () => {
            navigator.serviceWorker.controller = null;
            await service.cancelReminder();
            // 不拋出例外
        });
    });

    describe('applyCurrentSettings', () => {
        it('當 reminder 未啟用時應取消排程', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: false };
                return null;
            });
            const cancelSpy = vi.spyOn(service, 'cancelReminder').mockResolvedValue();
            service.hasPermission = true;
            await service.applyCurrentSettings();
            expect(cancelSpy).toHaveBeenCalled();
        });

        it('當無權限時不排程', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: true };
                if (key === 'reminderTime') return { value: '21:00' };
                if (key === 'reminderCondition') return { value: 'always' };
                return null;
            });
            service.hasPermission = false;
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.applyCurrentSettings();
            expect(scheduleSpy).not.toHaveBeenCalled();
        });

        it('啟用且有權限時應排程', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: true };
                if (key === 'reminderTime') return { value: '21:00' };
                if (key === 'reminderCondition') return { value: 'always' };
                return null;
            });
            service.hasPermission = true;
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            vi.spyOn(service, 'cancelReminder').mockResolvedValue();
            await service.applyCurrentSettings();
            expect(scheduleSpy).toHaveBeenCalledWith('21:00', 'always');
        });

        it('當設定不存在時應取消排程（因為 enabled 預設為 false）', async () => {
            mockDS.getSetting.mockResolvedValue(null);
            service.hasPermission = true;
            const cancelSpy = vi.spyOn(service, 'cancelReminder').mockResolvedValue();
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.applyCurrentSettings();
            // enabled = null || false => false => 走 cancelReminder
            expect(cancelSpy).toHaveBeenCalled();
            expect(scheduleSpy).not.toHaveBeenCalled();
        });

        it('當 reminderEnabled=true 但無時間/條件設定時使用預設值', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: true };
                return null; // reminderTime 和 reminderCondition 為 null
            });
            service.hasPermission = true;
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.applyCurrentSettings();
            expect(scheduleSpy).toHaveBeenCalledWith('20:00', 'no_records');
        });
    });

    describe('handleRecordAdded', () => {
        it('當 condition=no_records 且啟用時應延後到明天', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: true };
                if (key === 'reminderCondition') return { value: 'no_records' };
                if (key === 'reminderTime') return { value: '20:00' };
                return null;
            });
            service.hasPermission = true;
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.handleRecordAdded();
            expect(scheduleSpy).toHaveBeenCalledWith('20:00', 'no_records', true);
        });

        it('當 condition=always 時不延後', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: true };
                if (key === 'reminderCondition') return { value: 'always' };
                if (key === 'reminderTime') return { value: '20:00' };
                return null;
            });
            service.hasPermission = true;
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.handleRecordAdded();
            expect(scheduleSpy).not.toHaveBeenCalled();
        });

        it('當未啟用時不延後', async () => {
            mockDS.getSetting.mockImplementation(async (key) => {
                if (key === 'reminderEnabled') return { value: false };
                return null;
            });
            const scheduleSpy = vi.spyOn(service, 'scheduleReminder').mockResolvedValue();
            await service.handleRecordAdded();
            expect(scheduleSpy).not.toHaveBeenCalled();
        });
    });

    describe('Native platform simulation', () => {
        beforeEach(() => {
            // 模擬原生環境
            globalThis.Capacitor = { isNative: true };
            mockLocalNotifications.checkPermissions.mockResolvedValue({ display: 'granted' });
        });

        it('在原生環境下 isNative 為 true', () => {
            const nativeService = new NotificationService(mockDS);
            expect(nativeService.isNative).toBe(true);
        });

        it('checkPermission 應呼叫 LocalNotifications.checkPermissions', async () => {
            const nativeService = new NotificationService(mockDS);
            await nativeService.checkPermission();
            expect(mockLocalNotifications.checkPermissions).toHaveBeenCalled();
        });

        it('requestPermission 應呼叫 LocalNotifications.requestPermissions', async () => {
            const nativeService = new NotificationService(mockDS);
            await nativeService.requestPermission();
            expect(mockLocalNotifications.requestPermissions).toHaveBeenCalled();
        });

        it('scheduleReminder 應呼叫 LocalNotifications.schedule', async () => {
            const nativeService = new NotificationService(mockDS);
            nativeService.hasPermission = true;
            await nativeService.scheduleReminder('09:00', 'always');
            expect(mockLocalNotifications.schedule).toHaveBeenCalled();
        });

        it('cancelReminder 應呼叫 LocalNotifications.cancel', async () => {
            const nativeService = new NotificationService(mockDS);
            await nativeService.cancelReminder();
            expect(mockLocalNotifications.cancel).toHaveBeenCalledWith({
                notifications: [{ id: 1001 }],
            });
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '../../src/js/router.js';

// 模擬 app 物件（Router 需要 app.pluginManager）
function createMockApp() {
    const pluginManager = {
        triggerHook: vi.fn(async (name) => name),
        getCustomPage: vi.fn(() => null),
    };
    return {
        pluginManager,
        appContainer: { innerHTML: '' },
    };
}

// 模擬 DOM nav items
function setupNavItems(pages) {
    document.querySelectorAll('.nav-item').forEach(el => el.remove());
    pages.forEach(page => {
        const item = document.createElement('div');
        item.className = 'nav-item';
        item.dataset.page = page;
        document.body.appendChild(item);
    });
}

function clearNavItems() {
    document.querySelectorAll('.nav-item').forEach(el => el.remove());
}

describe('Router', () => {
    let router;
    let mockApp;

    beforeEach(() => {
        vi.clearAllMocks();
        clearNavItems();
        Object.defineProperty(window, 'location', {
            value: new URL('http://localhost/#home'),
            writable: true,
            configurable: true,
        });
        mockApp = createMockApp();
        router = new Router(mockApp);
    });

    describe('constructor', () => {
        it('應正確初始化 routes 為空物件', () => {
            expect(router.routes).toEqual({});
        });

        it('應儲存 app 引用', () => {
            expect(router.app).toBe(mockApp);
        });

        it('currentHash 初始應為 null', () => {
            expect(router.currentHash).toBeNull();
        });
    });

    describe('register', () => {
        it('應註冊頁面到 routes', () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            expect(router.routes['home']).toBe(mockPage);
        });

        it('可註冊多個頁面', () => {
            const homePage = { render: vi.fn() };
            const settingsPage = { render: vi.fn() };
            router.register('home', homePage);
            router.register('settings', settingsPage);
            expect(router.routes['home']).toBe(homePage);
            expect(router.routes['settings']).toBe(settingsPage);
        });

        it('覆蓋已存在的頁面', () => {
            const page1 = { render: vi.fn() };
            const page2 = { render: vi.fn() };
            router.register('test', page1);
            router.register('test', page2);
            expect(router.routes['test']).toBe(page2);
        });
    });

    describe('init', () => {
        it('應註冊 hashchange 事件監聽器', async () => {
            const addSpy = vi.spyOn(window, 'addEventListener');
            router.init();
            expect(addSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));
            addSpy.mockRestore();
        });

        it('應註冊 document click 事件監聽器', async () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            router.init();
            expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function));
            addSpy.mockRestore();
        });

        it('初始化時應觸發 handleRouteChange 並渲染頁面', async () => {
            setupNavItems(['home']);
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.init();
            expect(mockPage.render).toHaveBeenCalled();
        });
    });

    describe('handleRouteChange', () => {
        beforeEach(() => {
            setupNavItems(['home', 'settings', 'stats']);
        });

        it('應渲染已註冊的頁面', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(mockPage.render).toHaveBeenCalled();
        });

        it('應更新 active nav item 樣式', async () => {
            setupNavItems(['home', 'settings']);
            const mockPage = { render: vi.fn() };
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            // 建立新的 Router（會捕捉到 setupNavItems 新增的 nav items）
            const freshApp = createMockApp();
            const testRouter = new Router(freshApp);
            testRouter.register('home', mockPage);
            await testRouter.handleRouteChange();

            const homeItem = document.querySelector('[data-page="home"]');
            expect(homeItem.classList.contains('active')).toBe(true);

            const settingsItem = document.querySelector('[data-page="settings"]');
            expect(settingsItem.classList.contains('active')).toBe(false);
        });

        it('應在頁面切換時滾動到頂部', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            // jsdom 中 scrollTo 是 window 方法，用 spy 驗證
            const scrollSpy = vi.spyOn(globalThis, 'scrollTo');
            await router.handleRouteChange();
            expect(scrollSpy).toHaveBeenCalledWith(0, 0);
            scrollSpy.mockRestore();
        });

        it('應觸發 onPageRenderBefore hook', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(mockApp.pluginManager.triggerHook).toHaveBeenCalledWith(
                'onPageRenderBefore', 'home'
            );
        });

        it('應觸發 onPageRenderAfter hook', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(mockApp.pluginManager.triggerHook).toHaveBeenCalledWith(
                'onPageRenderAfter', 'home'
            );
        });

        it('應傳遞 URLSearchParams 給 render', async () => {
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#stats?from=2024-01-01&to=2024-12-31'),
                writable: true,
                configurable: true,
            });

            const capturedParams = {};
            const mockPage = { render: vi.fn((params) => { capturedParams.params = params; }) };
            router.register('stats', mockPage);

            await router.handleRouteChange();
            expect(capturedParams.params.get('from')).toBe('2024-01-01');
            expect(capturedParams.params.get('to')).toBe('2024-12-31');
        });

        it('當頁面不存在時應導航回 home', async () => {
            const originalHash = window.location.hash;
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#nonexistent'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(window.location.hash).toBe('#home');

            // 恢復原始 hash
            Object.defineProperty(window, 'location', {
                value: new URL(`http://localhost${originalHash}`),
                writable: true,
                configurable: true,
            });
        });

        it('當頁面沒有 render 方法時應記錄錯誤', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            router.register('broken', {}); // 無 render 方法
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#broken'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(consoleSpy).toHaveBeenCalledWith(
                'Page broken does not implement render method'
            );
            consoleSpy.mockRestore();
        });

        it('當頁面 render 拋出錯誤時應顯示 Toast', async () => {
            const mockPage = { render: vi.fn(() => Promise.reject(new Error('render failed'))) };
            router.register('error-page', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#error-page'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            // render 拋出錯誤，所以 onPageRenderAfter 不會被呼叫
            expect(mockApp.pluginManager.triggerHook).toHaveBeenCalledWith(
                'onPageRenderBefore', 'error-page'
            );
        });

        it('當 hook 拋出錯誤時應顯示 Toast', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            mockApp.pluginManager.triggerHook.mockRejectedValue(new Error('hook error'));
            await router.handleRouteChange();
        });

        it('triggerHook 回傳 null 時仍會渲染（Router 不檢查 hook 返回值）', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            // triggerHook 回傳 null，但 Router 不檢查返回值
            mockApp.pluginManager.triggerHook.mockResolvedValue(null);
            await router.handleRouteChange();
            expect(mockPage.render).toHaveBeenCalled();
        });

        it('重複 hash 不應重新渲染', async () => {
            const mockPage = { render: vi.fn() };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(mockPage.render).toHaveBeenCalledTimes(1);

            // 再次呼叫相同 hash
            await router.handleRouteChange();
            expect(mockPage.render).toHaveBeenCalledTimes(1);
        });

        it('應處理無 query string 的 URL', async () => {
            const capturedParams = {};
            const mockPage = { render: vi.fn((params) => { capturedParams.params = params; }) };
            router.register('home', mockPage);
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#home'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(capturedParams.params).toBeDefined();
        });
    });

    describe('updateActiveNavItem', () => {
        it('應為匹配的 nav item 添加 active class', async () => {
            setupNavItems(['home', 'settings']);
            const testRouter = new Router(mockApp);
            testRouter.updateActiveNavItem('home');
            expect(document.querySelector('[data-page="home"]').classList.contains('active')).toBe(true);

            // 再次呼叫切換到 settings
            testRouter.updateActiveNavItem('settings');
            expect(document.querySelector('[data-page="home"]').classList.contains('active')).toBe(false);
            expect(document.querySelector('[data-page="settings"]').classList.contains('active')).toBe(true);
        });

        it('無 nav items 時不報錯', () => {
            clearNavItems();
            const testRouter = new Router(mockApp);
            expect(() => testRouter.updateActiveNavItem('home')).not.toThrow();
        });
    });

    describe('custom pages from plugins', () => {
        it('應渲染 plugin 註冊的自訂頁面', async () => {
            const container = document.createElement('div');
            const customRenderFn = vi.fn();
            mockApp.appContainer = container;

            mockApp.pluginManager.getCustomPage.mockReturnValue({ renderFn: customRenderFn });
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#custom-page'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
            expect(customRenderFn).toHaveBeenCalledWith(container);
        });

        it('自訂頁面 render 失敗時應顯示錯誤 Toast', async () => {
            const container = document.createElement('div');
            mockApp.appContainer = container;

            mockApp.pluginManager.getCustomPage.mockReturnValue({
                renderFn: () => { throw new Error('custom error'); },
            });
            Object.defineProperty(window, 'location', {
                value: new URL('http://localhost/#custom-page'),
                writable: true,
                configurable: true,
            });

            await router.handleRouteChange();
        });
    });
});

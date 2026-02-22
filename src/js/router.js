import { showToast } from './utils.js';

export class Router {
    constructor(app) {
        this.app = app;
        this.routes = {};
        this.navItems = document.querySelectorAll('.nav-item');
    }

    register(name, page) {
        this.routes[name] = page;
    }

    init() {
        window.addEventListener('hashchange', () => this.handleRouteChange());
        document.addEventListener('click', (e) => {
            this.app.pluginManager.triggerHook('onPageClick', e);
        });

        // Initial route
        this.handleRouteChange();
    }

    async handleRouteChange() {
        const hash = window.location.hash || '#home';
        // Allow re-rendering same hash if needed? No, main.js prevented it.
        if (hash === this.app.currentHash) return;
        this.app.currentHash = hash;

        const [pageName, query] = hash.substring(1).split('?');
        const params = new URLSearchParams(query);

        this.updateActiveNavItem(pageName);

        // Scroll to top on page change
        window.scrollTo(0, 0);

        try {
            await this.app.pluginManager.triggerHook('onPageRenderBefore', pageName);

            const page = this.routes[pageName];
            if (page) {
                if (page.render) {
                    await page.render(params);
                } else {
                    console.error(`Page ${pageName} does not implement render method`);
                }
            } else {
                // Check for custom pages from plugins
                const customPage = this.app.pluginManager.getCustomPage(pageName);
                if (customPage) {
                    this.app.appContainer.innerHTML = ''; // Clear container
                    try {
                        customPage.renderFn(this.app.appContainer);
                    } catch (e) {
                        console.error('Error rendering custom page:', e);
                        showToast('頁面載入失敗', 'error');
                    }
                } else {
                    console.warn('Route not found, redirecting to home:', pageName);
                    window.location.hash = 'home';
                    return;
                }
            }

            await this.app.pluginManager.triggerHook('onPageRenderAfter', pageName);
        } catch (error) {
            console.error('Error during route change:', error);
            showToast('頁面載入發生錯誤', 'error');
        }
    }

    updateActiveNavItem(activePage) {
        this.navItems.forEach(item => {
            if (item.dataset.page === activePage) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
}

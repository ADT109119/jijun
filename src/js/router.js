import { showToast } from './utils.js'

export class Router {
    constructor(app) {
        this.app = app
        this.routes = {}
        this.currentHash = null
        this.navItems = document.querySelectorAll('.nav-item')
    }

    register(name, page) {
        this.routes[name] = page
    }

    init() {
        window.addEventListener('hashchange', () => this.handleRouteChange())
        document.addEventListener('click', e => {
            this.app.pluginManager.triggerHook('onPageClick', e)
        })

        // Initial route
        this.handleRouteChange()
    }

    async handleRouteChange() {
        const hash = window.location.hash || '#home'
        // Allow re-rendering same hash if needed? No, main.js prevented it.
        if (hash === this.currentHash) return
        this.currentHash = hash

        const [pageName, query] = hash.substring(1).split('?')
        const params = new URLSearchParams(query)

        // 導覽功能：#U08 切頁時取消進行中的導覽，避免氣泡殘留/互斥卡死
        // 自動實操導覽進行中：其內部頁面跳轉屬程序性導航，不應取消
        // 導览 goto 跨頁導航中：屬程序性導航，不應取消（導览引擎自主切頁）
        if (this.app.guideManager && !this.app.guideManager._demoRunning && !this.app.guideManager._allowRouteChange) {
            this.app.guideManager.cancelActiveTour()
        }

        this.updateActiveNavItem(pageName)

        // Scroll to top on page change
        window.scrollTo(0, 0)

        try {
            await this.app.pluginManager.triggerHook(
                'onPageRenderBefore',
                pageName
            )

            const page = this.routes[pageName]
            if (page) {
                if (this.app.appContainer && this.app.appContainer.classList) {
                    this.app.appContainer.classList.remove('plugin-page')
                }
                if (page.render) {
                    await page.render(params)
                } else {
                    console.error(
                        `Page ${pageName} does not implement render method`
                    )
                }
            } else {
                // Check for custom pages from plugins
                const customPage =
                    this.app.pluginManager.getCustomPage(pageName)
                if (customPage) {
                    this.app.appContainer.innerHTML = '' // Clear container
                    if (this.app.appContainer && this.app.appContainer.classList) {
                        this.app.appContainer.classList.add('plugin-page')
                    }
                    try {
                        customPage.renderFn(this.app.appContainer)
                    } catch (e) {
                        console.error('Error rendering custom page:', e)
                        showToast('頁面載入失敗', 'error')
                    }
                } else {
                    console.warn(
                        'Route not found, redirecting to home:',
                        pageName
                    )
                    window.location.hash = 'home'
                    return
                }
            }

            await this.app.pluginManager.triggerHook(
                'onPageRenderAfter',
                pageName
            )

            // 導覽功能：#U08 特定功能頁面觸發對應導覽（如欠款、多帳戶）
            if (this.app.guideManager) {
                this.app.guideManager.checkFeatureTour(pageName)
            }
        } catch (error) {
            console.error('Error during route change:', error)
            showToast('頁面載入發生錯誤', 'error')
        }
    }

    updateActiveNavItem(activePage) {
        this.navItems.forEach(item => {
            if (item.dataset.page === activePage) {
                item.classList.add('active')
            } else {
                item.classList.remove('active')
            }
        })
        if (this.app && typeof this.app.updateNavAddIcon === 'function') {
            this.app.updateNavAddIcon()
        }
    }
}

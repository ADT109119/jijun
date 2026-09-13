import { showToast, customConfirm, getStoreUrl } from '../utils.js'
import { DARK_THEME_ID, THEME_MODES } from '../themeManager.js'

export class ThemesPage {
    constructor(app) {
        this.app = app
    }

    async render() {
        const allInstalledThemes = await this.app.dataService.getInstalledThemes()
        const setting = await this.app.dataService.getSetting('activeThemeId')
        const activeThemeId = setting ? setting.value : null
        const currentMode =
            this.app.themeManager.themeMode || THEME_MODES.SYSTEM
        const isDark = document.documentElement.classList.contains('dark')

        // 自訂主題清單（排除已獨立呈現為深色模式的內建深色主題）
        const customThemes = allInstalledThemes.filter(
            t => t.id !== DARK_THEME_ID
        )

        // 偷偷抓商店版本資訊，用於「有更新」檢測（離線時靜默失敗）
        let storeIndex = []
        try {
            const res = await fetch(
                getStoreUrl(`themes/index.json?t=${Date.now()}`)
            )
            if (res.ok) storeIndex = await res.json()
        } catch (_) {
            /* 離線時忽略 */
        }

        // 建立「主題 ID → 商店最新條目」對照表
        const storeMap = new Map(storeIndex.map(s => [s.id, s]))

        // 檢查某主題是否有可用更新
        const hasUpdate = t => {
            const store = storeMap.get(t.id)
            if (!store || !store.file) return false
            return (
                this.app.pluginManager.compareVersions(
                    store.version,
                    t.version
                ) > 0
            )
        }

        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">外觀主題</h1>
                    <a href="#theme-store" class="text-wabi-primary hover:text-wabi-primary/80" title="主題商店">
                        <i class="fa-solid fa-store text-xl"></i>
                    </a>
                </div>

                <div class="space-y-4">
                    <div class="text-xs font-semibold text-wabi-text-secondary px-1 uppercase tracking-wider">外觀模式</div>

                    <!-- 跟隨系統 (Auto) -->
                    <div class="bg-wabi-surface p-4 rounded-xl border ${currentMode === THEME_MODES.SYSTEM ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-mode-item hover:bg-wabi-bg/30" data-mode="${THEME_MODES.SYSTEM}">
                        <div class="flex items-center gap-4 min-w-0">
                            <div class="size-12 rounded-lg bg-wabi-bg flex items-center justify-center border border-wabi-border shrink-0 text-wabi-primary">
                                <i class="fa-solid fa-circle-half-stroke text-xl"></i>
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <h4 class="font-bold text-wabi-text-primary">跟隨系統</h4>
                                    <span class="text-[11px] px-2 py-0.5 rounded-full font-medium ${isDark ? 'bg-indigo-500/10 text-indigo-400' : 'bg-amber-500/10 text-amber-600'}">目前：${isDark ? '深色' : '淺色'}</span>
                                </div>
                                <p class="text-xs text-wabi-text-secondary mt-1 truncate">依據裝置系統設定，自動在淺色與深色模式間切換</p>
                            </div>
                        </div>
                        ${currentMode === THEME_MODES.SYSTEM ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl shrink-0 ml-2"></i>' : ''}
                    </div>

                    <!-- 淺色模式 (Light) -->
                    <div class="bg-wabi-surface p-4 rounded-xl border ${currentMode === THEME_MODES.LIGHT ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-mode-item hover:bg-wabi-bg/30" data-mode="${THEME_MODES.LIGHT}">
                        <div class="flex items-center gap-4 min-w-0">
                            <div class="size-12 rounded-lg bg-wabi-bg flex items-center justify-center border border-wabi-border shrink-0 text-amber-500">
                                <i class="fa-solid fa-sun text-xl"></i>
                            </div>
                            <div class="min-w-0">
                                <h4 class="font-bold text-wabi-text-primary">淺色模式 (預設主題)</h4>
                                <p class="text-xs text-wabi-text-secondary mt-1 truncate">固定使用經典簡約淺色配色與圖標</p>
                            </div>
                        </div>
                        ${currentMode === THEME_MODES.LIGHT ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl shrink-0 ml-2"></i>' : ''}
                    </div>

                    <!-- 深色模式 (Dark) -->
                    <div class="bg-wabi-surface p-4 rounded-xl border ${currentMode === THEME_MODES.DARK ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-mode-item hover:bg-wabi-bg/30" data-mode="${THEME_MODES.DARK}">
                        <div class="flex items-center gap-4 min-w-0">
                            <div class="size-12 rounded-lg bg-slate-900 flex items-center justify-center border border-slate-700 shrink-0 text-indigo-400">
                                <i class="fa-solid fa-moon text-xl"></i>
                            </div>
                            <div class="min-w-0">
                                <h4 class="font-bold text-wabi-text-primary">深色模式</h4>
                                <p class="text-xs text-wabi-text-secondary mt-1 truncate">固定使用保護眼睛的深色主題，減少螢幕刺眼光線</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 ml-2">
                            ${currentMode === THEME_MODES.DARK ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl"></i>' : ''}
                            <span class="text-wabi-text-secondary p-2 text-sm" title="內建主題不可刪除"><i class="fa-solid fa-lock"></i></span>
                        </div>
                    </div>

                    <!-- Custom Themes Section -->
                    <div class="pt-4 flex items-center justify-between">
                        <div class="text-xs font-semibold text-wabi-text-secondary px-1 uppercase tracking-wider">已安裝自訂主題</div>
                        <a href="#theme-store" class="text-xs font-semibold text-wabi-primary hover:underline flex items-center gap-1">
                            <i class="fa-solid fa-plus text-[10px]"></i>前往主題商店
                        </a>
                    </div>

                    <!-- Installed Custom Themes -->
                    ${
                        customThemes.length === 0
                            ? `
                        <div class="text-center py-6 bg-wabi-surface/50 rounded-xl border border-dashed border-wabi-border text-wabi-text-secondary">
                            <p class="text-sm">尚未安裝任何第三方自訂主題</p>
                            <a href="#theme-store" class="text-wabi-primary mt-1.5 inline-block text-xs font-semibold">前往商店下載新主題</a>
                        </div>
                    `
                            : customThemes
                                  .map(t => {
                                      const updatable = hasUpdate(t)
                                      const store = storeMap.get(t.id)
                                      const isCustomActive =
                                          currentMode === THEME_MODES.CUSTOM &&
                                          activeThemeId === t.id

                                      let thumbnailHtml = ''
                                      const bgColor =
                                          t.colors?.['wabi-bg'] || '#fff'
                                      const primaryColor =
                                          t.colors?.['wabi-primary'] ||
                                          '#334A52'
                                      const rawSvgPreview =
                                          t.svgPreview || store?.svgPreview
                                      const iconPreview =
                                          t.iconPreview || store?.iconPreview
                                      const sanitizedSvg = rawSvgPreview
                                          ? this.app.themeManager?.sanitizeSVGToString(
                                                rawSvgPreview
                                            )
                                          : null

                                      if (sanitizedSvg) {
                                          thumbnailHtml = `<div class="size-12 rounded-lg flex items-center justify-center border border-wabi-border shadow-sm shrink-0 overflow-hidden" style="background-color:${primaryColor}"><div class="size-7 flex items-center justify-center text-white">${sanitizedSvg}</div></div>`
                                      } else if (iconPreview) {
                                          thumbnailHtml = `<div class="size-12 rounded-lg flex items-center justify-center border border-wabi-border shadow-sm shrink-0" style="background-color:${bgColor}"><i class="${iconPreview} text-xl" style="color:${primaryColor}"></i></div>`
                                      } else {
                                          thumbnailHtml = `<div class="size-12 rounded-lg flex items-center justify-center border border-wabi-border shadow-sm shrink-0" style="background-color:${bgColor}"><div class="size-6 rounded-full shrink-0" style="background-color:${primaryColor}"></div></div>`
                                      }

                                      return `
                        <div class="bg-wabi-surface p-4 rounded-xl border ${isCustomActive ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer custom-theme-item relative overflow-hidden group hover:bg-wabi-bg/30" data-id="${t.id}">
                            <div class="flex items-center gap-4 z-10 min-w-0">
                                ${thumbnailHtml}
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <h4 class="font-bold text-wabi-text-primary group-hover:text-wabi-primary transition-colors">${t.name}</h4>
                                        ${
                                            updatable
                                                ? `<span class="text-xs bg-yellow-400/20 text-yellow-600 border border-yellow-400/40 px-1.5 py-0.5 rounded-full font-medium shrink-0">v${store.version} 可更新</span>`
                                                : `<span class="text-xs text-wabi-text-secondary shrink-0">v${t.version || '?'}</span>`
                                        }
                                    </div>
                                    <p class="text-xs text-wabi-text-secondary mt-0.5 truncate">${t.description || '無描述'}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 z-10 shrink-0 ml-2">
                                ${isCustomActive ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl"></i>' : ''}
                                ${
                                    updatable
                                        ? `<button class="update-theme-btn text-xs font-bold px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg transition-colors shrink-0" data-id="${t.id}" data-url="${store.file}" title="更新至 v${store.version}">
                                           <i class="fa-solid fa-arrow-up-from-bracket mr-1"></i>更新
                                       </button>`
                                        : ''
                                }
                                <button class="delete-theme-btn text-wabi-expense p-2 transition-opacity hover:bg-red-500/10 rounded-lg" data-id="${t.id}" title="刪除主題"><i class="fa-solid fa-trash-can"></i></button>
                            </div>
                        </div>
                        `
                                  })
                                  .join('')
                    }
                </div>
            </div>
        `

        // 點擊切換標準外觀模式 (跟隨系統 / 淺色 / 深色)
        document.querySelectorAll('.theme-mode-item').forEach(item => {
            item.addEventListener('click', async () => {
                const mode = item.dataset.mode
                await this.app.themeManager.setThemeMode(mode)
                const toastMsg =
                    mode === THEME_MODES.SYSTEM
                        ? '已設定為跟隨系統模式'
                        : mode === THEME_MODES.LIGHT
                          ? '已切換為淺色模式'
                          : '已切換為深色模式'
                showToast(toastMsg, 'success')
                this.render()
            })
        })

        // 點擊套用自訂主題
        document.querySelectorAll('.custom-theme-item').forEach(item => {
            item.addEventListener('click', async e => {
                if (e.target.closest('.delete-theme-btn')) return
                if (e.target.closest('.update-theme-btn')) return

                const id = item.dataset.id
                await this.app.themeManager.setThemeMode(
                    THEME_MODES.CUSTOM,
                    id
                )
                showToast('已套用自訂主題', 'success')
                this.render()
            })
        })

        // Update theme（直接在主題頁更新，不需要去商店）
        document.querySelectorAll('.update-theme-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation()
                const originalHtml = btn.innerHTML
                btn.disabled = true
                btn.innerHTML =
                    '<i class="fa-solid fa-spinner fa-spin mr-1"></i>更新中'
                try {
                    const response = await fetch(getStoreUrl(btn.dataset.url))
                    if (!response.ok) throw new Error('fetch failed')
                    const themeData = await response.json()
                    await this.app.dataService.installTheme(themeData)

                    // 若正在使用此主題，立即重套用以刷新顏色/圖示
                    const currentSetting =
                        await this.app.dataService.getSetting('activeThemeId')
                    if (currentSetting?.value === btn.dataset.id) {
                        await this.app.themeManager.setThemeMode(
                            THEME_MODES.CUSTOM,
                            btn.dataset.id
                        )
                    }

                    showToast('主題已更新！', 'success')
                    this.render()
                } catch (_) {
                    showToast('更新失敗，請稍後再試', 'error')
                    btn.disabled = false
                    btn.innerHTML = originalHtml
                }
            })
        })

        // Delete theme
        document.querySelectorAll('.delete-theme-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation()
                const id = btn.dataset.id
                if (await customConfirm('確定要移除此主題嗎？')) {
                    const activeSetting =
                        await this.app.dataService.getSetting('activeThemeId')
                    if (activeSetting && activeSetting.value === id) {
                        await this.app.themeManager.setThemeMode(
                            THEME_MODES.SYSTEM
                        )
                    }
                    await this.app.dataService.uninstallTheme(id)
                    showToast('主題已移除')
                    this.render()
                }
            })
        })
    }
}

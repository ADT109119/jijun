import { showToast, customConfirm } from '../utils.js';
import { DARK_THEME_ID } from '../themeManager.js';

export class ThemesPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const themes = await this.app.dataService.getInstalledThemes();
        const setting = await this.app.dataService.getSetting('activeThemeId');
        const activeThemeId = setting ? setting.value : null;

        // 偷偷抓商店版本資訊，用於「有更新」檢測（離線時靜默失敗）
        let storeIndex = [];
        try {
            const res = await fetch(`themes/index.json?t=${Date.now()}`);
            if (res.ok) storeIndex = await res.json();
        } catch (_) { /* 離線時忽略 */ }

        // 建立「主題 ID → 商店最新條目」對照表
        const storeMap = new Map(storeIndex.map(s => [s.id, s]));

        // 檢查某主題是否有可用更新
        const hasUpdate = (t) => {
            const store = storeMap.get(t.id);
            if (!store || !store.file) return false;
            return this.app.pluginManager.compareVersions(store.version, t.version) > 0;
        };

        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">外觀主題</h1>
                    <a href="#theme-store" class="text-wabi-primary hover:text-wabi-primary/80">
                        <i class="fa-solid fa-store text-xl"></i>
                    </a>
                </div>

                <div class="space-y-4">
                    <!-- Default Theme -->
                    <div class="bg-wabi-surface p-4 rounded-xl border ${!activeThemeId ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-item" data-id="default">
                        <div class="flex items-center gap-4">
                            <div class="size-12 rounded-lg bg-wabi-bg flex items-center justify-center border border-wabi-border shrink-0">
                                <i class="fa-solid fa-palette text-gray-400 text-xl"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-wabi-text-primary">預設主題</h4>
                                <p class="text-xs text-wabi-text-secondary mt-1">系統預設配色與圖標</p>
                            </div>
                        </div>
                        ${!activeThemeId ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl"></i>' : ''}
                    </div>

                    <!-- Installed Themes -->
                    ${themes.length === 0 ? `
                        <div class="text-center py-8 text-wabi-text-secondary">
                            <p>尚未安裝任何自訂主題</p>
                            <a href="#theme-store" class="text-wabi-primary mt-2 inline-block font-medium">前往商店下載</a>
                        </div>
                    ` : themes.map(t => {
                        const updatable = hasUpdate(t);
                        const store = storeMap.get(t.id);
                        return `
                        <div class="bg-wabi-surface p-4 rounded-xl border ${activeThemeId === t.id ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-item relative overflow-hidden group" data-id="${t.id}">
                            <div class="flex items-center gap-4 z-10 min-w-0">
                                <div class="size-12 rounded-lg flex items-center justify-center border border-wabi-border shadow-sm shrink-0" style="background-color: ${t.colors?.['wabi-bg'] || '#fff'}">
                                    <div class="size-6 rounded-full shrink-0" style="background-color: ${t.colors?.['wabi-primary'] || '#334A52'}"></div>
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <h4 class="font-bold text-wabi-text-primary group-hover:text-wabi-primary transition-colors">${t.name}</h4>
                                        ${updatable
                                            ? `<span class="text-xs bg-yellow-400/20 text-yellow-600 border border-yellow-400/40 px-1.5 py-0.5 rounded-full font-medium shrink-0">v${store.version} 可更新</span>`
                                            : `<span class="text-xs text-wabi-text-secondary shrink-0">v${t.version || '?'}</span>`
                                        }
                                    </div>
                                    <p class="text-xs text-wabi-text-secondary mt-0.5 truncate">${t.description || '無描述'}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 z-10 shrink-0 ml-2">
                                ${activeThemeId === t.id ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl"></i>' : ''}
                                ${updatable
                                    ? `<button class="update-theme-btn text-xs font-bold px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg transition-colors shrink-0" data-id="${t.id}" data-url="${store.file}" title="更新至 v${store.version}">
                                           <i class="fa-solid fa-arrow-up-from-bracket mr-1"></i>更新
                                       </button>`
                                    : ''
                                }
                                ${t.id === DARK_THEME_ID
                                    ? '<span class="text-wabi-text-secondary p-2 text-sm" title="內建主題不可刪除"><i class="fa-solid fa-lock"></i></span>'
                                    : `<button class="delete-theme-btn text-wabi-expense p-2 transition-opacity" data-id="${t.id}" title="刪除主題"><i class="fa-solid fa-trash-can"></i></button>`
                                }
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // Apply theme on click
        document.querySelectorAll('.theme-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.delete-theme-btn')) return;
                if (e.target.closest('.update-theme-btn')) return;

                const id = item.dataset.id;
                if (id === 'default') {
                    await this.app.themeManager.clearTheme();
                } else {
                    const theme = await this.app.dataService.getTheme(id);
                    if (theme) {
                        await this.app.themeManager.applyTheme(theme);
                    }
                }
                this.render();
            });
        });

        // Update theme（直接在主題頁更新，不需要去商店）
        document.querySelectorAll('.update-theme-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const originalHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>更新中';
                try {
                    const response = await fetch(btn.dataset.url);
                    if (!response.ok) throw new Error('fetch failed');
                    const themeData = await response.json();
                    await this.app.dataService.installTheme(themeData);

                    // 若正在使用此主題，立即重套用以刷新顏色/圖示
                    const currentSetting = await this.app.dataService.getSetting('activeThemeId');
                    if (currentSetting?.value === btn.dataset.id) {
                        await this.app.themeManager.applyTheme(themeData);
                    }

                    showToast('主題已更新！', 'success');
                    this.render();
                } catch (_) {
                    showToast('更新失敗，請稍後再試', 'error');
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            });
        });

        // Delete theme
        document.querySelectorAll('.delete-theme-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (await customConfirm('確定要移除此主題嗎？')) {
                    const activeSetting = await this.app.dataService.getSetting('activeThemeId');
                    if (activeSetting && activeSetting.value === id) {
                        await this.app.themeManager.clearTheme();
                    }
                    await this.app.dataService.uninstallTheme(id);
                    showToast('主題已移除');
                    this.render();
                }
            });
        });
    }
}

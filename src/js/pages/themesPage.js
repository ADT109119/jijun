import { showToast } from '../utils.js';

export class ThemesPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const themes = await this.app.dataService.getInstalledThemes();
        const setting = await this.app.dataService.getSetting('activeThemeId');
        const activeThemeId = setting ? setting.value : null;

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
                            <div class="size-12 rounded-lg bg-wabi-bg flex items-center justify-center border border-wabi-border">
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
                    ` : themes.map(t => `
                        <div class="bg-wabi-surface p-4 rounded-xl border ${activeThemeId === t.id ? 'border-wabi-primary shadow-md' : 'border-wabi-border'} flex justify-between items-center transition-all cursor-pointer theme-item relative overflow-hidden group" data-id="${t.id}">
                            <div class="flex items-center gap-4 z-10">
                                <div class="size-12 rounded-lg flex items-center justify-center border border-wabi-border shadow-sm" style="background-color: ${t.colors?.['wabi-bg'] || '#fff'}">
                                    <div class="size-6 rounded-full" style="background-color: ${t.colors?.['wabi-primary'] || '#334A52'}"></div>
                                </div>
                                <div>
                                    <h4 class="font-bold text-wabi-text-primary group-hover:text-wabi-primary transition-colors">${t.name}</h4>
                                    <p class="text-xs text-wabi-text-secondary mt-1">${t.description || '無描述'}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 z-10">
                                ${activeThemeId === t.id ? '<i class="fa-solid fa-circle-check text-wabi-primary text-xl"></i>' : ''}
                                <button class="delete-theme-btn text-wabi-expense p-2 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" data-id="${t.id}" title="刪除主題">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Apply theme on click
        document.querySelectorAll('.theme-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.delete-theme-btn')) return;

                const id = item.dataset.id;
                if (id === 'default') {
                    await this.app.themeManager.clearTheme();
                } else {
                    const theme = await this.app.dataService.getTheme(id);
                    if (theme) {
                        await this.app.themeManager.applyTheme(theme);
                    }
                }
                this.render(); // re-render to update selected state
            });
        });

        // Delete theme
        document.querySelectorAll('.delete-theme-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (confirm('確定要移除此主題嗎？')) {
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

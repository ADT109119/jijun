import { showToast } from '../utils.js';

export class ThemeStorePage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 h-full flex flex-col bg-wabi-bg max-w-3xl mx-auto">
                <header class="flex items-center gap-4 mb-4 shrink-0 bg-wabi-surface p-4 -m-4 mb-4 shadow-sm border-b border-wabi-border sticky top-0 z-10">
                    <a href="#themes" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600 transition-colors">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-gray-800 flex-1">主題商店</h1>
                </header>

                <div id="theme-store-list" class="flex-1 overflow-y-auto space-y-4 pb-8">
                     <div class="text-center py-12 text-wabi-text-secondary animate-pulse">載入中...</div>
                </div>
            </div>
        `;

        const installedThemes = await this.app.dataService.getInstalledThemes();

        try {
            const res = await fetch(`themes/index.json?t=${Date.now()}`);
            if (res.ok) {
                const storeThemes = await res.json();
                this.renderStoreList(storeThemes, installedThemes);
            } else {
                 throw new Error('Store index not found');
            }
        } catch(e) {
             console.error(e);
             document.getElementById('theme-store-list').innerHTML = `<div class="text-center py-12 text-red-500">無法載入商店資料</div>`;
        }
    }

    renderStoreList(list, installedThemes) {
        const container = document.getElementById('theme-store-list');
        if (list.length === 0) {
            container.innerHTML = `<div class="text-center py-12 text-gray-400">目前沒有可用的主題</div>`;
            return;
        }

        container.innerHTML = list.map(t => {
             const installed = installedThemes.find(i => i.id === t.id);
             let btnHtml = '';

             if (installed) {
                 if (this.app.pluginManager.compareVersions(t.version, installed.version) > 0) {
                      btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-yellow-500 text-wabi-surface hover:bg-yellow-600 shadow w-full mt-3" data-url="${t.file}">更新 (v${t.version})</button>`;
                 } else {
                      btnHtml = `<button class="px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-green-100 text-green-700 cursor-default w-full mt-3" disabled>已安裝</button>`;
                 }
             } else {
                 btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-wabi-primary text-wabi-surface hover:bg-opacity-90 shadow w-full mt-3" data-url="${t.file}">下載</button>`;
             }

             // Color Preview Blocks
             let colorBlocks = '';
             if (t.colorsPreview && Object.keys(t.colorsPreview).length > 0) {
                 colorBlocks = `<div class="flex gap-2 mt-3">` +
                 Object.values(t.colorsPreview).slice(0, 5).map(c =>
                     `<div class="size-6 rounded-md shadow-sm border border-black/10" style="background-color: ${c}"></div>`
                 ).join('') + `</div>`;
             }

             return `
                    <div class="bg-wabi-surface p-5 rounded-2xl border border-wabi-border shadow-sm flex flex-col hover:shadow-md transition-shadow">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <h4 class="font-bold text-gray-800 text-lg">${t.name}</h4>
                                <p class="text-xs text-gray-400">v${t.version} • ${t.author || 'Unknown'}</p>
                            </div>
                            ${t.iconPreview ? `<i class="${t.iconPreview} text-3xl text-gray-300"></i>` : ''}
                        </div>
                        <p class="text-sm text-gray-500 flex-1">${t.description}</p>
                        ${colorBlocks}
                        ${btnHtml}
                    </div>
             `;
        }).join('');

        // Bind Store Page Buttons
        container.querySelectorAll('.store-install-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.textContent = '下載中...';

                try {
                    const response = await fetch(btn.dataset.url);
                    if (!response.ok) throw new Error('Failed to fetch theme JSON');
                    const themeData = await response.json();

                    await this.app.dataService.installTheme(themeData);
                    showToast('下載成功！可以到主題列表套用', 'success');

                    // Refresh
                    this.render();
                } catch (e) {
                    console.error(e);
                    showToast('下載失敗', 'error');
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            });
        });
    }
}

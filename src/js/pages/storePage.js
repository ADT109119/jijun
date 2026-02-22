import { showToast } from '../utils.js';

export class StorePage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 h-full flex flex-col bg-wabi-bg max-w-3xl mx-auto">
                <header class="flex items-center gap-4 mb-4 shrink-0 bg-white p-4 -m-4 mb-4 shadow-sm border-b border-gray-100 sticky top-0 z-10">
                    <a href="#plugins" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600 transition-colors">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <div class="flex-1 relative">
                        <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input type="text" id="store-search" class="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-full outline-none focus:ring-2 focus:ring-wabi-primary transition-all placeholder-gray-400" placeholder="搜尋擴充功能...">
                    </div>
                </header>

                <div id="full-store-list" class="flex-1 overflow-y-auto space-y-3 pb-8">
                     <div class="text-center py-12 text-wabi-text-secondary animate-pulse">載入中...</div>
                </div>
            </div>
        `;

        const plugins = await this.app.pluginManager.getInstalledPlugins();

        try {
            const res = await fetch(`plugins/index.json?t=${Date.now()}`);
            if (res.ok) {
                const storePlugins = await res.json();
                this.renderStoreList(storePlugins, plugins);

                // Search Logic
                document.getElementById('store-search').addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase().trim();
                    const filtered = storePlugins.filter(p =>
                        p.name.toLowerCase().includes(term) ||
                        p.description.toLowerCase().includes(term) ||
                        (p.author && p.author.toLowerCase().includes(term))
                    );
                    this.renderStoreList(filtered, plugins);
                });
            }
        } catch(e) {
             document.getElementById('full-store-list').innerHTML = `<div class="text-center py-12 text-red-500">無法載入商店資料</div>`;
        }
    }

    renderStoreList(list, installedPlugins) {
        const container = document.getElementById('full-store-list');
        if (list.length === 0) {
            container.innerHTML = `<div class="text-center py-12 text-gray-400">沒有找到相關插件</div>`;
            return;
        }

        container.innerHTML = list.map(p => {
             const installed = installedPlugins.find(i => i.id === p.id);
             let btnHtml = '';

             if (installed) {
                 if (this.app.pluginManager.compareVersions(p.version, installed.version) > 0) {
                      btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-yellow-500 text-white hover:bg-yellow-600 shadow" data-url="${p.file}" data-id="${p.id}">更新 (v${p.version})</button>`;
                 } else {
                      btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-green-100 text-green-700 cursor-default" disabled>已安裝</button>`;
                 }
             } else {
                 btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-wabi-primary text-white hover:bg-opacity-90 shadow" data-url="${p.file}" data-id="${p.id}">安裝</button>`;
             }

             return `
                    <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:border-wabi-primary transition-colors group">
                        <div class="flex items-center gap-4">
                            <div class="bg-wabi-primary/10 text-wabi-primary rounded-xl size-14 flex items-center justify-center text-2xl aspect-square group-hover:scale-110 transition-transform">
                                <i class="fa-solid ${p.icon || 'fa-puzzle-piece'}"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-gray-800 text-lg">${p.name}</h4>
                                <p class="text-sm text-gray-500 line-clamp-1">${p.description}</p>
                                <p class="text-xs text-gray-400 mt-1">v${p.version} • ${p.author || 'Unknown'}</p>
                            </div>
                        </div>
                        ${btnHtml}
                    </div>
             `;
        }).join('');

        // Bind Store Page Buttons
        container.querySelectorAll('.store-install-btn').forEach(btn => {
             if (!btn.disabled) {
                btn.addEventListener('click', async () => {
                    const originalText = btn.innerHTML;
                    btn.disabled = true;
                    btn.textContent = '下載中...';

                    try {
                        const response = await fetch(btn.dataset.url);
                        const script = await response.text();
                        const file = new File([script], 'plugin.js', { type: 'text/javascript' });
                        // 找到對應的商店插件資訊，傳入權限與 icon
                        const matchedPlugin = list.find(sp => sp.id === btn.dataset.id);
                        await this.app.pluginManager.installPlugin(file, matchedPlugin || null);
                        showToast('安裝成功！', 'success');

                        // Updates UI
                        // Fetch latest status
                        await this.app.pluginManager.getInstalledPlugins();
                        this.render(); // Re-render store page
                    } catch (e) {
                        console.error(e);
                        if (e.message !== '使用者取消安裝' && e.message !== '使用者取消更新') {
                            showToast('安裝失敗', 'error');
                        }
                        btn.disabled = false;
                        btn.innerHTML = originalText;
                    }
                });
             }
        });
    }
}

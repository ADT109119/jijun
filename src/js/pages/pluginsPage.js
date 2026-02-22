import { showToast } from '../utils.js';

export class PluginsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const plugins = await this.app.pluginManager.getInstalledPlugins();

        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">擴充功能商店</h1>
                    <div class="w-8"></div>
                </div>

                <!-- Store Section -->
                 <h3 class="font-bold text-wabi-primary mb-3">推薦擴充</h3>
                 <div id="store-list-container" class="space-y-3 mb-8">
                    <div class="text-center py-4 text-wabi-text-secondary animate-pulse">
                        載入中...
                    </div>
                 </div>

                <!-- Custom Pages List -->
                ${this.app.pluginManager.customPages.size > 0 ? `
                    <h3 class="font-bold text-wabi-primary mb-3">已安裝應用程式</h3>
                    <div class="space-y-3 mb-6">
                        ${Array.from(this.app.pluginManager.customPages.entries()).map(([route, page]) => `
                            <a href="#${route}" class="block bg-wabi-surface p-4 rounded-xl border border-wabi-border flex justify-between items-center hover:bg-gray-50">
                                <div>
                                    <h4 class="font-bold text-wabi-text-primary">${page.title}</h4>
                                    <p class="text-xs text-wabi-text-secondary mt-1">#${route}</p>
                                </div>
                                <i class="fa-solid fa-chevron-right text-wabi-text-secondary"></i>
                            </a>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- Plugin List -->
                <h3 class="font-bold text-wabi-primary mb-3">已安裝插件模組</h3>
                <div id="plugin-list-container" class="space-y-3">
                    ${plugins.length === 0 ? `
                        <div class="text-center py-8 text-wabi-text-secondary">
                            <i class="fa-solid fa-puzzle-piece text-4xl mb-3 opacity-30"></i>
                            <p>尚未安裝任何擴充功能</p>
                        </div>
                    ` : plugins.map(p => `
                        <div class="bg-wabi-surface p-4 rounded-xl border border-wabi-border flex justify-between items-center">
                            <div>
                                <h4 class="font-bold text-wabi-text-primary">${p.name} <span class="text-xs text-wabi-text-secondary font-normal">v${p.version}</span></h4>
                                <p class="text-xs text-wabi-text-secondary mt-1">${p.description || '無描述'}</p>
                            </div>
                            <button class="delete-plugin-btn text-wabi-expense p-2" data-id="${p.id}">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Load Store Data
        try {
            const res = await fetch(`plugins/index.json?t=${Date.now()}`);
            if (res.ok) {
                const storePlugins = await res.json();
                const storeContainer = document.getElementById('store-list-container');

                storeContainer.innerHTML = storePlugins.slice(0, 3).map(p => {
                    const installed = plugins.find(i => i.id === p.id);
                    let btnHtml = '';

                    if (installed) {
                        if (this.app.pluginManager.compareVersions(p.version, installed.version) > 0) {
                             // Update available
                             btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-yellow-500 text-white hover:bg-yellow-600 shadow"
                                data-url="${p.file}" data-id="${p.id}">
                                更新 (v${p.version})
                            </button>`;
                        } else {
                             // Already installed & up to date
                             btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-green-100 text-green-700 cursor-default" disabled>
                                已安裝
                            </button>`;
                        }
                    } else {
                        // Not installed
                        btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap shrink-0 bg-wabi-primary text-white hover:bg-opacity-90 shadow"
                            data-url="${p.file}" data-id="${p.id}">
                            安裝
                        </button>`;
                    }

                    return `
                    <div class="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                        <div class="flex items-center gap-4">
                            <div class="bg-wabi-primary/10 text-wabi-primary rounded-lg size-12 flex items-center justify-center text-xl aspect-square">
                                <i class="fa-solid ${p.icon || 'fa-puzzle-piece'}"></i>
                            </div>
                            <div>
                                <h4 class="font-bold text-wabi-text-primary text-lg">${p.name}</h4>
                                <p class="text-sm text-wabi-text-secondary line-clamp-1">${p.description}</p>
                            </div>
                        </div>
                        ${btnHtml}
                    </div>
                `}).join('');

                if (storePlugins.length > 3) {
                    storeContainer.innerHTML += `
                        <a href="#store" class="block w-full py-3 text-center text-wabi-primary font-bold bg-wabi-primary/5 rounded-xl hover:bg-wabi-primary/10 transition-colors mt-3">
                            查看更多擴充功能 (${storePlugins.length})
                        </a>
                    `;
                }

                // Bind Install Events
                document.querySelectorAll('.store-install-btn').forEach(btn => {
                    if (!btn.disabled) {
                        btn.addEventListener('click', async () => {
                            btn.disabled = true;
                            btn.textContent = '下載中...';
                            try {
                                const response = await fetch(btn.dataset.url);
                                const script = await response.text();
                                const file = new File([script], 'plugin.js', { type: 'text/javascript' });
                                // 找到對應的商店插件資訊，傳入權限與 icon
                                const matchedPlugin = storePlugins.find(sp => sp.id === btn.dataset.id);
                                await this.app.pluginManager.installPlugin(file, matchedPlugin || null);
                                showToast('安裝成功！', 'success');
                                this.render();
                            } catch (e) {
                                console.error(e);
                                if (e.message !== '使用者取消安裝' && e.message !== '使用者取消更新') {
                                    showToast('安裝失敗', 'error');
                                }
                                btn.disabled = false;
                                btn.textContent = '安裝';
                            }
                        });
                    }
                });

            } else {
                 document.getElementById('store-list-container').innerHTML = '<p class="text-center text-red-500">無法載入商店列表</p>';
            }
        } catch (e) {
            console.error(e);
             document.getElementById('store-list-container').innerHTML = '<p class="text-center text-red-500">無法連結至商店</p>';
        }

        // Handle Delete
        document.querySelectorAll('.delete-plugin-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('確定要移除此擴充功能嗎？')) {
                    await this.app.pluginManager.uninstallPlugin(btn.dataset.id);
                    this.render();
                }
            });
        });
    }
}

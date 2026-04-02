import { showToast } from '../utils.js';

export class SettingsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active max-w-3xl mx-auto">
                <div class="flex items-center p-4 pb-2 justify-between bg-wabi-bg sticky top-0 z-10">
                    <h2 class="text-wabi-primary text-lg font-bold flex-1 text-center">設定</h2>
                </div>
                <div class="p-4 space-y-6">
                    <!-- Settings -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">應用程式</h3>
                        
                        ${this.createSettingItem('fa-solid fa-cloud-arrow-down', '強制更新', 'force-update-btn')}
                        ${this.createSettingItem('fa-solid fa-share-nodes', '分享此 App', 'share-app-btn')}
                        <div id="install-pwa-btn-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-mobile-screen-button', '安裝為應用程式', 'install-pwa-btn')}
                        </div>
                        ${this.createSettingItem('fa-solid fa-puzzle-piece', '擴充功能管理', 'manage-plugins-btn')}
                        ${this.createSettingItem('fa-solid fa-palette', '外觀主題', 'manage-themes-btn')}
                    </div>

                    <!-- Data Management -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">資料管理</h3>
                        ${this.createSettingItem('fa-solid fa-book-bookmark', '帳本管理', 'manage-ledgers-btn')}
                        ${this.createSettingItem('fa-solid fa-cloud', '雲端備份&同步', 'cloud-sync-btn')}
                        ${this.createSettingItem('fa-solid fa-download', '匯出資料', 'export-data-btn')}
                        ${this.createSettingItem('fa-solid fa-upload', '匯入資料', 'import-data-btn')}
                        <input type="file" id="import-file-input" accept=".json" class="hidden">
                    </div>
                    <!-- App Info -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">關於</h3>
                        ${this.createSettingItem('fa-solid fa-arrows-rotate', '檢查更新', 'check-update-btn')}
                        ${this.createSettingItem('fa-solid fa-file-lines', '更新日誌', 'changelog-btn')}
                        ${this.createSettingItem('fa-solid fa-shield-halved', '隱私權政策', 'privacy-btn')}
                        ${this.createSettingItem('fa-solid fa-scale-balanced', '授權條款', 'license-btn')}
                        <a href="https://github.com/ADT109119/jijun" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-brands fa-github"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">GitHub 儲存庫</p>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-chevron-right"></i>
                            </div>
                        </a>
                        <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
                        <div id="version-info" class="px-4 py-3 text-xs text-center text-wabi-text-secondary"></div>
                    </div>

                    <!-- Sponsor the Author -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">贊助作者</h3>
                        <a href="https://buymeacoffee.com/thewalkingfish" target="_blank" rel="noopener noreferrer" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-mug-hot"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">Buy me a Coffee</p>
                            </div>
                            <div class="shrink-0 text-wabi-text-secondary">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </div>
                        </a>
                    </div>

                    <!-- Advanced Features -->
                    <div class="bg-wabi-surface rounded-xl">
                        <h3 class="text-wabi-primary text-base font-bold px-4 pb-2 pt-4">實驗功能</h3>
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-wallet"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">多帳戶模式</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="advanced-account-mode-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-accounts-link-container" class="hidden">
                            ${this.createSettingItem('fa-solid fa-credit-card', '帳戶管理', 'manage-accounts-btn')}
                        </div>
                        <div id="manage-recurring-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-repeat', '週期性交易', 'manage-recurring-btn')}
                        </div>
                        <!-- Debt Management Toggle -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-handshake"></i>
                                </div>
                                <p class="text-wabi-text-primary text-base font-normal">欠款管理</p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="debt-management-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="manage-debts-link-container" class="hidden">
                             ${this.createSettingItem('fa-solid fa-receipt', '欠款管理', 'manage-debts-btn')}
                        </div>

                        
                        <!-- Daily Reminder Feature -->
                        <div class="w-full flex items-center gap-4 bg-transparent px-4 py-3 justify-between border-b border-wabi-border/50">
                            <div class="flex items-center gap-4">
                                <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                                    <i class="fa-solid fa-bell"></i>
                                </div>
                                <div>
                                    <p class="text-wabi-text-primary text-base font-normal">每日提醒</p>
                                    <p class="text-xs text-wabi-text-secondary">定時提醒記帳</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="reminder-toggle" class="sr-only peer">
                                <div class="w-11 h-6 bg-wabi-bg border border-wabi-border rounded-full peer peer-focus:ring-4 peer-focus:ring-wabi-accent/30 peer-checked:bg-wabi-primary peer-checked:border-wabi-primary transition-colors"></div>
                                <span class="absolute left-1 top-1 w-4 h-4 bg-wabi-surface rounded-full transition-transform peer-checked:translate-x-full"></span>
                            </label>
                        </div>
                        <div id="reminder-settings-container" class="hidden px-4 pb-4 border-b border-wabi-border/50 bg-wabi-bg/30">
                            <div class="mt-4 flex items-center justify-between">
                                <label class="text-sm font-medium text-wabi-text-primary">提醒時間</label>
                                <input type="time" id="reminder-time" class="bg-wabi-surface border border-wabi-border text-wabi-text-primary text-sm rounded-lg focus:ring-wabi-primary focus:border-wabi-primary p-2 outline-none">
                            </div>
                            <div class="mt-4">
                                <label class="text-sm font-medium text-wabi-text-primary block mb-2">提醒條件</label>
                                <select id="reminder-condition" class="bg-wabi-surface border border-wabi-border text-wabi-text-primary text-sm rounded-lg focus:ring-wabi-primary focus:border-wabi-primary w-full p-2 outline-none appearance-none">
                                    <option value="always">時間到一律提醒</option>
                                    <option value="no_records">當日尚未記帳才提醒</option>
                                </select>
                            </div>
                        </div>

                        ${this.createSettingItem('fa-solid fa-rectangle-ad', '觀看廣告以移除廣告 24 小時', 'sponsor-reward-ad-btn')}

                    </div>

                    <!-- Banner Ad -->
                    <div id="settings-banner-ad" class="rounded-xl overflow-hidden"></div>

                    <div class="pb-24"></div>
                </div>
            </div>
        `;
        this.setupSettingsPageListeners();
        // Add listener for plugin manager button
        const managePluginsBtn = document.getElementById('manage-plugins-btn');
        if (managePluginsBtn) {
            managePluginsBtn.addEventListener('click', () => {
                window.location.hash = '#plugins';
            });
        }
        // Themes manager button
        const manageThemesBtn = document.getElementById('manage-themes-btn');
        if (manageThemesBtn) {
            manageThemesBtn.addEventListener('click', () => {
                window.location.hash = '#themes';
            });
        }
        // Ledger management button
        const manageLedgersBtn = document.getElementById('manage-ledgers-btn');
        if (manageLedgersBtn) {
            manageLedgersBtn.addEventListener('click', () => {
                window.location.hash = '#ledgers';
            });
        }
        // Cloud sync button
        const cloudSyncBtn = document.getElementById('cloud-sync-btn');
        if (cloudSyncBtn) {
            cloudSyncBtn.addEventListener('click', () => {
                window.location.hash = '#sync-settings';
            });
        }
        // 贊助 - 觀看獎勵廣告以移除廣告 24 小時
        const rewardAdBtn = document.getElementById('sponsor-reward-ad-btn');
        if (rewardAdBtn) {
            rewardAdBtn.addEventListener('click', async () => {
                try {
                    const granted = await this.app.rewardService.showRewardedAd();
                    if (granted) {
                        this.render();
                    }
                } catch (e) {
                    console.warn('獎勵廣告流程失敗:', e);
                }
            });
        }
        // 渲染底部橫幅廣告
        this.app.rewardService.renderBannerAd(document.getElementById('settings-banner-ad')).catch(() => {});

        // PWA install button visibility
        if (this.app.deferredInstallPrompt) {
            const installBtnContainer = document.getElementById('install-pwa-btn-container');
            if (installBtnContainer) {
                installBtnContainer.classList.remove('hidden');
            }
        }
    }

    createSettingItem(icon, text, id) {
        return `
            <button id="${id}" class="w-full flex items-center gap-4 bg-transparent px-4 min-h-14 justify-between hover:bg-wabi-bg/50">
                <div class="flex items-center gap-4">
                    <div class="text-wabi-primary flex items-center justify-center rounded-lg bg-wabi-primary/10 shrink-0 size-10">
                        <i class="${icon}"></i>
                    </div>
                    <p class="text-wabi-text-primary text-base font-normal">${text}</p>
                </div>
                <div class="shrink-0 text-wabi-text-secondary">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
            <div class="pl-16 pr-4"><hr class="border-wabi-border"/></div>
        `.trim();
    }

    setupSettingsPageListeners() {
        document.getElementById('export-data-btn').addEventListener('click', async () => {
            // Show export options dialog
            await this.showExportOptionsModal();
        });

        const importFileInput = document.getElementById('import-file-input');
        document.getElementById('import-data-btn').addEventListener('click', () => {
            importFileInput.click();
        });

        importFileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            this.showConfirmModal('匯入資料將會覆蓋所有現有紀錄，確定要繼續嗎？', async () => {
                try {
                    await this.app.dataService.importData(file);
                    showToast('資料已成功匯入！正在重整...', 'success');
                    setTimeout(() => window.location.reload(), 2000);
                } catch (error) {
                    console.error('匯入失敗:', error);
                    showToast('資料匯入失敗', 'error');
                }
            });
            importFileInput.value = ''; // Reset input
        });

        document.getElementById('check-update-btn').addEventListener('click', () => this.checkForUpdates());
        document.getElementById('changelog-btn').addEventListener('click', () => this.app.changelogManager.showChangelogModal());
        document.getElementById('privacy-btn').addEventListener('click', () => { window.location.hash = '#privacy'; });
        document.getElementById('license-btn').addEventListener('click', () => { window.location.hash = '#license'; });

        // New Listeners
        document.getElementById('force-update-btn').addEventListener('click', () => this.forceUpdate());

        const installBtn = document.getElementById('install-pwa-btn');
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (this.app.deferredInstallPrompt) {
                    this.app.deferredInstallPrompt.prompt();
                    const { outcome } = await this.app.deferredInstallPrompt.userChoice;
                    console.log(`User response to the install prompt: ${outcome}`);
                    this.app.deferredInstallPrompt = null;
                    document.getElementById('install-pwa-btn-container').classList.add('hidden');
                }
            });
        }

        const shareBtn = document.getElementById('share-app-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                if (navigator.share) {
                    navigator.share({
                        title: '輕鬆記帳',
                        text: '快來試試這款簡單好用的記帳 App！',
                        url: window.location.origin,
                    })
                    .then(() => console.log('Successful share'))
                    .catch((error) => console.log('Error sharing', error));
                } else {
                    showToast('您的瀏覽器不支援分享功能', 'warning');
                }
            });
        }

        const versionInfo = document.getElementById('version-info');
        if (versionInfo) {
            const latestVersion = this.app.changelogManager.getAllVersions()[0];
            versionInfo.textContent = `版本 v${latestVersion.version}`;
        }

        const advancedModeToggle = document.getElementById('advanced-account-mode-toggle');
        if (advancedModeToggle) {
            this.app.dataService.getSetting('advancedAccountModeEnabled').then(setting => {
                const isEnabled = !!setting?.value;
                advancedModeToggle.checked = isEnabled;
                if (isEnabled) {
                    document.getElementById('manage-accounts-link-container').classList.remove('hidden');
                    document.getElementById('manage-recurring-link-container').classList.remove('hidden');
                }
            });

            advancedModeToggle.addEventListener('change', async (e) => {
                const isEnabled = e.target.checked;
                await this.app.dataService.saveSetting({ key: 'advancedAccountModeEnabled', value: isEnabled });
                if (isEnabled) {
                    await this.handleAdvancedModeActivation();
                }
                showToast(`多帳戶模式已${isEnabled ? '啟用' : '停用'}，將重新載入...`);
                setTimeout(() => window.location.reload(), 1500);
            });
        }

        const manageAccountsBtn = document.getElementById('manage-accounts-btn');
        if (manageAccountsBtn) {
            manageAccountsBtn.addEventListener('click', () => {
                window.location.hash = '#accounts';
            });
        }

        const manageRecurringBtn = document.getElementById('manage-recurring-btn');
        if (manageRecurringBtn) {
            manageRecurringBtn.addEventListener('click', () => {
                window.location.hash = '#recurring';
            });
        }

        // Debt Management Toggle
        const debtManagementToggle = document.getElementById('debt-management-toggle');
        if (debtManagementToggle) {
            this.app.dataService.getSetting('debtManagementEnabled').then(setting => {
                const isEnabled = !!setting?.value;
                debtManagementToggle.checked = isEnabled;
                if (isEnabled) {
                    document.getElementById('manage-debts-link-container').classList.remove('hidden');
                }
            });

            debtManagementToggle.addEventListener('change', async (e) => {
                const isEnabled = e.target.checked;
                await this.app.dataService.saveSetting({ key: 'debtManagementEnabled', value: isEnabled });
                if (isEnabled) {
                    document.getElementById('manage-debts-link-container').classList.remove('hidden');
                } else {
                    document.getElementById('manage-debts-link-container').classList.add('hidden');
                }
                showToast(`欠款管理已${isEnabled ? '啟用' : '停用'}`);
            });
        }

        const manageDebtsBtn = document.getElementById('manage-debts-btn');
        if (manageDebtsBtn) {
            manageDebtsBtn.addEventListener('click', () => {
                window.location.hash = '#debts';
            });
        }

        // Daily Reminder UI Setup
        const reminderToggle = document.getElementById('reminder-toggle');
        const reminderSettingsContainer = document.getElementById('reminder-settings-container');
        const reminderTimeInput = document.getElementById('reminder-time');
        const reminderConditionSelect = document.getElementById('reminder-condition');

        if (reminderToggle) {
            Promise.all([
                this.app.dataService.getSetting('reminderEnabled'),
                this.app.dataService.getSetting('reminderTime'),
                this.app.dataService.getSetting('reminderCondition')
            ]).then(([enabledSetting, timeSetting, conditionSetting]) => {
                const isEnabled = !!enabledSetting?.value;
                reminderToggle.checked = isEnabled;
                reminderTimeInput.value = timeSetting?.value || '20:00';
                reminderConditionSelect.value = conditionSetting?.value || 'no_records';
                
                if (isEnabled) {
                    reminderSettingsContainer.classList.remove('hidden');
                }
            });

            const updateReminderLogic = async () => {
                const isEnabled = reminderToggle.checked;
                const timeStr = reminderTimeInput.value || '20:00';
                const condition = reminderConditionSelect.value || 'always';

                await this.app.dataService.saveSetting({ key: 'reminderEnabled', value: isEnabled });
                await this.app.dataService.saveSetting({ key: 'reminderTime', value: timeStr });
                await this.app.dataService.saveSetting({ key: 'reminderCondition', value: condition });

                if (isEnabled) {
                    const hasPerm = await this.app.notificationService.requestPermission();
                    if (!hasPerm) {
                        showToast('請允許通知權限以使用此功能', 'warning');
                        reminderToggle.checked = false;
                        reminderSettingsContainer.classList.add('hidden');
                        await this.app.dataService.saveSetting({ key: 'reminderEnabled', value: false });
                        return;
                    }
                }
                
                await this.app.notificationService.applyCurrentSettings();
            };

            reminderToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    reminderSettingsContainer.classList.remove('hidden');
                } else {
                    reminderSettingsContainer.classList.add('hidden');
                }
                updateReminderLogic();
            });

            reminderTimeInput.addEventListener('change', updateReminderLogic);
            reminderConditionSelect.addEventListener('change', updateReminderLogic);
        }
    }

    async showExportOptionsModal() {
        const debtEnabled = await this.app.dataService.getSetting('debtManagementEnabled');
        const showDebtOption = !!debtEnabled?.value;
        const advancedModeEnabled = await this.app.dataService.getSetting('advancedAccountModeEnabled');
        const showAccountOption = !!advancedModeEnabled?.value;

        const modal = document.createElement('div');
        modal.id = 'export-options-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6">
                <h3 class="text-lg font-bold text-wabi-primary mb-4">匯出資料選項</h3>
                <div class="space-y-3 mb-6">
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-records" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">記帳紀錄</p>
                            <p class="text-xs text-wabi-text-secondary">所有收支紀錄</p>
                        </div>
                    </label>
                    ${showAccountOption ? `
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-accounts" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">帳戶</p>
                            <p class="text-xs text-wabi-text-secondary">多帳戶設定及餘額</p>
                        </div>
                    </label>
                    ` : ''}
                    ${showDebtOption ? `
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-debts" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">欠款資料</p>
                            <p class="text-xs text-wabi-text-secondary">聯絡人及欠款紀錄</p>
                        </div>
                    </label>
                    ` : ''}
                    <label class="flex items-center gap-3 p-3 bg-wabi-surface rounded-lg border border-wabi-border cursor-pointer">
                        <input type="checkbox" id="export-categories" checked class="w-5 h-5 rounded border-wabi-border text-wabi-primary focus:ring-wabi-primary">
                        <div>
                            <p class="font-medium text-wabi-text-primary">自訂分類</p>
                            <p class="text-xs text-wabi-text-secondary">自訂的收支分類</p>
                        </div>
                    </label>
                </div>
                <div class="flex space-x-3">
                    <button id="confirm-export-btn" class="flex-1 bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        <i class="fa-solid fa-download mr-2"></i>匯出
                    </button>
                    <button id="cancel-export-btn" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();

        modal.querySelector('#cancel-export-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        modal.querySelector('#confirm-export-btn').addEventListener('click', async () => {
            const options = {
                includeRecords: modal.querySelector('#export-records')?.checked ?? true,
                includeAccounts: modal.querySelector('#export-accounts')?.checked ?? true,
                includeDebts: modal.querySelector('#export-debts')?.checked ?? true,
                includeCategories: modal.querySelector('#export-categories')?.checked ?? true,
            };

            try {
                await this.app.dataService.exportData(options);
                showToast('資料已成功匯出！', 'success');
                closeModal();
            } catch (error) {
                console.error('匯出失敗:', error);
                showToast('資料匯出失敗', 'error');
            }
        });
    }

    async checkForUpdates() {
        if (!('serviceWorker' in navigator)) {
            showToast('瀏覽器不支援自動更新', 'warning');
            return;
        }
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
            showToast('Service Worker 未註冊', 'error');
            return;
        }

        showToast('正在檢查更新...');
        await registration.update();

        if (registration.waiting) {
            this.showUpdateAvailable(registration);
        } else {
            showToast('已是最新版本！', 'success');
        }
    }

    async forceUpdate() {
        this.showConfirmModal('確定要強制更新嗎？這將會清除所有快取資料並重新載入 App。', async () => {
            showToast('強制更新中...');
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
                window.location.reload(true);
            } catch (error) {
                console.error('強制更新失敗:', error);
                showToast('強制更新失敗', 'error');
            }
        });
    }

    showConfirmModal(message, onConfirm) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]';
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 text-center shadow-xl">
                <div class="size-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-triangle-exclamation text-2xl text-wabi-expense"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-expense mb-2">確認操作</h3>
                <p class="text-wabi-text-primary font-medium mb-6">${message}</p>
                <div class="flex space-x-3">
                    <button id="settings-confirm-ok" class="flex-1 bg-wabi-expense hover:bg-red-600 text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                        確定
                    </button>
                    <button id="settings-confirm-cancel" class="px-6 bg-wabi-surface border border-wabi-border hover:bg-wabi-bg text-wabi-text-primary py-3 rounded-lg transition-colors">
                        取消
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#settings-confirm-cancel').addEventListener('click', () => modal.remove());
        modal.querySelector('#settings-confirm-ok').addEventListener('click', () => {
            modal.remove();
            onConfirm();
        });
    }

    showAlertModal(title, message, icon = 'fa-solid fa-circle-info', iconColor = 'text-wabi-primary') {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]';
        modal.innerHTML = `
            <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 text-center shadow-xl">
                <div class="size-12 bg-wabi-bg rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="${icon} text-2xl ${iconColor}"></i>
                </div>
                <h3 class="text-xl font-bold text-wabi-primary mb-2">${title}</h3>
                <p class="text-wabi-text-primary font-medium mb-6">${message}</p>
                <button id="settings-alert-ok" class="w-full bg-wabi-primary hover:bg-wabi-primary-hover text-wabi-surface font-bold py-3 rounded-lg transition-colors shadow-sm">
                    我知道了
                </button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#settings-alert-ok').addEventListener('click', () => modal.remove());
    }

    showUpdateAvailable(registration) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerHTML = `
            <span>發現新版本！</span>
            <button id="update-now-btn" class="ml-4 font-bold underline">立即更新</button>
        `;
        toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg opacity-0 transition-opacity duration-300 z-[100] text-wabi-surface bg-wabi-primary toast-show';

        document.getElementById('update-now-btn').addEventListener('click', () => {
            if (registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            toast.classList.replace('toast-show', 'toast-hide');
            // reset toast inner HTML for subsequent uses
            setTimeout(() => {
                toast.innerHTML = '<span id="toast-message"></span>';
            }, 300);
        });
    }

    async handleAdvancedModeActivation() {
        const accounts = await this.app.dataService.getAccounts();
        let defaultAccount;

        if (accounts.length === 0) {
            console.log('No accounts found, creating a default account.');
            const newAccount = {
                name: '現金',
                balance: 0,
                type: 'cash',
                icon: 'fa-solid fa-money-bill-wave',
                color: 'bg-green-500'
            };
            const newAccountId = await this.app.dataService.addAccount(newAccount);
            defaultAccount = await this.app.dataService.getAccount(newAccountId);
            showToast('已建立預設「現金」帳戶');
        } else {
            defaultAccount = accounts[0];
        }

        if (!defaultAccount) {
            console.error('Failed to get or create a default account.');
            return;
        }

        const allRecords = await this.app.dataService.getRecords();
        const recordsToUpdate = allRecords.filter(r => r.accountId === undefined);

        if (recordsToUpdate.length > 0) {
            console.log(`Migrating ${recordsToUpdate.length} records to default account...`);
            for (const record of recordsToUpdate) {
                await this.app.dataService.updateRecord(record.id, { ...record, accountId: defaultAccount.id });
            }
            console.log('Record migration complete.');
            showToast(`${recordsToUpdate.length} 筆舊紀錄已歸入預設帳戶`);
        }
    }
}

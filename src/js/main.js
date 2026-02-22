import DataService from './dataService.js';
import { formatDateToString, calculateNextDueDate, shouldSkipDate } from './utils.js';
import { BudgetManager } from './budgetManager.js';
import { CategoryManager } from './categoryManager.js';
import { ChangelogManager } from './changelog.js';
import { QuickSelectManager } from './quickSelectManager.js';
import { DebtManager } from './debtManager.js';
import { PluginManager } from './pluginManager.js';
import { SyncService } from './syncService.js';
import { AdService } from './adService.js';
import { Router } from './router.js';

import { HomePage } from './pages/homePage.js';
import { AddPage } from './pages/addPage.js';
import { SettingsPage } from './pages/settingsPage.js';
import { AccountsPage } from './pages/accountsPage.js';
import { RecurringPage } from './pages/recurringPage.js';
import { SyncSettingsPage } from './pages/syncSettingsPage.js';
import { PluginsPage } from './pages/pluginsPage.js';
import { RecordsPage } from './pages/recordsPage.js';
import { StatsPage } from './pages/statsPage.js';
import { DebtsPage } from './pages/debtsPage.js';
import { ContactsPage } from './pages/contactsPage.js';
import { StorePage } from './pages/storePage.js';

class EasyAccountingApp {
    constructor() {
        this.dataService = new DataService();
        this.categoryManager = new CategoryManager();
        this.changelogManager = new ChangelogManager();
        this.budgetManager = new BudgetManager(this.dataService, this.categoryManager);
        this.quickSelectManager = new QuickSelectManager();
        this.debtManager = new DebtManager(this.dataService);
        this.pluginManager = new PluginManager(this.dataService, this);
        this.syncService = new SyncService(this.dataService);
        this.adService = new AdService();

        this.appContainer = document.getElementById('app-container');

        this.currentHash = null;
        this.deferredInstallPrompt = null;

        this.router = new Router(this);

        this.init();
    }

    async init() {
        await this.dataService.init();

        const advancedModeSetting = await this.dataService.getSetting('advancedAccountModeEnabled');
        this.advancedModeEnabled = !!advancedModeSetting?.value;
        if (this.advancedModeEnabled) {
            this.accounts = await this.dataService.getAccounts();
        } else {
            this.accounts = [];
        }

        this.registerServiceWorker();

        window.addEventListener('beforeinstallprompt', (e) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            this.deferredInstallPrompt = e;
            // Update UI to notify the user they can install the PWA
            const installBtnContainer = document.getElementById('install-pwa-btn-container');
            if (installBtnContainer) {
                installBtnContainer.classList.remove('hidden');
            }
        });

        // Hide install button if already in standalone mode
        if (window.matchMedia('(display-mode: standalone)').matches) {
            const installBtnContainer = document.getElementById('install-pwa-btn-container');
            if (installBtnContainer) {
                installBtnContainer.classList.add('hidden');
            }
        }

        this.processRecurringTransactions();
        
        // Initialize plugins
        await this.pluginManager.init();

        // Connect DataService hooks to PluginManager
        this.dataService.setHookProvider(async (hookName, payload) => {
             return await this.pluginManager.triggerHook(hookName, payload);
        });
        
        // Initialize sync service (restore saved tokens/settings)
        await this.syncService.init();

        // Setup sidebar version info
        const sidebarVersionInfo = document.getElementById('sidebar-version-info');
        if (sidebarVersionInfo) {
            const latestVersion = this.changelogManager.getAllVersions()[0];
            sidebarVersionInfo.textContent = `版本 v${latestVersion.version}`;
        }

        // Register Routes
        this.router.register('home', new HomePage(this));
        this.router.register('records', new RecordsPage(this));
        this.router.register('add', new AddPage(this));
        this.router.register('stats', new StatsPage(this));
        this.router.register('settings', new SettingsPage(this));
        this.router.register('accounts', new AccountsPage(this));
        this.router.register('recurring', new RecurringPage(this));
        this.router.register('debts', new DebtsPage(this));
        this.router.register('contacts', new ContactsPage(this));
        this.router.register('plugins', new PluginsPage(this));
        this.router.register('store', new StorePage(this));
        this.router.register('sync-settings', new SyncSettingsPage(this));

        // Start Router
        this.router.init();
    }

    async processRecurringTransactions() {
        const today = formatDateToString(new Date());
        const recurringTxs = await this.dataService.getRecurringTransactions();
        
        for (const tx of recurringTxs) {
            let { nextDueDate } = tx;

            let iterations = 0;
            const MAX_ITERATIONS = 365; // 安全上限：避免無限迴圈

            while (nextDueDate && nextDueDate <= today && iterations < MAX_ITERATIONS) {
                iterations++;
                const dateToCheck = new Date(nextDueDate);

                // Check if the date should be skipped
                if (shouldSkipDate(dateToCheck, tx.skipRules)) {
                    // If skipped, just advance the date and continue the loop
                    nextDueDate = calculateNextDueDate(nextDueDate, tx.frequency, tx.interval);
                    continue;
                }

                // Generate a new record for this due date
                const newRecord = {
                    type: tx.type,
                    amount: tx.amount,
                    category: tx.category,
                    description: tx.description,
                    date: nextDueDate,
                    accountId: tx.accountId,
                };
                await this.dataService.addRecord(newRecord);

                // Calculate the next due date for the next iteration
                nextDueDate = calculateNextDueDate(nextDueDate, tx.frequency, tx.interval);
            }

            if (iterations >= MAX_ITERATIONS) {
                console.warn(`週期交易「${tx.description}」迭代次數超過上限 (${MAX_ITERATIONS})，已中止`);
            }

            // Update the recurring transaction with the final new due date
            if (nextDueDate !== tx.nextDueDate) {
                await this.dataService.updateRecurringTransaction(tx.id, { nextDueDate });
            }
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/serviceWorker.js');
                console.log('Service Worker registered');

                // Listen for controller change to reload the page
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (refreshing) return;
                    refreshing = true;
                    window.location.reload();
                });

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // Show update notification via SettingsPage helper if possible,
                            // or just ignore here as SettingsPage handles manual check.
                            // The original code called this.showUpdateAvailable(registration)
                            // which was in main.js. I moved it to SettingsPage.
                            // If we want auto-notification, we might need a global toast or something.
                            // For now, I'll omit it or implement a simple toast.
                            console.log('New content is available; please refresh.');
                        }
                    });
                });
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new EasyAccountingApp();
});

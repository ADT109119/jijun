import { debounce } from './utils.js';

export class ThemeManager {
    constructor(dataService) {
        this.dataService = dataService;
        this.activeTheme = null;
        this.styleElement = null;
        this.observer = null;

        // Ensure style element exists
        this.styleElement = document.getElementById('dynamic-theme-styles');
        if (!this.styleElement) {
            this.styleElement = document.createElement('style');
            this.styleElement.id = 'dynamic-theme-styles';
            document.head.appendChild(this.styleElement);
        }
    }

    async init() {
        // Check if any themes exist, if not, auto-install Dark Mode
        let installedThemes = await this.dataService.getInstalledThemes();
        if (!installedThemes || installedThemes.length === 0) {
            try {
                const response = await fetch('themes/dark.json');
                if (response.ok) {
                    const defaultDarkTheme = await response.json();
                    await this.dataService.installTheme(defaultDarkTheme);
                    installedThemes = [defaultDarkTheme];
                    console.log('Auto-installed Dark Mode theme.');
                }
            } catch (e) {
                console.warn('Failed to auto-install dark theme', e);
            }
        }

        const setting = await this.dataService.getSetting('activeThemeId');
        const activeThemeId = setting ? setting.value : null;

        if (activeThemeId) {
            const theme = await this.dataService.getTheme(activeThemeId);
            if (theme) {
                await this.applyTheme(theme);
            }
        }
    }

    async applyTheme(theme) {
        this.activeTheme = theme;

        // Apply CSS Variables
        let cssText = ':root {\n';
        if (theme && theme.colors) {
            for (const [key, value] of Object.entries(theme.colors)) {
                // key is like "wabi-bg", we want "--theme-bg"
                const cssVarName = key.replace(/^wabi-/, '');
                cssText += `  --theme-${cssVarName}: ${value};\n`;
            }
        }
        cssText += '}\n';
        this.styleElement.textContent = cssText;

        // Save active theme ID
        await this.dataService.saveSetting({ key: 'activeThemeId', value: theme ? theme.id : null });

        // Apply Icon Replacements
        this.stopIconObserver();

        // Remove existing theme replacements
        this.clearReplacedIcons();

        if (theme && theme.icons && Object.keys(theme.icons).length > 0) {
            this.applyIconReplacements(theme.icons);
            this.startIconObserver(theme.icons);
        }
    }

    async clearTheme() {
        await this.applyTheme(null);
    }

    clearReplacedIcons() {
        // Remove our injected replacements
        document.querySelectorAll('.theme-icon-replacement').forEach(el => el.remove());
        // Unhide original elements
        document.querySelectorAll('[data-original-display]').forEach(el => {
            el.style.display = el.getAttribute('data-original-display') || '';
            el.removeAttribute('data-original-display');
        });
    }

    applyIconReplacements(iconsConfig) {
        for (const [selector, replacementInfo] of Object.entries(iconsConfig)) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (el.nextElementSibling && el.nextElementSibling.classList.contains('theme-icon-replacement')) {
                    return; // Already replaced
                }

                // Hide original element
                const computedDisplay = window.getComputedStyle(el).display;
                if (el.style.display !== 'none') {
                    el.setAttribute('data-original-display', computedDisplay);
                    el.style.display = 'none';
                }

                // Create replacement
                let replacementNode;
                if (replacementInfo.type === 'image') {
                    replacementNode = document.createElement('img');
                    replacementNode.src = replacementInfo.src;
                    replacementNode.className = `theme-icon-replacement ${replacementInfo.className || ''}`;
                    if (replacementInfo.width) replacementNode.style.width = replacementInfo.width;
                    if (replacementInfo.height) replacementNode.style.height = replacementInfo.height;
                } else if (replacementInfo.type === 'fontawesome') {
                    replacementNode = document.createElement('i');
                    replacementNode.className = `${replacementInfo.className} theme-icon-replacement`;
                } else if (replacementInfo.type === 'svg') {
                    const template = document.createElement('template');
                    template.innerHTML = replacementInfo.svg.trim();
                    replacementNode = template.content.firstChild;
                    replacementNode.classList.add('theme-icon-replacement');
                    if (replacementInfo.className) {
                        replacementNode.setAttribute('class', replacementNode.getAttribute('class') + ' ' + replacementInfo.className);
                    }
                }

                if (replacementNode) {
                    el.parentNode.insertBefore(replacementNode, el.nextSibling);
                }
            });
        }
    }

    startIconObserver(iconsConfig) {
        const processMutations = debounce(() => {
            this.applyIconReplacements(iconsConfig);
        }, 100);

        this.observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                    break;
                }
            }
            if (shouldProcess) {
                processMutations();
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    stopIconObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
}

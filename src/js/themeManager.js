import { debounce } from './utils.js'

// 內建深色主題 ID（不可刪除、自動更新）
export const DARK_THEME_ID = 'com.walkingfish.theme.dark'

// 主題模式常數
export const THEME_MODES = {
    SYSTEM: 'system',
    LIGHT: 'light',
    DARK: 'dark',
    CUSTOM: 'custom',
}

export class ThemeManager {
    constructor(dataService) {
        this.dataService = dataService
        this.activeTheme = null
        this.themeMode = THEME_MODES.SYSTEM // 預設為跟隨系統
        this.styleElement = null
        this.observer = null
        this.mediaQueryList = null
        this.mediaQueryHandler = null
        this.darkThemeCache = null

        // Ensure style element exists
        if (typeof document !== 'undefined') {
            this.styleElement = document.getElementById('dynamic-theme-styles')
            if (!this.styleElement) {
                this.styleElement = document.createElement('style')
                this.styleElement.id = 'dynamic-theme-styles'
                document.head.appendChild(this.styleElement)
            }
        }
    }

    // 判斷是否為內建深色主題（不可刪除）
    isBuiltinTheme(themeId) {
        return themeId === DARK_THEME_ID
    }

    // 判斷系統目前是否偏好深色模式
    isSystemDarkMode() {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches
        }
        return false
    }

    // 初始化並監聽系統色彩偏好設定變更
    _initMediaListener() {
        if (typeof window === 'undefined' || !window.matchMedia) return
        if (this.mediaQueryHandler) return // 避免重複註冊

        this.mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')
        this.mediaQueryHandler = async e => {
            if (this.themeMode === THEME_MODES.SYSTEM) {
                await this._applySystemTheme(e.matches)
            }
        }

        if (this.mediaQueryList.addEventListener) {
            this.mediaQueryList.addEventListener('change', this.mediaQueryHandler)
        } else if (this.mediaQueryList.addListener) {
            this.mediaQueryList.addListener(this.mediaQueryHandler)
        }
    }

    // 移除系統色彩偏好監聽器
    _removeMediaListener() {
        if (this.mediaQueryList && this.mediaQueryHandler) {
            if (this.mediaQueryList.removeEventListener) {
                this.mediaQueryList.removeEventListener(
                    'change',
                    this.mediaQueryHandler
                )
            } else if (this.mediaQueryList.removeListener) {
                this.mediaQueryList.removeListener(this.mediaQueryHandler)
            }
            this.mediaQueryHandler = null
            this.mediaQueryList = null
        }
    }

    // 取得內建深色主題物件
    async getDarkTheme() {
        if (this.darkThemeCache) return this.darkThemeCache
        if (this.dataService && this.dataService.getTheme) {
            try {
                const theme = await this.dataService.getTheme(DARK_THEME_ID)
                if (theme) {
                    this.darkThemeCache = theme
                    return theme
                }
            } catch (e) {
                console.warn('Failed to load dark theme from dataService', e)
            }
        }
        return null
    }

    async init() {
        // 總是重新抓取 dark.json，確保內建深色主題保持最新版本
        try {
            const response = await fetch('themes/dark.json')
            if (response.ok) {
                const latestDark = await response.json()
                this.darkThemeCache = latestDark
                await this.dataService.installTheme(latestDark) // installTheme 有 upsert 語意
                console.log('Built-in Dark Mode theme updated.')
            }
        } catch (e) {
            console.warn('Failed to auto-update dark theme', e)
        }

        // 初始化系統深淺色媒體查詢監聽
        this._initMediaListener()

        const modeSetting = await this.dataService.getSetting('themeMode')
        const activeSetting = await this.dataService.getSetting('activeThemeId')
        const activeThemeId = activeSetting ? activeSetting.value : null

        // 判定初始外觀模式（向後相容舊設定）
        if (modeSetting && modeSetting.value) {
            this.themeMode = modeSetting.value
        } else if (activeThemeId === DARK_THEME_ID) {
            this.themeMode = THEME_MODES.DARK
        } else if (activeThemeId) {
            this.themeMode = THEME_MODES.CUSTOM
        } else {
            this.themeMode = THEME_MODES.SYSTEM
        }

        // 依據模式套用對應主題
        if (this.themeMode === THEME_MODES.SYSTEM) {
            await this._applySystemTheme(this.isSystemDarkMode())
        } else if (this.themeMode === THEME_MODES.DARK) {
            const darkTheme = await this.getDarkTheme()
            if (darkTheme) {
                await this._applyThemeStyles(darkTheme)
            }
        } else if (this.themeMode === THEME_MODES.LIGHT) {
            await this._clearThemeStyles()
        } else if (this.themeMode === THEME_MODES.CUSTOM && activeThemeId) {
            const theme = await this.dataService.getTheme(activeThemeId)
            if (theme) {
                await this._applyThemeStyles(theme)
            }
        }
    }

    // 系統深淺色動態切換處理
    async _applySystemTheme(isDark) {
        if (isDark) {
            const darkTheme = await this.getDarkTheme()
            if (darkTheme) {
                await this._applyThemeStyles(darkTheme)
            }
        } else {
            await this._clearThemeStyles()
        }
        this._dispatchThemeChange()
    }

    // 設定主題模式
    async setThemeMode(mode, customThemeId = null) {
        this.themeMode = mode
        await this.dataService.saveSetting({
            key: 'themeMode',
            value: mode,
        })

        if (mode === THEME_MODES.SYSTEM) {
            await this.dataService.saveSetting({
                key: 'activeThemeId',
                value: null,
            })
            await this._applySystemTheme(this.isSystemDarkMode())
        } else if (mode === THEME_MODES.LIGHT) {
            await this.dataService.saveSetting({
                key: 'activeThemeId',
                value: null,
            })
            await this._clearThemeStyles()
        } else if (mode === THEME_MODES.DARK) {
            await this.dataService.saveSetting({
                key: 'activeThemeId',
                value: DARK_THEME_ID,
            })
            const darkTheme = await this.getDarkTheme()
            if (darkTheme) {
                await this._applyThemeStyles(darkTheme)
            }
        } else if (mode === THEME_MODES.CUSTOM && customThemeId) {
            await this.dataService.saveSetting({
                key: 'activeThemeId',
                value: customThemeId,
            })
            const theme = await this.dataService.getTheme(customThemeId)
            if (theme) {
                await this._applyThemeStyles(theme)
            }
        }
        this._dispatchThemeChange()
    }

    // 更新 meta theme-color 標籤
    updateMetaThemeColor(color) {
        if (typeof document === 'undefined') return
        let meta = document.querySelector('meta[name="theme-color"]')
        if (!meta) {
            meta = document.createElement('meta')
            meta.name = 'theme-color'
            document.head.appendChild(meta)
        }
        if (meta) {
            meta.setAttribute('content', color)
        }
    }

    // 分派主題變更事件，讓活躍頁面同步更新狀態
    _dispatchThemeChange() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            const isDark =
                typeof document !== 'undefined' &&
                document.documentElement.classList.contains('dark')
            window.dispatchEvent(
                new CustomEvent('themechange', {
                    detail: {
                        mode: this.themeMode,
                        activeTheme: this.activeTheme,
                        isDark,
                    },
                })
            )
        }
    }

    // Utility to convert hex to RGB triplet (e.g., "#334A52" -> "51 74 82")
    hexToRgbTriplet(hex) {
        if (!hex || typeof hex !== 'string') {
            return null
        }
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
        hex = hex.replace(shorthandRegex, function (m, r, g, b) {
            return r + r + g + g + b + b
        })

        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result
            ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
            : null
    }

    // 套用特定主題樣式（內部核心渲染方法）
    async _applyThemeStyles(theme) {
        this.activeTheme = theme

        // Apply CSS Variables
        let cssText = ':root {\n'
        if (theme && theme.colors) {
            for (const [key, value] of Object.entries(theme.colors)) {
                const cssVarName = String(key)
                    .replace(/^wabi-/, '')
                    .replace(/[^a-zA-Z0-9_-]/g, '')
                if (!cssVarName) continue
                const rgbValue = this.hexToRgbTriplet(value)
                if (rgbValue) {
                    cssText += `  --theme-${cssVarName}: ${rgbValue};\n`
                } else {
                    const sanitized = String(value).replace(/[;{}@<>]/g, '')
                    cssText += `  --theme-${cssVarName}: ${sanitized};\n`
                }
            }
        }
        cssText += '}\n'
        if (this.styleElement) {
            this.styleElement.textContent = cssText
        }

        // Toggle dark-theme class on body based on theme properties or luminance
        const isDark =
            theme &&
            (theme.id === DARK_THEME_ID ||
                theme.id.includes('dark') ||
                theme.dark ||
                (() => {
                    const bg =
                        theme.colors &&
                        (theme.colors['wabi-bg'] ||
                            theme.colors['wabi-surface'])
                    if (bg && bg.startsWith('#')) {
                        const hex = bg.substring(1)
                        let r = parseInt(hex.substring(0, 2), 16)
                        let g = parseInt(hex.substring(2, 4), 16)
                        let b = parseInt(hex.substring(4, 6), 16)
                        if (hex.length === 3) {
                            r = parseInt(hex[0] + hex[0], 16)
                            g = parseInt(hex[1] + hex[1], 16)
                            b = parseInt(hex[2] + hex[2], 16)
                        }
                        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
                        return luminance < 128
                    }
                    return false
                })())

        if (typeof document !== 'undefined') {
            if (isDark) {
                document.documentElement.classList.add('dark')
            } else {
                document.documentElement.classList.remove('dark')
            }
        }

        // 更新 meta theme-color
        const themeBg =
            theme?.colors?.['wabi-bg'] || (isDark ? '#0f172a' : '#f5f5f3')
        this.updateMetaThemeColor(themeBg)

        // Apply Icon Replacements
        this.stopIconObserver()
        this.clearReplacedIcons()

        if (theme && theme.icons && Object.keys(theme.icons).length > 0) {
            this.applyIconReplacements(theme.icons)
            this.startIconObserver(theme.icons)
        }
    }

    // 清除自訂樣式，恢復預設淺色風格（內部核心方法）
    async _clearThemeStyles() {
        this.activeTheme = null
        if (this.styleElement) {
            this.styleElement.textContent = ''
        }
        if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('dark')
        }
        this.updateMetaThemeColor('#f5f5f3')
        this.stopIconObserver()
        this.clearReplacedIcons()
    }

    // 向後相容方法：外部呼叫 applyTheme
    async applyTheme(theme) {
        if (!theme) {
            await this.setThemeMode(THEME_MODES.LIGHT)
        } else if (theme.id === DARK_THEME_ID) {
            await this.setThemeMode(THEME_MODES.DARK)
        } else {
            await this.setThemeMode(THEME_MODES.CUSTOM, theme.id)
        }
    }

    // 向後相容方法：外部呼叫 clearTheme
    async clearTheme() {
        await this.setThemeMode(THEME_MODES.LIGHT)
    }

    clearReplacedIcons() {
        if (typeof document === 'undefined') return
        // Remove our injected replacements
        document
            .querySelectorAll('.theme-icon-replacement')
            .forEach(el => el.remove())
        // Unhide original elements
        document.querySelectorAll('[data-original-display]').forEach(el => {
            el.style.display = el.getAttribute('data-original-display') || ''
            el.removeAttribute('data-original-display')
        })
    }

    /**
     * 解析並消毒 SVG 字串，移除可執行腳本與事件處理器，防止儲存型 XSS (CR-01)。
     * @param {string} svgString
     * @returns {SVGElement|null} 消毒後的 SVG 元素，若解析失敗則回傳 null
     */
    sanitizeSVG(svgString) {
        if (typeof svgString !== 'string' || !svgString.trim()) return null
        let doc
        try {
            // 使用 text/html 解析，能完美處理未帶 xmlns 或包含 HTML 標籤格式的 SVG
            doc = new DOMParser().parseFromString(
                svgString.trim(),
                'text/html'
            )
        } catch {
            return null
        }
        const svg = doc.querySelector('svg')
        if (!svg) return null

        // 補上 xmlns 屬性確保標準 SVG 命名空間
        if (!svg.hasAttribute('xmlns')) {
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        }

        // 移除可嵌入 HTML/腳本/樣式的可疑元素
        svg.querySelectorAll(
            'script, foreignObject, iframe, embed, object, style, link'
        ).forEach(el => el.remove())

        // 遍歷所有節點，移除事件屬性與危險連結 (javascript:, data:text/html, vbscript:)
        const nodes = [svg, ...svg.querySelectorAll('*')]
        for (const el of nodes) {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase()
                const value = attr.value.toLowerCase().trim()
                if (name.startsWith('on')) {
                    el.removeAttribute(attr.name)
                } else if (
                    ['href', 'xlink:href', 'src', 'data', 'action'].includes(
                        name
                    ) &&
                    (value.startsWith('javascript:') ||
                        value.startsWith('data:text/html') ||
                        value.startsWith('vbscript:'))
                ) {
                    el.removeAttribute(attr.name)
                }
            }
        }
        return svg
    }

    /**
     * 將 SVG 字串消毒後回傳乾淨的 HTML 字串，方便用於 DOM 樣板字串 (例如主題商店與主題列表預覽)。
     * @param {string} svgString
     * @returns {string|null} 消毒後的 SVG HTML 字串
     */
    sanitizeSVGToString(svgString) {
        const svg = this.sanitizeSVG(svgString)
        return svg ? svg.outerHTML : null
    }

    applyIconReplacements(iconsConfig) {
        for (const [selector, replacementInfo] of Object.entries(iconsConfig)) {
            const elements = document.querySelectorAll(selector)
            elements.forEach(el => {
                if (
                    el.nextElementSibling &&
                    el.nextElementSibling.classList.contains(
                        'theme-icon-replacement'
                    )
                ) {
                    return // Already replaced
                }

                // Hide original element
                const computedDisplay = window.getComputedStyle(el).display
                if (el.style.display !== 'none') {
                    el.setAttribute('data-original-display', computedDisplay)
                    el.style.display = 'none'
                }

                // Create replacement
                let replacementNode
                if (replacementInfo.type === 'image') {
                    replacementNode = document.createElement('img')
                    replacementNode.src = replacementInfo.src
                    replacementNode.className = `theme-icon-replacement ${replacementInfo.className || ''}`
                    if (replacementInfo.width)
                        replacementNode.style.width = replacementInfo.width
                    if (replacementInfo.height)
                        replacementNode.style.height = replacementInfo.height
                } else if (replacementInfo.type === 'fontawesome') {
                    replacementNode = document.createElement('i')
                    replacementNode.className = `${replacementInfo.className} theme-icon-replacement`
                } else if (replacementInfo.type === 'svg') {
                    // Parse via DOMParser and sanitize to prevent SVG/stored XSS
                    // from malicious theme sources (CR-01)
                    replacementNode = this.sanitizeSVG(replacementInfo.svg)
                    if (replacementNode) {
                        replacementNode.classList.add('theme-icon-replacement')
                        if (replacementInfo.className) {
                            replacementInfo.className
                                .split(' ')
                                .filter(Boolean)
                                .forEach(cls =>
                                    replacementNode.classList.add(cls)
                                )
                        }
                    }
                }

                if (replacementNode) {
                    el.parentNode.insertBefore(replacementNode, el.nextSibling)
                }
            })
        }
    }

    startIconObserver(iconsConfig) {
        const processMutations = debounce(() => {
            this.applyIconReplacements(iconsConfig)
        }, 100)

        this.observer = new MutationObserver(mutations => {
            let shouldProcess = false
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true
                    break
                }
            }
            if (shouldProcess) {
                processMutations()
            }
        })

        this.observer.observe(document.body, { childList: true, subtree: true })
    }

    stopIconObserver() {
        if (this.observer) {
            this.observer.disconnect()
            this.observer = null
        }
    }
}

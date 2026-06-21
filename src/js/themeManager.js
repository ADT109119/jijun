import { debounce } from './utils.js'

// 內建深色主題 ID（不可刪除、自動更新）
export const DARK_THEME_ID = 'com.walkingfish.theme.dark'

export class ThemeManager {
  constructor(dataService) {
    this.dataService = dataService
    this.activeTheme = null
    this.styleElement = null
    this.observer = null

    // Ensure style element exists
    this.styleElement = document.getElementById('dynamic-theme-styles')
    if (!this.styleElement) {
      this.styleElement = document.createElement('style')
      this.styleElement.id = 'dynamic-theme-styles'
      document.head.appendChild(this.styleElement)
    }
  }

  // 判斷是否為內建深色主題（不可刪除）
  isBuiltinTheme(themeId) {
    return themeId === DARK_THEME_ID
  }

  async init() {
    // 總是重新抓取 dark.json，確保內建深色主題保持最新版本
    try {
      const response = await fetch('themes/dark.json')
      if (response.ok) {
        const latestDark = await response.json()
        await this.dataService.installTheme(latestDark) // installTheme 有 upsert 語意
        console.log('Built-in Dark Mode theme updated.')
      }
    } catch (e) {
      console.warn('Failed to auto-update dark theme', e)
    }

    const setting = await this.dataService.getSetting('activeThemeId')
    const activeThemeId = setting ? setting.value : null

    if (activeThemeId) {
      const theme = await this.dataService.getTheme(activeThemeId)
      if (theme) {
        await this.applyTheme(theme)
      }
    }
  }

  // Utility to convert hex to RGB triplet (e.g., "#334A52" -> "51 74 82")
  hexToRgbTriplet(hex) {
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

  async applyTheme(theme) {
    this.activeTheme = theme

    // Apply CSS Variables
    let cssText = ':root {\n'
    if (theme && theme.colors) {
      for (const [key, value] of Object.entries(theme.colors)) {
        // key is like "wabi-bg", we want "--theme-bg"
        const cssVarName = key.replace(/^wabi-/, '')
        // Try converting hex to RGB triplet
        const rgbValue = this.hexToRgbTriplet(value)
        if (rgbValue) {
          cssText += `  --theme-${cssVarName}: ${rgbValue};\n`
        } else {
          // Fallback if not a hex code
          cssText += `  --theme-${cssVarName}: ${value};\n`
        }
      }
    }
    cssText += '}\n'
    this.styleElement.textContent = cssText

    // Save active theme ID
    await this.dataService.saveSetting({
      key: 'activeThemeId',
      value: theme ? theme.id : null,
    })

    // Apply Icon Replacements
    this.stopIconObserver()

    // Remove existing theme replacements
    this.clearReplacedIcons()

    if (theme && theme.icons && Object.keys(theme.icons).length > 0) {
      this.applyIconReplacements(theme.icons)
      this.startIconObserver(theme.icons)
    }
  }

  async clearTheme() {
    await this.applyTheme(null)
  }

  clearReplacedIcons() {
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

  applyIconReplacements(iconsConfig) {
    for (const [selector, replacementInfo] of Object.entries(iconsConfig)) {
      const elements = document.querySelectorAll(selector)
      elements.forEach(el => {
        if (
          el.nextElementSibling &&
          el.nextElementSibling.classList.contains('theme-icon-replacement')
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
          const template = document.createElement('template')
          template.innerHTML = replacementInfo.svg.trim()
          replacementNode = template.content.firstChild
          replacementNode.classList.add('theme-icon-replacement')
          if (replacementInfo.className) {
            replacementNode.setAttribute(
              'class',
              replacementNode.getAttribute('class') +
                ' ' +
                replacementInfo.className
            )
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

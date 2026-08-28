import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    ThemeManager,
    DARK_THEME_ID,
    THEME_MODES,
} from '../../src/js/themeManager.js'

// ── Helper: create a mock dataService ──────────────────────────────
function createMockDataService() {
    const store = {}
    const themeStore = {}
    return {
        getSetting: async key => store[key] || null,
        saveSetting: async ({ key, value }) => {
            store[key] = { key, value }
        },
        getTheme: async id => themeStore[id] || null,
        installTheme: async theme => {
            if (theme && theme.id) {
                themeStore[theme.id] = theme
            }
        },
        _store: store,
        _themeStore: themeStore,
    }
}

// ── hexToRgbTriplet (pure utility) ─────────────────────────────────
describe('hexToRgbTriplet', () => {
    let tm
    beforeEach(() => {
        const mockDS = createMockDataService()
        tm = new ThemeManager(mockDS)
    })

    it('full hex #334A52 → "51 74 82"', () => {
        expect(tm.hexToRgbTriplet('#334A52')).toBe('51 74 82')
    })

    it('shorthand hex #03F → "0 51 255"', () => {
        expect(tm.hexToRgbTriplet('#03F')).toBe('0 51 255')
    })

    it('shorthand hex without # 03F → "0 51 255"', () => {
        expect(tm.hexToRgbTriplet('03F')).toBe('0 51 255')
    })

    it('#FFFFFF → "255 255 255"', () => {
        expect(tm.hexToRgbTriplet('#FFFFFF')).toBe('255 255 255')
    })

    it('#000000 → "0 0 0"', () => {
        expect(tm.hexToRgbTriplet('#000000')).toBe('0 0 0')
    })

    it('invalid input returns null', () => {
        expect(tm.hexToRgbTriplet('not-a-color')).toBeNull()
        expect(tm.hexToRgbTriplet('#ZZZZZZ')).toBeNull()
        expect(tm.hexToRgbTriplet('')).toBeNull()
        expect(tm.hexToRgbTriplet(null)).toBeNull()
    })

    it('mixed case #AaBbCc → "170 187 204"', () => {
        expect(tm.hexToRgbTriplet('#AaBbCc')).toBe('170 187 204')
    })
})

// ── isBuiltinTheme ─────────────────────────────────────────────────
describe('isBuiltinTheme', () => {
    let tm
    beforeEach(() => {
        tm = new ThemeManager(createMockDataService())
    })

    it('returns true for DARK_THEME_ID', () => {
        expect(tm.isBuiltinTheme(DARK_THEME_ID)).toBe(true)
    })

    it('returns false for other theme ids', () => {
        expect(tm.isBuiltinTheme('custom-theme')).toBe(false)
        expect(tm.isBuiltinTheme('')).toBe(false)
    })
})

// ── Constants ──────────────────────────────────────────────────────
describe('Theme constants', () => {
    it('DARK_THEME_ID equals expected value', () => {
        expect(DARK_THEME_ID).toBe('com.walkingfish.theme.dark')
    })

    it('THEME_MODES contains system, light, dark, custom', () => {
        expect(THEME_MODES.SYSTEM).toBe('system')
        expect(THEME_MODES.LIGHT).toBe('light')
        expect(THEME_MODES.DARK).toBe('dark')
        expect(THEME_MODES.CUSTOM).toBe('custom')
    })
})

// ── setThemeMode & Appearance Modes ────────────────────────────────
describe('Theme Modes & System Appearance', () => {
    let mockDS, tm

    beforeEach(() => {
        mockDS = createMockDataService()
        vi.spyOn(mockDS, 'getSetting')
        vi.spyOn(mockDS, 'saveSetting')
        vi.spyOn(mockDS, 'getTheme')
        vi.spyOn(mockDS, 'installTheme')

        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''
        document.documentElement.className = ''

        tm = new ThemeManager(mockDS)
    })

    it('defaults to SYSTEM mode in constructor', () => {
        expect(tm.themeMode).toBe(THEME_MODES.SYSTEM)
    })

    it('setThemeMode(LIGHT) clears dark class and resets styles', async () => {
        document.documentElement.classList.add('dark')
        await tm.setThemeMode(THEME_MODES.LIGHT)

        expect(tm.themeMode).toBe(THEME_MODES.LIGHT)
        expect(document.documentElement.classList.contains('dark')).toBe(false)
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'themeMode', value: 'light' })
        )
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: null })
        )
    })

    it('setThemeMode(DARK) applies dark theme and sets dark class', async () => {
        const darkTheme = {
            id: DARK_THEME_ID,
            colors: {
                'wabi-bg': '#0f172a',
                'wabi-primary': '#f8fafc',
            },
        }
        await mockDS.installTheme(darkTheme)

        await tm.setThemeMode(THEME_MODES.DARK)

        expect(tm.themeMode).toBe(THEME_MODES.DARK)
        expect(document.documentElement.classList.contains('dark')).toBe(true)
        const css = document.getElementById('dynamic-theme-styles').textContent
        expect(css).toContain('--theme-bg: 15 23 42')
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'themeMode', value: 'dark' })
        )
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'activeThemeId',
                value: DARK_THEME_ID,
            })
        )
    })

    it('setThemeMode(SYSTEM) applies dark when system prefers dark', async () => {
        const darkTheme = {
            id: DARK_THEME_ID,
            colors: {
                'wabi-bg': '#0f172a',
            },
        }
        await mockDS.installTheme(darkTheme)

        // Mock system dark
        vi.spyOn(tm, 'isSystemDarkMode').mockReturnValue(true)

        await tm.setThemeMode(THEME_MODES.SYSTEM)

        expect(tm.themeMode).toBe(THEME_MODES.SYSTEM)
        expect(document.documentElement.classList.contains('dark')).toBe(true)
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'themeMode', value: 'system' })
        )
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: null })
        )
    })

    it('setThemeMode(SYSTEM) applies light when system prefers light', async () => {
        // Mock system light
        vi.spyOn(tm, 'isSystemDarkMode').mockReturnValue(false)

        await tm.setThemeMode(THEME_MODES.SYSTEM)

        expect(tm.themeMode).toBe(THEME_MODES.SYSTEM)
        expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('setThemeMode(CUSTOM) applies custom theme', async () => {
        const customTheme = {
            id: 'com.theme.sakura',
            name: 'Sakura',
            colors: {
                'wabi-bg': '#fff5f7',
                'wabi-primary': '#d946ef',
            },
        }
        await mockDS.installTheme(customTheme)

        await tm.setThemeMode(THEME_MODES.CUSTOM, 'com.theme.sakura')

        expect(tm.themeMode).toBe(THEME_MODES.CUSTOM)
        expect(tm.activeTheme).toEqual(customTheme)
        const css = document.getElementById('dynamic-theme-styles').textContent
        expect(css).toContain('--theme-bg: 255 245 247')
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'themeMode', value: 'custom' })
        )
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'activeThemeId',
                value: 'com.theme.sakura',
            })
        )
    })

    it('dispatches themechange event on mode change', async () => {
        const eventListener = vi.fn()
        window.addEventListener('themechange', eventListener)

        await tm.setThemeMode(THEME_MODES.LIGHT)

        expect(eventListener).toHaveBeenCalled()
        const event = eventListener.mock.calls[0][0]
        expect(event.detail.mode).toBe('light')

        window.removeEventListener('themechange', eventListener)
    })

    it('updates meta[name="theme-color"] correctly', async () => {
        const darkTheme = {
            id: DARK_THEME_ID,
            colors: {
                'wabi-bg': '#0f172a',
            },
        }
        await mockDS.installTheme(darkTheme)

        await tm.setThemeMode(THEME_MODES.DARK)
        let meta = document.querySelector('meta[name="theme-color"]')
        expect(meta).not.toBeNull()
        expect(meta.getAttribute('content')).toBe('#0f172a')

        await tm.setThemeMode(THEME_MODES.LIGHT)
        meta = document.querySelector('meta[name="theme-color"]')
        expect(meta.getAttribute('content')).toBe('#f5f5f3')
    })
})

// ── init migration and restoration ─────────────────────────────────
describe('ThemeManager init()', () => {
    let mockDS, tm

    beforeEach(() => {
        mockDS = createMockDataService()
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''
        document.documentElement.className = ''
        tm = new ThemeManager(mockDS)
    })

    it('migrates legacy activeThemeId=DARK_THEME_ID to DARK mode if themeMode not set', async () => {
        await mockDS.saveSetting({
            key: 'activeThemeId',
            value: DARK_THEME_ID,
        })
        const darkTheme = { id: DARK_THEME_ID, colors: { 'wabi-bg': '#0f172a' } }
        await mockDS.installTheme(darkTheme)

        // Mock fetch to avoid real network call
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => darkTheme,
        })

        await tm.init()
        expect(tm.themeMode).toBe(THEME_MODES.DARK)
        expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('migrates legacy custom activeThemeId to CUSTOM mode if themeMode not set', async () => {
        await mockDS.saveSetting({
            key: 'activeThemeId',
            value: 'com.theme.blue',
        })
        const customTheme = {
            id: 'com.theme.blue',
            colors: { 'wabi-bg': '#001122' },
        }
        await mockDS.installTheme(customTheme)

        global.fetch = vi.fn().mockResolvedValue({ ok: false })

        await tm.init()
        expect(tm.themeMode).toBe(THEME_MODES.CUSTOM)
        expect(tm.activeTheme).toEqual(customTheme)
    })

    it('defaults to SYSTEM mode when no settings exist', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false })
        vi.spyOn(tm, 'isSystemDarkMode').mockReturnValue(false)

        await tm.init()
        expect(tm.themeMode).toBe(THEME_MODES.SYSTEM)
        expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
})

// ── applyTheme & clearTheme (backward compatibility) ───────────────
describe('applyTheme', () => {
    let mockDS, tm

    beforeEach(() => {
        mockDS = createMockDataService()
        vi.spyOn(mockDS, 'getSetting')
        vi.spyOn(mockDS, 'saveSetting')
        vi.spyOn(mockDS, 'getTheme')
        vi.spyOn(mockDS, 'installTheme')

        // Remove old style element
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''

        tm = new ThemeManager(mockDS)
    })

    it('creates style element if missing', () => {
        const el = document.getElementById('dynamic-theme-styles')
        expect(el).not.toBeNull()
        expect(el.tagName).toBe('STYLE')
    })

    it('generates CSS variables from theme colors', async () => {
        const theme = {
            id: 'test-theme',
            colors: { 'wabi-bg': '#1a1a2e', 'wabi-fg': '#e0e0e0' },
        }
        await mockDS.installTheme(theme)
        await tm.applyTheme(theme)

        const css = document.getElementById('dynamic-theme-styles').textContent
        expect(css).toContain('--theme-bg: 26 26 46')
        expect(css).toContain('--theme-fg: 224 224 224')
    })

    it('sets activeTheme reference', async () => {
        const theme = { id: 'test-theme', colors: {} }
        await mockDS.installTheme(theme)
        await tm.applyTheme(theme)
        expect(tm.activeTheme).toEqual(theme)
    })

    it('saves activeThemeId setting', async () => {
        const theme = { id: 'my-theme', colors: {} }
        await mockDS.installTheme(theme)
        await tm.applyTheme(theme)
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: 'my-theme' })
        )
    })

    it('handles null theme (clear)', async () => {
        await tm.applyTheme(null)
        expect(tm.activeTheme).toBeNull()
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: null })
        )
    })

    it('passes non-hex values through unchanged', async () => {
        const theme = {
            id: 't',
            colors: { 'wabi-text-shadow': '2px 2px 4px rgba(0,0,0,0.5)' },
        }
        await mockDS.installTheme(theme)
        await tm.applyTheme(theme)
        const css = document.getElementById('dynamic-theme-styles').textContent
        expect(css).toContain(
            '--theme-text-shadow: 2px 2px 4px rgba(0,0,0,0.5)'
        )
    })
})

// ── clearTheme ─────────────────────────────────────────────────────
describe('clearTheme', () => {
    let mockDS, tm

    beforeEach(() => {
        mockDS = createMockDataService()
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''
        tm = new ThemeManager(mockDS)
    })

    it('clears active theme', async () => {
        await tm.applyTheme({ id: 'a', colors: {} })
        await tm.clearTheme()
        expect(tm.activeTheme).toBeNull()
    })
})

// ── applyIconReplacements ──────────────────────────────────────────
describe('applyIconReplacements', () => {
    let tm

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML =
            '<div><i class="fa fa-home" id="target"></i></div>'
        tm = new ThemeManager(createMockDataService())
    })

    it('replaces with fontawesome type', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        })
        const repl = document.querySelector('.theme-icon-replacement')
        expect(repl).not.toBeNull()
        expect(repl.className).toContain('fa-star')
        expect(repl.className).toContain('theme-icon-replacement')
    })

    it('replaces with image type', () => {
        tm.applyIconReplacements({
            '.fa-home': {
                type: 'image',
                src: '/img/cat.png',
                width: '24px',
                height: '24px',
            },
        })
        const repl = document.querySelector('.theme-icon-replacement')
        expect(repl.tagName.toLowerCase()).toBe('img')
        expect(repl.getAttribute('src')).toBe('/img/cat.png')
        expect(repl.style.width).toBe('24px')
    })

    it('replaces with svg type', () => {
        tm.applyIconReplacements({
            '.fa-home': {
                type: 'svg',
                svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>',
                className: 'custom-svg',
            },
        })
        const repl = document.querySelector('.theme-icon-replacement')
        expect(repl.tagName.toLowerCase()).toBe('svg')
        expect(repl.getAttribute('class')).toContain('custom-svg')
    })

    it('hides the original element', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        })
        const orig = document.getElementById('target')
        expect(orig.style.display).toBe('none')
        expect(orig.hasAttribute('data-original-display')).toBe(true)
    })

    it('does not double-replace already replaced elements', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        })
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        })
        expect(
            document.querySelectorAll('.theme-icon-replacement').length
        ).toBe(1)
    })
})

// ── sanitizeSVG & sanitizeSVGToString ─────────────────────────────
describe('sanitizeSVG & sanitizeSVGToString', () => {
    let tm
    beforeEach(() => {
        tm = new ThemeManager(createMockDataService())
    })

    it('sanitizes SVG without xmlns and adds default xmlns', () => {
        const svgStr = '<svg viewBox="0 0 24 24"><circle r="5"/></svg>'
        const el = tm.sanitizeSVG(svgStr)
        expect(el).not.toBeNull()
        expect(el.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')

        const str = tm.sanitizeSVGToString(svgStr)
        expect(str).toContain('xmlns="http://www.w3.org/2000/svg"')
        expect(str).toContain('<circle')
    })

    it('strips script, foreignObject, on* attributes, and javascript: links', () => {
        const malicious = `<svg viewBox="0 0 24 24" onload="alert('xss')">
            <script>alert('xss')</script>
            <foreignObject><div>xss</div></foreignObject>
            <a href="javascript:alert(1)"><circle r="5" onclick="alert(2)"/></a>
        </svg>`
        const el = tm.sanitizeSVG(malicious)
        expect(el.querySelector('script')).toBeNull()
        expect(el.querySelector('foreignObject')).toBeNull()
        expect(el.hasAttribute('onload')).toBe(false)

        const a = el.querySelector('a')
        expect(a.hasAttribute('href')).toBe(false)

        const circle = el.querySelector('circle')
        expect(circle.hasAttribute('onclick')).toBe(false)
    })

    it('returns null for non-svg input or invalid input', () => {
        expect(tm.sanitizeSVG('<div>not svg</div>')).toBeNull()
        expect(tm.sanitizeSVG('')).toBeNull()
        expect(tm.sanitizeSVG(null)).toBeNull()

        expect(tm.sanitizeSVGToString('<div>not svg</div>')).toBeNull()
        expect(tm.sanitizeSVGToString('')).toBeNull()
    })
})

// ── clearReplacedIcons ─────────────────────────────────────────────
describe('clearReplacedIcons', () => {
    let tm

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = `
            <div>
                <i class="fa fa-home" id="orig" style="display:none" data-original-display="inline"></i>
                <i class="fas fa-star theme-icon-replacement"></i>
            </div>`
        tm = new ThemeManager(createMockDataService())
    })

    it('removes replacement nodes', () => {
        tm.clearReplacedIcons()
        expect(
            document.querySelectorAll('.theme-icon-replacement').length
        ).toBe(0)
    })

    it('restores original element display', () => {
        tm.clearReplacedIcons()
        const orig = document.getElementById('orig')
        expect(orig.style.display).toBe('inline')
        expect(orig.hasAttribute('data-original-display')).toBe(false)
    })
})

// ── stopIconObserver ───────────────────────────────────────────────
describe('stopIconObserver', () => {
    let tm

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''
        tm = new ThemeManager(createMockDataService())
    })

    it('disconnects observer and nulls it', () => {
        tm.startIconObserver({})
        expect(tm.observer).not.toBeNull()
        tm.stopIconObserver()
        expect(tm.observer).toBeNull()
    })

    it('is safe to call when no observer', () => {
        tm.stopIconObserver()
        expect(tm.observer).toBeNull()
    })
})

// ── startIconObserver ──────────────────────────────────────────────
describe('startIconObserver', () => {
    let tm
    let originalMutationObserver

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles')
        if (old) old.remove()
        document.body.innerHTML = ''
        tm = new ThemeManager(createMockDataService())
        originalMutationObserver = globalThis.MutationObserver
    })

    afterEach(() => {
        globalThis.MutationObserver = originalMutationObserver
    })

    it('creates a MutationObserver on document.body', () => {
        const mockCallback = vi.fn()
        globalThis.MutationObserver = vi.fn(function () {
            this.observe = mockCallback
        })
        tm.startIconObserver({})
        expect(globalThis.MutationObserver).toHaveBeenCalled()
    })
})

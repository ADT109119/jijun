import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeManager, DARK_THEME_ID } from '../../src/js/themeManager.js';

// ── Helper: create a mock dataService ──────────────────────────────
function createMockDataService() {
    const store = {};
    return {
        getSetting: async (key) => store[key] || null,
        saveSetting: async ({ key, value }) => { store[key] = { key, value }; },
        getTheme: async () => null,
        installTheme: async () => {},
    };
}

// ── hexToRgbTriplet (pure utility) ─────────────────────────────────
describe('hexToRgbTriplet', () => {
    let tm;
    beforeEach(() => {
        const mockDS = createMockDataService();
        tm = new ThemeManager(mockDS);
    });

    it('full hex #334A52 → "51 74 82"', () => {
        expect(tm.hexToRgbTriplet('#334A52')).toBe('51 74 82');
    });

    it('shorthand hex #03F → "0 51 255"', () => {
        expect(tm.hexToRgbTriplet('#03F')).toBe('0 51 255');
    });

    it('shorthand hex without # 03F → "0 51 255"', () => {
        expect(tm.hexToRgbTriplet('03F')).toBe('0 51 255');
    });

    it('#FFFFFF → "255 255 255"', () => {
        expect(tm.hexToRgbTriplet('#FFFFFF')).toBe('255 255 255');
    });

    it('#000000 → "0 0 0"', () => {
        expect(tm.hexToRgbTriplet('#000000')).toBe('0 0 0');
    });

    it('invalid input returns null', () => {
        expect(tm.hexToRgbTriplet('not-a-color')).toBeNull();
        expect(tm.hexToRgbTriplet('#ZZZZZZ')).toBeNull();
        expect(tm.hexToRgbTriplet('')).toBeNull();
        expect(tm.hexToRgbTriplet(null)).toBeNull();
    });

    it('mixed case #AaBbCc → "170 187 204"', () => {
        expect(tm.hexToRgbTriplet('#AaBbCc')).toBe('170 187 204');
    });
});

// ── isBuiltinTheme ─────────────────────────────────────────────────
describe('isBuiltinTheme', () => {
    let tm;
    beforeEach(() => {
        tm = new ThemeManager(createMockDataService());
    });

    it('returns true for DARK_THEME_ID', () => {
        expect(tm.isBuiltinTheme(DARK_THEME_ID)).toBe(true);
    });

    it('returns false for other theme ids', () => {
        expect(tm.isBuiltinTheme('custom-theme')).toBe(false);
        expect(tm.isBuiltinTheme('')).toBe(false);
    });
});

// ── DARK_THEME_ID constant ─────────────────────────────────────────
describe('DARK_THEME_ID constant', () => {
    it('equals expected value', () => {
        expect(DARK_THEME_ID).toBe('com.walkingfish.theme.dark');
    });
});

// ── applyTheme ─────────────────────────────────────────────────────
describe('applyTheme', () => {
    let mockDS, tm;

    beforeEach(() => {
        mockDS = createMockDataService();
        vi.spyOn(mockDS, 'getSetting');
        vi.spyOn(mockDS, 'saveSetting');
        vi.spyOn(mockDS, 'getTheme');
        vi.spyOn(mockDS, 'installTheme');

        // Remove old style element
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = '';

        tm = new ThemeManager(mockDS);
    });

    it('creates style element if missing', () => {
        const el = document.getElementById('dynamic-theme-styles');
        expect(el).not.toBeNull();
        expect(el.tagName).toBe('STYLE');
    });

    it('generates CSS variables from theme colors', async () => {
        const theme = {
            id: 'test-theme',
            colors: { 'wabi-bg': '#1a1a2e', 'wabi-fg': '#e0e0e0' },
        };
        await tm.applyTheme(theme);

        const css = document.getElementById('dynamic-theme-styles').textContent;
        expect(css).toContain('--theme-bg: 26 26 46');
        expect(css).toContain('--theme-fg: 224 224 224');
    });

    it('sets activeTheme reference', async () => {
        const theme = { id: 'test-theme', colors: {} };
        await tm.applyTheme(theme);
        expect(tm.activeTheme).toBe(theme);
    });

    it('saves activeThemeId setting', async () => {
        const theme = { id: 'my-theme', colors: {} };
        await tm.applyTheme(theme);
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: 'my-theme' }),
        );
    });

    it('handles null theme (clear)', async () => {
        await tm.applyTheme(null);
        expect(tm.activeTheme).toBeNull();
        expect(mockDS.saveSetting).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'activeThemeId', value: null }),
        );
    });

    it('passes non-hex values through unchanged', async () => {
        const theme = {
            id: 't',
            colors: { 'wabi-text-shadow': '2px 2px 4px rgba(0,0,0,0.5)' },
        };
        await tm.applyTheme(theme);
        const css = document.getElementById('dynamic-theme-styles').textContent;
        expect(css).toContain('--theme-text-shadow: 2px 2px 4px rgba(0,0,0,0.5)');
    });
});

// ── clearTheme ─────────────────────────────────────────────────────
describe('clearTheme', () => {
    let mockDS, tm;

    beforeEach(() => {
        mockDS = createMockDataService();
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = '';
        tm = new ThemeManager(mockDS);
    });

    it('clears active theme', async () => {
        await tm.applyTheme({ id: 'a', colors: {} });
        await tm.clearTheme();
        expect(tm.activeTheme).toBeNull();
    });
});

// ── applyIconReplacements ──────────────────────────────────────────
describe('applyIconReplacements', () => {
    let tm;

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = '<div><i class="fa fa-home" id="target"></i></div>';
        tm = new ThemeManager(createMockDataService());
    });

    it('replaces with fontawesome type', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        });
        const repl = document.querySelector('.theme-icon-replacement');
        expect(repl).not.toBeNull();
        expect(repl.className).toContain('fa-star');
        expect(repl.className).toContain('theme-icon-replacement');
    });

    it('replaces with image type', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'image', src: '/img/cat.png', width: '24px', height: '24px' },
        });
        const repl = document.querySelector('.theme-icon-replacement');
        expect(repl.tagName.toLowerCase()).toBe('img');
        expect(repl.getAttribute('src')).toBe('/img/cat.png');
        expect(repl.style.width).toBe('24px');
    });

    it('replaces with svg type', () => {
        tm.applyIconReplacements({
            '.fa-home': {
                type: 'svg',
                svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>',
                className: 'custom-svg',
            },
        });
        const repl = document.querySelector('.theme-icon-replacement');
        expect(repl.tagName.toLowerCase()).toBe('svg');
        expect(repl.getAttribute('class')).toContain('custom-svg');
    });

    it('hides the original element', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        });
        const orig = document.getElementById('target');
        expect(orig.style.display).toBe('none');
        expect(orig.hasAttribute('data-original-display')).toBe(true);
    });

    it('does not double-replace already replaced elements', () => {
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        });
        tm.applyIconReplacements({
            '.fa-home': { type: 'fontawesome', className: 'fas fa-star' },
        });
        expect(document.querySelectorAll('.theme-icon-replacement').length).toBe(1);
    });
});

// ── clearReplacedIcons ─────────────────────────────────────────────
describe('clearReplacedIcons', () => {
    let tm;

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = `
            <div>
                <i class="fa fa-home" id="orig" style="display:none" data-original-display="inline"></i>
                <i class="fas fa-star theme-icon-replacement"></i>
            </div>`;
        tm = new ThemeManager(createMockDataService());
    });

    it('removes replacement nodes', () => {
        tm.clearReplacedIcons();
        expect(document.querySelectorAll('.theme-icon-replacement').length).toBe(0);
    });

    it('restores original element display', () => {
        tm.clearReplacedIcons();
        const orig = document.getElementById('orig');
        expect(orig.style.display).toBe('inline');
        expect(orig.hasAttribute('data-original-display')).toBe(false);
    });
});

// ── stopIconObserver ───────────────────────────────────────────────
describe('stopIconObserver', () => {
    let tm;

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = '';
        tm = new ThemeManager(createMockDataService());
    });

    it('disconnects observer and nulls it', () => {
        tm.startIconObserver({});
        expect(tm.observer).not.toBeNull();
        tm.stopIconObserver();
        expect(tm.observer).toBeNull();
    });

    it('is safe to call when no observer', () => {
        tm.stopIconObserver();
        expect(tm.observer).toBeNull();
    });
});

// ── startIconObserver ──────────────────────────────────────────────
describe('startIconObserver', () => {
    let tm;

    beforeEach(() => {
        const old = document.getElementById('dynamic-theme-styles');
        if (old) old.remove();
        document.body.innerHTML = '';
        tm = new ThemeManager(createMockDataService());
    });

    it('creates a MutationObserver on document.body', () => {
        const mockCallback = vi.fn();
        globalThis.MutationObserver = vi.fn(function () {
            this.observe = mockCallback;
        });
        tm.startIconObserver({});
        expect(globalThis.MutationObserver).toHaveBeenCalled();
    });
});

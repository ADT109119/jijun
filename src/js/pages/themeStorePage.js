import { showToast, getStoreUrl, escapeHTML } from '../utils.js'

// CSS 顏色值白名單（#hex / rgb / rgba / hsl / hsla / 標準色彩名）：
// 遠端商店的 theme 資料不可信任，直接嵌入 style="" 可被引號 breakout 注入 CSS 規則
const SAFE_COLOR_RE =
    /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%]+(?:\s*,\s*[\d.%]+){2,3}\s*\)|hsla?\(\s*[\d.%]+(?:\s*,\s*[\d.%]+){2,3}\s*\)|[a-zA-Z]+)$/
// FontAwesome class 白名單（圖示預覽僅允許 fa-* 令牌）
const SAFE_FA_ICON_RE = /^fa-[a-zA-Z0-9-/ ]+$/

/** 不可信任的顏色值 → 通過白名單回傳原值，否則回傳 fallback */
function safeColor(value, fallback) {
    return typeof value === 'string' && SAFE_COLOR_RE.test(value)
        ? value
        : fallback
}

/** 不可信任的 FA icon class → 通過白名單回傳原值，否則回傳 null（走色點 fallback） */
function safeIconPreview(value) {
    return typeof value === 'string' && SAFE_FA_ICON_RE.test(value)
        ? value
        : null
}

export class ThemeStorePage {
    constructor(app) {
        this.app = app
    }

    async render() {
        this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 h-full flex flex-col bg-wabi-bg max-w-3xl mx-auto">
                <header class="flex items-center gap-4 mb-4 shrink-0 bg-wabi-surface p-4 -m-4 mb-4 shadow-sm border-b border-wabi-border sticky top-0 z-10">
                    <a href="#themes" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-wabi-bg text-wabi-text-secondary transition-colors">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-text-primary flex-1">主題商店</h1>
                </header>

                <div id="theme-store-list" class="flex-1 overflow-y-auto space-y-4 pb-8">
                     <div class="text-center py-12 text-wabi-text-secondary animate-pulse">載入中...</div>
                </div>
            </div>
        `

        const installedThemes = await this.app.dataService.getInstalledThemes()

        try {
            const res = await fetch(getStoreUrl(`themes/index.json?t=${Date.now()}`))
            if (res.ok) {
                const storeThemes = await res.json()
                this.renderStoreList(storeThemes, installedThemes)
            } else {
                throw new Error('Store index not found')
            }
        } catch (e) {
            console.error(e)
            const container = document.getElementById('theme-store-list')
            if (container)
                container.innerHTML = `<div class="text-center py-12 text-red-500">無法載入商店資料</div>`
        }
    }

    renderStoreList(list, installedThemes) {
        const container = document.getElementById('theme-store-list')
        if (!container) return
        if (list.length === 0) {
            container.innerHTML = `<div class="text-center py-12 text-wabi-text-secondary">目前沒有可用的主題</div>`
            return
        }

        container.innerHTML = list
            .map(t => {
                const installed = installedThemes.find(i => i.id === t.id)
                let btnHtml

                if (installed) {
                    if (
                        this.app.pluginManager.compareVersions(
                            t.version,
                            installed.version
                        ) > 0
                    ) {
                        btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-yellow-500 text-wabi-surface hover:bg-yellow-600 shadow w-full mt-3" data-url="${escapeHTML(t.file)}">更新 (v${escapeHTML(t.version)})</button>`
                    } else {
                        btnHtml = `<button class="px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-green-100 text-green-700 cursor-default w-full mt-3" disabled>已安裝</button>`
                    }
                } else {
                    btnHtml = `<button class="store-install-btn px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap bg-wabi-primary text-wabi-surface hover:bg-opacity-90 shadow w-full mt-3" data-url="${escapeHTML(t.file)}">下載</button>`
                }

                // Color Preview Blocks
                let colorBlocks = ''
                if (
                    t.colorsPreview &&
                    Object.keys(t.colorsPreview).length > 0
                ) {
                    colorBlocks =
                        `<div class="flex gap-2 mt-3">` +
                        Object.values(t.colorsPreview)
                            .slice(0, 5)
                            .map(
                                c =>
                                    `<div class="size-6 rounded-md shadow-sm border border-black/10" style="background-color: ${safeColor(c, 'transparent')}"></div>`
                            )
                            .join('') +
                        `</div>`
                }

                // 縮圖：svgPreview 優先，其次 iconPreview FA icon，否則色點
                let thumbnailHtml
                const bgColor = safeColor(t.colorsPreview?.bg, '#fff')
                const primaryColor = safeColor(
                    t.colorsPreview?.primary,
                    '#334A52'
                )
                const sanitizedSvg = t.svgPreview
                    ? this.app.themeManager?.sanitizeSVGToString(t.svgPreview)
                    : null

                if (sanitizedSvg) {
                    thumbnailHtml = `<div class="size-14 rounded-xl flex items-center justify-center border border-wabi-border shadow-sm shrink-0 overflow-hidden" style="background-color:${primaryColor}"><div class="size-9 flex items-center justify-center text-white">${sanitizedSvg}</div></div>`
                } else if (safeIconPreview(t.iconPreview)) {
                    thumbnailHtml = `<div class="size-14 rounded-xl flex items-center justify-center border border-wabi-border shadow-sm shrink-0" style="background-color:${bgColor}"><i class="${safeIconPreview(t.iconPreview)} text-2xl" style="color:${primaryColor}"></i></div>`
                } else {
                    thumbnailHtml = `<div class="size-14 rounded-xl flex items-center justify-center border border-wabi-border shadow-sm shrink-0" style="background-color:${bgColor}"><div class="size-7 rounded-full shrink-0" style="background-color:${primaryColor}"></div></div>`
                }

                return `
                    <div class="bg-wabi-surface p-5 rounded-2xl border border-wabi-border shadow-sm flex flex-col hover:shadow-md transition-shadow">
                        <div class="flex items-start gap-4 mb-3">
                            ${thumbnailHtml}
                            <div class="min-w-0">
                                <h4 class="font-bold text-wabi-text-primary text-lg">${escapeHTML(t.name)}</h4>
                                <p class="text-xs text-wabi-text-secondary">v${escapeHTML(t.version)} • ${escapeHTML(t.author) || 'Unknown'}</p>
                                <p class="text-sm text-wabi-text-secondary mt-1">${escapeHTML(t.description) || ''}</p>
                            </div>
                        </div>
                        ${colorBlocks}
                        ${btnHtml}
                    </div>
             `
            })
            .join('')

        // Bind Store Page Buttons
        container.querySelectorAll('.store-install-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const originalText = btn.innerHTML
                btn.disabled = true
                btn.textContent = '下載中...'

                try {
                    const response = await fetch(getStoreUrl(btn.dataset.url))
                    if (!response.ok)
                        throw new Error('Failed to fetch theme JSON')
                    const themeData = await response.json()

                    await this.app.dataService.installTheme(themeData)
                    showToast('下載成功！可以到主題列表套用', 'success')

                    // Refresh
                    this.render()
                } catch (e) {
                    console.error(e)
                    showToast('下載失敗', 'error')
                    btn.disabled = false
                    btn.innerHTML = originalText
                }
            })
        })
    }
}

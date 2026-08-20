import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { createHash } from 'crypto'

// ==================== 版本號與廣告設定統一來源 ====================
// 皆從 package.json 讀取，build 時注入到 JS
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const APP_VERSION = pkg.version
const adConfig = pkg.adConfig || {}

/**
 * Vite 插件：build 完成後處理 public/serviceWorker.js（不經過 Vite 轉換）
 * 1. 注入 APP_VERSION（package.json 版本號）
 * 2. 注入 BUILD_HASH（index.html 內容 hash，作為快取命名與 precache 失效依據）
 * 3. 解析 build 後的 index.html，列出所有 /assets/* 本地資源，
 *    寫出 dist/precachemanifest.json 供 SW install 時預快取
 *    （斷網/離線存活不再依賴瀏覽器 HTTP cache TTL）
 */
function serviceWorkerVersionPlugin() {
    return {
        name: 'sw-version-inject',
        writeBundle(options) {
            const outDir = options.dir || 'dist'
            const swPath = resolve(outDir, 'serviceWorker.js')
            const indexPath = resolve(outDir, 'index.html')
            try {
                const indexHtml = readFileSync(indexPath, 'utf-8')

                // BUILD_HASH：index.html 內容的短 hash（build 變更即變）
                const buildHash =
                    createHash('sha256').update(indexHtml).digest('hex').slice(0, 8)

                // 解析 index.html 引用的本地首屏資源：
                // - /assets/*（js/css/legacy 鏈，build 產物）
                // 這些進 precache → 離線存活不依賴 HTTP cache
                const assetUrls = new Set()
                const refRe = /(?:src|href)="(\/[^"#][^"]*)"/g
                let m
                while ((m = refRe.exec(indexHtml)) !== null) {
                    const url = m[1]
                    if (url.startsWith('/assets/')) {
                        assetUrls.add(url)
                    }
                }

                // 本地字體 woff2（Font Awesome + @fontsource Inter/Noto Sans TC）：
                // 被 CSS url() 引用、不在 index.html 裡，需從 dist/assets/ 掃描補進
                // precache，讓「裝完 PWA 即可離線顯示正確字體」（woff 舊版備援不預載）。
                const assetsDir = resolve(outDir, 'assets')
                for (const f of readdirSync(assetsDir)) {
                    if (f.endsWith('.woff2')) assetUrls.add(`/assets/${f}`)
                }

                // 寫出 precache manifest（SW install 時 fetch 這個檔）
                writeFileSync(
                    resolve(outDir, 'precachemanifest.json'),
                    JSON.stringify({ version: APP_VERSION, buildHash, assets: [...assetUrls] }, null, 2),
                    'utf-8'
                )

                // 注入 SW 版本號 + build hash
                let content = readFileSync(swPath, 'utf-8')
                content = content.replace(
                    /const APP_VERSION = '.*?'/,
                    `const APP_VERSION = '${APP_VERSION}'`
                )
                content = content.replace(
                    /const BUILD_HASH = '.*?'/,
                    `const BUILD_HASH = '${buildHash}'`
                )
                writeFileSync(swPath, content, 'utf-8')
                console.log(
                    `✅ Service Worker 已注入 v${APP_VERSION} / build ${buildHash}（precache ${assetUrls.size} 個本機 assets）`
                )
            } catch (e) {
                // dev 模式下不會有 dist 產物，靜默忽略
            }
        },
    }
}

export default defineConfig({
    plugins: [
        legacy({
            targets: ['defaults', 'not IE 11'],
        }),
        serviceWorkerVersionPlugin(),
    ],
    define: {
        // 編譯時常數：所有 src/ 下的 JS 都可直接使用
        __APP_VERSION__: JSON.stringify(APP_VERSION),
        // 廣告設定 (來源：package.json → adConfig)
        __AD_IS_TESTING__: JSON.stringify(adConfig.isTesting ?? true),
        __AD_ADSENSE_CLIENT_ID__: JSON.stringify(
            adConfig.adsenseClientId ?? ''
        ),
        __AD_ADSENSE_AD_SLOT__: JSON.stringify(adConfig.adsenseAdSlot ?? ''),
        __AD_GPT_REWARDED_PATH__: JSON.stringify(
            adConfig.gptRewardedAdUnitPath ?? ''
        ),
        __AD_ADMOB_BANNER_ID__: JSON.stringify(adConfig.admobBannerId ?? ''),
        __AD_ADMOB_REWARDED_ID__: JSON.stringify(
            adConfig.admobRewardedId ?? ''
        ),
        __WEB_STORE_URL__: JSON.stringify(
            adConfig.webStoreUrl ?? 'https://jijun.the-walking-fish.com'
        ),
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        rollupOptions: {
            input: {
                main: 'index.html',
            },
        },
    },
    server: {
        port: 3000,
        open: true,
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/unit/setup.js'],
        include: ['tests/unit/**/*.test.js'],
        sequence: { concurrent: false }, // 避免平行執行導致 mock state 污染
    },
})

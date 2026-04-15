import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ==================== 版本號與廣告設定統一來源 ====================
// 皆從 package.json 讀取，build 時注入到 JS
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const APP_VERSION = pkg.version
const adConfig = pkg.adConfig || {}

/**
 * Vite 插件：在 build 完成後，將 Service Worker 中的版本號佔位符替換
 * Service Worker 位於 public/ 不經過 Vite 處理，需要額外處理
 */
function serviceWorkerVersionPlugin() {
  return {
    name: 'sw-version-inject',
    writeBundle(options) {
      const outDir = options.dir || 'dist'
      const swPath = resolve(outDir, 'serviceWorker.js')
      try {
        let content = readFileSync(swPath, 'utf-8')
        content = content.replace(
          /const APP_VERSION = '.*?'/,
          `const APP_VERSION = '${APP_VERSION}'`
        )
        writeFileSync(swPath, content, 'utf-8')
        console.log(`✅ Service Worker 版本已注入: ${APP_VERSION}`)
      } catch (e) {
        // dev 模式下不會有 dist/serviceWorker.js，靜默忽略
      }
    }
  }
}

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    }),
    serviceWorkerVersionPlugin()
  ],
  define: {
    // 編譯時常數：所有 src/ 下的 JS 都可直接使用
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // 廣告設定 (來源：package.json → adConfig)
    __AD_IS_TESTING__: JSON.stringify(adConfig.isTesting ?? true),
    __AD_ADSENSE_CLIENT_ID__: JSON.stringify(adConfig.adsenseClientId ?? ''),
    __AD_ADSENSE_AD_SLOT__: JSON.stringify(adConfig.adsenseAdSlot ?? ''),
    __AD_GPT_REWARDED_PATH__: JSON.stringify(adConfig.gptRewardedAdUnitPath ?? ''),
    __AD_ADMOB_BANNER_ID__: JSON.stringify(adConfig.admobBannerId ?? ''),
    __AD_ADMOB_REWARDED_ID__: JSON.stringify(adConfig.admobRewardedId ?? ''),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.cjs']
  }
})
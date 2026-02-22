import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ==================== 版本號統一來源 ====================
// 所有版本號皆從 package.json 讀取，build 時注入到 JS 和 Service Worker
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const APP_VERSION = pkg.version

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
    // 編譯時常數：所有 src/ 下的 JS 都可直接使用 __APP_VERSION__
    __APP_VERSION__: JSON.stringify(APP_VERSION)
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
  }
})
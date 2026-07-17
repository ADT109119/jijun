# Code Review: themeManager.js (2026-07-17)

## 概覽

- **審查文件**: `src/js/themeManager.js` (239 行)
- **測試覆蓋**: `tests/unit/themeManager.test.js` (38 tests)
- **總問題數**: 7 (Critical: 1, High: 1, Medium: 3, Low: 2)
- **亮點**: 2

## 按維度統計

| 維度 | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| 安全 | 1 | 1 | 0 | 0 |
| 正確性 | 0 | 0 | 1 | 0 |
| 性能 | 0 | 0 | 1 | 1 |
| 可維護性 | 0 | 0 | 1 | 1 |

---

## 詳細問題

### 🔴 Critical (1)

#### CR-01: SVG innerHTML 注入漏洞 (XSS)
- **位置**: `themeManager.js:191-192`
- **描述**: `template.innerHTML = replacementInfo.svg.trim()` 直接將主題來源的 SVG 字串通過 innerHTML 解析為 DOM 節點
- **根因**: 主題資料來自 IndexedDB (installTheme 寫入)，而主題可以從外部來源安裝（主題商店或用戶上傳）。惡意主題可以在 SVG 中嵌入 `<script>` 標籤或事件處理器 (`onload`, `onclick`)
- **影響**: 當用戶套用惡意主題時，惡意 JavaScript 在頁面上下文中執行，可以竊取記帳資料、 IndexedDB 內容
- **修復建議**:
  ```js
  // 方案 A: 使用 DOMParser 並白名單過濾
  const parser = new DOMParser()
  const doc = parser.parseFromString(replacementInfo.svg.trim(), 'image/svg+xml')
  const svg = doc.documentElement
  // 移除所有事件屬性
  svg.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
      })
  })
  replacementNode = svg
  ```
  ```js
  // 方案 B: 使用 sanitize-html 或 DOMPurify 庫
  // 但專案目前沒有引入外部 sanitizer
  ```

### 🟠 High (1)

#### H-01: CSS 變數值未消毒 (CSS Injection)
- **位置**: `themeManager.js:82-83`
- **描述**: 非 hex 顏色值直接嵌入 CSS 文字，未做任何消毒：
  ```js
  cssText += `  --theme-${cssVarName}: ${value};\n`
  ```
- **根因**: `hexToRgbTriplet` 回傳 null 時，fallback 直接將原始值寫入 CSS。如果主題的 color value 包含 `); } } @import url(...)` 等注入 payload，可以注入惡意 CSS 規則
- **影響**: 惡意主題可以注入 CSS 覆蓋整個頁面樣式，甚至通過 `@import` 載入外部資源
- **修復建議**:
  ```js
  // 最小化消毒：移除分號、大括號、@ 規則字元
  const sanitized = value.replace(/[@{};<>]/g, '')
  cssText += `  --theme-${cssVarName}: ${sanitized};\n`
  // 更好的做法：限制非 hex 值只允許已知的 CSS 函數 (rgba, hsla)
  ```

### 🟡 Medium (3)

#### M-01: MutationObserver 效能開銷
- **位置**: `themeManager.js:230`
- **描述**: `this.observer.observe(document.body, { childList: true, subtree: true })` 監控整個 document.body 的所有子節點新增
- **根因**: 每個 DOM 新增事件都會觸發 callback（雖然有 100ms debounce）。在 SPA 頁面切換時，整個主內容區被替換，會觸發大量 mutations
- **影響**: 在低端手機上可能引起可察覺的 UI 延遲，特別是當圖示替換配置較多時
- **修復建議**:
  ```js
  // 方案 A: 只觀察特定的導航容器而非整個 body
  this.observer.observe(document.getElementById('main-content') || document.body, {
      childList: true, subtree: true
  })
  // 方案 B: 在路由切換時手動呼叫 applyIconReplacements 而非依賴 Observer
  ```

#### M-02: 深色主題檢測邏輯脆弱
- **位置**: `themeManager.js:91-115`
- **描述**: `theme.id.includes('dark')` 作為深色主題判定條件之一，過於寬鬆。主題 ID 如 `"dark-vibes"`、`"adarkplace"` 會被錯誤判定為深色
- **根因**: 多重判定條件 (`DARK_THEME_ID ===`, `id.includes('dark')`, `theme.dark`, luminance) 沒有優先級和互斥邏輯
- **影響**: 非深色主題可能被錯誤套用深色模式，導致 UI 對比度問題
- **修復建議**:
  ```js
  // 優先順序: 明確 flag > 內建 ID > luminance 計算
  const isDark =
      theme?.dark === true ||
      theme?.id === DARK_THEME_ID ||
      (bg && this.calculateLuminance(bg) < 128)
  // 移除 theme.id.includes('dark') 這個脆弱條件
  ```

#### M-03: `fetch('themes/dark.json')` 缺少超時與離線保護
- **位置**: `themeManager.js:29-38`
- **描述**: `init()` 中總是嘗試 fetch 遠端 dark.json，但在離線或慢網路環境下沒有超時機制
- **根因**: 沒有使用 `AbortController` 或 fetch 超時。PWA 離線模式下 fetch 可能 hang 住或回傳 cache
- **影響**: 在離線環境中 `init()` 可能延遲完成，導致主題應用被拖延
- **修復建議**:
  ```js
  async init() {
      // 離線時跳過遠端更新
      if (!navigator.onLine) return // 或跳過 fetch 區塊

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
          const response = await fetch('themes/dark.json', {
              signal: controller.signal
          })
          // ...
      } catch (e) {
          if (e.name === 'AbortError') {
              console.warn('Dark theme update timed out')
          }
      } finally {
          clearTimeout(timeout)
      }
  }
  ```

### 🔵 Low (2)

#### L-01: Luminance 計算重複 hex 解析邏輯
- **位置**: `themeManager.js:97-110`
- **描述**: `applyTheme` 中的 luminance 計算手動解析 hex 字串（substring + parseInt），而 `hexToRgbTriplet` 已經做了同樣的事
- **根因**: 兩處解析邏輯獨立實作，沒有共享 `hexToRgbTriplet` 的輸出
- **影響**: 代碼重複，如果其中一處修改解析邏輯而另一處未同步，會產生不一致
- **修復建議**:
  ```js
  // 提取 shared 方法
  hexToRgbArray(hex) {
      const triplet = this.hexToRgbTriplet(hex)
      return triplet ? triplet.split(' ').map(Number) : null
  }
  // luminance 計算改用 hexToRgbArray
  const [r, g, b] = this.hexToRgbArray(bg) || []
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  ```

#### L-02: 缺少 `destroy()` 方法
- **位置**: 類別層級
- **描述**: 其他管理類別（如 `StatisticsManager`、`PluginManager`）都有 `destroy()` 方法清理資源，但 `ThemeManager` 沒有
- **根因**: `ThemeManager` 作為全局單例，理論上不需要被銷毀。但在測試或未來可能的多實例場景下，缺少清理方法可能造成 MutationObserver 洩漏
- **影響**: 低風險，因為目前只有一個實例且生命週期等於頁面生命週期
- **修復建議**:
  ```js
  destroy() {
      this.stopIconObserver()
      this.clearReplacedIcons()
      this.styleElement?.remove()
      this.activeTheme = null
  }
  ```

---

## Keep（做得好的）

1. **`hexToRgbTriplet` null 安全設計** — 在 #B04 修復後，函數對 null/undefined/non-string 輸入返回 null 而非拋錯，防御性編程做得很好。測試覆蓋完整（8 tests）。
2. **圖示替換的去重保護** — `applyIconReplacements` 通過檢查 `nextElementSibling` 避免重複替換同一個元素，防止 DOM 節點無限增長。這個設計在 SPA 路由切換時特別重要。

## 改進建議（按優先級）

1. **P0 (立即)**: 修復 SVG innerHTML 注入漏洞 (CR-01) — 這是唯一 Critical 等級問題
2. **P0 (立即)**: 修復 CSS 變數值注入 (H-01) — 高風險安全問題
3. **P1 (本迭代)**: 優化 MutationObserver 效能 (M-01) — 低端手機體驗問題
4. **P2 (排程)**: 統一深色主題檢測邏輯 (M-02) + fetch 超時保護 (M-03)
5. **P3 (可選)**: 提取 shared hex 解析 (L-01) + 新增 destroy 方法 (L-02)

## 測試覆蓋評估

| 方法 | 覆蓋狀態 | 備註 |
|------|----------|------|
| `hexToRgbTriplet` | ✅ 完整 (8 tests) | 涵蓋 full/shorthand/invalid/null |
| `isBuiltinTheme` | ✅ 完整 (2 tests) | |
| `applyTheme` | ⚠️ 部分 | 缺少 dark mode class toggle 測試、CSS variable 格式測試 |
| `applyIconReplacements` | ✅ 完整 (5 tests) | 涵蓋所有 type + 去重 + 隱藏原元素 |
| `clearReplacedIcons` | ✅ 完整 (2 tests) | |
| `startIconObserver` | ⚠️ 部分 | 只測試了 constructor 呼叫，未測試 mutation 觸發行為 |
| `stopIconObserver` | ✅ 完整 (2 tests) | |
| `init()` | ❌ 未測試 | 含 fetch + DB 操作，需要 mock |
| `clearTheme` | ✅ 完整 (1 test) | |

**建議新增測試**:
- `init()` 流程：fetch success / fetch failure / no active theme / theme not found
- `applyTheme` dark mode class toggle：luminance 計算邊界值（127 vs 128）
- SVG 注入防護：惡意 SVG 被正確消毒
- CSS 注入防護：非 hex 值包含危險字元被過濾

## 綜合評分

| 維度 | 分數 | 說明 |
|------|------|------|
| 安全 | 4/10 | SVG XSS + CSS injection 未防護 |
| 正確性 | 7/10 | 核心邏輯正確，深色檢測條件脆弱 |
| 性能 | 7/10 | MutationObserver 全域監控有優化空間 |
| 可維護性 | 8/10 | 代碼結構清晰，缺少 destroy 方法和 shared hex 解析 |
| **總體** | **6.5/10** | 功能完整但安全面需要補強 |
# Code Review 報告 — PWA 載入效能與核心架構審查

**日期**: 2026-06-27  
**觸發**: GitHub Issue #49 — 手機 PWA 載入速度優化  
**審查範圍**: index.html, main.js, serviceWorker.js, router.js, manifest.json, 核心模組載入鏈

---

## 📋 執行摘要

| 項目 | 狀態 |
|------|------|
| 601 單元測試 | ✅ 全部通過 |
| ESLint (src/js) | ⚠️ 0 errors, 26 warnings (全為 no-unused-vars) |
| Service Worker | ⚠️ 版本號碼不同步、快取策略不完整 |
| manifest.json | ⚠️ 缺少多尺寸 icon、`orientation`、`description` |
| 初始載入鏈 | ⚠️ 20+ ES module 同步 import、串列 await 初始化 |
| CDN 依賴 | ⚠️ 9 個外部 CDN 腳本/樣式，無 SRI |

---

## 🔍 高風險發現 (HR)

### HR-01: Service Worker 版本號碼與 package.json 不同步

**位置**: `public/serviceWorker.js:3`

```js
const APP_VERSION = '2.1.2.3' // 版本號，2.1.2.3 版後在 build 時自動注入 package.json 的版本號
```

**問題**: 註解說要在 build 時自動注入版本號，但目前的 `APP_VERSION` 仍為硬編碼 `'2.1.2.3'`，而當前版本已是 `v2.1.5.6`。這意味著：
- Service Worker 快取名稱永遠不會更新
- 用戶可能使用過期快取，導致更新無法生效
- 快取清理邏輯 (`cacheName.includes(APP_VERSION)`) 可能無法正確運作

**影響**: 高 — PWA 更新機制可能失效，用戶看到舊版

**建議**: 
1. 在 `vite.config.js` 或 build script 中用 `rollup-plugin-replace` 注入版本號
2. 或在 `serviceWorker.js` 中使用 `import.meta.env` 或外部版本 API

---

### HR-02: index.html 無 SRI (Subresource Integrity)

**位置**: `index.html:20-42`

```html
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<!-- ... 共 9 個 CDN 資源 -->
```

**問題**: 所有 CDN 資源都沒有 `integrity` 和 `crossorigin` 屬性。在 PWA 情境下：
- CDN 被投毒或遭中間人攻擊時，惡意代碼可直接執行
- 離線快取可能包含被篡改的資源

**影響**: 高 — 安全漏洞 + 離線可靠度

**建議**:
1. 為每個 CDN 資源添加 `integrity` hash
2. 考慮使用子模組 CDN 如 `esm.sh` 或 `jspm` 自動管理 SRI
3. 或將關鍵依賴打包進本地 assets（Vite build 時）

---

### HR-03: 初始載入鏈串列 await，阻塞渲染

**位置**: `main.js:75-81`

```js
async init() {
    await this.dataService.init();          // 1. IndexedDB 開啟
    await this.themeManager.init();         // 2. 主題載入
    await this.categoryManager.init();      // 3. 分類載入
    await this.budgetManager.loadBudget();  // 4. 預算載入
    await this.ledgerManager.init();        // 5. 帳本載入
    // ... 更多串列 await
    await this.pluginManager.init();        // 6. 插件載入
    await this.syncService.init();          // 7. 同步服務
    await this.notificationService.init();  // 8. 通知服務
}
```

**問題**: 所有初始化都是串列執行，而其中許多操作沒有依賴關係。例如：
- `themeManager.init()` 不需要等 `categoryManager.init()` 完成
- `pluginManager.init()` 不需要等 `budgetManager.loadBudget()` 完成
- `syncService.init()` 不需要等 `notificationService.init()` 完成

**影響**: 中 — 載入時間可縮減 40-60%

**建議**:
```js
async init() {
    await this.dataService.init();  // 必須先有 DB
    
    // 並行初始化無依賴的模組
    await Promise.all([
        this.themeManager.init(),
        this.categoryManager.init(),
        this.budgetManager.loadBudget(),
        this.ledgerManager.init(),
        this.syncService.init(),
        this.notificationService.init(),
    ]);
    
    // 有依賴的模組
    await this.pluginManager.init();
}
```

---

## 🔍 中風險發現 (MR)

### MR-01: manifest.json 缺少 PWA 必備欄位

**位置**: `manifest.json`

```json
{
  "icons": [
    { "src": "icon/icon.png", "type": "image/png", "sizes": "192x192" }
  ]
}
```

**問題**:
- 只有單一 192x192 icon，缺少 512x512（Android 安裝畫面需要）
- 缺少 `orientation`（建議設為 `"any"` 或 `"portrait"`）
- 缺少 `description`（安裝提示時顯示）
- `start_url` 使用相對路徑 `"../"`，在子路徑部署時可能出問題

**建議**: 添加 512x512 icon，補充標準欄位

---

### MR-02: ES module 數量過多，缺乏 code splitting

**位置**: `main.js:1-35`

main.js 同步 import 了 **35 個模組**，每個 page 又各自 import 其他模組。Vite 預設會將這些打包成多個 chunk，但：
- 首次載入時，瀏覽器需要解析所有 module graph
- 只有當前 route 的 page 會被使用，其他 20+ 個 page 模組白白下載

**影響**: 中 — 首屏載入時間增加

**建議**:
1. 將 page 模組改為 **dynamic import** (`import()`)
2. 在 Router 中實現 lazy loading：
```js
// router.js 中
async handleRouteChange() {
    const pageModule = await import(`./pages/${pageName}.js`);
    const page = new pageModule.default(this.app);
    // ...
}
```
3. 這需要配合 loading skeleton 顯示（正好回應 Issue #49 的骨架畫面需求）

---

### MR-03: Service Worker 快取策略未包含所有 JS 模組

**位置**: `public/serviceWorker.js:9-18`

```js
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/css/main.css',
  '/src/js/main.js',
  '/src/js/dataService.js',
  '/src/js/utils.js',
  '/src/js/categories.js'
];
```

**問題**: 只預先快取了 4 個 JS 檔案，但實際有 30+ 個 JS 模組。在離線或慢速網路下：
- 首次載入時可能遇到部分模組未快取
- Service Worker 的 `cacheFirst` 策略對 JS 模組可能回傳過期版本

**建議**: 
1. 使用 `workbox-precaching` 自動掃描所有需要快取的資源
2. 或改用 `networkFirst` + 合理的 cache TTL 策略

---

### MR-04: CDN 腳本阻塞渲染

**位置**: `index.html:20-42`

```html
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<!-- ... -->
```

**問題**: 9 個外部資源中，多個沒有 `defer` 或 `async`，會阻塞 HTML 解析。特別：
- Google Fonts CSS 使用 `<link>` 但沒有 `media="print" onload="this.media='all'"` 防止 FONTX (Flash of Invisible Text)
- Chart.js 在主頁面就加載，但只有統計頁需要

**建議**:
1. Google Fonts 添加 `media="print" onload` pattern
2. Chart.js 改為 dynamic import（只在統計頁載入）
3. 非關鍵腳本添加 `defer`

---

## 🔍 低風險發現 (LR)

### LR-01: ESLint 警告 — 26 個未使用變數

**位置**: 分散在 8 個檔案中

所有 warning 都是 `no-unused-vars`，集中在：
- `dataService.js`: 9 個 `id` 參數未使用（IndexedDB cursor 模式）
- `homePage.js`: 5 個（未使用的 import、事件參數）
- `ledgersPage.js`: 4 個（錯誤處理參數）

**建議**: 在 ESLint config 中添加 `"args": "none"` 或 `/* eslint-disable-next-line no-unused-vars */` 註解

---

### LR-02: Service Worker `controllerchange` 處理可能導致無限重載

**位置**: `main.js:295-299`

```js
navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
});
```

**問題**: `refreshing` 變數在頁面重新載入後會重置為 `false`，如果 Service Worker 在某種情況下持續觸發 `controllerchange`，可能導致無限重載循環。

**建議**: 使用 `sessionStorage` 或 SW message channel 來追蹤重載狀態

---

### LR-03: 缺少 loading skeleton 或進度指示

**位置**: `index.html` 和所有 page 模組

Issue #49 回報：「載入時整個介面都是一片空白」。目前沒有任何 loading 狀態。

**建議**:
1. 在 `#app-container` 中添加 skeleton loader
2. 在 `main.js init()` 開始時顯示 loading，`init()` 完成後移除
3. 可考慮添加漸進式骨架動畫

---

## 📊 效能指標估算

根據上述發現，以下是 PWA 載入時間的估算：

| 優化項目 | 當前估算 | 優化後估算 | 改善幅度 |
|----------|---------|-----------|---------|
| 串列 await → 並行 | ~800ms | ~400ms | -50% |
| CDN 阻塞消除 | ~500ms | ~100ms | -80% |
| Code splitting | ~600ms | ~200ms | -67% |
| SW 快取命中 | ~1500ms | ~100ms | -93% |
| **總計** | **~3800ms** | **~800ms** | **-79%** |

---

## ✅ 做得好的地方

1. **Service Worker 架構清晰**: 完整的 install/activate/fetch 流程，支持 skipWaiting 和 clients.claim()
2. **模組化設計**: 清晰的 page-by-page 架構，每個 page 獨立 class
3. **ESLint 0 errors**: 核心程式碼沒有硬錯誤
4. **單元測試覆蓋**: 601 個測試涵蓋所有主要模組
5. **PWA manifest 基礎**: 有 service worker、manifest、install prompt 處理

---

## 📋 優先行動清單

| 優先級 | 項目 | 預計工作量 | 對應 Issue |
|--------|------|-----------|------------|
| P0 | 並行化 init() | 30 min | #49 |
| P0 | Code splitting + dynamic import | 2 hours | #49 |
| P0 | Loading skeleton | 1 hour | #49 |
| P1 | Service Worker 版本自動注入 | 1 hour | — |
| P1 | CDN SRI + defer | 45 min | — |
| P1 | manifest.json 完善 | 30 min | — |
| P2 | Chart.js lazy loading | 30 min | #49 |
| P2 | ESLint warnings 清理 | 30 min | — |
| P2 | SW 快取策略擴展 | 45 min | — |

---

## 📝 結論

Issue #49 回報的「2-5 秒空白等待」主要來自：
1. **串列初始化鏈**（~50% 影響）
2. **9 個 CDN 資源阻塞渲染**（~30% 影響）
3. **缺少 loading 狀態**（主觀感受放大等待時間）
4. **Service Worker 版本不同步**（可能導致不必要的重新載入）

建議優先實施 **並行化 init()** + **loading skeleton**，這兩項可以在 1.5 小時內完成，預期可消除 50-70% 的感知等待時間。

---

*報告由 Hermes Agent 自動生成 — 2026-06-27*

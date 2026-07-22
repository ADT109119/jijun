# jijun 完整 Code Review (2026-07-22)

## 執行環境
- **ESLint**: 0 errors, 25 warnings
- **Vitest**: 826 tests passed (24 test files)
- **Antigravity CLI (agy)**: 嘗試執行但遭到安全政策限制，無法進行漏洞掃描

## 🔴 HIGH 問題

### H01: `syncService.js` — Authorization 標頭字串拼接 XSS 風險
- **檔案**: `src/js/syncService.js:366`
- **問題**: `Authorization: *** ${this.accessToken}` — 使用模板字串拼接，若 access token 包含惡意字元可能導致標頭注入
- **建議**: 使用 `Authorization: \`Bearer ${this.accessToken}\`` 明確格式

### H02: `pluginManager.js` — 沙盒 Proxy 繞過風險
- **檔案**: `src/js/pluginManager.js:263`
- **問題**: `const window = new Proxy(_realGlobal, _windowProxyHandler)` — Proxy handler 中的 `Reflect.get` 在非函數屬性時直接回傳原始值，未封鎖 `localStorage` 等全域存取的潛在繞過
- **建議**: 強化 Proxy handler，明確封鎖所有已知危險屬性

### H03: `main.js` — Capacitor Deep Link 無驗證
- **檔案**: `src/js/main.js:263-274`
- **問題**: `handleDeepLink(launchUrlObj.url)` 直接處理來自外部的 URL，未驗證 URL 格式或來源
- **建議**: 驗證 deep link URL 格式，只接受可信的 hash 路由

### H04: `rewardService.js` — GPT 廣告事件監聽器清理不完整
- **檔案**: `src/js/rewardService.js:471-475`
- **問題**: `_addGptListener` 將監聆器推入 `_listeners` 陣列，但 `_cleanupRewardedSlot` 僅清理 slot，未移除所有 GPT 事件監聽器
- **建議**: 在 `_cleanupRewardedSlot` 中一併移除所有 `_listeners` 中的 GPT 監聽器

### H05: `dataService.js` — Schema v14 升級未處理 `credit_statements` store
- **檔案**: `src/js/dataService.js:12`
- **問題**: `dbVersion = 14` 但 AGENTS.md 提到 `credit_statements` store，需確認 schema 升級是否完整處理所有 stores
- **建議**: 確認所有 object stores 都有正確的 `ledgerId` index

## 🟡 MEDIUM 問題

### M01: `main.js` — 重複的 `isNative` 檢查
- **檔案**: `src/js/main.js:47` 和 `src/js/main.js:236`
- **問題**: `isNative` 變數在 constructor 和 init 中重複計算
- **建議**: 將 `isNative` 提取為類別屬性或工具函數

### M02: `budgetManager.js` — `renderBudgetWidget` 使用同步 `.then()` 而非 async/await
- **檔件**: `src/js/budgetManager.js:277`
- **問題**: 混用 Promise `.then()` 和 async/await，降低可讀性
- **建議**: 改為 `async renderBudgetWidget()`

### M03: `quickSelectManager.js` — `console.log` 除錯訊息未移除
- **檔案**: `src/js/quickSelectManager.js:93-98, 104, 115, 120-122`
- **問題**: `deleteRecord` 方法中有多個 `console.log` 除錯訊息
- **建議**: 移除或改為條件性除錯

### M04: `ledgerManager.js` — `shareLedger` 方法過長 (200+ 行)
- **檔案**: `src/js/ledgerManager.js:194-323`
- **問題**: 單一方法包含建立檔案、授權、匯出資料、寫入雲端等多個職責
- **建議**: 拆分為 `createSharedFile`, `grantPermission`, `exportInitialData`, `writeToCloud` 等子方法

### M05: `dataService.js` — `getStatistics` 方法複雜度過高
- **檔案**: `src/js/dataService.js` (未完整顯示，但根據 changelog 提及)
- **問題**: 統計查詢可能包含 N+1 查詢問題，已在 changelog 中提及修復但需驗證
- **建議**: 確認是否所有統計查詢都使用批次獲取 + Map 對照

### M06: `syncService.js` — `ensureSharingPermission` 使用動態 import
- **檔案**: `src/js/syncService.js:454`
- **問題**: `const confirm = await import('./utils.js').then(m => m.customConfirm)` — 每次呼叫都動態 import
- **建議**: 改為頂層 import

### M07: `amortizationModal.js` — `innerHTML` 使用 `escapeHTML` 但部分值未轉義
- **檔案**: `src/js/amortizationModal.js:265, 270, 274`
- **問題**: `perPeriodDisplay.textContent` 和 `totalWithInterestDisplay.innerHTML` 中使用 `fmt()` 格式化後的值，部分包含 HTML 標記未轉義
- **建議**: 確保所有動態插入的 HTML 都經過 `escapeHTML`

### M08: `pluginManager.js` — `_getSandboxWrapper` 生成的沙盒程式碼可讀性差
- **檔案**: `src/js/pluginManager.js:182-268`
- **問題**: 沙盒包裝器使用模板字串生成大量 JavaScript 程式碼，難以維護和測試
- **建議**: 考慮使用 Function 構造器或獨立的沙盒模組

### M09: `budgetManager.js` — 魔法數字
- **檔案**: `src/js/budgetManager.js:280-285`
- **問題**: `waterLevel` 計算中使用魔法數字 `-15`, `105`
- **建議**: 提取為命名常數

### M10: `dataService.js` — `needsDebtRepair` 方法
- **檔案**: `src/js/dataService.js` (未完整顯示)
- **問題**: changelog 提及此方法在啟動時執行，可能導致啟動效能下降
- **建議**: 僅在 DB 版本升級時執行

## 🟢 LOW 問題

### L01: ESLint 警告 (25 個)
- **檔案**: 多個檔案
- **問題**: `no-unused-vars` 警告
- **清單**:
  - `dataService.js:2749` — `_rid` 未使用
  - `dataService.js:3854` — `ledgerId` 未使用
  - `debtManager.js:917` — `e` 未使用
  - `notificationService.js:1` — `DataService` 未使用
  - `pages/accountsPage.js:338` — `defaultCreditIcon` 未使用
  - `pages/homePage.js:4,5,424,471,485` — 多個未使用變數
  - `pages/ledgersPage.js:690,851,855,867` — 多個未使用變數
  - `pages/syncSettingsPage.js:264` — `i` 未使用

### L02: `widgetHelper.js` — 硬編碼字串
- **檔案**: `src/js/widgetHelper.js:77`
- **問題**: `localStorage.getItem('invoice_carrier_code')` — 硬編碼 localStorage key
- **建議**: 提取為常數

### L03: `categories.js` — 註解中的 Issue 參考
- **檔案**: `src/js/categories.js:90`
- **問題**: `// Note: 此分類不計入統計（Issue #46 — 特別設計，非 bug）` — 註解引用外部 issue
- **建議**: 移動到更適當的文檔位置

### L04: `rewardService.js` — 硬編碼廣告設定
- **檔案**: `src/js/rewardService.js:11-22`
- **問題**: `__AD_ADSENSE_CLIENT_ID__` 等全域變數未型別檢查
- **建議**: 加入預設值或型別驗證

### L05: `virtualKeyboardDetector.js` — 選擇器字串重複
- **檔案**: `src/js/virtualKeyboardDetector.js:108-109, 125-126`
- **問題**: 相同的 CSS 選擇器字串重複出現
- **建議**: 提取為常數

### L06: `ledgerManager.js` — 顏色選項硬編碼
- **檔案**: `src/js/ledgerManager.js:7-20`
- **問題**: `LEDGER_COLORS` 和 `LEDGER_ICONS` 硬編碼在程式碼中
- **建議**: 移動到配置文件或 constants 檔案

### L07: `comparisonReport.js` — `indexOf` 在迴圈中使用
- **檔案**: `src/js/comparisonReport.js:122, 126`
- **問題**: `periods.indexOf(prefix)` 在迴圈中使用，O(n) 查找
- **建議**: 使用 Map 預先建立 period → index 對照

### L08: `themeManager.js` — `hexToRgbTriplet` 方法未處理 4位十六進位顏色
- **檔案**: `src/js/themeManager.js:52-66`
- **問題**: 正則表達式不支援 `#RGBA` 格式
- **建議**: 擴展正則支援 4/8 位格式

### L09: `budgetManager.js` — `showBudgetModal` 方法過長
- **檔案**: `src/js/budgetManager.js:368-500+`
- **問題**: 單一方法超過 100 行，包含 DOM 操作、事件綁定、渲染邏輯
- **建議**: 拆分為 `renderExcludeCategoriesList`, `bindBudgetEvents` 等

### L10: `pluginManager.js` — `loadPlugin` 方法錯誤處理不完整
- **檔案**: `src/js/pluginManager.js:270-308`
- **問題**: `URL.revokeObjectURL(url)` 在 try/catch 外，若 import 失敗可能導致記憶體洩漏
- **建議**: 將 `URL.revokeObjectURL` 放入 finally 區塊

## ✅ 亮點

### S01: 安全性防護
- `escapeHTML` 函數在 `utils.js` 中實作完整，應用於多處動態 HTML 插入
- `themeManager.js` 中的 `sanitizeSVG` 方法完整消毒 SVG 內容，移除 script、foreignObject、on* 事件屬性、javascript: 連結
- `pluginManager.js` 沙盒機制封鎖 localStorage、sessionStorage、indexedDB、Function、eval、importScripts、網路存取
- CSS 變數名稱與數值經過消毒防止 CSS 注入

### S02: 效能優化
- `changelog.js` v2.1.6.4 中提到的攤提處理效能優化：預先載入全部紀錄並依 amortizationId 分組，移除 N+1 查詢
- 統計查詢優化：逐筆債務查詢改為單次批次取得後以 Map 對照
- 預算分類列表採增量渲染保留 SortableJS 拖曳狀態
- Service Worker 快取穩定度優化

### S03: 架構設計
- 模組化架構：main.js 重構為 Router + Page 類別，各頁面邏輯抽離至獨立類別
- 多帳本架構 (Schema v11)：完整的 ledgerId 隔離與 UUID 跨裝置關聯
- 插件權限系統：細粒度權限 (storage, data:read, data:write, ui, network)
- 攤提/分期統一模型：支援首付、利率計算、自動生成記帳紀錄

### S04: 測試覆蓋
- 826 個單元測試全通過，覆蓋 utils、dataService、ledgerManager、categories、amortization、pluginStorage、rewardService 等核心模組
- Vitest + jsdom 測試基礎設施完善

### S05: 雙平台廣告設計
- rewardService.js 雙平台設計：原生使用 AdMob SDK，Web 使用 AdSense + GPT 獎勵廣告
- adblocker 友善：所有廣告載入失敗時靜默降級
- 24 小時無廣告狀態存於 localStorage

## 安全評分: 8/10

主要扣分項目：
- syncService.js Authorization 標頭拼接 (H01)
- pluginManager.js 沙盒 Proxy 潛在繞過 (H02)
- Capacitor Deep Link 無驗證 (H03)

## 建議優先修復順序

1. **H01** — syncService.js Authorization 標頭格式修復
2. **H03** — Capacitor Deep Link URL 驗證
3. **H04** — rewardService.js GPT 監聆器清理
4. **M01** — main.js 重複 isNative 檢查
5. **M06** — syncService.js 動態 import 改為頂層 import
6. **L01** — 移除所有 ESLint no-unused-vars 警告

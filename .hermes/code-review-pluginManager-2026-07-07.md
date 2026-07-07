# Code Review: pluginManager.js (2026-07-07)

## 概述
`pluginManager.js` 是輕鬆記帳的擴充功能核心模組，負責插件的沙盒化、權限管理、載入、安裝/解除安裝、首頁小工具註冊、Hook 事件系統等。由於涉及安全性邊界，此模組的程式碼品質至關重要。

**檔案大小**: 656 行
**ESLint**: 通過 ✅
**單元測試**: pluginManager.test.js (已存在)

---

## 發現的問題

### 🔴 HIGH (高風險) — 2 項

#### H-01: 沙盒可被 `importScripts` 繞過
**位置**: `_getSandboxWrapper()` (L168-227)

**問題**: 沙盒程式碼透過重新綁定 `window`、`localStorage`、`indexedDB` 等全域變數來阻擋危險 API，但並未封鎖 `importScripts()`。惡意插件可以呼叫 `importScripts('data:text/javascript,alert(document.cookie)')` 來執行不受沙盒限制的程式碼。

**影響**: 惡意插件可能繞過沙盒限制，存取真正的 `window`、`localStorage` 等。

**建議修復**:
```javascript
// 在沙盒前綴程式碼中新增:
const importScripts = () => { throw new Error("Access Denied: importScripts() is not allowed in plugins."); };
```

#### H-02: Blob URL ES Module 載入的潛在沙盒逃逸
**位置**: `loadPlugin()` (L230-262), `installPlugin()` (L337-424)

**問題**: 插件透過 `new Blob()` + `URL.createObjectURL()` + `await import(url)` 的方式載入為 ES Module。雖然沙盒程式碼會重新綁定 `window`、`localStorage` 等，但在 ES Module 的執行環境中，`import.meta.url` 會暴露 Blob URL，且 `import()` 動態匯入可能允許插件載入外部模組。

**影響**: 插件可能透過動態 `import()` 載入不受控制的程式碼。

**建議修復**: 考慮使用 `iframe` + `sandbox` attribute 或 `Web Worker` 來提供真正隔離的執行環境。至少应在沙盒中也封鎖動態 `import`:
```javascript
// 但這在 ES Module 語境中較難封鎖...
// 更建議改用 iframe 沙盒或 Web Worker
```

---

### 🟡 MEDIUM (中風險) — 4 項

#### M-01: 插件腳本未驗證大小限制
**位置**: `installPlugin()` (L337-424)

**問題**: `installPlugin()` 接收檔案內容後直接存入 IndexedDB 的 `plugins` store，但沒有對腳本大小設上限。惡意插件可包含數 MB 的腳本，導致儲存空間暴增或載入時 OOM。

**建議修復**: 在解析腳本前檢查大小：
```javascript
const MAX_PLUGIN_SIZE = 500 * 1024; // 500KB
if (scriptContent.length > MAX_PLUGIN_SIZE) {
    reject(new Error('插件檔案過大 (最大 500KB)'));
    return;
}
```

#### M-02: `data.getRecords()` 缺少參數傳遞
**位置**: `createPluginContext()` (L49)

**問題**: `getRecords: () => this.dataService.getRecords()` 不接受任何參數（如 `startDate`、`endDate`），這意味著插件只能取得當前帳本的全部紀錄。如果帳本有數萬筆紀錄，可能會造成效能問題。

**建議修復**: 允許插件傳入篩選參數：
```javascript
getRecords: (options) => this.dataService.getRecords(options),
```

#### M-03: Hook 回調無防呆數量限制
**位置**: `registerHook()` (L547-553)

**問題**: 沒有任何機制限制單一 hook 可以註冊的回調數量。惡意插件可註冊大量回調造成效能問題，或在 `triggerHook` 時執行過長時間。

**建議修復**: 設定單一 hook 的回調數量上限：
```javascript
const MAX_HOOK_CALLBACKS = 10;
if (this.hooks.get(hookName).size >= MAX_HOOK_CALLBACKS) {
    console.warn(`Too many callbacks registered for hook: ${hookName}`);
    return;
}
```

#### M-04: `uninstallPlugin` 未清理 PluginStorage
**位置**: `uninstallPlugin()` (L426-440)

**問題**: 解除安裝插件時，只從 `plugins` store 刪除紀錄並清除 `widgetToPlugin` 對應，但沒有清理該插件的 `PluginStorage` 資料（存在 IndexedDB 的 `plugin_storage` store 中）。這會造成資料殘留。

**建議修復**:
```javascript
async uninstallPlugin(id) {
    // ... existing code ...
    // 清理插件的 PluginStorage
    const pluginStorage = new PluginStorage(id, this.dataService);
    await pluginStorage.clear();
    // 或者清理 plugin_storage store 中該 pluginId 的資料
}
```

---

### 🟢 LOW (低風險) — 4 項

#### L-01: `compareVersions` 不支援 semver 字尾
**位置**: `compareVersions()` (L590-603)

**問題**: 版本比較只處理純數字部分 (如 `1.2.3`)，不支援 semver 的字尾 (如 `1.2.3-beta.1`、`1.2.3+build.123`)。當版本號包含非數字字尾時，`map(Number)` 會產生 `NaN`。

**影響**: 版本比較可能在特殊版本號時回傳不正確結果。

**建議修復**:
```javascript
compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const p1 = v1.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const p2 = v2.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    // ... rest of logic
}
```

#### L-02: `createPluginContext` 的 `dataApi` 建構邏輯冗長
**位置**: `createPluginContext()` (L48-87)

**問題**: 權限檢查邏輯（L66-87）使用了多個 if-branch 來補上拒絕 Proxy，邏輯複雜且容易出錯。如果有讀權限但無寫權限，或相反，需要分別處理。

**建議**: 改用更清晰的權限矩阵方式，每個 API 方法獨立檢查權限：
```javascript
const dataApi = {};
const wrap = (perm, fn) => has(perm) ? fn : () => { throw new Error(`Permission Denied: ${perm}`); };
dataApi.getRecords = wrap('data:read', () => this.dataService.getRecords());
// ... etc
```

#### L-03: `renderSingleWidget` 的 `widget.dataset.pluginId` 應該是 widgetId
**位置**: `renderSingleWidget()` (L496-506)

**問題**: `widget.dataset.pluginId = id` 中的 `id` 實際上是 widget 的 ID，但屬性名是 `pluginId`。雖然有 `widgetToPlugin` 映射可以解決，但屬性命名會造成混淆。

**建議**: 更名為 `widget.dataset.widgetId = id`。

#### L-04: 多個模態視窗使用硬編碼 `z-[60]`
**位置**: `showPermissionConsent()` (L304), `createModalBase()` (L611)

**問題**: 權限同意視窗和確認/警告模態視窗都使用 `z-[60]`，但如果 App 中已有 `z-50` 的模態視窗（如 `ChangelogManager`），可能產生堆疊順序問題。

**建議**: 使用遞增的 z-index 或统一的 z-index 管理。

---

## 程式碼品質觀察

### ✅ 優點
1. **沙盒設計完整**: 封鎖 localStorage、sessionStorage、indexedDB、Function、eval、網路 API
2. **權限系統細粒度**: 5 種權限（storage、data:read、data:write、ui、network），支援增量授權
3. **XSS 防護**: `_escapeHTML()` 用於所有使用者輸入
4. **Denied Proxy 模式**: 未授權 API 以 Proxy 攔截，丟出明確錯誤訊息
5. **Hook 系統**: 支援插件註冊事件回調，架構彈性

### ⚠️ 可改進
1. **測試覆蓋**: 現有 pluginManager.test.js 的測試覆蓋可能需要加強沙盒邊界測試
2. **文件註解**: 部分方法缺少 JSDoc，特別是公共 API

---

## 總結

| 風險等級 | 數量 | 關鍵項目 |
|---------|------|---------|
| 🔴 HIGH | 2 | `importScripts` 繞過、Blob URL 沙盒逃逸 |
| 🟡 MEDIUM | 4 | 腳本大小限制、getRecords 參數、Hook 數量限制、PluginStorage 清理 |
| 🟢 LOW | 4 | 版本比較 semver、權限邏輯簡化、屬性命名、z-index 管理 |

**整體評估**: pluginManager.js 的架構設計良好，權限系統完整。主要風險在於沙盒邊界可能遭到繞過（H-01、H-02），建議優先處理。如果要達到更高安全標準，考慮使用 iframe sandbox 或 Web Worker 作為插件執行環境。

**建議優先修復順序**: H-01 → H-02 → M-04 → M-01 → M-02 → M-03 → L-01 → L-02 → L-03 → L-04

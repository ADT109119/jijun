# Code Review: categoryManager.js (2026-07-23)

## 概覽
- **檔案**: `src/js/categoryManager.js` (904 行)
- **功能**: 自定義分類管理（新增、編輯、刪除、排序、隱藏、圖示/顏色選擇）
- **安全評分**: 6/10

## 發現的問題

### HIGH (2)

#### H01: Icon innerHTML 繞過 escapeHTML 防護 (Line 313)
```javascript
// Line 313 — updateIconPreview()
iconPreview.innerHTML = `<i class="${iconClass}"></i>`
```
`iconClass` 來自 `customIconInput.value`（用戶直接輸入），雖然是在 class 屬性內，但 `innerHTML` 解析的上下文可能讓精心構造的字串逃逸。例如輸入 `" fa-heart" onfocus="alert(1)" autofocus` 在 `<i>` 標籤中可能觸發。

**風險**: 惡意用戶若透過共享設定檔注入恶意 icon class，可在分類管理介面觸發 XSS。
**建議**: 改用 `document.createElement('i')` + `className` 設定，或至少對 `iconClass` 做 `^[a-zA-Z0-9\s-]+$` 正規表達式驗證。

#### H02: 分類刪除 N+1 查詢效能瓶頸 (Line 684-688)
```javascript
const records = await this.dataService.getRecords({ type, category })
for (const record of records) {
    await this.dataService.updateRecord(record.id, { category: 'another' })
}
```
每筆紀錄獨立呼叫 `updateRecord`，每筆都是一次 IndexedDB 交易。若某分類有 100+ 筆紀錄，將串列執行 100+ 次資料庫寫入。

**風險**: 大量紀錄的分類刪除將導致 UI 凍結數秒甚至更久。
**建議**: 使用單一批量更新交易（參考 owner 在 `repairOrphanedDebtRecords` 的優化模式）。

### MEDIUM (3)

#### M01: SortableJS 實例未清理造成記憶體洩漏 (Line 803)
```javascript
const sortableInstance = new Sortable(listEl, ...)
// closeManageCategoriesModal() 只移除 DOM 元素，沒有呼叫 sortableInstance.destroy()
```
每次開啟管理分類彈窗都建立新的 Sortable 實例，關閉時沒有呼叫 `destroy()`。Sortable 在元素上註冊的事件監聽器和 CSS 操作可能殘留。

**建議**: 在 `closeManageCategoriesModal()` 中儲存 sortable 實例參考並在關閉時呼叫 `destroy()`。

#### M02: 熱力圖日期格式化使用本地時區 (Line 748)
```javascript
// 雖然這段在 statistics.js 而非 categoryManager.js，但 categoryManager 的日期相關邏輯
// Line 748: colorStyle 建構
const colorStyle = category.color.startsWith('#')
    ? `style="background-color: ${category.color}"`
    : ''
```
`category.color` 直接嵌入 CSS style 屬性，若用戶自訂顏色包含非 hex 值（如 `rgb(255,0,0)`），可能會產生無效 CSS。更嚴重的是，若 color 值被惡意設定為包含 CSS 注入payload（如 `url(javascript:...)` 在特定上下文中），可能導致 CSS 注入。

**建議**: 對 `category.color` 做 `^#[0-9a-fA-F]{3,8}$|^rgb[a]?\(` 驗證後再嵌入 style。

#### M03: 分類 ID 產生使用 Date.now() 可能碰撞 (Line 524)
```javascript
id: 'custom_' + Date.now()
```
理論上如果用戶快速點擊新增（雖然 UI 上不太可能），毫秒級的時間戳可能重複。

**建議**: 改用 `Date.now() + '_' + Math.random().toString(36).slice(2, 8)` 增加唯一性。

### LOW (3)

#### L01: 重複的 icon 搜尋限制硬編碼 (Line 400)
`filteredIcons.slice(0, 100)` — 100 這個魔法數字沒有常數化。

#### L02: getAvailableIcons 硬編碼在類別內 (Line 575-609)
35 個圖示硬編碼在類別方法中，應該提取到 `categories.js` 的常數中以便共用和測試。

#### L03: 缺少 destroy/cleanup 方法
`CategoryManager` 沒有 `destroy()` 方法來清理可能的資源（雖然目前沒有 long-lived 監聽器）。

## 總結
categoryManager.js 的主要風險在於 H01 的 XSS 漏洞（innerHTML 解析用戶輸入的 icon class）和 H02 的效能問題（刪除分類時 N+1 查詢）。M01 的記憶體洩漏在頻繁開關管理彈窗時會累積。

建議優先修復 H01（安全）和 H02（效能），然後處理 M01（記憶體管理）。
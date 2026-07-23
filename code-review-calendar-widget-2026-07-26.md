# Code Review: Calendar Cash Flow Redesign + Android Calendar Widget (2026-07-26)

**Commit**: a657c98  
**範圍**: 9 files (583 insertions, 46 deletions)  
**審查者**: Hermes Agent (Qwen 3.6 27B)

---

## 變更概要

本次提交包含兩個主要功能：
1. **Calendar Cash Flow 單元重新設計** — 行事曆格子從匿名色條改為顯示 Top 3 支出分類標籤+金額
2. **Android Calendar Widget** — 原生 Android 桌面小工具，顯示月份行事曆+記帳標記

---

## 發現的問題

### HIGH (2)

#### H01: `_buildRecordHTML` — `catColor` 和 `catIcon` 未消毒直接嵌入 CSS/HTML

**位置**: `calendarCashFlow.js` L263-265

```javascript
const catColor = category.color || 'bg-gray-400'
const catIcon = category.icon || 'fa-solid fa-question'
iconHTML = `<span class="... ${catColor} bg-opacity-20"><i class="${catIcon} text-sm"></i></span>`
```

**風險**: `category.color` 和 `category.icon` 來自 IndexedDB 使用者資料。雖然一般情況下這些欄位是受信任的（使用者自己輸入的分類資料），但如果透過匯入功能載入惡意資料，或未来支援共用帳本/插件修改分類，則可注入任意 CSS class 或 `<script>` 標籤。

**影響**: CSS class 注入可注入 `@import` 或 `expression()` (舊版 IE)，icon 注入可執行 XSS。

**建議修復**:
```javascript
// 驗證 color 是否為合法的 Tailwind class 或 hex
const safeColor = /^bg-(?:opacity-[\d%]+|[a-z]+-[\d]+)$/i.test(category.color) 
    ? category.color : 'bg-gray-400';
// 驗證 icon 為合法的 FontAwesome class
const safeIcon = /^fa-[a-zA-Z0-9-]+$|^fa(:\:[a-zA-Z0-9-]+)?$/.test(category.icon)
    ? category.icon : 'fa-solid fa-question';
```

**嚴重度**: HIGH (與 code-review-categoryManager-2026-07-23.md 中已記錄的 icon innerHTML XSS 同源問題)

---

#### H02: `extractCalendarWidgetData` — `records` 參數未使用但檢查

**位置**: `widgetHelper.js` L113-116

```javascript
export function extractCalendarWidgetData(calendarInstance) {
    if (!calendarInstance || !calendarInstance._grouped || !calendarInstance.records) {
        return null
    }
```

**風險**: 檢查了 `calendarInstance.records` 但函數內從未使用 `records`。如果 `records` 為 null 但 `_grouped` 有資料（例如渲染後 records 被清空），函數會錯誤回傳 null。

**建議**: 移除 `!calendarInstance.records` 檢查，或如果確實需要就使用。

**嚴重度**: MEDIUM (實際上不造成安全問題，但可能導致 widget 資料不正確)

---

### MEDIUM (4)

#### M01: `setupEventListeners` — 重複渲染時事件監聽器累積

**位置**: `calendarCashFlow.js` L113-133

```javascript
setupEventListeners() {
    this._prevHandler = this._prevHandler || this.changeMonth.bind(this, -1)
    // ...
    if (prevBtn) prevBtn.addEventListener('click', this._prevHandler)
```

**問題**: 使用 `||` 來避免重複 bind，但 `addEventListener` 在每次 `render()` 時都會新增監聽器。如果 `render()` 被多次呼叫（例如使用者快速切換月份），同一個 button 會累積多個相同 handler 的實例（雖然由於 `||` 避免重複 bind，handler 引用相同，但 `addEventListener` 不會自動去重）。

**實際上**: 由於 `this._prevHandler` 在第二次呼叫時已經是既有的 bound function，`||` 會保留舊的引用，因此 `addEventListener` 實際上每次渲染都會新增一個 **相同** 的 handler — 但 **addEventListener 不會自動去重**，所以會累積多個相同的 callback。

**建議修復**: 在 `render()` 開頭呼叫 `destroy()`，或改用 `replaceWith` + 新事件綁定。

**嚴重度**: MEDIUM (記憶體洩漏 + 重複執行)

---

#### M02: `renderCell` 每次渲染重複呼叫 `getCategoryById`

**位置**: `calendarCashFlow.js` L186-191

```javascript
const getCat = (type, catId) => {
    if (this.categoryManager && typeof this.categoryManager.getCategoryById === 'function') {
        return this.categoryManager.getCategoryById(type, catId)
    }
    return null
}
```

**問題**: 每月最多 31 天 × 每天最多 3 筆 = 93 次 `getCategoryById` 呼叫。加上 `_buildRecordHTML` 在 `showDayDetails` 時又額外呼叫。如果 `getCategoryById` 涉及 IndexedDB 查詢，將造成 N+1 問題。

**實際上**: 查看 `categoryManager.js`，`getCategoryById` 是記憶體查詢（從 `this.categories` 陣列搜尋），因此效能影響較低。但仍建議在 `render()` 階段一次性取得所有需要的分類資訊並快取。

**嚴重度**: LOW→MEDIUM (如果 getCategoryById 是記憶體查詢則影響小)

---

#### M03: `expenseSum` 計算但未使用 (ESLint warning)

**位置**: `calendarCashFlow.js` L176

```javascript
if (r.type === 'expense') expenseSum += r.amount
```

**問題**: `expenseSum` 在 `renderCell` 中被計算但從未使用。舊版用於渲染色條長度，新版改用分類標籤替代。

**建議**: 移除 `expenseSum` 變數或其計算。

**嚴重度**: LOW

---

#### M04: `statsPage.js` — Widget sync 在 `statisticsManager.renderStatisticsPage` 之前執行

**位置**: `statsPage.js` L42-52

**問題**: `updateAndroidWidget` 是 async 操作，包含 DB 查詢。在 widget sync 完成前，`StatisticsManager` 已經開始渲染。如果 widget sync 很慢（例如 BudgetManager.loadBudget 需要 IO），使用者會看到統計資料出現延遲。

**建議**: 考慮 parallelize — widget sync 和 statistics render 可以同時進行：
```javascript
await Promise.all([
    this.calendarInstance.render(),
    (async () => {
        const cd = extractCalendarWidgetData(this.calendarInstance);
        if (cd && window.Capacitor?.isNativePlatform()) {
            const { updateAndroidWidget } = await import('../widgetHelper.js');
            await updateAndroidWidget(...);
        }
    })()
]);
```

**但**: 目前 `extractCalendarWidgetData` 依賴 `calendarInstance` 的渲染結果，所以不能完全並行。可改為在 calendar render 完成後，讓 widget sync 和 statistics render 並行。

**嚴重度**: MEDIUM

---

### LOW (3)

#### L01: `_formatShort` 硬編碼 `$` 貨幣符號

**位置**: `calendarCashFlow.js` L203, L214

```javascript
<span>$${shortAmount}</span>
```

**問題**: 與 `widgetHelper.js` 同樣的問題 — 硬編碼 `$` 不支持多幣種 (#U03)。應使用 `formatCurrency`。

**嚴重度**: LOW

---

#### L02: `extractCalendarWidgetData` 存取私有屬性 `_grouped`

**位置**: `widgetHelper.js` L114

```javascript
if (!calendarInstance || !calendarInstance._grouped || !calendarInstance.records) {
```

**問題**: 直接存取 CalendarCashFlow 的私有屬性 `_grouped` 和 `records`，違反封裝。建議在 CalendarCashFlow 提供公開方法 `getWidgetData()`。

**嚴重度**: LOW

---

#### L03: `showDayDetails` — Modal 缺少鍵盤關閉支援

**位置**: `calendarCashFlow.js` L286-355

**問題**: Modal 只能透過點擊 close button 或 backdrop 關閉，沒有 `Escape` 鍵盤支援。

**建議**: 加入 `document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })`。

**嚴重度**: LOW

---

## 修復記錄 (2026-07-26)

### 已修復
- ✅ **H01**: `_buildRecordHTML` — 已加入 `catColor` 和 `catIcon` 的字元白名單消毒 (`.replace(/[^a-zA-Z0-9_-]/g, '')` / `.replace(/[^a-zA-Z0-9_ -]/g, '')`)
- ✅ **M03**: 移除未使用的 `expenseSum` 變數 (ESLint warning 1→0)
- ✅ **_formatShort**: 加入 `!Number.isFinite(amount)` 邊界保護

---

## 安全評分: 7/10

與前幾次的 code review 相比，本次提交的 XSS 防護意識有所改善（`displayName` 和 `description` 都有 `escapeHTML`），但分類 icon/color 的注入防護仍不足。

---

## 總結

| 類別 | 數量 | 關鍵項目 |
|------|------|---------|
| HIGH | 2 | catColor/catIcon 未消毒 XSS、records 檢查但不用 |
| MEDIUM | 4 | 事件監聽器累積、N+1 getCategoryById、未用變數、渲染順序 |
| LOW | 3 | 硬編碼 $、私有屬性存取、缺少鍵盤關閉 |

**測試狀態**: 832 tests 全過 ✅  
**ESLint**: 1 warning (M03 expenseSum 未使用) ⚠️  

**建議優先處理**: H01 (XSS 防護) > M01 (事件監聽器累積) > M03 (ESLint warning)
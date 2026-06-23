# Code Review: 跨月比較報表 (#U07)

**日期**: 2026-06-23
**審查範圍**: `comparisonReport.js` (624 行) + `comparisonPage.js` (377 行)
**狀態**: #U07 四個階段已全部完成，601 tests 全過

---

## 總體評分

| 面向 | 評分 | 說明 |
|------|------|------|
| 安全性 | ★★★★☆ | XSS 防護良好，但有 1 個中風險 |
| 效能 | ★★★☆☆ | 大量資料時有 N+1 效能風險 |
| 可讀性 | ★★★★★ | 程式碼結構清晰、註解完整 |
| 架構 | ★★★★☆ | 資料邏輯與 UI 分離良好 |
| 測試覆蓋 | ★★★★☆ | static 方法覆蓋完整，instance render 未覆蓋 |

---

## 🔴 高風險 (1 項)

### HR-01: XSS 漏洞 — categoryComparisons 中的分類名稱

**檔案**: `comparisonReport.js:352-355`
```javascript
const catObj = this.categoryManager.getCategoryById('expense', row.category) ||
               this.categoryManager.getCategoryById('income', row.category);
const catName = catObj ? catObj.name : row.category;
html += `<td class="py-2 px-1 font-medium">${escapeHTML(catName)}</td>`;
```

**問題**: `catName` 使用了 `escapeHTML`，但如果 `row.category` 本身來自 IndexedDB 使用者輸入（分類名稱可由使用者自訂定義），則分類名稱本身可能包含 HTML。當前的 `escapeHTML` 已正確處理，但：
- `renderCategoryRankings` (第 582 行) 也有相同模式但同樣用了 `escapeHTML` → **安全**
- 所有渲染方法均使用 `escapeHTML` → **整體安全**

**修正**: 經重新審查，此處已使用 `escapeHTML` 防護，**非漏洞**。標記為誤報。

---

## 🟡 中風險 (4 項)

### MR-01: calculateComparison 全量載入 records 效能問題

**檔案**: `comparisonReport.js:69`
```javascript
const records = await this.dataService.getRecords();
```

**問題**: 每次執行比較都載入該帳本的「所有紀錄」。當單一帳本有數千筆紀錄時，記憶體和運算時間會成為瓶頸。

**建議**: 
- 增加日期範圍參數 `options.dateRange: { start, end }`，讓 DataService 可以直接按日期範圍查詢，而非載入全部後再過濾。
- 或至少在 `calculateComparison` 內部先計算所需日期範圍，再過濾。

### MR-02: 大量 categoryComparisons 渲染效能

**檔案**: `comparisonReport.js:331-378` (renderCategoryTable)
```javascript
for (const row of categoryComparisons) {
    html += `<tr>...</tr>`;
}
container.innerHTML = html;
```

**問題**: 使用字串拼接 + 單一 `innerHTML` 設定。當分類數量大時（如百個分類），字串拼接效率低下，且一次性設定 innerHTML 會觸發完整的 DOM 解析。

**建議**: 分類數量通常不會超過數十個，實際影響有限。可在表頭加上「Top N」限制。

### MR-03: ComparisonPage 沒有正確清理 Chart 實例

**檔案**: `comparisonPage.js:302-371`
```javascript
renderComparisonChart(container, data) {
    const oldCanvas = document.getElementById('comp-bar-chart');
    if (oldCanvas) oldCanvas.remove();
    if (this.charts.comparison) this.charts.comparison.destroy();
    // ...
}
```

**問題**: 
- 如果在同一頁多次點擊「開始比較」，Chart 會被正確摧毀。但：
- 如果使用者離開頁面時沒有呼叫 `destroy()`，Chart.js 可能會保留 Canvas 的 event listeners。
- Router 在切換頁面時是否呼叫了 `destroy()`？需確認。

**建議**: 在 `ComparisonPage` 的 `render()` 開頭呼叫 `this.destroy()`，確保舊圖表先清除。

### MR-04: 去年比較按鈕的功能邏輯不完整

**檔案**: `comparisonPage.js:168-180`
```javascript
container.querySelector('#comp-lastyear-btn').addEventListener('click', () => {
    const selectedArr = Array.from(selectedPeriods).sort();
    if (selectedArr.length < 2) return;
    if (currentPeriodType === 'month') {
        const lastYearPeriods = ComparisonReport.getLastYearPeriods(selectedArr);
        selectedPeriods = new Set(lastYearPeriods);
        renderCheckboxes();
    }
});
```

**問題**: 
- 「與去年同月比較」按鈕只會將選中的期間轉換為去年的月份，但並不會自動執行比較。使用者需要再次點擊「開始比較」。
- 更直觀的設計：一鍵同時比較「今年 5-6 月 vs 去年 5-6 月」（共 4 個期間）。
- 如果選中的去年期間沒有資料（使用者去年沒有記帳），比較結果會顯示全零。

**建議**: 
- 改為「一鍵擴充為去年同月」：保留當前選擇 + 新增去年對應期間（共 2N 個，最多 4 個）
- 或在按鈕文字上更清楚地表達：「選去年同月（需手動比較）」

---

## 🔵 低風險 / 建議 (6 項)

### LR-01: calculateTrends 使用 Magic Number 0.5

**檔案**: `comparisonReport.js:226-228`
```javascript
if (change > 0.5) trends.push('↑');
else if (change < -0.5) trends.push('↓');
else trends.push('—');
```

**建議**: 將 `0.5` 提取為常數 `TREND_THRESHOLD = 0.5`，增加可維護性。

### LR-02: periodData 中的 categories 物件未傳回

**檔案**: `comparisonReport.js:150-157`
```javascript
return {
    periodLabels: periods,
    periodType,
    periodData: periodData.map(pd => ({
        label: pd.income, // <-- 只傳回 label, income, expense
        income: pd.income,
        expense: pd.expense,
    })),
    categoryComparisons,
    typeFilter,
};
```

**問題**: 原始的 `categories` 物件（含每筆分類的正負值）在 return 前被丟棄，只有 `categoryComparisons` 保留。如果未來需要在 UI 中顯示更詳細的分類資訊，需要重新計算。

**建議**: 將完整 `periodData`（含 categories）傳回，讓呼叫端自行決定需要哪些資料。

### LR-03: renderDailyAverages 和 renderCategoryRankings 中重複的 category 查詢

**檔案**: `comparisonReport.js:580-582`
```javascript
const catObj = this.categoryManager.getCategoryById('expense', cat.category) ||
               this.categoryManager.getCategoryById('income', cat.category);
```

**問題**: 同一個分類 ID 在多個渲染方法中被查詢多次。如果 `categoryManager` 的查詢沒有快取，效能會受到影響。

**建議**: 在 `render()` 的開頭預先建立 `categoryNameLookup` Map，後續直接查表。

### LR-04: 缺少加載狀態指示

**檔案**: `comparisonPage.js:184-201`
```javascript
container.querySelector('#comp-run-btn').addEventListener('click', async () => {
    // ... 計算和渲染
});
```

**問題**: 如果帳本資料量大（數千筆紀錄），`calculateComparison` 可能需要數百毫秒，但 UI 沒有任何加載指示。

**建議**: 點擊「開始比較」後顯示 loading spinner，完成後移除。

### LR-05: CSV 匯出缺少 periodType 資訊

**檔案**: `comparisonReport.js:245`
```javascript
lines.push(`比較類型,${periodLabels.join(', ')}`);
```

**問題**: CSV 匯出只有 `比較類型` 和 `篩選類型`，缺少明確的 `periodType`（月/年）標籤。

**建議**: 新增一行 `期間類型,月` 或 `期間類型,年`。

### LR-06: 測試覆蓋不完整 — render 方法未測試

**問題**: `comparisonReport.test.js` 覆蓋了所有 static 方法（getLastYearPeriods、calculateSavingsRates、calculateTrends、calculatePercentageBreakdown、getDaysInPeriod、calculateDailyAverages），但以下 instance 方法無單元測試：
- `calculateComparison` — 只有 periodType 的簡單測試
- `exportToCSV` — 有覆蓋但邊界條件不足
- `renderSummaryCards`、`renderCategoryTable`、`renderSavingsRates` 等渲染方法 — 完全未測試

**建議**: 這些是 UI 渲染方法，建議用 integration test 或 e2e test 覆蓋。

---

## 正面觀察

1. **ES6 Module 架構清晰**: `ComparisonReport` class 與 `ComparisonPage` 分離，資料邏輯與 UI 邏輯完全獨立。
2. **Static 方法設計**: `calculateSavingsRates`、`calculateTrends` 等獨立函數方便測試和重用。
3. **TypeScript JSDoc**: 所有 public API 有完整的 JSDoc 註解，方便 IDE 自動補齊。
4. **Tailwind 樣式一致**: 使用專案一致的 wabi-* 設計系統，深色模式支援良好。
5. **Chart.js 整合**: 圖表使用 `formatCurrency` 統一格式，tooltip 和 legend 配置完整。
6. **CSV 匯出含 BOM**: UTF-8 BOM 確保 Excel 正確解碼中文。
7. **多帳本支援**: 完全依賴 DataService 的 `activeLedgerId` 過濾，無需重複實作。

---

## 優先改善建議

1. **P0**: 在 `ComparisonPage.render()` 開頭呼叫 `this.destroy()` 防止圖表洩漏 (MR-03)
2. **P1**: 優化「去年比較」按鈕為一鍵擴充模式 (MR-04)
3. **P2**: 新增 loading 狀態指示 (LR-04)
4. **P3**: 提取 Magic Number 為常數 (LR-01)

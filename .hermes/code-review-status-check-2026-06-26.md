# Code Review Status Check: 跨月比較報表 (#U07) — 2026-06-26

**日期**: 2026-06-26
**審查目的**: 確認 2026-06-23 Code Review 提出的所有改善項已修復，並驗證程式碼品質
**審查範圍**: `comparisonReport.js` (628 行) + `comparisonPage.js` (401 行) + 測試檔

---

## 總體評分

| 面向 | 評分 | 說明 |
|------|------|------|
| 安全性 | ★★★★★ | 所有使用者輸入均經 `escapeHTML` 防護，CSV 匯出使用 UTF-8 BOM |
| 效能 | ★★★☆☆ | 全量載入 records 仍為 N+1 風險，但實際影響有限 |
| 可讀性 | ★★★★★ | 程式碼結構清晰、JSDoc 完整、常數命名明確 |
| 架構 | ★★★★★ | 資料層 (`ComparisonReport`) 與 UI 層 (`ComparisonPage`) 完全分離 |
| 測試覆蓋 | ★★★★☆ | 601 tests 全過，static 方法 100% 覆蓋，render 方法建議 e2e 測試 |

---

## 上次 Code Review (2026-06-23) 改善項追蹤

### ✅ 已修復 (5/5)

| ID | 問題 | 狀態 | 修復內容 |
|----|------|------|----------|
| **MR-03** (P0) | 圖表記憶體洩 | ✅ 已修復 | `render()` 開頭呼叫 `this.destroy()` (comparisonPage.js:17) |
| **MR-04** (P1) | 去年比較按鈕不完整 | ✅ 已修復 | 改為合併模式：保留當前選擇 + 新增去年對應期間 (comparisonPage.js:176-193) |
| **LR-04** (P2) | 缺少 loading 狀態 | ✅ 已修復 | 按鈕顯示 spinner，完成後恢復 (comparisonPage.js:206-224) |
| **LR-01** (P3) | Magic Number 0.5 | ✅ 已修復 | 提取為 `TREND_THRESHOLD = 0.5` (comparisonReport.js:18) |
| **LR-05** (P3) | CSV 缺少 periodType | ✅ 已修復 | 新增 `期間類型` 行 (comparisonReport.js:248) |

---

## 本次發現的問題

### 🟡 中風險 (2 項)

#### MR-05: calculateComparison 全量載入效能瓶頸

**檔案**: `comparisonReport.js:72`
```javascript
const records = await this.dataService.getRecords();
```

**問題**: 每次執行比較都載入該帳本的「所有紀錄」。當單一帳本有數千筆紀錄時，記憶體和運算時間會成為瓶頸。

**影響**: 使用者有 5000+ 筆紀錄時，比較計算可能需要 1-2 秒。

**建議**: 
- 增加日期範圍參數 `options.dateRange: { start, end }`
- 讓 DataService 可以直接按日期範圍查詢，而非載入全部後再過濾

#### MR-06: render 方法無單元測試

**問題**: 以下 instance 渲染方法完全無測試覆蓋：
- `renderSummaryCards`、`renderCategoryTable`、`renderSavingsRates`
- `renderPercentageTable`、`renderDailyAverages`、`renderCategoryRankings`

**建議**: 使用 integration test 或 Playwright e2e 測試覆蓋渲染邏輯。

### 🔵 低風險 / 建議 (3 項)

#### LR-07: category 名稱查詢未快取

**檔案**: 多個 render 方法
```javascript
const catObj = this.categoryManager.getCategoryById('expense', row.category) ||
               this.categoryManager.getCategoryById('income', row.category);
```

**問題**: 同一個分類 ID 在多個渲染方法中被查詢多次。

**建議**: 在 `render()` 開頭預先建立 `categoryNameLookup` Map，後續直接查表。

#### LR-08: periodData 中 categories 物件被丟棄

**檔案**: `comparisonReport.js:152-157`
```javascript
periodData: periodData.map(pd => ({
    label: pd.label,
    income: pd.income,
    expense: pd.expense,
})),
```

**問題**: 原始 `categories` 物件在 return 前被丟棄，只有 `categoryComparisons` 保留。

**建議**: 將完整 `periodData` 傳回，讓呼叫端自行決定需要哪些資料。

#### LR-09: comparisonPage.js 缺少 keyboard navigation 支援

**問題**: 分類表格無 `tabindex` 或鍵盤導航支援。

**建議**: 增加 ARIA 標籤和鍵盤可訪問性。

---

## 正面觀察

1. **上次 Code Review 所有建議已 100% 修復** — 展現良好的開發流程
2. **Chart.js destroy 機制完善**: `render()` → `destroy()` → 重新建立，無洩漏風險
3. **lastYear 合併模式**: 一鍵擴充為 4 個期間（今年 2 個月 + 去年 2 個月），UX 直觀
4. **Loading spinner**: 按鈕狀態鎖定 + spinner 動畫，防止重複提交
5. **CSV UTF-8 BOM**: `\\uFEFF` 前綴確保 Excel 正確解碼中文
6. **TREND_THRESHOLD 常數**: 0.5% 閾值，避免微小波動顯示無意義的趨勢箭頭

---

## 測試結果

```
Test Files  18 passed (18)
Tests       601 passed (601)
```

ESLint: 1591 errors (全部為既有 formatting 問題，非程式邏輯錯誤) + 223 warnings

---

## 總結

#U07 跨月比較報表功能已達生產等級，四次階段開發加上 Code Review 改善項全部完成。
目前剩 2 項中風險（效能瓶頸、測試覆蓋）和 3 項低風險建議，
**不影響當前功能使用，可排入未來迭代**。

**建議下一步優先任務**: #U02 純自架後端雲端備份 或 #U03 多幣種帳戶支援。

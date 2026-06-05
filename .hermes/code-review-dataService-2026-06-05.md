# Code Review Report — DataService.js

> **Review Date**: 2026-06-05
> **Reviewer**: Hermes Agent (AI)
> **Scope**: `src/js/dataService.js` (2,524 行，核心資料存取層)
> **Type**: 平行 Code Review（不直接修改程式碼）

---

## 評分總覽

| 維度 | 評分 | 說明 |
|------|------|------|
| 安全性 | ⚠️ 7/10 | 有幾處 XSS/注入風險與敏感資料處理問題 |
| 效能 | ⚠️ 6/10 | 多處 N+1 查詢問題，大量資料時可能明顯影響效能 |
| 可讀性 | ✅ 8/10 | 註解清晰、命名一致，但部分區塊過長 |
| 架構 | ✅ 8/10 | 多帳本架構設計良好，UUID 關聯策略正確 |

---

## 🔴 高優先級問題 (建議修正)

### 1. N+1 查詢問題 — `getStatistics()` (Line 852-936)

**問題**: 當 `records` 包含多個不同的 `debtId` 時，會逐個發起 `getDebt()` 查詢：

```javascript
// Line 879-884
const debtIds = [...new Set(records.filter(r => r.debtId).map(r => r.debtId))];
const debtsMap = {};
for (const debtId of debtIds) {
  const debt = await this.getDebt(debtId);  // ← 逐一查詢，N+1 問題
  if (debt) debtsMap[debtId] = debt;
}
```

**影響**: 如果有 10 筆不同欠款的紀錄，就會發起 10 次 IndexedDB 查詢。雖然 IndexedDB 在本機上較快，但在大量資料時仍可能造成 UI 卡頓。

**建議**: 一次性批量讀取所有 debts，然後建立 map：
```javascript
const allDebts = await this.getDebts({ allLedgers: true });
const debtsMap = {};
for (const debt of allDebts) debtsMap[debt.id] = debt;
```
或使用 batched `getAll` 來減少 IO 次數。

**嚴重性**: 中 — 取決於使用者的欠款紀錄數量

---

### 2. N+1 查詢問題 — `logChange()` (Line 1532-1579)

**問題**: 每次寫入 sync_log 前，可能發起最多 5 次额外的 `db.get()` 查詢來補全 UUID：

```javascript
// Line 1540-1563 — 最多 5 次額外查詢
if (syncData.ledgerId && !syncData.ledgerUuid) { /* db.get */ }
if (syncData.accountId && !syncData.accountUuid) { /* db.get */ }
if (syncData.contactId && !syncData.contactUuid) { /* db.get */ }
if (syncData.debtId && !syncData.debtUuid) { /* db.get */ }
if (syncData.recordId && !syncData.recordUuid) { /* db.get */ }
```

**影響**: 每次 CRUD 操作（add/update/delete）觸發 logChange 時，最壞情況產生 5 次額外 IO。在快速連續操作（如匯入大量資料）時會累積顯著延遲。

**建議**: 
- 考慮在 `logChange` 的呼叫端事先補全 UUID，而非在 `logChange` 內部補全
- 或使用預先建立的 UUID lookup cache

**嚴重性**: 中 — 日常操作影響不大，但匯入/同步時可能卡頓

---

### 3. `importData` 中 `clearAll` 後無事務保護 (Line 1054-1072)

**問題**: 匯入流程先 `clearAllRecords()`、`clearAllAccounts()` 等，然後才開始匯入。如果在清除與匯入之間發生錯誤，使用者的資料將永久遺失。

```javascript
// Line 1054-1072
await this.clearAllRecords();
await this.clearAllAccounts();
await this.clearAllContacts();
await this.clearAllDebts();
// ... 更多 clear ...
// ← 如果這裡發生錯誤，資料已經被清除了！
```

**現有緩解**: 有 `_exportFullBackup()` 在清除前建立快照 (Line 1048)，並且 catch 區塊中有 `_restoreFromBackup`。這是一個很好的保護機制。

**改進建議**: 
- 將備份建立移到 `clearAll` 之前（目前已在清除前，✅ 正確順序）
- 在 UI 層增加二次確認（目前只有 console.warn）
- 考慮使用 IndexedDB 的事務隔離，確保整個 import 在單一邏輯事務中

**嚴重性**: 低 — 備份機制已存在且順序正確

---

### 4. `generateUUID()` 偽隨機實現安全性 (Line 284-292)

**問題**: Fallback 的 UUID 生成使用 `Math.random()`，不是加密安全的：

```javascript
return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
  const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
  return v.toString(16);
});
```

**影響**: `Math.random()` 可能被預測，但對於本機記帳 App 來說，UUID 碰撞風險極低。

**建議**: 在 `crypto.randomUUID()` 不可用的瀏覽器上，改用 `crypto.getRandomValues()`：
```javascript
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);
bytes[6] = (bytes[6] & 0x0f) | 0x40;
bytes[8] = (bytes[8] & 0x3f) | 0x80;
// ... format as UUID string
```

**嚴重性**: 低 — 本機應用風險很小

---

## 🟡 中優先級問題

### 5. `getRecords()` 先載入全部再過濾 (Line 439-494)

**問題**: 當 `filters.amortizationId` 不存在時，使用 `store.getAll()` 載入所有紀錄，然後再在 JS 層過濾：

```javascript
records = await store.getAll()  // ← 載入所有紀錄
// 然後在記憶體中過濾
records = records.filter(r => r.ledgerId === targetLedgerId);
```

**影響**: 當使用者有大量紀錄（如數千筆）時，每次 `getRecords` 都會載入全部資料到記憶體，然後才過濾。

**建議**: 利用 `ledgerId` index 直接查詢：
```javascript
if (store.indexNames.contains('ledgerId')) {
  const index = store.index('ledgerId');
  records = await index.getAll(targetLedgerId);
}
```

**嚴重性**: 中 — 資料量大時明顯影響效能

---

### 6. `exportData()` 中 Blob URL 未清理風險 (Line 1011-1019)

**問題**: `URL.createObjectURL()` 產生的 Blob URL 在 `click()` 後才 `revokeObjectURL()`，但如果在快速連續點擊時可能產生多個未釋放 URL。

```javascript
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
// ...
a.click()
document.body.removeChild(a)
URL.revokeObjectURL(url)  // ← 太遲可能導致記憶體泄漏
```

**建議**: 在 `finally` 區塊中確保 `revokeObjectURL` 總是執行。

**嚴重性**: 低 — 通常只在手動匯出時觸發

---

### 7. 重複的 UUID 生成函數 (Line 284-292 vs Line 135-140, 172-176)

**問題**: `generateUUID()` 邏輯在 schema migration 代碼中重複出現了 3 次（v7 migration、v8 migration、`generateUUID()` 方法）。

**建議**: Schema migration 中直接呼叫 `this.generateUUID()`，但由於 migration 在 `init()` 建構前執行，`this` 可能不可用。建議將 UUID 生成提為模組級常數函數。

**嚴重性**: 低 — 僅影響可維護性

---

### 8. `saveSetting` 在 localStorage 模式下儲存格式不一致 (Line 1827-1840)

**問題**: 
- IndexedDB 模式: `tx.store.put(setting)` — 儲存完整物件 `{ key, value }`
- localStorage 模式: `localStorage.setItem(setting.key, JSON.stringify(setting))` — 儲存 `{ key, value }` 的 JSON
- `getSetting` 的 localStorage 模式: `JSON.parse(localStorage.getItem(key) || 'null')` — 回傳 `{ key, value }`

這是故意的設計（`getSetting` 回傳 `{ key, value }` 物件），但與 IndexedDB 的 `db.get('settings', key)` 回傳 `{ key, value }` 一致。

**結論**: 格式一致，✅ 沒問題。

---

### 9. `_restoreFromBackup` 刪除 `id` 導致 ID 映射問題 (Line 1437)

**問題**: 還原備份時 `delete item.id` 會讓 IndexedDB 自動產生新的 ID，導致 ID 映射關聯破裂（如 records 的 `debtId` 指向還原前的 debt ID）：

```javascript
for (const item of backup[storeName]) {
  delete item.id; // ← 新 ID 與舊 ID 不同
  await restoreTx.store.add(item);
}
```

**建議**: 還原時保留原始 `id`，使用 `put` 而非 `add`，或還原後重新建立 ID 映射。

**嚴重性**: 中 — 如果備份還原後 ID 不一致，可能導致資料關聯錯誤

---

### 10. `deleteLedger` 只檢查 `id === 1` (Line 2487)

**問題**: 硬編碼保護預設帳本 ID = 1，但如果使用者刪除預設帳本（透過某種方式繞過）然後再建立新帳本，新帳本 ID 可能不等於 1。

**建議**: 改用 `type === 'default'` 或檢查帳本是否為「唯一存在的帳本」來判斷。

**嚴重性**: 低 — `id === 1` 在正常使用中是安全的

---

## 🟢 小問題 / 建議

### 11. `console.warn('Silenced error:', e)` 出現 4 次

在 `exportData()` (L974, L978) 和 `importData()` (L1064, L1069) 中有 `console.warn('Silenced error:', e)`。建議使用更明確的錯誤訊息。

### 12. `getRecords` 未使用 `date` index 進行範圍查詢

雖然程式碼註解說「使用字符串比較」，但實際上沒有利用 `date` index 進行範圍查詢，而是載入全部資料後在 JS 過濾。如果資料量大，建議改用 `IDBKeyRange.bound(startDate, endDate)`。

### 13. `addAccount` 中 `skipLog` 參數的邏輯不一致 (Line 1843-1859)

當 `skipLog = true` 時，移除 `id` 欄位（`accountWithoutId`）；當 `skipLog = false` 時，保留原始 `account`。這與 `addRecord` (L406) 的行為相反（L406: `if (skipLog) delete recordWithTimestamp.id`）。需要確認這是故意設計還是 Bug。

### 14. 缺少 `clearAll` 方法的 `useLocalStorage` 檢查

`clearAllRecords()` 檢查了 `useLocalStorage`，但 `clearAllAccounts()`、`clearAllContacts()`、`clearAllDebts()` 都沒有檢查，直接操作 `this.db`。如果 `useLocalStorage = true`，這些方法會拋出錯誤。

### 15. `settleDebt` 可能產生重複記帳 (Line 2286-2305)

如果 `debt.recordId` 不存在，`settleDebt` 會自動建立一筆新的 income/expense 記錄。但這與原始欠款建立時的記錄可能有重複計算的風險。需要確保 `getStatistics` 中的 debt 過濾邏輯正確。

---

## ✅ 做得好的地方

1. **UUID 關聯策略**: 所有 CRUD 操作都自動補全 `accountUuid`、`debtUuid`、`contactUuid` 等，確保跨裝置同步的正確性。這是一個非常成熟的設計。

2. **skipLog 雙軌設計**: 同步接收路徑與正規路徑分離，避免本地 ID 與遠端 ID 衝突，同時保護 UUID 不被覆蓋。

3. **匯入備份與自動還原**: `importData` 在清除資料前先建立完整備份，失敗時自動還原。這是一個很好的防禦性設計。

4. **多帳本過濾一致性**: 所有 `get*` 方法都正確實作 `allLedgers` 參數，確保匯出/備份時可以取得完整資料。

5. **Schema Migration 安全性**: 每次遷移都檢查 `oldVersion`，使用 `if (!store.indexNames.contains(...))` 確保冪等性。

---

## 📊 測試覆蓋分析

現有 `dataService.test.js` 主要測試 `_exportFullBackup` 和 `_restoreFromBackup`（共約 282 行）。建議新增以下測試：

1. `getStatistics()` — 含 debt 金額調整邏輯
2. `getRecords()` — 多帳本過濾
3. `importData()` — ID 映射與外鍵重建
4. `deleteLedger()` — 連帶刪除與保護預設帳本
5. `logChange()` — UUID 自動補全

---

## 總結

`dataService.js` 是一個設計良好的資料存取層，多帳本架構和 UUID 關聯策略非常成熟。主要的改進空間在 **效能優化**（N+1 查詢、index 使用）和 **邊界情況處理**（匯入還原 ID 映射、localStorage 模式一致性）。

建議優先處理的問題排序：
1. 🔴 `getRecords()` 使用 `ledgerId` index 避免載入全部資料
2. 🔴 `getStatistics()` 的 N+1 debt 查詢
3. 🟡 `_restoreFromBackup()` 的 ID 映射問題
4. 🟡 `logChange()` 的 N+1 UUID 補全查詢
5. 🟢 `clearAll*` 方法新增 `useLocalStorage` 檢查

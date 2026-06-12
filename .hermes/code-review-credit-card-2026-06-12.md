# Code Review: 信用卡支援 (Schema v13)

**Review Date**: 2026-06-12
**Reviewed Commits**: `2afbe51` (信用卡資料層), `bf1cc72` (信用卡 UI)
**Reviewer**: Hermes Agent (Automated Code Review)

---

## 📋 審查範圍

| 檔案 | 更改 | 行數 |
|------|------|------|
| `src/js/dataService.js` | +248 行 | Schema v13, credit_statements CRUD, 帳單計算 |
| `src/js/pages/accountsPage.js` | +97/-8 行 | 帳戶類型選擇、信用卡欄位、欠款顯示 |

---

## 🔴 高嚴重度 (HIGH) — 必須修復

### H1. `calculateCreditCardBalance` 效能問題 — 全量載入所有紀錄

**位置**: `dataService.js:2068`
```javascript
const records = await this.getRecords({ allLedgers: true });
const accountRecords = records.filter(r => r.accountId === accountId);
```

**問題**: 此方法載入**所有帳本的所有紀錄**再過濾單一帳戶。當使用者有數千筆紀錄時：
- 一次性將所有 records 從 IndexedDB 載入記憶體
- 然後在 JS 層過濾
- 如果有多張信用卡且多次呼叫，問題加劇

**建議**:
```javascript
// 改用accountId 直接查詢，避免載入全量資料
const accountRecords = await this.getRecords({ accountId, allLedgers: true });
// 然後只再做日期過濾
const periodRecords = accountRecords.filter(r => {
  const recordDate = new Date(r.date);
  return recordDate >= startDate && recordDate <= endDate;
});
```

**風險**: 資料量大時（>5000 筆）可能造成明顯的 UI 延遲或記憶體壓力。

---

### H2. `exportData` 未包含 `credit_statements` — 匯出/匯入資料遺失

**位置**: `dataService.js:974-1044`

**問題**: `exportData()` 方法匯出的資料結構包含 `accounts`, `records`, `contacts`, `debts`, `recurring_transactions`, `amortizations` 等，但**完全沒有 `credit_statements`**。

同樣地，`importData()` 也沒有處理 `credit_statements` 的匯入。

**影響**: 使用者匯出備份後匯入，信用卡帳單資料會完全遺失。

**建議**:
1. 在 `exportData` 中新增:
   ```javascript
   let credit_statements = [];
   try {
       credit_statements = await this.getCreditStatements({ allLedgers: true });
   } catch (e) { console.warn('Silenced error:', e); }
   ```
2. 在 `exportData` 物件中加入 `credit_statements`
3. 在 `importData` 中對應處理匯入
4. 升級 export `version` 至 `'2.4.0'`

---

### H3. `exportDataForSync` 同樣未包含 `credit_statements` — 跨裝置同步遺失

**位置**: `dataService.js:1685` 起的 `exportDataForSync` 方法

**問題**: 同步用的匯出也同樣沒有包含 `credit_statements`，意味著跨裝置同步時信用卡帳單數據不會同步。

**建議**: 同 H2，在 sync 的匯出/匯入路徑中也加入 credit_statements。

---

## 🟡 中嚴重度 (MEDIUM) — 應修復

### M1. 第 2084 行死碼 (Dead Code)

**位置**: `dataService.js:2078-2086`
```javascript
for (const record of periodRecords) {
  if (record.type === 'expense') {
    if (record.category !== 'repay_credit') {
      totalExpense += record.amount;    // line 2082
    }
  } else if (record.type === 'expense' && record.category === 'repay_credit') {  // line 2084 — 永遠不會執行!
    totalRepayment += record.amount;
  }
}
```

**問題**: 第 2084 行的 `else if` 條件檢查 `record.type === 'expense'`，但這是在 `if (record.type === 'expense')` 的 `else` 分支，所以 `record.type` 絕對不可能是 `'expense'`。這是一個邏輯錯誤，`totalRepayment` 永遠不會被累加。

**正確寫法**:
```javascript
for (const record of periodRecords) {
  if (record.type === 'expense' && record.category === 'repay_credit') {
    totalRepayment += record.amount;
  } else if (record.type === 'expense') {
    totalExpense += record.amount;
  }
}
```

**影響**: 信用卡還款紀錄不會從本期消費中扣除，導致 `currentBalance` 計算錯誤。

---

### M2. `autoGenerateCreditStatements` 從未在任何地方被呼叫

**位置**: `dataService.js:2123`

**問題**: `autoGenerateCreditStatements()` 方法已實作但**沒有在 main.js 或任何地方被呼叫**（類似 `processAmortizations()` 的處理方式）。這意味著信用卡帳單不會自動產生。

**建議**: 在 `main.js` 的 init 流程中加入呼叫，或提供手動觸發的 UI 入口。

---

### M3. `repay_credit` 分類不存在於 categories 中

**位置**: `dataService.js:2081, 2084`

**問題**: 程式碼假設存在一個 `repay_credit` 分類來識別信用卡還款紀錄，但檢查 `categories.js` 發現此分類並不存在。

**影響**: 如果使用者沒有手動建立 `repay_credit` 分類，`calculateCreditCardBalance` 的還款偵測將永遠失效。

**建議**: 
1. 在 `categories.js` 中加入 `repay_credit` 作為預設支出分類，或
2. 改用更可靠的方式標記還款紀錄（如 `record.metadata?.isCreditRepayment` 欄位），或
3. 在文件/UI 中告知使用者需要建立此分類

---

### M4. 信用卡餘額計算語義不明確

**位置**: `accountsPage.js:74-84`
```javascript
const currentBalance = recordsForAccount.reduce((balance, record) => {
    return balance + (record.type === 'income' ? record.amount : -record.amount);
}, account.balance);
// ...
if (account.type === 'credit_card') {
    totalCreditDebt += currentBalance;
}
```

**問題**: 信用卡的「欠款」計算邏輯與一般帳戶完全相同（收入增加、支出減少）。但信用卡的語義應該是：
- **支出**（刷卡）→ 增加欠款
- **收入**（還款）→ 減少欠款

目前的計算方式剛好**相反**：在信用卡帳戶上記錄「支出」會減少餘額（減少欠款），而「收入」會增加餘額（增加欠款）。

**建議**: 對 `credit_card` 類型的帳戶，反轉計算邏輯：
```javascript
const isCreditCard = account.type === 'credit_card';
const currentBalance = recordsForAccount.reduce((balance, record) => {
    if (isCreditCard) {
        return balance + (record.type === 'expense' ? record.amount : -record.amount);
    }
    return balance + (record.type === 'income' ? record.amount : -record.amount);
}, account.balance);
```

---

## 🟢 低嚴重度 (LOW) — 建議改善

### L1. `getStatementPeriod` 的跨年邊緣情況

**位置**: `dataService.js:2108-2118`

**問題**: 當 `month` 為 12 時，`endDate` 的計算 `new Date(year, month, statementDay)` 會正確跨年（JavaScript Date 自動處理），但 `startDate` 在 1 月的 `month - 1` 也會正確回推到上一年的 12 月。這部分實際上沒問題，但建議加入 JSDoc 說明或測試案例。

---

### L2. `creditLimit`、`statementDay`、`dueDay` 在 migration 時對所有帳戶設定

**位置**: `dataService.js:248-253`
```javascript
if (!data.type) {
    data.type = 'wallet';
    data.creditLimit = 0;
    data.statementDay = 25;
    data.dueDay = 15;
    await cursor.update(data);
}
```

**問題**: 即使是 `wallet` 類型的帳戶也會寫入 `creditLimit`、`statementDay`、`dueDay`。這些欄位對一般帳戶無意義，浪費儲存空間。

**建議**: 只在 `type === 'credit_card'` 時才寫入這些欄位。

---

### L3. `clearAllCreditStatements` 缺乏 `skipLog` 參數

**位置**: `dataService.js:1962-1972`

**問題**: 與 `clearAllAccounts()`、`clearAllContacts()` 等其他 clear 方法相比，`clearAllCreditStatements()` 沒有 `skipLog` 參數，這在匯入/還原場景可能產生大量不必要的 change log。

---

### L4. 帳戶列表渲染時 `isCreditCard` 變數重複定義

**位置**: `accountsPage.js:79, 87`
```javascript
// line 79
if (account.type === 'credit_card') { ... }
// line 87
const isCreditCard = account.type === 'credit_card';
```

**建議**: 在迴圈開始時就定義 `isCreditCard` 變數，然後重複使用。

---

### L5. 缺少信用卡帳單管理 UI

**問題**: `credit_statements` store 已建立、CRUD 方法已實作，但沒有任何 UI 頁面讓使用者查看、管理信用卡帳單。

**建議**: 至少需要一個查看帳單列表的頁面，或在帳戶詳情中顯示帳單資訊。

---

## 📊 摘要

| 嚴重度 | 數量 | 狀態 |
|--------|------|------|
| 🔴 HIGH | 3 | 必須修復 (效能 + 資料遺失) |
| 🟡 MEDIUM | 4 | 應修復 (邏輯錯誤 + 功能不完整) |
| 🟢 LOW | 5 | 建議改善 |

### 最高優先級修復順序:
1. **M1** — 死碼導致信用卡還款計算永遠錯誤（邏輯 bug，影響正確性）
2. **H1** — 全量載入 records 的效能問題
3. **H2/H3** — exportData 和 exportDataForSync 缺少 credit_statements（資料遺失）
4. **M4** — 信用卡餘額計算語義反轉
5. **M2** — autoGenerateCreditStatements 未連接到主流程
6. **M3** — repay_credit 分類不存在

---

## ✨ 正面評價

- Schema migration (v12→v13) 實作正確，有完整的 backward compatibility
- `credit_statements` 的 CRUD 方法結構一致，遵循既有模式（UUID、ledgerId、change log）
- 帳戶 UI 的類型切換互動設計良好，自動更新預設圖示和標籤
- 信用卡帳單自動產生邏輯（`autoGenerateCreditStatements`）設計合理
- 所有新欄位都有合理的預設值

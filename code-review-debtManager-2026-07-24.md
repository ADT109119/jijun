# Code Review Report: debtManager.js (2026-07-24)

## 概覽

| 項目 | 內容 |
|------|------|
| 審查檔案 | `src/js/debtManager.js` (1,342 行) |
| 總問題數 | 10 (Critical: 0, High: 2, Medium: 3, Low: 5) |
| 亮點 | 3 |
| ESLint | 1 warning (no-unused-vars L917) |
| 安全評分 | 7/10 |
| 正確性評分 | 7/10 |
| 效能評分 | 7/10 |
| 可維護性評分 | 6/10 |
| 綜合評分 | 7/10 |

## 按維度統計

| 維度 | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| 安全 | 0 | 2 | 1 | 0 |
| 正確性 | 0 | 0 | 1 | 2 |
| 效能 | 0 | 0 | 1 | 0 |
| 可維護性 | 0 | 0 | 0 | 3 |

---

## 🔴 Critical (0 個)

無。

## 🟠 High (2 個)

### H01: 聯絡人名稱 XSS 漏洞 — `renderContactsPage` 中 `contact.name` 未使用 `escapeHTML`
- **位置**: `debtManager.js:1109`
- **描述**: 在 `renderContactsPage` 方法中，聯絡人名稱 `contact.name` 直接嵌入 innerHTML 模板字串，未經過 `escapeHTML` 消毒。
- **根因**: L85 的 contact filter select 正確使用了 `escapeHTML(c.name)`，但 L1109 的聯絡人列表渲染遺漏了此防護。若聯絡人名稱包含 `<script>alert(1)</script>` 字串，將在頁面渲染時執行惡意腳本。
- **影響**: 任何使用者可以透過建立含有 HTML/JS 字串名稱的聯絡人，在聯絡人管理頁面執行 XSS 攻擊。
- **修復建議**:
  ```javascript
  // L1109 — 修改前
  <span class="font-medium text-wabi-text-primary">${contact.name}</span>
  
  // 修改後
  <span class="font-medium text-wabi-text-primary">${escapeHTML(contact.name)}</span>
  ```

### H02: 欠款描述 XSS 漏洞 — `debt.description` 未使用 `escapeHTML`
- **位置**: `debtManager.js:354` (loadDebtList)、L592 (showPartialPaymentModal)、L682 (showSettleDebtModal)、L761 (showPaymentHistoryModal)、L999/L1001 (showReminderModal textarea value)
- **描述**: 多處渲染 `debt.description` 時直接嵌入 innerHTML，未使用 `escapeHTML`。雖然 L895 的新增/編輯表單中使用了 `debtToEdit?.description || ''` 作為 input value（相对安全），但列表展示和彈窗顯示都未消毒。
- **根因**: 欠款描述是使用者可輸入的自由文字，可能在匯入資料或手動輸入時包含 HTML 標籤。
- **影響**: 惡意的欠款描述可在列表中執行 XSS，特別是 L354 的列表渲染影響所有使用者。
- **修復建議**:
  ```javascript
  // L354 — 修改前
  ${debt.description ? `<p class="text-sm text-wabi-text-secondary mt-2 pl-13">${debt.description}</p>` : ''}
  
  // 修改後
  ${debt.description ? `<p class="text-sm text-wabi-text-secondary mt-2 pl-13">${escapeHTML(debt.description)}</p>` : ''}
  
  // L592, L682, L761 — 同理
  ${escapeHTML(debt.description || '無備註')}
  
  // L895 — textarea value 需要 HTML 屬性轉義（非 escapeHTML）
  value="debtToEdit?.description?.replace(/"/g, '&quot;') || ''"
  ```

## 🟡 Medium (3 個)

### M01: N+1 查詢 — `loadDebtList` 中每筆 debt 按鈕點擊各自獨立查詢
- **位置**: `debtManager.js:430-522`
- **描述**: 每筆債務的操作按鈕（結清、部分付款、刪除、編輯）在點擊時各自呼叫 `this.dataService.getDebt(debtId)`，再加上 `getRecord`、`getSetting` 等查詢。雖然每次只觸發一筆，但大量 debt 列表時若使用者快速操作可能產生多筆並行 IndexedDB 交易。
- **根因**: 為了減少初始載入時間，採用了 lazy loading 策略——只在按鈕點擊時才載入 debt 詳情。但 `loadDebtList` 已經載入了 `allDebts`，按鈕點擊又重新從 DB 讀取。
- **影響**: 對少量欠款影響有限，但有 100+ 筆欠款時，多次快速操作可能導致 IndexedDB 交易競爭。
- **修復建議**: 在 `loadDebtList` 中已經取得的 `allDebts` 陣列可以直接作為按鈕事件處理的資料來源，或至少將當前頁面的 debts 存入 `this._currentPageDebts` 快取，減少重複查詢。

### M02: `showContactSummaryModal` 中 `contact.name` 未 escapeHTML
- **位置**: `debtManager.js:176`
- **描述**: 聯絡人欠款總表中 `contact.name` 直接嵌入 innerHTML 模板字串，未使用 `escapeHTML`。
- **根因**: 與 H01 同源問題，此處的聯絡人列表渲染也未做 XSS 防護。
- **影響**: 聯絡人名稱若包含惡意 HTML/JS，將在總表彈窗中執行。
- **修復建議**:
  ```javascript
  // L176 — 修改前
  <td class="px-4 py-3 text-sm text-wabi-text-primary font-medium">${contact.name}</td>
  
  // 修改後
  <td class="px-4 py-3 text-sm text-wabi-text-primary font-medium">${escapeHTML(contact.name)}</td>
  ```

### M03: `updateSummaryCards` 每次呼叫都重新載入全部未結清債務
- **位置**: `debtManager.js:111-147`
- **描述**: `updateSummaryCards` 在多個操作後被呼叫（結清、部分付款、刪除、編輯、篩選切換），每次都執行 `this.dataService.getDebts({ settled: false })` 全量載入。而 `loadDebtList` 也已經載入了 `allDebts`。
- **根因**: 沒有共享快取機制的設計，`updateSummaryCards` 和 `loadDebtList` 各自獨立載入資料。
- **影響**: 每次操作觸發 2 次以上 IndexedDB 讀取（summary + list），有 500+ 筆未結清欠款時效能明顯下降。
- **修復建議**: 考慮讓 `loadDebtList` 在載入後同時更新 summary cards，或者建立一個共享的 debt 快取。

## 🔵 Low (5 個)

### L01: ESLint no-unused-vars — `e` 參數未使用
- **位置**: `debtManager.js:917`
- **描述**: `btn.addEventListener('click', (e) => {` 中的事件物件 `e` 未使用。
- **修復建議**: 移除 `e` 參數或改用 `_e`。

### L02: 結清日期顯示邏輯有問題 — `formatDate` 的輸入
- **位置**: `debtManager.js:393`
- **描述**: `formatDate(formatDateToString(new Date(debt.settledAt)), 'short')` — 先將 `settledAt` 轉為字串再格式化，多了一個不必要的轉換。`formatDate` 應該可以直接接受 timestamp。
- **修復建議**: 直接使用 `formatDate(debt.settledAt, 'short')`。

### L03: 缺少 `destroy` 方法 — 事件監聽器與模態窗清理
- **位置**: 整個 `DebtManager` 類別
- **描述**: `DebtManager` 沒有 `destroy` 方法來清理已綁定的事件監聽器、清除 `_avatarUrls` Set 中的 object URLs。當使用者離開欠款管理頁面後，這些監聽器仍然持有 container 的參考，可能造成記憶體洩漏。
- **修復建議**: 新增 `destroy()` 方法，清除所有事件監聽器、revoke 所有 avatar URLs。

### L04: 魔法數字 — `pageSize` 硬編碼
- **位置**: `debtManager.js:11`
- **描述**: `this.pageSize = 10` 在 constructor 中硬編碼，雖然可以接受，但建議提取為類別常數以便未來調整。
- **修復建議**: `static PAGE_SIZE = 10;`

### L05: `document.execCommand('copy')` 已淘汰
- **位置**: `debtManager.js:1044`
- **描述**: `document.execCommand('copy')` 是已淘汰的 API，雖然作為 fallback 目前仍有效，但瀏覽器已開始移除支援。
- **修復建議**: 移除 `document.execCommand('copy')` fallback，改用 `textarea.selectionStart/selectionEnd` + `document.execCommand` 或直接提示使用者手動複製。

---

## ✅ Keep（做得好的）

1. **頭像記憶體管理 (L1303-1341)**: `loadContactAvatars` 使用 `_avatarUrls` Set 追蹤所有 object URLs，在重新渲染前 revoke 舊 URL，並在圖片載入/錯誤後自動 revoke。這是非常成熟的記憶體洩漏防護設計。

2. **分期付款進度追蹤 (L328-365)**: 完整的部分付款進度列（progress bar + 百分比 + 已還金額），加上還款歷程彈窗（含雙向跳轉至記帳紀錄），使用者體驗設計完善。

3. **多帳戶模式整合 (L436-458)**: 結清欠款時自動偵測 advanced account mode，引導使用者選擇入帳/出帳帳戶，並且會檢查原始欠款紀錄是否已有關聯帳戶，預設選擇相同的帳戶。邏輯清晰且考慮了使用者體驗。

---

## 📋 Improvements（改進建議，按優先級）

1. **[立即修復]** H01 + H02 + M02: 統一所有使用者輸入的 `contact.name` 和 `debt.description` 使用 `escapeHTML` 消毒，消除 XSS 風險。
2. **[短期]** M01 + M03: 建立 debt 資料快取機制，減少重複 IndexedDB 查詢。
3. **[中期]** L03: 新增 `destroy` 方法，完善資源清理。
4. **[長期]** L04: 提取魔法數字為常數。

---

## 審查方法

- 手動逐行審查 1,342 行程式碼
- ESLint 靜態分析 (1 warning)
- XSS 攻擊路徑追蹤 (輸入點 → innerHTML 渲染)
- 效能分析 (IndexedDB 查詢模式)
- 記憶體管理審查 (Object URL lifecycle)
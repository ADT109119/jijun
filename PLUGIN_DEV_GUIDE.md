# 輕鬆記帳 (Easy Accounting) 擴充功能開發指南

歡迎使用輕鬆記帳擴充功能系統！本文件將引導您開發自己的插件，擴充 App 的功能。

## 1. 插件結構

一個標準的插件是一個 `.js` 檔案，必須預設匯出 (`export default`) 一個包含 `meta` 資訊與 `init` 方法的 JavaScript 物件。

```javascript
// my-plugin.js
export default {
    meta: {
        id: 'com.yourname.pluginname', // 唯一識別碼
        name: '插件名稱',
        version: '1.0',
        description: '插件描述',
        author: '作者名稱'
    },
    init(context) {
        // 插件初始化入口
        console.log('Plugin Initialized');
    }
};
```

## 2. Context API

`init(context)` 方法會接收一個 `context` 物件，提供與 App 互動的介面。

### `context.ui`
- `showToast(msg, type)`: 顯示提示訊息。`type` 可為 `'success'`, `'error'`, `'info'`。
- `registerPage(routeId, title, renderFn)`: 註冊一個自訂頁面。
    - `routeId`: 路由 ID (例如 `'my-page'`)，註冊後可透過 `#my-page` 訪問。
    - `title`: 頁面標題。
    - `renderFn(container)`: 渲染函式，接收一個 DOM 容器元素。
- `navigateTo(hash)`: 導航至指定頁面 (例如 `'#home'`)。

### `context.events`
- `on(hookName, callback)`: 註冊事件監聽器。
- `off(hookName, callback)`: 移除事件監聽器。

## 3. 事件 Hook 列表

您可以使用 `context.events.on` 監聽 App 的生命週期與資料事件。

### UI 事件
- **`onPageRenderBefore`**: 頁面渲染前觸發。
    - Payload: `pageName` (e.g., `'home'`, `'records'`, `'my-page'`)
- **`onPageRenderAfter`**: 頁面渲染後觸發。
    - Payload: `pageName`
- **`onPageClick`**: 全站點擊事件。
    - Payload: `MouseEvent`

### 資料事件 (DataService)
這些事件發生在資料寫入資料庫前後。

- **`onRecordSaveBefore`**: 新增紀錄前觸發。
    - Payload: `record` 物件 (包含 `amount`, `category`, `type` 等)。
    - **攔截**: 若回傳 `null` 或 `false`，將取消儲存。
    - **修改**: 若回傳修改後的 `record` 物件，將儲存修改後的資料。
- **`onRecordSaveAfter`**: 新增紀錄後觸發。
    - Payload: `record` 物件 (包含新生成的 `id`)。

- **`onRecordUpdateBefore`**: 更新紀錄前觸發。
    - Payload: `{ old: oldRecord, updates: newValues }`。
    - **修改**: 若回傳 `{ updates: modifiedUpdates }`，將應用修改後的更新。
- **`onRecordUpdateAfter`**: 更新紀錄後觸發。
    - Payload: 更新後的完整 `record`。

- **`onRecordDeleteBefore`**: 刪除紀錄前觸發。
    - Payload: `{ id: recordId }`。
    - **攔截**: 若回傳 `false` (非 falsy 即可，但建議用 boolean)，取消刪除。
- **`onRecordDeleteAfter`**: 刪除紀錄後觸發。
    - Payload: `{ id: recordId }`。

## 4. 範例：記帳攔截插件

以下範例會檢查新增的支出金額，若超過 10,000 元則發出警告並阻止儲存（模擬預算超支）。

```javascript
export default {
    meta: {
        id: 'com.example.budgetguard',
        name: '預算守衛',
        version: '1.0',
        description: '防止單筆高額消費'
    },
    init(context) {
        context.events.on('onRecordSaveBefore', (record) => {
            if (record.type === 'expense' && record.amount > 10000) {
                context.ui.showToast('⚠️ 金額過大！已攔截高額消費。', 'error');
                return null; // 取消儲存
            }
            return record; // 允許儲存
        });
    }
};
```

## 5. 範例：自訂頁面插件

```javascript
export default {
    meta: {
        id: 'com.example.dashboard',
        name: '自訂儀表板',
        version: '1.0'
    },
    init(context) {
        context.ui.registerPage('dashboard', '我的儀表板', (container) => {
            container.innerHTML = `
                <div class="p-4">
                    <h1 class="text-2xl font-bold">歡迎回來</h1>
                    <p>這是一個由插件產生的頁面。</p>
                    <button id="go-home" class="bg-blue-500 text-white p-2 rounded mt-4">回首頁</button>
                </div>
            `;
            
            container.querySelector('#go-home').addEventListener('click', () => {
                context.ui.navigateTo('#home');
            });
        });
    }
};
```

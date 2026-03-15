# 輕鬆記帳 - 專案結構

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染、帳本切換器)
├── dataService.js       # IndexedDB 資料存取層 (Schema v8: 多帳本支援)
├── ledgerManager.js     # 帳本管理商業邏輯 (建立、切換、刪除帳本)
├── categories.js        # 分類常數與工具函數
├── categoryManager.js   # 分類管理 UI 邏輯
├── statistics.js        # 統計分析頁面
├── recordsList.js       # 記帳紀錄列表
├── budgetManager.js     # 預算管理
├── quickSelectManager.js# 快速選擇管理
├── debtManager.js       # 欠款管理
├── changelog.js         # 更新日誌
├── datePickerModal.js   # 日期選擇器彈窗
├── pluginManager.js     # 擴充功能系統
├── pluginStorage.js     # 插件沙箱化儲存
├── syncService.js       # Google Drive 雲端備份&同步
├── rewardService.js     # 雙平台廣告服務 (見下方說明)
├── router.js            # 路由管理
└── utils.js             # 共用工具函數 (格式化、Toast 等)

src/js/pages/
├── ledgersPage.js       # 帳本管理頁面 (新增/編輯/刪除/切換帳本)
└── ...                  # 其他頁面

src/css/
└── main.css             # 主樣式表

android/                 # Capacitor Android 原生專案
├── app/src/main/
│   └── AndroidManifest.xml  # 含 AdMob App ID
└── variables.gradle     # SDK 版本設定 (minSdk=23, targetSdk=35)

capacitor.config.json    # Capacitor 配置 (appId, webDir, androidScheme)
index.html               # 入口 HTML (CDN: Tailwind, FontAwesome, Chart.js, IDB, GIS)
```

## 模組依賴

- `main.js` → 所有模組 (中心樞紐)
- `ledgerManager.js` → `dataService.js`, `utils.js`
- `rewardService.js` → `utils.js` (showToast), **動態 import** `@capacitor-community/admob`
- `syncService.js` → `dataService.js`
- `pluginManager.js` → `dataService.js`, `pluginStorage.js`

## 關鍵設計決策

- **多帳本架構 (Schema v9)**:
  - `ledgers` object store 儲存帳本元資料 (名稱、圖示、顏色、類型、uuid)
  - 所有資料 store (records, accounts, contacts, debts, recurring_transactions) 新增 `ledgerId` index
  - 所有 CRUD 操作透過 `DataService.activeLedgerId` 自動過濾，傳入 `{ allLedgers: true }` 可跳過過濾
  - **同步與備份**:
    - 使用 `uuid` 作為跨裝置實體關聯的唯一標識，解決 `ledgerId` (Auto-increment PK) 在不同裝置不一致的問題
    - 匯出/匯入支援「全帳本打包」，匯入時自動建立 ID 映射 (Remapping) 並關聯至正確帳本
  - Schema 升級 (v8->v9): 移除帳戶名稱唯一約束，支援不同帳本擁有同名帳戶 (如：兩帳本都有「現金」)
- **rewardService.js（雙平台）**: 模組載入時偵測 `Capacitor.isNativePlatform()`：
  - **原生** → 動態 import `@capacitor-community/admob`，使用 AdMob SDK 的 Banner 和 Rewarded Video
  - **Web** → 保留 AdSense 橫幅 + GPT 獎勵廣告 + 內建推廣廣告備案
  - 24 小時無廣告狀態存於 `localStorage`
- **Capacitor Android**: Web 資產打包進 `android/app/src/main/assets/public/`，透過 WebView 載入本地檔案，AdMob 為原生 overlay

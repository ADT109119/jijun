# 輕鬆記帳 - 專案結構

本專案是一個基於 HTML/CSS/JavaScript 與 Capacitor 的記帳 Web App。

## 檔案結構與作用

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染、帳本切換器、processAmortizations)
├── dataService.js       # IndexedDB 資料存取層 (Schema v13: 多帳本 + 攤提/分期 + 信用卡支援)
├── ledgerManager.js     # 帳本管理商業邏輯 (建立、切換、刪除帳本)
├── categories.js        # 分類常數與工具函數
├── categoryManager.js   # 分類管理 UI 邏輯
├── statistics.js        # 統計分析頁面 (包含跨月比較報表等功能)
├── recordsList.js       # 記帳紀錄列表
├── budgetManager.js     # 預算管理
├── quickSelectManager.js# 快速選擇管理
├── debtManager.js       # 欠款管理
├── changelog.js         # 更新日誌
├── datePickerModal.js   # 日期選擇器彈窗
├── pluginManager.js     # 擴充功能系統
├── pluginStorage.js     # 插件沙箱化儲存
├── syncService.js       # Google Drive 雲端備份&同步
├── rewardService.js     # 雙平台廣告服務 (Capacitor AdMob + Web AdSense)
├── router.js            # 路由管理
└── utils.js             # 共用工具函數 (格式化、Toast 等)

src/js/pages/
├── ledgersPage.js       # 帳本管理頁面 (新增/編輯/刪除/切換帳本，含圖示搜尋與自訂顏色)
├── amortizationsPage.js # 攤提/折舊/分期管理頁面 (新增/編輯/刪除，進度追蹤，首付+利息計算)
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
- `rewardService.js` → `utils.js` (showToast), 動態 import `@capacitor-community/admob`
- `syncService.js` → `dataService.js`
- `pluginManager.js` → `dataService.js`, `pluginStorage.js`

## 測試結構

所有的單元測試位於 `tests/unit/` 目錄下：
- `recordsList.test.js` # 測試明細紀錄列表與預設時間範圍設定
- `amortization.test.js` # 測試折舊攤提分期邏輯
- `budgetManager.test.js` # 測試預算管理邏輯
- `categoryManager.test.js` # 測試分類管理邏輯
- ...等等（共有 19 個測試檔案，對應各主要模組的單元驗證）
- 透過 `npx vitest run` 執行所有單元測試


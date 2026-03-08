# 輕鬆記帳 - 專案結構

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染)
├── dataService.js       # IndexedDB 資料存取層
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
- `rewardService.js` → `utils.js` (showToast), **動態 import** `@capacitor-community/admob`
- `syncService.js` → `dataService.js`
- `pluginManager.js` → `dataService.js`, `pluginStorage.js`

## 關鍵設計決策

- **rewardService.js（雙平台）**: 模組載入時偵測 `Capacitor.isNativePlatform()`：
  - **原生** → 動態 import `@capacitor-community/admob`，使用 AdMob SDK 的 Banner 和 Rewarded Video
  - **Web** → 保留 AdSense 橫幅 + GPT 獎勵廣告 + 內建推廣廣告備案
  - 24 小時無廣告狀態存於 `localStorage`
- **Capacitor Android**: Web 資產打包進 `android/app/src/main/assets/public/`，透過 WebView 載入本地檔案，AdMob 為原生 overlay

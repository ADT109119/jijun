# 輕鬆記帳 - 專案結構

本專案是一個基於 HTML/CSS/JavaScript 與 Capacitor 的記帳 Web App。

## 檔案結構與作用

```
src/js/
├── main.js              # 主應用程式 (EasyAccountingApp 類別，路由、頁面渲染、帳本切換器、processAmortizations)
├── themeManager.js       # 主題管理 (套用 CSS 變數、圖示替換；SVG/CSS 注入消毒)
├── dataService.js       # IndexedDB 資料存取層 (Schema v13: 多帳本 + 攤提/分期 + 信用卡支援)
├── ledgerManager.js     # 帳本管理商業邏輯 (建立、切換、刪除帳本)
├── categories.js        # 分類常數與工具函數
├── categoryManager.js   # 分類管理 UI 邏輯
├── statistics.js        # 統計分析頁面 (包含跨月比較報表等功能)
├── comparisonReport.js   # 跨月比較報表與 CSV 匯出 (包含結構比例、日均支出、儲蓄率)
├── calendarCashFlow.js   # 行事曆金流檢視 (月曆網格、Top 3 支出標籤、每日明細 Modal)
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
├── widgetHelper.js      # Android Widget 資料計算與同步輔助 (包含行事曆 Widget 資料提取)
└── utils.js             # 共用工具函數 (格式化、Toast 等)

src/js/pages/
├── homePage.js          # 首頁：收支摘要、小工具、快速記帳
├── addPage.js           # 新增/編輯紀錄：金額輸入、分類選擇、群組、欠款、攤提
├── recordsPage.js       # 明細列表：篩選、搜尋、日期範圍、分頁
├── statsPage.js         # 統計報表：圖表、類別分析、趨勢
├── settingsPage.js      # 設定：主題、進階模式、匯入匯出、通知
├── accountsPage.js      # 帳戶管理：建立、編輯、刪除帳戶
├── debtsPage.js         # 欠款管理頁面（前端路由）
├── contactsPage.js      # 聯絡人管理
├── recurringPage.js     # 定期收支管理
├── comparisonPage.js    # 跨月比較報表
├── ledgersPage.js       # 帳本管理頁面 (新增/編輯/刪除/切換帳本，含圖示搜尋與自訂顏色)
├── amortizationsPage.js # 攤提/折舊/分期管理頁面 (新增/編輯/刪除，進度追蹤，首付+利息計算)
├── pluginsPage.js       # 外掛管理：安裝、啟用、設定
├── themesPage.js        # 主題管理
├── themeStorePage.js    # 主題商店
├── storePage.js         # 商店頁面
├── syncSettingsPage.js  # 同步設定
├── privacyPage.js       # 隱私權政策
└── licensePage.js       # 授權條款

src/css/
└── main.css             # 主樣式表

android/                 # Capacitor Android 原生專案
├── app/src/main/
│   ├── AndroidManifest.xml  # 含 AdMob App ID 與 Widget/DeepLink 配置
│   ├── java/com/walkingfish/easyaccounting/
│   │   ├── MainActivity.java           # 註冊 WidgetStoragePlugin
│   │   ├── WidgetStoragePlugin.java     # 自訂儲存插件 (保存桌面統計/載具/捷徑/行事曆 Widget 資料)
│   │   ├── EasyAccountingWidgetProvider.java # 桌面統計小工具 Provider
      ├── InvoiceCarrierWidgetProvider.java # 發票載具小工具 Provider (Code 39 繪製)
│   │   ├── QuickCategoryWidgetProvider.java  # 快速分類捷徑小工具 Provider
│   │   └── CalendarWidgetProvider.java       # 桌面行事曆金流小工具 Provider (42 格 6 週網格繪製)
│   └── res/
│       ├── layout/
│       │   ├── widget_layout.xml       # 統計小工具佈局 XML
│       │   ├── carrier_widget_layout.xml # 載具小工具佈局 XML
│       │   ├── shortcut_widget_layout.xml # 快速捷徑小工具佈局 XML
│       │   └── calendar_widget_layout.xml # 行事曆小工具佈局 XML
│       ├── xml/
│       │   ├── widget_info.xml         # 統計小工具設定 XML
│       │   ├── carrier_widget_info.xml  # 載具小工具設定 XML
│       │   ├── shortcut_widget_info.xml # 快速捷徑小工具設定 XML
│       │   └── calendar_widget_info.xml # 行事曆小工具設定 XML
│       └── drawable/                   # 小工具樣式與分類圓形背景、向量圖標 XML (ic_cat_food.xml 等)
└── variables.gradle     # SDK 版本設定 (minSdk=23, targetSdk=35)

public/                  # 靜態資源目錄
├── manifest.json        # PWA 設定檔 (包含唯一 id、主題顏色與應用資訊)
├── serviceWorker.js     # 離線快取 Service Worker
├── icon/                # 圖示目錄 (包含 icon.png 192px 與 icon-512.png 512px)
├── screenshots/         # PWA 螢幕截圖目錄 (用於應用商店預覽)
└── widgets/             # PWA 桌面小工具定義檔 (包含 template.json 與 data.json)

capacitor.config.json    # Capacitor 配置 (appId, webDir, androidScheme)
index.html               # 入口 HTML (CDN: Tailwind, FontAwesome, Chart.js, IDB, GIS)
```

## 模組依賴

- `main.js` → 所有模組 (中心樞紐)，**動態 import** `@capacitor/app`
- `ledgerManager.js` → `dataService.js`, `utils.js`
- `rewardService.js` → `utils.js` (showToast), 動態 import `@capacitor-community/admob`
- `syncService.js` → `dataService.js`
- `pluginManager.js` → `dataService.js`, `pluginStorage.js`

## 路由 (src/js/router.js)

| 路由 | 頁面 | 說明 |
|------|------|------|
| `#home` | HomePage | 首頁 |
| `#records` | RecordsPage | 明細列表 |
| `#add` | AddPage | 新增/編輯紀錄 |
| `#stats` | StatsPage | 統計 |
| `#settings` | SettingsPage | 設定 |
| `#accounts` | AccountsPage | 帳戶 |
| `#recurring` | RecurringPage | 定期收支 |
| `#debts` | DebtsPage | 欠款 |
| `#amortizations` | AmortizationsPage | 攤提 |
| `#comparison` | ComparisonPage | 比較報表 |
| `#contacts` | ContactsPage | 聯絡人 |
| `#ledgers` | LedgersPage | 帳本 |
| `#plugins` | PluginsPage | 外掛 |
| `#themes` | ThemesPage | 主題 |
| `#themeStore` | ThemeStorePage | 主題商店 |
| `#store` | StorePage | 商店 |
| `#sync` | SyncSettingsPage | 同步設定 |
| `#privacy` | PrivacyPage | 隱私權 |
| `#license` | LicensePage | 授權 |

## IndexedDB Schema

**Database**: `easy-accounting-db`

| Store | KeyPath | 說明 |
|-------|---------|------|
| `records` | `id` (autoIncrement) | 收支明細 |
| `accounts` | `id` (autoIncrement) | 帳戶 |
| `categories` | `id` | 分類 |
| `settings` | `key` | 設定鍵值對 |
| `contacts` | `id` (autoIncrement) | 聯絡人 |
| `debts` | `id` (autoIncrement) | 欠款 |
| `amortizations` | `id` (autoIncrement) | 攤提計畫 |
| `ledgers` | `id` (autoIncrement) | 帳本 |
| `theme` | `id` | 主題 |
| `pluginState` | `id` | 外掛狀態 |

## 程式碼慣例

- **語法**: 不使用分號 (no semicolons)，ES Module
- **縮排**: 4 個空格
- **命名**: camelCase（函數/變數）、PascalCase（class）、snake_case（資料庫欄位）
- **XSS 防護**: 使用者輸入嵌入 innerHTML 時必須使用 `escapeHTML()`（import from `utils.js`）
- **批次查詢**: 避免 N+1 查詢，使用 `getDebts()`、`getRecords()` 批次載入
- **無障礙**: Modal 使用 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`

## 測試結構

所有的單元測試位於 `tests/unit/` 目錄下：

- `recordsList.test.js` # 測試明細紀錄列表與預設時間範圍設定
- `amortization.test.js` # 測試折舊攤提分期邏輯
- `amortizationModal.test.js` # 測試攤提/分期新增編輯 Modal
- `budgetManager.test.js` # 測試預算管理邏輯
- `categoryManager.test.js` # 測試分類管理邏輯
- `changelog.test.js` # 測試更新日誌解析與渲染
- `themeManager.test.js` # 測試主題管理 (含 SVG 消毒與 CSS 變數消毒)
- `widgetHelper.test.js` # 測試 Android Widget 資料計算與貨幣格式化 (含行事曆資料提取)
- `calendarCashFlow.test.js` # 測試行事曆金流元件 (群組、繪製、跨月與 XSS 消毒)
- `comparisonReport.test.js` # 測試跨月比較報表計算與 CSV 匯出
- `statistics.test.js` # 測試統計分析頁面 (跨月比較、XSS 防護)
- `dataService.test.js` # 測試 IndexedDB 資料層 (含刪除帳本級聯清理)
- ...等等（共有 25 個測試檔案，對應各主要模組的單元驗證）
- 透過 `npx vitest run` 執行所有單元測試
